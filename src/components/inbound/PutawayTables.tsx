"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { EntityTable } from "@/components/masterData/EntityTable";
import { StatusBadge, type BadgeTone } from "@/components/ui/StatusBadge";
import type { PutawayTaskRow } from "@/lib/convex/inboundApi";
import { codeLabel, type CodeTranslator } from "@/lib/domainLabels";

import { identifier, withBaseUnit } from "./InboundCells";

const TASK_TONES: Readonly<Record<string, BadgeTone>> = {
  READY: "accent",
  CLAIMED: "pending",
  CONFIRMED: "success",
  CANCELLED: "muted",
};

export function PutawayTasksTable({
  rows,
  renderAction,
}: {
  readonly rows: readonly PutawayTaskRow[];
  readonly renderAction?: (row: PutawayTaskRow) => ReactNode;
}) {
  const t = useTranslations("Putaway");
  const statusT = useTranslations(
    "PutawayTaskStatus",
  ) as unknown as CodeTranslator;

  return (
    <EntityTable<PutawayTaskRow>
      testId="table-putaway-tasks"
      caption={t("caption", { count: rows.length })}
      rows={rows}
      rowKey={(row) => row.putawayTaskId}
      columns={[
        {
          key: "item",
          header: t("columnItem"),
          rowHeader: true,
          render: (row) => identifier(row.itemId),
        },
        {
          key: "quantity",
          header: t("columnQuantity"),
          monospace: true,

          render: (row) => withBaseUnit(row.baseMinorUnits, row.baseUom),
        },
        {
          key: "from",
          header: t("columnFrom"),
          monospace: true,
          render: (row) => identifier(row.fromLocationId),
        },
        {
          key: "status",
          header: t("columnStatus"),
          render: (row) => (
            <StatusBadge
              tone={TASK_TONES[row.status] ?? "neutral"}
              label={codeLabel(statusT, row.status)}
            />
          ),
        },
        {
          key: "recommended",
          header: t("columnRecommended"),
          monospace: true,
          render: (row) => identifier(row.recommendedLocationId),
        },
        {
          key: "chosen",
          header: t("columnChosen"),
          monospace: true,
          // Shown next to the recommendation, because the pair *is* the override
          // record: either alone says nothing about what happened.
          render: (row) => identifier(row.chosenLocationId),
        },
      ]}
      {...(renderAction === undefined
        ? {}
        : { actionHeader: t("columnAction"), renderAction })}
    />
  );
}
