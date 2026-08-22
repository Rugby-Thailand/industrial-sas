/**
 * Typed references to the reporting functions, and the wire types they answer.
 *
 * Function references come from Convex code generation; the named row types are
 * the smaller presentation vocabulary used by the reporting screens.
 */
import { api } from "../../../convex/_generated/api";

import { clientRef } from "./clientRef";

/** Every maintained metric a tile can show. Mirrors the server's closed set. */
export type RollupMetric =
  | "RECEIPTS_OPENED"
  | "RECEIPT_LINES_POSTED"
  | "QC_PENDING"
  | "QC_PARKED"
  | "PUTAWAY_READY"
  | "PUTAWAY_CLAIMED"
  | "LOCATION_OCCUPANCY";

export interface DashboardTile {
  readonly metric: RollupMetric;
  readonly count: number;
  /** Absent when the counter has never been touched — not the same as zero. */
  readonly updatedAt?: number;
  /** A decrement once clamped, so the number is suspect until verified. */
  readonly suspect: boolean;
}

export const readDashboardRef = clientRef(
  api.reporting.dashboard.readDashboard,
);

export type OccupancyBand = "EMPTY" | "LIGHT" | "BUSY" | "FULL";

export interface OccupancyCell {
  readonly locationId: string;
  readonly code: string;
  readonly locationType: string;
  readonly distinctBuckets: number;
  readonly band: string;
}

export const readOccupancyRef = clientRef(
  api.reporting.dashboard.readOccupancy,
);

export interface RollupComparison {
  readonly metric: RollupMetric;
  readonly subjectKey: string;
  readonly stored: number;
  readonly derived: number;
  readonly drifted: boolean;
}

export type ReportKind =
  "INVENTORY_BALANCES" | "RECEIPT_LINES" | "PUTAWAY_TASKS";

export type ReportJobStatus = "QUEUED" | "RUNNING" | "COMPLETE" | "FAILED";

export interface ReportJobRow {
  readonly reportJobId: string;
  readonly kind: ReportKind;
  readonly status: ReportJobStatus;
  readonly rowCount: number;
  readonly artifactBytes: number;
  readonly requestedAt: number;
  readonly completedAt?: number;
  readonly failureCode?: string;
}

export const listReportJobsRef = clientRef(
  api.reporting.exports.listReportJobs,
);
export const getReportJobRef = clientRef(api.reporting.exports.getReportJob);
export const requestExportRef = clientRef(api.reporting.exports.requestExport);
export const runExportChunkRef = clientRef(
  api.reporting.exports.runExportChunk,
);
