/** Typed browser boundary for opening stock and physical-count workflows. */
import { makeFunctionReference } from "convex/server";

import type { TenantOutcome } from "./ledgerApi";
import type { MasterDataWriteOutcome } from "./masterDataApi";

export interface CountTaskQueueRow {
  readonly countTaskId: string;
  readonly countPlanId: string;
  readonly planNumber: string;
  readonly taskNumber: number;
  readonly locationId: string;
  readonly visibility: string;
}

export interface CountTaskView {
  readonly countTaskId: string;
  readonly countPlanId: string;
  readonly taskNumber: number;
  readonly status: string;
  readonly itemId: string;
  readonly locationId: string;
  readonly lotId?: string;
  readonly baseUom: string;
  readonly visibility: string;
  readonly systemSnapshotBaseMinorUnits?: number;
  readonly movementBaseMinorUnits?: number;
  readonly firstCountBaseMinorUnits?: number;
  readonly secondCountBaseMinorUnits?: number;
}

export interface CountReconciliationWork {
  readonly submitted: readonly {
    readonly countTaskId: string;
    readonly countPlanId: string;
    readonly planNumber: string;
    readonly taskNumber: number;
    readonly submittedCountOrdinal: number;
  }[];
  readonly pendingApproval: readonly {
    readonly countReconciliationId: string;
    readonly countTaskId: string;
    readonly risk: string;
    readonly systemSnapshotBaseMinorUnits: number;
    readonly inCountMovementBaseMinorUnits: number;
    readonly physicalBaseMinorUnits: number;
    readonly varianceBaseMinorUnits: number;
    readonly absoluteVarianceValueMinorUnits: number;
    readonly rootCauseCode?: string;
  }[];
}

type WriteResult = TenantOutcome<MasterDataWriteOutcome>;
type WarehouseArgs = { readonly warehouseId: string };
type RequestArgs = WarehouseArgs & { readonly requestId: string };

export const createOpeningStockBatchRef = makeFunctionReference<
  "mutation",
  RequestArgs & {
    readonly batchRef: string;
    readonly sourceFileName: string;
    readonly sourceHash: string;
    readonly cutoffAt: number;
    readonly declaredRowCount: number;
    readonly reasonCodeId: string;
  },
  WriteResult
>("inventory/openingStock:createOpeningStockBatch");

export const importOpeningStockRowsRef = makeFunctionReference<
  "mutation",
  RequestArgs & {
    readonly openingStockBatchId: string;
    readonly startSourceRowNumber: number;
    readonly rows: readonly {
      readonly sku: string;
      readonly locationCode: string;
      readonly lotCode?: string;
      readonly stockStatus: string;
      readonly entryUom: string;
      readonly entryMinorUnits: number;
    }[];
  },
  WriteResult
>("inventory/openingStock:importOpeningStockRows");

export const submitOpeningStockBatchRef = makeFunctionReference<
  "mutation",
  RequestArgs & { readonly openingStockBatchId: string },
  WriteResult
>("inventory/openingStock:submitOpeningStockBatch");

export const approveOpeningStockBatchRef = makeFunctionReference<
  "mutation",
  RequestArgs & { readonly openingStockBatchId: string },
  WriteResult
>("inventory/openingStock:approveOpeningStockBatch");

export const postNextOpeningStockChunkRef = makeFunctionReference<
  "mutation",
  RequestArgs & { readonly openingStockBatchId: string },
  WriteResult
>("inventory/openingStock:postNextOpeningStockChunk");

export const createCountPlanRef = makeFunctionReference<
  "mutation",
  RequestArgs & {
    readonly planNumber: string;
    readonly scope: "FULL" | "CYCLE" | "SPOT";
    readonly visibility: "BLIND" | "VISIBLE";
    readonly movementPolicy: "FROZEN" | "MOVEMENT_AWARE";
    readonly freezeExpiresAt?: number;
    readonly quantityThresholdBaseMinorUnits: number;
    readonly valueThresholdMinorUnits: number;
    readonly targets: readonly {
      readonly bucketKey: string;
      readonly itemClass: string;
      readonly unitValueMinorUnits: number;
    }[];
  },
  WriteResult
>("inventory/countPlans:createCountPlan");

export const releaseCountPlanRef = makeFunctionReference<
  "mutation",
  RequestArgs & { readonly countPlanId: string },
  WriteResult
>("inventory/countPlans:releaseCountPlan");

export const listAvailableCountTasksRef = makeFunctionReference<
  "query",
  WarehouseArgs,
  TenantOutcome<{ readonly tasks: readonly CountTaskQueueRow[] }>
>("inventory/countExecution:listAvailableCountTasks");

export const getAssignedCountTaskRef = makeFunctionReference<
  "query",
  WarehouseArgs & { readonly countTaskId: string },
  TenantOutcome<
    | { readonly found: true; readonly task: CountTaskView }
    | { readonly found: false }
  >
>("inventory/countExecution:getAssignedCountTask");

export const listCountReconciliationWorkRef = makeFunctionReference<
  "query",
  WarehouseArgs,
  TenantOutcome<CountReconciliationWork>
>("inventory/countExecution:listCountReconciliationWork");

export const startCountTaskRef = makeFunctionReference<
  "mutation",
  RequestArgs & { readonly countTaskId: string },
  WriteResult
>("inventory/countExecution:startCountTask");

export const captureCountTaskEntryRef = makeFunctionReference<
  "mutation",
  RequestArgs & {
    readonly countTaskId: string;
    readonly source: "HANDHELD" | "PAPER_REENTRY";
    readonly entryUom: string;
    readonly entryMinorUnits: number;
    readonly paperEvidenceId?: string;
  },
  WriteResult
>("inventory/countExecution:captureCountTaskEntry");

export const submitCountTaskRef = makeFunctionReference<
  "mutation",
  RequestArgs & { readonly countTaskId: string },
  WriteResult
>("inventory/countExecution:submitCountTask");

export const prepareCountReconciliationRef = makeFunctionReference<
  "mutation",
  RequestArgs & {
    readonly countTaskId: string;
    readonly rootCauseCode?: string;
  },
  WriteResult
>("inventory/countExecution:prepareCountReconciliation");

export const approveCountReconciliationRef = makeFunctionReference<
  "mutation",
  RequestArgs & { readonly countReconciliationId: string },
  WriteResult
>("inventory/countExecution:approveCountReconciliation");
