"use client";

/** Shared task exception report and maker-checker resolution surface. */
import { useLocale, useTranslations } from "next-intl";

import { StatusBadge } from "@/components/ui/StatusBadge";
import { Notice } from "@/components/ui/Notice";
import type { ConnectionStatus } from "@/lib/convex/connection";
import {
  listTaskExceptionsRef,
  reportTaskExceptionRef,
  resolveTaskExceptionRef,
  type OperatorTaskRow,
  type TaskExceptionDisposition,
  type TaskExceptionRow,
} from "@/lib/convex/platformApi";

import { ActiveReasonCodes } from "../inbound/CatalogueOptions";
import { EntityWriteForm } from "../masterData/EntityWriteForm";
import { MasterDataPanel } from "../masterData/MasterDataPanel";

const DISPOSITIONS: readonly TaskExceptionDisposition[] = [
  "RESUME",
  "REASSIGN",
  "STOP",
  "ESCALATE",
];

export function TaskExceptionSheet({
  task,
  connectionStatus,
}: {
  readonly task: OperatorTaskRow;
  readonly connectionStatus: ConnectionStatus;
}) {
  const t = useTranslations("OperatorWork");
  const writeT = useTranslations("Write");
  const canWrite = connectionStatus === "CONNECTED";

  return (
    <section
      aria-labelledby={`task-exception-title-${task.operatorTaskId}`}
      className="rounded-xl border border-border bg-surface p-4"
      data-testid="task-exception-sheet"
    >
      <h2
        id={`task-exception-title-${task.operatorTaskId}`}
        className="text-lg font-semibold text-text"
      >
        {t("exceptionTitle")}
      </h2>
      <p className="mt-1 text-sm text-muted">{t("exceptionDescription")}</p>

      <div className="mt-4 flex flex-col gap-6">
        {canWrite ? (
          <ActiveReasonCodes
            scope="ADJUSTMENT"
            emptyTitle={writeT("noReasonCodes")}
            emptyBody={writeT("noReasonCodesHint")}
            emptyTestId="task-exception-no-reasons"
          >
            {(reasons) => (
              <EntityWriteForm
                testId="form-task-exception-report"
                mutationRef={reportTaskExceptionRef}
                legend={t("exceptionReportLegend")}
                description={t("exceptionReportDescription")}
                submitLabel={t("exceptionReportSubmit")}
                requiredMessage={writeT("required")}
                fields={[
                  {
                    name: "reasonCodeId",
                    label: writeT("reasonCodeLabel"),
                    kind: "select",
                    required: true,
                    placeholder: writeT("selectReasonCode"),
                    options: reasons.map((reason) => ({
                      value: reason.reasonCodeId,
                      label: `${reason.code} · ${reason.name}`,
                    })),
                  },
                  {
                    name: "summary",
                    label: t("exceptionSummary"),
                    kind: "text",
                    required: true,
                  },
                  {
                    name: "evidence",
                    label: t("exceptionEvidence"),
                    kind: "textarea",
                    required: true,
                  },
                  {
                    name: "proposedDisposition",
                    label: t("exceptionProposedDisposition"),
                    kind: "select",
                    required: true,
                    placeholder: t("exceptionSelectDisposition"),
                    options: DISPOSITIONS.map((value) => ({
                      value,
                      label: t(`exceptionDisposition.${value}`),
                    })),
                  },
                  {
                    name: "proposedRecoveryAction",
                    label: t("exceptionProposedRecovery"),
                    kind: "textarea",
                    required: true,
                  },
                ]}
                toArgs={(values, requestId) => ({
                  requestId,
                  warehouseId: task.warehouseId,
                  operatorTaskId: task.operatorTaskId,
                  reasonCodeId: values["reasonCodeId"] ?? "",
                  summary: values["summary"] ?? "",
                  evidence: values["evidence"] ?? "",
                  proposedDisposition: (values["proposedDisposition"] ??
                    "ESCALATE") as TaskExceptionDisposition,
                  proposedRecoveryAction:
                    values["proposedRecoveryAction"] ?? "",
                })}
              />
            )}
          </ActiveReasonCodes>
        ) : (
          <Notice
            tone="warning"
            title={t("exceptionOfflineTitle")}
            body={t("blockReason.evidenceNeedsTaskLease")}
            testId="task-exception-offline"
          />
        )}

        <MasterDataPanel<
          TaskExceptionRow,
          {
            warehouseId: string;
            operatorTaskId: string;
            maxPageSize?: number;
            cursor?: string;
          }
        >
          queryRef={listTaskExceptionsRef}
          scope="WAREHOUSE"
          buildArgs={({ warehouseId, cursor }) => ({
            warehouseId,
            operatorTaskId: task.operatorTaskId,
            ...(cursor === undefined ? {} : { cursor }),
          })}
          renderRows={(rows) => (
            <ExceptionList
              rows={rows}
              canResolve={canWrite}
              warehouseId={task.warehouseId}
            />
          )}
          paginationLabel={t("exceptionPagination")}
        />
      </div>
    </section>
  );
}

function ExceptionList({
  rows,
  canResolve,
  warehouseId,
}: {
  readonly rows: readonly TaskExceptionRow[];
  readonly canResolve: boolean;
  readonly warehouseId: string;
}) {
  const t = useTranslations("OperatorWork");
  const writeT = useTranslations("Write");
  const locale = useLocale();
  const formatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  });

  return (
    <ol className="flex flex-col gap-4" data-testid="task-exception-list">
      {rows.map((row) => (
        <li
          key={row.operatorTaskExceptionId}
          className="rounded-lg border border-border p-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-text">{row.summary}</p>
              <p className="mt-1 text-xs text-muted">
                {row.reasonCode} · {row.reasonName} ·{" "}
                <time dateTime={new Date(row.reportedAt).toISOString()}>
                  {formatter.format(row.reportedAt)}
                </time>
              </p>
            </div>
            <StatusBadge
              tone={row.status === "OPEN" ? "warning" : "success"}
              label={t(`exceptionStatus.${row.status}`)}
            />
          </div>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-medium text-muted">
                {t("exceptionEvidence")}
              </dt>
              <dd className="mt-1 text-text">{row.evidence}</dd>
            </div>
            <div>
              <dt className="font-medium text-muted">
                {t("exceptionProposedRecovery")}
              </dt>
              <dd className="mt-1 text-text">{row.proposedRecoveryAction}</dd>
            </div>
            <div>
              <dt className="font-medium text-muted">
                {t("exceptionProposedDisposition")}
              </dt>
              <dd className="mt-1 text-text">
                {t(`exceptionDisposition.${row.proposedDisposition}`)}
              </dd>
            </div>
            {row.finalDisposition === undefined ? null : (
              <div>
                <dt className="font-medium text-muted">
                  {t("exceptionFinalDisposition")}
                </dt>
                <dd className="mt-1 text-text">
                  {t(`exceptionDisposition.${row.finalDisposition}`)}
                </dd>
              </div>
            )}
          </dl>

          {row.status === "OPEN" && canResolve ? (
            <div className="mt-5 border-t border-border pt-4">
              <EntityWriteForm
                testId={`form-task-exception-resolve-${row.operatorTaskExceptionId}`}
                mutationRef={resolveTaskExceptionRef}
                legend={t("exceptionResolveLegend")}
                description={t("exceptionResolveDescription")}
                submitLabel={t("exceptionResolveSubmit")}
                requiredMessage={writeT("required")}
                fields={[
                  {
                    name: "finalDisposition",
                    label: t("exceptionFinalDisposition"),
                    kind: "select",
                    required: true,
                    placeholder: t("exceptionSelectDisposition"),
                    options: DISPOSITIONS.map((value) => ({
                      value,
                      label: t(`exceptionDisposition.${value}`),
                    })),
                  },
                  {
                    name: "recoveryAction",
                    label: t("exceptionRecoveryAction"),
                    kind: "textarea",
                    required: true,
                  },
                  {
                    name: "approverNote",
                    label: t("exceptionApproverNote"),
                    kind: "textarea",
                  },
                ]}
                toArgs={(values, requestId) => ({
                  requestId,
                  warehouseId,
                  operatorTaskExceptionId: row.operatorTaskExceptionId,
                  finalDisposition: (values["finalDisposition"] ??
                    "ESCALATE") as TaskExceptionDisposition,
                  recoveryAction: values["recoveryAction"] ?? "",
                  ...((values["approverNote"] ?? "") === ""
                    ? {}
                    : { approverNote: values["approverNote"] as string }),
                })}
              />
            </div>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
