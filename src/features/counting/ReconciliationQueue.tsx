"use client";

import { useQuery } from "convex/react";
import { useTranslations } from "next-intl";

import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { QueryGate } from "@/components/system/QueryGate";
import { Notice } from "@/components/ui/Notice";
import { EntityWriteForm } from "@/features/masterData/EntityWriteForm";
import {
  approveCountReconciliationRef,
  listCountReconciliationWorkRef,
  prepareCountReconciliationRef,
  type CountReconciliationWork,
} from "@/lib/convex/countingApi";

const PREVIEW_WORK: CountReconciliationWork = {
  submitted: [
    {
      countTaskId: "preview-count-task",
      countPlanId: "preview-count-plan",
      planNumber: "COUNT-DEMO",
      taskNumber: 1,
      submittedCountOrdinal: 1,
    },
  ],
  pendingApproval: [],
};

export function ReconciliationQueue() {
  return (
    <QueryGate scope="WAREHOUSE">
      {(warehouseId, preview) =>
        preview ? (
          <ReconciliationBody warehouseId={warehouseId} work={PREVIEW_WORK} />
        ) : (
          <ServerReconciliationQueue warehouseId={warehouseId} />
        )
      }
    </QueryGate>
  );
}

function ServerReconciliationQueue({
  warehouseId,
}: {
  readonly warehouseId: string;
}) {
  const outcome = useQuery(listCountReconciliationWorkRef, { warehouseId });
  if (outcome === undefined)
    return <LedgerPanelStatus state={{ kind: "LOADING" }} />;
  if (!outcome.ok)
    return (
      <LedgerPanelStatus
        state={{ kind: "DENIED", requestId: outcome.requestId }}
      />
    );
  return <ReconciliationBody warehouseId={warehouseId} work={outcome.value} />;
}

function ReconciliationBody({
  warehouseId,
  work,
}: {
  readonly warehouseId: string;
  readonly work: CountReconciliationWork;
}) {
  const t = useTranslations("Count");
  const empty =
    work.submitted.length === 0 && work.pendingApproval.length === 0;

  return (
    <section aria-labelledby="reconciliation-title" className="mt-10 space-y-6">
      <div>
        <h2
          id="reconciliation-title"
          className="text-lg font-semibold text-text"
        >
          {t("reconciliationTitle")}
        </h2>
        <p className="mt-1 text-sm text-muted">{t("approvalStepUpHint")}</p>
      </div>
      {empty ? <Notice tone="muted" title={t("noReconciliationWork")} /> : null}

      {work.submitted.length === 0 ? null : (
        <div className="grid gap-4 lg:grid-cols-2">
          {work.submitted.map((task) => (
            <EntityWriteForm
              key={task.countTaskId}
              mutationRef={prepareCountReconciliationRef}
              legend={`${t("submittedCounts")} · ${t("task", {
                number: task.taskNumber,
                plan: task.planNumber,
              })}`}
              submitLabel={t("prepareReconciliation")}
              requiredMessage={t("required")}
              fields={[
                {
                  name: "rootCauseCode",
                  label: t("rootCauseCode"),
                  kind: "text",
                  monospace: true,
                },
              ]}
              toArgs={(values, requestId) => ({
                requestId,
                warehouseId,
                countTaskId: task.countTaskId,
                ...((values["rootCauseCode"] ?? "") === ""
                  ? {}
                  : { rootCauseCode: values["rootCauseCode"] }),
              })}
            />
          ))}
        </div>
      )}

      {work.pendingApproval.length === 0 ? null : (
        <div className="grid gap-4 lg:grid-cols-2">
          {work.pendingApproval.map((row) => (
            <EntityWriteForm
              key={row.countReconciliationId}
              mutationRef={approveCountReconciliationRef}
              legend={t("pendingApprovals")}
              description={t("varianceSummary", {
                system: row.systemSnapshotBaseMinorUnits,
                movement: row.inCountMovementBaseMinorUnits,
                physical: row.physicalBaseMinorUnits,
                variance: row.varianceBaseMinorUnits,
                value: row.absoluteVarianceValueMinorUnits,
              })}
              submitLabel={t("approve")}
              requiredMessage={t("required")}
              fields={[
                {
                  name: "countReconciliationId",
                  label: t("reconciliationTitle"),
                  kind: "text",
                  required: true,
                  initialValue: row.countReconciliationId,
                  monospace: true,
                },
              ]}
              toArgs={(values, requestId) => ({
                requestId,
                warehouseId,
                countReconciliationId:
                  values["countReconciliationId"] ?? row.countReconciliationId,
              })}
            />
          ))}
        </div>
      )}
    </section>
  );
}
