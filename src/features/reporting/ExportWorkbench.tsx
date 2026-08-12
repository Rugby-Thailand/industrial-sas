"use client";

/**
 * Requesting an export, watching it run, and taking the file.
 *
 * An export is a *job*, and the screen says so rather than pretending to be a
 * download button. That is not a limitation being apologised for — it is the
 * honest shape of the operation. A button that appeared to produce a file
 * instantly would be a button that either lied about small exports or timed out
 * on large ones, and the tenant most likely to ask is the one with the most
 * data.
 *
 * ### The three endings, all worded
 *
 * - **Complete** carries a row count and a download control.
 * - **Running** carries the rows so far, so a long walk visibly progresses.
 * - **Failed** carries its code — `ARTIFACT_LIMIT_REACHED` is the one that
 *   matters, and it means *the file would have been incomplete*, not "try
 *   again". A truncated stock extract that looked whole is the worst outcome
 *   this feature can have, so the failure is loud.
 *
 * ### Where delivery stops
 *
 * `INV-0011-08` wants a short-lived signed URL from a file-storage vendor that
 * is not configured. There is none, and none is faked: the artifact is fetched
 * through a permission-checked query and handed to the browser as a local blob.
 * The notice on the page says exactly that, because "downloaded" and "delivered
 * through a signed URL" are different security claims.
 */
import { useMutation, useQuery } from "convex/react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { useAppEnvironment } from "@/components/providers/EnvironmentProvider";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { EntityWriteForm } from "@/features/masterData/EntityWriteForm";
import { Notice } from "@/components/ui/Notice";
import { StatusBadge, type BadgeTone } from "@/components/ui/StatusBadge";
import {
  getReportJobRef,
  requestExportRef,
  runExportChunkRef,
  type ReportJobRow,
  type ReportKind,
} from "@/lib/convex/reportingApi";
import { formatCount } from "@/lib/formatters";
import { PREVIEW_ARTIFACT } from "@/lib/preview/reportingPreview";
import type { AppLocale } from "@/i18n/routing";

import { ReportJobs } from "./ReportingSources";

import { Button } from "@/components/ui/button";

/** The exports a supervisor may ask for. Mirrors the server's closed set. */
const REPORT_KINDS = [
  "INVENTORY_BALANCES",
  "RECEIPT_LINES",
  "PUTAWAY_TASKS",
] as const;

const STATUS_TONES: Readonly<Record<string, BadgeTone>> = Object.freeze({
  QUEUED: "muted",
  RUNNING: "accent",
  COMPLETE: "success",
  FAILED: "danger",
});

export function ExportWorkbench() {
  const t = useTranslations("Reports");
  const writeT = useTranslations("Write");
  const kindT = useTranslations("ReportKind");
  const warehouseId = useWorkspace().selectedWarehouseId;

  return (
    <div className="flex flex-col gap-6">
      <Notice
        tone="accent"
        title={t("deliveryBoundary")}
        body={t("deliveryBoundaryHint")}
        testId="reports-delivery-boundary"
      />

      <EntityWriteForm
        testId="form-request-export"
        mutationRef={requestExportRef}
        legend={t("requestLegend")}
        description={t("requestDescription")}
        submitLabel={t("requestSubmit")}
        requiredMessage={writeT("required")}
        fields={[
          {
            name: "kind",
            label: t("fieldKind"),
            kind: "select",
            required: true,
            options: REPORT_KINDS.map((kind) => ({
              value: kind,
              label: kindT(kind),
            })),
          },
        ]}
        toArgs={(values, requestId) => ({
          requestId,
          warehouseId: warehouseId ?? "",
          kind: (values["kind"] ?? "INVENTORY_BALANCES") as ReportKind,
        })}
      />

      <ReportJobs emptyTitle={t("noJobs")} emptyBody={t("noJobsHint")}>
        {(jobs) => <JobList jobs={jobs} />}
      </ReportJobs>
    </div>
  );
}

export function JobList({ jobs }: { readonly jobs: readonly ReportJobRow[] }) {
  const t = useTranslations("Reports");
  const locale = useLocale() as AppLocale;
  const kindT = useTranslations("ReportKind");
  const statusT = useTranslations("ReportJobStatus");

  return (
    <ul className="flex flex-col gap-3" data-testid="report-jobs">
      {jobs.map((job) => (
        <li
          key={job.reportJobId}
          data-testid={`report-job-${job.reportJobId}`}
          className="rounded-lg border border-border bg-surface p-4"
        >
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-semibold text-text">
              {kindT(job.kind)}
            </span>
            <StatusBadge
              tone={STATUS_TONES[job.status] ?? "muted"}
              label={statusT(job.status)}
            />
            <span className="font-mono text-xs text-muted tabular-nums">
              {t("rowCount", {
                formattedCount: formatCount(job.rowCount, locale),
                rowLabel: t(job.rowCount === 1 ? "rowSingular" : "rowPlural"),
              })}
            </span>
          </div>

          {job.failureCode === undefined ? null : (
            <p
              className="mt-2 text-sm text-danger"
              data-testid={`report-job-failure-${job.reportJobId}`}
            >
              {t(
                job.failureCode === "ARTIFACT_LIMIT_REACHED"
                  ? "failureArtifactLimit"
                  : "failureOther",
              )}{" "}
              <code className="font-mono">{job.failureCode}</code>
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {job.status === "COMPLETE" ? (
              <DownloadControl job={job} />
            ) : job.status === "FAILED" ? null : (
              <AdvanceControl job={job} />
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Advance a running export by one chunk.
 *
 * Driven from the client on purpose, and the same shape the purchase-order
 * import already uses: one bounded step per press, with the row count moving
 * where the operator can see it. A scheduled worker would be the production
 * shape and needs the job-queue vendor (`INT-06`) that is not configured; a
 * button that visibly does one page is honest about which of those exists.
 */
function AdvanceControl({ job }: { readonly job: ReportJobRow }) {
  const preview = useAppEnvironment().previewMode;
  const warehouseId = useWorkspace().selectedWarehouseId;

  /*
   * The gate decides *which component renders*, not what a hook does. `useMutation`
   * throws without a `ConvexProvider`, and there is no provider in preview or on
   * an unconfigured machine — a hook cannot decline to run, so the branch that
   * calls one has to be a separate component.
   */
  return preview || warehouseId === undefined ? (
    <DemonstratedAdvance job={job} />
  ) : (
    <ServerAdvance job={job} warehouseId={warehouseId} />
  );
}

/** Preview writes nothing, and says so in the word the whole mode turns on. */
function DemonstratedAdvance({ job }: { readonly job: ReportJobRow }) {
  const t = useTranslations("Reports");
  const [demonstrated, setDemonstrated] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="outline"
        data-testid={`report-advance-${job.reportJobId}`}
        onClick={() => setDemonstrated(true)}
      >
        {t("advance")}
      </Button>
      {demonstrated ? (
        <p className="text-xs text-muted" data-testid="write-DEMONSTRATED">
          {t("advanceDemonstrated")}
        </p>
      ) : null}
    </div>
  );
}

/**
 * What the last attempt to advance this job ended as.
 *
 * Four states, because collapsing any two of them removes an instruction the
 * operator needs. `DENIED` carries a request ID a supervisor can quote;
 * `REFUSED` carries the server's own code, which is the only string that
 * connects this screen to a log line; `FAILED` is a transport problem and the
 * only one where pressing again is the right response.
 */
type AdvanceState =
  | { readonly kind: "IDLE" }
  | { readonly kind: "RUNNING" }
  | { readonly kind: "DENIED"; readonly requestId: string }
  | { readonly kind: "REFUSED"; readonly code: string }
  | { readonly kind: "FAILED" };

/**
 * Exported for its own test.
 *
 * `AdvanceControl` cannot reach this branch today: outside preview the workspace
 * resolves no warehouse list at all until an identity provider exists
 * (`resolveWorkspace`), so `selectedWarehouseId` is always `undefined` and the
 * demonstrated branch renders. That is the Clerk gate, not dead code — this is
 * the component that runs the moment a tenant resolves, so it is tested as the
 * unit it is rather than through a parent that currently cannot select it.
 */
export function ServerAdvance({
  job,
  warehouseId,
}: {
  readonly job: ReportJobRow;
  readonly warehouseId: string;
}) {
  const t = useTranslations("Reports");
  const advance = useMutation(runExportChunkRef);
  const [state, setState] = useState<AdvanceState>({ kind: "IDLE" });

  /*
   * Every ending is handled. A control that ignored the answer would leave a
   * refused chunk looking exactly like a successful one — the row count simply
   * would not move — and an operator would press it again, and again, on an
   * export that had already stopped.
   */
  const run = () => {
    setState({ kind: "RUNNING" });
    void advance({ warehouseId, reportJobId: job.reportJobId }).then(
      (outcome) => {
        if (!outcome.ok) {
          setState({ kind: "DENIED", requestId: outcome.requestId });
          return;
        }
        const written = outcome.value as {
          readonly written?: boolean;
          readonly error?: { readonly code?: string };
        };
        setState(
          written.written === false
            ? { kind: "REFUSED", code: written.error?.code ?? "UNKNOWN" }
            : { kind: "IDLE" },
        );
      },
      // A rejected promise is a transport failure, not a decision: the server
      // may or may not have run the chunk, which is safe here because a chunk
      // commits its rows and its cursor together.
      () => setState({ kind: "FAILED" }),
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="outline"
        disabled={state.kind === "RUNNING"}
        data-testid={`report-advance-${job.reportJobId}`}
        onClick={run}
      >
        {state.kind === "RUNNING" ? t("advanceRunning") : t("advance")}
      </Button>

      {/*
       * `role="alert"` rather than a silent colour change: the failure arrives
       * after the press, so a screen-reader user who has already moved on has to
       * be told rather than shown. `aria-live` is implied by the role.
       */}
      {state.kind === "DENIED" ? (
        <p
          role="alert"
          className="text-xs text-danger"
          data-testid={`report-advance-denied-${job.reportJobId}`}
        >
          {t("advanceDenied")}{" "}
          <code className="font-mono">{state.requestId}</code>
        </p>
      ) : null}
      {state.kind === "REFUSED" ? (
        <p
          role="alert"
          className="text-xs text-danger"
          data-testid={`report-advance-refused-${job.reportJobId}`}
        >
          {t("advanceRefused")} <code className="font-mono">{state.code}</code>
        </p>
      ) : null}
      {state.kind === "FAILED" ? (
        <p
          role="alert"
          className="text-xs text-danger"
          data-testid={`report-advance-failed-${job.reportJobId}`}
        >
          {t("advanceFailed")}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Fetch a finished artifact and hand it to the browser.
 *
 * A blob rather than a link, because there is no signed URL to link to. The file
 * is produced from a value this session already fetched through a
 * permission-checked query, so nothing is reachable that the caller could not
 * already read.
 */
function DownloadControl({ job }: { readonly job: ReportJobRow }) {
  const t = useTranslations("Reports");
  const preview = useAppEnvironment().previewMode;

  return preview ? (
    <PreviewDownload job={job} label={t("download")} />
  ) : (
    <ServerDownload job={job} label={t("download")} />
  );
}

function PreviewDownload({
  job,
  label,
}: {
  readonly job: ReportJobRow;
  readonly label: string;
}) {
  return <DownloadButton job={job} label={label} artifact={PREVIEW_ARTIFACT} />;
}

function ServerDownload({
  job,
  label,
}: {
  readonly job: ReportJobRow;
  readonly label: string;
}) {
  const warehouseId = useWorkspace().selectedWarehouseId ?? "";
  const outcome = useQuery(getReportJobRef, {
    warehouseId,
    reportJobId: job.reportJobId,
  });

  const artifact =
    outcome?.ok && outcome.value.found ? outcome.value.artifact : undefined;

  return (
    <DownloadButton
      job={job}
      label={label}
      {...(artifact === undefined ? {} : { artifact })}
    />
  );
}

function DownloadButton({
  job,
  label,
  artifact,
}: {
  readonly job: ReportJobRow;
  readonly label: string;
  readonly artifact?: string;
}) {
  const t = useTranslations("Reports");

  return (
    <Button
      type="button"
      variant="outline"
      disabled={artifact === undefined}
      data-testid={`report-download-${job.reportJobId}`}
      onClick={() => {
        if (artifact === undefined) return;
        /*
         * `text/csv;charset=utf-8` with the renderer's byte-order mark already
         * in the string: without both, a Thai item name opens as mojibake in the
         * spreadsheet application this file exists for.
         */
        const blob = new Blob([artifact], {
          type: "text/csv;charset=utf-8",
        });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${job.kind.toLowerCase()}-${job.reportJobId}.csv`;
        anchor.click();
        URL.revokeObjectURL(url);
      }}
    >
      {artifact === undefined ? t("downloadPreparing") : label}
    </Button>
  );
}
