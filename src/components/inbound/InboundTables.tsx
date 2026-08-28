"use client";

import {
  Ban,
  CircleStop,
  Clock3,
  PackageCheck,
  PackageOpen,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { DataTable } from "@/components/table/DataTable";
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

import { identifier, withBaseUnit, withUnit } from "./InboundCells";

const ORDER_TONES: Readonly<Record<string, BadgeTone>> = {
  DRAFT: "pending",
  OPEN: "success",
  CLOSED: "muted",
  CANCELLED: "danger",
};

const LINE_TONES: Readonly<Record<string, BadgeTone>> = {
  WAITING: "pending",
  PARTIAL: "accent",
  COMPLETE: "success",
  CLOSED_SHORT: "warning",
  CANCELLED: "danger",
};

type PurchaseOrderLineProgress =
  "WAITING" | "PARTIAL" | "COMPLETE" | "CLOSED_SHORT" | "CANCELLED";

const lineProgress = (row: PurchaseOrderLineRow): PurchaseOrderLineProgress => {
  if (row.status !== "OPEN") return row.status;
  return row.receivedBaseMinorUnits > 0 ? "PARTIAL" : "WAITING";
};

const LINE_PROGRESS_ICONS = {
  WAITING: Clock3,
  PARTIAL: PackageOpen,
  COMPLETE: PackageCheck,
  CLOSED_SHORT: CircleStop,
  CANCELLED: Ban,
} as const;

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
    <DataTable<PurchaseOrderRow>
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

  const renderLineStatus = (row: PurchaseOrderLineRow) => {
    const progress = lineProgress(row);
    const Icon = LINE_PROGRESS_ICONS[progress];
    const label =
      progress === "WAITING"
        ? t("lineStatusWaiting")
        : progress === "PARTIAL"
          ? t("lineStatusPartial")
          : codeLabel(statusT, row.status);
    const percent =
      progress === "PARTIAL" && row.orderedBaseMinorUnits > 0
        ? Math.min(
            100,
            Math.round(
              (row.receivedBaseMinorUnits / row.orderedBaseMinorUnits) * 100,
            ),
          )
        : undefined;

    return (
      <StatusBadge
        tone={LINE_TONES[progress] ?? "neutral"}
        label={label}
        title={t("lineStatusProgress", {
          received: withBaseUnit(row.receivedBaseMinorUnits, row.baseUom),
          ordered: withBaseUnit(row.orderedBaseMinorUnits, row.baseUom),
        })}
        icon={<Icon className="size-3.5" />}
      >
        {percent === undefined ? null : (
          <span className="border-l border-current/30 pl-1.5 tabular-nums">
            {percent}%
          </span>
        )}
      </StatusBadge>
    );
  };

  return (
    <DataTable<PurchaseOrderLineRow>
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
          render: (row) => identifier(row.itemId),
        },
        {
          key: "ordered",
          header: t("columnOrdered"),
          monospace: true,

          render: (row) =>
            withUnit(row.orderedQuantity.minorUnits, row.orderedQuantity.uom),
        },
        {
          key: "received",
          header: t("columnReceived"),
          monospace: true,

          render: (row) =>
            withBaseUnit(row.receivedBaseMinorUnits, row.baseUom),
        },
        {
          key: "outstanding",
          header: t("columnOutstanding"),
          monospace: true,

          render: (row) =>
            withBaseUnit(
              Math.max(
                0,
                row.orderedBaseMinorUnits - row.receivedBaseMinorUnits,
              ),
              row.baseUom,
            ),
        },
        {
          key: "status",
          header: t("columnLineStatus"),
          render: renderLineStatus,
        },
      ]}
      {...(renderAction === undefined
        ? {}
        : { actionHeader: t("columnAction"), renderAction })}
    />
  );
}

export function ImportAcceptedTable({
  rows,
}: {
  readonly rows: readonly ImportRow[];
}) {
  const t = useTranslations("Purchasing");

  return (
    <DataTable<ImportRow>
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
    <DataTable<RejectedImportRow>
      testId="table-import-rejected"
      caption={t("importRejectedCaption", { count: rows.length })}
      rows={rows}
      rowKey={(row) => `${row.sourceLine}:${row.code}`}
      columns={[
        {
          key: "sourceLine",
          header: t("importColumnLine"),
          rowHeader: true,

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

export function ReceiptsTable({
  rows,
  renderAction,
}: {
  readonly rows: readonly ReceiptRow[];
  readonly renderAction?: (row: ReceiptRow) => ReactNode;
}) {
  const t = useTranslations("Receiving");

  return (
    <DataTable<ReceiptRow>
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

          render: (row) => row.businessDate,
        },
        {
          key: "order",
          header: t("columnOrder"),
          monospace: true,

          render: (row) => identifier(row.poNumber),
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
    <DataTable<ReceiptLineRow>
      testId="table-receipt-lines"
      caption={t("linesCaption", { count: rows.length })}
      rows={rows}
      rowKey={(row) => row.receiptLineId}
      columns={[
        {
          key: "item",
          header: t("columnItem"),
          rowHeader: true,
          render: (row) => identifier(row.itemId),
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

export function PrintJobsTable({
  rows,
}: {
  readonly rows: readonly PrintJobRow[];
}) {
  const t = useTranslations("LabelEvidence");
  const reasonT = useTranslations(
    "LabelPrintReason",
  ) as unknown as CodeTranslator;
  const jobStatusT = useTranslations(
    "LabelPrintStatus",
  ) as unknown as CodeTranslator;

  return (
    <DataTable<PrintJobRow>
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

          render: (row) => codeLabel(reasonT, row.reason),
        },
        {
          key: "status",
          header: t("columnStatus"),
          render: (row) => (
            <StatusBadge
              tone={row.status === "GENERATED" ? "success" : "muted"}
              label={codeLabel(jobStatusT, row.status)}
            />
          ),
        },
        {
          key: "hash",
          header: t("columnHash"),
          monospace: true,

          render: (row) => `${row.payloadHash.slice(0, 12)}…`,
        },
      ]}
    />
  );
}
