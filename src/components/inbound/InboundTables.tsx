"use client";

/**
 * The purchasing, receiving, and label collections, as columns.
 *
 * Built on `EntityTable`, so the structure — caption, one row header, scrolling
 * rather than crushing — is the master-data screens' structure and cannot drift
 * from it. What is here is the decision about *which* facts each screen shows.
 *
 * The inspection queue and the putaway board are *not* here: they are
 * `QualityTables` and `PutawayTables`, because a module is what the bundler and
 * the message manifest split on, and a quality screen that reached this file
 * shipped the purchasing and receiving catalogues with it. Ordering and
 * receiving are together because they are genuinely one flow — a receipt is
 * posted against an order, so both screens need both vocabularies.
 *
 * Two conventions run through all of them:
 *
 * - **A quantity is shown with its unit**, through `formatMinorUnits`. A bare
 *   `180000` on a receiving screen is unreadable and, worse, looks like a count
 *   of pieces when it is thousandths of a kilogram (`ADR-0004`).
 * - **A state is a word and a glyph**, never a colour (`INV-0010-07`). Every
 *   status column is a `StatusBadge` whose label comes from the catalogue, so a
 *   code the client does not know yet falls back to the code itself rather than
 *   to a blank cell.
 */
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { EntityTable } from "@/components/masterData/EntityTable";
import { StatusBadge, type BadgeTone } from "@/components/ui/StatusBadge";
import type {
  ImportRow,
  PrintJobRow,
  PurchaseOrderLineRow,
  PurchaseOrderRow,
  ReceiptLineRow,
  ReceiptRow,
  RejectedImportRow,
} from "@/lib/convex/inboundApi";
import { codeLabel, type CodeTranslator } from "@/lib/domainLabels";
import { UNRENDERABLE } from "@/lib/formatters";

import { shortId, withUnit } from "./InboundCells";

const ORDER_TONES: Readonly<Record<string, BadgeTone>> = {
  DRAFT: "pending",
  OPEN: "success",
  CLOSED: "muted",
  CANCELLED: "danger",
};

/**
 * `CLOSED_SHORT` is `warning`, not `muted`.
 *
 * It means somebody decided to stop waiting for stock the supplier owed. That is
 * a fact a buyer reviews, and showing it as quietly finished is how it stops
 * being reviewed.
 */
const LINE_TONES: Readonly<Record<string, BadgeTone>> = {
  OPEN: "accent",
  COMPLETE: "success",
  CLOSED_SHORT: "warning",
  CANCELLED: "danger",
};

/** Every kind but `ORDERED` exercised a permission with a second person on it. */
const KIND_TONES: Readonly<Record<string, BadgeTone>> = {
  ORDERED: "neutral",
  UNEXPECTED: "warning",
  CANCELLED_LINE: "warning",
  BLIND: "warning",
};

const CLASSIFICATION_TONES: Readonly<Record<string, BadgeTone>> = {
  PARTIAL: "accent",
  COMPLETE: "success",
  OVER_WITHIN_TOLERANCE: "warning",
  OVER_BEYOND_TOLERANCE: "danger",
};

const STOCK_TONES: Readonly<Record<string, BadgeTone>> = {
  AVAILABLE: "success",
  QC_HOLD: "warning",
  QUARANTINE: "warning",
  REJECTED: "danger",
  SCRAP: "danger",
  EXPIRED: "danger",
};

/* -------------------------------------------------------------------------- */
/* Purchase orders                                                             */
/* -------------------------------------------------------------------------- */

export function PurchaseOrdersTable({
  rows,
  renderAction,
}: {
  readonly rows: readonly PurchaseOrderRow[];
  readonly renderAction?: (row: PurchaseOrderRow) => ReactNode;
}) {
  const t = useTranslations("Purchasing");
  const statusT = useTranslations(
    "PurchaseOrderStatus",
  ) as unknown as CodeTranslator;

  return (
    <EntityTable<PurchaseOrderRow>
      testId="table-purchase-orders"
      caption={t("ordersCaption", { count: rows.length })}
      rows={rows}
      rowKey={(row) => row.purchaseOrderId}
      columns={[
        {
          key: "poNumber",
          header: t("columnPoNumber"),
          rowHeader: true,
          render: (row) => row.poNumber,
        },
        {
          key: "status",
          header: t("columnStatus"),
          render: (row) => (
            <StatusBadge
              tone={ORDER_TONES[row.status] ?? "neutral"}
              label={codeLabel(statusT, row.status)}
            />
          ),
        },
        {
          key: "externalRef",
          header: t("columnExternalRef"),
          monospace: true,
          render: (row) => row.externalRef ?? UNRENDERABLE,
        },
      ]}
      {...(renderAction === undefined
        ? {}
        : { actionHeader: t("columnAction"), renderAction })}
    />
  );
}

export function PurchaseOrderLinesTable({
  rows,
  renderAction,
}: {
  readonly rows: readonly PurchaseOrderLineRow[];
  readonly renderAction?: (row: PurchaseOrderLineRow) => ReactNode;
}) {
  const t = useTranslations("Purchasing");
  const statusT = useTranslations(
    "PurchaseOrderLineStatus",
  ) as unknown as CodeTranslator;

  return (
    <EntityTable<PurchaseOrderLineRow>
      testId="table-order-lines"
      caption={t("linesCaption", { count: rows.length })}
      rows={rows}
      rowKey={(row) => row.purchaseOrderLineId}
      columns={[
        {
          key: "lineNumber",
          header: t("columnLineNumber"),
          rowHeader: true,
          render: (row) => String(row.lineNumber),
        },
        {
          key: "item",
          header: t("columnItem"),
          monospace: true,
          render: (row) => shortId(row.itemId),
        },
        {
          key: "ordered",
          header: t("columnOrdered"),
          monospace: true,
          /*
           * The unit the *order* was written in, not the base unit. A buyer
           * reading "40 CASE" against a supplier's paperwork must not be shown
           * "480000 EA" instead, even though that is what the ledger stores.
           */
          render: (row) =>
            withUnit(row.orderedQuantity.minorUnits, row.orderedQuantity.uom),
        },
        {
          key: "received",
          header: t("columnReceived"),
          monospace: true,
          render: (row) => String(row.receivedBaseMinorUnits / 1000),
        },
        {
          key: "outstanding",
          header: t("columnOutstanding"),
          monospace: true,
          render: (row) =>
            String(
              Math.max(
                0,
                row.orderedBaseMinorUnits - row.receivedBaseMinorUnits,
              ) / 1000,
            ),
        },
        {
          key: "status",
          header: t("columnStatus"),
          render: (row) => (
            <StatusBadge
              tone={LINE_TONES[row.status] ?? "neutral"}
              label={codeLabel(statusT, row.status)}
            />
          ),
        },
      ]}
      {...(renderAction === undefined
        ? {}
        : { actionHeader: t("columnAction"), renderAction })}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Import                                                                      */
/* -------------------------------------------------------------------------- */

export function ImportAcceptedTable({
  rows,
}: {
  readonly rows: readonly ImportRow[];
}) {
  const t = useTranslations("Purchasing");

  return (
    <EntityTable<ImportRow>
      testId="table-import-accepted"
      caption={t("importAcceptedCaption", { count: rows.length })}
      rows={rows}
      rowKey={(row) => row.sourceRowRef}
      columns={[
        {
          key: "sourceLine",
          header: t("importColumnLine"),
          rowHeader: true,
          render: (row) => String(row.sourceLine),
        },
        {
          key: "sku",
          header: t("importColumnSku"),
          monospace: true,
          render: (row) => row.sku,
        },
        {
          key: "quantity",
          header: t("importColumnQuantity"),
          monospace: true,
          render: (row) => String(row.quantityMinorUnits / 1000),
        },
        {
          key: "uom",
          header: t("importColumnUom"),
          monospace: true,
          render: (row) => row.uom,
        },
        {
          key: "ref",
          header: t("importColumnRef"),
          monospace: true,
          // The row's idempotency key, shown because it is what makes a replayed
          // chunk recognise itself (`INV-0007-12`).
          render: (row) => row.sourceRowRef,
        },
      ]}
    />
  );
}

export function ImportRejectedTable({
  rows,
}: {
  readonly rows: readonly RejectedImportRow[];
}) {
  const t = useTranslations("Purchasing");
  const problemT = useTranslations(
    "ImportProblem",
  ) as unknown as CodeTranslator;

  return (
    <EntityTable<RejectedImportRow>
      testId="table-import-rejected"
      caption={t("importRejectedCaption", { count: rows.length })}
      rows={rows}
      rowKey={(row) => `${row.sourceLine}:${row.code}`}
      columns={[
        {
          key: "sourceLine",
          header: t("importColumnLine"),
          rowHeader: true,
          // The line number in the operator's own spreadsheet, not an index.
          render: (row) => String(row.sourceLine),
        },
        {
          key: "problem",
          header: t("importColumnProblem"),
          render: (row) => codeLabel(problemT, row.code),
        },
        {
          key: "column",
          header: t("importColumnSku"),
          monospace: true,
          render: (row) => row.column ?? UNRENDERABLE,
        },
      ]}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Receiving                                                                   */
/* -------------------------------------------------------------------------- */

export function ReceiptsTable({
  rows,
  renderAction,
}: {
  readonly rows: readonly ReceiptRow[];
  readonly renderAction?: (row: ReceiptRow) => ReactNode;
}) {
  const t = useTranslations("Receiving");

  return (
    <EntityTable<ReceiptRow>
      testId="table-receipts"
      caption={t("receiptsCaption", { count: rows.length })}
      rows={rows}
      rowKey={(row) => row.receiptId}
      columns={[
        {
          key: "receiptNumber",
          header: t("columnReceiptNumber"),
          rowHeader: true,
          render: (row) => row.receiptNumber,
        },
        {
          key: "businessDate",
          header: t("columnBusinessDate"),
          monospace: true,
          /*
           * The stored business date, verbatim. It is already in the warehouse's
           * own timezone (`ADR-0011`); re-formatting it through the browser's
           * locale could show a different day than the ledger posted against.
           */
          render: (row) => row.businessDate,
        },
        {
          key: "order",
          header: t("columnOrder"),
          monospace: true,
          render: (row) => shortId(row.purchaseOrderId),
        },
      ]}
      {...(renderAction === undefined
        ? {}
        : { actionHeader: t("columnAction"), renderAction })}
    />
  );
}

export function ReceiptLinesTable({
  rows,
}: {
  readonly rows: readonly ReceiptLineRow[];
}) {
  const t = useTranslations("Receiving");
  const kindT = useTranslations("ReceiptLineKind") as unknown as CodeTranslator;
  const classificationT = useTranslations(
    "ReceiptClassification",
  ) as unknown as CodeTranslator;
  const stockT = useTranslations("StockStatus") as unknown as CodeTranslator;

  return (
    <EntityTable<ReceiptLineRow>
      testId="table-receipt-lines"
      caption={t("linesCaption", { count: rows.length })}
      rows={rows}
      rowKey={(row) => row.receiptLineId}
      columns={[
        {
          key: "item",
          header: t("columnItem"),
          rowHeader: true,
          render: (row) => shortId(row.itemId),
        },
        {
          key: "quantity",
          header: t("columnQuantity"),
          monospace: true,
          render: (row) =>
            withUnit(row.capturedQuantity.minorUnits, row.capturedQuantity.uom),
        },
        {
          key: "kind",
          header: t("columnKind"),
          render: (row) => (
            <StatusBadge
              tone={KIND_TONES[row.kind] ?? "neutral"}
              label={codeLabel(kindT, row.kind)}
            />
          ),
        },
        {
          key: "classification",
          header: t("columnClassification"),
          render: (row) => (
            <StatusBadge
              tone={CLASSIFICATION_TONES[row.classification] ?? "neutral"}
              label={codeLabel(classificationT, row.classification)}
            />
          ),
        },
        {
          key: "stockStatus",
          header: t("columnStockStatus"),
          render: (row) => (
            <StatusBadge
              tone={STOCK_TONES[row.stockStatus] ?? "neutral"}
              label={codeLabel(stockT, row.stockStatus)}
            />
          ),
        },
      ]}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Label evidence                                                              */
/* -------------------------------------------------------------------------- */

export function PrintJobsTable({
  rows,
}: {
  readonly rows: readonly PrintJobRow[];
}) {
  const t = useTranslations("LabelEvidence");

  return (
    <EntityTable<PrintJobRow>
      testId="table-print-jobs"
      caption={t("caption", { count: rows.length })}
      rows={rows}
      rowKey={(row) => row.labelPrintJobId}
      columns={[
        {
          key: "template",
          header: t("columnTemplate"),
          rowHeader: true,
          render: (row) => row.templateCode,
        },
        {
          key: "version",
          header: t("columnVersion"),
          monospace: true,
          render: (row) => String(row.templateVersion),
        },
        {
          key: "reason",
          header: t("columnReason"),
          monospace: true,
          // `INITIAL` and `REPRINT` stay English: they are code identifiers the
          // audit row cites (`D-06`).
          render: (row) => row.reason,
        },
        {
          key: "status",
          header: t("columnStatus"),
          render: (row) => (
            <StatusBadge
              tone={row.status === "GENERATED" ? "success" : "muted"}
              label={row.status}
            />
          ),
        },
        {
          key: "hash",
          header: t("columnHash"),
          monospace: true,
          // Truncated: 64 hex characters is unreadable, and the first twelve are
          // enough to match one row against a server log.
          render: (row) => `${row.payloadHash.slice(0, 12)}…`,
        },
      ]}
    />
  );
}
