"use client";

import { useLocale, useTranslations } from "next-intl";

import { StatusBadge } from "@/components/ui/StatusBadge";
import { TableScroller } from "@/components/ui/TableScroller";
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
    <TableScroller label={caption} testId="table-transactions">
      <table className="w-full border-collapse text-sm">
        <caption className="px-4 py-3 text-left text-sm text-muted">
          {caption}
        </caption>
        <thead>
          <tr className="border-b border-border-strong text-left">
            <th scope="col" className="px-4 py-2 font-semibold">
              {t("columnTransaction")}
            </th>
            <th scope="col" className="px-4 py-2 font-semibold">
              {t("columnType")}
            </th>
            <th scope="col" className="px-4 py-2 font-semibold">
              {t("columnOccurredAt")}
            </th>
            <th scope="col" className="px-4 py-2 font-semibold">
              {t("columnBusinessDate")}
            </th>
            <th scope="col" className="px-4 py-2 text-right font-semibold">
              {t("columnLineCount")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.transactionId}
              className="border-b border-border last:border-0"
            >
              <th
                scope="row"
                className="px-4 py-3 text-left font-mono text-xs font-normal break-all text-muted"
                title={row.transactionId}
              >
                {abbreviateIdentifier(row.transactionId, 8)}
                {row.reversalOfTransactionId === undefined ? null : (
                  <span
                    className="mt-1 block"
                    title={`${t("columnReversalOf")}: ${row.reversalOfTransactionId}`}
                  >
                    <StatusBadge tone="pending" label={t("reversalMarker")} />
                  </span>
                )}
              </th>
              <td className="px-4 py-3">{codeLabel(typeT, row.type)}</td>
              <td className="tabular px-4 py-3">
                {formatInstant(row.occurredAt, locale)}
              </td>
              <td className="tabular px-4 py-3">
                {formatBusinessDateIso(row.businessDate)}
              </td>
              <td className="tabular px-4 py-3 text-right">{row.lineCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroller>
  );
}
