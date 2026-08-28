"use client";

import { useTranslations } from "next-intl";
import { Fragment } from "react";

import { DataTable } from "@/components/table/DataTable";
import { StatusBadge, type BadgeTone } from "@/components/ui/StatusBadge";
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
    <DataTable<BalanceRow>
      testId="table-balances"
      caption={caption}
      rows={rows}
      rowKey={(row) => row.bucketKey}
      columns={[
        {
          key: "bucket",
          header: t("columnBucket"),
          rowHeader: true,
          monospace: false,
          render: (row) => <BucketIdentity bucketKey={row.bucketKey} />,
        },
        {
          key: "status",
          header: t("columnStatus"),
          render: (row) => (
            <StatusBadge
              tone={STATUS_TONES[row.stockStatus] ?? "neutral"}
              label={codeLabel(statusT, row.stockStatus)}
            />
          ),
        },
        {
          key: "quantity",
          header: t("columnQuantity"),
          align: "right",
          cellClassName: "tabular-nums font-semibold",
          render: (row) => formatMinorUnits(row.minorUnits, row.uom),
        },
        {
          key: "uom",
          header: t("columnUom"),
          monospace: true,
          render: (row) => row.uom,
        },
      ]}
    />
  );
}
