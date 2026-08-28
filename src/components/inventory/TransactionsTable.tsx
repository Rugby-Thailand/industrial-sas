"use client";

import { useLocale, useTranslations } from "next-intl";

import { DataTable } from "@/components/table/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { TransactionRow } from "@/lib/convex/ledgerApi";
import { codeLabel, type CodeTranslator } from "@/lib/domainLabels";
import {
  abbreviateIdentifier,
  formatBusinessDateIso,
  formatInstant,
} from "@/lib/formatters";
import type { AppLocale } from "@/i18n/routing";

export function TransactionsTable({
  rows,
}: {
  readonly rows: readonly TransactionRow[];
}) {
  const t = useTranslations("Inventory");
  const typeT = useTranslations("TransactionType") as unknown as CodeTranslator;
  const locale = useLocale() as AppLocale;
  const caption = t("historyCaption", { count: rows.length });

  return (
    <DataTable<TransactionRow>
      testId="table-transactions"
      caption={caption}
      rows={rows}
      rowKey={(row) => row.transactionId}
      columns={[
        {
          key: "transaction",
          header: t("columnTransaction"),
          rowHeader: true,
          cellClassName: "break-all text-muted",
          render: (row) => (
            <span title={row.transactionId}>
              {abbreviateIdentifier(row.transactionId, 8)}
              {row.reversalOfTransactionId === undefined ? null : (
                <span
                  className="mt-1 block"
                  title={`${t("columnReversalOf")}: ${row.reversalOfTransactionId}`}
                >
                  <StatusBadge tone="pending" label={t("reversalMarker")} />
                </span>
              )}
            </span>
          ),
        },
        {
          key: "type",
          header: t("columnType"),
          render: (row) => codeLabel(typeT, row.type),
        },
        {
          key: "occurredAt",
          header: t("columnOccurredAt"),
          cellClassName: "tabular-nums",
          render: (row) => formatInstant(row.occurredAt, locale),
        },
        {
          key: "businessDate",
          header: t("columnBusinessDate"),
          cellClassName: "tabular-nums",
          render: (row) => formatBusinessDateIso(row.businessDate),
        },
        {
          key: "lineCount",
          header: t("columnLineCount"),
          align: "right",
          cellClassName: "tabular-nums",
          render: (row) => row.lineCount,
        },
      ]}
    />
  );
}
