"use client";

import { useLocale, useTranslations } from "next-intl";
import { useSyncExternalStore, type ReactNode } from "react";

import { useHrAccess } from "@/components/providers/HrAccessProvider";
import { OutcomeGate } from "@/components/system/DataGate";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/Notice";
import { StatusBadge, type BadgeTone } from "@/components/ui/StatusBadge";
import { LOCALES } from "@/i18n/routing";
import { subscribeHistoryWrites } from "@/lib/browser/appHistory";
import { visibleDesktopNavigation } from "@/lib/navigation";

import { formatDateTime, formatTime, splitMinutes } from "./format";
import type { HrWriteState } from "./useHrWrite";

export function useHrError() {
  const t = useTranslations("Hr.errors");
  return (code: string | undefined) =>
    t(code !== undefined && t.has(code) ? code : "UNKNOWN");
}

/** Renders children only for members holding `code`; never fixture data. */
export function HrGate({
  code,
  children,
  allowUnsupportedTimezone = false,
}: {
  readonly code: string;
  readonly children: ReactNode;
  /** Pages that only read frozen history may run without a live clock. */
  readonly allowUnsupportedTimezone?: boolean;
}) {
  const t = useTranslations("Hr.gate");
  const access = useHrAccess();
  if (access.status === "LOADING")
    return <LedgerPanelStatus state={{ kind: "LOADING" }} />;
  if (access.status === "UNAVAILABLE")
    return (
      <Notice
        tone="accent"
        title={t("unavailable")}
        body={t("unavailableHint")}
      />
    );
  if (access.status === "NONE" || !access.permissions.includes(code))
    return (
      <Notice
        tone="danger"
        role="alert"
        title={t("denied")}
        body={t("deniedHint")}
        testId="hr-denied"
      />
    );
  const timezoneNotice = access.timezoneSupported ? null : (
    <Notice
      tone="warning"
      role="alert"
      title={t("timezone")}
      body={t(
        allowUnsupportedTimezone ? "timezoneHistoryHint" : "timezoneHint",
        {
          timezone: access.timezone ?? "",
        },
      )}
      testId="hr-timezone-unsupported"
    />
  );
  if (timezoneNotice !== null && !allowUnsupportedTimezone)
    return timezoneNotice;
  return (
    <>
      {timezoneNotice === null ? null : (
        <div className="mb-4">{timezoneNotice}</div>
      )}
      {code !== "hr.self.access" && access.sitesComplete === false ? (
        <Notice
          tone="warning"
          role="alert"
          title={t("sitesIncomplete")}
          body={t("sitesIncompleteHint")}
          className="mb-4"
          testId="hr-sites-incomplete"
        />
      ) : null}
      {children}
    </>
  );
}

/** Loading and refused (with its request ID) states for an HR query outcome. */
export function HrQueryState({
  outcome,
  children,
}: {
  readonly outcome:
    | undefined
    | { readonly ok: false; readonly requestId: string }
    | { readonly ok: true; readonly value: unknown };
  readonly children: () => ReactNode;
}) {
  return <OutcomeGate outcome={outcome}>{() => children()}</OutcomeGate>;
}

/**
 * Back for an HR page header. With app history it always returns. A page
 * opened directly falls back to its nearest visible HR parent (e.g. leave
 * review to leave), else the first visible HR page other than itself; never
 * "/" (a planner page that an HR-only member is redirected away from).
 * While HR access loads, a directly opened page shows Back disabled.
 */
export function useHrBack(): {
  readonly backFallbackHref: string | null;
  readonly backPending: boolean;
} {
  const access = useHrAccess();
  const pathname = useSyncExternalStore(
    subscribeLocation,
    currentPath,
    serverPath,
  );
  if (access.status === "LOADING")
    return { backFallbackHref: null, backPending: true };
  const hrefs =
    access.status === "READY"
      ? visibleDesktopNavigation(access.permissions)
          .flatMap((section) => section.items)
          .map((item) => item.href)
          .filter((href) => href.startsWith("/hr/") && href !== pathname)
      : [];
  const parent = hrefs
    .filter((href) => pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];
  return { backFallbackHref: parent ?? hrefs[0] ?? null, backPending: false };
}

function subscribeLocation(listener: () => void) {
  const release = subscribeHistoryWrites(listener);
  window.addEventListener("popstate", listener);
  return () => {
    release();
    window.removeEventListener("popstate", listener);
  };
}
/** The locale-free path; read from the location so no router context is needed. */
function currentPath(): string {
  const path = window.location.pathname;
  const locale = LOCALES.find(
    (candidate) =>
      path === `/${candidate}` || path.startsWith(`/${candidate}/`),
  );
  return locale ? path.slice(locale.length + 1) || "/" : path;
}
const serverPath = () => "";

export function HrInlineError({ code }: { readonly code: string }) {
  const message = useHrError();
  return (
    <Notice
      tone="danger"
      role="alert"
      title={message(code)}
      testId="hr-error"
    />
  );
}

/** Feedback for one write: saved, refused, denied or uncertain (with safe retry). */
export function WriteFeedback({
  state,
  saved,
  onRetry,
}: {
  readonly state: HrWriteState<unknown>;
  readonly saved?: ReactNode;
  readonly onRetry?: () => void;
}) {
  const t = useTranslations("Hr.write");
  const message = useHrError();
  switch (state.kind) {
    case "IDLE":
      return null;
    case "PENDING":
      return (
        <p role="status" className="text-sm text-muted">
          {t("saving")}
        </p>
      );
    case "SAVED":
      return saved === undefined ? (
        <p role="status" className="text-sm font-semibold text-success">
          {t("saved")}
        </p>
      ) : (
        <>{saved}</>
      );
    case "REFUSED":
      return (
        <Notice
          tone="danger"
          role="alert"
          title={message(state.code)}
          body={t("refusedHint")}
          testId="hr-write-refused"
        />
      );
    case "DENIED":
      return (
        <Notice
          tone="danger"
          role="alert"
          title={t("denied")}
          body={t("deniedHint")}
          testId="hr-write-denied"
        />
      );
    case "UNCERTAIN":
      return (
        <Notice
          tone="warning"
          role="alert"
          title={t("uncertain")}
          body={t("uncertainHint")}
          testId="hr-write-uncertain"
        >
          {onRetry === undefined ? null : (
            <Button type="button" variant="outline" onClick={onRetry}>
              {t("retrySafely")}
            </Button>
          )}
        </Notice>
      );
  }
}

const STATUS_TONES: Readonly<Record<string, BadgeTone>> = {
  READY: "success",
  EXCEPTION: "warning",
  IN_PROGRESS: "accent",
  UPCOMING: "muted",
};

export function DayStatusBadge({
  status,
  issue,
  disposition,
}: {
  readonly status: string;
  readonly issue?: string | undefined;
  readonly disposition?: string | null | undefined;
}) {
  const t = useTranslations("Hr.status");
  const label =
    status === "EXCEPTION" && issue !== undefined
      ? t(`issue.${issue}`)
      : status === "READY" && disposition
        ? t(`disposition.${disposition}`)
        : t(`day.${status}`);
  return <StatusBadge tone={STATUS_TONES[status] ?? "neutral"} label={label} />;
}

const CORRECTION_TONES: Readonly<Record<string, BadgeTone>> = {
  PENDING: "pending",
  CERTIFIED: "success",
  RETURNED: "warning",
};

export function CorrectionBadge({ status }: { readonly status: string }) {
  const t = useTranslations("Hr.status.correction");
  return (
    <StatusBadge
      tone={CORRECTION_TONES[status] ?? "neutral"}
      label={t(status)}
    />
  );
}

export function Duration({ minutes }: { readonly minutes: number }) {
  const t = useTranslations("Hr");
  return <>{t("duration", splitMinutes(minutes))}</>;
}

export function TimeText({
  at,
  timeZone,
  empty,
}: {
  readonly at: number | undefined;
  readonly timeZone: string;
  readonly empty?: string;
}) {
  const locale = useLocale();
  const t = useTranslations("Hr");
  return at === undefined ? (
    <span className="text-muted">{empty ?? t("noRecord")}</span>
  ) : (
    <time dateTime={new Date(at).toISOString()}>
      {formatTime(at, locale, timeZone)}
    </time>
  );
}

export interface PlanLike {
  readonly kind: string;
  readonly startTime?: string | undefined;
  readonly endTime?: string | undefined;
  readonly endsNextDay?: boolean | undefined;
  readonly breakMinutes?: number | undefined;
  readonly reason?: string | undefined;
  readonly holidayName?: string | undefined;
}

export function PlanText({ plan }: { readonly plan: PlanLike }) {
  const t = useTranslations("Hr.plan");
  if (plan.kind !== "SCHEDULED")
    return (
      <>
        {plan.reason === "HOLIDAY" && plan.holidayName
          ? t("holiday", { name: plan.holidayName })
          : t(`nonworking.${plan.reason ?? "NO_SCHEDULE"}`)}
      </>
    );
  return (
    <>
      {t(plan.endsNextDay ? "shiftOvernight" : "shift", {
        start: plan.startTime ?? "",
        end: plan.endTime ?? "",
      })}
      {(plan.breakMinutes ?? 0) > 0
        ? ` · ${t("break", { minutes: plan.breakMinutes ?? 0 })}`
        : ""}
    </>
  );
}

/** Key/value rows for detail summaries. */
export function Facts({
  items,
  dense = false,
}: {
  readonly items: readonly {
    readonly label: string;
    readonly value: ReactNode;
  }[];
  /** Label and value share one row even on phones (evidence cards). */
  readonly dense?: boolean;
}) {
  return (
    <dl
      className={
        dense
          ? "grid grid-cols-[minmax(5.5rem,max-content)_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1.5 text-sm"
          : "grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[max-content_1fr]"
      }
    >
      {items.map((item) => (
        <div key={item.label} className="contents">
          <dt className="break-words text-muted">{item.label}</dt>
          <dd className="min-w-0 font-medium break-words text-text">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function SectionTitle({
  children,
  action,
}: {
  readonly children: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-lg leading-7 font-semibold text-text">{children}</h2>
      {action}
    </div>
  );
}

interface CorrectionHistoryEntry {
  readonly action: string;
  readonly at: number;
  readonly actorName: string | null;
  readonly reason?: string | undefined;
}

/** Retained correction evidence shared by the day record and exact request. */
export function HrCorrectionTimeline({
  entries,
  timezone,
}: {
  readonly entries: readonly CorrectionHistoryEntry[];
  readonly timezone: string;
}) {
  const t = useTranslations("Hr.day");
  const locale = useLocale();
  return (
    <ol className="divide-y divide-border">
      {entries.map((entry, index) => (
        <li key={`${entry.at}-${index}`} className="space-y-1 py-3 text-sm">
          <p className="text-text">
            {t(`history.${entry.action}`, {
              name: entry.actorName ?? t("unknownActor"),
            })}
          </p>
          <time
            dateTime={new Date(entry.at).toISOString()}
            className="text-xs text-muted tabular-nums"
          >
            {formatDateTime(entry.at, locale, timezone)}
          </time>
          {entry.reason ? (
            <p className="wrap-anywhere whitespace-pre-wrap text-muted">
              {entry.reason}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
