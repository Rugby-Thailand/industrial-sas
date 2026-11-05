/**
 * Builds exact warehouse catalogue totals (lib/warehouseTotals) for a
 * catalogue of any size, one page of products per transaction, in creation
 * order. Writes during the build apply deltas only to products already
 * counted; the build counts every other product's state when it reaches it.
 * Each page and each write read the readiness row holding the position, so
 * they serialize. The tenant is derived from the warehouse.
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
  applied,
  emptyShard,
  shardRow,
  TOTAL_FIELDS,
  TOTALS_BUILD_PAGE,
  totalsShard,
  type TotalsBuild,
  type TotalsDelta,
  WAREHOUSE_TOTALS_SHARDS,
  WAREHOUSE_TOTALS_VERSION,
} from "../lib/warehouseTotals";
import type { Doc } from "../_generated/dataModel";

/** A build whose chain stopped (error, deploy) is restarted after this. */
const STALLED_BUILD_MS = 60 * 60 * 1000;

export const run = internalMutation({
  args: {
    warehouseId: v.id("warehouses"),
    /** Continue this build; omitted: start a new one. */
    runId: v.optional(v.string()),
    batchSize: v.optional(v.number()),
    /** Schedule the next page (default true). */
    chain: v.optional(v.boolean()),
  },
  returns: v.object({
    built: v.boolean(),
    reason: v.optional(v.string()),
    runId: v.optional(v.string()),
    counted: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? TOTALS_BUILD_PAGE;
    if (
      !Number.isInteger(batchSize) ||
      batchSize < 1 ||
      batchSize > TOTALS_BUILD_PAGE
    )
      throw new Error(
        `batchSize must be an integer from 1 to ${TOTALS_BUILD_PAGE}`,
      );
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
    let build: TotalsBuild;
    // A poisoned build (invalidated, or a write it could not place) and one
    // that saw writes by code that does not maintain totals (legacy
    // generation moved) start over from zero.
    const restart =
      readiness.totalsBuild?.poisoned === true ||
      (readiness.totalsBuild !== undefined &&
        readiness.totalsBuild.generation !== undefined &&
        readiness.totalsBuild.generation !== (readiness.generation ?? 0));
    if (args.runId === undefined || restart) {
      if (
        args.runId !== undefined &&
        readiness.totalsBuild?.runId !== args.runId
      )
        return { built: false, reason: "SUPERSEDED" };
      // Start over from zero; until it finishes readers use the summary scan.
      build = {
        runId: crypto.randomUUID(),
        startedAt: Date.now(),
        afterIds: [],
        generation: readiness.generation ?? 0,
      };
      for (const row of await db
        .byIndex<Doc<"finishedGoodsWarehouseTotals">>(
          "finishedGoodsWarehouseTotals",
          "by_orgId_warehouseId_shard",
          [{ field: "warehouseId", value: args.warehouseId }],
        )
        .all(WAREHOUSE_TOTALS_SHARDS)) {
        const zero = emptyShard(args.warehouseId, row.shard);
        await db.replace("finishedGoodsWarehouseTotals", row._id, zero);
      }
    } else if (readiness.totalsBuild?.runId === args.runId)
      build = readiness.totalsBuild;
    else return { built: false, reason: "SUPERSEDED" };

    const after = build.after;
    const seen = new Set<string>(build.afterIds);
    const window = await ctx.db
      .query("finishedGoodsProducts")
      .withIndex("by_orgId_warehouseId", (q) => {
        const base = q
          .eq("orgId", warehouse.orgId)
          .eq("warehouseId", args.warehouseId);
        return after === undefined ? base : base.gte("_creationTime", after);
      })
      .take(batchSize + seen.size);
    const fresh = window.filter(
      (p) => !(p._creationTime === after && seen.has(p._id)),
    );
    const counted = fresh.slice(0, batchSize);
    const deltas = new Map<
      number,
      { delta: TotalsDelta; units: Map<string, number> }
    >();
    for (const product of counted) {
      const values = await readProductSummary(
        { tenantDb: db },
        product,
        readiness,
      );
      if (!values)
        return { built: false, reason: "PRODUCT_SUMMARIES_NOT_READY" };
      const shard = totalsShard(product._id);
      const entry = deltas.get(shard) ?? {
        delta: { products: 0 },
        units: new Map<string, number>(),
      };
      entry.delta.products = (entry.delta.products ?? 0) + 1;
      for (const field of TOTAL_FIELDS)
        entry.delta[field] = (entry.delta[field] ?? 0) + values[field];
      if (product.unit)
        entry.units.set(product.unit, (entry.units.get(product.unit) ?? 0) + 1);
      deltas.set(shard, entry);
    }
    for (const [shard, { delta, units }] of deltas) {
      const row = await shardRow(db, args.warehouseId, shard);
      // Object.fromEntries defines own properties: "__proto__" stays a label.
      const sum = applied(row ?? emptyShard(args.warehouseId, shard), {
        ...delta,
        units: Object.fromEntries(units),
      });
      const fields = {
        warehouseId: args.warehouseId,
        shard,
        products: sum.products,
        awaitingMeasurement: sum.awaitingMeasurement,
        awaitingStorage: sum.awaitingStorage,
        stored: sum.stored,
        moving: sum.moving,
        units: sum.units,
      };
      if (row)
        await db.replace("finishedGoodsWarehouseTotals", row._id, fields);
      else await db.insert("finishedGoodsWarehouseTotals", fields);
    }
    const last = counted.at(-1);
    const next: TotalsBuild = last
      ? {
          ...build,
          after: last._creationTime,
          afterIds: [
            ...(last._creationTime === after ? build.afterIds : []),
            ...counted
              .filter((p) => p._creationTime === last._creationTime)
              .map((p) => p._id),
          ],
        }
      : build;
    // Fewer products than asked for: nothing is left beyond this page.
    const done =
      window.length < batchSize + seen.size && counted.length === fresh.length;
    if (done) {
      await db.patch("finishedGoodsSummaryReadiness", readiness._id, {
        totalsBuild: undefined,
        totalsVersion: WAREHOUSE_TOTALS_VERSION,
        totalsGeneration: readiness.generation ?? 0,
        totalsRefusedAt: undefined,
      });
      return { built: true, runId: build.runId, counted: counted.length };
    }
    await db.patch("finishedGoodsSummaryReadiness", readiness._id, {
      totalsBuild: next,
      totalsVersion: undefined,
    });
    if (args.chain !== false)
      await ctx.scheduler.runAfter(
        0,
        internal.finishedGoods.totalsBackfill.run,
        {
          warehouseId: args.warehouseId,
          runId: build.runId,
          ...(args.batchSize === undefined ? {} : { batchSize }),
        },
      );
    return {
      built: false,
      reason: "IN_PROGRESS",
      runId: build.runId,
      counted: counted.length,
    };
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
          readiness.totalsGeneration === (readiness.generation ?? 0)) ||
        // A build is paging; restart it only if its chain stopped.
        (readiness.totalsBuild !== undefined &&
          !readiness.totalsBuild.poisoned &&
          Date.now() - readiness.totalsBuild.startedAt < STALLED_BUILD_MS)
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
    if (!readiness?.totalsVersion && !readiness?.totalsBuild)
      return { invalidated: false };
    // An unfinished build must not publish what it counted so far either.
    await ctx.db.patch(readiness._id, {
      totalsVersion: undefined,
      ...(readiness.totalsBuild
        ? { totalsBuild: { ...readiness.totalsBuild, poisoned: true } }
        : {}),
    });
    return { invalidated: true };
  },
});
