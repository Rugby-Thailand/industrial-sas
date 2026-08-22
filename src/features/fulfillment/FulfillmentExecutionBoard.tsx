"use client";

import { useQuery } from "convex/react";
import { useTranslations } from "next-intl";

import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { QueryGate } from "@/components/system/QueryGate";
import { Notice } from "@/components/ui/Notice";
import { EntityWriteForm } from "@/features/masterData/EntityWriteForm";
import { ActiveReasonCodes } from "@/features/inbound/CatalogueOptions";
import {
  checkPickTaskRef,
  issuePickTaskRef,
  listPickTasksByStatusRef,
  packPickTaskRef,
  reverseIssuedPickTaskRef,
  stagePickTaskRef,
  type PickTaskQueueRow,
} from "@/lib/convex/fulfillmentApi";

const ACTION_STAGES = ["PICKED", "CHECKED", "PACKED", "STAGED"] as const;

export function FulfillmentExecutionBoard() {
  return (
    <QueryGate scope="WAREHOUSE">
      {(warehouseId, preview) => (
        <section
          aria-labelledby="execution-title"
          className="mt-8 flex flex-col gap-4"
        >
          <ExecutionHeading />
          <div className="grid gap-4 xl:grid-cols-4">
            {ACTION_STAGES.map((status, index) =>
              preview ? (
                <ExecutionStage
                  key={status}
                  warehouseId={warehouseId}
                  status={status}
                  tasks={[
                    {
                      pickTaskId: `prv_task_${status}`,
                      taskNumber: index + 1,
                      pickWaveId: "prv_wave",
                      fulfillmentOrderId: "prv_ff",
                      fulfillmentLineId: "prv_line",
                      warehouseId,
                      status,
                      lineCount: 1,
                    },
                  ]}
                />
              ) : (
                <ServerExecutionStage
                  key={status}
                  warehouseId={warehouseId}
                  status={status}
                />
              ),
            )}
          </div>
          {preview ? (
            <IssueReversalPanel
              warehouseId={warehouseId}
              tasks={[
                {
                  pickTaskId: "prv_task_issued",
                  taskNumber: 5,
                  pickWaveId: "prv_wave",
                  fulfillmentOrderId: "prv_ff",
                  fulfillmentLineId: "prv_line",
                  warehouseId,
                  status: "ISSUED",
                  lineCount: 1,
                },
              ]}
            />
          ) : (
            <ServerIssueReversalPanel warehouseId={warehouseId} />
          )}
        </section>
      )}
    </QueryGate>
  );
}

function ServerIssueReversalPanel({
  warehouseId,
}: {
  readonly warehouseId: string;
}) {
  const outcome = useQuery(listPickTasksByStatusRef, {
    warehouseId,
    status: "ISSUED",
  });
  if (outcome === undefined)
    return <LedgerPanelStatus state={{ kind: "LOADING" }} />;
  if (!outcome.ok)
    return (
      <LedgerPanelStatus
        state={{ kind: "DENIED", requestId: outcome.requestId }}
      />
    );
  return (
    <IssueReversalPanel warehouseId={warehouseId} tasks={outcome.value.tasks} />
  );
}

function IssueReversalPanel({
  warehouseId,
  tasks,
}: {
  readonly warehouseId: string;
  readonly tasks: readonly PickTaskQueueRow[];
}) {
  const t = useTranslations("Fulfillment");
  if (tasks.length === 0)
    return (
      <div className="rounded-xl border border-border bg-surface p-4">
        <h3 className="font-semibold text-text">{t("reverseIssueTitle")}</h3>
        <div className="mt-3">
          <Notice tone="muted" title={t("reverseIssueEmpty")} />
        </div>
      </div>
    );
  return (
    <ActiveReasonCodes
      scope="REVERSAL"
      emptyTitle={t("reverseReasonEmpty")}
      emptyBody={t("reverseReasonEmptyHelp")}
      emptyTestId="fulfillment-reversal-reason-empty"
    >
      {(reasons) => (
        <EntityWriteForm
          mutationRef={reverseIssuedPickTaskRef}
          legend={t("reverseIssueTitle")}
          description={t("reverseIssueHelp")}
          submitLabel={t("reverseIssue")}
          requiredMessage={t("required")}
          testId="fulfillment-reverse-issue-form"
          fields={[
            {
              name: "taskId",
              label: t("pickTask"),
              kind: "select",
              required: true,
              options: tasks.map((task) => ({
                value: task.pickTaskId,
                label: t("taskNumber", { number: task.taskNumber }),
              })),
            },
            {
              name: "reasonCodeId",
              label: t("reverseReason"),
              kind: "select",
              required: true,
              options: reasons.map((reason) => ({
                value: reason.reasonCodeId,
                label: `${reason.code} · ${reason.name}`,
              })),
            },
          ]}
          toArgs={(values, requestId) => ({
            requestId,
            warehouseId,
            pickTaskId: values["taskId"] ?? "",
            reasonCodeId: values["reasonCodeId"] ?? "",
          })}
        />
      )}
    </ActiveReasonCodes>
  );
}

function ExecutionHeading() {
  const t = useTranslations("Fulfillment");
  return (
    <div>
      <h2 id="execution-title" className="text-xl font-semibold text-text">
        {t("executionTitle")}
      </h2>
      <p className="mt-1 text-sm text-muted">{t("executionHelp")}</p>
    </div>
  );
}

function ServerExecutionStage({
  warehouseId,
  status,
}: {
  readonly warehouseId: string;
  readonly status: string;
}) {
  const outcome = useQuery(listPickTasksByStatusRef, { warehouseId, status });
  if (outcome === undefined)
    return <LedgerPanelStatus state={{ kind: "LOADING" }} />;
  if (!outcome.ok)
    return (
      <LedgerPanelStatus
        state={{ kind: "DENIED", requestId: outcome.requestId }}
      />
    );
  return (
    <ExecutionStage
      warehouseId={warehouseId}
      status={status}
      tasks={outcome.value.tasks}
    />
  );
}

function ExecutionStage({
  warehouseId,
  status,
  tasks,
}: {
  readonly warehouseId: string;
  readonly status: string;
  readonly tasks: readonly PickTaskQueueRow[];
}) {
  const t = useTranslations("Fulfillment");
  const options = tasks.map((task) => ({
    value: task.pickTaskId,
    label: `${t("taskNumber", { number: task.taskNumber })} · ${task.lineCount}`,
  }));
  const shared = {
    legend: t(`stage${status}`),
    requiredMessage: t("required"),
    submitLabel: t(`action${status}`),
    fields: [
      {
        name: "taskId",
        label: t("pickTask"),
        kind: "select" as const,
        required: true,
        options,
      },
    ],
  };
  if (tasks.length === 0)
    return (
      <div className="rounded-xl border border-border bg-surface p-4">
        <h3 className="font-semibold text-text">{t(`stage${status}`)}</h3>
        <div className="mt-3">
          <Notice tone="muted" title={t("stageEmpty")} />
        </div>
      </div>
    );
  if (status === "PICKED")
    return (
      <EntityWriteForm
        {...shared}
        mutationRef={checkPickTaskRef}
        toArgs={(values, requestId) => ({
          requestId,
          warehouseId,
          pickTaskId: values["taskId"] ?? "",
        })}
      />
    );
  if (status === "CHECKED")
    return (
      <EntityWriteForm
        mutationRef={packPickTaskRef}
        legend={shared.legend}
        requiredMessage={shared.requiredMessage}
        submitLabel={shared.submitLabel}
        fields={[
          ...shared.fields,
          {
            name: "packageNumber",
            label: t("packageNumber"),
            kind: "text",
            required: true,
            initialValue: "PKG-",
          },
        ]}
        toArgs={(values, requestId) => ({
          requestId,
          warehouseId,
          pickTaskId: values["taskId"] ?? "",
          packageNumber: values["packageNumber"] ?? "",
        })}
      />
    );
  if (status === "PACKED")
    return (
      <EntityWriteForm
        mutationRef={stagePickTaskRef}
        legend={shared.legend}
        requiredMessage={shared.requiredMessage}
        submitLabel={shared.submitLabel}
        fields={[
          ...shared.fields,
          {
            name: "stagingLocationId",
            label: t("stagingLocation"),
            kind: "text",
            required: true,
            monospace: true,
          },
        ]}
        toArgs={(values, requestId) => ({
          requestId,
          warehouseId,
          pickTaskId: values["taskId"] ?? "",
          stagingLocationId: values["stagingLocationId"] ?? "",
        })}
      />
    );
  return (
    <EntityWriteForm
      {...shared}
      mutationRef={issuePickTaskRef}
      toArgs={(values, requestId) => ({
        requestId,
        warehouseId,
        pickTaskId: values["taskId"] ?? "",
      })}
    />
  );
}
