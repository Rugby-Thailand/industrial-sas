"use client";

/**
 * The putaway board, as columns.
 *
 * Its own module for the same reason as `QualityTables`: putaway is a terminal
 * inbound workflow, nothing in purchasing or receiving renders this table, and
 * keeping it beside those tables made every putaway screen carry their
 * namespaces.
 */
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { EntityTable } from "@/components/masterData/EntityTable";
import { StatusBadge, type BadgeTone } from "@/components/ui/StatusBadge";
import type { PutawayTaskRow } from "@/lib/convex/inboundApi";
import { codeLabel, type CodeTranslator } from "@/lib/domainLabels";

import { shortId } from "./InboundCells";

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
          render: (row) => shortId(row.itemId),
        },
        {
          key: "quantity",
          header: t("columnQuantity"),
          monospace: true,
          render: (row) => String(row.baseMinorUnits / 1000),
        },
        {
          key: "from",
          header: t("columnFrom"),
          monospace: true,
          render: (row) => shortId(row.fromLocationId),
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
          render: (row) => shortId(row.recommendedLocationId),
        },
        {
          key: "chosen",
          header: t("columnChosen"),
          monospace: true,
          // Shown next to the recommendation, because the pair *is* the override
          // record: either alone says nothing about what happened.
          render: (row) => shortId(row.chosenLocationId),
        },
      ]}
      {...(renderAction === undefined
        ? {}
        : { actionHeader: t("columnAction"), renderAction })}
    />
  );
}
