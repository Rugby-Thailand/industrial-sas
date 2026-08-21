import { v } from "convex/values";

import type { TenantOrgId } from "../lib/tenantDb";
import {
  queryWithOrg,
  type TenantFunctionContext,
} from "../lib/tenantFunctions";
import { storageLayoutStatus } from "../lib/validators";

interface BuildingDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly warehouseId: string;
  readonly code: string;
  readonly name: string;
  readonly widthMm: number;
  readonly depthMm: number;
  readonly defaultFloorHeightMm: number;
  readonly floorCount: number;
  readonly totalHeightMm: number;
  readonly grossAreaSqMm: number;
  readonly reservedAreaSqMm: number;
  readonly usableAreaSqMm: number;
  readonly status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  readonly version: number;
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
  readonly offsetXMm?: number;
  readonly offsetYMm?: number;
  readonly grossAreaSqMm: number;
  readonly reservedAreaSqMm: number;
  readonly usableAreaSqMm: number;
  readonly version: number;
}

interface BlockDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly buildingId: string;
  readonly floorId: string;
  readonly warehouseId: string;
  readonly label: string;
  readonly xMm: number;
  readonly yMm: number;
  readonly widthMm: number;
  readonly depthMm: number;
}

interface ZoneDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
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
  readonly handlingUnitId: string;
  readonly levelIndex: number;
  readonly widthMm: number;
  readonly depthMm: number;
  readonly heightMm: number;
  readonly orientation: "DEFAULT" | "ROTATED";
  readonly placedAt: number;
}

interface HandlingUnitDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly lpn: string;
  readonly currentLocationId?: string;
}

const buildingArgs = {
  warehouseId: v.id("warehouses"),
  buildingId: v.id("storageBuildings"),
};

async function readFloor(ctx: TenantFunctionContext, floor: FloorDocument) {
  const blocks = await ctx.tenantDb
    .byIndex<BlockDocument>("storageFloorReservedBlocks", "by_orgId_floorId", [
      { field: "floorId", value: floor._id },
    ])
    .take(20);
  const zones = await ctx.tenantDb
    .byIndex<ZoneDocument>("storageZones", "by_orgId_floorId_status_code", [
      { field: "floorId", value: floor._id },
      { field: "status", value: "ACTIVE" },
    ])
    .take(50);
  const storageZones = await Promise.all(
    zones.map(async (zone) => {
      const placements = await ctx.tenantDb
        .byIndex<PlacementDocument>(
          "storageStackPlacements",
          "by_orgId_zoneId_status_levelIndex",
          [
            { field: "zoneId", value: zone._id },
            { field: "status", value: "ACTIVE" },
          ],
        )
        .take(50);
      const resolved = await Promise.all(
        placements.map(async (placement) => {
          const unit = await ctx.tenantDb.get<HandlingUnitDocument>(
            "handlingUnits",
            placement.handlingUnitId,
          );
          if (unit === null || unit.currentLocationId !== zone.locationId) {
            return null;
          }
          return {
            placementId: placement._id,
            handlingUnitId: placement.handlingUnitId,
            lpn: unit.lpn,
            levelIndex: placement.levelIndex,
            widthMm: placement.widthMm,
            depthMm: placement.depthMm,
            heightMm: placement.heightMm,
            orientation: placement.orientation,
            placedAt: placement.placedAt,
          };
        }),
      );
      return {
        zoneId: zone._id,
        locationId: zone.locationId,
        code: zone.code,
        label: zone.label,
        qrValue: zone.qrValue,
        xMm: zone.xMm,
        yMm: zone.yMm,
        widthMm: zone.widthMm,
        depthMm: zone.depthMm,
        maxStackHeightMm: zone.maxStackHeightMm,
        placements: resolved
          .filter((placement) => placement !== null)
          .sort((left, right) => left.levelIndex - right.levelIndex),
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
      xMm: block.xMm,
      yMm: block.yMm,
      widthMm: block.widthMm,
      depthMm: block.depthMm,
    })),
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
      .take(100);
    return rows.map((row) => ({ ...row, buildingId: row._id }));
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
      .take(50);
    return {
      found: true as const,
      building: { ...building, buildingId: building._id },
      floors: await Promise.all(floors.map((floor) => readFloor(ctx, floor))),
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
