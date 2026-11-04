/** Retention for the insert-only finished-goods change log (see finishedGoodsGeneration). */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";

/** Continuations last seconds; older rows only cost storage. */
export const CHANGE_RETENTION_MS = 10 * 60 * 1000;
const MAX_DELETES = 2_000;

export const prune = internalMutation({
  args: { fromWarehouseIndex: v.optional(v.number()) },
  returns: v.object({ deleted: v.number(), more: v.boolean() }),
  handler: async (ctx, args) => {
    const cutoff = Date.now() - CHANGE_RETENTION_MS;
    const warehouses = await ctx.db.query("warehouses").collect();
    let deleted = 0;
    for (let i = args.fromWarehouseIndex ?? 0; i < warehouses.length; i++) {
      const { _id: warehouseId, orgId } = warehouses[i]!;
      // Keep the newest row: it is the current continuation token.
      const newest = await ctx.db
        .query("finishedGoodsChanges")
        .withIndex("by_orgId_warehouseId", (q) =>
          q.eq("orgId", orgId).eq("warehouseId", warehouseId),
        )
        .order("desc")
        .first();
      if (!newest) continue;
      const old = await ctx.db
        .query("finishedGoodsChanges")
        .withIndex("by_orgId_warehouseId", (q) =>
          q
            .eq("orgId", orgId)
            .eq("warehouseId", warehouseId)
            .lt("_creationTime", Math.min(cutoff, newest._creationTime)),
        )
        .take(MAX_DELETES - deleted);
      for (const row of old) await ctx.db.delete(row._id);
      deleted += old.length;
      if (deleted >= MAX_DELETES) {
        // Resume at this warehouse in a fresh, bounded transaction.
        await ctx.scheduler.runAfter(
          0,
          internal.finishedGoods.changeLog.prune,
          {
            fromWarehouseIndex: i,
          },
        );
        return { deleted, more: true };
      }
    }
    return { deleted, more: false };
  },
});
