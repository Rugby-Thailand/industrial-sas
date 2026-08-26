"use client";

import { useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { QueryGate } from "@/components/system/QueryGate";
import { Notice } from "@/components/ui/Notice";
import { EntityWriteForm } from "@/features/masterData/EntityWriteForm";
import {
  captureCountTaskEntryRef,
  getAssignedCountTaskRef,
  listAvailableCountTasksRef,
  startCountTaskRef,
  submitCountTaskRef,
  type CountTaskQueueRow,
} from "@/lib/convex/countingApi";

export function HandheldCount() {
  return (
    <QueryGate scope="WAREHOUSE">
      {(warehouseId, preview) =>
        preview ? (
          <CountQueue
            warehouseId={warehouseId}
            preview
            tasks={[
              {
                countTaskId: "preview-count-task",
                countPlanId: "preview-count-plan",
                planNumber: "COUNT-DEMO",
                taskNumber: 1,
                locationId: "RACK-A-01",
                visibility: "BLIND",
              },
            ]}
          />
        ) : (
          <ServerCountQueue warehouseId={warehouseId} />
        )
      }
    </QueryGate>
  );
}

function ServerCountQueue({ warehouseId }: { readonly warehouseId: string }) {
  const outcome = useQuery(listAvailableCountTasksRef, { warehouseId });
  if (outcome === undefined)
    return <LedgerPanelStatus state={{ kind: "LOADING" }} />;
  if (!outcome.ok)
    return (
      <LedgerPanelStatus
        state={{ kind: "DENIED", requestId: outcome.requestId }}
      />
    );
  return <CountQueue warehouseId={warehouseId} tasks={outcome.value.tasks} />;
}

function documentId(outcome: Record<string, unknown>) {
  const value = outcome["value"] as Record<string, unknown> | undefined;
  return typeof value?.["documentId"] === "string"
    ? value["documentId"]
    : undefined;
}

function CountQueue({
  warehouseId,
  tasks,
  preview = false,
}: {
  readonly warehouseId: string;
  readonly tasks: readonly CountTaskQueueRow[];
  readonly preview?: boolean;
}) {
  const t = useTranslations("Count");
  const [taskId, setTaskId] = useState<string>();

  if (taskId !== undefined) {
    return (
      <CountTaskJourney
        warehouseId={warehouseId}
        taskId={taskId}
        preview={preview}
      />
    );
  }

  return (
    <section
      aria-labelledby="count-queue-title"
      className="flex flex-col gap-4"
    >
      <h2 id="count-queue-title" className="text-lg font-semibold text-text">
        {t("queueTitle")}
      </h2>
      {tasks.length === 0 ? (
        <Notice tone="muted" title={t("queueEmpty")} />
      ) : (
        <EntityWriteForm
          presentation="inline"
          mutationRef={startCountTaskRef}
          legend={t("queueTitle")}
          submitLabel={t("startTask")}
          requiredMessage={t("required")}
          fields={[
            {
              name: "countTaskId",
              label: t("queueTitle"),
              kind: "select",
              required: true,
              options: tasks.map((task) => ({
                value: task.countTaskId,
                label: `${t("task", {
                  number: task.taskNumber,
                  plan: task.planNumber,
                })} · ${task.locationId}`,
              })),
            },
          ]}
          toArgs={(values, requestId) => ({
            requestId,
            warehouseId,
            countTaskId: values["countTaskId"] ?? "",
          })}
          onSaved={(outcome) => setTaskId(documentId(outcome))}
        />
      )}
    </section>
  );
}

function CountTaskJourney({
  warehouseId,
  taskId,
  preview,
}: {
  readonly warehouseId: string;
  readonly taskId: string;
  readonly preview: boolean;
}) {
  if (preview) {
    return (
      <CountTaskBody
        warehouseId={warehouseId}
        taskId={taskId}
        visibility="BLIND"
        baseUom="PCS"
      />
    );
  }
  return <ServerCountTask warehouseId={warehouseId} taskId={taskId} />;
}

function ServerCountTask({
  warehouseId,
  taskId,
}: {
  readonly warehouseId: string;
  readonly taskId: string;
}) {
  const outcome = useQuery(getAssignedCountTaskRef, {
    warehouseId,
    countTaskId: taskId,
  });
  if (outcome === undefined)
    return <LedgerPanelStatus state={{ kind: "LOADING" }} />;
  if (!outcome.ok)
    return (
      <LedgerPanelStatus
        state={{ kind: "DENIED", requestId: outcome.requestId }}
      />
    );
  if (!outcome.value.found) return <MissingCountTask />;
  return (
    <CountTaskBody
      warehouseId={warehouseId}
      taskId={taskId}
      visibility={outcome.value.task.visibility}
      baseUom={outcome.value.task.baseUom}
      {...(outcome.value.task.systemSnapshotBaseMinorUnits === undefined
        ? {}
        : {
            systemSnapshotBaseMinorUnits:
              outcome.value.task.systemSnapshotBaseMinorUnits,
          })}
    />
  );
}

function MissingCountTask() {
  const t = useTranslations("Count");
  return <Notice tone="muted" title={t("queueEmpty")} />;
}

function CountTaskBody({
  warehouseId,
  taskId,
  visibility,
  baseUom,
  systemSnapshotBaseMinorUnits,
}: {
  readonly warehouseId: string;
  readonly taskId: string;
  readonly visibility: string;
  readonly baseUom: string;
  readonly systemSnapshotBaseMinorUnits?: number;
}) {
  const t = useTranslations("Count");
  const [captured, setCaptured] = useState(false);

  return (
    <div className="flex flex-col gap-5">
      <Notice
        tone={visibility === "BLIND" ? "warning" : "accent"}
        title={visibility === "BLIND" ? t("blindNotice") : t("visibleNotice")}
        {...(systemSnapshotBaseMinorUnits === undefined
          ? {}
          : { body: String(systemSnapshotBaseMinorUnits) })}
      />
      <EntityWriteForm
        presentation="inline"
        mutationRef={captureCountTaskEntryRef}
        legend={t("countTitle")}
        submitLabel={t("saveCount")}
        requiredMessage={t("required")}
        fields={[
          {
            name: "entryMinorUnits",
            label: t("physicalQuantity"),
            kind: "number",
            required: true,
          },
          {
            name: "entryUom",
            label: t("uom"),
            kind: "text",
            required: true,
            initialValue: baseUom,
            monospace: true,
          },
        ]}
        toArgs={(values, requestId) => ({
          requestId,
          warehouseId,
          countTaskId: taskId,
          source: "HANDHELD",
          entryUom: values["entryUom"] ?? baseUom,
          entryMinorUnits: Number(values["entryMinorUnits"]),
        })}
        onSaved={() => setCaptured(true)}
      />
      {!captured ? null : (
        <EntityWriteForm
          presentation="inline"
          mutationRef={submitCountTaskRef}
          legend={t("submitCount")}
          submitLabel={t("submitCount")}
          requiredMessage={t("required")}
          fields={[
            {
              name: "countTaskId",
              label: t("queueTitle"),
              kind: "text",
              required: true,
              initialValue: taskId,
              monospace: true,
            },
          ]}
          toArgs={(values, requestId) => ({
            requestId,
            warehouseId,
            countTaskId: values["countTaskId"] ?? taskId,
          })}
        />
      )}
    </div>
  );
}
