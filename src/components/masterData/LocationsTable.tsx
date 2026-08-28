"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { DataTable } from "@/components/table/DataTable";
import { StatusBadge, type BadgeTone } from "@/components/ui/StatusBadge";
import type { LocationRow } from "@/lib/convex/masterDataApi";
import { codeLabel, type CodeTranslator } from "@/lib/domainLabels";

const STATUS_TONES: Readonly<Record<string, BadgeTone>> = {
  ACTIVE: "success",
  INACTIVE: "muted",
};

export function LocationsTable({
  rows,
  renderStatus,
  renderAction,
}: {
  readonly rows: readonly LocationRow[];
  readonly renderStatus?: (row: LocationRow) => ReactNode;
  readonly renderAction?: (row: LocationRow) => ReactNode;
}) {
  const t = useTranslations("MasterData");
  const statusT = useTranslations(
    "MasterDataStatus",
  ) as unknown as CodeTranslator;
  const typeT = useTranslations("LocationType") as unknown as CodeTranslator;

  return (
    <DataTable<LocationRow>
      testId="table-locations"
      caption={t("locationsCaption", { count: rows.length })}
      rows={rows}
      rowKey={(row) => row.locationId}
      columns={[
        {
          key: "code",
          header: t("columnLocationCode"),
          rowHeader: true,
          render: (row) => row.code,
        },
        {
          key: "locationType",
          header: t("columnLocationType"),
          render: (row) => codeLabel(typeT, row.locationType),
        },
        {
          key: "status",
          header: t("columnStatus"),
          render: (row) =>
            renderStatus === undefined ? (
              <StatusBadge
                tone={STATUS_TONES[row.status] ?? "neutral"}
                label={codeLabel(statusT, row.status)}
              />
            ) : (
              renderStatus(row)
            ),
        },
      ]}
      {...(renderAction === undefined
        ? {}
        : { actionHeader: t("columnAction"), renderAction })}
    />
  );
}
