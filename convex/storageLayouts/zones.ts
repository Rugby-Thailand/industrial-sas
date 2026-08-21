import { v } from "convex/values";

import { postLedgerTransaction } from "../lib/inventoryLedgerStore";
import {
  createMasterDataRow,
  normalizeDisplayName,
  normalizeField,
  updateMasterDataRow,
} from "../lib/masterDataStore";
import type { TenantOrgId } from "../lib/tenantDb";
import {
  mutationWithOrg,
  type TenantFunctionContext,
} from "../lib/tenantFunctions";
import type { LedgerTransactionDraft } from "../model/inventory/ledgerTransaction";
import {
  makeStorageZoneCode,
  makeStorageZoneQrValue,
  planStackPlacement,
  STORAGE_ZONE_LIMITS,
  validateStorageZone,
} from "../model/storageLayout/storageZone";

const outcome = v.any();

interface BuildingDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly warehouseId: string;
  readonly code: string;
  readonly widthMm: number;
  readonly depthMm: number;
  readonly defaultFloorHeightMm: number;
}

interface FloorDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly buildingId: string;
  readonly warehouseId: string;
  readonly floorNumber: number;
  readonly widthMm?: number;
  readonly depthMm?: number;
  readonly heightMm?: number;
}

interface ReservedBlockDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly floorId: string;
  readonly xMm: number;
  readonly yMm: number;
  readonly widthMm: number;
  readonly depthMm: number;
}

interface ZoneDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly buildingId: string;
  readonly floorId: string;
  readonly warehouseId: string;
  readonly locationId: string;
  readonly code: string;
  readonly label: string;
  readonly qrValue: string;
  readonly xMm: number;
  readonly yMm: number;
  readonly widthMm: number;
  readonly depthMm: number;
  readonly maxStackHeightMm: number;
  readonly status: "ACTIVE" | "INACTIVE";
}

interface PlacementDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly zoneId: string;
  readonly locationId: string;
  readonly warehouseId: string;
  readonly handlingUnitId: string;
  readonly levelIndex: number;
  readonly widthMm: number;
  readonly depthMm: number;
  readonly heightMm: number;
  readonly orientation: "DEFAULT" | "ROTATED";
  readonly status: "ACTIVE" | "REMOVED";
  readonly transactionId: string;
}

interface HandlingUnitDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly warehouseId: string;
  readonly lpn: string;
  readonly currentLocationId?: string;
  readonly status: "ACTIVE" | "INACTIVE";
}

interface BalanceDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly warehouseId: string;
  readonly itemId: string;
  readonly locationKind: "PHYSICAL" | "VIRTUAL";
  readonly locationId?: string;
  readonly virtualBoundary?:
    | "SUPPLIER_RECEIPT"
    | "CUSTOMER_SHIPMENT"
    | "PRODUCTION_ISSUE"
    | "PRODUCTION_RECEIPT"
    | "INVENTORY_ADJUSTMENT"
    | "SCRAP_DAMAGE"
    | "RECONCILIATION";
  readonly lotId?: string;
  readonly serialId?: string;
  readonly handlingUnitId?: string;
  readonly ownerId?: string;
  readonly stockStatus:
    "AVAILABLE" | "QC_HOLD" | "QUARANTINE" | "REJECTED" | "SCRAP" | "EXPIRED";
  readonly quantity: { readonly uom: string; readonly minorUnits: number };
}

interface TransactionDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly requestId: string;
  readonly operation: string;
}

interface IdempotencyDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly resultRef?: string;
}

const failure = (code: string, field?: string) => ({
  written: false as const,
  error: { code, ...(field === undefined ? {} : { field }) },
});

function writeContext(
  ctx: TenantFunctionContext,
  table: "locations" | "storageZones",
  operation: string,
  requestId: string,
  warehouseId: string,
) {
  return {
    tenantDb: ctx.tenantDb,
    table,
    operation,
    requestId,
    permissionCode: ctx.permission.code,
    actorUserId: ctx.tenant.actor._id,
    warehouseId,
    now: Date.now(),
  };
}

async function readBuildingFloor(
  ctx: TenantFunctionContext,
  buildingId: string,
  warehouseId: string,
  floorNumber: number,
) {
  const building = await ctx.tenantDb.get<BuildingDocument>(
    "storageBuildings",
    buildingId,
  );
  if (building === null || building.warehouseId !== warehouseId) return null;
  const floor = await ctx.tenantDb
    .byIndex<FloorDocument>(
      "storageFloors",
      "by_orgId_buildingId_floorNumber",
      [
        { field: "buildingId", value: buildingId },
        { field: "floorNumber", value: floorNumber },
      ],
    )
    .unique();
  if (floor === null || floor.warehouseId !== warehouseId) return null;
  return { building, floor };
}

export const createStorageZone = mutationWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    buildingId: v.id("storageBuildings"),
    floorNumber: v.number(),
    requestId: v.string(),
    label: v.string(),
    xMm: v.number(),
    yMm: v.number(),
    widthMm: v.number(),
    depthMm: v.number(),
    maxStackHeightMm: v.number(),
  },
  returns: outcome,
  permissionCode: "masterData.storageLayout.manage",
  target: { table: "storageZones" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const scope = await readBuildingFloor(
      ctx,
      args.buildingId,
      args.warehouseId,
      args.floorNumber,
    );
    if (scope === null) return failure("NOT_FOUND");
    const label = normalizeDisplayName("label", args.label);
    if (!label.ok) return failure(label.error.code, "label");

    const replayRecord = await ctx.tenantDb
      .byIndex<IdempotencyDocument>(
        "idempotencyRecords",
        "by_orgId_operation_requestId",
        [
          { field: "operation", value: "storageLayout.zone.create" },
          { field: "requestId", value: args.requestId },
        ],
      )
      .first();
    const replayZone =
      replayRecord?.resultRef === undefined
        ? null
        : await ctx.tenantDb.get<ZoneDocument>(
            "storageZones",
            replayRecord.resultRef,
          );
    if (replayZone !== null) {
      const location = await createMasterDataRow({
        ...writeContext(
          ctx,
          "locations",
          "storageLayout.zone.location.create",
          args.requestId,
          args.warehouseId,
        ),
        fingerprint: { ...args, code: replayZone.code },
        uniqueness: [],
        document: {
          warehouseId: args.warehouseId,
          code: replayZone.code,
          locationType: "FLOOR_BLOCK",
          status: "ACTIVE",
        },
      });
      if (!location.ok) return failure(location.error.code);
      const replayed = await createMasterDataRow({
        ...writeContext(
          ctx,
          "storageZones",
          "storageLayout.zone.create",
          args.requestId,
          args.warehouseId,
        ),
        fingerprint: {
          ...args,
          code: replayZone.code,
          locationId: location.value.documentId,
        },
        uniqueness: [],
        document: {
          buildingId: replayZone.buildingId,
          floorId: replayZone.floorId,
          warehouseId: replayZone.warehouseId,
          locationId: replayZone.locationId,
          code: replayZone.code,
          label: replayZone.label,
          qrValue: replayZone.qrValue,
          xMm: replayZone.xMm,
          yMm: replayZone.yMm,
          widthMm: replayZone.widthMm,
          depthMm: replayZone.depthMm,
          maxStackHeightMm: replayZone.maxStackHeightMm,
          status: replayZone.status,
          createdAt: Date.now(),
          createdByUserId: ctx.tenant.actor._id,
          updatedAt: Date.now(),
          updatedByUserId: ctx.tenant.actor._id,
        },
      });
      if (!replayed.ok) return failure(replayed.error.code);
      return {
        written: true as const,
        documentId: replayed.value.documentId,
        replayed: true,
        code: replayZone.code,
        qrValue: replayZone.qrValue,
      };
    }

    const reserved = await ctx.tenantDb
      .byIndex<ReservedBlockDocument>(
        "storageFloorReservedBlocks",
        "by_orgId_floorId",
        [{ field: "floorId", value: scope.floor._id }],
      )
      .take(20);
    const zones = await ctx.tenantDb
      .byIndex<ZoneDocument>("storageZones", "by_orgId_floorId_status_code", [
        { field: "floorId", value: scope.floor._id },
        { field: "status", value: "ACTIVE" },
      ])
      .take(STORAGE_ZONE_LIMITS.maximumZonesPerFloor + 1);
    if (zones.length >= STORAGE_ZONE_LIMITS.maximumZonesPerFloor) {
      return failure("ZONE_LIMIT_EXCEEDED");
    }
    const candidate = {
      xMm: args.xMm,
      yMm: args.yMm,
      widthMm: args.widthMm,
      depthMm: args.depthMm,
      maxStackHeightMm: args.maxStackHeightMm,
    };
    const valid = validateStorageZone({
      floorWidthMm: scope.floor.widthMm ?? scope.building.widthMm,
      floorDepthMm: scope.floor.depthMm ?? scope.building.depthMm,
      floorHeightMm:
        scope.floor.heightMm ?? scope.building.defaultFloorHeightMm,
      candidate,
      reserved,
      zones,
    });
    if (!valid.ok) {
      return failure(
        valid.error.code,
        "field" in valid.error ? valid.error.field : undefined,
      );
    }

    let ordinal = 1;
    let code = makeStorageZoneCode(
      scope.building.code,
      args.floorNumber,
      ordinal,
    );
    while (
      (await ctx.tenantDb
        .byIndex<ZoneDocument>("storageZones", "by_orgId_warehouseId_code", [
          { field: "warehouseId", value: args.warehouseId },
          { field: "code", value: code },
        ])
        .first()) !== null
    ) {
      ordinal += 1;
      code = makeStorageZoneCode(
        scope.building.code,
        args.floorNumber,
        ordinal,
      );
    }

    const now = Date.now();
    const location = await createMasterDataRow({
      ...writeContext(
        ctx,
        "locations",
        "storageLayout.zone.location.create",
        args.requestId,
        args.warehouseId,
      ),
      fingerprint: { ...args, code },
      uniqueness: [
        {
          field: "code",
          index: "by_orgId_warehouseId_code",
          equality: [
            { field: "warehouseId", value: args.warehouseId },
            { field: "code", value: code },
          ],
        },
      ],
      document: {
        warehouseId: args.warehouseId,
        code,
        locationType: "FLOOR_BLOCK",
        status: "ACTIVE",
      },
    });
    if (!location.ok) return failure(location.error.code);
    const qrValue = makeStorageZoneQrValue(location.value.documentId);
    const zone = await createMasterDataRow({
      ...writeContext(
        ctx,
        "storageZones",
        "storageLayout.zone.create",
        args.requestId,
        args.warehouseId,
      ),
      fingerprint: { ...args, code, locationId: location.value.documentId },
      uniqueness: [
        {
          field: "code",
          index: "by_orgId_warehouseId_code",
          equality: [
            { field: "warehouseId", value: args.warehouseId },
            { field: "code", value: code },
          ],
        },
        {
          field: "locationId",
          index: "by_orgId_locationId",
          equality: [{ field: "locationId", value: location.value.documentId }],
        },
        {
          field: "qrValue",
          index: "by_orgId_qrValue",
          equality: [{ field: "qrValue", value: qrValue }],
        },
      ],
      document: {
        buildingId: args.buildingId,
        floorId: scope.floor._id,
        warehouseId: args.warehouseId,
        locationId: location.value.documentId,
        code,
        label: label.value,
        qrValue,
        ...candidate,
        status: "ACTIVE",
        createdAt: now,
        createdByUserId: ctx.tenant.actor._id,
        updatedAt: now,
        updatedByUserId: ctx.tenant.actor._id,
      },
    });
    if (!zone.ok) return failure(zone.error.code);
    return {
      written: true as const,
      documentId: zone.value.documentId,
      replayed: zone.value.replayed,
      code,
      qrValue,
    };
  },
});

export const updateStorageZone = mutationWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    zoneId: v.id("storageZones"),
    requestId: v.string(),
    label: v.string(),
    xMm: v.number(),
    yMm: v.number(),
    widthMm: v.number(),
    depthMm: v.number(),
    maxStackHeightMm: v.number(),
  },
  returns: outcome,
  permissionCode: "masterData.storageLayout.manage",
  target: { table: "storageZones", id: ({ zoneId }) => zoneId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const zone = await ctx.tenantDb.get<ZoneDocument>(
      "storageZones",
      args.zoneId,
    );
    if (
      zone === null ||
      zone.warehouseId !== args.warehouseId ||
      zone.status !== "ACTIVE"
    ) {
      return failure("NOT_FOUND");
    }
    const floor = await ctx.tenantDb.get<FloorDocument>(
      "storageFloors",
      zone.floorId,
    );
    const building = await ctx.tenantDb.get<BuildingDocument>(
      "storageBuildings",
      zone.buildingId,
    );
    if (
      floor === null ||
      building === null ||
      floor.warehouseId !== args.warehouseId ||
      building.warehouseId !== args.warehouseId
    ) {
      return failure("NOT_FOUND");
    }
    const label = normalizeDisplayName("label", args.label);
    if (!label.ok) return failure(label.error.code, "label");
    const reserved = await ctx.tenantDb
      .byIndex<ReservedBlockDocument>(
        "storageFloorReservedBlocks",
        "by_orgId_floorId",
        [{ field: "floorId", value: floor._id }],
      )
      .take(20);
    const zones = (
      await ctx.tenantDb
        .byIndex<ZoneDocument>("storageZones", "by_orgId_floorId_status_code", [
          { field: "floorId", value: floor._id },
          { field: "status", value: "ACTIVE" },
        ])
        .take(STORAGE_ZONE_LIMITS.maximumZonesPerFloor + 1)
    ).filter((candidate) => candidate._id !== zone._id);
    const candidate = {
      xMm: args.xMm,
      yMm: args.yMm,
      widthMm: args.widthMm,
      depthMm: args.depthMm,
      maxStackHeightMm: args.maxStackHeightMm,
    };
    const valid = validateStorageZone({
      floorWidthMm: floor.widthMm ?? building.widthMm,
      floorDepthMm: floor.depthMm ?? building.depthMm,
      floorHeightMm: floor.heightMm ?? building.defaultFloorHeightMm,
      candidate,
      reserved,
      zones,
    });
    if (!valid.ok) {
      return failure(
        valid.error.code,
        "field" in valid.error ? valid.error.field : undefined,
      );
    }
    const placements = await ctx.tenantDb
      .byIndex<PlacementDocument>(
        "storageStackPlacements",
        "by_orgId_zoneId_status_levelIndex",
        [
          { field: "zoneId", value: zone._id },
          { field: "status", value: "ACTIVE" },
        ],
      )
      .take(STORAGE_ZONE_LIMITS.maximumPlacementsPerZone + 1);
    const allPlacementsFit = placements.every((placement) =>
      placement.orientation === "ROTATED"
        ? placement.depthMm <= candidate.widthMm &&
          placement.widthMm <= candidate.depthMm
        : placement.widthMm <= candidate.widthMm &&
          placement.depthMm <= candidate.depthMm,
    );
    if (!allPlacementsFit) return failure("HANDLING_UNIT_DOES_NOT_FIT");

    const updated = await updateMasterDataRow({
      ...writeContext(
        ctx,
        "storageZones",
        "storageLayout.zone.update",
        args.requestId,
        args.warehouseId,
      ),
      documentId: zone._id,
      fingerprint: args,
      uniqueness: [],
      patch: {
        label: label.value,
        ...candidate,
        updatedAt: Date.now(),
        updatedByUserId: ctx.tenant.actor._id,
      },
    });
    if (!updated.ok) return failure(updated.error.code);
    return {
      written: true as const,
      documentId: zone._id,
      replayed: updated.value.replayed,
    };
  },
});

export const archiveStorageZone = mutationWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    zoneId: v.id("storageZones"),
    requestId: v.string(),
  },
  returns: outcome,
  permissionCode: "masterData.storageLayout.manage",
  target: { table: "storageZones", id: ({ zoneId }) => zoneId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const zone = await ctx.tenantDb.get<ZoneDocument>(
      "storageZones",
      args.zoneId,
    );
    if (zone === null || zone.warehouseId !== args.warehouseId) {
      return failure("NOT_FOUND");
    }
    const placement = await ctx.tenantDb
      .byIndex<PlacementDocument>(
        "storageStackPlacements",
        "by_orgId_zoneId_status_levelIndex",
        [
          { field: "zoneId", value: zone._id },
          { field: "status", value: "ACTIVE" },
        ],
      )
      .first();
    if (placement !== null) return failure("ZONE_NOT_EMPTY");
    const balances = await ctx.tenantDb
      .byIndex<BalanceDocument>(
        "inventoryBalances",
        "by_orgId_locationId_bucketKey",
        [{ field: "locationId", value: zone.locationId }],
      )
      .take(100);
    if (balances.some((row) => row.quantity.minorUnits !== 0)) {
      return failure("ZONE_NOT_EMPTY");
    }
    const now = Date.now();
    const location = await updateMasterDataRow({
      ...writeContext(
        ctx,
        "locations",
        "storageLayout.zone.location.archive",
        args.requestId,
        args.warehouseId,
      ),
      documentId: zone.locationId,
      fingerprint: args,
      uniqueness: [],
      patch: { status: "INACTIVE" },
    });
    if (!location.ok) return failure(location.error.code);
    const updated = await updateMasterDataRow({
      ...writeContext(
        ctx,
        "storageZones",
        "storageLayout.zone.archive",
        args.requestId,
        args.warehouseId,
      ),
      documentId: zone._id,
      fingerprint: args,
      uniqueness: [],
      patch: {
        status: "INACTIVE",
        updatedAt: now,
        updatedByUserId: ctx.tenant.actor._id,
      },
    });
    if (!updated.ok) return failure(updated.error.code);
    return {
      written: true as const,
      documentId: zone._id,
      replayed: updated.value.replayed,
    };
  },
});

export const placeHandlingUnit = mutationWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    requestId: v.string(),
    lpn: v.string(),
    zoneScan: v.string(),
    widthMm: v.number(),
    depthMm: v.number(),
    heightMm: v.number(),
  },
  returns: outcome,
  permissionCode: "putaway.task.confirm",
  target: { table: "storageStackPlacements" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const lpn = normalizeField("lpn", args.lpn, {
      caseFolding: "UPPERCASE",
      maxLength: 128,
    });
    if (!lpn.ok) return failure(lpn.error.code, "lpn");
    const unit = await ctx.tenantDb
      .byIndex<HandlingUnitDocument>("handlingUnits", "by_orgId_lpn", [
        { field: "lpn", value: lpn.value },
      ])
      .unique();
    if (
      unit === null ||
      unit.warehouseId !== args.warehouseId ||
      unit.status !== "ACTIVE"
    ) {
      return failure("HANDLING_UNIT_NOT_FOUND");
    }
    if (unit.currentLocationId === undefined) {
      return failure("HANDLING_UNIT_HAS_NO_STOCK_LOCATION");
    }

    const rawScan = args.zoneScan.trim();
    let zone = await ctx.tenantDb
      .byIndex<ZoneDocument>("storageZones", "by_orgId_qrValue", [
        { field: "qrValue", value: rawScan },
      ])
      .unique();
    if (zone === null) {
      const code = normalizeField("zoneScan", rawScan, {
        caseFolding: "UPPERCASE",
        maxLength: 128,
      });
      if (!code.ok) return failure("ZONE_NOT_FOUND", "zoneScan");
      zone = await ctx.tenantDb
        .byIndex<ZoneDocument>("storageZones", "by_orgId_warehouseId_code", [
          { field: "warehouseId", value: args.warehouseId },
          { field: "code", value: code.value },
        ])
        .unique();
    }
    if (
      zone === null ||
      zone.warehouseId !== args.warehouseId ||
      zone.status !== "ACTIVE"
    ) {
      return failure("ZONE_NOT_FOUND");
    }

    const previous = await ctx.tenantDb
      .byIndex<PlacementDocument>(
        "storageStackPlacements",
        "by_orgId_handlingUnitId_status",
        [
          { field: "handlingUnitId", value: unit._id },
          { field: "status", value: "ACTIVE" },
        ],
      )
      .first();
    if (previous !== null) {
      const transaction = await ctx.tenantDb.get<TransactionDocument>(
        "inventoryTransactions",
        previous.transactionId,
      );
      if (
        previous.zoneId === zone._id &&
        previous.widthMm === args.widthMm &&
        previous.depthMm === args.depthMm &&
        previous.heightMm === args.heightMm &&
        transaction?.requestId === args.requestId
      ) {
        return {
          written: true as const,
          documentId: previous._id,
          replayed: true,
          levelIndex: previous.levelIndex,
          capacityWarning: false,
        };
      }
      return failure("HANDLING_UNIT_ALREADY_STACKED");
    }

    const placements = await ctx.tenantDb
      .byIndex<PlacementDocument>(
        "storageStackPlacements",
        "by_orgId_zoneId_status_levelIndex",
        [
          { field: "zoneId", value: zone._id },
          { field: "status", value: "ACTIVE" },
        ],
      )
      .take(STORAGE_ZONE_LIMITS.maximumPlacementsPerZone + 1);
    if (placements.length >= STORAGE_ZONE_LIMITS.maximumPlacementsPerZone) {
      return failure("STACK_LIMIT_EXCEEDED");
    }
    const plan = planStackPlacement({
      zone,
      placements,
      handlingUnit: {
        widthMm: args.widthMm,
        depthMm: args.depthMm,
        heightMm: args.heightMm,
      },
    });
    if (!plan.ok) {
      return failure(
        plan.error.code,
        "field" in plan.error ? plan.error.field : undefined,
      );
    }

    const allBalances = await ctx.tenantDb
      .byIndex<BalanceDocument>(
        "inventoryBalances",
        "by_orgId_handlingUnitId_bucketKey",
        [{ field: "handlingUnitId", value: unit._id }],
      )
      .take(100);
    if (allBalances.length === 100)
      return failure("BALANCE_BUCKET_LIMIT_EXCEEDED");
    const balances = allBalances.filter((row) => row.quantity.minorUnits > 0);
    if (balances.length === 0) return failure("HANDLING_UNIT_HAS_NO_STOCK");
    if (balances.length * 2 > 100)
      return failure("BALANCE_BUCKET_LIMIT_EXCEEDED");
    if (
      balances.some(
        (row) =>
          row.locationKind !== "PHYSICAL" ||
          row.locationId !== unit.currentLocationId ||
          row.warehouseId !== args.warehouseId,
      )
    ) {
      return failure("HANDLING_UNIT_LOCATION_CONFLICT");
    }

    const orgId = ctx.tenant.organization._id;
    const now = Date.now();
    const bucketAt = (row: BalanceDocument, locationId: string) => ({
      orgId,
      warehouseId: args.warehouseId,
      itemId: row.itemId,
      location: { kind: "PHYSICAL" as const, locationId },
      stockStatus: row.stockStatus,
      ...(row.lotId === undefined ? {} : { lotId: row.lotId }),
      ...(row.serialId === undefined ? {} : { serialId: row.serialId }),
      ...(row.handlingUnitId === undefined
        ? {}
        : { handlingUnitId: row.handlingUnitId }),
      ...(row.ownerId === undefined ? {} : { ownerId: row.ownerId }),
    });
    const draft: LedgerTransactionDraft = {
      orgId,
      warehouseId: args.warehouseId,
      type: "MOVE",
      operation: "storageLayout.stack.place",
      requestId: args.requestId,
      actorUserId: ctx.tenant.actor._id,
      occurredAt: now,
      source: { type: "STORAGE_ZONE", id: zone._id },
      lines: balances.flatMap((row) => [
        {
          bucket: bucketAt(row, unit.currentLocationId as string),
          quantity: {
            uom: row.quantity.uom,
            minorUnits: -row.quantity.minorUnits,
          },
        },
        {
          bucket: bucketAt(row, zone.locationId),
          quantity: row.quantity,
        },
      ]),
    };
    const posted = await postLedgerTransaction({
      tenantDb: ctx.tenantDb,
      tenant: ctx.tenant,
      permissionCode: ctx.permission.code,
      now,
      draft,
    });
    if (!posted.ok) return failure(posted.error.code);

    const placementId = await ctx.tenantDb.insert("storageStackPlacements", {
      zoneId: zone._id,
      locationId: zone.locationId,
      warehouseId: args.warehouseId,
      handlingUnitId: unit._id,
      levelIndex: plan.value.levelIndex,
      widthMm: args.widthMm,
      depthMm: args.depthMm,
      heightMm: args.heightMm,
      orientation: plan.value.orientation,
      status: "ACTIVE",
      transactionId: posted.value.result.transactionId,
      placedAt: now,
      placedByUserId: ctx.tenant.actor._id,
    });
    await ctx.tenantDb.patch("handlingUnits", unit._id, {
      widthMm: args.widthMm,
      depthMm: args.depthMm,
      heightMm: args.heightMm,
    });
    return {
      written: true as const,
      documentId: placementId,
      replayed: posted.value.replayed,
      levelIndex: plan.value.levelIndex,
      orientation: plan.value.orientation,
      occupiedHeightMm: plan.value.occupiedHeightMm,
      resultingHeightMm: plan.value.resultingHeightMm,
      capacityWarning: plan.value.capacityWarning,
    };
  },
});
