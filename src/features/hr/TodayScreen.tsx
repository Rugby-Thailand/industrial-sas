"use client";

import { useMutation } from "convex/react";
import { useHrQuery } from "@/hooks/useHrQuery";
import { ArrowRight, CheckCircle2, Clock } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { useHrAccess } from "@/components/providers/HrAccessProvider";
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
  type PlanLike,
  useHrBack,
  WriteFeedback,
} from "./HrShared";
import { HrInitials, HrStateChip, HrTimeCell } from "./HrUi";
import { HrShortcuts } from "./HrShortcuts";
import { HrHomeUpdates } from "./HrHomeUpdates";
import { HrUpcomingHoliday } from "./HolidaysScreen";
import {
  clearHrClockRecoveryExcept,
  useHrClockWrite,
  useHrWrite,
  type HrWriteState,
  type HrClockCommand,
} from "./useHrWrite";

interface ClockResult {
  readonly occurredAt?: number;
  readonly businessDate?: string;
  readonly kind?: "CLOCK_IN" | "CLOCK_OUT";
}

export function HrTodayScreen() {
  const t = useTranslations("Hr.today");
  const back = useHrBack();
  const access = useHrAccess();
  const identity =
    access.status === "READY" ? (access.identityKey ?? "anonymous") : undefined;
  useEffect(() => {
    // Loading is not logout: keep recovery until access resolves, including
    // the first authenticated page load and temporary access refreshes.
    if (access.status === "LOADING") return;
    clearHrClockRecoveryExcept(identity);
  }, [access.status, identity]);
  return (
    <>
      <PageHeader title={t("title")} summary={t("summary")} {...back} />
      <HrGate code={HR_CODES.self}>
        <TodayContent />
      </HrGate>
    </>
  );
}

function TodayContent() {
  const identity = useHrAccess().identityKey;
  const outcome = useHrQuery(hrRefs.today, {});
  return (
    <HrQueryState outcome={outcome}>
      {() =>
        outcome?.ok ? (
          <TodayView
            key={`${identity}:${"employee" in outcome.value ? outcome.value.employee.id : "unlinked"}`}
            today={outcome.value}
          />
        ) : null
      }
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
  const employeeKey = "employee" in today ? today.employee.id : "";
  async function sendClock(command: HrClockCommand) {
    const outcome =
      command.kind === "CLOCK_IN"
        ? await clockIn({
            requestId: command.requestId,
            expectedBusinessDate: command.expectedBusinessDate,
          })
        : await clockOut({
            requestId: command.requestId,
            expectedBusinessDate: command.expectedBusinessDate,
          });
    if (
      outcome.ok &&
      outcome.value.written === true &&
      (outcome.value.kind !== command.kind ||
        outcome.value.businessDate !== command.expectedBusinessDate ||
        typeof outcome.value.occurredAt !== "number" ||
        !Number.isFinite(outcome.value.occurredAt))
    )
      return undefined;
    return outcome;
  }
  const clock = useHrClockWrite<ClockResult>(
    employeeKey,
    "businessDate" in today ? today.businessDate : "",
    sendClock,
  );
  // Older tabs used action-scoped scalar IDs. They must be reconciled rather
  // than silently borrowed by the newer clock-only descriptor.
  const legacy = (action: "CLOCK_IN" | "CLOCK_OUT") => ({
    decode: (
      value: unknown,
    ):
      | { action: "CLOCK_IN" | "CLOCK_OUT"; expectedBusinessDate: string }
      | undefined => {
      if (
        typeof value !== "object" ||
        value === null ||
        !("action" in value) ||
        value.action !== action ||
        !("expectedBusinessDate" in value) ||
        typeof value.expectedBusinessDate !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value.expectedBusinessDate)
      )
        return undefined;
      return { action, expectedBusinessDate: value.expectedBusinessDate };
    },
    send: (
      payload: {
        action: "CLOCK_IN" | "CLOCK_OUT";
        expectedBusinessDate: string;
      },
      requestId: string,
    ) =>
      sendClock({
        kind: payload.action,
        expectedBusinessDate: payload.expectedBusinessDate,
        employeeId: employeeKey,
        requestId,
      }),
  });
  const entering = useHrWrite<
    ClockResult,
    { action: "CLOCK_IN" | "CLOCK_OUT"; expectedBusinessDate: string }
  >(`clock:CLOCK_IN:${employeeKey}`, legacy("CLOCK_IN"));
  const leaving = useHrWrite<
    ClockResult,
    { action: "CLOCK_IN" | "CLOCK_OUT"; expectedBusinessDate: string }
  >(`clock:CLOCK_OUT:${employeeKey}`, legacy("CLOCK_OUT"));
  const action =
    clock.command?.kind ??
    (entering.locked ? "CLOCK_IN" : leaving.locked ? "CLOCK_OUT" : liveAction);
  const write =
    clock.state.kind !== "IDLE"
      ? clock
      : entering.state.kind !== "IDLE"
        ? entering
        : leaving;
  // Leaving cannot cancel a clock write: hold search, AI and links until
  // the server answers, like every other HR write.
  usePendingGuard(clock.pending || entering.pending || leaving.pending);
  const [receipt, setReceipt] = useState<{
    readonly employee: string;
    readonly result: ClockResult;
  } | null>(null);
  // A shared command can settle after remount, without this view's submit callback.
  const ownReceipt =
    clock.pending || entering.pending || leaving.pending
      ? null
      : write.state.kind === "SAVED"
        ? write.state.value
        : receipt?.employee === employeeKey
          ? receipt.result
          : null;
  const saved =
    ownReceipt?.businessDate ===
    ("businessDate" in today ? today.businessDate : undefined)
      ? ownReceipt
      : null;

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
    if (
      action === undefined ||
      clock.locked ||
      entering.locked ||
      leaving.locked
    )
      return;
    const command = action;
    const employee = employeeKey;
    setReceipt(null);
    finish(employee, await clock.submit(command));
  };
  function finish(employee: string, result: HrWriteState<ClockResult>) {
    if (result.kind === "PENDING") return;

    if (result.kind === "SAVED") setReceipt({ employee, result: result.value });
  }

  const stateLabel = t(`state.${today.state}`);
  const plan = today.plan as PlanLike;
  const done = today.state === "CLOCKED_OUT";
  return (
    <div className="space-y-6">
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
              hint={
                today.clockInAt === undefined ? t("notRecorded") : undefined
              }
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
              hint={
                today.clockOutAt === undefined ? t("notRecorded") : undefined
              }
              testId="hr-today-out"
            />
          </div>

          {/* The next step and its result sit together, ahead of the plan. */}
          <div className="space-y-3" data-testid="hr-today-action">
            {action === undefined ? null : (
              <Button
                type="button"
                className="min-h-14 w-full text-base sm:w-auto sm:min-w-56 md:min-h-14"
                disabled={clock.locked || entering.locked || leaving.locked}
                onClick={() => void submit()}
                data-testid="hr-clock-action"
              >
                <Clock aria-hidden="true" className="size-5" />
                {write.pending
                  ? t("submitting")
                  : t(action === "CLOCK_IN" ? "clockIn" : "clockOut")}
              </Button>
            )}
            {saved?.occurredAt !== undefined ? (
              <SavedClock result={saved} timezone={timezone} />
            ) : ownReceipt?.businessDate &&
              ownReceipt.occurredAt !== undefined ? (
              <Notice
                tone="neutral"
                role="status"
                title={t("recoveredEarlier", {
                  date: formatBusinessDate(ownReceipt.businessDate, locale, {
                    weekday: true,
                  }),
                })}
              />
            ) : (
              <WriteFeedback
                state={write.state}
                onRetry={() => {
                  const employee = employeeKey;
                  void write.retry().then((result) => finish(employee, result));
                }}
              />
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

        <div className="space-y-6">
          <HrUpcomingHoliday today={today.today} />
          <Panel aria-labelledby="hr-requests-heading" className="h-fit">
            <SectionTitle
              action={
                <Link
                  href={ROUTES.hrRequests}
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
      </div>
      <HrHomeUpdates />
      <HrShortcuts />
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
