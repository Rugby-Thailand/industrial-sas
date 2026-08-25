import { api } from "../../../convex/_generated/api";

import { clientRef, type RefPageItem, type RefValue } from "./clientRef";

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
export const approveDispositionRef = clientRef(
  api.quality.inspections.approveDisposition,
);
export const generateLabelRef = clientRef(api.labels.print.generateLabel);
export const reprintLabelRef = clientRef(api.labels.print.reprintLabel);
export const claimPutawayTaskRef = clientRef(
  api.putaway.tasks.claimPutawayTask,
);
export const confirmPutawayRef = clientRef(api.putaway.tasks.confirmPutaway);

export type PurchaseOrderRow = RefPageItem<typeof listPurchaseOrdersRef>;
export type PurchaseOrderStatus = PurchaseOrderRow["status"];

export type PurchaseOrderLineRow = RefPageItem<
  typeof listPurchaseOrderLinesRef
>;
export type PurchaseOrderLineStatus = PurchaseOrderLineRow["status"];
export type Quantity = PurchaseOrderLineRow["orderedQuantity"];

export type ReceiptRow = RefPageItem<typeof listReceiptsRef>;
export type ReceiptLineRow = RefPageItem<typeof listReceiptLinesRef>;
export type ReceiptLineKind = ReceiptLineRow["kind"];
export type ReceiptClassification = ReceiptLineRow["classification"];
export type LandedStockStatus = ReceiptLineRow["stockStatus"];

export type InspectionRow = RefPageItem<typeof listInspectionsRef>;
export type InspectionStatus = InspectionRow["status"];
export type QcDisposition = NonNullable<InspectionRow["disposition"]>;

export type PutawayTaskRow = RefPageItem<typeof listPutawayTasksRef>;
export type PutawayTaskStatus = PutawayTaskRow["status"];

export type PrintJobRow = RefPageItem<typeof listPrintJobsForTargetRef>;

export type PutawayRecommendationOutcome = RefValue<
  typeof recommendPutawayLocationsRef
>;
type PutawayRecommendation = Extract<
  PutawayRecommendationOutcome,
  { readonly ok: true }
>;
export type RankedLocation = PutawayRecommendation["ranked"][number];
export type RejectedLocation = PutawayRecommendation["rejected"][number];
export type ScoreComponent = RankedLocation["components"][number];

export type ImportPreviewOutcome = RefValue<
  typeof previewPurchaseOrderImportRef
>;
type ImportPreview = Extract<ImportPreviewOutcome, { readonly ok: true }>;
export type ImportRow = ImportPreview["accepted"][number];
export type RejectedImportRow = ImportPreview["rejected"][number];
