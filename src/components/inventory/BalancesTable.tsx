"use client";

/**
 * Current balances, as a semantic table.
 *
 * A real `<table>` with a `<caption>` and `scope`d headers, not a grid of divs.
 * The UX plan (§7) requires it and the reason is practical: a screen reader user
 * navigating a balance table needs "row 4, quantity, 18450.500 KG", which comes
 * from the table semantics and from nothing else.
 *
 * ### What each column is, and why it renders the way it does
 *
 * - **Bucket key.** The canonical identity of a stock bucket — organization,
 *   warehouse, item, location, lot, handling unit, owner, status, all
 *   length-prefixed into one string (`encodeBucketKey`). It is long and it is not
 *   for reading, so it is abbreviated at both ends with the full value in
 *   `title` and in the DOM. Both ends, because truncating one makes two
 *   different buckets look identical.
 * - **Status.** A word, always (`INV-0010-07`). The badge's colour is the second
 *   signal, never the first, and an unknown status renders its raw code rather
 *   than a placeholder.
 * - **Quantity.** Through `formatMinorUnits`, so the digits shown are the digits
 *   stored — no locale decimal mark, no grouping, no rounding (`ADR-0004` §5).
 *   Right-aligned and tabular so two rows of the same magnitude are visibly the
 *   same width.
 * - **UOM.** Separate from the quantity rather than concatenated, so a narrow
 *   handheld column can wrap the unit without splitting the number.
 */
import { useTranslations } from "next-intl";

import { StatusBadge, type BadgeTone } from "@/components/ui/StatusBadge";
import type { BalanceRow } from "@/lib/convex/ledgerApi";
import { codeLabel, type CodeTranslator } from "@/lib/domainLabels";
import { abbreviateIdentifier, formatMinorUnits } from "@/lib/formatters";

/**
 * Status tones. `AVAILABLE` is the only one that reads as "fine"; everything
 * else is stock an operator may not simply pick, so nothing else is `success`.
 * An unlisted status falls back to `neutral` rather than to a colour that would
 * imply a judgement the client has no basis for.
 */
const STATUS_TONES: Readonly<Record<string, BadgeTone>> = {
  AVAILABLE: "success",
  QC_HOLD: "warning",
  QUARANTINE: "warning",
  REJECTED: "danger",
  SCRAP: "danger",
  EXPIRED: "danger",
};

export function BalancesTable({
  rows,
}: {
  readonly rows: readonly BalanceRow[];
}) {
  const t = useTranslations("Inventory");
  const statusT = useTranslations("StockStatus") as unknown as CodeTranslator;

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full border-collapse text-sm">
        <caption className="px-4 py-3 text-left text-sm text-muted">
          {t("balancesCaption", { count: rows.length })}
        </caption>
        <thead>
          <tr className="border-b border-border-strong text-left">
            <th scope="col" className="px-4 py-2 font-semibold">
              {t("columnBucket")}
            </th>
            <th scope="col" className="px-4 py-2 font-semibold">
              {t("columnStatus")}
            </th>
            <th scope="col" className="px-4 py-2 text-right font-semibold">
              {t("columnQuantity")}
            </th>
            <th scope="col" className="px-4 py-2 font-semibold">
              {t("columnUom")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.bucketKey}
              className="border-b border-border last:border-0"
            >
              <th
                scope="row"
                className="px-4 py-3 text-left font-mono text-xs font-normal break-all text-muted"
                title={row.bucketKey}
              >
                {abbreviateIdentifier(row.bucketKey, 10)}
              </th>
              <td className="px-4 py-3">
                <StatusBadge
                  tone={STATUS_TONES[row.stockStatus] ?? "neutral"}
                  label={codeLabel(statusT, row.stockStatus)}
                />
              </td>
              <td className="tabular px-4 py-3 text-right font-semibold">
                {formatMinorUnits(row.minorUnits, row.uom)}
              </td>
              <td className="px-4 py-3 font-mono text-xs">{row.uom}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
