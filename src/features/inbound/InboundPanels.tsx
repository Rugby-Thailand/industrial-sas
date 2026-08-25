"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import {
  PrintJobsTable,
  PurchaseOrderLinesTable,
  PurchaseOrdersTable,
  ReceiptLinesTable,
  ReceiptsTable,
} from "@/components/inbound/InboundTables";
import { Link } from "@/i18n/navigation";
import {
  listPrintJobsForTargetRef,
  listPurchaseOrderLinesRef,
  listPurchaseOrdersRef,
  listReceiptLinesRef,
  listReceiptsRef,
  type PrintJobRow,
  type PurchaseOrderLineRow,
  type PurchaseOrderRow,
  type ReceiptLineRow,
  type ReceiptRow,
} from "@/lib/convex/inboundApi";
import { purchaseOrderPath, receiptPath } from "@/lib/navigation";

import { MasterDataPanel } from "../masterData/MasterDataPanel";

import { pageArgs } from "./InboundPrimitives";

export function PurchaseOrdersPanel() {
  const t = useTranslations("Purchasing");

  return (
    <MasterDataPanel<
      PurchaseOrderRow,
      { warehouseId: string; maxPageSize?: number; cursor?: string }
    >
      queryRef={listPurchaseOrdersRef}
      scope="WAREHOUSE"
      buildArgs={({ warehouseId, cursor }) => pageArgs(warehouseId, cursor)}
      renderRows={(rows) => (
        <PurchaseOrdersTable
          rows={rows}

          renderAction={(row) => (
            <Link
              href={purchaseOrderPath(row.purchaseOrderId)}
              className="inline-flex min-h-touch items-center rounded-md border border-border-strong px-3 text-xs font-semibold"
              data-testid={`order-open-${row.poNumber}`}
            >
              {t("openOrder")}
            </Link>
          )}
        />
      )}
    />
  );
}

export function PurchaseOrderLinesPanel({
  purchaseOrderId,
  renderAction,
}: {
  readonly purchaseOrderId: string;
  readonly renderAction?: (row: PurchaseOrderLineRow) => ReactNode;
}) {
  return (
    <MasterDataPanel<
      PurchaseOrderLineRow,
      {
        warehouseId: string;
        purchaseOrderId: string;
        maxPageSize?: number;
        cursor?: string;
      }
    >
      queryRef={listPurchaseOrderLinesRef}
      scope="WAREHOUSE"
      buildArgs={({ warehouseId, cursor }) => ({
        ...pageArgs(warehouseId, cursor),
        purchaseOrderId,
      })}
      renderRows={(rows) => (
        <PurchaseOrderLinesTable
          rows={rows}
          {...(renderAction === undefined ? {} : { renderAction })}
        />
      )}
    />
  );
}

export function ReceiptsPanel() {
  const t = useTranslations("Receiving");

  return (
    <MasterDataPanel<
      ReceiptRow,
      { warehouseId: string; maxPageSize?: number; cursor?: string }
    >
      queryRef={listReceiptsRef}
      scope="WAREHOUSE"
      buildArgs={({ warehouseId, cursor }) => pageArgs(warehouseId, cursor)}
      renderRows={(rows) => (
        <ReceiptsTable
          rows={rows}
          renderAction={(row) => (
            <Link
              href={receiptPath(row.receiptId)}
              className="inline-flex min-h-touch items-center rounded-md border border-border-strong px-3 text-xs font-semibold"
              data-testid={`receipt-open-${row.receiptNumber}`}
            >
              {t("openReceipt")}
            </Link>
          )}
        />
      )}
    />
  );
}

export function ReceiptLinesPanel({
  receiptId,
}: {
  readonly receiptId: string;
}) {
  return (
    <MasterDataPanel<
      ReceiptLineRow,
      {
        warehouseId: string;
        receiptId: string;
        maxPageSize?: number;
        cursor?: string;
      }
    >
      queryRef={listReceiptLinesRef}
      scope="WAREHOUSE"
      buildArgs={({ warehouseId, cursor }) => ({
        ...pageArgs(warehouseId, cursor),
        receiptId,
      })}
      renderRows={(rows) => <ReceiptLinesTable rows={rows} />}
    />
  );
}

export function PrintJobsPanel({
  targetKind,
  targetId,
}: {
  readonly targetKind: string;
  readonly targetId: string;
}) {
  return (
    <MasterDataPanel<
      PrintJobRow,
      {
        warehouseId: string;
        targetKind: string;
        targetId: string;
        maxPageSize?: number;
        cursor?: string;
      }
    >
      queryRef={listPrintJobsForTargetRef}
      scope="WAREHOUSE"
      buildArgs={({ warehouseId, cursor }) => ({
        ...pageArgs(warehouseId, cursor),
        targetKind,
        targetId,
      })}
      renderRows={(rows) => <PrintJobsTable rows={rows} />}
    />
  );
}
