/**
 * Operational migration for derived zone occupancy (convex/lib/zoneOccupancy.ts).
 * The tenant is derived from the warehouse, never caller supplied. Run with
 * `restart: true`, then pass each `continueCursor` back until `ready`.
 */
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internalMutation } from "../_generated/server";
import { createTenantDocumentAccess } from "../lib/tenantDb";
import { createMutationTenantStorage } from "../lib/tenantStorage";
import { internal } from "../_generated/api";
import { ensureSummaryReadiness } from "../lib/finishedGoodsSummary";
import {
  rebuildZoneOccupancy,
  ZONE_OCCUPANCY_VERSION,
} from "../lib/zoneOccupancy";

async function readiness(
  ctx: MutationCtx,
  orgId: Doc<"organizations">["_id"],
  warehouseId: Doc<"warehouses">["_id"],
) {
  return ctx.db
    .query("storageZoneOccupancyReadiness")
    .withIndex("by_orgId_warehouseId", (q) =>
      q.eq("orgId", orgId).eq("warehouseId", warehouseId),
    )
    .unique();
}

/** Raw-writing seeds and repairs call this so readers fall back until rebuilt. */
export async function invalidateZoneOccupancy(
  ctx: MutationCtx,
  warehouseId: Doc<"warehouses">["_id"],
) {
  const warehouse = await ctx.db.get(warehouseId);
  if (!warehouse) return;
  const row = await readiness(ctx, warehouse.orgId, warehouseId);
  // Also poisons an unfinished backfill: it must restart to become ready.
  if (row && (row.ready || !row.stale))
    await ctx.db.patch(row._id, { ready: false, stale: true });
}

export const run = internalMutation({
  args: {
    warehouseId: v.id("warehouses"),
    restart: v.optional(v.boolean()),
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
    /** Schedule the next page until done (used by the sweep cron). */
    chain: v.optional(v.boolean()),
    /** The run a continuation belongs to (returned by its first page). */
    runId: v.optional(v.string()),
  },
  returns: v.object({
    runId: v.string(),
    /** A newer run started: this continuation did nothing. */
    superseded: v.boolean(),
    rebuilt: v.number(),
    isDone: v.boolean(),
    /** Zone-scoped readers (recommendations) may use the rows. */
    ready: v.boolean(),
    /** Building-scoped readers may too: no cross-building or overflowed zone. */
    buildingReady: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 20;
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 50)
      throw new Error("batchSize must be an integer from 1 to 50");
    const warehouse = await ctx.db.get(args.warehouseId);
    if (!warehouse) throw new Error("Warehouse not found");
    const orgId = warehouse.orgId;
    const requestId = "storage-zone-occupancy-backfill";
    const db = createTenantDocumentAccess(
      { orgId, requestId },
      createMutationTenantStorage(ctx, requestId),
    );
    const state = await readiness(ctx, orgId, args.warehouseId);
    const starting = args.restart === true || !args.cursor;
    // Only the newest run may rebuild pages or declare readiness.
    if (!starting && (!state?.runId || state.runId !== args.runId))
      return {
        runId: args.runId ?? "",
        superseded: true,
        rebuilt: 0,
        isDone: true,
        ready: false,
        buildingReady: false,
        continueCursor: "",
      };
    const runId = starting ? crypto.randomUUID() : args.runId!;
    if (starting) {
      if (state)
        await ctx.db.patch(state._id, {
          ready: false,
          blocked: false,
          stale: false,
          overflow: false,
          version: ZONE_OCCUPANCY_VERSION,
          runId,
        });
      else
        await ctx.db.insert("storageZoneOccupancyReadiness", {
          orgId,
          warehouseId: args.warehouseId,
          version: ZONE_OCCUPANCY_VERSION,
          ready: false,
          runId,
        });
    }
    const page = await ctx.db
      .query("storageZones")
      .withIndex("by_orgId_warehouseId_code", (q) =>
        q.eq("orgId", orgId).eq("warehouseId", args.warehouseId),
      )
      .paginate({
        cursor: starting ? null : (args.cursor ?? null),
        numItems: batchSize,
      });
    for (const zone of page.page) await rebuildZoneOccupancy(db, zone);
    let ready = false;
    let buildingReady = false;
    if (page.isDone) {
      const done = await readiness(ctx, orgId, args.warehouseId);
      // Invalidation during this run poisons it; only a restart may finish.
      ready = done !== null && done.stale !== true;
      buildingReady =
        ready && done!.blocked !== true && done!.overflow !== true;
      if (done && ready)
        await ctx.db.patch(done._id, {
          ready: true,
          version: ZONE_OCCUPANCY_VERSION,
          // Writes by code that does not maintain these rows move this value.
          summaryGeneration:
            (await ensureSummaryReadiness(db, args.warehouseId))?.generation ??
            0,
        });
    } else if (args.chain)
      await ctx.scheduler.runAfter(
        0,
        internal.storageLayouts.zoneOccupancyBackfill.run,
        {
          warehouseId: args.warehouseId,
          cursor: page.continueCursor,
          batchSize,
          chain: true,
          runId,
        },
      );
    return {
      runId,
      superseded: false,
      rebuilt: page.page.length,
      isDone: page.isDone,
      ready,
      buildingReady,
      continueCursor: page.continueCursor,
    };
  },
});

export const invalidate = internalMutation({
  args: { warehouseId: v.id("warehouses") },
  returns: v.object({ ready: v.boolean() }),
  handler: async (ctx, args) => {
    await invalidateZoneOccupancy(ctx, args.warehouseId);
    return { ready: false };
  },
});

/**
 * Hourly: new warehouses, fresh deployments and invalidated warehouses become
 * ready without an operator. Blocked/overflowed warehouses stay zone-ready only.
 */
export const sweep = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.object({ started: v.number(), isDone: v.boolean() }),
  handler: async (ctx, args) => {
    let started = 0;
    // Bounded per transaction: 50 warehouses, then continue in a new one.
    const page = await ctx.db
      .query("warehouses")
      .paginate({ cursor: args.cursor ?? null, numItems: 50 });
    if (!page.isDone)
      await ctx.scheduler.runAfter(
        0,
        internal.storageLayouts.zoneOccupancyBackfill.sweep,
        { cursor: page.continueCursor },
      );
    for (const warehouse of page.page) {
      const row = await readiness(ctx, warehouse.orgId, warehouse._id);
      const legacy = await ctx.db
        .query("finishedGoodsSummaryReadiness")
        .withIndex("by_orgId_warehouseId", (q) =>
          q.eq("orgId", warehouse.orgId).eq("warehouseId", warehouse._id),
        )
        .unique();
      if (
        row?.ready &&
        row.stale !== true &&
        row.version === ZONE_OCCUPANCY_VERSION &&
        (row.summaryGeneration ?? 0) === (legacy?.generation ?? 0)
      )
        continue;
      await ctx.scheduler.runAfter(
        0,
        internal.storageLayouts.zoneOccupancyBackfill.run,
        { warehouseId: warehouse._id, restart: true, chain: true },
      );
      started++;
    }
    return { started, isDone: page.isDone };
  },
});
