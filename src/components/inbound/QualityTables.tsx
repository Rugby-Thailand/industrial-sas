"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { DataTable } from "@/components/table/DataTable";
import { StatusBadge, type BadgeTone } from "@/components/ui/StatusBadge";
import type { InspectionRow } from "@/lib/convex/inboundApi";
import { codeLabel, type CodeTranslator } from "@/lib/domainLabels";
import { UNRENDERABLE } from "@/lib/formatters";

import { identifier } from "./InboundCells";

const INSPECTION_TONES: Readonly<Record<string, BadgeTone>> = {
  OPEN: "accent",
  PENDING_APPROVAL: "pending",
  DISPOSED: "success",
  CANCELLED: "muted",
};

export function InspectionsTable({
  rows,
  renderAction,
}: {
  readonly rows: readonly InspectionRow[];
  readonly renderAction?: (row: InspectionRow) => ReactNode;
}) {
  const t = useTranslations("Quality");
  const statusT = useTranslations(
    "InspectionStatus",
  ) as unknown as CodeTranslator;
  const strategyT = useTranslations(
    "SamplingStrategy",
  ) as unknown as CodeTranslator;
  const dispositionT = useTranslations(
    "QcDisposition",
  ) as unknown as CodeTranslator;

  return (
    <DataTable<InspectionRow>
      testId="table-inspections"
      caption={t("caption", { count: rows.length })}
      rows={rows}
      rowKey={(row) => row.inspectionId}
      columns={[
        {
          key: "item",
          header: t("columnItem"),
          rowHeader: true,
          render: (row) => identifier(row.itemId),
        },
        {
          key: "status",
          header: t("columnStatus"),
          render: (row) => (
            <StatusBadge
              tone={INSPECTION_TONES[row.status] ?? "neutral"}
              label={codeLabel(statusT, row.status)}
            />
          ),
        },
        {
          key: "strategy",
          header: t("columnStrategy"),
          render: (row) => codeLabel(strategyT, row.strategy),
        },
        {
          key: "sample",
          header: t("columnSample"),
          monospace: true,

          render: (row) =>
            t("sampleOf", { sample: row.sampleSize, lot: row.lotSize }),
        },
        {
          key: "disposition",
          header: t("columnDisposition"),
          render: (row) =>
            row.disposition === undefined
              ? UNRENDERABLE
              : codeLabel(dispositionT, row.disposition),
        },
      ]}
      {...(renderAction === undefined
        ? {}
        : { actionHeader: t("columnAction"), renderAction })}
    />
  );
}
