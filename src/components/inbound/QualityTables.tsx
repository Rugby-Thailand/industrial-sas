"use client";

/**
 * The inspection queue, as columns.
 *
 * Its own module rather than a section of `InboundTables` because it is the only
 * table on the quality screens, and a module is what the bundler and the message
 * manifest both split on: while this lived beside the purchasing and receiving
 * tables, opening a quality screen shipped their namespaces too.
 *
 * The conventions are `InboundTables`': a state is a word and a glyph, never a
 * colour (`INV-0010-07`), and a code the client does not know yet falls back to
 * the code itself rather than to a blank cell.
 */
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { EntityTable } from "@/components/masterData/EntityTable";
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
    <EntityTable<InspectionRow>
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
          /*
           * The plan as it was computed *at receipt*, not as the profile reads
           * now. A profile changes; the plan applied to this delivery does not,
           * and it is the evidence an auditor reads.
           */
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
