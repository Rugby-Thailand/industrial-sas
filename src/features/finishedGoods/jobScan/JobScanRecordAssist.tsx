"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { ArrowRight, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useNavigationDraft } from "@/components/navigation/navigationDraft";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  type DialogCompletionHandle,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Notice } from "@/components/ui/Notice";
import type { RefValue } from "@/lib/convex/clientRef";
import { fgRefs } from "@/lib/convex/finishedGoodsApi";
import { writeFailure } from "@/lib/convex/mutationOutcome";
import type {
  JobScanEditProposal,
  JobScanEditableFields,
  JobScanStorageFormat,
} from "../../../../convex/model/finishedGoods/jobScans";
import { ErrorNotice, useOperation } from "../shared";
import { jobScanCorrectionDraft } from "./JobScanRecordEditor";
import {
  DETAIL_FIELDS,
  hasInvalidQuantity,
  isComplete,
  NUMBER_FIELDS,
  pickedLocationPayload,
  REQUIRED_FIELDS,
  TICKET_CODE_LIMITS,
  type PickedLocation,
  type TicketField,
} from "./ticketDraft";

type ScanRecord = RefValue<typeof fgRefs.listJobScans>["items"][number];
type Change = {
  field: TicketField | "location" | "storageFormat";
  from: string | undefined;
  to: string;
};
type Review = NonNullable<ReturnType<typeof prepareReview>>;

function prepareReview(
  record: ScanRecord,
  intent: JobScanEditProposal,
  destination?: PickedLocation,
) {
  const ticket = jobScanCorrectionDraft(record);
  const changes: Change[] = [];
  const ticketChanges: [keyof JobScanEditableFields, string | number][] = [];
  for (const field of [...REQUIRED_FIELDS, ...DETAIL_FIELDS]) {
    const raw = intent.fields?.[field];
    if (raw === undefined) continue;
    const numeric = NUMBER_FIELDS.has(field);
    const value = typeof raw === "string" ? raw.trim() : String(raw);
    const limit =
      field === "factoryOrder" || field === "productBarcodeText"
        ? TICKET_CODE_LIMITS[field]
        : 500;
    if (
      !value ||
      value.length > limit ||
      (numeric
        ? typeof raw !== "number" || !Number.isFinite(raw) || raw < 0
        : typeof raw !== "string")
    )
      return null;
    const before = ticket.values[field];
    if (value === (field === "customer" ? before?.trim() : before)) continue;
    changes.push({ field, from: before, to: value });
    ticketChanges.push([field, typeof raw === "number" ? raw : value]);
    ticket.values[field] = value;
  }
  const format = intent.fields?.storageFormat;
  if (format && format !== ticket.storageFormat) {
    changes.push({
      field: "storageFormat",
      from: ticket.storageFormat,
      to: format,
    });
    ticketChanges.push(["storageFormat", format]);
    ticket.storageFormat = format;
  }
  const location = destination && pickedLocationPayload(destination);
  if (intent.locationCode && (!destination?.code || !location)) return null;
  const locationChanged = Boolean(
    location &&
    destination?.code &&
    (!record.mapped || destination.code !== record.locationCode),
  );
  if (locationChanged && destination?.code)
    changes.push({
      field: "location",
      from: record.locationCode ?? record.locationText,
      to: destination.code,
    });
  if (!changes.length || !isComplete(ticket) || hasInvalidQuantity(ticket))
    return null;
  const ticketPatch = ticketChanges.length
    ? (Object.fromEntries(ticketChanges) as JobScanEditableFields)
    : undefined;
  return {
    changes,
    ticketPatch,
    location: locationChanged ? location : undefined,
  };
}

export function JobScanRecordAssist({
  record,
  warehouseId,
  enabled,
  interpret,
  onClose,
  onManualEdit,
}: {
  record: ScanRecord;
  warehouseId: string;
  enabled: boolean;
  interpret: (prompt: string) => Promise<JobScanEditProposal | null>;
  onClose: () => void;
  onManualEdit: (completion: { settle: () => void; close: () => void }) => void;
}) {
  const t = useTranslations("JobScan");
  const convex = useConvex();
  const save = useMutation(fgRefs.updateJobScan);
  const op = useOperation(`${warehouseId}:job-scan-assist:${record.id}`);
  const draftScope = useId();
  const editorCompletion = useRef<DialogCompletionHandle>(null);
  const reviewCompletion = useRef<DialogCompletionHandle>(null);
  const request = useRef<AbortController | null>(null);
  const retainedReview = useRef<Review | undefined>(undefined);
  const closing = useRef(false);
  const [prompt, setPrompt] = useState("");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<"REQUEST" | "LOCATION" | "NO_CHANGES">();
  const [review, setReview] = useState<Review>();
  const [pendingCommand, setPendingCommand] =
    useState<Parameters<typeof save>[0]>();
  const [version] = useState(record.version);
  const history = useQuery(fgRefs.listJobScanCorrections, {
    warehouseId,
    jobScanId: record.id,
  });
  const liveVersion = Math.max(
    record.version,
    history?.ok
      ? (history.value?.current?.version ?? record.version)
      : record.version,
  );
  const stale = liveVersion !== version || op.errorCode === "STALE_REVISION";
  const customerLinkConflict = op.errorCode === "CUSTOMER_LINK_REVIEW_REQUIRED";
  const guard = useNavigationDraft({
    foregroundScope: draftScope,
    dirty: Boolean(prompt.trim()),
    pending: op.busy,
    discard: () => {
      request.current?.abort();
      setPrompt("");
      retainedReview.current = undefined;
      setReview(undefined);
      setPendingCommand(undefined);
    },
  });
  useLayoutEffect(
    () => () => request.current?.abort(),
    [warehouseId, record.id],
  );

  function closeEditor() {
    if (op.busy || closing.current) return;
    guard.requestTransition(() => {
      closing.current = true;
      request.current?.abort();
      editorCompletion.current?.complete(onClose);
    });
  }

  function finishManualSave() {
    closing.current = true;
    editorCompletion.current?.complete(onClose);
  }

  async function propose() {
    if (!enabled || request.current || stale || !prompt.trim()) return;
    const attempt = new AbortController();
    request.current = attempt;
    setAsking(true);
    setError(undefined);
    retainedReview.current = undefined;
    setReview(undefined);
    op.setError("");
    try {
      const intent = await interpret(prompt.trim());
      if (attempt.signal.aborted || closing.current) return;
      if (!intent) {
        setError("REQUEST");
        return;
      }
      let destination: PickedLocation | undefined;
      if (intent.locationCode) {
        const result = await convex.query(fgRefs.resolveJobScanLocation, {
          warehouseId,
          code: intent.locationCode,
        });
        if (attempt.signal.aborted || closing.current) return;
        if (!result.ok || !result.value.ok) {
          setError("LOCATION");
          return;
        }
        destination = {
          ...result.value.location,
          text: result.value.location.code,
        };
      }
      const proposed = prepareReview(record, intent, destination);
      if (!proposed) {
        setError("NO_CHANGES");
        return;
      }
      retainedReview.current = proposed;
      setReview(proposed);
    } catch {
      if (!attempt.signal.aborted && !closing.current) setError("REQUEST");
    } finally {
      if (request.current === attempt) {
        request.current = null;
        if (!attempt.signal.aborted && !closing.current) setAsking(false);
      }
    }
  }

  async function saveReview() {
    if (
      op.busy ||
      !review ||
      (!pendingCommand && (stale || customerLinkConflict || !enabled))
    )
      return;
    const args = {
      warehouseId,
      jobScanId: record.id,
      expectedVersion: version,
      ...(review.ticketPatch ? { ticketPatch: review.ticketPatch } : {}),
      ...(review.location ? { location: review.location } : {}),
    };
    const command = pendingCommand ?? {
      ...args,
      requestId: op.request(JSON.stringify(args), "ephemeral"),
    };
    setPendingCommand(command);
    await op.run(
      () => save(command),
      (outcome) => {
        setPendingCommand(undefined);
        const failure = writeFailure(outcome);
        if (failure) throw failure;
        op.clearRequests();
        guard.settle();
        op.complete(() => {
          reviewCompletion.current?.complete(() => {
            retainedReview.current = undefined;
            setReview(undefined);
            closing.current = true;
            editorCompletion.current?.complete(onClose);
          });
        });
      },
    );
  }

  function display(change: Change, value: string | undefined) {
    if (!value) return "—";
    return change.field === "storageFormat"
      ? t(`format.${value as JobScanStorageFormat}`)
      : value;
  }

  return (
    <>
      <Dialog
        open
        draftScope={draftScope}
        backPending={op.busy}
        completionRef={editorCompletion}
        onOpenChange={(open) => {
          if (!open) closeEditor();
        }}
      >
        <DialogContent size="sm" closeLabel={t("cancel")}>
          <DialogHeader>
            <DialogTitle>{t("recordTools.aiEdit")}</DialogTitle>
            <DialogDescription className="font-mono">
              {record.factoryOrder}
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void propose();
            }}
          >
            <label className="grid gap-2 text-sm font-medium">
              {t("recordTools.editPrompt")}
              <textarea
                autoComplete="off"
                className="min-h-20 w-full rounded-lg border border-border-strong bg-background px-3 py-2 text-base outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
                placeholder={t("recordTools.editExample")}
                value={prompt}
                onChange={(event) => {
                  setPrompt(event.target.value);
                  retainedReview.current = undefined;
                }}
                maxLength={500}
                disabled={asking || Boolean(pendingCommand)}
                required
              />
            </label>
            {error && (
              <Notice
                tone="warning"
                role="alert"
                title={t(
                  error === "LOCATION"
                    ? "recordTools.locationUnavailable"
                    : error === "NO_CHANGES"
                      ? "recordTools.noChanges"
                      : "recordTools.aiUnavailable",
                )}
              />
            )}
            {stale && (
              <div className="space-y-2 text-sm" role="alert">
                <p>{t("recordConflict")}</p>
                <Button variant="outline" onClick={() => closeEditor()}>
                  {t("cancel")}
                </Button>
              </div>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() =>
                  onManualEdit({
                    settle: guard.settle,
                    close: finishManualSave,
                  })
                }
                disabled={
                  !enabled || asking || op.busy || Boolean(pendingCommand)
                }
              >
                {t("editRecord")}
              </Button>
              <Button
                type={pendingCommand ? "button" : "submit"}
                onClick={
                  pendingCommand
                    ? () => setReview(retainedReview.current)
                    : undefined
                }
                disabled={
                  !pendingCommand &&
                  (asking || stale || !enabled || !prompt.trim())
                }
              >
                <Sparkles className="size-4" aria-hidden="true" />
                {t(
                  pendingCommand
                    ? "recordTools.resumeReview"
                    : asking
                      ? "recordTools.requesting"
                      : "recordTools.reviewChanges",
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={review !== undefined}
        onOpenChange={(open) =>
          setReview(open ? retainedReview.current : undefined)
        }
        completionRef={reviewCompletion}
        backPending={op.busy}
      >
        {review && (
          <DialogContent
            size="sm"
            closeLabel={t("cancel")}
            showCloseButton={!op.busy}
          >
            <DialogHeader>
              <DialogTitle>{t("recordTools.reviewChanges")}</DialogTitle>
              <DialogDescription>
                {review.location ? t("locationNotStock") : record.factoryOrder}
              </DialogDescription>
            </DialogHeader>
            <ul className="max-h-64 divide-y divide-border overflow-auto rounded-lg border border-border">
              {review.changes.map((change) => (
                <li key={change.field} className="space-y-1 px-3 py-2 text-sm">
                  <p className="font-medium">{t(change.field)}</p>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 break-words">
                    <span className="text-muted">
                      <span className="block text-xs">
                        {t("recordTools.previousValue")}
                      </span>
                      {display(change, change.from)}
                    </span>
                    <ArrowRight
                      className="size-4 text-muted"
                      aria-hidden="true"
                    />
                    <span>
                      <span className="block text-xs text-muted">
                        {t("recordTools.proposedValue")}
                      </span>
                      {display(change, change.to)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            {review.ticketPatch?.customer !== undefined &&
              !customerLinkConflict && (
                <p className="text-sm text-muted">
                  {t("recordTools.customerLinkNote")}
                </p>
              )}
            {stale && !pendingCommand && (
              <Notice tone="warning" role="alert" title={t("recordConflict")} />
            )}
            {customerLinkConflict ? (
              <Notice
                tone="warning"
                role="alert"
                title={t("recordTools.customerLinkConflict")}
              />
            ) : (
              <ErrorNotice message={op.error} />
            )}
            <DialogFooter>
              <Button
                variant="outline"
                disabled={op.busy || Boolean(pendingCommand)}
                onClick={() =>
                  reviewCompletion.current?.complete(() => setReview(undefined))
                }
              >
                {t("recordTools.changePrompt")}
              </Button>
              <Button
                onClick={() => void saveReview()}
                disabled={
                  op.busy ||
                  (!pendingCommand &&
                    (stale || customerLinkConflict || !enabled))
                }
              >
                {t(
                  op.busy
                    ? "saving"
                    : pendingCommand
                      ? "retryCorrection"
                      : "recordTools.saveReview",
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
