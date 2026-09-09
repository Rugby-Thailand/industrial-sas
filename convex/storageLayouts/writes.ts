import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import {
  createMasterDataRow,
  normalizeDisplayName,
  normalizeField,
  updateMasterDataRow,
} from "../lib/masterDataStore";
import type { TenantFunctionContext } from "../lib/tenantFunctions";
import { mutationWithOrg } from "../lib/tenantFunctions";
import { refusal, writeContextOf, written } from "../lib/writeEnvelope";
import {
  validateAndSummarizeStorageLayout,
  type StorageFloorInput,
} from "../model/storageLayout/storageLayout";
import { validateStorageZone } from "../model/storageLayout/storageZone";
import { hasOccupiedStorage } from "./catalogue";

const blockValidator = v.object({
  id: v.string(),
  label: v.string(),
  xMm: v.number(),
  yMm: v.number(),
  widthMm: v.number(),
  depthMm: v.number(),
});
const floorValidator = v.object({
  floorNumber: v.number(),
  widthMm: v.optional(v.number()),
  depthMm: v.optional(v.number()),
  heightMm: v.optional(v.number()),
  offsetXMm: v.optional(v.number()),
  offsetYMm: v.optional(v.number()),
  reservedBlocks: v.array(blockValidator),
});
const outcome = v.any();

type BuildingDocument = Doc<"storageBuildings">;
type FloorDocument = Doc<"storageFloors">;
type BlockDocument = Doc<"storageFloorReservedBlocks">;
type ZoneDocument = Doc<"storageZones">;

const failure = (code: string, field?: string) => refusal({ code, field });
const success = (documentId: string, replayed: boolean) =>
  written({ documentId, replayed });
const writeContext = (
  ctx: TenantFunctionContext,
  table: "storageBuildings" | "storageFloors",
  operation: string,
  requestId: string,
  warehouseId: string,
) =>
  writeContextOf(ctx, {
    table,
    operation,
    requestId,
    warehouseId,
  });

async function readLayout(
  ctx: TenantFunctionContext,
  building: BuildingDocument,
): Promise<{ floors: StorageFloorInput[]; documents: FloorDocument[] }> {
  const documents = [
    ...(await ctx.tenantDb
      .byIndex<FloorDocument>(
        "storageFloors",
        "by_orgId_buildingId_floorNumber",
        [{ field: "buildingId", value: building._id }],
      )
      .take(50)),
  ];
  const floors = await Promise.all(
    documents.map(async (floor) => {
      const blocks = await ctx.tenantDb
        .byIndex<BlockDocument>(
          "storageFloorReservedBlocks",
          "by_orgId_floorId",
          [{ field: "floorId", value: floor._id }],
        )
        .take(20);
      return {
        floorNumber: floor.floorNumber,
        ...(floor.widthMm === undefined ? {} : { widthMm: floor.widthMm }),
        ...(floor.depthMm === undefined ? {} : { depthMm: floor.depthMm }),
        ...(floor.heightMm === undefined ? {} : { heightMm: floor.heightMm }),
        ...(floor.offsetXMm === undefined
          ? {}
          : { offsetXMm: floor.offsetXMm }),
        ...(floor.offsetYMm === undefined
          ? {}
          : { offsetYMm: floor.offsetYMm }),
        reservedBlocks: blocks.map((block) => ({
          id: block._id,
          label: block.label,
          xMm: block.xMm,
          yMm: block.yMm,
          widthMm: block.widthMm,
          depthMm: block.depthMm,
        })),
      };
    }),
  );
  return { floors, documents };
}

async function activeZonesForFloor(
  ctx: TenantFunctionContext,
  floorId: string,
): Promise<readonly ZoneDocument[]> {
  return await ctx.tenantDb
    .byIndex<ZoneDocument>("storageZones", "by_orgId_floorId_status_code", [
      { field: "floorId", value: floorId },
      { field: "status", value: "ACTIVE" },
    ])
    .take(50);
}

function validateFloorZones(input: {
  readonly building: BuildingDocument;
  readonly floor: FloorDocument;
  readonly floorInput: StorageFloorInput;
  readonly zones: readonly ZoneDocument[];
}) {
  const floorWidthMm = input.floorInput.widthMm ?? input.building.widthMm;
  const floorDepthMm = input.floorInput.depthMm ?? input.building.depthMm;
  const floorHeightMm =
    input.floorInput.heightMm ?? input.building.defaultFloorHeightMm;

  for (const zone of input.zones) {
    const otherZones: ZoneDocument[] = [];
    for (const candidate of input.zones) {
      if (candidate._id !== zone._id) otherZones.push(candidate);
    }
    const valid = validateStorageZone({
      floorWidthMm,
      floorDepthMm,
      floorHeightMm,
      candidate: zone,
      reserved: input.floorInput.reservedBlocks,
      zones: otherZones,
    });
    if (!valid.ok) return valid;
  }
  return { ok: true as const };
}

export const createStorageBuilding = mutationWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    requestId: v.string(),
    code: v.string(),
    name: v.string(),
    widthMm: v.number(),
    depthMm: v.number(),
    defaultFloorHeightMm: v.number(),
    floorCount: v.number(),
  },
  returns: outcome,
  permissionCode: "masterData.storageLayout.manage",
  target: { table: "storageBuildings" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const code = normalizeField("code", args.code, {
      caseFolding: "UPPERCASE",
      maxLength: 64,
    });
    if (!code.ok)
      return failure(
        code.error.code,
        "field" in code.error ? code.error.field : undefined,
      );
    const name = normalizeDisplayName("name", args.name);
    if (!name.ok)
      return failure(
        name.error.code,
        "field" in name.error ? name.error.field : undefined,
      );
    const floors = Array.from({ length: args.floorCount }, (_, index) => ({
      floorNumber: index + 1,
      reservedBlocks: [],
    }));
    const summary = validateAndSummarizeStorageLayout({
      widthMm: args.widthMm,
      depthMm: args.depthMm,
      defaultFloorHeightMm: args.defaultFloorHeightMm,
      floors,
    });
    if (!summary.ok) return failure(summary.error.code);
    const now = Date.now();
    const created = await createMasterDataRow({
      ...writeContext(
        ctx,
        "storageBuildings",
        "storageLayout.create",
        args.requestId,
        args.warehouseId,
      ),
      fingerprint: args,
      uniqueness: [
        {
          field: "code",
          index: "by_orgId_warehouseId_code",
          equality: [
            { field: "warehouseId", value: args.warehouseId },
            { field: "code", value: code.value },
          ],
        },
      ],
      document: {
        warehouseId: args.warehouseId,
        code: code.value,
        name: name.value,
        widthMm: args.widthMm,
        depthMm: args.depthMm,
        defaultFloorHeightMm: args.defaultFloorHeightMm,
        floorCount: floors.length,
        totalHeightMm: summary.value.totalHeightMm,
        grossAreaSqMm: summary.value.grossAreaSqMm,
        reservedAreaSqMm: summary.value.reservedAreaSqMm,
        usableAreaSqMm: summary.value.usableAreaSqMm,
        status: "DRAFT",
        version: 1,
        createdAt: now,
        createdByUserId: ctx.tenant.actor._id,
        updatedAt: now,
        updatedByUserId: ctx.tenant.actor._id,
      },
    });
    if (!created.ok) return failure(created.error.code);
    if (!created.value.replayed) {
      for (const floor of summary.value.floors) {
        await ctx.tenantDb.insert("storageFloors", {
          buildingId: created.value.documentId,
          warehouseId: args.warehouseId,
          floorNumber: floor.floorNumber,
          grossAreaSqMm: floor.grossAreaSqMm,
          reservedAreaSqMm: floor.reservedAreaSqMm,
          usableAreaSqMm: floor.usableAreaSqMm,
          version: 1,
          updatedAt: now,
          updatedByUserId: ctx.tenant.actor._id,
        });
      }
    }
    return success(created.value.documentId, created.value.replayed);
  },
});

export const updateStorageBuilding = mutationWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    buildingId: v.id("storageBuildings"),
    requestId: v.string(),
    expectedVersion: v.number(),
    name: v.string(),
    widthMm: v.number(),
    depthMm: v.number(),
    defaultFloorHeightMm: v.number(),
  },
  returns: outcome,
  permissionCode: "masterData.storageLayout.manage",
  target: { table: "storageBuildings", id: ({ buildingId }) => buildingId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const building = await ctx.tenantDb.get<BuildingDocument>(
      "storageBuildings",
      args.buildingId,
    );
    if (building === null || building.warehouseId !== args.warehouseId)
      return failure("NOT_FOUND");
    if (building.status === "ARCHIVED") return failure("LAYOUT_NOT_EDITABLE");
    if (building.version !== args.expectedVersion)
      return failure("VERSION_CONFLICT");
    const name = normalizeDisplayName("name", args.name);
    if (!name.ok) return failure(name.error.code, "name");
    if (
      (args.widthMm !== building.widthMm ||
        args.depthMm !== building.depthMm ||
        args.defaultFloorHeightMm !== building.defaultFloorHeightMm) &&
      (await hasOccupiedStorage(ctx, { buildingId: building._id }))
    )
      return failure("LOCATION_OCCUPIED");
    const current = await readLayout(ctx, building);
    const summary = validateAndSummarizeStorageLayout({
      widthMm: args.widthMm,
      depthMm: args.depthMm,
      defaultFloorHeightMm: args.defaultFloorHeightMm,
      floors: current.floors,
    });
    if (!summary.ok) return failure(summary.error.code);
    const proposedBuilding = {
      ...building,
      widthMm: args.widthMm,
      depthMm: args.depthMm,
      defaultFloorHeightMm: args.defaultFloorHeightMm,
    };
    for (const floor of current.documents) {
      const floorInput = current.floors.find(
        (candidate) => candidate.floorNumber === floor.floorNumber,
      );
      if (floorInput === undefined) return failure("NOT_FOUND");
      const zonesValid = validateFloorZones({
        building: proposedBuilding,
        floor,
        floorInput,
        zones: await activeZonesForFloor(ctx, floor._id),
      });
      if (!zonesValid.ok) {
        return failure(
          zonesValid.error.code,
          "field" in zonesValid.error ? zonesValid.error.field : undefined,
        );
      }
    }
    const now = Date.now();
    const updated = await updateMasterDataRow({
      ...writeContext(
        ctx,
        "storageBuildings",
        "storageLayout.updateBuilding",
        args.requestId,
        args.warehouseId,
      ),
      documentId: args.buildingId,
      fingerprint: args,
      uniqueness: [],
      patch: {
        name: name.value,
        widthMm: args.widthMm,
        depthMm: args.depthMm,
        defaultFloorHeightMm: args.defaultFloorHeightMm,
        totalHeightMm: summary.value.totalHeightMm,
        grossAreaSqMm: summary.value.grossAreaSqMm,
        reservedAreaSqMm: summary.value.reservedAreaSqMm,
        usableAreaSqMm: summary.value.usableAreaSqMm,
        version: building.version + 1,
        updatedAt: now,
        updatedByUserId: ctx.tenant.actor._id,
      },
    });
    if (!updated.ok) return failure(updated.error.code);
    if (!updated.value.replayed) {
      for (const floor of current.documents) {
        const floorSummary = summary.value.floors[floor.floorNumber - 1]!;
        await ctx.tenantDb.patch("storageFloors", floor._id, {
          grossAreaSqMm: floorSummary.grossAreaSqMm,
          reservedAreaSqMm: floorSummary.reservedAreaSqMm,
          usableAreaSqMm: floorSummary.usableAreaSqMm,
          version: floor.version + 1,
          updatedAt: now,
          updatedByUserId: ctx.tenant.actor._id,
        });
      }
    }
    return success(updated.value.documentId, updated.value.replayed);
  },
});

export const changeStorageFloorCount = mutationWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    buildingId: v.id("storageBuildings"),
    requestId: v.string(),
    expectedVersion: v.number(),
    floorCount: v.number(),
  },
  returns: outcome,
  permissionCode: "masterData.storageLayout.manage",
  target: { table: "storageBuildings", id: ({ buildingId }) => buildingId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const building = await ctx.tenantDb.get<BuildingDocument>(
      "storageBuildings",
      args.buildingId,
    );
    if (building === null || building.warehouseId !== args.warehouseId)
      return failure("NOT_FOUND");
    if (building.status === "ARCHIVED") return failure("LAYOUT_NOT_EDITABLE");
    if (building.version !== args.expectedVersion)
      return failure("VERSION_CONFLICT");
    if (
      !Number.isSafeInteger(args.floorCount) ||
      args.floorCount <= building.floorCount
    )
      return failure("FLOOR_COUNT_MUST_INCREASE", "floorCount");
    const current = await readLayout(ctx, building);
    const previousFloor = current.floors.at(-1);
    const newFloorWidthMm = previousFloor?.widthMm ?? building.widthMm;
    const newFloorDepthMm = previousFloor?.depthMm ?? building.depthMm;
    const floors = [
      ...current.floors,
      ...Array.from(
        { length: args.floorCount - building.floorCount },
        (_, index) => ({
          floorNumber: building.floorCount + index + 1,
          widthMm: newFloorWidthMm,
          depthMm: newFloorDepthMm,
          reservedBlocks: [],
        }),
      ),
    ];
    const summary = validateAndSummarizeStorageLayout({
      widthMm: building.widthMm,
      depthMm: building.depthMm,
      defaultFloorHeightMm: building.defaultFloorHeightMm,
      floors,
    });
    if (!summary.ok) return failure(summary.error.code);
    const now = Date.now();
    const updated = await updateMasterDataRow({
      ...writeContext(
        ctx,
        "storageBuildings",
        "storageLayout.changeFloorCount",
        args.requestId,
        args.warehouseId,
      ),
      documentId: args.buildingId,
      fingerprint: args,
      uniqueness: [],
      patch: {
        floorCount: args.floorCount,
        totalHeightMm: summary.value.totalHeightMm,
        grossAreaSqMm: summary.value.grossAreaSqMm,
        reservedAreaSqMm: summary.value.reservedAreaSqMm,
        usableAreaSqMm: summary.value.usableAreaSqMm,
        version: building.version + 1,
        updatedAt: now,
        updatedByUserId: ctx.tenant.actor._id,
      },
    });
    if (!updated.ok) return failure(updated.error.code);
    if (!updated.value.replayed) {
      for (
        let floorNumber = building.floorCount + 1;
        floorNumber <= args.floorCount;
        floorNumber += 1
      ) {
        const floorSummary = summary.value.floors[floorNumber - 1]!;
        const floorInput = floors[floorNumber - 1]!;
        await ctx.tenantDb.insert("storageFloors", {
          buildingId: args.buildingId,
          warehouseId: args.warehouseId,
          floorNumber,
          widthMm: floorInput.widthMm,
          depthMm: floorInput.depthMm,
          grossAreaSqMm: floorSummary.grossAreaSqMm,
          reservedAreaSqMm: floorSummary.reservedAreaSqMm,
          usableAreaSqMm: floorSummary.usableAreaSqMm,
          version: 1,
          updatedAt: now,
          updatedByUserId: ctx.tenant.actor._id,
        });
      }
    }
    return success(updated.value.documentId, updated.value.replayed);
  },
});

export const saveStorageFloor = mutationWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    buildingId: v.id("storageBuildings"),
    requestId: v.string(),
    expectedBuildingVersion: v.number(),
    expectedFloorVersion: v.number(),
    floor: floorValidator,
  },
  returns: outcome,
  permissionCode: "masterData.storageLayout.manage",
  target: { table: "storageBuildings", id: ({ buildingId }) => buildingId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const building = await ctx.tenantDb.get<BuildingDocument>(
      "storageBuildings",
      args.buildingId,
    );
    if (building === null || building.warehouseId !== args.warehouseId)
      return failure("NOT_FOUND");
    if (building.status === "ARCHIVED") return failure("LAYOUT_NOT_EDITABLE");
    if (building.version !== args.expectedBuildingVersion)
      return failure("VERSION_CONFLICT");
    const current = await readLayout(ctx, building);
    const floorDocument = current.documents.find(
      (row) => row.floorNumber === args.floor.floorNumber,
    );
    if (floorDocument === undefined) return failure("NOT_FOUND");
    if (floorDocument.version !== args.expectedFloorVersion)
      return failure("VERSION_CONFLICT");
    // A lower floor's elevation and reserved-space changes can affect access to
    // pallets on upper floors too. Require reassignment before structural edits.
    if (await hasOccupiedStorage(ctx, { buildingId: building._id }))
      return failure("LOCATION_OCCUPIED");
    const floors = current.floors.map((floor) =>
      floor.floorNumber === args.floor.floorNumber ? args.floor : floor,
    );
    const summary = validateAndSummarizeStorageLayout({
      widthMm: building.widthMm,
      depthMm: building.depthMm,
      defaultFloorHeightMm: building.defaultFloorHeightMm,
      floors,
    });
    if (!summary.ok) return failure(summary.error.code);
    const zones = await activeZonesForFloor(ctx, floorDocument._id);
    const zonesValid = validateFloorZones({
      building,
      floor: floorDocument,
      floorInput: args.floor,
      zones,
    });
    if (!zonesValid.ok) {
      return failure(
        zonesValid.error.code,
        "field" in zonesValid.error ? zonesValid.error.field : undefined,
      );
    }
    const floorSummary = summary.value.floors[args.floor.floorNumber - 1]!;
    const now = Date.now();
    const updated = await updateMasterDataRow({
      ...writeContext(
        ctx,
        "storageFloors",
        "storageLayout.saveFloor",
        args.requestId,
        args.warehouseId,
      ),
      documentId: floorDocument._id,
      fingerprint: args,
      uniqueness: [],
      patch: {
        ...(args.floor.widthMm === undefined
          ? {}
          : { widthMm: args.floor.widthMm }),
        ...(args.floor.depthMm === undefined
          ? {}
          : { depthMm: args.floor.depthMm }),
        ...(args.floor.heightMm === undefined
          ? {}
          : { heightMm: args.floor.heightMm }),
        ...(args.floor.offsetXMm === undefined
          ? {}
          : { offsetXMm: args.floor.offsetXMm }),
        ...(args.floor.offsetYMm === undefined
          ? {}
          : { offsetYMm: args.floor.offsetYMm }),
        grossAreaSqMm: floorSummary.grossAreaSqMm,
        reservedAreaSqMm: floorSummary.reservedAreaSqMm,
        usableAreaSqMm: floorSummary.usableAreaSqMm,
        version: floorDocument.version + 1,
        updatedAt: now,
        updatedByUserId: ctx.tenant.actor._id,
      },
    });
    if (!updated.ok) return failure(updated.error.code);
    if (!updated.value.replayed) {
      const oldBlocks = await ctx.tenantDb
        .byIndex<BlockDocument>(
          "storageFloorReservedBlocks",
          "by_orgId_floorId",
          [{ field: "floorId", value: floorDocument._id }],
        )
        .take(20);
      for (const oldBlock of oldBlocks)
        await ctx.tenantDb.delete("storageFloorReservedBlocks", oldBlock._id);
      for (const block of args.floor.reservedBlocks) {
        await ctx.tenantDb.insert("storageFloorReservedBlocks", {
          buildingId: args.buildingId,
          floorId: floorDocument._id,
          warehouseId: args.warehouseId,
          label: block.label,
          xMm: block.xMm,
          yMm: block.yMm,
          widthMm: block.widthMm,
          depthMm: block.depthMm,
          createdAt: now,
          updatedAt: now,
        });
      }
      await ctx.tenantDb.patch("storageBuildings", args.buildingId, {
        totalHeightMm: summary.value.totalHeightMm,
        grossAreaSqMm: summary.value.grossAreaSqMm,
        reservedAreaSqMm: summary.value.reservedAreaSqMm,
        usableAreaSqMm: summary.value.usableAreaSqMm,
        version: building.version + 1,
        updatedAt: now,
        updatedByUserId: ctx.tenant.actor._id,
      });
    }
    return success(updated.value.documentId, updated.value.replayed);
  },
});

async function changeStatus(
  ctx: TenantFunctionContext,
  args: {
    warehouseId: string;
    buildingId: string;
    requestId: string;
    expectedVersion: number;
  },
  status: "ACTIVE" | "ARCHIVED",
) {
  const building = await ctx.tenantDb.get<BuildingDocument>(
    "storageBuildings",
    args.buildingId,
  );
  if (building === null || building.warehouseId !== args.warehouseId)
    return failure("NOT_FOUND");
  if (building.version !== args.expectedVersion)
    return failure("VERSION_CONFLICT");
  if (
    status === "ARCHIVED" &&
    (await hasOccupiedStorage(ctx, { buildingId: building._id }))
  )
    return failure("LOCATION_OCCUPIED");
  const layout = await readLayout(ctx, building);
  const zones: ZoneDocument[] = [];
  for (const floor of layout.documents) {
    zones.push(...(await activeZonesForFloor(ctx, floor._id)));
  }
  if (status === "ACTIVE") {
    if (zones.length === 0) return failure("STORAGE_STACK_REQUIRED");
    const validated = validateAndSummarizeStorageLayout({
      widthMm: building.widthMm,
      depthMm: building.depthMm,
      defaultFloorHeightMm: building.defaultFloorHeightMm,
      floors: layout.floors,
    });
    if (!validated.ok) return failure(validated.error.code);
    for (const floor of layout.documents) {
      const floorInput = layout.floors.find(
        (candidate) => candidate.floorNumber === floor.floorNumber,
      );
      if (floorInput === undefined) return failure("NOT_FOUND");
      const floorZones: ZoneDocument[] = [];
      for (const zone of zones) {
        if (zone.floorId === floor._id) floorZones.push(zone);
      }
      const zonesValid = validateFloorZones({
        building,
        floor,
        floorInput,
        zones: floorZones,
      });
      if (!zonesValid.ok) {
        return failure(
          zonesValid.error.code,
          "field" in zonesValid.error ? zonesValid.error.field : undefined,
        );
      }
    }
  }
  const now = Date.now();
  const updated = await updateMasterDataRow({
    ...writeContext(
      ctx,
      "storageBuildings",
      `storageLayout.${status.toLowerCase()}`,
      args.requestId,
      args.warehouseId,
    ),
    documentId: args.buildingId,
    fingerprint: args,
    uniqueness: [],
    patch: {
      status,
      version: building.version + 1,
      updatedAt: now,
      updatedByUserId: ctx.tenant.actor._id,
      ...(status === "ACTIVE"
        ? { activatedAt: now, activatedByUserId: ctx.tenant.actor._id }
        : {}),
    },
  });
  if (!updated.ok) return failure(updated.error.code);
  if (!updated.value.replayed) {
    for (const zone of zones) {
      await ctx.tenantDb.patch("locations", zone.locationId, {
        status: status === "ACTIVE" ? "ACTIVE" : "INACTIVE",
      });
      const positions = await ctx.tenantDb
        .byIndex<Doc<"storagePositions">>(
          "storagePositions",
          "by_orgId_zoneId_status_code",
          [
            { field: "zoneId", value: zone._id },
            { field: "status", value: "ACTIVE" },
          ],
        )
        .all(100);
      for (const position of positions) {
        if (position.locationId !== zone.locationId) {
          await ctx.tenantDb.patch("locations", position.locationId, {
            status: status === "ACTIVE" ? "ACTIVE" : "INACTIVE",
          });
        }
      }
    }
  }
  return success(updated.value.documentId, updated.value.replayed);
}

const statusArgs = {
  warehouseId: v.id("warehouses"),
  buildingId: v.id("storageBuildings"),
  requestId: v.string(),
  expectedVersion: v.number(),
};
export const activateStorageBuilding = mutationWithOrg({
  args: statusArgs,
  returns: outcome,
  permissionCode: "masterData.storageLayout.activate",
  target: { table: "storageBuildings", id: ({ buildingId }) => buildingId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: (ctx, args) => changeStatus(ctx, args, "ACTIVE"),
});
export const archiveStorageBuilding = mutationWithOrg({
  args: statusArgs,
  returns: outcome,
  permissionCode: "masterData.storageLayout.activate",
  target: { table: "storageBuildings", id: ({ buildingId }) => buildingId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: (ctx, args) => changeStatus(ctx, args, "ARCHIVED"),
});
