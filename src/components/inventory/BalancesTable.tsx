"use client";

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

const STATUS_TONES: Readonly<Record<string, BadgeTone>> = {
  AVAILABLE: "success",
  QC_HOLD: "warning",
  QUARANTINE: "warning",
  REJECTED: "danger",
  SCRAP: "danger",
  EXPIRED: "danger",
};

const BUCKET_LABEL_KEYS: Readonly<Record<BucketDimension, string>> = {
  item: "bucketItem",
  location: "bucketLocation",
  boundary: "bucketBoundary",
  lot: "bucketLot",
  serial: "bucketSerial",
  handlingUnit: "bucketHandlingUnit",
  owner: "bucketOwner",
};

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
