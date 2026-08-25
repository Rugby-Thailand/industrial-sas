"use client";

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

const minutesLeft = (remainingMs: number): number =>
  Math.max(1, Math.ceil(remainingMs / 60_000));

export function OperatorTaskTable({
  rows,
  currentUserId,
  renderAction,
}: {
  readonly rows: readonly OperatorTaskRow[];

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

          render: (row) => t("evidenceCount", { count: row.evidenceCount }),
        },
      ]}
      {...(renderAction === undefined
        ? {}
        : { actionHeader: t("columnActions"), renderAction })}
    />
  );
}
