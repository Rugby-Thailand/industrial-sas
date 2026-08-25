import {
  previewBalancesFor,
  PREVIEW_ORG_ID,
  PREVIEW_WAREHOUSES,
  previewPage,
  previewTransactionsFor,
} from "@tests/fixtures/data/ledger";
import {
  PREVIEW_LABEL_TEMPLATES,
  PREVIEW_STORAGE_CLASSES,
  PREVIEW_SUPPLIERS,
  previewBarcodesFor,
  previewItemById,
  previewItems,
  previewItemUomsFor,
  previewLocationsFor,
  previewLotsFor,
  previewMasterDataPage,
  previewReasonCodes,
  previewResolveScan,
} from "@tests/fixtures/data/masterData";
import {
  previewImportOutcome,
  previewInboundPage,
  previewInspectionsFor,
  previewOrderLinesFor,
  previewPurchaseOrdersFor,
  previewReceiptById,
  previewReceiptLinesFor,
  previewReceiptsFor,
  previewRecommendation,
  previewPutawayTasksFor,
  previewPrintJobsFor,
} from "@tests/fixtures/data/inbound";
import {
  previewCustomerOrders,
  previewDesignRequests,
  previewFactoryPackets,
} from "@tests/fixtures/data/orderToShip";
import {
  PREVIEW_ARTIFACT,
  PREVIEW_REPORT_JOBS,
  previewDashboardTiles,
  previewOccupancyFor,
  previewReportJobById,
} from "@tests/fixtures/data/reporting";

type Args = Record<string, unknown>;

const success = (value: unknown) => ({
  ok: true as const,
  requestId: "test_request",
  value,
});

const pageArgs = (args: Args) => ({
  maxPageSize: typeof args.maxPageSize === "number" ? args.maxPageSize : 25,
  cursor: typeof args.cursor === "string" ? args.cursor : undefined,
});

const page = (rows: readonly unknown[], args: Args) => {
  const { maxPageSize, cursor } = pageArgs(args);
  return previewMasterDataPage(rows, maxPageSize, cursor);
};

export function resolveTestQuery(name: string, args: Args): unknown {
  const warehouseId = String(args.warehouseId ?? "prv_wh_bangpoo");
  const itemId = String(args.itemId ?? "");
  const receiptId = String(args.receiptId ?? "");

  switch (name) {
    case "workspace/current:readCurrent":
      return success({
        organization: { id: PREVIEW_ORG_ID, name: "Siam Industrial" },
        warehouses: PREVIEW_WAREHOUSES.map((warehouse) => ({
          id: warehouse.id,
          code: warehouse.code,
          name: warehouse.nameTh,
        })),
        complete: true,
      });
    case "inventory/ledger:listBalances":
      return success(
        previewPage(
          previewBalancesFor(warehouseId),
          pageArgs(args).maxPageSize,
          pageArgs(args).cursor,
        ),
      );
    case "inventory/ledger:listTransactions":
      return success(
        previewPage(
          previewTransactionsFor(warehouseId),
          pageArgs(args).maxPageSize,
          pageArgs(args).cursor,
        ),
      );
    case "masterData/catalogue:listItems":
      return success(page(previewItems(), args));
    case "masterData/catalogue:listLocations":
      return success(page(previewLocationsFor(warehouseId), args));
    case "masterData/catalogue:listReasonCodes":
      return success(
        page(
          previewReasonCodes().filter(
            (row) => args.scope === undefined || row.scope === args.scope,
          ),
          args,
        ),
      );
    case "masterData/catalogue:listSuppliers":
      return success(page(PREVIEW_SUPPLIERS, args));
    case "masterData/catalogue:listStorageClasses":
      return success(page(PREVIEW_STORAGE_CLASSES, args));
    case "masterData/catalogue:listLabelTemplates":
      return success(page(PREVIEW_LABEL_TEMPLATES, args));
    case "masterData/catalogue:listBarcodesForItem":
      return success(page(previewBarcodesFor(itemId), args));
    case "masterData/catalogue:listItemUoms":
      return success(page(previewItemUomsFor(itemId), args));
    case "masterData/catalogue:listLotsForItem":
      return success(page(previewLotsFor(itemId), args));
    case "masterData/catalogue:getItem": {
      const item = previewItemById(itemId);
      return success(
        item === undefined ? { found: false } : { found: true, item },
      );
    }
    case "masterData/catalogue:resolveScanToItem": {
      const item = previewResolveScan(String(args.scan ?? ""));
      return success(
        item === undefined
          ? { found: false, reason: "NOT_FOUND" }
          : { found: true, ...item, name: item.sku, via: "BARCODE" },
      );
    }
    case "masterData/catalogue:listReceivingLocations":
      return success({
        ok: true,
        items: previewLocationsFor(warehouseId).filter((row) =>
          ["DOCK", "STAGING"].includes(row.locationType),
        ),
      });
    case "purchasing/orders:listPurchaseOrders":
      return success(
        previewInboundPage(
          previewPurchaseOrdersFor(warehouseId).filter(
            (row) => args.status === undefined || row.status === args.status,
          ),
          pageArgs(args).maxPageSize,
          pageArgs(args).cursor,
        ),
      );
    case "purchasing/orders:listPurchaseOrderLines":
      return success(
        previewInboundPage(
          previewOrderLinesFor(String(args.purchaseOrderId ?? "")).filter(
            (row) => args.status === undefined || row.status === args.status,
          ),
          pageArgs(args).maxPageSize,
          pageArgs(args).cursor,
        ),
      );
    case "purchasing/orders:previewPurchaseOrderImport":
      return success(previewImportOutcome(String(args.batchRef ?? "")));
    case "receiving/receipts:getReceipt": {
      const receipt = previewReceiptById(receiptId);
      return success(
        receipt === undefined ? { found: false } : { found: true, receipt },
      );
    }
    case "receiving/receipts:listReceipts":
      return success(
        previewInboundPage(
          previewReceiptsFor(warehouseId),
          pageArgs(args).maxPageSize,
          pageArgs(args).cursor,
        ),
      );
    case "receiving/receipts:listReceiptLines":
      return success(
        previewInboundPage(
          previewReceiptLinesFor(receiptId),
          pageArgs(args).maxPageSize,
          pageArgs(args).cursor,
        ),
      );
    case "quality/inspections:listInspections":
      return success(
        previewInboundPage(
          previewInspectionsFor(warehouseId).filter(
            (row) => args.status === undefined || row.status === args.status,
          ),
          pageArgs(args).maxPageSize,
          pageArgs(args).cursor,
        ),
      );
    case "putaway/tasks:listPutawayTasks":
      return success(
        previewInboundPage(
          previewPutawayTasksFor(warehouseId),
          pageArgs(args).maxPageSize,
          pageArgs(args).cursor,
        ),
      );
    case "putaway/tasks:recommendPutawayLocations":
      return success(previewRecommendation());
    case "labels/print:listPrintJobsForTarget":
      return success({
        ok: true,
        items: previewPrintJobsFor(String(args.targetId ?? "")),
      });
    case "sales/orders:listCustomerOrders":
      return success(
        page(
          previewCustomerOrders().filter(
            (row) => args.status === undefined || row.status === args.status,
          ),
          args,
        ),
      );
    case "engineering/designRequests:listDesignRequests":
      return success(page(previewDesignRequests(), args));
    case "production/packets:listFactoryPackets":
      return success(page(previewFactoryPackets(), args));
    case "engineering/masterCards:listMasterCards":
    case "engineering/masterCards:listMasterCardRevisions":
    case "engineering/files:listMasterCardFiles":
    case "engineering/designRequests:listSimilarReleasedDesigns":
      return success(page([], args));
    case "reporting/dashboard:readDashboard":
      return success({ tiles: previewDashboardTiles() });
    case "reporting/dashboard:readOccupancy":
      return success({
        cells: previewOccupancyFor(warehouseId),
        complete: true,
      });
    case "reporting/exports:listReportJobs":
      return success({ jobs: PREVIEW_REPORT_JOBS });
    case "reporting/exports:getReportJob": {
      const job = previewReportJobById(String(args.reportJobId ?? ""));
      return success(
        job === undefined
          ? { found: false }
          : { found: true, job, artifact: PREVIEW_ARTIFACT },
      );
    }
    default:
      return success({
        ok: true,
        items: [],
        complete: true,
        nextCursor: undefined,
      });
  }
}
