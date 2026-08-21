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
  return {
    floorId: floor._id,
    floorNumber: floor.floorNumber,
    ...(floor.widthMm === undefined ? {} : { widthMm: floor.widthMm }),
    ...(floor.depthMm === undefined ? {} : { depthMm: floor.depthMm }),
    ...(floor.heightMm === undefined ? {} : { heightMm: floor.heightMm }),
    grossAreaSqMm: floor.grossAreaSqMm,
    reservedAreaSqMm: floor.reservedAreaSqMm,
    usableAreaSqMm: floor.usableAreaSqMm,
    version: floor.version,
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
