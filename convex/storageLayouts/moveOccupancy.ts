import type { Doc } from "../_generated/dataModel";
import type { TenantFunctionContext } from "../lib/tenantFunctions";

export interface MoveOccupancy {
  readonly moveId: string;
  readonly moveState: "RESERVED" | "IN_TRANSIT";
  readonly moveRole: "SOURCE" | "TARGET";
}

/** Both source and target remain held; the source may only be a last-known pose. */
export async function readMoveOccupancy(
  ctx: TenantFunctionContext,
  warehouseId: string,
  palletIds?: readonly string[],
): Promise<ReadonlyMap<string, MoveOccupancy>> {
  const groups = await Promise.all(
    (palletIds === undefined ? [undefined] : [...new Set(palletIds)]).flatMap(
      (palletId) =>
        (["RESERVED", "IN_TRANSIT"] as const).map((status) =>
          ctx.tenantDb
            .byIndex<Doc<"finishedGoodsMoves">>(
              "finishedGoodsMoves",
              palletId === undefined
                ? "by_orgId_warehouseId_status"
                : "by_orgId_palletId_status",
              [
                palletId === undefined
                  ? { field: "warehouseId", value: warehouseId }
                  : { field: "palletId", value: palletId },
                { field: "status", value: status },
              ],
            )
            .all(10_000)
            .then((moves) => moves.map((move) => ({ move, status }))),
        ),
    ),
  );
  const result = new Map<string, MoveOccupancy>();
  for (const { move, status } of groups.flat()) {
    if (move.warehouseId !== warehouseId) continue;
    result.set(move.sourcePlacementId, {
      moveId: move._id,
      moveState: status,
      moveRole: "SOURCE",
    });
    result.set(move.targetPlacementId, {
      moveId: move._id,
      moveState: status,
      moveRole: "TARGET",
    });
  }
  return result;
}

/**
 * Only building-local moves participate once all active legacy rows have been
 * indexed. Empty legacy ranges stay stable when unrelated indexed moves change.
 * Until then, preserve the original per-pallet lookup rather than omit holds.
 */
export async function readBuildingMoveOccupancy(
  ctx: TenantFunctionContext,
  warehouseId: string,
  buildingId: string,
  palletIds: readonly string[],
): Promise<ReadonlyMap<string, MoveOccupancy>> {
  if (!palletIds.length) return new Map();
  for (const status of ["RESERVED", "IN_TRANSIT"] as const) {
    const legacy = await ctx.tenantDb
      .byIndex<Doc<"finishedGoodsMoves">>(
        "finishedGoodsMoves",
        "by_orgId_warehouseId_buildingIndexVersion_status",
        [
          { field: "warehouseId", value: warehouseId },
          { field: "buildingIndexVersion", value: undefined, missing: true },
          { field: "status", value: status },
        ],
      )
      .first();
    if (legacy) return readMoveOccupancy(ctx, warehouseId, palletIds);
  }
  const groups = await Promise.all(
    (["sourceBuildingId", "targetBuildingId"] as const).flatMap((field) =>
      (["RESERVED", "IN_TRANSIT"] as const).map((status) =>
        ctx.tenantDb
          .byIndex<Doc<"finishedGoodsMoves">>(
            "finishedGoodsMoves",
            `by_orgId_${field}_status`,
            [
              { field, value: buildingId },
              { field: "status", value: status },
            ],
          )
          .all(10_000),
      ),
    ),
  );
  const pallets = new Set(palletIds);
  const result = new Map<string, MoveOccupancy>();
  for (const move of groups.flat()) {
    if (move.warehouseId !== warehouseId || !pallets.has(move.palletId))
      continue;
    if (move.status !== "RESERVED" && move.status !== "IN_TRANSIT") continue;
    result.set(move.sourcePlacementId, {
      moveId: move._id,
      moveState: move.status,
      moveRole: "SOURCE",
    });
    result.set(move.targetPlacementId, {
      moveId: move._id,
      moveState: move.status,
      moveRole: "TARGET",
    });
  }
  return result;
}
