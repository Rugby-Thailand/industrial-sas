/**
 * Operational migration for derived zone occupancy (convex/lib/zoneOccupancy.ts).
 * The tenant is derived from the warehouse, never caller supplied. Run with
 * `restart: true`, then pass each `continueCursor` back until `ready`.
 */
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internalMutation, internalQuery } from "../_generated/server";
import { createTenantDocumentAccess } from "../lib/tenantDb";
import {
  createMutationTenantStorage,
  createQueryTenantStorage,
} from "../lib/tenantStorage";
import { internal } from "../_generated/api";
import { ensureSummaryReadiness } from "../lib/finishedGoodsSummary";
import {
  buildingScopeClear,
  MAX_ZONE_OCCUPANCY_ENTRIES,
  overflowedZones,
  rebuildZoneOccupancy,
  ZONE_OCCUPANCY_VERSION,
} from "../lib/zoneOccupancy";
import { layoutGeneration, rebuildZoneSurface } from "../lib/zoneSurfaces";

/**
 * Read calls (index ranges and gets) after which a backfill page stops
 * rebuilding zones and resumes the same page in the next transaction. The
 * check runs before each zone, so the zone that crosses it still runs: a
 * full zone costs up to ~3,500 (500 pallets with stack facts, 5 each; its
 * layout surface's 500 positions and their locations), which must still fit
 * the 4,096-read transaction limit on top of this.
 */
const REBUILD_READ_BUDGET = 500;
/** Overflowed zones scheduled per page of a warehouse's re-check walk. */
const OVERFLOW_RECHECK_PAGE = 10;

type Resume = { resume: string | null; done: string[] };
/** A mid-page continuation, or null for a plain Convex page cursor. */
function decodeResume(cursor: string | null | undefined): Resume | null {
  if (!cursor?.startsWith("{")) return null;
  try {
    const value = JSON.parse(cursor) as Partial<Resume>;
    if (
      value &&
      (value.resume === null || typeof value.resume === "string") &&
      Array.isArray(value.done) &&
      value.done.length <= 50 &&
      value.done.every((id) => typeof id === "string")
    )
      return { resume: value.resume, done: value.done };
  } catch {
    // Not a resume token.
  }
  throw new Error("Invalid backfill cursor");
}

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
    /** Read-call stopping threshold; capped to leave room for one full zone. */
    budget: v.optional(v.number()),
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
    const budget = args.budget ?? REBUILD_READ_BUDGET;
    if (!Number.isInteger(budget) || budget < 1 || budget > REBUILD_READ_BUDGET)
      throw new Error("budget must be an integer from 1 to 500");
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
      // Capture before any page is built. Maintained layout writes can advance
      // this stamp after refreshing affected surfaces; legacy writes cannot.
      const generations = {
        summaryGeneration:
          (await ensureSummaryReadiness(db, args.warehouseId))?.generation ?? 0,
        layoutGeneration: await layoutGeneration(db, args.warehouseId),
      };
      if (state)
        await ctx.db.patch(state._id, {
          ready: false,
          blocked: false,
          stale: false,
          overflow: false,
          ...generations,
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
          ...generations,
        });
    }
    const resume = starting ? null : decodeResume(args.cursor);
    const pageCursor = starting
      ? null
      : resume
        ? resume.resume
        : (args.cursor ?? null);
    const page = await ctx.db
      .query("storageZones")
      .withIndex("by_orgId_warehouseId_code", (q) =>
        q.eq("orgId", orgId).eq("warehouseId", args.warehouseId),
      )
      .paginate({ cursor: pageCursor, numItems: batchSize });
    const done = new Set(resume?.done ?? []);
    let spent = 0;
    let rebuilt = 0;
    const buildings = new Map<
      string,
      Promise<Doc<"storageBuildings"> | null>
    >();
    const readBuilding = (id: string) => {
      let pending = buildings.get(id);
      if (!pending) {
        pending = db.get<Doc<"storageBuildings">>("storageBuildings", id);
        buildings.set(id, pending);
      }
      return pending;
    };
    // Always rebuild at least one zone, so every transaction makes progress.
    for (const zone of page.page) {
      if (done.has(zone._id)) continue;
      if (rebuilt > 0 && spent >= budget) break;
      spent += await rebuildZoneOccupancy(db, zone);
      // Its layout surface, stamped with this run (rows of other runs belong
      // to zones deleted since, which readers skip).
      spent += (
        await rebuildZoneSurface(db, zone._id, runId, readBuilding, zone)
      ).read;
      done.add(zone._id);
      rebuilt++;
    }
    const pageFinished = page.page.every((zone) => done.has(zone._id));
    // Only zones of this page can come round again from the same cursor;
    // others (deleted, or pushed past the page end) are rebuilt again at
    // worst, so the token never outgrows one page.
    const continueCursor = pageFinished
      ? page.continueCursor
      : JSON.stringify({
          resume: pageCursor,
          done: page.page
            .filter((zone) => done.has(zone._id))
            .map((zone) => zone._id),
        } satisfies Resume);
    const isDone = pageFinished && page.isDone;
    let ready = false;
    let buildingReady = false;
    if (isDone) {
      const final = await readiness(ctx, orgId, args.warehouseId);
      // Neither explicit invalidation nor a legacy generation change may
      // be hidden by stamping the current generation over earlier pages.
      const summaryGeneration =
        (await ensureSummaryReadiness(db, args.warehouseId))?.generation ?? 0;
      const currentLayoutGeneration = await layoutGeneration(
        db,
        args.warehouseId,
      );
      ready =
        final !== null &&
        final.stale !== true &&
        final.summaryGeneration === summaryGeneration &&
        final.layoutGeneration === currentLayoutGeneration;
      buildingReady = ready && (await buildingScopeClear(db, args.warehouseId));
      if (final)
        await ctx.db.patch(final._id, {
          ready,
          ...(!ready ? { stale: true } : {}),
          version: ZONE_OCCUPANCY_VERSION,
        });
    } else if (args.chain)
      await ctx.scheduler.runAfter(
        0,
        internal.storageLayouts.zoneOccupancyBackfill.run,
        {
          warehouseId: args.warehouseId,
          cursor: continueCursor,
          batchSize,
          chain: true,
          runId,
          ...(args.budget === undefined ? {} : { budget }),
        },
      );
    return {
      runId,
      superseded: false,
      rebuilt,
      isDone,
      ready,
      buildingReady,
      continueCursor,
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
      const layout = await ctx.db
        .query("storageCatalogueSignals")
        .withIndex("by_orgId_warehouseId", (q) =>
          q.eq("orgId", warehouse.orgId).eq("warehouseId", warehouse._id),
        )
        .unique();
      if (
        row?.ready &&
        row.stale !== true &&
        row.version === ZONE_OCCUPANCY_VERSION &&
        (row.summaryGeneration ?? 0) === (legacy?.generation ?? 0) &&
        // Layout writes by code that does not maintain zone surfaces.
        row.layoutGeneration === (layout?.generation ?? 0)
      ) {
        // Writes skip overflowed zones, so only a re-check notices one that
        // fell back under the cap and can serve building readers again. Every
        // overflowed zone is re-checked each sweep, so none can starve.
        const db = createTenantDocumentAccess(
          { orgId: warehouse.orgId, requestId: "storage-zone-occupancy-sweep" },
          createMutationTenantStorage(ctx, "storage-zone-occupancy-sweep"),
        );
        if ((await overflowedZones(db, warehouse._id, 1)).length)
          await ctx.scheduler.runAfter(
            0,
            internal.storageLayouts.zoneOccupancyBackfill.recheckOverflow,
            { warehouseId: warehouse._id },
          );
        continue;
      }
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

/**
 * Walk a warehouse's overflowed zones one page per transaction, scheduling a
 * re-check of each in its own transaction (scheduled by the sweep).
 */
export const recheckOverflow = internalMutation({
  args: {
    warehouseId: v.id("warehouses"),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.object({
    scheduled: v.number(),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const warehouse = await ctx.db.get(args.warehouseId);
    if (!warehouse) throw new Error("Warehouse not found");
    const page = await ctx.db
      .query("storageZoneOccupancy")
      .withIndex("by_orgId_warehouseId_complete", (q) =>
        q
          .eq("orgId", warehouse.orgId)
          .eq("warehouseId", args.warehouseId)
          .eq("complete", false),
      )
      .paginate({
        cursor: args.cursor ?? null,
        numItems: OVERFLOW_RECHECK_PAGE,
      });
    for (const zone of page.page)
      await ctx.scheduler.runAfter(
        0,
        internal.storageLayouts.zoneOccupancyBackfill.recheckZone,
        { zoneId: zone.zoneId },
      );
    if (!page.isDone)
      await ctx.scheduler.runAfter(
        0,
        internal.storageLayouts.zoneOccupancyBackfill.recheckOverflow,
        { warehouseId: args.warehouseId, cursor: page.continueCursor },
      );
    return {
      scheduled: page.page.length,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

/** Rebuild one overflowed zone of a ready warehouse (scheduled by the sweep). */
export const recheckZone = internalMutation({
  args: { zoneId: v.id("storageZones") },
  returns: v.object({ complete: v.boolean() }),
  handler: async (ctx, args) => {
    const zone = await ctx.db.get(args.zoneId);
    if (!zone) return { complete: true };
    const state = await readiness(ctx, zone.orgId, zone.warehouseId);
    // A running backfill rebuilds every zone itself.
    if (!state?.ready || state.stale === true) return { complete: false };
    const requestId = "storage-zone-occupancy-recheck";
    const db = createTenantDocumentAccess(
      { orgId: zone.orgId, requestId },
      createMutationTenantStorage(ctx, requestId),
    );
    await rebuildZoneOccupancy(db, zone);
    const [summary] = await db
      .byIndex<Doc<"storageZoneOccupancy">>(
        "storageZoneOccupancy",
        "by_orgId_zoneId",
        [{ field: "zoneId", value: zone._id }],
      )
      .take(1);
    return { complete: summary?.complete !== false };
  },
});

/** Operator view of one warehouse's derived occupancy (see the runbook). */
export const health = internalQuery({
  args: { warehouseId: v.id("warehouses") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const warehouse = await ctx.db.get(args.warehouseId);
    if (!warehouse) throw new Error("Warehouse not found");
    const requestId = "storage-zone-occupancy-health";
    const db = createTenantDocumentAccess(
      { orgId: warehouse.orgId, requestId },
      createQueryTenantStorage(ctx, requestId),
    );
    const row = await ctx.db
      .query("storageZoneOccupancyReadiness")
      .withIndex("by_orgId_warehouseId", (q) =>
        q.eq("orgId", warehouse.orgId).eq("warehouseId", args.warehouseId),
      )
      .unique();
    const overflowed = await overflowedZones(db, args.warehouseId, 100);
    const mixed = await db
      .byIndex<Doc<"storageZoneOccupancy">>(
        "storageZoneOccupancy",
        "by_orgId_warehouseId_buildingMismatch",
        [
          { field: "warehouseId", value: args.warehouseId },
          { field: "buildingMismatch", value: true },
        ],
      )
      .take(100);
    const generation = await layoutGeneration(db, args.warehouseId);
    return {
      ready: row?.ready === true && row.stale !== true,
      /** Recommendations may also use zone surfaces (layout in step). */
      surfacesReady:
        row?.ready === true &&
        row.stale !== true &&
        row.layoutGeneration === generation,
      layoutGeneration: row?.layoutGeneration ?? null,
      currentLayoutGeneration: generation,
      version: row?.version ?? null,
      currentVersion: ZONE_OCCUPANCY_VERSION,
      runId: row?.runId ?? null,
      /** Zones above the entry cap (first 100); building readers fall back. */
      overflowedZoneIds: overflowed.map((zone) => zone.zoneId),
      overflowCap: MAX_ZONE_OCCUPANCY_ENTRIES,
      /** Zones holding a placement of another building (first 100). */
      mixedBuildingZoneIds: mixed.map((zone) => zone.zoneId),
    };
  },
});
