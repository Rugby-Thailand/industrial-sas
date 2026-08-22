/**
 * The supervisor's first screen, and the reads behind it (`ADR-0011` §6, §8).
 *
 * Two questions, both answered without touching a ledger line (`INV-0011-07`):
 *
 * - **How much work is waiting?** Six maintained counters, each a single indexed
 *   document read. The alternative — counting rows on demand — is a scan of the
 *   tables that grow fastest, on the screen that is opened most often, and it
 *   gets slower exactly as the pilot gets busier.
 * - **Where is the stock?** A per-location occupancy counter joined to the site's
 *   locations, laid out as a grid. Bounded on both sides: one page of locations,
 *   one page of counters.
 *
 * ### Why the tiles say when they were last touched
 *
 * A counter that has never moved and a counter that stopped moving look
 * identical. `updatedAt` travels with every tile so the screen can say "as of",
 * and so a supervisor looking at `0` can tell "nothing happened today" from
 * "this stopped being maintained in March".
 *
 * ### Why a suspect number says so
 *
 * `underflowAt` is set when a decrement would have gone below zero, which means
 * a transition was miscounted somewhere. The tile is still shown — a warehouse
 * runs on approximate backlog numbers perfectly well — but it is marked, and
 * `reporting/rollups:verifyRollups` is what settles it.
 */
import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import { bandFor } from "../model/reporting/occupancy";
import {
  ROLLUP_METRICS,
  SITE_SUBJECT,
  isPerSubjectMetric,
  type RollupMetric,
} from "../model/reporting/rollup";
import { readRollup, readRollupPage } from "../lib/rollupStore";
import { queryWithOrg } from "../lib/tenantFunctions";
import { rollupMetric } from "../lib/validators";

/** The site-wide tiles, in the order a supervisor reads them. */
export const DASHBOARD_METRICS = Object.freeze(
  ROLLUP_METRICS.filter((metric) => !isPerSubjectMetric(metric)),
);

/**
 * How many locations the occupancy map draws.
 *
 * A hard cap rather than a page loop: the map is one glance, and a warehouse
 * with more locations than this needs an aisle filter rather than a longer
 * scroll. The answer says how many were read and how many the site has, so a
 * partial map never passes for a complete one.
 */
export const MAX_OCCUPANCY_LOCATIONS = 100;

type LocationDocument = Doc<"locations">;

const tileValidator = v.object({
  metric: rollupMetric,
  count: v.number(),
  /** Absent when the counter has never been touched. */
  updatedAt: v.optional(v.number()),
  /** True when a decrement once clamped: the number is suspect until verified. */
  suspect: v.boolean(),
});

/**
 * The maintained counters for one site.
 *
 * Every declared metric is returned, including ones with no row yet, because a
 * missing tile reads as a missing feature. A counter that has never moved is
 * `0` with no `updatedAt`, which is a different and honest thing.
 */
export const readDashboard = queryWithOrg({
  args: { warehouseId: v.id("warehouses") },
  returns: v.object({ ok: v.literal(true), tiles: v.array(tileValidator) }),
  permissionCode: "reporting.dashboard.read",
  target: { table: "operationsRollups" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const tiles = [];

    for (const metric of DASHBOARD_METRICS) {
      const row = await readRollup(
        ctx.tenantDb,
        args.warehouseId,
        metric as RollupMetric,
      );
      tiles.push({
        metric: metric as never,
        count: row?.count ?? 0,
        ...(row === null ? {} : { updatedAt: row.updatedAt }),
        suspect: row?.underflowAt !== undefined,
      });
    }

    return { ok: true as const, tiles };
  },
});

const occupancyCellValidator = v.object({
  locationId: v.id("locations"),
  code: v.string(),
  locationType: v.string(),
  distinctBuckets: v.number(),
  band: v.string(),
});

/**
 * Occupancy for one site, in aisle order.
 *
 * Ordered by location code because the map's only real use is noticing that a
 * *particular* aisle is full, and cells that moved between refreshes could not
 * support that. `(orgId, warehouseId, code)` gives that order directly; the
 * counters are then joined in memory, so neither side is a scan.
 *
 * A location with no counter is included with zero. Leaving it out would draw a
 * map with holes in it, and a hole reads as "no such location" rather than as
 * "empty".
 *
 * Deactivated locations are dropped from the page after it is read rather than
 * by the index. The read is already bounded, and using the status-first index
 * would mean one read per location type and lose the single code ordering the
 * map depends on.
 *
 * `complete` is computed from the *raw* page rather than the filtered one, and
 * the read stops at the tenant page cap. A full page means there may be more
 * locations than the map drew, which is the only honest thing a capped read can
 * say — and saying it is what stops a partial map passing for a whole one.
 */
export const readOccupancy = queryWithOrg({
  args: { warehouseId: v.id("warehouses") },
  returns: v.object({
    ok: v.literal(true),
    cells: v.array(occupancyCellValidator),
    /** How many cells were drawn, so a capped map never passes for a full one. */
    shown: v.number(),
    complete: v.boolean(),
  }),
  permissionCode: "reporting.dashboard.read",
  target: { table: "locations" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const locations = await ctx.tenantDb
      .byIndex<LocationDocument>("locations", "by_orgId_warehouseId_code", [
        { field: "warehouseId", value: args.warehouseId },
      ])
      .take(MAX_OCCUPANCY_LOCATIONS);

    const shown = locations.filter((row) => row.status === "ACTIVE");

    const counters = await readRollupPage(
      ctx.tenantDb,
      args.warehouseId,
      "LOCATION_OCCUPANCY",
      MAX_OCCUPANCY_LOCATIONS,
    );
    const byLocation = new Map(
      counters.map((row) => [row.subjectKey, row.count]),
    );

    return {
      ok: true as const,
      cells: shown.map((row) => {
        const distinctBuckets = byLocation.get(row._id) ?? 0;
        return {
          locationId: row._id as never,
          code: row.code,
          locationType: row.locationType,
          distinctBuckets,
          band: bandFor(distinctBuckets),
        };
      }),
      shown: shown.length,
      complete: locations.length < MAX_OCCUPANCY_LOCATIONS,
    };
  },
});

/** Re-exported so a client and a test share one cap. */
export const maxOccupancyLocations = MAX_OCCUPANCY_LOCATIONS;
export const siteSubject = SITE_SUBJECT;
