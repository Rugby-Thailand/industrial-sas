"use client";

/**
 * The purchasing, receiving, and label read panels.
 *
 * Every one of these is `MasterDataPanel` with a warehouse-scoped read, because
 * a delivery arrives at a *site*: the permissions are warehouse-scoped, and a
 * panel that did not wait for a warehouse selection would ask the server a
 * question it cannot answer (`INV-0006-04`).
 *
 * The inspection queue and the putaway board are `QualityInspections` and
 * `PutawayTasks`. They left because a module is the unit the message manifest
 * and the bundler split on, and importing one panel from here reaches every
 * table this file renders — which is why a putaway screen used to ship the
 * receiving catalogue. `InboundSection` left for the same reason: it is a
 * heading, and every inbound screen wants one.
 *
 * Nothing here decides whether a write is allowed. The server does, and a denial
 * is shown as a denial with its request ID (`INV-0002-07`). Hiding a control to
 * avoid a denial would be guessing at a permission the client cannot see, and
 * would hide the one message that tells an administrator what to grant.
 */
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
import {
  previewOrderLinesFor,
  previewPrintJobsFor,
  previewPurchaseOrdersFor,
  previewReceiptLinesFor,
  previewReceiptsFor,
} from "@/lib/preview/inboundPreview";

import { MasterDataPanel } from "../masterData/MasterDataPanel";

import { pageArgs } from "./InboundPrimitives";

/* -------------------------------------------------------------------------- */
/* Purchase orders                                                             */
/* -------------------------------------------------------------------------- */

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
      previewRowsFor={previewPurchaseOrdersFor}
      renderRows={(rows) => (
        <PurchaseOrdersTable
          rows={rows}
          /*
           * A link rather than an inline expansion: an order's lines, its
           * receipts, and its short-close controls are a page, and a page inside
           * a table cell is not a page.
           */
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
      previewRowsFor={() => previewOrderLinesFor(purchaseOrderId)}
      renderRows={(rows) => (
        <PurchaseOrderLinesTable
          rows={rows}
          {...(renderAction === undefined ? {} : { renderAction })}
        />
      )}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Receiving                                                                   */
/* -------------------------------------------------------------------------- */

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
      previewRowsFor={previewReceiptsFor}
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
      previewRowsFor={() => previewReceiptLinesFor(receiptId)}
      renderRows={(rows) => <ReceiptLinesTable rows={rows} />}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Label evidence                                                              */
/* -------------------------------------------------------------------------- */

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
      previewRowsFor={() => previewPrintJobsFor(targetId)}
      renderRows={(rows) => <PrintJobsTable rows={rows} />}
    />
  );
}
