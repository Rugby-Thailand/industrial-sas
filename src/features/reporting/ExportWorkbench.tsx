"use client";

import { useMutation, useQuery } from "convex/react";
import { Download, Play } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

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
import type { AppLocale } from "@/i18n/routing";

import { ReportJobs } from "./ReportingSources";

import { Button } from "@/components/ui/button";

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

function AdvanceControl({ job }: { readonly job: ReportJobRow }) {
  const warehouseId = useWorkspace().selectedWarehouseId;
  return warehouseId === undefined ? null : (
    <ServerAdvance job={job} warehouseId={warehouseId} />
  );
}

type AdvanceState =
  | { readonly kind: "IDLE" }
  | { readonly kind: "RUNNING" }
  | { readonly kind: "DENIED"; readonly requestId: string }
  | { readonly kind: "REFUSED"; readonly code: string }
  | { readonly kind: "FAILED" };

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
        className="gap-2"
      >
        <Play aria-hidden="true" className="size-4" />
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

function DownloadControl({ job }: { readonly job: ReportJobRow }) {
  const t = useTranslations("Reports");
  return <ServerDownload job={job} label={t("download")} />;
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
      className="gap-2"
    >
      <Download aria-hidden="true" className="size-4" />
      {artifact === undefined ? t("downloadPreparing") : label}
    </Button>
  );
}
