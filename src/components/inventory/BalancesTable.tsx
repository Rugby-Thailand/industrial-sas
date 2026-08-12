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
 * - **Bucket.** The identity of a stock bucket — organization, warehouse, item,
 *   location, lot, handling unit, owner, status, all length-prefixed into one
 *   string (`encodeBucketKey`). That string was abbreviated at both ends, and
 *   the abbreviation collapsed: the head is the organization prefix and the tail
 *   is the stock status, so several different buckets rendered as the same text.
 *   The cell now names the dimensions the rows actually differ on
 *   (`describeBucketKey`), each labelled and each whole. A key the decoder
 *   refuses is shown as itself rather than as a guess.
 * - **Status.** A word, always (`INV-0010-07`). The badge's colour is the second
 *   signal, never the first, and an unknown status renders its raw code rather
 *   than a placeholder.
 * - **Quantity.** Through `formatMinorUnits`, so the digits shown are the digits
 *   stored — no locale decimal mark, no grouping, no rounding (`ADR-0004` §5).
 *   Right-aligned and tabular so two rows of the same magnitude are visibly the
 *   same width.
 * - **UOM.** Separate from the quantity rather than concatenated, so a narrow
 *   handheld column can wrap the unit without splitting the number.
 *
 * The table sits in the shared `TableScroller`, so the horizontal scroll it has
 * always had is now reachable from a keyboard, named after its own caption, and
 * announced in words on a phone — the same treatment every master-data table
 * gets. It was the plain `overflow-x-auto` div that the audit found: a scroller
 * nothing could focus and nothing on screen admitted to.
 */
import { useTranslations } from "next-intl";
import { Fragment } from "react";

import { StatusBadge, type BadgeTone } from "@/components/ui/StatusBadge";
import { TableScroller } from "@/components/ui/TableScroller";
import type { BalanceRow } from "@/lib/convex/ledgerApi";
import { codeLabel, type CodeTranslator } from "@/lib/domainLabels";
import { formatMinorUnits } from "@/lib/formatters";
import {
  describeBucketKey,
  type BucketDimension,
} from "@/lib/inventory/bucketIdentity";

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

/** The `Inventory` key that names each dimension of a bucket. */
const BUCKET_LABEL_KEYS: Readonly<Record<BucketDimension, string>> = {
  item: "bucketItem",
  location: "bucketLocation",
  boundary: "bucketBoundary",
  lot: "bucketLot",
  serial: "bucketSerial",
  handlingUnit: "bucketHandlingUnit",
  owner: "bucketOwner",
};

/**
 * One bucket, as the dimensions that distinguish it.
 *
 * A description list rather than a run of spans, because that is what this is:
 * labelled values. The label matters — a real Convex document ID says nothing
 * about which dimension it fills — and it is what a screen reader reads before
 * each one.
 *
 * Nothing is truncated and nothing hides in a `title`. A value wider than the
 * column is the table's problem, and the table scrolls (`UX §3`); stacking the
 * dimensions is what keeps the column narrow enough that it usually does not
 * have to.
 */
function BucketIdentity({ bucketKey }: { readonly bucketKey: string }) {
  const t = useTranslations("Inventory");
  const parts = describeBucketKey(bucketKey);

  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
      {parts.length === 0 ? (
        <>
          {/*
           * A key this application's own decoder refuses — a row written by a
           * different encoding, or a corrupted value. It is shown whole, because
           * the string itself is the only thing left that is true about it.
           */}
          <dt className="font-normal text-muted">{t("bucketKey")}</dt>
          <dd className="font-mono break-all text-text">{bucketKey}</dd>
        </>
      ) : (
        parts.map((part) => (
          <Fragment key={part.dimension}>
            <dt className="font-normal text-muted">
              {t(BUCKET_LABEL_KEYS[part.dimension])}
            </dt>
            <dd className="font-mono whitespace-nowrap text-text">
              {part.value}
            </dd>
          </Fragment>
        ))
      )}
    </dl>
  );
}

export function BalancesTable({
  rows,
}: {
  readonly rows: readonly BalanceRow[];
}) {
  const t = useTranslations("Inventory");
  const statusT = useTranslations("StockStatus") as unknown as CodeTranslator;
  const caption = t("balancesCaption", { count: rows.length });

  return (
    <TableScroller label={caption} testId="table-balances">
      <table className="w-full border-collapse text-sm">
        <caption className="px-4 py-3 text-left text-sm text-muted">
          {caption}
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
                className="px-4 py-3 text-left align-top font-normal text-text"
              >
                <BucketIdentity bucketKey={row.bucketKey} />
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
    </TableScroller>
  );
}
