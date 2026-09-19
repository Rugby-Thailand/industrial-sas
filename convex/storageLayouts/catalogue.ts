import { summaryReadiness } from "../lib/finishedGoodsSummary";
import { isGeometricPlacement } from "../model/finishedGoods/scanning";
import {
  paginatedScan,
  remainingScanCapacity,
} from "../lib/cataloguePagination";
import { storageFootprintUsage } from "../model/storageLayout/areaUsage";
import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import {
  queryWithOrg,
  type TenantFunctionContext,
} from "../lib/tenantFunctions";
import { storageLayoutStatus } from "../lib/validators";
import { effectiveStorageAreaMode } from "../model/storageLayout/storagePosition";
import { occupiedFootprintAreaSqMm } from "../model/storageLayout/occupancy";
import { readMoveOccupancy, type MoveOccupancy } from "./moveOccupancy";

type BuildingDocument = Doc<"storageBuildings">;
type FloorDocument = Doc<"storageFloors">;
type BlockDocument = Doc<"storageFloorReservedBlocks">;
type ZoneDocument = Doc<"storageZones">;
type PositionDocument = Doc<"storagePositions">;
type PlacementDocument = Doc<"finishedGoodsPlacements">;

// Presence checks intentionally use first(): every held or stored pallet blocks
// structural changes, regardless of how many other pallets exist in the scope.
export async function hasOccupiedStorage(
  ctx: TenantFunctionContext,
  scope: { readonly buildingId: string } | { readonly zoneId: string },
): Promise<boolean> {
  const field = "zoneId" in scope ? "zoneId" : "buildingId";
  const id = "zoneId" in scope ? scope.zoneId : scope.buildingId;
  for (const status of ["RESERVED", "STORED"] as const) {
    const found = await ctx.tenantDb
      .byIndex<PlacementDocument>(
        "finishedGoodsPlacements",
        `by_orgId_${field}_status`,
        [
          { field, value: id },
          { field: "status", value: status },
        ],
      )
      .first();
    if (found !== null) return true;
  }
  return false;
}

async function readZonePlacements(
  ctx: TenantFunctionContext,
  zone: ZoneDocument,
  moves: ReadonlyMap<string, MoveOccupancy>,
) {
  const rows = (
    await Promise.all(
      ["RESERVED", "STORED"].map(
        async (status) =>
          await ctx.tenantDb
            .byIndex<PlacementDocument>(
              "finishedGoodsPlacements",
              "by_orgId_zoneId_status",
              [
                { field: "zoneId", value: zone._id },
                { field: "status", value: status },
              ],
            )
            .all(10_000),
      ),
    )
  ).flat();
  return await Promise.all(
    rows.map(async (placement) => {
      const pallet = await ctx.tenantDb.get<Doc<"finishedGoodsPallets">>(
        "finishedGoodsPallets",
        placement.palletId,
      );
      const product = pallet
        ? await ctx.tenantDb.get<Doc<"finishedGoodsProducts">>(
            "finishedGoodsProducts",
            pallet.productId,
          )
        : null;
      if (!isGeometricPlacement(placement))
        return {
          mode: "LOCATION_ONLY" as const,
          placementId: placement._id,
          handlingUnitId: placement.palletId,
          lpn: pallet?.code ?? placement.positionCode,
          assignmentId: placement.assignmentId,
          sequence: placement.sequence,
          positionCode: placement.positionCode,
          positionId: placement.supportPositionId,
          productName: product?.name,
          quantity: pallet?.quantity,
          status: placement.status,
        };
      return {
        mode: "GEOMETRIC" as const,
        ...(product
          ? {
              productName: product.name,
              productSku: product.sku,
              unit: product.unit,
            }
          : {}),
        ...(pallet ? { quantity: pallet.quantity } : {}),
        placementId: placement._id,
        handlingUnitId: placement.palletId,
        lpn: pallet?.code ?? placement.positionCode,
        levelIndex: 1,
        xMm: placement.xMm,
        yMm: placement.yMm,
        zMm: placement.zMm,
        widthMm: placement.widthMm,
        depthMm: placement.depthMm,
        heightMm: placement.heightMm,
        status:
          placement.status === "RESERVED"
            ? ("RESERVED" as const)
            : ("STORED" as const),
        orientation:
          placement.rotation === 90
            ? ("ROTATED" as const)
            : ("DEFAULT" as const),
        placedAt: placement.updatedAt,
        ...(placement.supportPositionId
          ? { positionId: placement.supportPositionId }
          : {}),
        positionCode: placement.positionCode,
        ...moves.get(placement._id),
      };
    }),
  );
}

const buildingArgs = {
  warehouseId: v.id("warehouses"),
  buildingId: v.id("storageBuildings"),
};

async function resolveZone(ctx: TenantFunctionContext, zone: ZoneDocument) {
  const floor = await ctx.tenantDb.get<FloorDocument>(
    "storageFloors",
    zone.floorId,
  );
  if (floor === null) throw new Error("Storage zone floor is missing");
  const resolvedFloor = await readFloor(ctx, floor);
  const resolvedZone = resolvedFloor.storageZones.find(
    (candidate) => candidate.zoneId === zone._id,
  );
  if (resolvedZone === undefined)
    throw new Error("Active storage zone could not be resolved");
  return resolvedZone;
}

async function readFloor(
  ctx: TenantFunctionContext,
  floor: FloorDocument,
  knownMoves?: ReadonlyMap<string, MoveOccupancy>,
) {
  const moves = knownMoves ?? (await readMoveOccupancy(ctx, floor.warehouseId));
  const blocks = await ctx.tenantDb
    .byIndex<BlockDocument>("storageFloorReservedBlocks", "by_orgId_floorId", [
      { field: "floorId", value: floor._id },
    ])
    .all(20);
  const zones = await ctx.tenantDb
    .byIndex<ZoneDocument>("storageZones", "by_orgId_floorId_status_code", [
      { field: "floorId", value: floor._id },
      { field: "status", value: "ACTIVE" },
    ])
    .all(50);
  const storageZones = await Promise.all(
    zones.map(async (zone) => {
      const allPlacements = await readZonePlacements(ctx, zone, moves);
      const placements = allPlacements.filter((p) => p.mode === "GEOMETRIC");
      const locationOnlyPlacements = allPlacements.filter(
        (p) => p.mode === "LOCATION_ONLY",
      );
      const storedPositions = await ctx.tenantDb
        .byIndex<PositionDocument>(
          "storagePositions",
          "by_orgId_zoneId_status_code",
          [
            { field: "zoneId", value: zone._id },
            { field: "status", value: "ACTIVE" },
          ],
        )
        .all(100);
      const positions =
        storedPositions.length === 0 &&
        effectiveStorageAreaMode(zone.mode) === "SIMPLE"
          ? [
              {
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
              },
            ]
          : storedPositions;
      const resolvedPositions = await Promise.all(
        positions.map(async (position) => {
          const positionId = "_id" in position ? position._id : undefined;
          const fixture =
            "fixtureCode" in position ? position.fixtureCode : undefined;
          const bay = "bayIndex" in position ? position.bayIndex : undefined;
          const level =
            "levelIndex" in position ? position.levelIndex : undefined;
          const slot = "slotIndex" in position ? position.slotIndex : undefined;
          const breadcrumb =
            position.kind === "RACK_SLOT"
              ? `Floor ${floor.floorNumber} › ${zone.label} › ${fixture ?? "Rack"} › Bay ${String(bay ?? 0).padStart(2, "0")} › Level ${String(level ?? 0).padStart(2, "0")}${(slot ?? 1) > 1 ? ` › Slot ${String(slot).padStart(2, "0")}` : ""}`
              : `Floor ${floor.floorNumber} › ${zone.label}${position.isDefault ? "" : ` › ${position.label}`}`;
          return {
            ...(positionId === undefined ? {} : { positionId }),
            locationId: position.locationId,
            code: position.code,
            label: position.label,
            qrValue: position.qrValue,
            kind: position.kind,
            isDefault: position.isDefault,
            ...(position.xMm === undefined ? {} : { xMm: position.xMm }),
            ...(position.yMm === undefined ? {} : { yMm: position.yMm }),
            ...(position.widthMm === undefined
              ? {}
              : { widthMm: position.widthMm }),
            ...(position.depthMm === undefined
              ? {}
              : { depthMm: position.depthMm }),
            ...(fixture === undefined ? {} : { fixtureCode: fixture }),
            ...(bay === undefined ? {} : { bayIndex: bay }),
            ...(level === undefined ? {} : { levelIndex: level }),
            ...(slot === undefined ? {} : { slotIndex: slot }),
            ...("elevationMm" in position && position.elevationMm !== undefined
              ? { elevationMm: position.elevationMm }
              : {}),
            breadcrumb,
            placements: placements.filter(
              (placement) =>
                placement.positionId === positionId ||
                (position.isDefault && placement.positionId === undefined),
            ),
          };
        }),
      );
      return {
        zoneId: zone._id,
        locationId: zone.locationId,
        code: zone.code,
        label: zone.label,
        qrValue: zone.qrValue,
        mode: effectiveStorageAreaMode(zone.mode),
        ...(zone.storageCondition === undefined
          ? {}
          : { storageCondition: zone.storageCondition }),
        ...(zone.baseElevationMm === undefined
          ? {}
          : { baseElevationMm: zone.baseElevationMm }),
        xMm: zone.xMm,
        yMm: zone.yMm,
        widthMm: zone.widthMm,
        depthMm: zone.depthMm,
        maxStackHeightMm: zone.maxStackHeightMm,
        positions: resolvedPositions,
        placements,
        locationOnlyPlacements,
        unmeasuredPalletCount: locationOnlyPlacements.length,
        measuredAreaPartial: locationOnlyPlacements.length > 0,
        palletCount: new Set(allPlacements.map((p) => p.handlingUnitId)).size,
        occupiedFootprintAreaSqMm: occupiedFootprintAreaSqMm(placements),
      };
    }),
  );
  return {
    floorId: floor._id,
    floorNumber: floor.floorNumber,
    ...(floor.widthMm === undefined ? {} : { widthMm: floor.widthMm }),
    ...(floor.depthMm === undefined ? {} : { depthMm: floor.depthMm }),
    ...(floor.heightMm === undefined ? {} : { heightMm: floor.heightMm }),
    ...(floor.offsetXMm === undefined ? {} : { offsetXMm: floor.offsetXMm }),
    ...(floor.offsetYMm === undefined ? {} : { offsetYMm: floor.offsetYMm }),
    grossAreaSqMm: floor.grossAreaSqMm,
    reservedAreaSqMm: floor.reservedAreaSqMm,
    usableAreaSqMm: floor.usableAreaSqMm,
    version: floor.version,
    storageZones,
    reservedBlocks: blocks.map((block) => ({
      blockId: block._id,
      label: block.label,
      ...(block.color === undefined ? {} : { color: block.color }),
      xMm: block.xMm,
      yMm: block.yMm,
      widthMm: block.widthMm,
      depthMm: block.depthMm,
    })),
  };
}

async function buildingWithOccupancy(
  ctx: TenantFunctionContext,
  row: BuildingDocument,
) {
  const placements = (
    await Promise.all(
      (["STORED", "RESERVED"] as const).map((status) =>
        ctx.tenantDb
          .byIndex<PlacementDocument>(
            "finishedGoodsPlacements",
            "by_orgId_buildingId_status",
            [
              { field: "buildingId", value: row._id },
              { field: "status", value: status },
            ],
          )
          .all(10_000),
      ),
    )
  ).flat();
  const zones = new Map<string, PlacementDocument[]>();
  for (const placement of placements) {
    const group = zones.get(placement.zoneId) ?? [];
    group.push(placement);
    zones.set(placement.zoneId, group);
  }
  return {
    ...row,
    buildingId: row._id,
    unmeasuredPalletCount: placements.filter((p) => !isGeometricPlacement(p))
      .length,
    measuredAreaPartial: placements.some((p) => !isGeometricPlacement(p)),
    ...storageFootprintUsage(
      [...zones.values()].map((placements) => ({
        placements: placements.filter(isGeometricPlacement),
      })),
    ),
  };
}

export const listStorageBuildings = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    status: v.optional(storageLayoutStatus),
  },
  returns: v.any(),
  permissionCode: "masterData.storageLayout.read",
  target: { table: "storageBuildings" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const rows = await ctx.tenantDb
      .byIndex<BuildingDocument>(
        "storageBuildings",
        args.status === undefined
          ? "by_orgId_warehouseId_code"
          : "by_orgId_warehouseId_status_code",
        args.status === undefined
          ? [{ field: "warehouseId", value: args.warehouseId }]
          : [
              { field: "warehouseId", value: args.warehouseId },
              { field: "status", value: args.status },
            ],
      )
      .all(100);
    return await Promise.all(
      rows.map((row) => buildingWithOccupancy(ctx, row)),
    );
  },
});

export const listStorageBuildingsPage = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    status: v.optional(storageLayoutStatus),
    search: v.optional(v.string()),
    pageSize: v.number(),
    cursor: v.optional(v.string()),
    scanCursor: v.optional(v.string()),
  },
  returns: v.any(),
  permissionCode: "masterData.storageLayout.read",
  target: { table: "storageBuildings" },
  warehouseId: (args) => args.warehouseId,
  handler: async (ctx, args) => {
    const { cursor, scanCursor, pageSize, ...criteria } = args;
    const needle = (args.search ?? "").trim().toLocaleLowerCase();
    const result = await paginatedScan(ctx, {
      generation:
        (await summaryReadiness(ctx.tenantDb, args.warehouseId))?.generation ??
        0,
      scope: { entity: "buildings", ...criteria },
      pageSize,
      ...(cursor ? { cursor } : {}),
      ...(scanCursor ? { scanCursor } : {}),
      read: (rawCursor, endCursor?: string) =>
        ctx.tenantDb
          .byIndex<BuildingDocument>(
            "storageBuildings",
            args.status
              ? "by_orgId_warehouseId_status_code"
              : "by_orgId_warehouseId_code",
            [
              { field: "warehouseId", value: args.warehouseId },
              ...(args.status ? [{ field: "status", value: args.status }] : []),
            ],
          )
          .page({
            limit: remainingScanCapacity(scanCursor, pageSize),
            ...(rawCursor ? { cursor: rawCursor } : {}),
            ...(endCursor ? { endCursor } : {}),
          }),
      get: (id) => ctx.tenantDb.get<BuildingDocument>("storageBuildings", id),
      hydrate: async (row) => row,
      matches: (row) =>
        row.warehouseId === args.warehouseId &&
        (!args.status || row.status === args.status) &&
        (!needle ||
          row.code.toLocaleLowerCase().includes(needle) ||
          row.name.toLocaleLowerCase().includes(needle)),
    });
    return {
      ...result,
      page: result.page.map((row) => ({ ...row, buildingId: row._id })),
    };
  },
});

export const buildingOccupancy = queryWithOrg({
  args: buildingArgs,
  returns: v.any(),
  permissionCode: "masterData.storageLayout.read",
  target: { table: "storageBuildings", id: (args) => args.buildingId },
  warehouseId: (args) => args.warehouseId,
  handler: async (ctx, args) => {
    const building = await ctx.tenantDb.get<BuildingDocument>(
      "storageBuildings",
      args.buildingId,
    );
    return building?.warehouseId === args.warehouseId
      ? buildingWithOccupancy(ctx, building)
      : null;
  },
});

export const getStorageBuilding = queryWithOrg({
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
    if (building === null || building.warehouseId !== args.warehouseId) {
      return { found: false as const };
    }
    const floors = await ctx.tenantDb
      .byIndex<FloorDocument>(
        "storageFloors",
        "by_orgId_buildingId_floorNumber",
        [{ field: "buildingId", value: args.buildingId }],
      )
      .all(50);
    const moves = await readMoveOccupancy(ctx, args.warehouseId);
    return {
      found: true as const,
      building: { ...building, buildingId: building._id },
      floors: await Promise.all(
        floors.map((floor) => readFloor(ctx, floor, moves)),
      ),
    };
  },
});

export const getStorageFloor = queryWithOrg({
  args: { ...buildingArgs, floorNumber: v.number() },
  returns: v.any(),
  permissionCode: "masterData.storageLayout.read",
  target: { table: "storageBuildings", id: ({ buildingId }) => buildingId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const building = await ctx.tenantDb.get<BuildingDocument>(
      "storageBuildings",
      args.buildingId,
    );
    if (building === null || building.warehouseId !== args.warehouseId) {
      return { found: false as const };
    }
    const floor = await ctx.tenantDb
      .byIndex<FloorDocument>(
        "storageFloors",
        "by_orgId_buildingId_floorNumber",
        [
          { field: "buildingId", value: args.buildingId },
          { field: "floorNumber", value: args.floorNumber },
        ],
      )
      .unique();
    return floor === null
      ? { found: false as const }
      : { found: true as const, building, floor: await readFloor(ctx, floor) };
  },
});

export const getStorageBuildingReview = getStorageBuilding;

export const getStorageLocationMap = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    locationId: v.id("locations"),
  },
  returns: v.any(),
  permissionCode: "masterData.storageLayout.read",
  target: { table: "storageZones" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const zone = await ctx.tenantDb
      .byIndex<ZoneDocument>("storageZones", "by_orgId_locationId", [
        { field: "locationId", value: args.locationId },
      ])
      .unique();
    if (zone === null || zone.status !== "ACTIVE") {
      return { found: false as const };
    }

    const [building, floor] = await Promise.all([
      ctx.tenantDb.get<BuildingDocument>("storageBuildings", zone.buildingId),
      ctx.tenantDb.get<FloorDocument>("storageFloors", zone.floorId),
    ]);
    if (
      building === null ||
      building.warehouseId !== args.warehouseId ||
      floor === null ||
      floor.buildingId !== building._id
    ) {
      return { found: false as const };
    }

    return {
      found: true as const,
      building: { ...building, buildingId: building._id },
      floor: await readFloor(ctx, floor),
      zone: await resolveZone(ctx, zone),
    };
  },
});
