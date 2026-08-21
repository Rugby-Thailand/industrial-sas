"use client";

/** Capability-gated private UploadThing evidence for one operator task. */
import { useMutation } from "convex/react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { PrivateFileUpload } from "@/components/files/PrivateFileUpload";
import { useAppEnvironment } from "@/components/providers/EnvironmentProvider";
import { Notice } from "@/components/ui/Notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectControl } from "@/components/ui/SelectControl";
import { MasterDataPanel } from "@/features/masterData/MasterDataPanel";
import type { ConnectionStatus } from "@/lib/convex/connection";
import {
  attachTaskFileRef,
  authorizeTaskFileUploadRef,
  listTaskFilesRef,
  requestTaskFileAccessRef,
  type OperatorTaskRow,
  type TaskAttachmentKind,
  type TaskAttachmentRow,
} from "@/lib/convex/platformApi";
import { newRequestId } from "@/lib/convex/writeState";
import {
  acceptedTypesFor,
  maximumInputBytesFor,
  optimizeUpload,
} from "@/lib/files/optimizeUpload";
import { previewTaskAttachmentsFor } from "@/lib/preview/operatorWorkPreview";
import { useUploadThing } from "@/lib/uploadthing/client";

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export function TaskAttachmentPanel({
  task,
  connectionStatus,
}: {
  readonly task: OperatorTaskRow;
  readonly connectionStatus: ConnectionStatus;
}) {
  const t = useTranslations("OperatorWork");
  const environment = useAppEnvironment();
  const live =
    !environment.previewMode &&
    environment.backendConfigured &&
    environment.identityConfigured;
  const connected = connectionStatus === "CONNECTED";

  return (
    <section
      aria-labelledby={`task-attachments-title-${task.operatorTaskId}`}
      className="rounded-xl border border-border bg-surface p-4"
      data-testid="task-attachment-panel"
    >
      <h2
        id={`task-attachments-title-${task.operatorTaskId}`}
        className="text-lg font-semibold text-text"
      >
        {t("attachmentTitle")}
      </h2>
      <p className="mt-1 text-sm text-muted">{t("attachmentDescription")}</p>

      <div className="mt-4 flex flex-col gap-5">
        {!live ? (
          <Notice
            tone="accent"
            title={t("attachmentPreviewTitle")}
            body={t("attachmentPreviewBody")}
            testId="task-attachment-preview"
          />
        ) : !connected ? (
          <Notice
            tone="warning"
            title={t("attachmentOfflineTitle")}
            body={t("attachmentOfflineBody")}
            testId="task-attachment-offline"
          />
        ) : (
          <LiveTaskAttachmentUpload task={task} />
        )}

        <MasterDataPanel<
          TaskAttachmentRow,
          {
            warehouseId: string;
            operatorTaskId: string;
            maxPageSize?: number;
            cursor?: string;
          }
        >
          queryRef={listTaskFilesRef}
          scope="WAREHOUSE"
          buildArgs={({ warehouseId, cursor }) => ({
            warehouseId,
            operatorTaskId: task.operatorTaskId,
            ...(cursor === undefined ? {} : { cursor }),
          })}
          previewRowsFor={() => previewTaskAttachmentsFor(task.operatorTaskId)}
          renderRows={(rows) => (
            <TaskAttachmentRows
              rows={rows}
              warehouseId={task.warehouseId}
              canDownload={live && connected}
            />
          )}
          paginationLabel={t("attachmentPagination")}
        />
      </div>
    </section>
  );
}

function LiveTaskAttachmentUpload({
  task,
}: {
  readonly task: OperatorTaskRow;
}) {
  const t = useTranslations("OperatorWork");
  const authorize = useMutation(authorizeTaskFileUploadRef);
  const attach = useMutation(attachTaskFileRef);
  const [kind, setKind] = useState<TaskAttachmentKind>("PHOTO");
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState<File | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [resetKey, setResetKey] = useState(0);
  const { startUpload, isUploading } = useUploadThing("operatorTaskFile", {
    onUploadProgress: setProgress,
  });
  const optimizationKind = kind === "PHOTO" ? "PHOTO" : "OTHER";

  const upload = async () => {
    if (selected === null || busy) return;
    setBusy(true);
    setProgress(0);
    setNotice(t("attachmentUploading"));
    try {
      const prepared = await optimizeUpload(selected, optimizationKind);
      const authorization = await authorize({
        warehouseId: task.warehouseId,
        operatorTaskId: task.operatorTaskId,
      });
      if (!authorization.ok || !("uploadGrantId" in authorization.value)) {
        throw new Error("UPLOAD_AUTHORIZATION_REFUSED");
      }
      const uploads = await startUpload([prepared.file], {
        grantId: authorization.value.uploadGrantId,
        contentDigest: prepared.contentDigest,
      });
      const verified = uploads?.[0]?.serverData;
      if (verified === null || verified === undefined) {
        throw new Error("UPLOAD_VERIFICATION_FAILED");
      }
      const attached = await attach({
        requestId: newRequestId(),
        warehouseId: task.warehouseId,
        operatorTaskId: task.operatorTaskId,
        uploadGrantId: authorization.value.uploadGrantId,
        fileName: prepared.file.name,
        kind,
        contentType: verified.contentType,
        byteSize: verified.byteSize,
        contentDigest: verified.contentDigest,
        uploadThingKey: verified.providerKey,
        ...(note.trim().length === 0 ? {} : { note: note.trim() }),
      });
      if (!attached.ok || !attached.value.written) {
        throw new Error("ATTACH_REFUSED");
      }
      setNotice(t("attachmentUploaded"));
      setSelected(null);
      setNote("");
      setResetKey((current) => current + 1);
    } catch {
      setNotice(t("attachmentUploadFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="rounded-lg border border-border p-4"
      data-testid="task-attachment-upload"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor={`task-attachment-kind-${task.operatorTaskId}`}
            className="text-sm font-medium text-text"
          >
            {t("attachmentKindLabel")}
          </label>
          <SelectControl
            id={`task-attachment-kind-${task.operatorTaskId}`}
            value={kind}
            onValueChange={(value) => setKind(value as TaskAttachmentKind)}
            placeholder={t("attachmentKindLabel")}
            emptyLabel={t("attachmentKindLabel")}
            options={(["PHOTO", "DOCUMENT", "OTHER"] as const).map((value) => ({
              value,
              label: t(`attachmentKind.${value}`),
            }))}
          />
        </div>
        <label className="text-sm font-medium text-text">
          {t("attachmentNoteLabel")}
          <Input
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <div className="sm:col-span-2">
          <PrivateFileUpload
            accept={acceptedTypesFor(optimizationKind)}
            maxSize={maximumInputBytesFor(optimizationKind)}
            disabled={busy || isUploading}
            resetKey={resetKey}
            labels={{
              drop: t("attachmentDrop"),
              browse: t("attachmentBrowse"),
              limit: t("attachmentLimit", {
                size: formatBytes(maximumInputBytesFor(optimizationKind)),
              }),
              remove: t("attachmentRemove"),
              invalid: t("attachmentInvalid"),
            }}
            onFileChange={setSelected}
          />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          disabled={busy || isUploading || selected === null}
          onClick={() => void upload()}
        >
          {t("attachmentUpload")}
        </Button>
        <span role="status" className="text-sm text-muted">
          {isUploading && progress > 0
            ? `${notice} ${Math.round(progress)}%`
            : notice}
        </span>
      </div>
    </div>
  );
}

function TaskAttachmentRows({
  rows,
  warehouseId,
  canDownload,
}: {
  readonly rows: readonly TaskAttachmentRow[];
  readonly warehouseId: string;
  readonly canDownload: boolean;
}) {
  const t = useTranslations("OperatorWork");
  const locale = useLocale();
  return (
    <ul className="flex flex-col gap-3" data-testid="task-attachment-list">
      {rows.map((row) => (
        <li
          key={row.operatorTaskAttachmentId}
          className="rounded-lg border border-border p-3"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-text">{row.fileName}</p>
              <p className="mt-1 text-xs text-muted">
                {t(`attachmentKind.${row.kind}`)} · {formatBytes(row.byteSize)}{" "}
                ·{" "}
                {new Intl.DateTimeFormat(locale, {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: "Asia/Bangkok",
                }).format(row.attachedAt)}
              </p>
              {row.note === undefined ? null : (
                <p className="mt-2 text-sm text-text">{row.note}</p>
              )}
            </div>
            {canDownload ? (
              <LiveTaskAttachmentDownload row={row} warehouseId={warehouseId} />
            ) : (
              <Button type="button" variant="outline" disabled>
                {t("attachmentDownload")}
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function LiveTaskAttachmentDownload({
  row,
  warehouseId,
}: {
  readonly row: TaskAttachmentRow;
  readonly warehouseId: string;
}) {
  const t = useTranslations("OperatorWork");
  const requestAccess = useMutation(requestTaskFileAccessRef);
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    try {
      const outcome = await requestAccess({
        warehouseId,
        operatorTaskAttachmentId: row.operatorTaskAttachmentId,
      });
      if (outcome.ok && outcome.value.granted) {
        window.open(outcome.value.url, "_blank", "noopener,noreferrer");
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button
      type="button"
      variant="outline"
      disabled={busy}
      onClick={() => void open()}
    >
      {t("attachmentDownload")}
    </Button>
  );
}
