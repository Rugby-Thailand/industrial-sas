"use client";

/**
 * Posted inventory transactions, newest first.
 *
 * This is a *history*, and the one thing it must never look like is an editable
 * list. There is no row action, no inline edit, and no delete: a correction is a
 * second transaction that names the first (`INV-0003-08`), and the reversal
 * column is how that relationship appears on screen — a marked row that points at
 * the transaction it compensates, with the original left exactly as it was.
 *
 * Both a timestamp and a business date are shown, because they answer different
 * questions and can disagree. The instant is when the server accepted the
 * posting, in UTC, rendered in the organization timezone. The business date is
 * the day the warehouse counts it against (`D-05`) — and a receiving shift that
 * crosses midnight in Bangkok produces rows where the two differ by a day. A
 * screen that showed only one of them would make that look like a defect.
 *
 * Like the balances table, it sits in the shared `TableScroller`: the timestamp
 * and business-date columns are exactly the ones a 360px viewport pushes off the
 * right edge, and until now nothing said so and no keyboard could reach them.
 */
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
