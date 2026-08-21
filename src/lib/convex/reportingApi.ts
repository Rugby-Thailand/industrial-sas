/**
 * Typed references to the reporting functions, and the wire types they answer.
 *
 * Hand-declared for the same reason every other API module here is:
 * `convex/_generated/` is a build artifact of `convex dev`, absent in CI and on
 * a machine that has never provisioned a deployment, so importing it would make
 * `pnpm typecheck` fail for everyone. `makeFunctionReference` needs only the path
 * and the types, and `reportingApi.test.ts` re-reads the server modules so a
 * renamed export fails here rather than at runtime.
 */
import { makeFunctionReference } from "convex/server";

import type { TenantOutcome } from "./ledgerApi";
import type { MasterDataWriteOutcome } from "./masterDataApi";

export const REPORTING_FUNCTION_PATHS = Object.freeze({
  readDashboard: "reporting/dashboard:readDashboard",
  readOccupancy: "reporting/dashboard:readOccupancy",
  verifyRollups: "reporting/rollups:verifyRollups",
  requestExport: "reporting/exports:requestExport",
  runExportChunk: "reporting/exports:runExportChunk",
  getReportJob: "reporting/exports:getReportJob",
  listReportJobs: "reporting/exports:listReportJobs",
  readStockReports: "reporting/operationalViews:readStockReports",
  readStockMovements: "reporting/operationalViews:readStockMovements",
  readOperationalExceptions:
    "reporting/operationalViews:readOperationalExceptions",
});

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

export const readDashboardRef = makeFunctionReference<
  "query",
  { readonly warehouseId: string },
  TenantOutcome<{ readonly ok: true; readonly tiles: readonly DashboardTile[] }>
>(REPORTING_FUNCTION_PATHS.readDashboard);

export type OccupancyBand = "EMPTY" | "LIGHT" | "BUSY" | "FULL";

export interface OccupancyCell {
  readonly locationId: string;
  readonly code: string;
  readonly locationType: string;
  readonly distinctBuckets: number;
  readonly band: string;
}

export const readOccupancyRef = makeFunctionReference<
  "query",
  { readonly warehouseId: string },
  TenantOutcome<{
    readonly ok: true;
    readonly cells: readonly OccupancyCell[];
    readonly shown: number;
    readonly complete: boolean;
  }>
>(REPORTING_FUNCTION_PATHS.readOccupancy);

export interface StockBalanceReportRow {
  readonly bucketKey: string;
  readonly itemId: string;
  readonly sku: string;
  readonly itemName: string;
  readonly locationId?: string;
  readonly locationCode?: string;
  readonly lotId?: string;
  readonly lotCode?: string;
  readonly expirationDate?: string;
  readonly stockStatus: string;
  readonly baseUom: string;
  readonly baseMinorUnits: number;
  readonly lastTransactionId: string;
  readonly updatedAt: number;
}

export interface StockSkuReportRow {
  readonly itemId: string;
  readonly sku: string;
  readonly itemName: string;
  readonly baseUom: string;
  readonly availableBaseMinorUnits: number;
  readonly committedBaseMinorUnits: number;
  readonly atpBaseMinorUnits: number;
  readonly qcHoldBaseMinorUnits: number;
  readonly rejectedBaseMinorUnits: number;
  readonly otherBaseMinorUnits: number;
}

export interface StockLotReportRow {
  readonly itemId: string;
  readonly sku: string;
  readonly lotId: string;
  readonly lotCode: string;
  readonly expirationDate?: string;
  readonly baseUom: string;
  readonly availableBaseMinorUnits: number;
  readonly restrictedBaseMinorUnits: number;
}

export interface StockReportsPayload {
  readonly ok: true;
  readonly asOf: number;
  readonly complete: boolean;
  readonly balances: readonly StockBalanceReportRow[];
  readonly sku: readonly StockSkuReportRow[];
  readonly lots: readonly StockLotReportRow[];
}

export const readStockReportsRef = makeFunctionReference<
  "query",
  { readonly warehouseId: string },
  TenantOutcome<StockReportsPayload>
>(REPORTING_FUNCTION_PATHS.readStockReports);

export interface StockMovementReportRow {
  readonly ledgerLineId: string;
  readonly transactionId: string;
  readonly type: string;
  readonly operation: string;
  readonly occurredAt: number;
  readonly businessDate: string;
  readonly itemId: string;
  readonly sku: string;
  readonly lotCode?: string;
  readonly location: string;
  readonly stockStatus: string;
  readonly baseUom: string;
  readonly signedBaseMinorUnits: number;
  readonly actorUserId: string;
  readonly deviceId?: string;
  readonly reversalOfTransactionId?: string;
}

export interface StockMovementsPayload {
  readonly ok: true;
  readonly asOf: number;
  readonly complete: boolean;
  readonly movements: readonly StockMovementReportRow[];
}

export const readStockMovementsRef = makeFunctionReference<
  "query",
  { readonly warehouseId: string },
  TenantOutcome<StockMovementsPayload>
>(REPORTING_FUNCTION_PATHS.readStockMovements);

export interface OperationalExceptionRow {
  readonly sourceType: string;
  readonly sourceId: string;
  readonly severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  readonly titleCode: string;
  readonly detail: string;
  readonly occurredAt: number;
  readonly ownerUserId?: string;
  readonly deepLink: string;
}

export interface OperationalExceptionsPayload {
  readonly ok: true;
  readonly asOf: number;
  readonly complete: boolean;
  readonly exceptions: readonly OperationalExceptionRow[];
}

export const readOperationalExceptionsRef = makeFunctionReference<
  "query",
  { readonly warehouseId: string },
  TenantOutcome<OperationalExceptionsPayload>
>(REPORTING_FUNCTION_PATHS.readOperationalExceptions);

export interface RollupComparison {
  readonly metric: RollupMetric;
  readonly subjectKey: string;
  readonly stored: number;
  readonly derived: number;
  readonly drifted: boolean;
}

export const verifyRollupsRef = makeFunctionReference<
  "query",
  { readonly warehouseId: string },
  TenantOutcome<{
    readonly ok: true;
    readonly checked: number;
    readonly balanced: boolean;
    readonly drifted: readonly RollupComparison[];
    readonly incomplete: boolean;
  }>
>(REPORTING_FUNCTION_PATHS.verifyRollups);

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

export const listReportJobsRef = makeFunctionReference<
  "query",
  { readonly warehouseId: string },
  TenantOutcome<{ readonly ok: true; readonly jobs: readonly ReportJobRow[] }>
>(REPORTING_FUNCTION_PATHS.listReportJobs);

export const getReportJobRef = makeFunctionReference<
  "query",
  { readonly warehouseId: string; readonly reportJobId: string },
  TenantOutcome<
    | {
        readonly found: true;
        readonly job: ReportJobRow;
        readonly artifact: string;
      }
    | { readonly found: false }
  >
>(REPORTING_FUNCTION_PATHS.getReportJob);

export const requestExportRef = makeFunctionReference<
  "mutation",
  {
    readonly requestId: string;
    readonly warehouseId: string;
    readonly kind: ReportKind;
  },
  // The shared write envelope: `documentId` is the report job's own ID, so the
  // reporting forms use the same `EntityWriteForm` contract as everything else.
  TenantOutcome<MasterDataWriteOutcome>
>(REPORTING_FUNCTION_PATHS.requestExport);

export const runExportChunkRef = makeFunctionReference<
  "mutation",
  { readonly warehouseId: string; readonly reportJobId: string },
  TenantOutcome<Record<string, unknown>>
>(REPORTING_FUNCTION_PATHS.runExportChunk);
