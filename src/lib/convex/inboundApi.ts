/**
 * Typed references to the inbound slice's functions, and their wire types.
 *
 * The same reasoning as `masterDataApi.ts`: `convex/_generated/` is a git-ignored
 * artifact of `convex dev`, absent in CI and on any machine that has not
 * provisioned a deployment, so the browser names server functions through
 * `makeFunctionReference` and a drift test re-reads the server modules to prove
 * the names still resolve.
 *
 * Every write reference carries a `requestId` in its argument type. The key is
 * what makes a retry a replay instead of a duplicate receipt, so a caller that
 * could forget it would be a caller that could double-receive a pallet.
 *
 * Three of these functions answer something wider than the shared write
 * envelope — a receipt posting reports its classification and where the stock
 * landed, a claim reports what was recommended, a confirmation reports whether
 * it was an override. Those extra fields are the whole point of the screens that
 * call them, so they get their own outcome types rather than being flattened
 * into `{written, documentId}`.
 */
import { makeFunctionReference } from "convex/server";

import type { TenantOutcome } from "./ledgerApi";
import type { MasterDataPage } from "./masterDataApi";

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
  readonly orderedQuantity: Quantity;
  readonly orderedBaseMinorUnits: number;
  readonly receivedBaseMinorUnits: number;
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
  readonly purchaseOrderId?: string;
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
/* Write outcomes                                                              */
/* -------------------------------------------------------------------------- */

/** The refusal shape shared with the master-data writes. */
export interface InboundWriteError {
  readonly code: string;
  readonly field?: string;
  readonly reason?: string;
  readonly table?: string;
  readonly status?: string;
  readonly requestId?: string;
}

export type InboundWriteOutcome =
  | {
      readonly written: true;
      readonly documentId: string;
      readonly replayed: boolean;
    }
  | { readonly written: false; readonly error: InboundWriteError };

/** What a receipt posting reports beyond "it was written". */
export type ReceiptPostOutcome =
  | {
      readonly written: true;
      readonly documentId: string;
      readonly replayed: boolean;
      readonly transactionId: string;
      readonly classification: ReceiptClassification;
      readonly kind: ReceiptLineKind;
      readonly stockStatus: "AVAILABLE" | "QC_HOLD";
      readonly baseMinorUnits: number;
      readonly plausibleDuplicate: boolean;
      readonly inspectionId?: string;
    }
  | { readonly written: false; readonly error: InboundWriteError };

export type ImportChunkOutcome =
  | {
      readonly written: true;
      readonly documentId: string;
      readonly replayed: boolean;
      readonly createdCount: number;
      readonly skippedCount: number;
      readonly nextCursor: number | null;
      readonly complete: boolean;
    }
  | { readonly written: false; readonly error: InboundWriteError };

export type DispositionOutcome =
  | {
      readonly written: true;
      readonly documentId: string;
      readonly replayed: boolean;
      readonly status: InspectionStatus;
      readonly transactionId?: string;
      readonly toStatus: string;
    }
  | { readonly written: false; readonly error: InboundWriteError };

export type ClaimOutcome =
  | {
      readonly written: true;
      readonly documentId: string;
      readonly replayed: boolean;
      readonly alreadyHeld: boolean;
      readonly recommendedLocationId?: string;
    }
  | { readonly written: false; readonly error: InboundWriteError };

export type ConfirmOutcome =
  | {
      readonly written: true;
      readonly documentId: string;
      readonly replayed: boolean;
      readonly transactionId: string;
      readonly isOverride: boolean;
    }
  | { readonly written: false; readonly error: InboundWriteError };

/* -------------------------------------------------------------------------- */
/* Function paths                                                              */
/* -------------------------------------------------------------------------- */

export const INBOUND_QUERY_PATHS = Object.freeze({
  listPurchaseOrders: "purchasing/orders:listPurchaseOrders",
  listPurchaseOrderLines: "purchasing/orders:listPurchaseOrderLines",
  previewPurchaseOrderImport: "purchasing/orders:previewPurchaseOrderImport",
  getReceipt: "receiving/receipts:getReceipt",
  listReceipts: "receiving/receipts:listReceipts",
  listReceiptLines: "receiving/receipts:listReceiptLines",
  listInspections: "quality/inspections:listInspections",
  listPutawayTasks: "putaway/tasks:listPutawayTasks",
  recommendPutawayLocations: "putaway/tasks:recommendPutawayLocations",
  listPrintJobsForTarget: "labels/print:listPrintJobsForTarget",
});

export const INBOUND_MUTATION_PATHS = Object.freeze({
  createPurchaseOrder: "purchasing/orders:createPurchaseOrder",
  addPurchaseOrderLine: "purchasing/orders:addPurchaseOrderLine",
  closeLineShort: "purchasing/orders:closeLineShort",
  applyPurchaseOrderImportChunk:
    "purchasing/orders:applyPurchaseOrderImportChunk",
  openReceipt: "receiving/receipts:openReceipt",
  postReceiptLine: "receiving/receipts:postReceiptLine",
  raiseReceivingException: "receiving/receipts:raiseReceivingException",
  postExceptionReceiptLine: "receiving/receipts:postExceptionReceiptLine",
  buildHandlingUnit: "receiving/receipts:buildHandlingUnit",
  submitDisposition: "quality/inspections:submitDisposition",
  approveDisposition: "quality/inspections:approveDisposition",
  generateLabel: "labels/print:generateLabel",
  reprintLabel: "labels/print:reprintLabel",
  claimPutawayTask: "putaway/tasks:claimPutawayTask",
  confirmPutaway: "putaway/tasks:confirmPutaway",
});

/* -------------------------------------------------------------------------- */
/* Query references                                                            */
/* -------------------------------------------------------------------------- */

/** Every inbound list is warehouse-scoped: a delivery arrives at a site. */
export type WarehousePageArgs = {
  readonly warehouseId: string;
  readonly maxPageSize?: number;
  readonly cursor?: string;
};

export const listPurchaseOrdersRef = makeFunctionReference<
  "query",
  WarehousePageArgs & { readonly status?: PurchaseOrderStatus },
  TenantOutcome<MasterDataPage<PurchaseOrderRow>>
>(INBOUND_QUERY_PATHS.listPurchaseOrders);

export const listPurchaseOrderLinesRef = makeFunctionReference<
  "query",
  WarehousePageArgs & {
    readonly purchaseOrderId: string;
    readonly status?: PurchaseOrderLineStatus;
  },
  TenantOutcome<MasterDataPage<PurchaseOrderLineRow>>
>(INBOUND_QUERY_PATHS.listPurchaseOrderLines);

export const previewPurchaseOrderImportRef = makeFunctionReference<
  "query",
  {
    readonly warehouseId: string;
    readonly batchRef: string;
    readonly text: string;
  },
  TenantOutcome<ImportPreviewOutcome>
>(INBOUND_QUERY_PATHS.previewPurchaseOrderImport);

/** One receipt, or `{found:false}` — which is also another tenant's answer. */
export type ReceiptDetail =
  | { readonly found: true; readonly receipt: ReceiptRow }
  | { readonly found: false };

export const getReceiptRef = makeFunctionReference<
  "query",
  { readonly warehouseId: string; readonly receiptId: string },
  TenantOutcome<ReceiptDetail>
>(INBOUND_QUERY_PATHS.getReceipt);

export const listReceiptsRef = makeFunctionReference<
  "query",
  WarehousePageArgs,
  TenantOutcome<MasterDataPage<ReceiptRow>>
>(INBOUND_QUERY_PATHS.listReceipts);

export const listReceiptLinesRef = makeFunctionReference<
  "query",
  WarehousePageArgs & { readonly receiptId: string },
  TenantOutcome<MasterDataPage<ReceiptLineRow>>
>(INBOUND_QUERY_PATHS.listReceiptLines);

export const listInspectionsRef = makeFunctionReference<
  "query",
  WarehousePageArgs & { readonly status?: InspectionStatus },
  TenantOutcome<MasterDataPage<InspectionRow>>
>(INBOUND_QUERY_PATHS.listInspections);

export const listPutawayTasksRef = makeFunctionReference<
  "query",
  WarehousePageArgs & { readonly status?: PutawayTaskStatus },
  TenantOutcome<MasterDataPage<PutawayTaskRow>>
>(INBOUND_QUERY_PATHS.listPutawayTasks);

export const recommendPutawayLocationsRef = makeFunctionReference<
  "query",
  { readonly warehouseId: string; readonly putawayTaskId: string },
  TenantOutcome<PutawayRecommendationOutcome>
>(INBOUND_QUERY_PATHS.recommendPutawayLocations);

export const listPrintJobsForTargetRef = makeFunctionReference<
  "query",
  WarehousePageArgs & {
    readonly targetKind: string;
    readonly targetId: string;
  },
  TenantOutcome<MasterDataPage<PrintJobRow>>
>(INBOUND_QUERY_PATHS.listPrintJobsForTarget);

/* -------------------------------------------------------------------------- */
/* Mutation references                                                         */
/* -------------------------------------------------------------------------- */

const writeRef = <Args extends Record<string, unknown>, Outcome>(
  path: string,
) => makeFunctionReference<"mutation", Args, TenantOutcome<Outcome>>(path);

export const createPurchaseOrderRef = writeRef<
  {
    requestId: string;
    warehouseId: string;
    poNumber: string;
    supplierId: string;
    externalRef?: string;
  },
  InboundWriteOutcome
>(INBOUND_MUTATION_PATHS.createPurchaseOrder);

export const addPurchaseOrderLineRef = writeRef<
  {
    requestId: string;
    warehouseId: string;
    purchaseOrderId: string;
    lineNumber: number;
    itemId: string;
    quantity: Quantity;
  },
  InboundWriteOutcome
>(INBOUND_MUTATION_PATHS.addPurchaseOrderLine);

export const closeLineShortRef = writeRef<
  {
    requestId: string;
    warehouseId: string;
    purchaseOrderLineId: string;
    reasonCodeId: string;
  },
  InboundWriteOutcome
>(INBOUND_MUTATION_PATHS.closeLineShort);

export const applyPurchaseOrderImportChunkRef = writeRef<
  {
    requestId: string;
    warehouseId: string;
    purchaseOrderId: string;
    batchRef: string;
    text: string;
    cursor?: number;
    chunkSize?: number;
  },
  ImportChunkOutcome
>(INBOUND_MUTATION_PATHS.applyPurchaseOrderImportChunk);

export const openReceiptRef = writeRef<
  {
    requestId: string;
    warehouseId: string;
    receiptNumber: string;
    purchaseOrderId?: string;
  },
  InboundWriteOutcome
>(INBOUND_MUTATION_PATHS.openReceipt);

export const postReceiptLineRef = writeRef<
  {
    requestId: string;
    warehouseId: string;
    receiptId: string;
    locationId: string;
    itemId: string;
    purchaseOrderLineId: string;
    quantity: Quantity;
    lotCode?: string;
    manufactureDate?: string;
    expirationDate?: string;
    handlingUnitId?: string;
  },
  ReceiptPostOutcome
>(INBOUND_MUTATION_PATHS.postReceiptLine);

export const raiseReceivingExceptionRef = writeRef<
  {
    requestId: string;
    warehouseId: string;
    kind: ReceiptLineKind;
    itemId?: string;
    purchaseOrderId?: string;
    reasonCodeId: string;
    note?: string;
  },
  InboundWriteOutcome
>(INBOUND_MUTATION_PATHS.raiseReceivingException);

export const postExceptionReceiptLineRef = writeRef<
  {
    requestId: string;
    warehouseId: string;
    receiptId: string;
    locationId: string;
    itemId: string;
    exceptionId: string;
    quantity: Quantity;
    lotCode?: string;
    expirationDate?: string;
  },
  ReceiptPostOutcome
>(INBOUND_MUTATION_PATHS.postExceptionReceiptLine);

export const buildHandlingUnitRef = writeRef<
  {
    requestId: string;
    warehouseId: string;
    lpn: string;
    locationId: string;
    receiptLineIds: readonly string[];
  },
  InboundWriteOutcome
>(INBOUND_MUTATION_PATHS.buildHandlingUnit);

export const submitDispositionRef = writeRef<
  {
    requestId: string;
    warehouseId: string;
    inspectionId: string;
    disposition: QcDisposition;
    reasonCodeId: string;
  },
  DispositionOutcome
>(INBOUND_MUTATION_PATHS.submitDisposition);

/**
 * Approving a parked disposition.
 *
 * Maker-checker plus step-up. The submitter is denied by the evaluator, and the
 * screen shows that denial rather than hiding the control: an inspector who
 * cannot see the button learns nothing, and one who is told "denied — quote this
 * request" learns that a second person is required.
 */
export const approveDispositionRef = writeRef<
  { requestId: string; warehouseId: string; inspectionId: string },
  DispositionOutcome
>(INBOUND_MUTATION_PATHS.approveDisposition);

export const generateLabelRef = writeRef<
  {
    requestId: string;
    warehouseId: string;
    labelTemplateId: string;
    targetKind: string;
    targetId: string;
    fields: Record<string, string>;
  },
  InboundWriteOutcome
>(INBOUND_MUTATION_PATHS.generateLabel);

export const reprintLabelRef = writeRef<
  {
    requestId: string;
    warehouseId: string;
    labelTemplateId: string;
    targetKind: string;
    targetId: string;
    fields: Record<string, string>;
  },
  InboundWriteOutcome
>(INBOUND_MUTATION_PATHS.reprintLabel);

export const claimPutawayTaskRef = writeRef<
  { requestId: string; warehouseId: string; putawayTaskId: string },
  ClaimOutcome
>(INBOUND_MUTATION_PATHS.claimPutawayTask);

export const confirmPutawayRef = writeRef<
  {
    requestId: string;
    warehouseId: string;
    putawayTaskId: string;
    chosenLocationId: string;
    overrideReasonCodeId?: string;
  },
  ConfirmOutcome
>(INBOUND_MUTATION_PATHS.confirmPutaway);
