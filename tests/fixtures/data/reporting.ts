/**
 * Synthetic reporting data, in the server's own wire shapes.
 *
 * The same contract as the other preview modules: not a fake backend, no writes,
 * every identifier prefixed `prv_`, and a banner on every screen it reaches. It
 * exists so the dashboard tiles, the occupancy map, and the export register can
 * be judged for Thai wrapping, colour contrast, and legibility before an
 * identity provider exists.
 *
 * The numbers are deliberately uneven. A fixture where every tile read `0` — or
 * where every location was equally full — would look correct and would prove
 * nothing about whether a busy aisle is findable at a glance.
 */
import type {
  DashboardTile,
  OccupancyCell,
  ReportJobRow,
} from "@/lib/convex/reportingApi";

import { previewLocationsFor } from "./masterData";

/**
 * The tiles, with one deliberately marked suspect.
 *
 * `QC_PARKED` carries the `suspect` flag so the preview exercises the state a
 * real deployment reaches after a miscounted transition — the marker has to be
 * visible and understandable before anybody meets it on a live site.
 */
export const previewDashboardTiles = (): readonly DashboardTile[] =>
  Object.freeze([
    Object.freeze({
      metric: "RECEIPTS_OPENED" as const,
      count: 18,
      updatedAt: 1_754_900_000_000,
      suspect: false,
    }),
    Object.freeze({
      metric: "RECEIPT_LINES_POSTED" as const,
      count: 64,
      updatedAt: 1_754_900_100_000,
      suspect: false,
    }),
    Object.freeze({
      metric: "QC_PENDING" as const,
      count: 3,
      updatedAt: 1_754_900_200_000,
      suspect: false,
    }),
    Object.freeze({
      metric: "QC_PARKED" as const,
      count: 1,
      updatedAt: 1_754_900_300_000,
      suspect: true,
    }),
    Object.freeze({
      metric: "PUTAWAY_READY" as const,
      count: 7,
      updatedAt: 1_754_900_400_000,
      suspect: false,
    }),
    Object.freeze({
      metric: "PUTAWAY_CLAIMED" as const,
      count: 2,
      updatedAt: 1_754_900_500_000,
      suspect: false,
    }),
  ]);

/** Distinct-bucket counts per location code, chosen to span all four bands. */
const OCCUPANCY_BY_CODE: Readonly<Record<string, number>> = Object.freeze({
  "A01-02-1": 9,
  "B04-11-3": 5,
  "C02-01-2": 2,
  "D01-01-1": 0,
  "DOCK-IN-1": 4,
  "F01-03-2": 11,
  "STAGE-OUT": 1,
});

const bandFor = (buckets: number): string => {
  if (buckets <= 0) return "EMPTY";
  if (buckets >= 8) return "FULL";
  if (buckets >= 4) return "BUSY";
  return "LIGHT";
};

/** Occupancy for one warehouse, in the same code order the server answers in. */
export const previewOccupancyFor = (
  warehouseId: string,
): readonly OccupancyCell[] =>
  previewLocationsFor(warehouseId).map((location) => {
    const distinctBuckets = OCCUPANCY_BY_CODE[location.code] ?? 0;
    return Object.freeze({
      locationId: location.locationId,
      code: location.code,
      locationType: location.locationType,
      distinctBuckets,
      band: bandFor(distinctBuckets),
    });
  });

/**
 * The export register, with one of each ending.
 *
 * A failed job is included on purpose: `ARTIFACT_LIMIT_REACHED` is the state
 * that must never look like a finished download, and the only way to be sure the
 * screen says so is to render it.
 */
export const PREVIEW_REPORT_JOBS: readonly ReportJobRow[] = Object.freeze([
  Object.freeze({
    reportJobId: "prv_rpt_7001",
    kind: "INVENTORY_BALANCES" as const,
    status: "COMPLETE" as const,
    rowCount: 128,
    artifactBytes: 14_820,
    requestedAt: 1_754_800_000_000,
    completedAt: 1_754_800_060_000,
  }),
  Object.freeze({
    reportJobId: "prv_rpt_7002",
    kind: "RECEIPT_LINES" as const,
    status: "RUNNING" as const,
    rowCount: 40,
    artifactBytes: 4_210,
    requestedAt: 1_754_800_200_000,
  }),
  Object.freeze({
    reportJobId: "prv_rpt_7003",
    kind: "PUTAWAY_TASKS" as const,
    status: "FAILED" as const,
    rowCount: 9_512,
    artifactBytes: 524_288,
    requestedAt: 1_754_800_400_000,
    completedAt: 1_754_800_900_000,
    failureCode: "ARTIFACT_LIMIT_REACHED",
  }),
]);

export const previewReportJobById = (
  reportJobId: string,
): ReportJobRow | undefined =>
  PREVIEW_REPORT_JOBS.find((job) => job.reportJobId === reportJobId);

/**
 * A small rendered artifact, for the download control.
 *
 * Carries the byte-order mark and CRLF endings the server's renderer emits, so
 * what a reviewer downloads in preview is byte-shaped like the real thing —
 * including the Thai that would turn to mojibake without the mark.
 */
export const PREVIEW_ARTIFACT = `﻿bucketKey,itemId,locationId,stockStatus,uom,quantity\r
prv_bucket_1,prv_item_steel_coil,prv_loc_A01-02-1,AVAILABLE,KG,180.000\r
prv_bucket_2,prv_item_bolt_m8,prv_loc_B04-11-3,AVAILABLE,EA,480.000\r
`;
