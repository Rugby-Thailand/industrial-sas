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

export const DASHBOARD_METRICS = Object.freeze(
  ROLLUP_METRICS.filter((metric) => !isPerSubjectMetric(metric)),
);

export const MAX_OCCUPANCY_LOCATIONS = 100;

type LocationDocument = Doc<"locations">;

const tileValidator = v.object({
  metric: rollupMetric,
  count: v.number(),

  updatedAt: v.optional(v.number()),

  suspect: v.boolean(),
});

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

export const readOccupancy = queryWithOrg({
  args: { warehouseId: v.id("warehouses") },
  returns: v.object({
    ok: v.literal(true),
    cells: v.array(occupancyCellValidator),

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

export const maxOccupancyLocations = MAX_OCCUPANCY_LOCATIONS;
export const siteSubject = SITE_SUBJECT;
