"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { DataTable } from "@/components/table/DataTable";
import { StatusBadge, type BadgeTone } from "@/components/ui/StatusBadge";
import type { ItemRow } from "@/lib/convex/masterDataApi";
import { codeLabel, type CodeTranslator } from "@/lib/domainLabels";

const STATUS_TONES: Readonly<Record<string, BadgeTone>> = {
  ACTIVE: "success",
  INACTIVE: "muted",
};

const TRACKING_TONES: Readonly<Record<string, BadgeTone>> = {
  NONE: "neutral",
  LOT: "accent",
  LOT_SERIAL: "warning",
};

export function ItemsTable({
  rows,
  renderAction,
}: {
  readonly rows: readonly ItemRow[];

  readonly renderAction?: (row: ItemRow) => ReactNode;
}) {
  const t = useTranslations("MasterData");
  const statusT = useTranslations(
    "MasterDataStatus",
  ) as unknown as CodeTranslator;
  const trackingT = useTranslations(
    "TrackingMode",
  ) as unknown as CodeTranslator;

  return (
    <DataTable<ItemRow>
      testId="table-items"
      caption={t("itemsCaption", { count: rows.length })}
      rows={rows}
      rowKey={(row) => row.itemId}
      columns={[
        {
          key: "sku",
          header: t("columnSku"),
          rowHeader: true,
          render: (row) => row.sku,
        },
        { key: "name", header: t("columnName"), render: (row) => row.name },
        {
          key: "baseUom",
          header: t("columnBaseUom"),
          monospace: true,
          render: (row) => row.baseUom,
        },
        {
          key: "trackingMode",
          header: t("columnTrackingMode"),
          render: (row) => (
            <StatusBadge
              tone={TRACKING_TONES[row.trackingMode] ?? "neutral"}
              label={codeLabel(trackingT, row.trackingMode)}
            />
          ),
        },
        {
          key: "status",
          header: t("columnStatus"),
          render: (row) => (
            <StatusBadge
              tone={STATUS_TONES[row.status] ?? "neutral"}
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
