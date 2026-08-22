/**
 * Typed references to the inbound slice's functions, and their wire types.
 *
 * Function references come from Convex code generation. The named row and
 * outcome types remain the presentation vocabulary shared by inbound screens.
 *
 * Every write reference infers its required `requestId` from the server. The key
 * makes a retry a replay instead of a duplicate receipt, so it must not be
 * restated in a second client-owned contract that can drift.
 */
import { api } from "../../../convex/_generated/api";

import { clientRef } from "./clientRef";

/* -------------------------------------------------------------------------- */
/* Row shapes                                                                  */
/* -------------------------------------------------------------------------- */

export type PurchaseOrderStatus = "DRAFT" | "OPEN" | "CLOSED" | "CANCELLED";
export type PurchaseOrderLineStatus =
  "OPEN" | "COMPLETE" | "CLOSED_SHORT" | "CANCELLED";

export interface Quantity {
  readonly uom: string;
  readonly minorUnits: number;
}

export interface PurchaseOrderRow {
  readonly purchaseOrderId: string;
  readonly warehouseId: string;
  readonly poNumber: string;
  readonly supplierId: string;
  readonly status: PurchaseOrderStatus;
  readonly externalRef?: string;
}

export interface PurchaseOrderLineRow {
  readonly purchaseOrderLineId: string;
  readonly purchaseOrderId: string;
  readonly lineNumber: number;
  readonly itemId: string;
  /** In the unit the order was written in — cases, drums, whatever was bought. */
  readonly orderedQuantity: Quantity;
  readonly orderedBaseMinorUnits: number;
  readonly receivedBaseMinorUnits: number;
  /**
   * The item's base unit: the unit both `*BaseMinorUnits` figures are in.
   *
   * Absent only when the line's item could not be read, which is a dangling
   * reference rather than a state a screen can do anything about. A quantity
   * whose unit is unknown is shown as unrenderable rather than as a bare number,
   * because a bare number next to "40.000 CASE" reads as cases.
   */
  readonly baseUom?: string;
  readonly status: PurchaseOrderLineStatus;
}

export type ReceiptLineKind =
  "ORDERED" | "UNEXPECTED" | "CANCELLED_LINE" | "BLIND";

export type ReceiptClassification =
  "PARTIAL" | "COMPLETE" | "OVER_WITHIN_TOLERANCE" | "OVER_BEYOND_TOLERANCE";

export type LandedStockStatus =
  "AVAILABLE" | "QC_HOLD" | "QUARANTINE" | "REJECTED" | "SCRAP" | "EXPIRED";

export interface ReceiptRow {
  readonly receiptId: string;
  readonly warehouseId: string;
  readonly receiptNumber: string;
  /** The order behind the receipt. What the screens navigate by, never shown. */
  readonly purchaseOrderId?: string;
  /**
   * That order's number, as the purchasing register shows it (`PO-2601`).
   *
   * What a receiving screen displays. Absent for a blind receipt, which has no
   * order at all, and for an order that could not be read.
   */
  readonly poNumber?: string;
  readonly occurredAt: number;
  readonly businessDate: string;
}

export interface ReceiptLineRow {
  readonly receiptLineId: string;
  readonly receiptId: string;
  readonly itemId: string;
  readonly lotId?: string;
  readonly handlingUnitId?: string;
  readonly capturedQuantity: Quantity;
  readonly baseMinorUnits: number;
  readonly kind: ReceiptLineKind;
  readonly classification: ReceiptClassification;
  readonly stockStatus: LandedStockStatus;
  readonly transactionId: string;
}

export type InspectionStatus =
  "OPEN" | "PENDING_APPROVAL" | "DISPOSED" | "CANCELLED";

export type QcDisposition =
  "RELEASE" | "QUARANTINE" | "REJECT" | "SCRAP" | "REWORK";

export interface InspectionRow {
  readonly inspectionId: string;
  readonly warehouseId: string;
  readonly receiptLineId: string;
  readonly itemId: string;
  readonly status: InspectionStatus;
  readonly strategy: "ALL" | "FIXED" | "PERCENT";
  readonly sampleSize: number;
  readonly lotSize: number;
  readonly disposition?: QcDisposition;
}

export type PutawayTaskStatus = "READY" | "CLAIMED" | "CONFIRMED" | "CANCELLED";

export interface PutawayTaskRow {
  readonly putawayTaskId: string;
  readonly warehouseId: string;
  readonly receiptLineId: string;
  readonly itemId: string;
  readonly lotId?: string;
  readonly handlingUnitId?: string;
  readonly baseMinorUnits: number;
  /**
   * The item's base unit: the unit `baseMinorUnits` is counted in.
   *
   * Joined from the item document, exactly as `PurchaseOrderLineRow.baseUom`
   * is, and absent for the same reason — a task whose item cannot be read. A
   * putaway board holds kilograms, litres, and eaches side by side, so a bare
   * figure in that column is three different measures rendered as one.
   */
  readonly baseUom?: string;
  readonly fromLocationId: string;
  readonly status: PutawayTaskStatus;
  readonly claimedByUserId?: string;
  readonly recommendedLocationId?: string;
  readonly chosenLocationId?: string;
}

export interface PrintJobRow {
  readonly labelPrintJobId: string;
  readonly templateCode: string;
  readonly templateVersion: number;
  readonly targetKind: string;
  readonly targetId: string;
  readonly payloadHash: string;
  readonly reason: "INITIAL" | "REPRINT" | "PREVIEW";
  /** Never `PRINTED`: nothing here can observe a printer (`INT-04` absent). */
  readonly status: "GENERATED" | "DISPATCHED" | "FAILED";
  readonly occurredAt: number;
}

/* -------------------------------------------------------------------------- */
/* Recommendation and import shapes                                            */
/* -------------------------------------------------------------------------- */

export interface ScoreComponent {
  readonly name: string;
  readonly weight: number;
  readonly points: number;
}

export interface RankedLocation {
  readonly locationId: string;
  readonly code: string;
  readonly score: number;
  readonly components: readonly ScoreComponent[];
  readonly viaOverflow: boolean;
}

export interface RejectedLocation {
  readonly locationId: string;
  readonly code: string;
  readonly reason: string;
}

export type PutawayRecommendationOutcome =
  | {
      readonly ok: true;
      readonly ranked: readonly RankedLocation[];
      readonly rejected: readonly RejectedLocation[];
      readonly filtersApplied: readonly string[];
    }
  | { readonly ok: false; readonly error: { readonly code: string } };

export interface ImportRow {
  readonly sourceRowRef: string;
  readonly sourceLine: number;
  readonly lineNumber: number;
  readonly sku: string;
  readonly quantityMinorUnits: number;
  readonly uom: string;
}

export interface RejectedImportRow {
  readonly sourceLine: number;
  readonly code: string;
  readonly column?: string;
}

export type ImportPreviewOutcome =
  | {
      readonly ok: true;
      readonly batchRef: string;
      readonly accepted: readonly ImportRow[];
      readonly rejected: readonly RejectedImportRow[];
      readonly empty: boolean;
    }
  | { readonly ok: false; readonly error: { readonly code: string } };

/* -------------------------------------------------------------------------- */
/* Query references                                                            */
/* -------------------------------------------------------------------------- */

export const listPurchaseOrdersRef = clientRef(
  api.purchasing.orders.listPurchaseOrders,
);
export const listPurchaseOrderLinesRef = clientRef(
  api.purchasing.orders.listPurchaseOrderLines,
);
export const previewPurchaseOrderImportRef = clientRef(
  api.purchasing.orders.previewPurchaseOrderImport,
);

export const getReceiptRef = clientRef(api.receiving.receipts.getReceipt);
export const listReceiptsRef = clientRef(api.receiving.receipts.listReceipts);
export const listReceiptLinesRef = clientRef(
  api.receiving.receipts.listReceiptLines,
);
export const listInspectionsRef = clientRef(
  api.quality.inspections.listInspections,
);
export const listPutawayTasksRef = clientRef(
  api.putaway.tasks.listPutawayTasks,
);
export const recommendPutawayLocationsRef = clientRef(
  api.putaway.tasks.recommendPutawayLocations,
);
export const listPrintJobsForTargetRef = clientRef(
  api.labels.print.listPrintJobsForTarget,
);

/* -------------------------------------------------------------------------- */
/* Mutation references                                                         */
/* -------------------------------------------------------------------------- */

export const createPurchaseOrderRef = clientRef(
  api.purchasing.orders.createPurchaseOrder,
);
export const addPurchaseOrderLineRef = clientRef(
  api.purchasing.orders.addPurchaseOrderLine,
);
export const closeLineShortRef = clientRef(
  api.purchasing.orders.closeLineShort,
);
export const applyPurchaseOrderImportChunkRef = clientRef(
  api.purchasing.orders.applyPurchaseOrderImportChunk,
);
export const openReceiptRef = clientRef(api.receiving.receipts.openReceipt);
export const postReceiptLineRef = clientRef(
  api.receiving.receipts.postReceiptLine,
);
export const raiseReceivingExceptionRef = clientRef(
  api.receiving.receipts.raiseReceivingException,
);
export const buildHandlingUnitRef = clientRef(
  api.receiving.receipts.buildHandlingUnit,
);
export const submitDispositionRef = clientRef(
  api.quality.inspections.submitDisposition,
);

/**
 * Approving a parked disposition.
 *
 * Maker-checker plus step-up. The submitter is denied by the evaluator, and the
 * screen shows that denial rather than hiding the control: an inspector who
 * cannot see the button learns nothing, and one who is told "denied — quote this
 * request" learns that a second person is required.
 */
export const approveDispositionRef = clientRef(
  api.quality.inspections.approveDisposition,
);
export const generateLabelRef = clientRef(api.labels.print.generateLabel);
export const reprintLabelRef = clientRef(api.labels.print.reprintLabel);
export const claimPutawayTaskRef = clientRef(
  api.putaway.tasks.claimPutawayTask,
);
export const confirmPutawayRef = clientRef(api.putaway.tasks.confirmPutaway);
