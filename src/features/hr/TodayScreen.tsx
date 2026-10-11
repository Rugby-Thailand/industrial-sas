"use client";

import { useMutation, useQuery } from "convex/react";
import { ArrowRight, CheckCircle2, Clock } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { usePendingGuard } from "@/components/providers/draftGuard";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Link } from "@/i18n/navigation";
import type { RefValue } from "@/lib/convex/clientRef";
import { hrRefs } from "@/lib/convex/hrApi";
import { HR_CODES, ROUTES, destinationHref, hrDayPath } from "@/lib/navigation";

import { formatBusinessDate, formatTime } from "./format";
import {
  CorrectionBadge,
  HrGate,
  HrQueryState,
  PlanText,
  SectionTitle,
  WriteFeedback,
  type PlanLike,
} from "./HrShared";
import { HrInitials, HrStateChip, HrTimeCell } from "./HrUi";
import { useHrWrite, type HrWriteState } from "./useHrWrite";

interface ClockResult {
  readonly occurredAt?: number;
  readonly businessDate?: string;
  readonly kind?: "CLOCK_IN" | "CLOCK_OUT";
}

export function HrTodayScreen() {
  const t = useTranslations("Hr.today");
  return (
    <>
      <PageHeader title={t("title")} summary={t("summary")} showBack={false} />
      <HrGate code={HR_CODES.self}>
        <TodayContent />
      </HrGate>
    </>
  );
}

function TodayContent() {
  const outcome = useQuery(hrRefs.today, {});
  return (
    <HrQueryState outcome={outcome}>
      {() => (outcome?.ok ? <TodayView today={outcome.value} /> : null)}
    </HrQueryState>
  );
}

type TodayValue = RefValue<typeof hrRefs.today>;

function TodayView({ today }: { readonly today: TodayValue }) {
  const t = useTranslations("Hr.today");
  const locale = useLocale();
  const clockIn = useMutation(hrRefs.clockIn);
  const clockOut = useMutation(hrRefs.clockOut);
  const liveAction =
    "nextAction" in today && today.nextAction !== "NONE"
      ? today.nextAction
      : undefined;
  // A submitted clock stays the intent until the server answers definitely,
  // so a lost response is retried as the same command even if live data has
  // since moved on (e.g. now offers clock-out).
  // Intent and receipt belong to one linked employee, so neither carries
  // over if the signed-in account or its link changes.
  const employeeKey = "employee" in today ? today.employee.id : "";
  const [pinnedIntent, setPinnedIntent] = useState<{
    readonly employee: string;
    readonly action: "CLOCK_IN" | "CLOCK_OUT";
  }>();
  const intent =
    pinnedIntent?.employee === employeeKey ? pinnedIntent.action : undefined;
  const action = intent ?? liveAction;
  const write = useHrWrite<ClockResult>(
    `clock:${action ?? "none"}:${employeeKey}`,
  );
  // Leaving cannot cancel a clock write: hold search, AI and links until
  // the server answers, like every other HR write.
  usePendingGuard(write.pending);
  const [receipt, setReceipt] = useState<{
    readonly employee: string;
    readonly result: ClockResult;
  } | null>(null);
  const saved = receipt?.employee === employeeKey ? receipt.result : null;

  if (today.state === "TIMEZONE_UNSUPPORTED")
    return (
      <Notice tone="warning" role="alert" title={t("timezoneUnsupported")} />
    );
  const timezone = today.timezone;
  if (today.state === "NOT_LINKED")
    return (
      <Notice
        tone="neutral"
        title={t("notLinked")}
        body={t("notLinkedHint")}
        testId="hr-not-linked"
      />
    );
  if (today.state === "INACTIVE")
    return (
      <Notice
        tone="neutral"
        title={t("inactive")}
        body={t("inactiveHint")}
        testId="hr-inactive"
      />
    );

  const submit = async () => {
    if (action === undefined) return;
    const command = action;
    const employee = employeeKey;
    setReceipt(null);
    setPinnedIntent({ employee, action: command });
    finish(
      employee,
      await write.submit((requestId) =>
        command === "CLOCK_IN"
          ? clockIn({ requestId })
          : clockOut({ requestId }),
      ),
    );
  };
  function finish(employee: string, result: HrWriteState<ClockResult>) {
    if (result.kind === "PENDING") return;
    if (result.kind !== "UNCERTAIN")
      setPinnedIntent((current) =>
        current?.employee === employee ? undefined : current,
      );
    if (result.kind === "SAVED") setReceipt({ employee, result: result.value });
  }

  const stateLabel = t(`state.${today.state}`);
  const plan = today.plan as PlanLike;
  const done = today.state === "CLOCKED_OUT";
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(17rem,22rem)]">
      <Panel
        aria-labelledby="hr-today-heading"
        className="min-w-0 space-y-4 p-4 sm:p-6"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <HrInitials name={today.employee.displayName} />
            <div className="min-w-0">
              <h2
                id="hr-today-heading"
                className="text-lg leading-7 font-semibold text-text sm:text-xl"
              >
                {formatBusinessDate(today.businessDate, locale, {
                  weekday: true,
                })}
              </h2>
              <p className="truncate text-sm text-muted">
                {today.employee.displayName} · {today.employee.code}
              </p>
            </div>
          </div>
          <HrStateChip
            tone={STATE_TONES[today.state] ?? "neutral"}
            testId="hr-today-state"
          >
            {stateLabel}
          </HrStateChip>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <HrTimeCell
            label={t("clockInLabel")}
            recorded={today.clockInAt !== undefined}
            value={
              today.clockInAt === undefined
                ? "--:--"
                : formatTime(today.clockInAt, locale, timezone)
            }
            hint={today.clockInAt === undefined ? t("notRecorded") : undefined}
            testId="hr-today-in"
          />
          <HrTimeCell
            label={t("clockOutLabel")}
            recorded={today.clockOutAt !== undefined}
            value={
              today.clockOutAt === undefined
                ? "--:--"
                : formatTime(today.clockOutAt, locale, timezone)
            }
            hint={today.clockOutAt === undefined ? t("notRecorded") : undefined}
            testId="hr-today-out"
          />
        </div>

        {/* The next step and its result sit together, ahead of the plan. */}
        <div className="space-y-3" data-testid="hr-today-action">
          {action === undefined ? null : (
            <Button
              type="button"
              className="min-h-14 w-full text-base sm:w-auto sm:min-w-56 md:min-h-14"
              disabled={write.pending}
              onClick={() => void submit()}
              data-testid="hr-clock-action"
            >
              <Clock aria-hidden="true" className="size-5" />
              {write.pending
                ? t("submitting")
                : t(action === "CLOCK_IN" ? "clockIn" : "clockOut")}
            </Button>
          )}
          {saved?.occurredAt === undefined ? (
            <WriteFeedback
              state={write.state}
              onRetry={() => {
                const employee = employeeKey;
                void write.retry().then((result) => finish(employee, result));
              }}
            />
          ) : (
            <SavedClock result={saved} timezone={timezone} />
          )}
          {done && saved?.occurredAt === undefined ? (
            <p
              role="status"
              className="flex items-center gap-2 text-sm font-semibold text-success"
            >
              <CheckCircle2 aria-hidden="true" className="size-5" />
              {t("doneHint")}
            </p>
          ) : (
            <StateNotice today={today} timezone={timezone} />
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border pt-3">
          <dl className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-sm">
            <div className="flex min-w-0 flex-wrap gap-x-2">
              <dt className="text-muted">{t("planned")}</dt>
              <dd className="font-semibold text-text">
                <PlanText plan={plan} />
              </dd>
            </div>
            <div className="flex min-w-0 flex-wrap gap-x-2">
              <dt className="text-muted">{t("site")}</dt>
              <dd className="min-w-0 font-semibold break-words text-text">
                {today.employee.site?.name ?? "—"}
              </dd>
            </div>
          </dl>
          <Link
            href={hrDayPath(today.businessDate)}
            className="inline-flex min-h-touch items-center text-sm font-semibold text-link underline-offset-4 hover:underline"
          >
            {t("dayDetail")}
          </Link>
        </div>
      </Panel>

      <Panel aria-labelledby="hr-requests-heading" className="h-fit">
        <SectionTitle
          action={
            <Link
              href={ROUTES.hrTime}
              className="inline-flex min-h-touch items-center text-sm font-semibold text-link underline-offset-4 hover:underline"
            >
              {t("allRequests")}
            </Link>
          }
        >
          <span id="hr-requests-heading">{t("requests")}</span>
        </SectionTitle>
        {today.corrections.length === 0 ? (
          <p className="text-sm text-muted">{t("noRequests")}</p>
        ) : (
          <ul className="-mx-2 divide-y divide-border">
            {today.corrections.map((item) => (
              <li key={item.id}>
                <Link
                  href={hrDayPath(item.businessDate)}
                  className="flex min-h-touch items-center justify-between gap-3 rounded-md px-2 py-2 text-sm hover:bg-raised focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span className="font-medium text-text">
                    {formatBusinessDate(item.businessDate, locale, {
                      weekday: true,
                      short: true,
                    })}
                  </span>
                  <CorrectionBadge status={item.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

const STATE_TONES: Readonly<
  Record<string, "neutral" | "accent" | "success" | "warning">
> = {
  NOT_CLOCKED_IN: "neutral",
  CLOCKED_IN: "accent",
  CLOCKED_OUT: "success",
  NONWORKING: "neutral",
  UNRESOLVED_OPEN: "warning",
  OUTSIDE_EMPLOYMENT: "neutral",
};

function SavedClock({
  result,
  timezone,
}: {
  readonly result: ClockResult;
  readonly timezone: string;
}) {
  const t = useTranslations("Hr.today");
  const locale = useLocale();
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 rounded-lg border border-success bg-success-surface p-4"
      data-testid="hr-clock-saved"
    >
      <CheckCircle2 aria-hidden="true" className="size-6 text-success" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-success">
          {t(result.kind === "CLOCK_OUT" ? "savedOut" : "savedIn", {
            time: formatTime(result.occurredAt, locale, timezone),
          })}
        </p>
        {result.businessDate ? (
          <p className="text-xs text-muted">
            {formatBusinessDate(result.businessDate, locale, { weekday: true })}
          </p>
        ) : null}
      </div>
      <Link
        href={ROUTES.hrTime}
        className="inline-flex min-h-touch items-center text-sm font-semibold text-link underline-offset-4 hover:underline"
      >
        {t("viewHistory")}
      </Link>
    </div>
  );
}

function StateNotice({
  today,
  timezone,
}: {
  readonly today: TodayValue;
  readonly timezone: string;
}) {
  const t = useTranslations("Hr.today");
  const locale = useLocale();
  if (today.state === "UNRESOLVED_OPEN" && "openDay" in today && today.openDay)
    return (
      <Notice
        tone="warning"
        role="alert"
        title={t("openDay", {
          date: formatBusinessDate(today.openDay.businessDate, locale, {
            short: true,
          }),
          time: formatTime(today.openDay.clockInAt, locale, timezone),
        })}
        body={t(
          today.openDay.pendingCorrection
            ? "openDayPendingHint"
            : "openDayHint",
        )}
        testId="hr-open-day"
      >
        {today.openDay.pendingCorrection ? null : (
          <Button asChild className="w-full sm:w-auto">
            <Link
              href={
                destinationHref({
                  key: "hr.selfDay",
                  date: today.openDay.businessDate,
                  focus: "correction",
                }) ?? hrDayPath(today.openDay.businessDate)
              }
              data-testid="hr-open-day-correct"
            >
              {t("requestCorrection")}
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        )}
      </Notice>
    );
  if (today.state === "OUTSIDE_EMPLOYMENT")
    return <Notice tone="neutral" title={t("outsideEmployment")} />;
  if (today.state === "NONWORKING")
    return <Notice tone="neutral" title={t("nonworkingHint")} />;
  return null;
}
