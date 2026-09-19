import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { createTenantDocumentAccess } from "../lib/tenantDb";
import { createMutationTenantStorage } from "../lib/tenantStorage";
import {
  backfillProductSummaries,
  summaryReadiness,
} from "../lib/finishedGoodsSummary";

/** Operational migration: tenant is derived from the warehouse, never caller supplied. */
export const run = internalMutation({
  args: { warehouseId: v.id("warehouses"), restart: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const warehouse = await ctx.db.get(args.warehouseId);
    if (!warehouse) throw new Error("Warehouse not found");
    const requestId = "finished-goods-summary-backfill";
    const db = createTenantDocumentAccess(
      { orgId: warehouse.orgId, requestId },
      createMutationTenantStorage(ctx, requestId),
    );
    if (args.restart) {
      const state = await summaryReadiness(db, args.warehouseId);
      if (state)
        await db.patch("finishedGoodsSummaryReadiness", state._id, {
          ready: false,
          cursor: undefined,
          generation: (state.generation ?? 0) + 1,
        });
    }
    return backfillProductSummaries(db, args.warehouseId);
  },
});

export const invalidate = internalMutation({
  args: { warehouseId: v.id("warehouses") },
  handler: async (ctx, args) => {
    const warehouse = await ctx.db.get(args.warehouseId);
    if (!warehouse) throw new Error("Warehouse not found");
    const requestId = "finished-goods-summary-invalidate";
    const db = createTenantDocumentAccess(
      { orgId: warehouse.orgId, requestId },
      createMutationTenantStorage(ctx, requestId),
    );
    const state = await summaryReadiness(db, args.warehouseId);
    if (state)
      await db.patch("finishedGoodsSummaryReadiness", state._id, {
        ready: false,
        cursor: undefined,
        generation: (state.generation ?? 0) + 1,
      });
    return { ready: false };
  },
});
