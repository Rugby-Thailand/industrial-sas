"use client";

import { useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { QueryGate } from "@/components/system/QueryGate";
import { Notice } from "@/components/ui/Notice";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EntityWriteForm } from "@/features/masterData/EntityWriteForm";
import {
  getPickTaskRef,
  listAvailablePickTasksRef,
  recordPickEventRef,
  startPickTaskRef,
  submitPickTaskRef,
  type PickTaskLineView,
  type PickTaskQueueRow,
} from "@/lib/convex/fulfillmentApi";

const previewTask: PickTaskQueueRow = {
  pickTaskId: "prv_pick_1",
  taskNumber: 1,
  pickWaveId: "prv_wave_1",
  fulfillmentOrderId: "prv_fulfillment_1",
  fulfillmentLineId: "prv_line_1",
  warehouseId: "prv_warehouse",
  status: "AVAILABLE",
  lineCount: 1,
};

const previewLine: PickTaskLineView = {
  pickTaskLineId: "prv_pick_line_1",
  lineNumber: 1,
  itemId: "FG-RSC-001",
  locationId: "A-01-02",
  lotId: "LOT-260817-A",
  baseUom: "PCS",
  plannedBaseMinorUnits: 8_000,
  pickedBaseMinorUnits: 0,
  shortBaseMinorUnits: 0,
  damagedBaseMinorUnits: 0,
  status: "OPEN",
};

const idFromOutcome = (outcome: Record<string, unknown>) => {
  const value = outcome["value"] as Record<string, unknown> | undefined;
  return typeof value?.["documentId"] === "string"
    ? value["documentId"]
    : undefined;
};

export function HandheldPick() {
  return (
    <QueryGate scope="WAREHOUSE">
      {(warehouseId, preview) =>
        preview ? (
          <PickQueue
            warehouseId={warehouseId}
            tasks={[{ ...previewTask, warehouseId }]}
            preview
          />
        ) : (
          <ServerPickQueue warehouseId={warehouseId} />
        )
      }
    </QueryGate>
  );
}

function ServerPickQueue({ warehouseId }: { readonly warehouseId: string }) {
  const outcome = useQuery(listAvailablePickTasksRef, { warehouseId });
  if (outcome === undefined)
    return <LedgerPanelStatus state={{ kind: "LOADING" }} />;
  if (!outcome.ok)
    return (
      <LedgerPanelStatus
        state={{ kind: "DENIED", requestId: outcome.requestId }}
      />
    );
  return <PickQueue warehouseId={warehouseId} tasks={outcome.value.tasks} />;
}

function PickQueue({
  warehouseId,
  tasks,
  preview = false,
}: {
  readonly warehouseId: string;
  readonly tasks: readonly PickTaskQueueRow[];
  readonly preview?: boolean;
}) {
  const t = useTranslations("Fulfillment");
  const [taskId, setTaskId] = useState<string>();
  if (taskId !== undefined)
    return (
      <PickJourney
        warehouseId={warehouseId}
        taskId={taskId}
        preview={preview}
      />
    );
  if (tasks.length === 0)
    return <Notice tone="muted" title={t("pickQueueEmpty")} />;
  return (
    <EntityWriteForm
      mutationRef={startPickTaskRef}
      legend={t("pickQueue")}
      description={t("pickQueueHelp")}
      submitLabel={t("startPick")}
      requiredMessage={t("required")}
      fields={[
        {
          name: "pickTaskId",
          label: t("pickTask"),
          kind: "select",
          required: true,
          options: tasks.map((task) => ({
            value: task.pickTaskId,
            label: `${t("taskNumber", { number: task.taskNumber })} · ${task.lineCount} ${t("instructions")}`,
          })),
        },
      ]}
      toArgs={(values, requestId) => ({
        requestId,
        warehouseId,
        pickTaskId: values["pickTaskId"] ?? "",
      })}
      onSaved={(outcome) => setTaskId(idFromOutcome(outcome))}
      onDemonstrated={() => setTaskId(tasks[0]?.pickTaskId)}
    />
  );
}

function PickJourney({
  warehouseId,
  taskId,
  preview,
}: {
  readonly warehouseId: string;
  readonly taskId: string;
  readonly preview: boolean;
}) {
  if (preview)
    return (
      <PickTaskBody
        warehouseId={warehouseId}
        taskId={taskId}
        lines={[previewLine]}
        preview
      />
    );
  return <ServerPickTask warehouseId={warehouseId} taskId={taskId} />;
}

function ServerPickTask({
  warehouseId,
  taskId,
}: {
  readonly warehouseId: string;
  readonly taskId: string;
}) {
  const outcome = useQuery(getPickTaskRef, { warehouseId, pickTaskId: taskId });
  if (outcome === undefined)
    return <LedgerPanelStatus state={{ kind: "LOADING" }} />;
  if (!outcome.ok)
    return (
      <LedgerPanelStatus
        state={{ kind: "DENIED", requestId: outcome.requestId }}
      />
    );
  if (!outcome.value.found || outcome.value.lines === undefined)
    return <Notice tone="muted" title="Pick task unavailable" />;
  return (
    <PickTaskBody
      warehouseId={warehouseId}
      taskId={taskId}
      lines={outcome.value.lines}
    />
  );
}

function PickTaskBody({
  warehouseId,
  taskId,
  lines,
  preview = false,
}: {
  readonly warehouseId: string;
  readonly taskId: string;
  readonly lines: readonly PickTaskLineView[];
  readonly preview?: boolean;
}) {
  const t = useTranslations("Fulfillment");
  const complete = lines.every((line) => line.status === "COMPLETE");
  return (
    <section
      aria-labelledby="pick-task-heading"
      className="flex flex-col gap-5"
    >
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4">
        <div>
          <h2
            id="pick-task-heading"
            className="text-lg font-semibold text-text"
          >
            {t("pickTask")}
          </h2>
          <p className="font-mono text-xs text-muted">{taskId}</p>
        </div>
        <StatusBadge
          tone={complete ? "success" : "pending"}
          label={complete ? t("readyToSubmit") : t("pickInProgress")}
        />
      </div>
      {preview ? <Notice tone="accent" title={t("previewOnly")} /> : null}
      {lines.map((line) => {
        const accounted =
          line.pickedBaseMinorUnits +
          line.shortBaseMinorUnits +
          line.damagedBaseMinorUnits;
        const remaining = line.plannedBaseMinorUnits - accounted;
        return (
          <div
            key={line.pickTaskLineId}
            className="rounded-xl border border-border bg-surface p-4"
          >
            <p className="text-xs font-semibold tracking-wide text-muted uppercase">
              {t("goToLocation")}
            </p>
            <p className="mt-1 font-mono text-3xl font-bold text-text">
              {line.locationId}
            </p>
            <p className="mt-2 text-sm text-muted">
              {line.itemId}
              {line.lotId === undefined ? "" : ` · ${line.lotId}`}
            </p>
            <p className="mt-3 text-lg font-semibold text-text">
              {t("remaining", {
                quantity: remaining / 1000,
                uom: line.baseUom,
              })}
            </p>
            {line.status === "COMPLETE" ? (
              <div className="mt-4">
                <Notice tone="success" title={t("lineComplete")} />
              </div>
            ) : (
              <div className="mt-4">
                <EntityWriteForm
                  mutationRef={recordPickEventRef}
                  legend={t("recordPick")}
                  submitLabel={t("confirmEvidence")}
                  requiredMessage={t("required")}
                  fields={[
                    {
                      name: "kind",
                      label: t("evidenceKind"),
                      kind: "select",
                      required: true,
                      initialValue: "PICK",
                      options: ["PICK", "SHORT", "DAMAGED"].map((value) => ({
                        value,
                        label: value,
                      })),
                    },
                    {
                      name: "quantity",
                      label: t("quantityMinor"),
                      kind: "number",
                      required: true,
                      initialValue: String(remaining),
                    },
                    {
                      name: "location",
                      label: t("scanLocation"),
                      kind: "text",
                      required: true,
                      initialValue: line.locationId,
                      monospace: true,
                    },
                    {
                      name: "item",
                      label: t("scanItem"),
                      kind: "text",
                      required: true,
                      initialValue: line.itemId,
                      monospace: true,
                    },
                    {
                      name: "lot",
                      label: t("scanLot"),
                      kind: "text",
                      required: false,
                      initialValue: line.lotId ?? "",
                      monospace: true,
                    },
                    {
                      name: "reason",
                      label: t("exceptionReason"),
                      kind: "text",
                      required: false,
                    },
                  ]}
                  toArgs={(values, requestId) => {
                    const kind = (values["kind"] ?? "PICK") as
                      "PICK" | "SHORT" | "DAMAGED";
                    return {
                      requestId,
                      warehouseId,
                      pickTaskId: taskId,
                      pickTaskLineId: line.pickTaskLineId,
                      kind,
                      baseMinorUnits: Number(values["quantity"]),
                      ...(kind === "PICK"
                        ? {
                            scannedLocationId: values["location"] ?? "",
                            scannedItemId: values["item"] ?? "",
                            ...(values["lot"]
                              ? { scannedLotId: values["lot"] }
                              : {}),
                          }
                        : { reason: values["reason"] ?? "" }),
                    };
                  }}
                />
              </div>
            )}
          </div>
        );
      })}
      {!complete ? null : (
        <EntityWriteForm
          mutationRef={submitPickTaskRef}
          legend={t("submitPick")}
          description={t("submitPickHelp")}
          submitLabel={t("submitPick")}
          requiredMessage={t("required")}
          fields={[]}
          toArgs={(_values, requestId) => ({
            requestId,
            warehouseId,
            pickTaskId: taskId,
          })}
        />
      )}
    </section>
  );
}
