/**
 * Builds exact warehouse catalogue totals (lib/warehouseTotals) in one
 * transaction. Reading every product summary makes any concurrent summary
 * write conflict with it, so the result is serializable; later writes keep
 * it exact by deltas. The tenant is derived from the warehouse.
 */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import {
  readProductSummary,
  summaryReadiness,
} from "../lib/finishedGoodsSummary";
import { createTenantDocumentAccess } from "../lib/tenantDb";
import { createMutationTenantStorage } from "../lib/tenantStorage";
import {
  MAX_TOTALS_BACKFILL_PRODUCTS,
  TOTAL_FIELDS,
  totalsShard,
  WAREHOUSE_TOTALS_SHARDS,
  WAREHOUSE_TOTALS_VERSION,
} from "../lib/warehouseTotals";
import type { Doc } from "../_generated/dataModel";

export const run = internalMutation({
  args: { warehouseId: v.id("warehouses") },
  returns: v.object({ built: v.boolean(), reason: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const warehouse = await ctx.db.get(args.warehouseId);
    if (!warehouse) throw new Error("Warehouse not found");
    const requestId = "warehouse-totals-backfill";
    const db = createTenantDocumentAccess(
      { orgId: warehouse.orgId, requestId },
      createMutationTenantStorage(ctx, requestId),
    );
    const readiness = await summaryReadiness(db, args.warehouseId);
    if (!readiness?.ready)
      return { built: false, reason: "PRODUCT_SUMMARIES_NOT_READY" };
    let products: readonly Doc<"finishedGoodsProducts">[];
    try {
      products = await db
        .byIndex<Doc<"finishedGoodsProducts">>(
          "finishedGoodsProducts",
          "by_orgId_warehouseId_sku",
          [{ field: "warehouseId", value: args.warehouseId }],
        )
        .all(MAX_TOTALS_BACKFILL_PRODUCTS);
    } catch {
      return { built: false, reason: "TOO_MANY_PRODUCTS" };
    }
    const shards = Array.from({ length: WAREHOUSE_TOTALS_SHARDS }, () => ({
      products: 0,
      awaitingMeasurement: 0,
      awaitingStorage: 0,
      stored: 0,
      moving: 0,
      units: new Map<string, number>(),
    }));
    for (const product of products) {
      const values = await readProductSummary(
        { tenantDb: db },
        product,
        readiness,
      );
      if (!values)
        return { built: false, reason: "PRODUCT_SUMMARIES_NOT_READY" };
      const shard = shards[totalsShard(product._id)]!;
      shard.products++;
      for (const field of TOTAL_FIELDS) shard[field] += values[field];
      if (product.unit)
        shard.units.set(product.unit, (shard.units.get(product.unit) ?? 0) + 1);
    }
    const existing = await db
      .byIndex<Doc<"finishedGoodsWarehouseTotals">>(
        "finishedGoodsWarehouseTotals",
        "by_orgId_warehouseId_shard",
        [{ field: "warehouseId", value: args.warehouseId }],
      )
      .all(WAREHOUSE_TOTALS_SHARDS);
    for (const [shard, totals] of shards.entries()) {
      const fields = {
        warehouseId: args.warehouseId,
        shard,
        products: totals.products,
        ...Object.fromEntries(TOTAL_FIELDS.map((f) => [f, totals[f]])),
        units: [...totals.units].map(([unit, count]) => ({ unit, count })),
      };
      const row = existing.find((r) => r.shard === shard);
      if (row)
        await db.replace("finishedGoodsWarehouseTotals", row._id, fields);
      else await db.insert("finishedGoodsWarehouseTotals", fields);
    }
    await db.patch("finishedGoodsSummaryReadiness", readiness._id, {
      totalsVersion: WAREHOUSE_TOTALS_VERSION,
      totalsGeneration: readiness.generation ?? 0,
    });
    return { built: true };
  },
});

/** Hourly, 50 warehouses per transaction: build totals where not current. */
export const sweep = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.object({ started: v.number(), isDone: v.boolean() }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("warehouses")
      .paginate({ cursor: args.cursor ?? null, numItems: 50 });
    if (!page.isDone)
      await ctx.scheduler.runAfter(
        0,
        internal.finishedGoods.totalsBackfill.sweep,
        {
          cursor: page.continueCursor,
        },
      );
    let started = 0;
    for (const warehouse of page.page) {
      const readiness = await ctx.db
        .query("finishedGoodsSummaryReadiness")
        .withIndex("by_orgId_warehouseId", (q) =>
          q.eq("orgId", warehouse.orgId).eq("warehouseId", warehouse._id),
        )
        .unique();
      if (
        !readiness?.ready ||
        (readiness.totalsVersion === WAREHOUSE_TOTALS_VERSION &&
          readiness.totalsGeneration === (readiness.generation ?? 0))
      )
        continue;
      await ctx.scheduler.runAfter(
        0,
        internal.finishedGoods.totalsBackfill.run,
        {
          warehouseId: warehouse._id,
        },
      );
      started++;
    }
    return { started, isDone: page.isDone };
  },
});

/**
 * Operators: stop trusting maintained totals (for example after running code
 * that does not maintain them); the summary scans until the next build.
 */
export const invalidate = internalMutation({
  args: { warehouseId: v.id("warehouses") },
  returns: v.object({ invalidated: v.boolean() }),
  handler: async (ctx, args) => {
    const warehouse = await ctx.db.get(args.warehouseId);
    if (!warehouse) throw new Error("Warehouse not found");
    const readiness = await ctx.db
      .query("finishedGoodsSummaryReadiness")
      .withIndex("by_orgId_warehouseId", (q) =>
        q.eq("orgId", warehouse.orgId).eq("warehouseId", args.warehouseId),
      )
      .unique();
    if (!readiness?.totalsVersion) return { invalidated: false };
    await ctx.db.patch(readiness._id, { totalsVersion: undefined });
    return { invalidated: true };
  },
});
