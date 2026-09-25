import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import {
  createMasterDataRow,
  normalizeDisplayName,
  normalizeField,
  updateMasterDataRow,
} from "../lib/masterDataStore";
import {
  mutationWithOrg,
  queryWithOrg,
  type TenantFunctionContext,
} from "../lib/tenantFunctions";
import { refusal, writeContextOf } from "../lib/writeEnvelope";
import { STORAGE_LAYOUT_LIMITS } from "../model/storageLayout/storageLayout";
import {
  makeStorageZoneCode,
  makeStorageZoneQrValue,
  STORAGE_ZONE_LIMITS,
  validateStorageZone,
} from "../model/storageLayout/storageZone";
import {
  effectiveStorageAreaMode,
  generateRackPositions,
  kindForAreaMode,
  STORAGE_POSITION_LIMITS,
  storagePositionQrValue,
  validateStoragePosition,
  type StorageAreaMode,
} from "../model/storageLayout/storagePosition";

import { hasOccupiedStorage } from "./catalogue";

const outcome = v.any();

type BuildingDocument = Doc<"storageBuildings">;
type FloorDocument = Doc<"storageFloors">;
type ReservedBlockDocument = Doc<"storageFloorReservedBlocks">;
type ZoneDocument = Doc<"storageZones">;
type PositionDocument = Doc<"storagePositions">;
type IdempotencyDocument = Doc<"idempotencyRecords">;

const failure = (code: string, field?: string) => refusal({ code, field });

function writeContext(
  ctx: TenantFunctionContext,
  table: "locations" | "storageZones" | "storagePositions",
  operation: string,
  requestId: string,
  warehouseId: string,
) {
  return writeContextOf(ctx, {
    table,
    operation,
    requestId,
    warehouseId,
  });
}

function areaMode(zone: ZoneDocument): StorageAreaMode {
  return effectiveStorageAreaMode(zone.mode);
}

function zoneGeometry(zone: ZoneDocument) {
  return {
    xMm: zone.xMm,
    yMm: zone.yMm,
    widthMm: zone.widthMm,
    depthMm: zone.depthMm,
    maxStackHeightMm: zone.maxStackHeightMm,
    ...(zone.baseElevationMm === undefined
      ? {}
      : { baseElevationMm: zone.baseElevationMm }),
  };
}

async function activePositions(
  ctx: TenantFunctionContext,
  zone: ZoneDocument,
): Promise<readonly PositionDocument[]> {
  return await ctx.tenantDb
    .byIndex<PositionDocument>(
      "storagePositions",
      "by_orgId_zoneId_status_code",
      [
        { field: "zoneId", value: zone._id },
        { field: "status", value: "ACTIVE" },
      ],
    )
    .all(STORAGE_POSITION_LIMITS.maximumPositionsPerArea);
}

async function ensureDefaultPosition(
  ctx: TenantFunctionContext,
  zone: ZoneDocument,
  requestId: string,
): Promise<PositionDocument | null> {
  const existing = await ctx.tenantDb
    .byIndex<PositionDocument>("storagePositions", "by_orgId_locationId", [
      { field: "locationId", value: zone.locationId },
    ])
    .unique();
  if (existing !== null) return existing;

  const now = Date.now();
  const created = await createMasterDataRow({
    ...writeContext(
      ctx,
      "storagePositions",
      "storageLayout.position.default.backfill",
      requestId,
      zone.warehouseId,
    ),
    fingerprint: {
      zoneId: zone._id,
      locationId: zone.locationId,
      code: zone.code,
    },
    uniqueness: [
      {
        field: "locationId",
        index: "by_orgId_locationId",
        equality: [{ field: "locationId", value: zone.locationId }],
      },
      {
        field: "code",
        index: "by_orgId_warehouseId_code",
        equality: [
          { field: "warehouseId", value: zone.warehouseId },
          { field: "code", value: zone.code },
        ],
      },
    ],
    document: {
      buildingId: zone.buildingId,
      floorId: zone.floorId,
      zoneId: zone._id,
      warehouseId: zone.warehouseId,
      locationId: zone.locationId,
      code: zone.code,
      label: zone.label,
      qrValue: zone.qrValue,
      kind: "DEFAULT",
      isDefault: true,
      xMm: zone.xMm,
      yMm: zone.yMm,
      widthMm: zone.widthMm,
      depthMm: zone.depthMm,
      status: "ACTIVE",
      createdAt: now,
      createdByUserId: ctx.tenant.actor._id,
      updatedAt: now,
      updatedByUserId: ctx.tenant.actor._id,
    },
  });
  if (!created.ok) return null;
  return await ctx.tenantDb.get<PositionDocument>(
    "storagePositions",
    created.value.documentId,
  );
}

async function findZoneByScan(
  ctx: TenantFunctionContext,
  warehouseId: string,
  scan: string,
): Promise<ZoneDocument | null> {
  const raw = scan.trim();
  let zone = await ctx.tenantDb
    .byIndex<ZoneDocument>("storageZones", "by_orgId_qrValue", [
      { field: "qrValue", value: raw },
    ])
    .unique();
  if (zone !== null) return zone.warehouseId === warehouseId ? zone : null;
  const code = normalizeField("scan", raw, {
    caseFolding: "UPPERCASE",
    maxLength: 128,
  });
  if (!code.ok) return null;
  zone = await ctx.tenantDb
    .byIndex<ZoneDocument>("storageZones", "by_orgId_warehouseId_code", [
      { field: "warehouseId", value: warehouseId },
      { field: "code", value: code.value },
    ])
    .unique();
  return zone;
}

async function findPositionByScan(
  ctx: TenantFunctionContext,
  warehouseId: string,
  scan: string,
): Promise<PositionDocument | null> {
  const raw = scan.trim();
  let position = await ctx.tenantDb
    .byIndex<PositionDocument>("storagePositions", "by_orgId_qrValue", [
      { field: "qrValue", value: raw },
    ])
    .unique();
  if (position !== null) {
    return position.warehouseId === warehouseId ? position : null;
  }
  const code = normalizeField("scan", raw, {
    caseFolding: "UPPERCASE",
    maxLength: 128,
  });
  if (!code.ok) return null;
  return await ctx.tenantDb
    .byIndex<PositionDocument>(
      "storagePositions",
      "by_orgId_warehouseId_code",
      [
        { field: "warehouseId", value: warehouseId },
        { field: "code", value: code.value },
      ],
    )
    .unique();
}

function breadcrumbOf(
  building: BuildingDocument,
  floor: FloorDocument,
  zone: ZoneDocument,
  position: PositionDocument,
): string {
  const floorLabel = `Floor ${floor.floorNumber}`;
  if (position.kind === "RACK_SLOT") {
    return `${floorLabel} › ${zone.label} › ${position.fixtureCode ?? "Rack"} › Bay ${String(position.bayIndex ?? 0).padStart(2, "0")} › Level ${String(position.levelIndex ?? 0).padStart(2, "0")}${(position.slotIndex ?? 1) > 1 ? ` › Slot ${String(position.slotIndex).padStart(2, "0")}` : ""}`;
  }
  return `${floorLabel} › ${zone.label} › ${position.label || building.code}`;
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
    storageCondition: v.optional(v.string()),
    xMm: v.number(),
    yMm: v.number(),
    widthMm: v.number(),
    depthMm: v.number(),
    maxStackHeightMm: v.number(),
    mode: v.optional(
      v.union(
        v.literal("SIMPLE"),
        v.literal("FLOOR_POSITIONS"),
        v.literal("RACK"),
        v.literal("PLATFORM"),
      ),
    ),
    baseElevationMm: v.optional(v.number()),
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
    if (scope.building.status === "ARCHIVED") {
      return failure("LAYOUT_NOT_EDITABLE");
    }
    const label = normalizeDisplayName("label", args.label);
    if (!label.ok) return failure(label.error.code, "label");
    const storageCondition = (args.storageCondition ?? "").trim() || undefined;
    if ((storageCondition?.length ?? 0) > 100)
      return failure("TEXT_TOO_LONG", "storageCondition");
    const mode = effectiveStorageAreaMode(args.mode);
    const floorHeightMm =
      scope.floor.heightMm ?? scope.building.defaultFloorHeightMm;
    if (
      (mode === "PLATFORM" &&
        (!Number.isSafeInteger(args.baseElevationMm) ||
          (args.baseElevationMm ?? -1) < 0 ||
          (args.baseElevationMm ?? 0) >= floorHeightMm ||
          (args.baseElevationMm ?? 0) + args.maxStackHeightMm >
            floorHeightMm)) ||
      (mode !== "PLATFORM" && args.baseElevationMm !== undefined)
    ) {
      return failure("BASE_ELEVATION_INVALID", "baseElevationMm");
    }

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
          status: scope.building.status === "ACTIVE" ? "ACTIVE" : "INACTIVE",
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
          ...(replayZone.mode === undefined ? {} : { mode: replayZone.mode }),
          ...(replayZone.baseElevationMm === undefined
            ? {}
            : { baseElevationMm: replayZone.baseElevationMm }),
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
      if (areaMode(replayZone) === "SIMPLE") {
        await ensureDefaultPosition(ctx, replayZone, args.requestId);
      }
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
      .all(STORAGE_LAYOUT_LIMITS.maximumReservedBlocksPerFloor);
    const zones = await ctx.tenantDb
      .byIndex<ZoneDocument>("storageZones", "by_orgId_floorId_status_code", [
        { field: "floorId", value: scope.floor._id },
        { field: "status", value: "ACTIVE" },
      ])
      .all(STORAGE_ZONE_LIMITS.maximumZonesPerFloor);
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
        status: scope.building.status === "ACTIVE" ? "ACTIVE" : "INACTIVE",
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
        ...(storageCondition === undefined ? {} : { storageCondition }),
        mode,
        ...(args.baseElevationMm === undefined
          ? {}
          : { baseElevationMm: args.baseElevationMm }),
        ...candidate,
        status: "ACTIVE",
        createdAt: now,
        createdByUserId: ctx.tenant.actor._id,
        updatedAt: now,
        updatedByUserId: ctx.tenant.actor._id,
      },
    });
    if (!zone.ok) return failure(zone.error.code);
    const createdZone = await ctx.tenantDb.get<ZoneDocument>(
      "storageZones",
      zone.value.documentId,
    );
    if (createdZone === null) return failure("WRITE_VERIFICATION_FAILED");
    if (mode === "SIMPLE") {
      if (
        (await ensureDefaultPosition(ctx, createdZone, args.requestId)) === null
      ) {
        return failure("DEFAULT_POSITION_CREATE_FAILED");
      }
    }
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
    storageCondition: v.optional(v.string()),
    xMm: v.number(),
    yMm: v.number(),
    widthMm: v.number(),
    depthMm: v.number(),
    maxStackHeightMm: v.number(),
    mode: v.optional(
      v.union(
        v.literal("SIMPLE"),
        v.literal("FLOOR_POSITIONS"),
        v.literal("RACK"),
        v.literal("PLATFORM"),
      ),
    ),
    baseElevationMm: v.optional(v.number()),
    confirmOccupiedChange: v.optional(v.boolean()),
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
    if (building.status === "ARCHIVED") {
      return failure("LAYOUT_NOT_EDITABLE");
    }
    const label = normalizeDisplayName("label", args.label);
    if (!label.ok) return failure(label.error.code, "label");
    const storageCondition =
      args.storageCondition === undefined
        ? zone.storageCondition
        : args.storageCondition.trim() || undefined;
    if ((storageCondition?.length ?? 0) > 100)
      return failure("TEXT_TOO_LONG", "storageCondition");
    const mode = effectiveStorageAreaMode(args.mode ?? zone.mode);
    const baseElevationMm =
      mode === "PLATFORM"
        ? (args.baseElevationMm ?? zone.baseElevationMm)
        : undefined;
    const geometryChanged =
      args.xMm !== zone.xMm ||
      args.yMm !== zone.yMm ||
      args.widthMm !== zone.widthMm ||
      args.depthMm !== zone.depthMm ||
      args.maxStackHeightMm !== zone.maxStackHeightMm ||
      mode !== areaMode(zone) ||
      baseElevationMm !== zone.baseElevationMm ||
      (storageCondition?.trim().toUpperCase() || "ANY") !==
        (zone.storageCondition?.trim().toUpperCase() || "ANY");
    if (
      geometryChanged &&
      (await hasOccupiedStorage(ctx, { zoneId: zone._id }))
    )
      return failure("LOCATION_OCCUPIED");
    const floorHeightMm = floor.heightMm ?? building.defaultFloorHeightMm;
    if (
      (mode === "PLATFORM" &&
        (!Number.isSafeInteger(baseElevationMm) ||
          (baseElevationMm ?? -1) < 0 ||
          (baseElevationMm ?? 0) >= floorHeightMm ||
          (baseElevationMm ?? 0) + args.maxStackHeightMm > floorHeightMm)) ||
      (mode !== "PLATFORM" && args.baseElevationMm !== undefined)
    ) {
      return failure("BASE_ELEVATION_INVALID", "baseElevationMm");
    }
    const reserved = await ctx.tenantDb
      .byIndex<ReservedBlockDocument>(
        "storageFloorReservedBlocks",
        "by_orgId_floorId",
        [{ field: "floorId", value: floor._id }],
      )
      .all(STORAGE_LAYOUT_LIMITS.maximumReservedBlocksPerFloor);
    const activeZones = await ctx.tenantDb
      .byIndex<ZoneDocument>("storageZones", "by_orgId_floorId_status_code", [
        { field: "floorId", value: floor._id },
        { field: "status", value: "ACTIVE" },
      ])
      .all(STORAGE_ZONE_LIMITS.maximumZonesPerFloor);
    const zones = activeZones.filter((candidate) => candidate._id !== zone._id);
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
    const positions = await activePositions(ctx, zone);
    const movedArea = {
      ...candidate,
      ...(baseElevationMm === undefined ? {} : { baseElevationMm }),
    };
    if (
      positions.some((position) => {
        if (position.isDefault) return false;
        if (
          position.xMm === undefined ||
          position.yMm === undefined ||
          position.widthMm === undefined ||
          position.depthMm === undefined
        ) {
          return true;
        }
        return !validateStoragePosition({
          mode,
          area: movedArea,
          position: {
            kind: position.kind,
            xMm: position.xMm,
            yMm: position.yMm,
            widthMm: position.widthMm,
            depthMm: position.depthMm,
            ...(position.elevationMm === undefined
              ? {}
              : { elevationMm: position.elevationMm }),
          },
        }).ok;
      })
    ) {
      return failure("POSITION_OUT_OF_AREA");
    }

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
        storageCondition,
        mode,
        ...(mode === "PLATFORM"
          ? { baseElevationMm }
          : { baseElevationMm: undefined }),
        ...candidate,
        updatedAt: Date.now(),
        updatedByUserId: ctx.tenant.actor._id,
      },
    });
    if (!updated.ok) return failure(updated.error.code);
    const defaultPosition =
      mode === "SIMPLE"
        ? await ensureDefaultPosition(ctx, zone, `${args.requestId}:default`)
        : await ctx.tenantDb
            .byIndex<PositionDocument>(
              "storagePositions",
              "by_orgId_locationId",
              [{ field: "locationId", value: zone.locationId }],
            )
            .unique();
    if (defaultPosition !== null) {
      await ctx.tenantDb.patch("storagePositions", defaultPosition._id, {
        label: label.value,
        xMm: candidate.xMm,
        yMm: candidate.yMm,
        widthMm: candidate.widthMm,
        depthMm: candidate.depthMm,
        updatedAt: Date.now(),
        updatedByUserId: ctx.tenant.actor._id,
      });
    }
    return {
      written: true as const,
      documentId: zone._id,
      replayed: updated.value.replayed,
    };
  },
});

async function createPositionRecords(
  ctx: TenantFunctionContext,
  input: {
    readonly zone: ZoneDocument;
    readonly requestId: string;
    readonly code: string;
    readonly label: string;
    readonly kind: "FLOOR" | "RACK_SLOT" | "PLATFORM";
    readonly xMm: number;
    readonly yMm: number;
    readonly widthMm: number;
    readonly depthMm: number;
    readonly fixtureCode?: string;
    readonly bayIndex?: number;
    readonly levelIndex?: number;
    readonly slotIndex?: number;
    readonly elevationMm?: number;
  },
) {
  const building = await ctx.tenantDb.get<BuildingDocument>(
    "storageBuildings",
    input.zone.buildingId,
  );
  const location = await createMasterDataRow({
    ...writeContext(
      ctx,
      "locations",
      "storageLayout.position.location.create",
      input.requestId,
      input.zone.warehouseId,
    ),
    fingerprint: {
      zoneId: input.zone._id,
      code: input.code,
      kind: input.kind,
    },
    uniqueness: [
      {
        field: "code",
        index: "by_orgId_warehouseId_code",
        equality: [
          { field: "warehouseId", value: input.zone.warehouseId },
          { field: "code", value: input.code },
        ],
      },
    ],
    document: {
      warehouseId: input.zone.warehouseId,
      code: input.code,
      locationType: input.kind === "RACK_SLOT" ? "RACK_BIN" : "FLOOR_BLOCK",
      status: building?.status === "ACTIVE" ? "ACTIVE" : "INACTIVE",
    },
  });
  if (!location.ok) return location;
  const qrValue = storagePositionQrValue(location.value.documentId);
  const now = Date.now();
  return await createMasterDataRow({
    ...writeContext(
      ctx,
      "storagePositions",
      "storageLayout.position.create",
      input.requestId,
      input.zone.warehouseId,
    ),
    fingerprint: { ...input, locationId: location.value.documentId },
    uniqueness: [
      {
        field: "locationId",
        index: "by_orgId_locationId",
        equality: [{ field: "locationId", value: location.value.documentId }],
      },
      {
        field: "code",
        index: "by_orgId_warehouseId_code",
        equality: [
          { field: "warehouseId", value: input.zone.warehouseId },
          { field: "code", value: input.code },
        ],
      },
      {
        field: "qrValue",
        index: "by_orgId_qrValue",
        equality: [{ field: "qrValue", value: qrValue }],
      },
    ],
    document: {
      buildingId: input.zone.buildingId,
      floorId: input.zone.floorId,
      zoneId: input.zone._id,
      warehouseId: input.zone.warehouseId,
      locationId: location.value.documentId,
      code: input.code,
      label: input.label,
      qrValue,
      kind: input.kind,
      isDefault: false,
      xMm: input.xMm,
      yMm: input.yMm,
      widthMm: input.widthMm,
      depthMm: input.depthMm,
      ...(input.fixtureCode === undefined
        ? {}
        : { fixtureCode: input.fixtureCode }),
      ...(input.bayIndex === undefined ? {} : { bayIndex: input.bayIndex }),
      ...(input.levelIndex === undefined
        ? {}
        : { levelIndex: input.levelIndex }),
      ...(input.slotIndex === undefined ? {} : { slotIndex: input.slotIndex }),
      ...(input.elevationMm === undefined
        ? {}
        : { elevationMm: input.elevationMm }),
      status: "ACTIVE",
      createdAt: now,
      createdByUserId: ctx.tenant.actor._id,
      updatedAt: now,
      updatedByUserId: ctx.tenant.actor._id,
    },
  });
}

export const createStoragePosition = mutationWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    zoneId: v.id("storageZones"),
    requestId: v.string(),
    code: v.string(),
    label: v.string(),
    xMm: v.number(),
    yMm: v.number(),
    widthMm: v.number(),
    depthMm: v.number(),
  },
  returns: outcome,
  permissionCode: "masterData.storageLayout.manage",
  target: { table: "storagePositions" },
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
    const building = await ctx.tenantDb.get<BuildingDocument>(
      "storageBuildings",
      zone.buildingId,
    );
    if (
      building === null ||
      building.status === "ARCHIVED" ||
      zone.status !== "ACTIVE"
    )
      return failure("LAYOUT_NOT_EDITABLE");
    if (await hasOccupiedStorage(ctx, { zoneId: zone._id }))
      return failure("LOCATION_OCCUPIED");
    const mode = areaMode(zone);
    if (mode === "SIMPLE" || mode === "RACK") {
      return failure("POSITION_MODE_MISMATCH", "mode");
    }
    const codePart = normalizeField("code", args.code, {
      caseFolding: "UPPERCASE",
      maxLength: 48,
    });
    const label = normalizeDisplayName("label", args.label);
    if (!codePart.ok) return failure(codePart.error.code, "code");
    if (!label.ok) return failure(label.error.code, "label");
    const code = `${zone.code}-${codePart.value}`;
    const kind = kindForAreaMode(mode) as "FLOOR" | "PLATFORM";
    const geometry = {
      kind,
      xMm: args.xMm,
      yMm: args.yMm,
      widthMm: args.widthMm,
      depthMm: args.depthMm,
      ...(kind === "PLATFORM" && zone.baseElevationMm !== undefined
        ? { elevationMm: zone.baseElevationMm }
        : {}),
    };
    const valid = validateStoragePosition({
      mode,
      area: zoneGeometry(zone),
      position: geometry,
    });
    if (!valid.ok) {
      return failure(
        valid.error.code,
        "field" in valid.error ? valid.error.field : undefined,
      );
    }
    const positions = await activePositions(ctx, zone);
    if (positions.length >= STORAGE_POSITION_LIMITS.maximumPositionsPerArea) {
      return failure("POSITION_LIMIT_EXCEEDED");
    }
    const created = await createPositionRecords(ctx, {
      zone,
      requestId: args.requestId,
      code,
      label: label.value,
      ...geometry,
    });
    if (!created.ok) return failure(created.error.code);
    return {
      written: true as const,
      documentId: created.value.documentId,
      replayed: created.value.replayed,
      code,
    };
  },
});

export const generateRackStoragePositions = mutationWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    zoneId: v.id("storageZones"),
    requestId: v.string(),
    fixtureCode: v.string(),
    bayCount: v.number(),
    levelCount: v.number(),
    slotsPerBay: v.number(),
    bayWidthMm: v.number(),
    rackDepthMm: v.number(),
    levelHeightMm: v.number(),
  },
  returns: outcome,
  permissionCode: "masterData.storageLayout.manage",
  target: { table: "storagePositions" },
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
    const building = await ctx.tenantDb.get<BuildingDocument>(
      "storageBuildings",
      zone.buildingId,
    );
    if (
      building === null ||
      building.status === "ARCHIVED" ||
      zone.status !== "ACTIVE"
    )
      return failure("LAYOUT_NOT_EDITABLE");
    if (await hasOccupiedStorage(ctx, { zoneId: zone._id }))
      return failure("LOCATION_OCCUPIED");
    if (areaMode(zone) !== "RACK") {
      return failure("POSITION_MODE_MISMATCH", "mode");
    }
    const generated = generateRackPositions({
      area: zoneGeometry(zone),
      fixtureCode: args.fixtureCode,
      bayCount: args.bayCount,
      levelCount: args.levelCount,
      slotsPerBay: args.slotsPerBay,
      bayWidthMm: args.bayWidthMm,
      rackDepthMm: args.rackDepthMm,
      levelHeightMm: args.levelHeightMm,
    });
    if (!generated.ok) {
      return failure(
        generated.error.code,
        "field" in generated.error ? generated.error.field : undefined,
      );
    }
    const positions = await activePositions(ctx, zone);
    if (
      positions.length + generated.value.length >
      STORAGE_POSITION_LIMITS.maximumPositionsPerArea
    ) {
      return failure("POSITION_LIMIT_EXCEEDED");
    }
    const createdIds: string[] = [];
    for (const candidate of generated.value) {
      const code = `${zone.code}-${candidate.codeSuffix}`;
      const created = await createPositionRecords(ctx, {
        zone,
        requestId: `${args.requestId}:${candidate.codeSuffix}`,
        code,
        label: `${candidate.fixtureCode} / Bay ${String(candidate.bayIndex).padStart(2, "0")} / Level ${String(candidate.levelIndex).padStart(2, "0")}${candidate.slotIndex > 1 ? ` / Slot ${String(candidate.slotIndex).padStart(2, "0")}` : ""}`,
        ...candidate,
      });
      if (!created.ok) return failure(created.error.code);
      createdIds.push(created.value.documentId);
    }
    return {
      written: true as const,
      documentId: zone._id,
      replayed: false,
      createdCount: createdIds.length,
      positionIds: createdIds,
    };
  },
});

export const updateStoragePosition = mutationWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    positionId: v.id("storagePositions"),
    requestId: v.string(),
    label: v.string(),
    xMm: v.number(),
    yMm: v.number(),
    widthMm: v.number(),
    depthMm: v.number(),
    confirmOccupiedChange: v.optional(v.boolean()),
  },
  returns: outcome,
  permissionCode: "masterData.storageLayout.manage",
  target: {
    table: "storagePositions",
    id: ({ positionId }) => positionId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const position = await ctx.tenantDb.get<PositionDocument>(
      "storagePositions",
      args.positionId,
    );
    if (
      position === null ||
      position.warehouseId !== args.warehouseId ||
      position.status !== "ACTIVE"
    ) {
      return failure("NOT_FOUND");
    }
    const zone = await ctx.tenantDb.get<ZoneDocument>(
      "storageZones",
      position.zoneId,
    );
    if (zone === null || zone.warehouseId !== args.warehouseId) {
      return failure("NOT_FOUND");
    }
    const building = await ctx.tenantDb.get<BuildingDocument>(
      "storageBuildings",
      zone.buildingId,
    );
    if (
      building === null ||
      building.status === "ARCHIVED" ||
      zone.status !== "ACTIVE"
    )
      return failure("LAYOUT_NOT_EDITABLE");
    const geometryChanged =
      args.xMm !== position.xMm ||
      args.yMm !== position.yMm ||
      args.widthMm !== position.widthMm ||
      args.depthMm !== position.depthMm;
    if (
      geometryChanged &&
      (await hasOccupiedStorage(ctx, { zoneId: zone._id }))
    )
      return failure("LOCATION_OCCUPIED");
    const label = normalizeDisplayName("label", args.label);
    if (!label.ok) return failure(label.error.code, "label");
    const valid = validateStoragePosition({
      mode: areaMode(zone),
      area: zoneGeometry(zone),
      position: {
        kind: position.kind,
        xMm: args.xMm,
        yMm: args.yMm,
        widthMm: args.widthMm,
        depthMm: args.depthMm,
        ...(position.elevationMm === undefined
          ? {}
          : { elevationMm: position.elevationMm }),
      },
    });
    if (!valid.ok) return failure(valid.error.code);
    const updated = await updateMasterDataRow({
      ...writeContext(
        ctx,
        "storagePositions",
        "storageLayout.position.update",
        args.requestId,
        args.warehouseId,
      ),
      documentId: position._id,
      fingerprint: args,
      uniqueness: [],
      patch: {
        label: label.value,
        xMm: args.xMm,
        yMm: args.yMm,
        widthMm: args.widthMm,
        depthMm: args.depthMm,
        updatedAt: Date.now(),
        updatedByUserId: ctx.tenant.actor._id,
      },
    });
    if (!updated.ok) return failure(updated.error.code);
    return {
      written: true as const,
      documentId: position._id,
      replayed: updated.value.replayed,
    };
  },
});

export const archiveStoragePosition = mutationWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    positionId: v.id("storagePositions"),
    requestId: v.string(),
  },
  returns: outcome,
  permissionCode: "masterData.storageLayout.manage",
  target: {
    table: "storagePositions",
    id: ({ positionId }) => positionId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const position = await ctx.tenantDb.get<PositionDocument>(
      "storagePositions",
      args.positionId,
    );
    if (position === null || position.warehouseId !== args.warehouseId) {
      return failure("NOT_FOUND");
    }
    const zone = await ctx.tenantDb.get<ZoneDocument>(
      "storageZones",
      position.zoneId,
    );
    if (zone === null || zone.warehouseId !== args.warehouseId) {
      return failure("NOT_FOUND");
    }
    const building = await ctx.tenantDb.get<BuildingDocument>(
      "storageBuildings",
      zone.buildingId,
    );
    if (
      building === null ||
      building.status === "ARCHIVED" ||
      zone.status !== "ACTIVE"
    )
      return failure("LAYOUT_NOT_EDITABLE");
    if (await hasOccupiedStorage(ctx, { zoneId: zone._id }))
      return failure("LOCATION_OCCUPIED");
    const positions = await activePositions(ctx, zone);
    if (positions.length <= 1) return failure("AREA_REQUIRES_LEAF_POSITION");
    const location = await updateMasterDataRow({
      ...writeContext(
        ctx,
        "locations",
        "storageLayout.position.location.archive",
        args.requestId,
        args.warehouseId,
      ),
      documentId: position.locationId,
      fingerprint: args,
      uniqueness: [],
      patch: { status: "INACTIVE" },
    });
    if (!location.ok) return failure(location.error.code);
    const updated = await updateMasterDataRow({
      ...writeContext(
        ctx,
        "storagePositions",
        "storageLayout.position.archive",
        args.requestId,
        args.warehouseId,
      ),
      documentId: position._id,
      fingerprint: args,
      uniqueness: [],
      patch: {
        status: "INACTIVE",
        updatedAt: Date.now(),
        updatedByUserId: ctx.tenant.actor._id,
      },
    });
    if (!updated.ok) return failure(updated.error.code);
    return {
      written: true as const,
      documentId: position._id,
      replayed: updated.value.replayed,
    };
  },
});

export const backfillStoragePositions = mutationWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    requestId: v.string(),
  },
  returns: outcome,
  permissionCode: "masterData.storageLayout.manage",
  target: { table: "storagePositions" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const zones = await ctx.tenantDb
      .byIndex<ZoneDocument>("storageZones", "by_orgId_warehouseId_code", [
        { field: "warehouseId", value: args.warehouseId },
      ])
      .take(100);
    let createdCount = 0;
    for (const zone of zones) {
      if (areaMode(zone) !== "SIMPLE") continue;
      const before = await ctx.tenantDb
        .byIndex<PositionDocument>("storagePositions", "by_orgId_locationId", [
          { field: "locationId", value: zone.locationId },
        ])
        .unique();
      if (before !== null) continue;
      const created = await ensureDefaultPosition(
        ctx,
        zone,
        `${args.requestId}:${zone._id}`,
      );
      if (created === null) return failure("DEFAULT_POSITION_CREATE_FAILED");
      createdCount += 1;
    }
    return {
      written: true as const,
      documentId: args.warehouseId,
      replayed: createdCount === 0,
      createdCount,
    };
  },
});

function wireResolvedPosition(
  building: BuildingDocument,
  floor: FloorDocument,
  zone: ZoneDocument,
  position: PositionDocument,
) {
  return {
    positionId: position._id,
    locationId: position.locationId,
    code: position.code,
    label: position.label,
    qrValue: position.qrValue,
    kind: position.kind,
    isDefault: position.isDefault,
    ...(position.xMm === undefined ? {} : { xMm: position.xMm }),
    ...(position.yMm === undefined ? {} : { yMm: position.yMm }),
    ...(position.widthMm === undefined ? {} : { widthMm: position.widthMm }),
    ...(position.depthMm === undefined ? {} : { depthMm: position.depthMm }),
    ...(position.fixtureCode === undefined
      ? {}
      : { fixtureCode: position.fixtureCode }),
    ...(position.bayIndex === undefined ? {} : { bayIndex: position.bayIndex }),
    ...(position.levelIndex === undefined
      ? {}
      : { levelIndex: position.levelIndex }),
    ...(position.slotIndex === undefined
      ? {}
      : { slotIndex: position.slotIndex }),
    ...(position.elevationMm === undefined
      ? {}
      : { elevationMm: position.elevationMm }),
    breadcrumb: breadcrumbOf(building, floor, zone, position),
  };
}

export const resolveStorageAddress = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    scan: v.string(),
  },
  returns: v.any(),
  permissionCode: "masterData.storageLayout.read",
  target: { table: "storagePositions" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const zone = await findZoneByScan(ctx, args.warehouseId, args.scan);
    if (zone !== null && zone.status === "ACTIVE") {
      const building = await ctx.tenantDb.get<BuildingDocument>(
        "storageBuildings",
        zone.buildingId,
      );
      const floor = await ctx.tenantDb.get<FloorDocument>(
        "storageFloors",
        zone.floorId,
      );
      if (
        building === null ||
        building.status !== "ACTIVE" ||
        building.warehouseId !== args.warehouseId ||
        floor === null
      ) {
        return { found: false as const };
      }
      const positions = await activePositions(ctx, zone);
      if (positions.length === 0) {
        return {
          found: true as const,
          resolution: "AREA_AUTO" as const,
          area: { zoneId: zone._id, code: zone.code, label: zone.label },
          position: {
            locationId: zone.locationId,
            code: zone.code,
            label: zone.label,
            qrValue: zone.qrValue,
            kind: "DEFAULT" as const,
            isDefault: true,
            xMm: zone.xMm,
            yMm: zone.yMm,
            widthMm: zone.widthMm,
            depthMm: zone.depthMm,
            breadcrumb: `Floor ${floor.floorNumber} › ${zone.label}`,
          },
        };
      }
      const wire = positions.map((position) =>
        wireResolvedPosition(building, floor, zone, position),
      );
      return positions.length === 1
        ? {
            found: true as const,
            resolution: "AREA_AUTO" as const,
            area: { zoneId: zone._id, code: zone.code, label: zone.label },
            position: wire[0],
          }
        : {
            found: true as const,
            resolution: "AREA_NEEDS_POSITION" as const,
            area: { zoneId: zone._id, code: zone.code, label: zone.label },
            positions: wire,
          };
    }

    const position = await findPositionByScan(ctx, args.warehouseId, args.scan);
    if (position === null || position.status !== "ACTIVE") {
      return { found: false as const };
    }
    const exactZone = await ctx.tenantDb.get<ZoneDocument>(
      "storageZones",
      position.zoneId,
    );
    if (exactZone === null || exactZone.status !== "ACTIVE") {
      return { found: false as const };
    }
    const building = await ctx.tenantDb.get<BuildingDocument>(
      "storageBuildings",
      exactZone.buildingId,
    );
    const floor = await ctx.tenantDb.get<FloorDocument>(
      "storageFloors",
      exactZone.floorId,
    );
    if (
      building === null ||
      building.status !== "ACTIVE" ||
      building.warehouseId !== args.warehouseId ||
      floor === null
    ) {
      return { found: false as const };
    }
    return {
      found: true as const,
      resolution: "POSITION" as const,
      area: {
        zoneId: exactZone._id,
        code: exactZone.code,
        label: exactZone.label,
      },
      position: wireResolvedPosition(building, floor, exactZone, position),
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
    const building = await ctx.tenantDb.get<BuildingDocument>(
      "storageBuildings",
      zone.buildingId,
    );
    if (building === null || building.status === "ARCHIVED") {
      return failure("LAYOUT_NOT_EDITABLE");
    }
    if (await hasOccupiedStorage(ctx, { zoneId: zone._id }))
      return failure("LOCATION_OCCUPIED");
    const positions = await activePositions(ctx, zone);
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
    for (const position of positions) {
      if (position.locationId !== zone.locationId) {
        await ctx.tenantDb.patch("locations", position.locationId, {
          status: "INACTIVE",
        });
      }
      await ctx.tenantDb.patch("storagePositions", position._id, {
        status: "INACTIVE",
        updatedAt: now,
        updatedByUserId: ctx.tenant.actor._id,
      });
    }
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
