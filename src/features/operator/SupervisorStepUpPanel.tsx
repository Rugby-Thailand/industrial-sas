"use client";

/** One-action, same-device supervisor approval for a selected operator task. */
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { Notice } from "@/components/ui/Notice";
import type { ConnectionStatus } from "@/lib/convex/connection";
import {
  approveOnDeviceRef,
  type OperatorTaskRow,
} from "@/lib/convex/platformApi";
import { readOrCreateInstallationId } from "@/lib/device/installationId";

import { EntityWriteForm } from "../masterData/EntityWriteForm";

export interface StepUpGrant {
  readonly approvalId: string;
  readonly expiresAt: number;
}

interface SavedApproval {
  readonly decision: "APPROVED" | "REJECTED";
  readonly expiresAt: number;
  readonly approvalId: string;
}

const savedApprovalFrom = (
  outcome: Record<string, unknown>,
): SavedApproval | null => {
  const value = outcome["value"];
  if (value === null || typeof value !== "object") return null;
  const result = value as Record<string, unknown>;
  return (result["decision"] === "APPROVED" ||
    result["decision"] === "REJECTED") &&
    typeof result["expiresAt"] === "number" &&
    typeof result["documentId"] === "string"
    ? {
        decision: result["decision"],
        expiresAt: result["expiresAt"],
        approvalId: result["documentId"],
      }
    : null;
};

export function SupervisorStepUpPanel({
  task,
  connectionStatus,
  onApproved,
}: {
  readonly task: OperatorTaskRow;
  readonly connectionStatus: ConnectionStatus;
  readonly onApproved?: (grant: StepUpGrant) => void;
}) {
  const t = useTranslations("StepUp");
  const writeT = useTranslations("Write");
  const locale = useLocale();
  const [saved, setSaved] = useState<SavedApproval | null>(null);
  const canWrite =
    connectionStatus === "CONNECTED" || connectionStatus === "PREVIEW";

  return (
    <section
      aria-labelledby={`step-up-title-${task.operatorTaskId}`}
      className="rounded-xl border border-border bg-surface p-4"
      data-testid="supervisor-step-up"
    >
      <h2
        id={`step-up-title-${task.operatorTaskId}`}
        className="text-lg font-semibold text-text"
      >
        {t("title")}
      </h2>
      <p className="mt-1 text-sm text-muted">{t("description")}</p>

      <div className="mt-4 flex flex-col gap-4">
        <Notice
          tone="accent"
          title={t("deviceBindingTitle")}
          body={t("deviceBindingBody")}
          testId="step-up-device-binding"
        />

        {saved === null ? null : saved.decision === "APPROVED" ? (
          <Notice
            tone="success"
            title={t("approvedTitle")}
            body={t("approvedUntil", {
              time: new Intl.DateTimeFormat(locale, {
                timeStyle: "short",
                timeZone: "Asia/Bangkok",
              }).format(saved.expiresAt),
            })}
            testId="step-up-approved"
          />
        ) : (
          <Notice
            tone="warning"
            title={t("rejectedTitle")}
            body={t("rejectedBody")}
            testId="step-up-rejected"
          />
        )}

        {task.lease.kind !== "HELD" ? (
          <Notice
            tone="warning"
            title={t("taskNotHeldTitle")}
            body={t("taskNotHeldBody")}
            testId="step-up-task-not-held"
          />
        ) : !canWrite ? (
          <Notice
            tone="warning"
            title={t("offlineTitle")}
            body={t("offlineBody")}
            testId="step-up-offline"
          />
        ) : (
          <EntityWriteForm
            testId="form-step-up-approval"
            mutationRef={approveOnDeviceRef}
            legend={t("legend")}
            description={t("freshIdentityInstruction")}
            submitLabel={t("submit")}
            requiredMessage={writeT("required")}
            fields={[
              {
                name: "decision",
                label: t("decisionLabel"),
                kind: "select",
                required: true,
                placeholder: t("selectDecision"),
                options: [
                  { value: "APPROVED", label: t("approve") },
                  { value: "REJECTED", label: t("reject") },
                ],
              },
              {
                name: "reason",
                label: t("reasonLabel"),
                kind: "textarea",
                required: true,
              },
            ]}
            toArgs={(values, requestId) => ({
              requestId,
              warehouseId: task.warehouseId,
              operatorUserId:
                task.lease.kind === "HELD" ? task.lease.holderUserId : "",
              operatorTaskId: task.operatorTaskId,
              installationId: readOrCreateInstallationId(),
              decision: (values["decision"] ?? "REJECTED") as
                "APPROVED" | "REJECTED",
              reason: values["reason"] ?? "",
            })}
            onSaved={(outcome) => {
              const approval = savedApprovalFrom(outcome);
              if (approval === null) return;
              setSaved(approval);
              if (approval.decision === "APPROVED") {
                onApproved?.({
                  approvalId: approval.approvalId,
                  expiresAt: approval.expiresAt,
                });
              }
            }}
          />
        )}
      </div>
    </section>
  );
}
