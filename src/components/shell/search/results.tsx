"use client";

import { useQuery } from "convex/react";
import { useLocale, useTranslations } from "next-intl";
import {
  Component,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useHrAccess } from "@/components/providers/HrAccessProvider";
import { formatBusinessDate } from "@/features/hr/format";
import { hrRefs } from "@/lib/convex/hrApi";
import {
  HR_CODES,
  destinationTrail,
  hasNavigationPermission,
  type DestinationTarget,
  type StaticDestination,
  type StaticDestinationKey,
} from "@/lib/navigation";
import { matchDestinations } from "@/lib/search/matchDestinations";
import { recordQuery, type RecordQuery } from "@/lib/search/recordQuery";
import {
  periodVersion,
  type Choice,
  type EmployeeHit,
  type PeriodHit,
} from "@/lib/search/resolveIntent";

import { normalizeSearchText } from "../../../../convex/model/search/text";

export type ResultGroup = "AI" | "PAGES" | "RECORDS" | "TASKS";

export interface SearchResult {
  readonly id: string;
  readonly group: ResultGroup;
  readonly title: string;
  /** Visible breadcrumb, e.g. "People › Review". */
  readonly trail: string;
  readonly detail?: string;
  /** What opening it does, e.g. "Open the schedule form". */
  readonly action?: string;
  /** Null: shown for orientation, needs more input (`hint`) to open. */
  readonly target: DestinationTarget | null;
  readonly hint?: string;
}

/** Label helpers shared by normal results and AI choices. */
export function useResultLabels() {
  const nav = useTranslations("Navigation");
  const t = useTranslations("Search");
  const locale = useLocale();
  return useMemo(() => {
    const trailOf = (key: StaticDestinationKey) =>
      destinationTrail(key)
        .map((labelKey) => nav(labelKey))
        .join(" › ");
    const date = (value: string) =>
      formatBusinessDate(value, locale, { weekday: true, short: true });
    const range = (from: string, to: string) =>
      `${formatBusinessDate(from, locale, { short: true })} – ${formatBusinessDate(to, locale, { short: true })}`;
    const label = (destination: StaticDestination) => nav(destination.labelKey);
    const employeeDetail = (employee: EmployeeHit) =>
      [employee.code, employee.siteCode, employee.active ? null : t("inactive")]
        .filter(Boolean)
        .join(" · ");
    const periodDetail = (period: PeriodHit) =>
      [
        period.siteCode,
        period.status === "CLOSED"
          ? t("periodClosed", { version: period.latestClosedVersion })
          : t("periodDraft"),
      ].join(" · ");
    /**
     * The detail of an openable period row names the version it opens, so
     * "ฉบับ 1" never reads "version 4". Only a closed version that exists
     * (1…latestClosedVersion) is named; anything else keeps the period's
     * own state.
     */
    const periodTargetDetail = (period: PeriodHit, version?: number) =>
      version !== undefined &&
      Number.isInteger(version) &&
      version >= 1 &&
      version <= period.latestClosedVersion
        ? [period.siteCode, t("periodClosed", { version })].join(" · ")
        : periodDetail(period);

    /** A typed target (or AI choice) as a result row. */
    const choiceResult = (
      choice: Choice,
      group: ResultGroup,
      index: number,
    ): SearchResult => {
      const id = `${group}-${index}`;
      switch (choice.kind) {
        case "EMPLOYEE":
          return {
            id,
            group,
            title: choice.employee.name,
            trail: trailOf(
              choice.target.key === "hr.reviewDay"
                ? "hr.review"
                : "hr.employees",
            ),
            detail: employeeDetail(choice.employee),
            action:
              choice.target.key === "hr.reviewDay" && choice.date !== undefined
                ? t("actionReviewDay", { date: date(choice.date) })
                : "focus" in choice.target && choice.target.focus === "schedule"
                  ? t("actionEditSchedule")
                  : t("actionEditEmployee"),
            target: choice.target,
          };
        case "PERIOD":
          return {
            id,
            group,
            title: range(choice.period.startDate, choice.period.endDate),
            trail: trailOf("hr.periods"),
            detail: periodTargetDetail(
              choice.period,
              choice.target.key === "hr.period"
                ? choice.target.version
                : undefined,
            ),
            action:
              "focus" in choice.target && choice.target.focus === "export"
                ? t("actionExport")
                : t("actionOpenPeriod"),
            target: choice.target,
          };
        case "DATE":
          return {
            id,
            group,
            title: date(choice.date),
            trail: trailOf("hr.task.correction"),
            action: t("actionCorrectDay", { date: date(choice.date) }),
            target: choice.target,
          };
        case "PAGE": {
          const key = choice.target.key as StaticDestinationKey;
          return {
            id,
            group,
            title: nav(destinationTrail(key).at(-1)!),
            trail: trailOf(key),
            action: t("actionOpen"),
            target: choice.target,
          };
        }
      }
    };
    /** The breadcrumb announced when a typed destination opens. */
    const targetTrail = (target: DestinationTarget) => {
      switch (target.key) {
        case "hr.selfDay":
          return `${trailOf("hr.task.correction")} › ${date(target.date)}`;
        case "hr.reviewDay":
          return `${trailOf("hr.review")} › ${date(target.date)}`;
        case "hr.employeeEdit":
          return trailOf("hr.employees");
        case "hr.period":
          return trailOf("hr.periods");
        default:
          return trailOf(target.key);
      }
    };
    return {
      trailOf,
      targetTrail,
      date,
      range,
      label,
      employeeDetail,
      periodDetail,
      choiceResult,
    };
  }, [locale, nav, t]);
}

const SCHEDULE_WORDS = ["ตารางงาน", "กะ", "schedule", "shift"];

/** Pages, sections and tasks from the registry, plus date-only self tasks. */
export function useStaticResults(
  query: string,
  granted: readonly string[],
): readonly SearchResult[] {
  const t = useTranslations("Search");
  const labels = useResultLabels();
  const hr = useHrAccess();
  return useMemo(() => {
    const matches = matchDestinations(query, granted, labels.label).slice(
      0,
      12,
    );
    const results: SearchResult[] = matches.map(({ destination }) => ({
      id: `static-${destination.key}`,
      group: destination.kind === "TASK" ? "TASKS" : "PAGES",
      title: labels.label(destination),
      trail: labels.trailOf(destination.key),
      action:
        destination.kind === "SECTION"
          ? t("actionOpenSection")
          : t("actionOpen"),
      target: { key: destination.key },
    }));
    // "ลืมลงเวลาเมื่อวาน": a correction task with an explicit date opens the
    // member's OWN day. A query that also names someone ("ลืมลงเวลา EMP-002
    // เมื่อวาน", "…สมชาย…") is about that person, so no own-day link.
    const record = recordQuery(query, hr.today ?? null);
    const ownCode = hr.employee?.code;
    const correction = matches.some(
      (match) => match.destination.key === "hr.task.correction",
    );
    const day = record.day;
    if (
      correction &&
      day !== null &&
      record.text === null &&
      record.codes.every((code) => code === ownCode) &&
      ownCode !== undefined &&
      hasNavigationPermission([HR_CODES.self], granted) &&
      (hr.today === undefined || day.date <= hr.today)
    )
      results.unshift({
        id: "task-self-day",
        group: "TASKS",
        title: t("actionCorrectDay", { date: labels.date(day.date) }),
        trail: labels.trailOf("hr.task.correction"),
        detail: [t("ownTask"), day.inferredYear ? t("inferredYear") : null]
          .filter(Boolean)
          .join(" · "),
        action: t("actionOpenForm"),
        target: { key: "hr.selfDay", date: day.date, focus: "correction" },
      });
    return results;
  }, [granted, hr.employee, hr.today, labels, query, t]);
}

export interface RecordState {
  readonly results: readonly SearchResult[];
  readonly loading: boolean;
  readonly failed: boolean;
  readonly incomplete: boolean;
}

export const IDLE_RECORDS: RecordState = {
  results: [],
  loading: false,
  failed: false,
  incomplete: false,
};

const LOADING_RECORDS: RecordState = { ...IDLE_RECORDS, loading: true };

/**
 * Scoped HR record queries for the typed text, each bound to the permission
 * of the page it opens. Mounted only while the dialog is open with text
 * that names a record or a range; an error boundary keeps menu results.
 */
function RecordQueries({
  query,
  schedule,
  granted,
  onChange,
}: {
  readonly query: RecordQuery;
  /** The text asks for the work schedule, so edit links focus it. */
  readonly schedule: boolean;
  readonly granted: readonly string[];
  readonly onChange: (state: RecordState, fingerprint: string) => void;
}) {
  const t = useTranslations("Search");
  const labels = useResultLabels();
  const canReview = hasNavigationPermission([HR_CODES.review], granted);
  const canAdmin = hasNavigationPermission([HR_CODES.admin], granted);
  const canClose = hasNavigationPermission([HR_CODES.close], granted);
  const canExport = hasNavigationPermission([HR_CODES.export], granted);
  const text = query.text;
  const codeKey = query.codes.join(" ");
  // Exact codes and the name text; stable for an unchanged query.
  const lookup = useMemo(
    () =>
      text === null && codeKey === ""
        ? null
        : codeKey !== ""
          ? { text: text ?? "", codes: codeKey.split(" ") }
          : { text: text ?? "" },
    [codeKey, text],
  );
  const dayDate = query.day?.date ?? null;
  const dayInferred = query.day?.inferredYear ?? false;
  const from = query.range?.from ?? null;
  const to = query.range?.to ?? null;
  const review = useQuery(
    hrRefs.searchReviewEmployees,
    canReview && lookup !== null ? lookup : "skip",
  );
  const admin = useQuery(
    hrRefs.searchAdminEmployees,
    canAdmin && lookup !== null ? lookup : "skip",
  );
  const periods = useQuery(
    hrRefs.searchPeriodsByRange,
    canClose && from !== null && to !== null ? { from, to } : "skip",
  );

  const state = useMemo<RecordState>(() => {
    const waiting =
      (canReview && lookup !== null && review === undefined) ||
      (canAdmin && lookup !== null && admin === undefined) ||
      (canClose && from !== null && periods === undefined);
    const reviewItems: readonly EmployeeHit[] =
      review?.ok === true ? review.value.items : [];
    const adminItems: readonly EmployeeHit[] =
      admin?.ok === true ? admin.value.items : [];
    const employees = new Map<string, EmployeeHit>();
    for (const employee of [...reviewItems, ...adminItems])
      if (!employees.has(employee.id)) employees.set(employee.id, employee);
    const reviewable = new Set(reviewItems.map((employee) => employee.id));
    const editable = new Set(adminItems.map((employee) => employee.id));
    const choices: Choice[] = [];
    const needsDate: SearchResult[] = [];
    for (const employee of employees.values()) {
      if (reviewable.has(employee.id) && dayDate !== null)
        choices.push({
          kind: "EMPLOYEE",
          employee,
          date: dayDate,
          target: {
            key: "hr.reviewDay",
            employeeId: employee.id,
            date: dayDate,
            focus: "decision",
          },
        });
      if (editable.has(employee.id))
        choices.push({
          kind: "EMPLOYEE",
          employee,
          target: {
            key: "hr.employeeEdit",
            employeeId: employee.id,
            focus: schedule ? "schedule" : "details",
          },
        });
      else if (dayDate === null)
        needsDate.push({
          id: `record-needs-date-${employee.id}`,
          group: "RECORDS",
          title: employee.name,
          trail: labels.trailOf("hr.review"),
          detail: labels.employeeDetail(employee),
          target: null,
          hint: t("needsDate"),
        });
    }
    // An explicit version opens exactly that version; one that does not
    // exist (or cannot be read) is shown as unavailable, never the latest.
    const unavailable: SearchResult[] = [];
    for (const period of periods?.ok === true ? periods.value.items : []) {
      const version = periodVersion(query.version, period);
      if (typeof version === "string") {
        unavailable.push({
          id: `record-period-version-${period.id}`,
          group: "RECORDS",
          title: labels.range(period.startDate, period.endDate),
          trail: labels.trailOf("hr.periods"),
          detail: labels.periodDetail(period),
          target: null,
          hint:
            version === "VERSION_UNAVAILABLE" && query.version.kind === "ONE"
              ? t("versionUnavailable", { version: query.version.version })
              : t("versionInvalid"),
        });
        continue;
      }
      choices.push({
        kind: "PERIOD",
        period,
        target: {
          key: "hr.period",
          periodId: period.id,
          ...version,
          ...(canExport ? { focus: "export" as const } : {}),
        },
      });
    }
    const results = [
      ...choices.map((choice, index) => {
        const result = labels.choiceResult(choice, "RECORDS", index);
        return dayInferred && result.target?.key === "hr.reviewDay"
          ? { ...result, detail: `${result.detail} · ${t("inferredYear")}` }
          : result;
      }),
      ...needsDate,
      ...unavailable,
    ];
    return {
      results,
      loading: waiting,
      failed:
        review?.ok === false || admin?.ok === false || periods?.ok === false,
      incomplete:
        (review?.ok === true && !review.value.complete) ||
        (admin?.ok === true && !admin.value.complete) ||
        (periods?.ok === true && !periods.value.complete),
    };
  }, [
    admin,
    canAdmin,
    canClose,
    canExport,
    canReview,
    dayDate,
    dayInferred,
    from,
    labels,
    lookup,
    periods,
    query.version,
    review,
    schedule,
    t,
  ]);
  // Publish only a semantic change. Convex (and test doubles) may hand back
  // a fresh but identical outcome on every render; reporting it would make
  // the parent re-render this component, recompute an equal state and
  // publish again without end.
  const fingerprint = JSON.stringify(state);
  const latest = useRef({ state, fingerprint });
  useLayoutEffect(() => {
    latest.current = { state, fingerprint };
  });
  useEffect(() => {
    onChange(latest.current.state, latest.current.fingerprint);
  }, [fingerprint, onChange]);
  return null;
}

class RecordBoundary extends Component<
  { readonly onError: () => void; readonly children: ReactNode },
  { readonly failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch() {
    this.props.onError();
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Record results for `text`, or idle when nothing searchable is typed. */
export function useRecordResults(
  text: string,
  granted: readonly string[],
  today: string | null,
  enabled: boolean,
): { readonly state: RecordState; readonly node: ReactNode } {
  const identity = useHrAccess().identityKey ?? "";
  const query = useMemo(() => recordQuery(text, today), [text, today]);
  const schedule = SCHEDULE_WORDS.some((word) =>
    normalizeSearchText(text).includes(word),
  );
  const canSearch =
    enabled &&
    (query.text !== null || query.codes.length > 0 || query.range !== null) &&
    hasNavigationPermission(
      [HR_CODES.review, HR_CODES.admin, HR_CODES.close],
      granted,
      "ANY",
    );
  // Results belong to one text, account, organization and grant set: a
  // switch of any of them shows loading, never the previous person's rows.
  const key = JSON.stringify([text, today, identity, granted]);
  const [state, setState] = useState<{
    readonly key: string;
    readonly fingerprint: string;
    readonly value: RecordState;
  }>({ key: "", fingerprint: "", value: IDLE_RECORDS });
  const report = useCallback(
    (value: RecordState, fingerprint: string) =>
      setState((current) =>
        current.key === key && current.fingerprint === fingerprint
          ? current
          : { key, fingerprint, value },
      ),
    [key],
  );
  const fail = useCallback(
    () =>
      setState({
        key,
        fingerprint: "failed",
        value: { ...IDLE_RECORDS, failed: true },
      }),
    [key],
  );
  const current = !canSearch
    ? IDLE_RECORDS
    : state.key === key
      ? state.value
      : LOADING_RECORDS;
  const node = canSearch ? (
    <RecordBoundary key={key} onError={fail}>
      <RecordQueries
        query={query}
        schedule={schedule}
        granted={granted}
        onChange={report}
      />
    </RecordBoundary>
  ) : null;
  return { state: current, node };
}
