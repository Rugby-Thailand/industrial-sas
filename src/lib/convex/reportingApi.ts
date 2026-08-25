import { api } from "../../../convex/_generated/api";
import type {
  DashboardActionId,
  DashboardSelectionErrorCode,
} from "../../../convex/model/reporting/dashboardPreferences";

import { clientRef } from "./clientRef";

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

  readonly updatedAt?: number;

  readonly suspect: boolean;
}

export const readDashboardRef = clientRef(
  api.reporting.dashboard.readDashboard,
);

export interface DashboardPreferencePayload {
  readonly pageKey: "OWNER_DASHBOARD";
  readonly presetVersion: number;
  readonly customized: boolean;
  readonly selectedActionIds: readonly DashboardActionId[];
  readonly availableActionIds: readonly DashboardActionId[];
  readonly updatedAt?: number;
}

export type DashboardPreferenceWriteResult =
  | {
      readonly accepted: true;
      readonly preference: DashboardPreferencePayload;
    }
  | { readonly accepted: false; readonly code: DashboardSelectionErrorCode };

export const readDashboardPreferencesRef = clientRef(
  api.reporting.dashboardPreferences.readPreferences,
);
export const updateDashboardPreferencesRef = clientRef(
  api.reporting.dashboardPreferences.updatePreferences,
);
export const resetDashboardPreferencesRef = clientRef(
  api.reporting.dashboardPreferences.resetPreferences,
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

export const readStockReportsRef = clientRef(
  api.reporting.operationalViews.readStockReports,
);

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

export const readStockMovementsRef = clientRef(
  api.reporting.operationalViews.readStockMovements,
);

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

export const readOperationalExceptionsRef = clientRef(
  api.reporting.operationalViews.readOperationalExceptions,
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
