"use client";

/**
 * The shared work board, as columns.
 *
 * One table for "My work" and for the site queue, because they are the same
 * rows read through two indexes; a second table would drift the moment either
 * gained a column.
 *
 * The lease is rendered as **words plus a glyph**, never as a colour alone
 * (plan §17): "held by you, 4 min left", "lease lapsed — free to take",
 * "unclaimed". A lapsed lease is deliberately not styled as an error — nobody
 * did anything wrong, and the row is now an opportunity rather than a fault.
 */
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { EntityTable } from "@/components/masterData/EntityTable";
import { StatusBadge, type BadgeTone } from "@/components/ui/StatusBadge";
import type { LeaseView, OperatorTaskRow } from "@/lib/convex/platformApi";
import { codeLabel, type CodeTranslator } from "@/lib/domainLabels";

const STATUS_TONES: Readonly<Record<string, BadgeTone>> = {
  AVAILABLE: "accent",
  CLAIMED: "pending",
  COMPLETED: "success",
  CANCELLED: "muted",
};

const LEASE_TONES: Readonly<Record<LeaseView["kind"], BadgeTone>> = {
  UNCLAIMED: "neutral",
  HELD: "pending",
  EXPIRED: "warning",
  CLOSED: "muted",
};

/** Whole minutes, rounded up, so "0 min left" never means "still yours". */
const minutesLeft = (remainingMs: number): number =>
  Math.max(1, Math.ceil(remainingMs / 60_000));

export function OperatorTaskTable({
  rows,
  currentUserId,
  renderAction,
}: {
  readonly rows: readonly OperatorTaskRow[];
  /** Who is looking, so "held by you" is distinguishable from "held". */
  readonly currentUserId?: string;
  readonly renderAction?: (row: OperatorTaskRow) => ReactNode;
}) {
  const t = useTranslations("OperatorWork");
  const statusT = useTranslations(
    "OperatorTaskStatus",
  ) as unknown as CodeTranslator;

  const leaseLabel = (lease: LeaseView): string => {
    switch (lease.kind) {
      case "UNCLAIMED":
        return t("leaseUnclaimed");
      case "HELD":
        return lease.holderUserId === currentUserId
          ? t("leaseHeldByYou", { minutes: minutesLeft(lease.remainingMs) })
          : t("leaseHeld", { minutes: minutesLeft(lease.remainingMs) });
      case "EXPIRED":
        return t("leaseExpired");
      case "CLOSED":
        return t("leaseClosed");
    }
  };

  return (
    <EntityTable<OperatorTaskRow>
      testId="table-operator-tasks"
      caption={t("caption", { count: rows.length })}
      rows={rows}
      rowKey={(row) => row.operatorTaskId}
      columns={[
        {
          key: "taskNumber",
          header: t("columnTask"),
          rowHeader: true,
          monospace: true,
          render: (row) => row.taskNumber,
        },
        {
          key: "instruction",
          header: t("columnInstruction"),
          render: (row) => row.instruction,
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
        {
          key: "lease",
          header: t("columnLease"),
          render: (row) => (
            <StatusBadge
              tone={LEASE_TONES[row.lease.kind]}
              label={leaseLabel(row.lease)}
            />
          ),
        },
        {
          key: "evidence",
          header: t("columnEvidence"),
          monospace: true,
          /*
           * The count is shown on every row, including zero, because it is what
           * an operator picking up a lapsed task needs to know before they
           * start: partial work is preserved, and a blank cell would read as
           * "nothing was done" exactly where that is most expensive.
           */
          render: (row) => t("evidenceCount", { count: row.evidenceCount }),
        },
      ]}
      {...(renderAction === undefined
        ? {}
        : { actionHeader: t("columnActions"), renderAction })}
    />
  );
}
