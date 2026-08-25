"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Notice } from "@/components/ui/Notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ConnectionStatus } from "@/lib/convex/connection";
import {
  recordTaskEvidenceRef,
  type OperatorTaskRow,
} from "@/lib/convex/platformApi";
import { availabilityFor } from "@/lib/offline/commandAvailability";

import { ScanToItem, type ScannedItem } from "../inbound/ScanToItem";
import { RowWriteRegion } from "../masterData/RowWriteRegion";

type InputMethod = "HID" | "MANUAL";

export function TaskScanEvidence({
  task,
  connectionStatus,
}: {
  readonly task: OperatorTaskRow;
  readonly connectionStatus: ConnectionStatus;
}) {
  const t = useTranslations("OperatorWork");
  const [lastRecordedScan, setLastRecordedScan] = useState<string>();

  return (
    <section
      aria-labelledby={`task-scan-title-${task.operatorTaskId}`}
      className="rounded-xl border border-border bg-surface p-4"
      data-testid="task-scan-evidence"
    >
      <h2
        id={`task-scan-title-${task.operatorTaskId}`}
        className="text-lg font-semibold text-text"
      >
        {t("scanTitle", { task: task.taskNumber })}
      </h2>
      <p className="mt-1 text-sm text-muted">{t("scanDescription")}</p>

      <div className="mt-4">
        <ScanToItem label={t("scanLabel")} hint={t("scanHint")}>
          {(scanned) => (
            <ResolvedTaskScan
              key={scanned?.scanValue ?? "empty"}
              task={task}
              scanned={scanned}
              connectionStatus={connectionStatus}
              duplicate={
                scanned !== undefined && scanned.scanValue === lastRecordedScan
              }
              onRecorded={() => setLastRecordedScan(scanned?.scanValue)}
            />
          )}
        </ScanToItem>
      </div>
    </section>
  );
}

function ResolvedTaskScan({
  task,
  scanned,
  connectionStatus,
  duplicate,
  onRecorded,
}: {
  readonly task: OperatorTaskRow;
  readonly scanned: ScannedItem | undefined;
  readonly connectionStatus: ConnectionStatus;
  readonly duplicate: boolean;
  readonly onRecorded: () => void;
}) {
  const t = useTranslations("OperatorWork");
  const [inputMethod, setInputMethod] = useState<InputMethod>("HID");
  const [manualReason, setManualReason] = useState("");
  const [duplicateConfirmed, setDuplicateConfirmed] = useState(false);
  const availability = availabilityFor({
    operation: "work.evidence.record",
    status: connectionStatus,
  });
  const mismatch =
    scanned !== undefined &&
    task.itemId !== undefined &&
    scanned.itemId !== task.itemId;
  const canRecord =
    scanned !== undefined &&
    !mismatch &&
    availability.available &&
    (inputMethod === "HID" || manualReason.trim().length > 0) &&
    (!duplicate || duplicateConfirmed);

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-wrap gap-2">
        <legend className="mb-2 text-sm font-medium text-text">
          {t("scanInputMethod")}
        </legend>
        {(["HID", "MANUAL"] as const).map((method) => (
          <label
            key={method}
            className="flex min-h-12 items-center gap-2 rounded-lg border border-border px-3 text-sm"
          >
            <input
              type="radio"
              name={`scan-method-${task.operatorTaskId}`}
              value={method}
              checked={inputMethod === method}
              onChange={() => setInputMethod(method)}
            />
            {method === "HID" ? t("scanMethodHid") : t("scanMethodManual")}
          </label>
        ))}
      </fieldset>

      {inputMethod === "MANUAL" ? (
        <label className="flex flex-col gap-2 text-sm font-medium text-text">
          {t("manualReasonLabel")}
          <Input
            value={manualReason}
            onChange={(event) => setManualReason(event.target.value)}
            data-testid="task-scan-manual-reason"
            aria-required="true"
          />
        </label>
      ) : null}

      {scanned === undefined ? null : mismatch ? (
        <Notice
          tone="warning"
          title={t("scanMismatchTitle")}
          body={t("scanMismatchBody", { sku: scanned.sku })}
          testId="task-scan-mismatch"
        />
      ) : (
        <Notice
          tone="success"
          title={t("scanResolvedTitle")}
          body={t("scanResolvedBody", { sku: scanned.sku })}
          testId="task-scan-resolved"
        />
      )}

      {duplicate ? (
        <label className="flex min-h-12 items-center gap-2 rounded-lg border border-warning/50 bg-warning/10 px-3 text-sm text-text">
          <input
            type="checkbox"
            checked={duplicateConfirmed}
            onChange={(event) => setDuplicateConfirmed(event.target.checked)}
            data-testid="task-scan-duplicate-confirm"
          />
          {t("scanDuplicateConfirm")}
        </label>
      ) : null}

      {!availability.available ? (
        <Notice
          tone="warning"
          role="status"
          title={t("scanOfflineTitle")}
          body={t(
            `blockReason.${availability.reasonCode ?? "commandNotClassified"}`,
          )}
          testId="task-scan-offline"
        />
      ) : null}

      <p className="text-xs text-muted" data-testid="camera-fallback-status">
        {t("cameraUnavailable")}
      </p>

      <RowWriteRegion mutationRef={recordTaskEvidenceRef} onSaved={onRecorded}>
        {({ submit, busy }) => (
          <Button
            type="button"
            disabled={busy || !canRecord}
            data-testid="task-scan-confirm"
            onClick={() => {
              if (scanned === undefined) return;
              submit(scanned.scanValue, (requestId) => ({
                requestId,
                warehouseId: task.warehouseId,
                operatorTaskId: task.operatorTaskId,
                kind: "SCAN" as const,
                scanValue: scanned.scanValue,
                scanInputMethod: inputMethod,
                ...(inputMethod === "MANUAL"
                  ? { manualEntryReason: manualReason }
                  : {}),
              }));
            }}
          >
            {duplicate ? t("recordDuplicateScan") : t("recordScan")}
          </Button>
        )}
      </RowWriteRegion>
    </div>
  );
}
