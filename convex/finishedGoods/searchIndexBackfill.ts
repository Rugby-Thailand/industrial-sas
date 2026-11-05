/**
 * Operational migration and repair for the derived search indexes
 * (convex/lib/jobScanSearch.ts, convex/lib/locationSearch.ts). The tenant is
 * derived from the warehouse (or, for scheduled re-indexing, carried from the
 * writing transaction), never supplied by a client. Run with `restart: true`,
 * then pass each `continueCursor` and `runId` back until `ready`.
 *
 * `reconcile` (every minute, through `reconcileSweep`) repairs what writers
 * that do not maintain the indexes left behind; see
 * convex/lib/searchReadiness.ts for the markers readers check meanwhile.
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
  scanSourceHash,
  searchBudget,
  type SearchBudget,
} from "../lib/jobScanSearch";
import { indexLocations, LOCATION_SEARCH_VERSION } from "../lib/locationSearch";
import {
  currentSearchReadiness,
  layoutGeneration,
  RECONCILE_MARGIN_MS,
  type CurrentSearchReadiness,
} from "../lib/searchReadiness";

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

/** Reconcile progress of one index (never read by search readers). */
async function reconcileProgress(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  warehouseId: Id<"warehouses">,
  which: Kind,
) {
  const row = await ctx.db
    .query("searchIndexReconcile")
    .withIndex("by_orgId_warehouseId_kind", (q) =>
      q.eq("orgId", orgId).eq("warehouseId", warehouseId).eq("kind", which),
    )
    .unique();
  if (row) return row;
  // Unknown progress: reconcile everything (safe, paged).
  const id = await ctx.db.insert("searchIndexReconcile", {
    orgId,
    warehouseId,
    kind: which,
    watermark: 0,
  });
  return (await ctx.db.get(id))!;
}

const current = (
  row: Doc<"searchIndexReadiness"> | null,
  which: Kind,
): row is CurrentSearchReadiness => currentSearchReadiness(row, VERSION[which]);

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
    const db = tenantDb(ctx, orgId);
    if (starting) {
      const fields = {
        ready: false,
        stale: false,
        version: VERSION[args.kind],
        runId,
        // Maintained layout writes carry this along from here on.
        layoutGeneration: await layoutGeneration(db, args.warehouseId),
      };
      // Rows written from here on (less the in-flight margin) by code that
      // does not maintain the index may escape the pages below: reconcile
      // looks at them.
      const progress = await reconcileProgress(
        ctx,
        orgId,
        args.warehouseId,
        args.kind,
      );
      await ctx.db.patch(progress._id, {
        watermark: Date.now() - RECONCILE_MARGIN_MS,
        reconcile: undefined,
      });
      if (state) await ctx.db.patch(state._id, fields);
      else
        await ctx.db.insert("searchIndexReadiness", {
          orgId,
          warehouseId: args.warehouseId,
          kind: args.kind,
          ...fields,
        });
    }
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

type Phase = "updated" | "created";
/** Job scans: changed (`updatedAt`), then created (`_creationTime`). */
const PHASES: Record<Kind, readonly Phase[]> = {
  jobScans: ["updated", "created"],
  locations: ["created"],
};
const RECONCILE_PAGE = 50;
/** More buildings than this re-index through a full rebuild instead. */
const REPAIR_BUILDINGS = 100;
/** A pass that has not moved for this long is resumed by the sweep. */
const RECONCILE_STALL_MS = 120_000;

/** Rows a reconcile phase covers: written in [from, upper). */
function windowRows(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  warehouseId: Id<"warehouses">,
  which: Kind,
  phase: Phase,
  from: number,
  upper: number,
) {
  if (which === "locations")
    return {
      locations: ctx.db
        .query("locations")
        .withIndex("by_orgId_warehouseId", (q) =>
          q
            .eq("orgId", orgId)
            .eq("warehouseId", warehouseId)
            .gte("_creationTime", from)
            .lt("_creationTime", upper),
        ),
    };
  const scans = ctx.db.query("finishedGoodsJobScans");
  return {
    scans:
      phase === "updated"
        ? scans.withIndex("by_orgId_warehouseId_updatedAt", (q) =>
            q
              .eq("orgId", orgId)
              .eq("warehouseId", warehouseId)
              .gte("updatedAt", from)
              .lt("updatedAt", upper),
          )
        : scans.withIndex("by_orgId_warehouseId", (q) =>
            q
              .eq("orgId", orgId)
              .eq("warehouseId", warehouseId)
              .gte("_creationTime", from)
              .lt("_creationTime", upper),
          ),
  };
}

/** A building of the warehouse created in [from, upper), if any. */
function createdBuilding(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  warehouseId: Id<"warehouses">,
  from: number,
  upper = Infinity,
) {
  return ctx.db
    .query("storageBuildings")
    .withIndex("by_orgId_warehouseId", (q) =>
      q
        .eq("orgId", orgId)
        .eq("warehouseId", warehouseId)
        .gte("_creationTime", from)
        .lt("_creationTime", upper),
    )
    .first();
}

/**
 * Re-derive building names after an unmaintained layout write, or only newly
 * created buildings when the layout marker is current. Unchanged names cost
 * two reads. Null when the selected range exceeds one transaction's bound.
 */
async function repairBuildingNames(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  warehouseId: Id<"warehouses">,
  budget: SearchBudget,
  createdSince?: number,
) {
  const buildings = await (
    createdSince === undefined
      ? ctx.db
          .query("storageBuildings")
          .withIndex("by_orgId_warehouseId_code", (q) =>
            q.eq("orgId", orgId).eq("warehouseId", warehouseId),
          )
      : ctx.db
          .query("storageBuildings")
          .withIndex("by_orgId_warehouseId", (q) =>
            q
              .eq("orgId", orgId)
              .eq("warehouseId", warehouseId)
              .gte("_creationTime", createdSince),
          )
  ).take(REPAIR_BUILDINGS + 1);
  if (buildings.length > REPAIR_BUILDINGS) return null;
  return indexBuildingNames(
    tenantDb(ctx, orgId),
    buildings.map((building) => ({
      buildingId: building._id,
      warehouseIds: [warehouseId],
    })),
    budget,
  );
}

/**
 * Bring an index up to date with writes that did not maintain it, so its
 * readers can trust it again:
 *
 * - The layout counter moved without the index (`layoutGeneration`), or a
 *   building was created since the watermark: job scans re-derive building
 *   names here; picker postings are rebuilt by a restarted build.
 * - Rows written in [watermark, now - margin): job scans whose search row was
 *   built from other field values (`sourceHash`) are re-indexed; locations
 *   are compared posting by posting. A window of up to 50 rows per phase is
 *   done in this transaction; a larger one in pages, one per transaction,
 *   over the same fixed window. The watermark moves to the window's end only
 *   after every phase is done. Readers trust a current layout marker;
 *   unmaintained writes become visible when this repair reaches them.
 *
 * `checked` counts rows looked at; `reindexed` counts scans re-indexed and
 * locations compared. Only `continuation` calls (scheduled by a pass)
 * continue a pass without starting a new one, so one pass never spawns a
 * second chain.
 */
export const reconcile = internalMutation({
  args: {
    warehouseId: v.id("warehouses"),
    kind,
    continuation: v.optional(v.boolean()),
  },
  returns: v.object({
    status: v.union(
      v.literal("skipped"),
      v.literal("idle"),
      v.literal("rebuilding"),
      v.literal("continuing"),
      v.literal("done"),
    ),
    checked: v.number(),
    reindexed: v.number(),
  }),
  handler: async (ctx, args) => {
    const result = (
      status: "skipped" | "idle" | "rebuilding" | "continuing" | "done",
      checked = 0,
      reindexed = 0,
    ) => ({ status, checked, reindexed });
    const warehouse = await ctx.db.get(args.warehouseId);
    if (!warehouse) return result("skipped");
    const orgId = warehouse.orgId;
    const state = await readiness(ctx, orgId, args.warehouseId, args.kind);
    if (!current(state, args.kind)) return result("skipped");
    const progress = await reconcileProgress(
      ctx,
      orgId,
      args.warehouseId,
      args.kind,
    );
    const db = tenantDb(ctx, orgId);
    const budget = searchBudget();
    const later = { scans: [] as string[], terms: [] as string[] };
    let locations: string[] = [];
    const schedule = async () => {
      if (later.scans.length || later.terms.length || locations.length)
        await ctx.scheduler.runAfter(
          0,
          internal.finishedGoods.searchIndexBackfill.reindex,
          { orgId, ...later, locations },
        );
    };

    const generation = await layoutGeneration(db, args.warehouseId);
    // A building created since the watermark (raw inserts move no counter):
    // re-derive names when a pass starts; the pass only covers buildings
    // created before its window's end, which all exist by then.
    const built =
      args.kind === "jobScans" && !progress.reconcile && !args.continuation
        ? await createdBuilding(
            ctx,
            orgId,
            args.warehouseId,
            progress.watermark,
          )
        : null;
    if (state.layoutGeneration !== generation || built) {
      const deferred =
        args.kind === "jobScans"
          ? await repairBuildingNames(
              ctx,
              orgId,
              args.warehouseId,
              budget,
              state.layoutGeneration === generation
                ? progress.watermark
                : undefined,
            )
          : null;
      if (!deferred) {
        // Readers already skip this index; rebuild it under a new run.
        await ctx.scheduler.runAfter(
          0,
          internal.finishedGoods.searchIndexBackfill.run,
          {
            warehouseId: args.warehouseId,
            kind: args.kind,
            restart: true,
            chain: true,
          },
        );
        return result("rebuilding");
      }
      later.terms.push(...deferred);
      if (state.layoutGeneration !== generation)
        await ctx.db.patch(state._id, { layoutGeneration: generation });
    }

    // Job scans whose search rows were built from other field values (or
    // not at all); locations are compared posting by posting.
    let checked = 0;
    let reindexed = 0;
    const reconcileRows = async (
      rows: readonly (Doc<"finishedGoodsJobScans"> | Doc<"locations">)[],
    ) => {
      checked += rows.length;
      if (args.kind === "locations") {
        reindexed += rows.length;
        locations.push(
          ...(await indexLocations(
            db,
            rows.map((row) => row._id as string),
            budget,
          )),
        );
        return;
      }
      const stale: string[] = [];
      for (const scan of rows as readonly Doc<"finishedGoodsJobScans">[]) {
        const row = await ctx.db
          .query("finishedGoodsJobScanSearchRows")
          .withIndex("by_orgId_scanId", (q) =>
            q.eq("orgId", orgId).eq("scanId", scan._id),
          )
          .first();
        if (row?.sourceHash !== (await scanSourceHash(scan)))
          stale.push(scan._id);
      }
      reindexed += stale.length;
      if (!stale.length) return;
      const indexed = await indexJobScans(db, stale, budget, true);
      later.scans.push(...indexed.deferredScans, ...indexed.orphanScans);
      later.terms.push(...indexed.deferredTerms);
    };
    const now = Date.now();
    const phases = PHASES[args.kind];
    let pass = progress.reconcile;
    if (!pass) {
      const upper = now - RECONCILE_MARGIN_MS;
      if (args.continuation || upper <= progress.watermark) {
        await schedule();
        return result("idle");
      }
      // Usually the whole window fits one transaction.
      const windows = await Promise.all(
        phases.map((phase) => {
          const rows = windowRows(
            ctx,
            orgId,
            args.warehouseId,
            args.kind,
            phase,
            progress.watermark,
            upper,
          );
          return rows.scans
            ? rows.scans.take(RECONCILE_PAGE + 1)
            : rows.locations.take(RECONCILE_PAGE + 1);
        }),
      );
      if (windows.every((rows) => rows.length <= RECONCILE_PAGE)) {
        const unique = new Map(
          windows.flat().map((row) => [row._id as string, row] as const),
        );
        await reconcileRows([...unique.values()]);
        await schedule();
        await ctx.db.patch(progress._id, { watermark: upper });
        return result("done", checked, reindexed);
      }
      pass = { upper, phase: phases[0]!, cursor: null, at: now };
    }
    // A large window: one page of one phase per transaction.
    const rows = windowRows(
      ctx,
      orgId,
      args.warehouseId,
      args.kind,
      pass.phase,
      progress.watermark,
      pass.upper,
    );
    const page = rows.scans
      ? await rows.scans.paginate({
          cursor: pass.cursor,
          numItems: RECONCILE_PAGE,
        })
      : await rows.locations.paginate({
          cursor: pass.cursor,
          numItems: RECONCILE_PAGE,
        });
    await reconcileRows(page.page);
    await schedule();
    const nextPhase = phases[phases.indexOf(pass.phase) + 1];
    const next = !page.isDone
      ? { ...pass, cursor: page.continueCursor, at: now }
      : nextPhase
        ? { ...pass, phase: nextPhase, cursor: null, at: now }
        : null;
    if (!next) {
      await ctx.db.patch(progress._id, {
        watermark: pass.upper,
        reconcile: undefined,
      });
      return result("done", checked, reindexed);
    }
    await ctx.db.patch(progress._id, { reconcile: next });
    await ctx.scheduler.runAfter(
      0,
      internal.finishedGoods.searchIndexBackfill.reconcile,
      { warehouseId: args.warehouseId, kind: args.kind, continuation: true },
    );
    return result("continuing", checked, reindexed);
  },
});

/**
 * Every minute: start `reconcile` for each built index with something to do
 * (a layout write that bypassed it, rows written since its watermark, or a
 * stalled pass). Idle indexes cost their readiness row, the layout counter
 * and one empty index probe per phase; nothing is written.
 */
export const reconcileSweep = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.object({ scheduled: v.number(), isDone: v.boolean() }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("searchIndexReadiness")
      .paginate({ cursor: args.cursor ?? null, numItems: 50 });
    if (!page.isDone)
      await ctx.scheduler.runAfter(
        0,
        internal.finishedGoods.searchIndexBackfill.reconcileSweep,
        { cursor: page.continueCursor },
      );
    const now = Date.now();
    const upper = now - RECONCILE_MARGIN_MS;
    const generations = new Map<string, Promise<number>>();
    let scheduled = 0;
    for (const row of page.page) {
      if (!current(row, row.kind)) continue;
      const progress = await reconcileProgress(
        ctx,
        row.orgId,
        row.warehouseId,
        row.kind,
      );
      let generation = generations.get(row.warehouseId);
      if (!generation)
        generations.set(
          row.warehouseId,
          (generation = layoutGeneration(
            tenantDb(ctx, row.orgId),
            row.warehouseId,
          )),
        );
      let due =
        (await generation) !== row.layoutGeneration ||
        (progress.reconcile !== undefined &&
          progress.reconcile.at < now - RECONCILE_STALL_MS);
      if (!due && !progress.reconcile && upper > progress.watermark)
        due =
          row.kind === "jobScans" &&
          (await createdBuilding(
            ctx,
            row.orgId,
            row.warehouseId,
            progress.watermark,
            upper,
          )) !== null;
      if (!due && !progress.reconcile && upper > progress.watermark)
        for (const phase of PHASES[row.kind]) {
          const rows = windowRows(
            ctx,
            row.orgId,
            row.warehouseId,
            row.kind,
            phase,
            progress.watermark,
            upper,
          );
          if (await (rows.scans ?? rows.locations).first()) {
            due = true;
            break;
          }
        }
      if (!due) continue;
      await ctx.scheduler.runAfter(
        0,
        internal.finishedGoods.searchIndexBackfill.reconcile,
        { warehouseId: row.warehouseId, kind: row.kind },
      );
      scheduled++;
    }
    return { scheduled, isDone: page.isDone };
  },
});
