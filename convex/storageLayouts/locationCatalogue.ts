import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { queryWithOrg } from "../lib/tenantFunctions";

/** Warehouse-wide location inventory. Bounded reads fail explicitly rather than truncate. */
export const list = queryWithOrg({
  args: { warehouseId: v.id("warehouses") },
  returns: v.any(),
  permissionCode: "masterData.storageLayout.read",
  target: { table: "storageZones" },
  warehouseId: (args) => args.warehouseId,
  handler: async (ctx, { warehouseId }) => {
    const scope = [{ field: "warehouseId", value: warehouseId }];
    const [zones, buildings, positions] = await Promise.all([
      ctx.tenantDb
        .byIndex<Doc<"storageZones">>(
          "storageZones",
          "by_orgId_warehouseId_code",
          scope,
        )
        .all(10_000),
      ctx.tenantDb
        .byIndex<Doc<"storageBuildings">>(
          "storageBuildings",
          "by_orgId_warehouseId_code",
          scope,
        )
        .all(10_000),
      ctx.tenantDb
        .byIndex<Doc<"storagePositions">>(
          "storagePositions",
          "by_orgId_warehouseId_code",
          scope,
        )
        .all(10_000),
    ]);
    const result = await Promise.all(
      zones.map(async (zone) => {
        const building = buildings.find((b) => b._id === zone.buildingId);
        const floor = await ctx.tenantDb.get<Doc<"storageFloors">>(
          "storageFloors",
          zone.floorId,
        );
        if (!building || !floor || floor.buildingId !== building._id)
          return null;
        const placements = (
          await Promise.all(
            (["RESERVED", "STORED"] as const).map((status) =>
              ctx.tenantDb
                .byIndex<Doc<"finishedGoodsPlacements">>(
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
        return {
          zoneId: zone._id,
          label: zone.label,
          code: zone.code,
          qrValue: zone.qrValue,
          buildingId: building._id,
          buildingName: building.name,
          buildingCode: building.code,
          floorNumber: floor.floorNumber,
          status:
            zone.status === "INACTIVE"
              ? ("ARCHIVED" as const)
              : building.status,
          widthMm: zone.widthMm,
          depthMm: zone.depthMm,
          heightMm: zone.maxStackHeightMm,
          positions: positions
            .filter((p) => p.zoneId === zone._id && !p.isDefault)
            .map((p) => ({
              id: p._id,
              label: p.label,
              code: p.code,
              status: p.status,
              xMm: p.xMm,
              yMm: p.yMm,
              zMm: p.elevationMm ?? zone.baseElevationMm ?? 0,
            })),
          placements: placements.map((p) => ({
            id: p._id,
            code: p.positionCode,
            xMm: p.xMm,
            yMm: p.yMm,
            zMm: p.zMm,
            status: p.status,
            rotation: p.rotation,
          })),
        };
      }),
    );
    return result.filter((row) => row !== null);
  },
});
