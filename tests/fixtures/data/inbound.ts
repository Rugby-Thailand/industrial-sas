import type {
  ImportPreviewOutcome,
  InspectionRow,
  PrintJobRow,
  PurchaseOrderLineRow,
  PurchaseOrderRow,
  PutawayRecommendationOutcome,
  PutawayTaskRow,
  ReceiptLineRow,
  ReceiptRow,
} from "@/lib/convex/inboundApi";

import { previewPage } from "./ledger";
import type { MasterDataPage } from "@/lib/convex/masterDataApi";

const BANG_PU = "prv_wh_bangpoo";
const LAMPHUN = "prv_wh_lamphun";

interface Placed<Row> {
  readonly warehouseId: string;
  readonly row: Row;
}

const PLACED_ORDERS: readonly Placed<PurchaseOrderRow>[] = Object.freeze([
  Object.freeze({
    warehouseId: BANG_PU,
    row: Object.freeze({
      purchaseOrderId: "prv_po_2601",
      warehouseId: BANG_PU,
      poNumber: "PO-2601",
      supplierId: "prv_sup_siam_steel",
      status: "OPEN" as const,
      externalRef: "ERP-88120",
    }),
  }),
  Object.freeze({
    warehouseId: BANG_PU,
    row: Object.freeze({
      purchaseOrderId: "prv_po_2602",
      warehouseId: BANG_PU,
      poNumber: "PO-2602",
      supplierId: "prv_sup_thai_poly",
      status: "OPEN" as const,
    }),
  }),

  Object.freeze({
    warehouseId: BANG_PU,
    row: Object.freeze({
      purchaseOrderId: "prv_po_2603",
      warehouseId: BANG_PU,
      poNumber: "PO-2603",
      supplierId: "prv_sup_nikom_pack",
      status: "DRAFT" as const,
    }),
  }),
  Object.freeze({
    warehouseId: LAMPHUN,
    row: Object.freeze({
      purchaseOrderId: "prv_po_2610",
      warehouseId: LAMPHUN,
      poNumber: "PO-2610",
      supplierId: "prv_sup_siam_steel",
      status: "CLOSED" as const,
    }),
  }),
]);

export const previewPurchaseOrdersFor = (
  warehouseId: string,
): readonly PurchaseOrderRow[] =>
  PLACED_ORDERS.filter((placed) => placed.warehouseId === warehouseId).map(
    (placed) => placed.row,
  );

export const previewPurchaseOrderById = (
  purchaseOrderId: string,
): PurchaseOrderRow | undefined =>
  PLACED_ORDERS.find((placed) => placed.row.purchaseOrderId === purchaseOrderId)
    ?.row;

const ORDER_LINES: readonly PurchaseOrderLineRow[] = Object.freeze([
  Object.freeze({
    purchaseOrderLineId: "prv_pol_2601_1",
    purchaseOrderId: "prv_po_2601",
    lineNumber: 1,
    itemId: "prv_item_steel_coil",
    orderedQuantity: { uom: "KG", minorUnits: 500_000 },
    orderedBaseMinorUnits: 500_000,

    receivedBaseMinorUnits: 180_000,
    baseUom: "KG",
    status: "OPEN" as const,
  }),
  Object.freeze({
    purchaseOrderLineId: "prv_pol_2601_2",
    purchaseOrderId: "prv_po_2601",
    lineNumber: 2,
    itemId: "prv_item_bolt_m8",
    // Ordered in cases; the ledger stores eaches, and the screen shows both —
    // each with its own unit, so "40.000 CASE" and "0.000 EA" cannot be read as
    // the same measure.
    orderedQuantity: { uom: "CASE", minorUnits: 40_000 },
    orderedBaseMinorUnits: 480_000,
    receivedBaseMinorUnits: 0,
    baseUom: "EA",
    status: "OPEN" as const,
  }),
  Object.freeze({
    purchaseOrderLineId: "prv_pol_2602_1",
    purchaseOrderId: "prv_po_2602",
    lineNumber: 1,
    itemId: "prv_item_resin_hd",
    orderedQuantity: { uom: "L", minorUnits: 200_000 },
    orderedBaseMinorUnits: 200_000,
    receivedBaseMinorUnits: 200_000,
    baseUom: "L",
    status: "COMPLETE" as const,
  }),
  Object.freeze({
    purchaseOrderLineId: "prv_pol_2602_2",
    purchaseOrderId: "prv_po_2602",
    lineNumber: 2,
    itemId: "prv_item_carton_a",
    orderedQuantity: { uom: "EA", minorUnits: 100_000 },
    orderedBaseMinorUnits: 100_000,
    receivedBaseMinorUnits: 40_000,
    baseUom: "EA",

    status: "CLOSED_SHORT" as const,
  }),
]);

export const previewOrderLinesFor = (
  purchaseOrderId: string,
): readonly PurchaseOrderLineRow[] =>
  ORDER_LINES.filter((line) => line.purchaseOrderId === purchaseOrderId);

export const previewReceivableLines = (): readonly PurchaseOrderLineRow[] =>
  ORDER_LINES.filter((line) => line.status === "OPEN");

export const PREVIEW_IMPORT_TEXT = [
  "line_number,sku,quantity,uom",
  "1,STEEL-COIL,250,KG",
  "2,BOLT-M8-30,12.5,CASE",
  "3,,7,EA",
  "4,MISSING-SKU,notanumber,EA",
].join("\n");

export const previewImportOutcome = (
  batchRef: string,
): ImportPreviewOutcome => ({
  ok: true,
  batchRef,
  accepted: Object.freeze([
    Object.freeze({
      sourceRowRef: `${batchRef}:1`,
      sourceLine: 2,
      lineNumber: 1,
      sku: "STEEL-COIL",
      quantityMinorUnits: 250_000,
      uom: "KG",
    }),
    Object.freeze({
      sourceRowRef: `${batchRef}:2`,
      sourceLine: 3,
      lineNumber: 2,
      sku: "BOLT-M8-30",
      quantityMinorUnits: 12_500,
      uom: "CASE",
    }),
  ]),
  rejected: Object.freeze([
    Object.freeze({ sourceLine: 4, code: "VALUE_MISSING", column: "sku" }),
    Object.freeze({
      sourceLine: 5,
      code: "QUANTITY_NOT_A_NUMBER",
      column: "quantity",
    }),
  ]),
  empty: false,
});

const PLACED_RECEIPTS: readonly Placed<ReceiptRow>[] = Object.freeze([
  Object.freeze({
    warehouseId: BANG_PU,
    row: Object.freeze({
      receiptId: "prv_rcpt_5001",
      warehouseId: BANG_PU,
      receiptNumber: "GRN-5001",
      purchaseOrderId: "prv_po_2601",
      poNumber: "PO-2601",
      occurredAt: Date.parse("2026-08-10T02:15:00Z"),
      businessDate: "2026-08-10",
    }),
  }),
  Object.freeze({
    warehouseId: BANG_PU,
    row: Object.freeze({
      receiptId: "prv_rcpt_5002",
      warehouseId: BANG_PU,
      receiptNumber: "GRN-5002",
      purchaseOrderId: "prv_po_2602",
      poNumber: "PO-2602",
      occurredAt: Date.parse("2026-08-11T01:40:00Z"),
      businessDate: "2026-08-11",
    }),
  }),

  Object.freeze({
    warehouseId: LAMPHUN,
    row: Object.freeze({
      receiptId: "prv_rcpt_5010",
      warehouseId: LAMPHUN,
      receiptNumber: "GRN-5010",
      occurredAt: Date.parse("2026-08-11T03:05:00Z"),
      businessDate: "2026-08-11",
    }),
  }),
]);

export const previewReceiptsFor = (
  warehouseId: string,
): readonly ReceiptRow[] =>
  PLACED_RECEIPTS.filter((placed) => placed.warehouseId === warehouseId).map(
    (placed) => placed.row,
  );

export const previewReceiptById = (receiptId: string): ReceiptRow | undefined =>
  PLACED_RECEIPTS.find((placed) => placed.row.receiptId === receiptId)?.row;

const RECEIPT_LINES: readonly ReceiptLineRow[] = Object.freeze([
  Object.freeze({
    receiptLineId: "prv_rl_9001",
    receiptId: "prv_rcpt_5001",
    itemId: "prv_item_steel_coil",
    lotId: "prv_lot_coil_2608",
    handlingUnitId: "prv_hu_pallet_01",
    capturedQuantity: { uom: "KG", minorUnits: 180_000 },
    baseMinorUnits: 180_000,
    kind: "ORDERED" as const,
    classification: "PARTIAL" as const,
    stockStatus: "AVAILABLE" as const,
    transactionId: "prv_txn_7001",
  }),

  Object.freeze({
    receiptLineId: "prv_rl_9002",
    receiptId: "prv_rcpt_5002",
    itemId: "prv_item_resin_hd",
    lotId: "prv_lot_resin_2603",
    capturedQuantity: { uom: "L", minorUnits: 200_000 },
    baseMinorUnits: 200_000,
    kind: "ORDERED" as const,
    classification: "COMPLETE" as const,
    stockStatus: "QC_HOLD" as const,
    transactionId: "prv_txn_7002",
  }),

  Object.freeze({
    receiptLineId: "prv_rl_9003",
    receiptId: "prv_rcpt_5010",
    itemId: "prv_item_carton_a",
    capturedQuantity: { uom: "EA", minorUnits: 24_000 },
    baseMinorUnits: 24_000,
    kind: "BLIND" as const,
    classification: "COMPLETE" as const,
    stockStatus: "AVAILABLE" as const,
    transactionId: "prv_txn_7010",
  }),
]);

export const previewReceiptLinesFor = (
  receiptId: string,
): readonly ReceiptLineRow[] =>
  RECEIPT_LINES.filter((line) => line.receiptId === receiptId);

const PLACED_INSPECTIONS: readonly Placed<InspectionRow>[] = Object.freeze([
  Object.freeze({
    warehouseId: BANG_PU,
    row: Object.freeze({
      inspectionId: "prv_qc_3001",
      warehouseId: BANG_PU,
      receiptLineId: "prv_rl_9002",
      itemId: "prv_item_resin_hd",
      status: "OPEN" as const,
      strategy: "PERCENT" as const,
      sampleSize: 20,
      lotSize: 200,
    }),
  }),

  Object.freeze({
    warehouseId: BANG_PU,
    row: Object.freeze({
      inspectionId: "prv_qc_3002",
      warehouseId: BANG_PU,
      receiptLineId: "prv_rl_9001",
      itemId: "prv_item_steel_coil",
      status: "PENDING_APPROVAL" as const,
      strategy: "FIXED" as const,
      sampleSize: 5,
      lotSize: 180,
      disposition: "RELEASE" as const,
    }),
  }),
  Object.freeze({
    warehouseId: BANG_PU,
    row: Object.freeze({
      inspectionId: "prv_qc_3003",
      warehouseId: BANG_PU,
      receiptLineId: "prv_rl_9003",
      itemId: "prv_item_carton_a",
      status: "DISPOSED" as const,
      strategy: "ALL" as const,
      sampleSize: 24,
      lotSize: 24,
      disposition: "REJECT" as const,
    }),
  }),
]);

export const previewInspectionsFor = (
  warehouseId: string,
): readonly InspectionRow[] =>
  PLACED_INSPECTIONS.filter((placed) => placed.warehouseId === warehouseId).map(
    (placed) => placed.row,
  );

export const previewInspectionById = (
  inspectionId: string,
): InspectionRow | undefined =>
  PLACED_INSPECTIONS.find((placed) => placed.row.inspectionId === inspectionId)
    ?.row;

const PLACED_TASKS: readonly Placed<PutawayTaskRow>[] = Object.freeze([
  Object.freeze({
    warehouseId: BANG_PU,
    row: Object.freeze({
      putawayTaskId: "prv_task_4001",
      warehouseId: BANG_PU,
      receiptLineId: "prv_rl_9001",
      itemId: "prv_item_steel_coil",
      lotId: "prv_lot_coil_2608",
      handlingUnitId: "prv_hu_pallet_01",
      baseMinorUnits: 180_000,

      baseUom: "KG",
      fromLocationId: "prv_loc_DOCK-IN-1",
      status: "READY" as const,
    }),
  }),

  Object.freeze({
    warehouseId: BANG_PU,
    row: Object.freeze({
      putawayTaskId: "prv_task_4002",
      warehouseId: BANG_PU,
      receiptLineId: "prv_rl_9003",
      itemId: "prv_item_carton_a",
      baseMinorUnits: 24_000,
      baseUom: "EA",
      fromLocationId: "prv_loc_DOCK-IN-1",
      status: "CLAIMED" as const,
      claimedByUserId: "prv_user_somchai",
      recommendedLocationId: "prv_loc_A01-02-1",
    }),
  }),
  Object.freeze({
    warehouseId: BANG_PU,
    row: Object.freeze({
      putawayTaskId: "prv_task_4003",
      warehouseId: BANG_PU,
      receiptLineId: "prv_rl_9002",
      itemId: "prv_item_resin_hd",
      baseMinorUnits: 60_000,
      baseUom: "L",
      fromLocationId: "prv_loc_DOCK-IN-1",
      status: "CONFIRMED" as const,
      recommendedLocationId: "prv_loc_B04-11-3",
      chosenLocationId: "prv_loc_C02-01-2",
    }),
  }),
]);

export const previewPutawayTasksFor = (
  warehouseId: string,
): readonly PutawayTaskRow[] =>
  PLACED_TASKS.filter((placed) => placed.warehouseId === warehouseId).map(
    (placed) => placed.row,
  );

export const previewPutawayTaskById = (
  putawayTaskId: string,
): PutawayTaskRow | undefined =>
  PLACED_TASKS.find((placed) => placed.row.putawayTaskId === putawayTaskId)
    ?.row;

export const previewRecommendation = (): PutawayRecommendationOutcome => ({
  ok: true,
  ranked: Object.freeze([
    Object.freeze({
      locationId: "prv_loc_A01-02-1",
      code: "A01-02-1",
      score: 380,
      components: Object.freeze([
        { name: "SAME_ITEM", weight: 300, points: 300 },
        { name: "TRAVEL", weight: 80, points: 80 },
      ]),
      viaOverflow: false,
    }),
    Object.freeze({
      locationId: "prv_loc_B04-11-3",
      code: "B04-11-3",
      score: 200,
      components: Object.freeze([
        { name: "TRAVEL", weight: 80, points: 160 },
        { name: "FRAGMENTATION", weight: 40, points: 40 },
      ]),
      viaOverflow: false,
    }),
    Object.freeze({
      locationId: "prv_loc_C02-01-2",
      code: "C02-01-2",
      score: 120,
      components: Object.freeze([
        { name: "TRAVEL", weight: 80, points: 80 },
        { name: "FRAGMENTATION", weight: 40, points: 40 },
      ]),
      viaOverflow: false,
    }),
  ]),
  rejected: Object.freeze([
    Object.freeze({
      locationId: "prv_loc_DOCK-IN-1",
      code: "DOCK-IN-1",
      reason: "LOCATION_TYPE_NOT_STORAGE",
    }),
    Object.freeze({
      locationId: "prv_loc_STAGE-OUT",
      code: "STAGE-OUT",
      reason: "LOCATION_TYPE_NOT_STORAGE",
    }),
  ]),
  filtersApplied: Object.freeze([
    "STOCK_STATUS_PUTAWAYABLE",
    "LOCATION_ACTIVE",
    "LOCATION_TYPE_IS_STORAGE",
    "NOT_PROHIBITED",
    "STORAGE_CLASS_COMPATIBLE",
    "CAPACITY_SUFFICIENT",
  ]),
});

const PRINT_JOBS: readonly PrintJobRow[] = Object.freeze([
  Object.freeze({
    labelPrintJobId: "prv_job_6001",
    templateCode: "LPN-4X6",
    templateVersion: 2,
    targetKind: "HANDLING_UNIT",
    targetId: "prv_hu_pallet_01",
    payloadHash: "a".repeat(64),
    reason: "INITIAL" as const,
    status: "GENERATED" as const,
    occurredAt: Date.parse("2026-08-10T02:20:00Z"),
  }),
  Object.freeze({
    labelPrintJobId: "prv_job_6002",
    templateCode: "LPN-4X6",
    templateVersion: 2,
    targetKind: "HANDLING_UNIT",
    targetId: "prv_hu_pallet_01",
    payloadHash: "b".repeat(64),
    reason: "REPRINT" as const,
    status: "GENERATED" as const,
    occurredAt: Date.parse("2026-08-10T02:41:00Z"),
  }),
]);

export const previewPrintJobsFor = (targetId: string): readonly PrintJobRow[] =>
  PRINT_JOBS.filter((job) => job.targetId === targetId);

export const previewInboundPage = <Row>(
  rows: readonly Row[],
  maxPageSize: number,
  cursor: string | undefined,
): MasterDataPage<Row> => previewPage(rows, maxPageSize, cursor);
