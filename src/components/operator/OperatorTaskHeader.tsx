"use client";

import { useLocale, useTranslations } from "next-intl";

import { Notice } from "@/components/ui/Notice";
import { StatusBadge, type BadgeTone } from "@/components/ui/StatusBadge";
import type { ConnectionStatus } from "@/lib/convex/connection";
import type { OperatorTaskRow } from "@/lib/convex/platformApi";

const CONNECTION_TONE: Readonly<Record<ConnectionStatus, BadgeTone>> = {
  CONNECTED: "success",
  CONNECTING: "pending",
  DISCONNECTED: "danger",
  NOT_CONFIGURED: "warning",
};

export function OperatorTaskHeader({
  task,
  connectionStatus,
}: {
  readonly task: OperatorTaskRow;
  readonly connectionStatus: ConnectionStatus;
}) {
  const t = useTranslations("OperatorWork");
  const locale = useLocale();
  const due =
    task.dueAt === undefined
      ? t("headerNoDueDate")
      : new Intl.DateTimeFormat(locale, {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "Asia/Bangkok",
        }).format(task.dueAt);
  const owner = (() => {
    switch (task.lease.kind) {
      case "HELD":
        return t("headerOwnerYou");
      case "EXPIRED":
        return t("headerOwnerExpired");
      case "UNCLAIMED":
        return t("headerOwnerUnclaimed");
      case "CLOSED":
        return t("headerOwnerClosed");
    }
  })();

  return (
    <header
      className="rounded-xl border border-border bg-surface p-4"
      data-testid="operator-task-header"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-sm text-muted">{task.taskNumber}</p>
          <h2 className="mt-1 text-xl font-semibold text-text">
            {task.instruction}
          </h2>
        </div>
        <StatusBadge
          tone={CONNECTION_TONE[connectionStatus]}
          label={t(`connectionStatus.${connectionStatus}`)}
        />
      </div>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        {[
          [t("headerSource"), t("headerSourceSupervisor")],
          [t("headerOwner"), owner],
          [t("headerDue"), due],
          [
            t("headerProgress"),
            t("evidenceCount", { count: task.evidenceCount }),
          ],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="font-medium text-muted">{label}</dt>
            <dd className="mt-1 text-text">{value}</dd>
          </div>
        ))}
      </dl>

      {task.status === "CLAIMED" ? (
        <div className="mt-4">
          <Notice
            tone="warning"
            title={t("headerIrreversibleTitle")}
            body={t("headerIrreversibleBody")}
            testId="task-irreversible-warning"
          />
        </div>
      ) : null}
    </header>
  );
}
