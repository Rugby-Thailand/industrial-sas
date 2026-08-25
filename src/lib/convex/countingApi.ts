/** Typed browser boundary for opening stock and physical-count workflows. */
import { api } from "../../../convex/_generated/api";

import { clientRef, type RefValue } from "./clientRef";

export interface CountTaskQueueRow {
  readonly countTaskId: string;
  readonly countPlanId: string;
  readonly planNumber: string;
  readonly taskNumber: number;
  readonly locationId: string;
  readonly visibility: string;
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

export const createOpeningStockBatchRef = clientRef(
  api.inventory.openingStock.createOpeningStockBatch,
);

export const importOpeningStockRowsRef = clientRef(
  api.inventory.openingStock.importOpeningStockRows,
);

export const submitOpeningStockBatchRef = clientRef(
  api.inventory.openingStock.submitOpeningStockBatch,
);

export const approveOpeningStockBatchRef = clientRef(
  api.inventory.openingStock.approveOpeningStockBatch,
);

export const postNextOpeningStockChunkRef = clientRef(
  api.inventory.openingStock.postNextOpeningStockChunk,
);

export const createCountPlanRef = clientRef(
  api.inventory.countPlans.createCountPlan,
);

export const releaseCountPlanRef = clientRef(
  api.inventory.countPlans.releaseCountPlan,
);

export const listAvailableCountTasksRef = clientRef(
  api.inventory.countExecution.listAvailableCountTasks,
);

export const getAssignedCountTaskRef = clientRef(
  api.inventory.countExecution.getAssignedCountTask,
);

export type CountTaskView = RefValue<typeof getAssignedCountTaskRef>;

export const listCountReconciliationWorkRef = clientRef(
  api.inventory.countExecution.listCountReconciliationWork,
);

export const startCountTaskRef = clientRef(
  api.inventory.countExecution.startCountTask,
);

export const captureCountTaskEntryRef = clientRef(
  api.inventory.countExecution.captureCountTaskEntry,
);

export const submitCountTaskRef = clientRef(
  api.inventory.countExecution.submitCountTask,
);

export const prepareCountReconciliationRef = clientRef(
  api.inventory.countExecution.prepareCountReconciliation,
);

export const approveCountReconciliationRef = clientRef(
  api.inventory.countExecution.approveCountReconciliation,
);
