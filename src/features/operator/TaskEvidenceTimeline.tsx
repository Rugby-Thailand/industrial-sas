"use client";

/** The append-only evidence stream an operator inherits with a task. */
import { useLocale, useTranslations } from "next-intl";

import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  listOperatorTaskEvidenceRef,
  type OperatorTaskRow,
  type TaskEvidenceRow,
} from "@/lib/convex/platformApi";

import { MasterDataPanel } from "../masterData/MasterDataPanel";

const EVIDENCE_TONE = {
  SCAN: "accent",
  QUANTITY: "success",
  NOTE: "neutral",
  HANDOVER: "warning",
} as const;

export function TaskEvidenceTimeline({
  task,
}: {
  readonly task: OperatorTaskRow;
}) {
  const t = useTranslations("OperatorWork");

  return (
    <section
      aria-labelledby={`task-timeline-title-${task.operatorTaskId}`}
      className="rounded-xl border border-border bg-surface p-4"
      data-testid="task-evidence-timeline"
    >
      <h2
        id={`task-timeline-title-${task.operatorTaskId}`}
        className="text-lg font-semibold text-text"
      >
        {t("timelineTitle")}
      </h2>
      <p className="mt-1 text-sm text-muted">{t("timelineDescription")}</p>
      <div className="mt-4">
        <MasterDataPanel<
          TaskEvidenceRow,
          {
            warehouseId: string;
            operatorTaskId: string;
            maxPageSize?: number;
            cursor?: string;
          }
        >
          queryRef={listOperatorTaskEvidenceRef}
          scope="WAREHOUSE"
          buildArgs={({ warehouseId, cursor }) => ({
            warehouseId,
            operatorTaskId: task.operatorTaskId,
            ...(cursor === undefined ? {} : { cursor }),
          })}
          renderRows={(rows) => <EvidenceList rows={rows} />}
          paginationLabel={t("timelinePagination")}
        />
      </div>
    </section>
  );
}

function EvidenceList({ rows }: { readonly rows: readonly TaskEvidenceRow[] }) {
  const t = useTranslations("OperatorWork");
  const locale = useLocale();
  const formatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  });

  return (
    <ol className="flex flex-col gap-3" data-testid="task-evidence-list">
      {rows.map((row) => (
        <li
          key={row.evidenceId}
          className="grid grid-cols-[auto_1fr] gap-x-3 rounded-lg border border-border p-3"
        >
          <span className="font-mono text-xs text-muted">#{row.sequence}</span>
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <StatusBadge
                tone={EVIDENCE_TONE[row.kind]}
                label={t(`evidenceKind.${row.kind}`)}
              />
              <time
                dateTime={new Date(row.capturedAt).toISOString()}
                className="text-xs text-muted"
              >
                {formatter.format(row.capturedAt)}
              </time>
            </div>
            {row.resolvedSku === undefined ? null : (
              <p className="font-mono text-sm text-text">
                {t("timelineResolvedItem", { sku: row.resolvedSku })}
              </p>
            )}
            {row.enteredQuantity === undefined ? null : (
              <p className="font-mono text-sm text-text">
                {t("timelineQuantity", {
                  quantity: row.enteredQuantity.minorUnits,
                  uom: row.enteredQuantity.uom,
                })}
              </p>
            )}
            {row.note === undefined ? null : (
              <p className="text-sm text-text">{row.note}</p>
            )}
            {row.manualEntryReason === undefined ? null : (
              <p className="text-xs text-muted">
                {t("timelineManualReason", { reason: row.manualEntryReason })}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
