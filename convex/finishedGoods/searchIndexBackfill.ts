/**
 * Operational migration and repair for the derived search indexes
 * (convex/lib/jobScanSearch.ts, convex/lib/locationSearch.ts). The tenant is
 * derived from the warehouse (or, for scheduled re-indexing, carried from the
 * writing transaction), never supplied by a client. Run with `restart: true`,
 * then pass each `continueCursor` and `runId` back until `ready`.
 */
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { createTenantDocumentAccess } from "../lib/tenantDb";
import { createMutationTenantStorage } from "../lib/tenantStorage";
import {
  indexBuildingNames,
  indexJobScans,
  JOB_SCAN_SEARCH_VERSION,
  repostJobScanTerms,
  searchBudget,
} from "../lib/jobScanSearch";
import { indexLocations, LOCATION_SEARCH_VERSION } from "../lib/locationSearch";

type Kind = "jobScans" | "locations";
const kind = v.union(v.literal("jobScans"), v.literal("locations"));
const KINDS: readonly Kind[] = ["jobScans", "locations"];
const VERSION: Record<Kind, number> = {
  jobScans: JOB_SCAN_SEARCH_VERSION,
  locations: LOCATION_SEARCH_VERSION,
};
const REQUEST = "search-index-backfill";

function tenantDb(ctx: MutationCtx, orgId: Id<"organizations">) {
  return createTenantDocumentAccess(
    { orgId, requestId: REQUEST },
    createMutationTenantStorage(ctx, REQUEST),
  );
}

async function readiness(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  warehouseId: Id<"warehouses">,
  which: Kind,
) {
  return ctx.db
    .query("searchIndexReadiness")
    .withIndex("by_orgId_warehouseId_kind", (q) =>
      q.eq("orgId", orgId).eq("warehouseId", warehouseId).eq("kind", which),
    )
    .unique();
}

const current = (row: Doc<"searchIndexReadiness"> | null, which: Kind) =>
  row?.ready === true && row.stale !== true && row.version === VERSION[which];

/**
 * Raw-writing seeds and repairs call this so readers fall back to the
 * original scans until a restarted backfill rebuilds the index.
 */
export async function invalidateSearchIndex(
  ctx: MutationCtx,
  warehouseId: Id<"warehouses">,
  kinds: readonly Kind[] = KINDS,
) {
  const warehouse = await ctx.db.get(warehouseId);
  if (!warehouse) return;
  for (const which of kinds) {
    const row = await readiness(ctx, warehouse.orgId, warehouseId, which);
    // Also poisons an unfinished backfill: it must restart to become ready.
    if (row && (row.ready || !row.stale))
      await ctx.db.patch(row._id, { ready: false, stale: true });
  }
}

const pending = {
  scans: v.array(v.string()),
  terms: v.array(v.string()),
  locations: v.array(v.string()),
};

/**
 * Re-index rows a writing transaction could not afford (deferred postings,
 * leftover postings of deleted scans). Until then those rows are always
 * candidates, so results stay exact; this only restores selectivity.
 */
export const reindex = internalMutation({
  args: { orgId: v.id("organizations"), ...pending },
  returns: v.object({ remaining: v.number() }),
  handler: async (ctx, args) => {
    const db = tenantDb(ctx, args.orgId);
    const budget = searchBudget();
    const left = { scans: [] as string[], terms: [] as string[] };
    let progressed = false;
    for (const [index, scanId] of args.scans.entries()) {
      if (progressed && budget.left < 200) {
        left.scans.push(...args.scans.slice(index));
        break;
      }
      const result = await indexJobScans(db, [scanId], budget, true);
      left.scans.push(...result.deferredScans, ...result.orphanScans);
      left.terms.push(...result.deferredTerms);
      progressed = true;
    }
    left.terms.push(...(await repostJobScanTerms(db, args.terms, budget)));
    const locations = await indexLocations(db, args.locations, budget);
    const remaining = left.scans.length + left.terms.length + locations.length;
    // Reschedule only real progress: an item too large for any budget stays
    // in its always-searched state instead of looping.
    const unchanged =
      left.scans.length === args.scans.length &&
      left.terms.length === args.terms.length &&
      locations.length === args.locations.length;
    if (remaining && !unchanged)
      await ctx.scheduler.runAfter(
        0,
        internal.finishedGoods.searchIndexBackfill.reindex,
        { orgId: args.orgId, ...left, locations },
      );
    return { remaining };
  },
});

export const run = internalMutation({
  args: {
    warehouseId: v.id("warehouses"),
    kind,
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
    indexed: v.number(),
    isDone: v.boolean(),
    ready: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 25;
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100)
      throw new Error("batchSize must be an integer from 1 to 100");
    const warehouse = await ctx.db.get(args.warehouseId);
    if (!warehouse) throw new Error("Warehouse not found");
    const orgId = warehouse.orgId;
    const state = await readiness(ctx, orgId, args.warehouseId, args.kind);
    const starting = args.restart === true || !args.cursor;
    // Only the newest run may index pages or declare readiness.
    if (!starting && (!state?.runId || state.runId !== args.runId))
      return {
        runId: args.runId ?? "",
        superseded: true,
        indexed: 0,
        isDone: true,
        ready: false,
        continueCursor: "",
      };
    const runId = starting ? crypto.randomUUID() : args.runId!;
    const fields = {
      ready: false,
      stale: false,
      version: VERSION[args.kind],
      runId,
    };
    if (starting) {
      if (state) await ctx.db.patch(state._id, fields);
      else
        await ctx.db.insert("searchIndexReadiness", {
          orgId,
          warehouseId: args.warehouseId,
          kind: args.kind,
          ...fields,
        });
    }
    const db = tenantDb(ctx, orgId);
    const budget = searchBudget();
    // Job scans index building names first, then scans; one native page each.
    const position = starting
      ? {
          phase: args.kind === "jobScans" ? "buildings" : "locations",
          at: null,
        }
      : (JSON.parse(args.cursor!) as { phase: string; at: string | null });
    const page = await (
      position.phase === "buildings"
        ? ctx.db
            .query("storageBuildings")
            .withIndex("by_orgId_warehouseId_code", (q) =>
              q.eq("orgId", orgId).eq("warehouseId", args.warehouseId),
            )
        : position.phase === "scans"
          ? ctx.db
              .query("finishedGoodsJobScans")
              .withIndex("by_orgId_warehouseId_createdAt", (q) =>
                q.eq("orgId", orgId).eq("warehouseId", args.warehouseId),
              )
          : ctx.db
              .query("locations")
              .withIndex("by_orgId_warehouseId_code", (q) =>
                q.eq("orgId", orgId).eq("warehouseId", args.warehouseId),
              )
    ).paginate({ cursor: position.at, numItems: batchSize });
    const ids = page.page.map((row) => row._id as string);
    const later = { scans: [] as string[], terms: [] as string[] };
    let locations: string[] = [];
    if (position.phase === "buildings")
      later.terms.push(
        ...(await indexBuildingNames(
          db,
          ids.map((buildingId) => ({
            buildingId,
            warehouseIds: [args.warehouseId],
          })),
          budget,
        )),
      );
    else if (position.phase === "scans") {
      const result = await indexJobScans(db, ids, budget, true);
      later.scans.push(...result.deferredScans, ...result.orphanScans);
      later.terms.push(...result.deferredTerms);
    } else locations = await indexLocations(db, ids, budget);
    if (later.scans.length || later.terms.length || locations.length)
      await ctx.scheduler.runAfter(
        0,
        internal.finishedGoods.searchIndexBackfill.reindex,
        { orgId, ...later, locations },
      );
    const next = !page.isDone
      ? { phase: position.phase, at: page.continueCursor }
      : position.phase === "buildings"
        ? { phase: "scans", at: null }
        : null;
    let ready = false;
    if (!next) {
      const done = await readiness(ctx, orgId, args.warehouseId, args.kind);
      // Invalidation during this run poisons it; only a restart may finish.
      ready = done !== null && done.stale !== true && done.runId === runId;
      if (done && ready) await ctx.db.patch(done._id, { ready: true });
    } else if (args.chain)
      await ctx.scheduler.runAfter(
        0,
        internal.finishedGoods.searchIndexBackfill.run,
        {
          warehouseId: args.warehouseId,
          kind: args.kind,
          cursor: JSON.stringify(next),
          batchSize,
          chain: true,
          runId,
        },
      );
    return {
      runId,
      superseded: false,
      indexed: ids.length,
      isDone: !next,
      ready,
      continueCursor: next ? JSON.stringify(next) : "",
    };
  },
});

export const invalidate = internalMutation({
  args: { warehouseId: v.id("warehouses"), kind: v.optional(kind) },
  returns: v.object({ ready: v.boolean() }),
  handler: async (ctx, args) => {
    await invalidateSearchIndex(
      ctx,
      args.warehouseId,
      args.kind ? [args.kind] : KINDS,
    );
    return { ready: false };
  },
});

/**
 * Hourly: new warehouses, fresh deployments and invalidated warehouses become
 * ready without an operator.
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
        internal.finishedGoods.searchIndexBackfill.sweep,
        { cursor: page.continueCursor },
      );
    for (const warehouse of page.page)
      for (const which of KINDS) {
        const row = await readiness(ctx, warehouse.orgId, warehouse._id, which);
        if (current(row, which)) continue;
        await ctx.scheduler.runAfter(
          0,
          internal.finishedGoods.searchIndexBackfill.run,
          {
            warehouseId: warehouse._id,
            kind: which,
            restart: true,
            chain: true,
          },
        );
        started++;
      }
    return { started, isDone: page.isDone };
  },
});
