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
