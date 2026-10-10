"use client";

import { useMutation, useQuery } from "convex/react";
import { ArrowRight, Download, Lock } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useId, useMemo, useState, type FormEvent } from "react";

import {
  useDraftGuard,
  usePendingGuard,
} from "@/components/providers/draftGuard";
import { useHrCan } from "@/components/providers/HrAccessProvider";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { SelectControl } from "@/components/ui/SelectControl";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableScroller } from "@/components/ui/TableScroller";
import type { RefValue } from "@/lib/convex/clientRef";
import { usePageSearchContext } from "@/components/shell/search/pageContext";
import { hrRefs } from "@/lib/convex/hrApi";
import {
  useDeepLinkFocus,
  useGuardedUrl,
  useQueryParams,
  useUrlBackedState,
} from "@/lib/deepLink";
import {
  FOCUS_TARGET_IDS,
  HR_CODES,
  ROUTES,
  destinationHref,
  hrReviewPath,
  readPeriodUrl,
} from "@/lib/navigation";

import { ReasonField } from "./CorrectionForm";
import { formatBusinessDate, formatDateTime } from "./format";
import {
  DayStatusBadge,
  Duration,
  HrGate,
  HrInlineError,
  HrQueryState,
  SectionTitle,
  WriteFeedback,
  useHrError,
} from "./HrShared";
import { HrDisclosure, HrStatStrip, HrStateChip, type HrStat } from "./HrUi";
import { useHrWrite, type HrWriteState } from "./useHrWrite";

type Preview = Extract<RefValue<typeof hrRefs.periodPreview>, { ok: true }>;
type Row = Extract<Preview["view"], { rows: unknown }>["rows"][number];

export function HrPeriodDetailScreen({
  periodId,
}: {
  readonly periodId: string;
}) {
  const t = useTranslations("Hr.period");
  const nav = useTranslations("Navigation");
  return (
    <>
      <PageHeader
        title={t("title")}
        summary={t("summary")}
        breadcrumbs={[{ href: ROUTES.hrPeriods, label: nav("hrPeriods") }]}
      />
      {/* Closed history uses its frozen timezone, so an unsupported current
          zone does not block it; the draft view explains the restriction. */}
      <HrGate code={HR_CODES.close} allowUnsupportedTimezone>
        <PeriodContent periodId={periodId} />
      </HrGate>
    </>
  );
}

function PeriodContent({ periodId }: { readonly periodId: string }) {
  const t = useTranslations("Hr.period");
  const params = useQueryParams();
  const url = readPeriodUrl(params);
  const navigate = useGuardedUrl();
  // The shown version follows `?version=`, so a link, reload or Back opens it.
  const [version, setVersionState] = useUrlBackedState<number | undefined>(
    params.toString(),
    url.version,
  );
  const setVersion = (next: number | undefined) =>
    navigate(
      destinationHref({
        key: "hr.period",
        periodId,
        ...(next === undefined ? {} : { version: next }),
      }) ?? ROUTES.hrPeriods,
      () => setVersionState(next),
    );
  const outcome = useQuery(
    hrRefs.periodPreview,
    url.invalidVersion
      ? "skip"
      : { periodId, ...(version === undefined ? {} : { version }) },
  );
  // The export area (or why export is not possible yet) once loaded.
  useDeepLinkFocus(
    url.focus === undefined ? null : FOCUS_TARGET_IDS.export,
    outcome?.ok === true && outcome.value.ok,
    `${periodId}?${params.toString()}`,
  );
  if (url.invalidVersion)
    return (
      <div className="space-y-3">
        <HrInlineError code="VERSION_NOT_FOUND" />
        <Button
          type="button"
          variant="outline"
          onClick={() => setVersion(undefined)}
        >
          {t("showCurrent")}
        </Button>
      </div>
    );
  return (
    <HrQueryState outcome={outcome}>
      {() => {
        if (!outcome?.ok) return null;
        const result = outcome.value;
        if (!result.ok)
          return (
            <div className="space-y-3">
              <HrInlineError code={result.code} />
              {version === undefined ? null : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setVersion(undefined)}
                >
                  {t("showCurrent")}
                </Button>
              )}
            </div>
          );
        return (
          <PeriodView
            preview={result}
            version={version}
            onVersion={setVersion}
          />
        );
      }}
    </HrQueryState>
  );
}

interface EmployeeSummary {
  readonly employeeId: string;
  readonly code: string;
  readonly name: string;
  readonly worked: number;
  readonly outside: number;
  readonly open: number;
  readonly days: number;
}

function summarize(rows: readonly Row[]): readonly EmployeeSummary[] {
  const map = new Map<string, EmployeeSummary>();
  for (const row of rows) {
    const current = map.get(row.employeeId) ?? {
      employeeId: row.employeeId,
      code: row.employeeCode,
      name: row.employeeName,
      worked: 0,
      outside: 0,
      open: 0,
      days: 0,
    };
    map.set(row.employeeId, {
      ...current,
      worked: current.worked + row.workedMinutes,
      outside: current.outside + row.outsideShiftMinutes,
      open: current.open + (row.status === "READY" ? 0 : 1),
      days: current.days + 1,
    });
  }
  return [...map.values()];
}

function PeriodView({
  preview,
  version,
  onVersion,
}: {
  readonly preview: Preview;
  readonly version: number | undefined;
  readonly onVersion: (version: number | undefined) => void;
}) {
  const t = useTranslations("Hr.period");
  const locale = useLocale();
  const id = useId();
  const { period, view, versions } = preview;
  const canExport = useHrCan(HR_CODES.export);
  usePageSearchContext({
    page: "hr.period",
    period: {
      id: period.id,
      startDate: period.startDate,
      endDate: period.endDate,
      siteCode: period.siteCode,
      latestClosedVersion: period.latestClosedVersion,
      ...(view.kind === "CLOSED" ? { version: view.version } : {}),
    },
  });

  const versionOptions = [
    ...(period.status === "DRAFT"
      ? [
          {
            value: "",
            label: t("currentDraft", { version: period.draftVersion }),
          },
        ]
      : []),
    ...versions.map((entry) => ({
      value: String(entry.version),
      label: t("closedOption", {
        version: entry.version,
        at: formatDateTime(entry.closedAt, locale, period.timezone),
      }),
    })),
    // An older version opened by number stays selectable in the list.
    ...(view.kind === "CLOSED" &&
    !versions.some((entry) => entry.version === view.version)
      ? [
          {
            value: String(view.version),
            label: t("closedOption", {
              version: view.version,
              at: formatDateTime(view.closedAt, locale, period.timezone),
            }),
          },
        ]
      : []),
  ];
  const selectedValue =
    version !== undefined
      ? String(version)
      : period.status === "DRAFT"
        ? ""
        : String(period.latestClosedVersion);

  // The version on screen: an explicit one, else the current draft or the
  // latest closed version.
  const shown =
    view.kind === "CLOSED"
      ? { closed: true, version: view.version }
      : { closed: false, version: period.draftVersion };
  const current =
    period.status === "DRAFT"
      ? !shown.closed
      : shown.closed && shown.version === period.latestClosedVersion;
  const rows = view.kind === "DRAFT" || view.kind === "CLOSED" ? view.rows : [];
  const hasVersions = versionOptions.length > 1 || !preview.versionsComplete;
  // A linked version, or a draft that cannot be shown, opens the list (the
  // other versions are where to go next); it follows Back/Forward too.
  const [versionsOpen, setVersionsOpen] = useUrlBackedState(
    `${version ?? ""}:${view.kind}`,
    version !== undefined ||
      view.kind === "TIMEZONE_UNSUPPORTED" ||
      view.kind === "LIMIT",
  );

  return (
    <div className="space-y-4">
      <Panel className="space-y-4 p-4 sm:p-5" aria-labelledby={`${id}-heading`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2
              id={`${id}-heading`}
              className="text-lg leading-7 font-semibold text-text sm:text-xl"
            >
              {t("rangeTitle", {
                from: formatBusinessDate(period.startDate, locale, {
                  short: true,
                }),
                to: formatBusinessDate(period.endDate, locale, { short: true }),
              })}
            </h2>
            <p className="text-sm text-muted">
              {period.siteCode} · {period.siteName} · {period.timezone}
            </p>
          </div>
          <div className="flex flex-col items-start gap-1 sm:items-end">
            <HrStateChip
              tone={shown.closed ? "success" : "pending"}
              testId="hr-period-shown"
            >
              {t(shown.closed ? "shownClosed" : "shownDraft", {
                version: shown.version,
              })}
            </HrStateChip>
            {view.kind === "CLOSED" ? (
              <p className="text-xs text-muted">
                {t("closedAt", {
                  at: formatDateTime(view.closedAt, locale, period.timezone),
                })}
              </p>
            ) : null}
          </div>
        </div>
        {current ? null : (
          <div
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg bg-raised px-3 py-1 text-sm text-text"
            data-testid="hr-period-earlier"
          >
            <span>{t("earlierVersion")}</span>
            <Button
              type="button"
              variant="link"
              onClick={() => onVersion(undefined)}
            >
              {t("showCurrent")}
            </Button>
          </div>
        )}
        {view.kind === "DRAFT" || view.kind === "CLOSED" ? (
          <Totals view={view} />
        ) : null}
        {/* The one next step for the version on screen. */}
        {view.kind === "DRAFT" ? (
          <CloseControls
            periodId={period.id}
            version={period.draftVersion}
            blocker={view.blocker}
            fingerprint={view.fingerprint}
            rows={view.rows}
          />
        ) : view.kind === "CLOSED" ? (
          <ClosedControls
            periodId={period.id}
            versionId={view.versionId}
            version={view.version}
            latest={
              view.version === period.latestClosedVersion &&
              period.status === "CLOSED"
            }
            canExport={canExport}
          />
        ) : null}
        {hasVersions || (period.revisionReason && period.status === "DRAFT") ? (
          <HrDisclosure
            label={t("versions")}
            badge={
              versionOptions.length > 1 ? versionOptions.length : undefined
            }
            open={versionsOpen}
            onToggle={setVersionsOpen}
            className="border-t border-border"
            contentClassName="space-y-3"
            testId="hr-period-versions"
          >
            {period.revisionReason && period.status === "DRAFT" ? (
              <p className="text-sm break-words text-text">
                {t("revisionReason", { reason: period.revisionReason })}
              </p>
            ) : null}
            {hasVersions ? (
              <div className="flex flex-wrap items-end gap-3">
                {versionOptions.length > 1 ? (
                  <div className="grid w-full gap-2 sm:w-80">
                    <Label htmlFor={`${id}-version`}>{t("versionLabel")}</Label>
                    <SelectControl
                      id={`${id}-version`}
                      value={selectedValue}
                      onValueChange={(value) =>
                        onVersion(value === "" ? undefined : Number(value))
                      }
                      placeholder={t("versionLabel")}
                      emptyLabel={t("versionLabel")}
                      options={versionOptions}
                    />
                  </div>
                ) : null}
                {preview.versionsComplete ? null : (
                  <VersionNumberPicker
                    latest={period.latestClosedVersion}
                    listed={versions.length}
                    onOpen={onVersion}
                  />
                )}
              </div>
            ) : null}
          </HrDisclosure>
        ) : null}
      </Panel>

      {view.kind === "TIMEZONE_UNSUPPORTED" ? (
        <Notice
          tone="warning"
          role="alert"
          title={t("draftTimezone", { timezone: period.timezone })}
          body={t("draftTimezoneHint")}
          testId="hr-period-timezone"
        />
      ) : null}

      {view.kind === "LIMIT" ? (
        <Notice
          tone="danger"
          role="alert"
          title={t("limit")}
          body={t("limitHint")}
        />
      ) : null}

      {/* Days still open are the work list of a blocked draft: shown. */}
      <ExceptionList rows={rows} />
      {rows.length > 0 ? (
        <Panel className="py-1">
          <HrDisclosure label={t("byEmployee")} testId="hr-period-breakdown">
            <EmployeeTable rows={rows} />
          </HrDisclosure>
        </Panel>
      ) : null}
    </div>
  );
}

/** Opens any closed version by number when more exist than the list shows. */
function VersionNumberPicker({
  latest,
  listed,
  onOpen,
}: {
  readonly latest: number;
  readonly listed: number;
  readonly onOpen: (version: number) => void;
}) {
  const t = useTranslations("Hr.period");
  const id = useId();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string>();
  const open = (event: FormEvent) => {
    event.preventDefault();
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1 || number > latest) {
      setError(t("versionNumberInvalid", { latest }));
      return;
    }
    setError(undefined);
    onOpen(number);
  };
  return (
    <form
      onSubmit={open}
      noValidate
      className="flex flex-wrap items-end gap-3"
      data-testid="hr-version-number"
    >
      <div className="w-full sm:w-48">
        <FormField
          id={`${id}-number`}
          label={t("versionNumber")}
          hint={t("versionNumberHint", { listed, latest })}
          {...(error === undefined ? {} : { error })}
        >
          {(field) => (
            <Input
              {...field}
              type="number"
              inputMode="numeric"
              min={1}
              max={latest}
              step={1}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          )}
        </FormField>
      </div>
      <Button type="submit" variant="outline">
        {t("openVersion")}
      </Button>
    </form>
  );
}

function Totals({
  view,
}: {
  readonly view: Extract<Preview["view"], { totals: unknown }>;
}) {
  const t = useTranslations("Hr.period");
  const totals = view.totals as {
    employees: number;
    days: number;
    exceptions?: number;
    unfinished?: number;
    workedMinutes: number;
    absentDays: number;
    leaveDays: number;
  };
  const open = (totals.exceptions ?? 0) + (totals.unfinished ?? 0);
  const items: HrStat[] = [
    {
      label: t("worked"),
      value: <Duration minutes={totals.workedMinutes} />,
      tone: "accent",
    },
    // Only a draft has days still to resolve.
    ...(totals.exceptions === undefined
      ? []
      : [
          {
            label: t("exceptions"),
            value: open,
            tone: open > 0 ? ("warning" as const) : ("success" as const),
          },
        ]),
    { label: t("employees"), value: totals.employees },
    { label: t("days"), value: totals.days },
    { label: t("absent"), value: totals.absentDays },
    { label: t("leave"), value: totals.leaveDays },
  ];
  return <HrStatStrip items={items} label={t("totals")} compact />;
}

const BLOCKER_KEYS = new Set([
  "PERIOD_INCLUDES_FUTURE",
  "PERIOD_SHIFT_UNFINISHED",
  "PERIOD_NOT_READY",
  "PERIOD_EMPTY",
]);

function CloseControls({
  periodId,
  version,
  blocker,
  fingerprint,
  rows,
}: {
  readonly periodId: string;
  readonly version: number;
  readonly blocker: string | null;
  readonly fingerprint: string;
  readonly rows: readonly Row[];
}) {
  const t = useTranslations("Hr.period");
  const message = useHrError();
  const canReview = useHrCan(HR_CODES.review);
  const close = useMutation(hrRefs.closePeriod);
  const [confirming, setConfirming] = useState(false);
  const write = useHrWrite(`period:close:${periodId}:${version}`);
  // Closing freezes a version: leave only after the server answers.
  usePendingGuard(write.pending);
  const send = async () => {
    await write.submit((requestId) =>
      close({ requestId, periodId, expectedFingerprint: fingerprint }),
    );
  };
  // Open days are resolved in Review: go straight to the first one.
  const firstOpen = rows.find((row) => row.status === "EXCEPTION");
  const reviewHref =
    blocker === "PERIOD_NOT_READY" && canReview
      ? hrReviewPath(
          firstOpen === undefined
            ? {}
            : {
                employeeId: firstOpen.employeeId,
                date: firstOpen.businessDate,
              },
        )
      : null;
  return (
    <section
      id={FOCUS_TARGET_IDS.export}
      className="space-y-3 rounded-lg"
      aria-label={t("closeTitle", { version })}
    >
      {blocker === null ? (
        <p className="text-sm text-muted">{t("readyHint")}</p>
      ) : (
        <Notice
          tone="warning"
          role="status"
          title={message(blocker)}
          {...(BLOCKER_KEYS.has(blocker)
            ? { body: t(`blocker.${blocker}`) }
            : {})}
          testId="hr-period-blocker"
        >
          {reviewHref === null ? null : (
            <Button asChild>
              <Link href={reviewHref} data-testid="hr-period-review">
                {t("reviewOpen")}
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          )}
        </Notice>
      )}
      {blocker !== null ? null : (
        <div className="flex flex-wrap items-center gap-3">
          {confirming ? (
            <>
              <Button
                type="button"
                disabled={write.locked}
                onClick={() => void send()}
                data-testid="hr-period-close-confirm"
              >
                <Lock aria-hidden="true" />
                {t("closeConfirm", { version })}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={write.pending}
                onClick={() => setConfirming(false)}
              >
                {t("keepDraft")}
              </Button>
            </>
          ) : (
            <Button
              type="button"
              onClick={() => setConfirming(true)}
              data-testid="hr-period-close"
            >
              <Lock aria-hidden="true" />
              {t("close")}
            </Button>
          )}
        </div>
      )}
      <WriteFeedback state={write.state} onRetry={() => void write.retry()} />
    </section>
  );
}

function downloadCsv(fileName: string, content: string) {
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/csv;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ClosedControls({
  periodId,
  versionId,
  version,
  latest,
  canExport,
}: {
  readonly periodId: string;
  readonly versionId: string;
  readonly version: number;
  readonly latest: boolean;
  readonly canExport: boolean;
}) {
  const t = useTranslations("Hr.period");
  const exportCsv = useMutation(hrRefs.exportCsv);
  const revise = useMutation(hrRefs.startRevision);
  const exporting = useHrWrite<{ fileName: string; content: string }>(
    `period:export:${versionId}`,
  );
  const revising = useHrWrite(`period:revise:${periodId}:${version}`);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string>();
  const [showRevise, setShowRevise] = useState(false);
  // A typed revision reason survives version switches, search and links
  // unless discarded, whether or not its section is open; an export or
  // revision in flight must settle first.
  useDraftGuard(
    reason.trim() !== "" && revising.state.kind !== "SAVED",
    () => {
      setReason("");
      setReasonError(undefined);
      setShowRevise(false);
    },
    exporting.pending || revising.pending,
  );

  const download = async () => {
    deliver(
      await exporting.submit((requestId) =>
        exportCsv({ requestId, versionId }),
      ),
    );
  };
  const deliver = (
    result: HrWriteState<{ fileName: string; content: string }>,
  ) => {
    if (
      result.kind === "SAVED" &&
      result.value.fileName &&
      result.value.content
    )
      downloadCsv(result.value.fileName, result.value.content);
  };

  const startRevision = async () => {
    if (reason.trim().length < 3) {
      setReasonError(t("revisionReasonRequired"));
      return;
    }
    setReasonError(undefined);
    await revising.submit((requestId) =>
      revise({ requestId, periodId, reason: reason.trim() }),
    );
  };

  return (
    <section
      id={FOCUS_TARGET_IDS.export}
      className="space-y-3 rounded-lg"
      aria-label={t("closedTitle", { version })}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          disabled={!canExport || exporting.pending}
          onClick={() => void download()}
          data-testid="hr-period-export"
        >
          <Download aria-hidden="true" />
          {t("exportVersion", { version })}
        </Button>
        {canExport ? null : (
          <p className="text-sm text-muted">{t("exportDenied")}</p>
        )}
      </div>
      <WriteFeedback
        state={exporting.state}
        onRetry={() => void exporting.retry().then(deliver)}
        saved={
          <p role="status" className="text-sm font-semibold text-success">
            {t("exported")}
          </p>
        }
      />
      {latest ? (
        // Stays mounted while closed, so a typed reason and its guard remain.
        <HrDisclosure
          label={t("revise")}
          open={showRevise}
          onToggle={setShowRevise}
          className="border-t border-border"
          contentClassName="space-y-3"
          testId="hr-period-revise"
        >
          <p className="text-sm text-muted">{t("reviseIntro")}</p>
          <ReasonField
            label={t("revisionReasonLabel")}
            value={reason}
            onChange={setReason}
            error={reasonError}
            disabled={revising.locked}
          />
          <Button
            type="button"
            variant="outline"
            disabled={revising.pending}
            onClick={() => void startRevision()}
            data-testid="hr-period-revise-confirm"
          >
            {t("reviseConfirm", { version: version + 1 })}
          </Button>
          <WriteFeedback
            state={revising.state}
            onRetry={() => void revising.retry()}
          />
        </HrDisclosure>
      ) : null}
    </section>
  );
}

function EmployeeTable({ rows }: { readonly rows: readonly Row[] }) {
  const t = useTranslations("Hr.period");
  const summaries = useMemo(() => summarize(rows), [rows]);
  const total = summaries.reduce(
    (sum, item) => ({
      worked: sum.worked + item.worked,
      outside: sum.outside + item.outside,
      open: sum.open + item.open,
    }),
    { worked: 0, outside: 0, open: 0 },
  );
  return (
    <section aria-label={t("byEmployee")}>
      <TableScroller label={t("byEmployee")}>
        <Table scroll={false} className="min-w-[40rem]">
          <TableHeader>
            <TableRow>
              <TableHead>{t("employee")}</TableHead>
              <TableHead className="text-right">{t("days")}</TableHead>
              <TableHead className="text-right">{t("worked")}</TableHead>
              <TableHead className="text-right">{t("outside")}</TableHead>
              <TableHead className="text-right">{t("open")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {summaries.map((item) => (
              <TableRow key={item.employeeId}>
                <TableCell>
                  <span className="block font-semibold text-text">
                    {item.name}
                  </span>
                  <span className="text-xs text-muted">{item.code}</span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {item.days}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <Duration minutes={item.worked} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <Duration minutes={item.outside} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <span
                    className={
                      item.open > 0 ? "font-semibold text-warning" : undefined
                    }
                  >
                    {item.open}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell>{t("total", { count: summaries.length })}</TableCell>
              <TableCell className="text-right tabular-nums">
                {rows.length}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                <Duration minutes={total.worked} />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                <Duration minutes={total.outside} />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {total.open}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </TableScroller>
      <p className="mt-2 text-xs text-muted">{t("outsideNote")}</p>
    </section>
  );
}

function ExceptionList({ rows }: { readonly rows: readonly Row[] }) {
  const t = useTranslations("Hr.period");
  const locale = useLocale();
  const canReview = useHrCan(HR_CODES.review);
  const open = rows.filter((row) => row.status !== "READY");
  if (open.length === 0) return null;
  return (
    <section aria-labelledby="hr-period-open">
      <SectionTitle>
        <span id="hr-period-open">{t("openDays")}</span>
      </SectionTitle>
      <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
        {open.slice(0, 200).map((row) => {
          const content = (
            <>
              <span className="min-w-0">
                <span className="font-semibold text-text">
                  {row.employeeName}
                </span>
                <span className="text-muted"> · {row.employeeCode} · </span>
                {formatBusinessDate(row.businessDate, locale, {
                  weekday: true,
                  short: true,
                })}
              </span>
              <DayStatusBadge
                status={row.status}
                issue={row.issue}
                disposition={row.disposition}
              />
            </>
          );
          const layout =
            "flex min-h-touch flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm";
          return (
            <li key={`${row.employeeId}:${row.businessDate}`}>
              {canReview && row.status === "EXCEPTION" ? (
                <Link
                  href={hrReviewPath({
                    employeeId: row.employeeId,
                    date: row.businessDate,
                  })}
                  className={`${layout} hover:bg-raised focus-visible:outline-2 focus-visible:outline-ring`}
                >
                  {content}
                </Link>
              ) : (
                <div className={layout}>{content}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
