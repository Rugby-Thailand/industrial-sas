import { normalizeAreaColor } from "../model/storageLayout/areaColor";
import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import {
  createMasterDataRow,
  normalizeDisplayName,
  normalizeField,
  replayTenantWriteIfPresent,
  updateMasterDataRow,
} from "../lib/masterDataStore";
import { TenantDbError } from "../lib/tenantDb";
import type { TenantFunctionContext } from "../lib/tenantFunctions";
import { mutationWithOrg, queryWithOrg } from "../lib/tenantFunctions";
import { refusal, writeContextOf, written } from "../lib/writeEnvelope";
import {
  STORAGE_LAYOUT_LIMITS,
  validateAndSummarizeStorageLayout,
  isStorageFloorColorOnlyChange,
  type StorageFloorInput,
} from "../model/storageLayout/storageLayout";
import {
  STORAGE_ZONE_LIMITS,
  validateStorageZone,
} from "../model/storageLayout/storageZone";
import {
  effectiveStorageAreaMode,
  kindForAreaMode,
  STORAGE_POSITION_LIMITS,
  validateStoragePosition,
} from "../model/storageLayout/storagePosition";
import { hasOccupiedStorage } from "./catalogue";

const blockValidator = v.object({
  areaKind: v.optional(
    v.union(
      v.literal("AISLE"),
      v.literal("PLATFORM"),
      v.literal("STAIRS"),
      v.literal("NO_STORAGE"),
    ),
  ),
  displayHeightMm: v.optional(v.number()),
  id: v.string(),
  label: v.string(),
  color: v.optional(v.string()),
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

/**
 * A retried command with the same request identity answers with its stored
 * result before any expected-version check. Otherwise a write that succeeded
 * but whose response was lost would come back as VERSION_CONFLICT on retry.
 */
async function replayed(
  ctx: TenantFunctionContext,
  table: "storageBuildings" | "storageFloors",
  operation: string,
  args: { readonly requestId: string; readonly warehouseId: string },
) {
  const replay = await replayTenantWriteIfPresent({
    ...writeContext(ctx, table, operation, args.requestId, args.warehouseId),
    fingerprint: args,
  });
  if (!replay.ok) return failure(replay.error.code);
  return replay.value === null
    ? null
    : success(replay.value.documentId, replay.value.replayed);
}

export async function readLayout(
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
      .all(STORAGE_LAYOUT_LIMITS.maximumFloors)),
  ];
  const floors = await Promise.all(
    documents.map(async (floor) => {
      const blocks = await ctx.tenantDb
        .byIndex<BlockDocument>(
          "storageFloorReservedBlocks",
          "by_orgId_floorId",
          [{ field: "floorId", value: floor._id }],
        )
        .all(STORAGE_LAYOUT_LIMITS.maximumReservedBlocksPerFloor);
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
          ...(block.areaKind === undefined ? {} : { areaKind: block.areaKind }),
          ...(block.displayHeightMm === undefined
            ? {}
            : { displayHeightMm: block.displayHeightMm }),
          ...(block.color === undefined ? {} : { color: block.color }),
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
    .all(STORAGE_ZONE_LIMITS.maximumZonesPerFloor);
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
    const replay = await replayed(
      ctx,
      "storageBuildings",
      "storageLayout.updateBuilding",
      args,
    );
    if (replay !== null) return replay;
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
    // Width and depth can safely change while pallets stay put: the proposed
    // floor and zone validation below rejects any envelope that would exclude
    // an existing area. A floor-height change, however, moves the elevation of
    // upper floors, so keep that protected until occupied locations are clear.
    if (
      args.defaultFloorHeightMm !== building.defaultFloorHeightMm &&
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

/** Publish the approved F1/F2 schematic without rewriting operational zones or QR codes. */
export const approveF1F2Schematic = mutationWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    buildingId: v.id("storageBuildings"),
    requestId: v.string(),
    expectedVersion: v.number(),
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
    if (building.code !== "F1-F2-SB" || building.floorCount !== 2)
      return failure("REFERENCE_BUILDING_MISMATCH");
    if (building.status === "ARCHIVED") return failure("LAYOUT_NOT_EDITABLE");
    if (building.version !== args.expectedVersion)
      return failure("VERSION_CONFLICT");
    const floors = await ctx.tenantDb
      .byIndex<FloorDocument>(
        "storageFloors",
        "by_orgId_buildingId_floorNumber",
        [{ field: "buildingId", value: args.buildingId }],
      )
      .all(2);
    if (
      floors.length !== 2 ||
      floors[0]?.floorNumber !== 1 ||
      floors[1]?.floorNumber !== 2
    )
      return failure("REFERENCE_FLOORS_MISMATCH");
    const zoneCounts = await Promise.all(
      floors.map(
        async (floor) =>
          (
            await ctx.tenantDb
              .byIndex<ZoneDocument>(
                "storageZones",
                "by_orgId_floorId_status_code",
                [
                  { field: "floorId", value: floor._id },
                  { field: "status", value: "ACTIVE" },
                ],
              )
              .all(STORAGE_ZONE_LIMITS.maximumZonesPerFloor)
          ).length,
      ),
    );
    if ((zoneCounts[0] ?? 0) < 300 || (zoneCounts[1] ?? 0) < 150)
      return failure("REFERENCE_ZONES_MISMATCH");
    const name = normalizeDisplayName("name", "อาคาร F1 + F2");
    if (!name.ok) return failure(name.error.code, "name");
    const now = Date.now();
    const updated = await updateMasterDataRow({
      ...writeContext(
        ctx,
        "storageBuildings",
        "storageLayout.approveF1F2Schematic",
        args.requestId,
        args.warehouseId,
      ),
      documentId: args.buildingId,
      fingerprint: args,
      uniqueness: [],
      patch: {
        name: name.value,
        approvedSchematic: {
          revision: "f1-f2-2026-09-25",
          sourcePages: [3, 4],
          blueBayCodes: ["F2-S01", "F2-S02", "F2-S03", "F2-S04"],
          floor1ZoneCount: zoneCounts[0]!,
          floor2ZoneCount: zoneCounts[1]!,
          approvedAt: now,
        },
        version: building.version + 1,
        updatedAt: now,
        updatedByUserId: ctx.tenant.actor._id,
      },
    });
    if (!updated.ok) return failure(updated.error.code);
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
    const replay = await replayed(
      ctx,
      "storageBuildings",
      "storageLayout.changeFloorCount",
      args,
    );
    if (replay !== null) return replay;
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
    const replay = await replayed(
      ctx,
      "storageFloors",
      "storageLayout.saveFloor",
      args,
    );
    if (replay !== null) return replay;
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
    // Occupancy protects structure; color-only edits do not affect placement.
    const previousSummary = validateAndSummarizeStorageLayout({
      widthMm: building.widthMm,
      depthMm: building.depthMm,
      defaultFloorHeightMm: building.defaultFloorHeightMm,
      floors: current.floors,
    });
    const previousFloor = current.floors.find(
      (floor) => floor.floorNumber === args.floor.floorNumber,
    )!;
    const colorOnly =
      previousSummary.ok &&
      isStorageFloorColorOnlyChange(
        previousFloor,
        args.floor,
        previousSummary.value.floors[args.floor.floorNumber - 1]!,
        summary.value.floors[args.floor.floorNumber - 1]!,
      );
    if (
      !colorOnly &&
      (await hasOccupiedStorage(ctx, { buildingId: building._id }))
    )
      return failure("LOCATION_OCCUPIED");
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
        // Missing overrides mean inherit the building defaults. Explicit
        // undefined values remove previous optional fields in a Convex patch.
        widthMm: args.floor.widthMm,
        depthMm: args.floor.depthMm,
        heightMm: args.floor.heightMm,
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
        .all(STORAGE_LAYOUT_LIMITS.maximumReservedBlocksPerFloor);
      for (const oldBlock of oldBlocks)
        await ctx.tenantDb.delete("storageFloorReservedBlocks", oldBlock._id);
      for (const block of args.floor.reservedBlocks) {
        await ctx.tenantDb.insert("storageFloorReservedBlocks", {
          buildingId: args.buildingId,
          floorId: floorDocument._id,
          warehouseId: args.warehouseId,
          label: block.label,
          ...(block.areaKind === undefined ? {} : { areaKind: block.areaKind }),
          ...(block.displayHeightMm === undefined
            ? {}
            : { displayHeightMm: block.displayHeightMm }),
          ...(block.color === undefined
            ? {}
            : { color: normalizeAreaColor(block.color) }),
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

export interface LayoutReadinessIssue {
  readonly code: string;
  /** Blocking issues refuse activation; others are advisory. */
  readonly blocking: boolean;
  readonly floorNumber?: number;
  readonly zoneCode?: string;
  readonly zoneLabel?: string;
  readonly field?: string;
}

/**
 * The one activation preflight. The activate mutation refuses with the first
 * blocking issue; the review screen reads every issue through
 * `layoutReadiness`, so "ready" there always means the same server checks.
 */
export async function assessLayoutReadiness(
  ctx: TenantFunctionContext,
  building: BuildingDocument,
) {
  const layout = await readLayout(ctx, building);
  const issues: LayoutReadinessIssue[] = [];
  const zonesByFloor = new Map<string, ZoneDocument[]>();
  let zoneCount = 0;
  for (const floor of layout.documents) {
    const zones = [...(await activeZonesForFloor(ctx, floor._id))];
    zonesByFloor.set(floor._id, zones);
    zoneCount += zones.length;
  }
  if (zoneCount === 0)
    issues.push({ code: "STORAGE_STACK_REQUIRED", blocking: true });
  const validated = validateAndSummarizeStorageLayout({
    widthMm: building.widthMm,
    depthMm: building.depthMm,
    defaultFloorHeightMm: building.defaultFloorHeightMm,
    floors: layout.floors,
  });
  if (!validated.ok)
    issues.push({ code: validated.error.code, blocking: true });
  for (const floor of layout.documents) {
    const floorInput = layout.floors.find(
      (candidate) => candidate.floorNumber === floor.floorNumber,
    );
    const zones = zonesByFloor.get(floor._id) ?? [];
    if (floorInput === undefined) {
      issues.push({
        code: "NOT_FOUND",
        blocking: true,
        floorNumber: floor.floorNumber,
      });
      continue;
    }
    if (zones.length === 0)
      issues.push({
        code: "FLOOR_HAS_NO_STORAGE",
        blocking: false,
        floorNumber: floor.floorNumber,
      });
    const floorWidthMm = floorInput.widthMm ?? building.widthMm;
    const floorDepthMm = floorInput.depthMm ?? building.depthMm;
    const floorHeightMm = floorInput.heightMm ?? building.defaultFloorHeightMm;
    for (const zone of zones) {
      const valid = validateStorageZone({
        floorWidthMm,
        floorDepthMm,
        floorHeightMm,
        candidate: zone,
        reserved: floorInput.reservedBlocks,
        zones: zones.filter((candidate) => candidate._id !== zone._id),
      });
      const where = {
        floorNumber: floor.floorNumber,
        zoneCode: zone.code,
        zoneLabel: zone.label,
      };
      if (!valid.ok)
        issues.push({
          code: valid.error.code,
          blocking: true,
          ...where,
          ...("field" in valid.error ? { field: valid.error.field } : {}),
        });
      const mode = effectiveStorageAreaMode(zone.mode);
      if (
        mode === "PLATFORM" &&
        (!Number.isSafeInteger(zone.baseElevationMm) ||
          (zone.baseElevationMm ?? -1) < 0 ||
          (zone.baseElevationMm ?? 0) + zone.maxStackHeightMm > floorHeightMm)
      )
        issues.push({
          code: "BASE_ELEVATION_INVALID",
          blocking: true,
          ...where,
        });
      let positions: readonly Doc<"storagePositions">[];
      try {
        positions = await ctx.tenantDb
          .byIndex<Doc<"storagePositions">>(
            "storagePositions",
            "by_orgId_zoneId_status_code",
            [
              { field: "zoneId", value: zone._id },
              { field: "status", value: "ACTIVE" },
            ],
          )
          .all(STORAGE_POSITION_LIMITS.maximumPositionsPerArea);
      } catch (error) {
        if (
          !(error instanceof TenantDbError) ||
          error.code !== "CAPACITY_DATA_LIMIT"
        )
          throw error;
        issues.push({
          code: "POSITION_LIMIT_EXCEEDED",
          blocking: true,
          ...where,
        });
        continue;
      }
      if (
        mode !== "SIMPLE" &&
        !positions.some((position) => !position.isDefault)
      )
        issues.push({
          code: "AREA_REQUIRES_LEAF_POSITION",
          blocking: true,
          ...where,
        });
      for (const position of positions) {
        if (
          position.kind !== kindForAreaMode(mode) ||
          (mode !== "SIMPLE" && position.isDefault)
        ) {
          issues.push({
            code: "POSITION_MODE_MISMATCH",
            blocking: true,
            ...where,
          });
          continue;
        }
        const leaf = validateStoragePosition({
          mode,
          area: zone,
          position: {
            kind: position.kind,
            xMm: position.xMm ?? NaN,
            yMm: position.yMm ?? NaN,
            widthMm: position.widthMm ?? NaN,
            depthMm: position.depthMm ?? NaN,
            ...(position.elevationMm === undefined
              ? {}
              : { elevationMm: position.elevationMm }),
          },
        });
        if (!leaf.ok)
          issues.push({
            code: leaf.error.code,
            blocking: true,
            ...where,
            ...("field" in leaf.error ? { field: leaf.error.field } : {}),
          });
      }
    }
  }
  return {
    layout,
    zones: [...zonesByFloor.values()].flat(),
    zoneCount,
    issues,
  };
}

async function changeStatus(
  ctx: TenantFunctionContext,
  args: {
    warehouseId: string;
    buildingId: string;
    requestId: string;
    expectedVersion: number;
  },
  status: "DRAFT" | "ACTIVE" | "ARCHIVED",
) {
  const operation = `storageLayout.${status.toLowerCase()}`;
  const replay = await replayed(ctx, "storageBuildings", operation, args);
  if (replay !== null) return replay;
  const building = await ctx.tenantDb.get<BuildingDocument>(
    "storageBuildings",
    args.buildingId,
  );
  if (building === null || building.warehouseId !== args.warehouseId)
    return failure("NOT_FOUND");
  if (building.version !== args.expectedVersion)
    return failure("VERSION_CONFLICT");
  // Lifecycle: DRAFT → ACTIVE ⇄ DRAFT; DRAFT/ACTIVE → ARCHIVED; an archived
  // building is restored only by activation, which reruns the full preflight.
  // Archiving twice or drafting an archived building is not a change.
  if (status === building.status) return failure("LAYOUT_NOT_EDITABLE");
  if (status === "DRAFT" && building.status !== "ACTIVE")
    return failure("LAYOUT_NOT_EDITABLE");
  if (
    status !== "ACTIVE" &&
    (await hasOccupiedStorage(ctx, { buildingId: building._id }))
  )
    return failure("LOCATION_OCCUPIED");
  const assessment = await assessLayoutReadiness(ctx, building);
  const zones = assessment.zones;
  if (status === "ACTIVE") {
    const blocking = assessment.issues.find((issue) => issue.blocking);
    if (blocking !== undefined) return failure(blocking.code, blocking.field);
  }
  const now = Date.now();
  const updated = await updateMasterDataRow({
    ...writeContext(
      ctx,
      "storageBuildings",
      operation,
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

export const returnStorageBuildingToDraft = mutationWithOrg({
  args: statusArgs,
  returns: outcome,
  permissionCode: "masterData.storageLayout.activate",
  target: { table: "storageBuildings", id: ({ buildingId }) => buildingId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: (ctx, args) => changeStatus(ctx, args, "DRAFT"),
});

const buildingArgs = {
  warehouseId: v.id("warehouses"),
  buildingId: v.id("storageBuildings"),
};

/** Server preflight for the review screen: every activation check, per floor and spot. */
export const layoutReadiness = queryWithOrg({
  args: buildingArgs,
  returns: v.any(),
  permissionCode: "masterData.storageLayout.read",
  target: { table: "storageBuildings", id: ({ buildingId }) => buildingId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const building = await ctx.tenantDb.get<BuildingDocument>(
      "storageBuildings",
      args.buildingId,
    );
    if (building === null || building.warehouseId !== args.warehouseId)
      return { found: false as const };
    const assessment = await assessLayoutReadiness(ctx, building);
    return {
      found: true as const,
      status: building.status,
      version: building.version,
      zoneCount: assessment.zoneCount,
      ready:
        building.status !== "ACTIVE" &&
        !assessment.issues.some((issue) => issue.blocking),
      issues: assessment.issues,
    };
  },
});

const NAMED_REGISTRATION_LIMIT = 1000;

/** Only this building's active name registrations, bounded with an explicit lower-bound count. */
async function namedRegistrations(
  ctx: TenantFunctionContext,
  warehouseId: string,
  buildingId: string,
) {
  try {
    const rows = await ctx.tenantDb
      .byIndex<Doc<"locations">>(
        "locations",
        "by_orgId_buildingId_status_locationType_code",
        [
          { field: "buildingId", value: buildingId },
          { field: "status", value: "ACTIVE" },
          { field: "locationType", value: "NAMED_STORAGE" },
        ],
      )
      .all(NAMED_REGISTRATION_LIMIT);
    return {
      count: rows.filter((row) => row.warehouseId === warehouseId).length,
      complete: true,
    };
  } catch (error) {
    if (
      !(error instanceof TenantDbError) ||
      error.code !== "CAPACITY_DATA_LIMIT"
    )
      throw error;
    // Scoped batch overflow proves a lower bound; it never invents a full count.
    return { count: NAMED_REGISTRATION_LIMIT, complete: false };
  }
}

/**
 * What a whole-building status change or archive affects, read only when a
 * manager opens the confirmation. Counts are of this building's addresses.
 */
export const buildingLifecycleImpact = queryWithOrg({
  args: buildingArgs,
  returns: v.any(),
  permissionCode: "masterData.storageLayout.read",
  target: { table: "storageBuildings", id: ({ buildingId }) => buildingId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const building = await ctx.tenantDb.get<BuildingDocument>(
      "storageBuildings",
      args.buildingId,
    );
    if (building === null || building.warehouseId !== args.warehouseId)
      return { found: false as const };
    const layout = await readLayout(ctx, building);
    let zoneCount = 0;
    let positionCount = 0;
    for (const floor of layout.documents) {
      const zones = await activeZonesForFloor(ctx, floor._id);
      zoneCount += zones.length;
      for (const zone of zones) {
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
        positionCount += positions.filter(
          (position) => position.locationId !== zone.locationId,
        ).length;
      }
    }
    const named = await namedRegistrations(ctx, args.warehouseId, building._id);
    return {
      found: true as const,
      status: building.status,
      version: building.version,
      floorCount: building.floorCount,
      zoneCount,
      positionCount,
      namedRegistrationCount: named.count,
      namedRegistrationCountComplete: named.complete,
      occupied: await hasOccupiedStorage(ctx, { buildingId: building._id }),
    };
  },
});

/**
 * Remove the top floor only when it is provably empty: no storage spot ever
 * created on it (active or archived, so no address history is orphaned) and
 * no registered location naming it. Its unavailable areas are floor geometry
 * and are removed with it. Lower floors and every identity stay untouched.
 */
export const removeTopStorageFloor = mutationWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    buildingId: v.id("storageBuildings"),
    requestId: v.string(),
    expectedVersion: v.number(),
    floorNumber: v.number(),
  },
  returns: outcome,
  permissionCode: "masterData.storageLayout.manage",
  target: { table: "storageBuildings", id: ({ buildingId }) => buildingId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const operation = "storageLayout.removeTopFloor";
    const replay = await replayed(ctx, "storageBuildings", operation, args);
    if (replay !== null) return replay;
    const building = await ctx.tenantDb.get<BuildingDocument>(
      "storageBuildings",
      args.buildingId,
    );
    if (building === null || building.warehouseId !== args.warehouseId)
      return failure("NOT_FOUND");
    if (building.status === "ARCHIVED") return failure("LAYOUT_NOT_EDITABLE");
    if (building.version !== args.expectedVersion)
      return failure("VERSION_CONFLICT");
    if (args.floorNumber !== building.floorCount)
      return failure("FLOOR_NOT_TOP", "floorNumber");
    if (building.floorCount <= 1)
      return failure("FLOOR_COUNT_MINIMUM", "floorNumber");
    const current = await readLayout(ctx, building);
    const floor = current.documents.find(
      (row) => row.floorNumber === args.floorNumber,
    );
    if (floor === undefined) return failure("NOT_FOUND");
    const anyZone = await ctx.tenantDb
      .byIndex<ZoneDocument>("storageZones", "by_orgId_floorId_status_code", [
        { field: "floorId", value: floor._id },
      ])
      .first();
    if (anyZone !== null) return failure("FLOOR_NOT_EMPTY");
    const referencedLocation = await ctx.tenantDb
      .byIndex<Doc<"locations">>("locations", "by_orgId_floorId", [
        { field: "floorId", value: floor._id },
      ])
      .first();
    if (referencedLocation !== null) return failure("FLOOR_HAS_REGISTRATIONS");
    const floors = current.floors.filter(
      (row) => row.floorNumber !== args.floorNumber,
    );
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
        operation,
        args.requestId,
        args.warehouseId,
      ),
      documentId: args.buildingId,
      fingerprint: args,
      uniqueness: [],
      patch: {
        floorCount: building.floorCount - 1,
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
    const blocks = await ctx.tenantDb
      .byIndex<BlockDocument>(
        "storageFloorReservedBlocks",
        "by_orgId_floorId",
        [{ field: "floorId", value: floor._id }],
      )
      .all(STORAGE_LAYOUT_LIMITS.maximumReservedBlocksPerFloor);
    for (const block of blocks)
      await ctx.tenantDb.delete("storageFloorReservedBlocks", block._id);
    await ctx.tenantDb.delete("storageFloors", floor._id);
    return success(updated.value.documentId, updated.value.replayed);
  },
});
