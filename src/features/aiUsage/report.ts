import { api } from "../../../convex/_generated/api";
import {
  addDays,
  dayNumber,
  timezoneOffsetMinutes,
  toLocal,
} from "../../../convex/model/hr/calendar";
import type { Feature } from "../../../convex/model/aiUsage/usage";
import { clientRef, type RefValue } from "@/lib/convex/clientRef";
import {
  estimateInputs,
  type UsageEstimate,
} from "@/lib/aiUsage/estimateSources";
import { estimateThb, type ThbEstimate } from "./estimate";

export const summaryRef = clientRef(api.aiUsage.reports.summary);
export type Report = Exclude<RefValue<typeof summaryRef>, { error: string }>;
export type Metrics = Report["byFeature"][Feature];

export type Period = "month" | "today" | "week" | "custom";

export interface DateRange {
  readonly from: string;
  readonly to: string;
}

/** The report's filter controls; an empty string means "all". */
export interface UsageFilters {
  readonly feature: "" | Feature;
  readonly actorUserId: string;
  readonly warehouseId: string;
  readonly requestedModel: string;
  readonly environment: string;
}

export interface UsageCriteria {
  readonly period: Period;
  readonly dates: DateRange | null;
  readonly filters: UsageFilters;
}

export const NO_FILTERS: UsageFilters = Object.freeze({
  feature: "",
  actorUserId: "",
  warehouseId: "",
  requestedModel: "",
  environment: "",
});

export const DEFAULT_CRITERIA: UsageCriteria = Object.freeze({
  period: "month",
  dates: null,
  filters: NO_FILTERS,
});

export const activeFilterCount = (filters: UsageFilters): number =>
  Object.values(filters).filter(Boolean).length;

/** Counts every non-default report condition (period override + dimension filters). */
export const activeConditionCount = (
  period: Period,
  filters: UsageFilters,
): number => (period !== "month" ? 1 : 0) + activeFilterCount(filters);

/** Preset calendar dates in the organization's fixed-offset timezone. */
export function presetDateRange(
  period: Exclude<Period, "custom">,
  timezone: string | null,
  now: number,
): DateRange | null {
  if (!timezone) return null;
  const offset = timezoneOffsetMinutes(timezone);
  if (!offset.ok) return null;
  const today = toLocal(now, offset.value).date;
  if (period === "today") return { from: today, to: today };
  if (period === "week") return { from: addDays(today, -6), to: today };
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

/** Formats a canonical YYYY-MM-DD date in the active locale without timezone drift. */
export function formatIsoDate(iso: string, locale: string): string {
  if (dayNumber(iso) === null) return iso;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${iso}T12:00:00Z`));
}

/** Formats a custom date range for UI chips and toolbar labels. */
export function formatDateRangeLabel(
  from: string,
  to: string,
  locale: string,
): string {
  const start = formatIsoDate(from, locale);
  const end = formatIsoDate(to, locale);
  return from === to ? start : `${start} – ${end}`;
}

export type DateRangeValidationError =
  "required" | "format" | "order" | "limit";

/** Validates an inclusive YYYY-MM-DD range against the 93-day report limit. */
export function validateDateRange(
  from: string,
  to: string,
): DateRangeValidationError | null {
  const startText = from.trim(),
    endText = to.trim();
  if (!startText || !endText) return "required";
  const start = dayNumber(startText),
    end = dayNumber(endText);
  if (start === null || end === null) return "format";
  if (end < start) return "order";
  if (end - start > 92) return "limit";
  return null;
}

/**
 * The filtered total of the features on screen. The server already applies
 * the user, warehouse, model and environment filters to every feature; the
 * feature filter only chooses which features are shown, so the total is the
 * sum of exactly the cards shown.
 */
export interface UsageTotal {
  readonly attemptCount: number;
  readonly knownCostUsdNano: number;
  readonly unknownAttemptCount: number;
  readonly pendingCount: number;
}

export function filteredTotal(
  byFeature: Report["byFeature"],
  features: readonly Feature[],
): UsageTotal {
  let attemptCount = 0,
    knownCostUsdNano = 0,
    unknownAttemptCount = 0,
    pendingCount = 0;
  for (const feature of features) {
    const m = byFeature[feature];
    attemptCount += m.attemptCount;
    knownCostUsdNano += m.knownCostUsdNano;
    unknownAttemptCount += m.unknownAttemptCount;
    pendingCount += m.pendingCount;
  }
  return { attemptCount, knownCostUsdNano, unknownAttemptCount, pendingCount };
}

/**
 * Whether a confirmed amount can be shown. `NONE`: no provider call, so a
 * zero total is exact. `UNCONFIRMED`: every call lacks a confirmed cost, so
 * no amount is known (never shown as zero). `PARTIAL`: the amount is a lower
 * bound. `CONFIRMED`: every call's cost, including an explicit zero, is known.
 */
export type CostState = "NONE" | "UNCONFIRMED" | "PARTIAL" | "CONFIRMED";

export function costState(
  value: Pick<UsageTotal, "attemptCount" | "unknownAttemptCount">,
): CostState {
  if (value.attemptCount === 0) return "NONE";
  if (value.unknownAttemptCount >= value.attemptCount) return "UNCONFIRMED";
  return value.unknownAttemptCount ? "PARTIAL" : "CONFIRMED";
}

/**
 * The baht estimate from the automatic snapshot only. Null without a usable
 * rate; the funding fee is null without a published percentage. No rate or
 * fee is ever assumed here.
 */
export const automaticEstimate = (
  nano: number,
  estimate: UsageEstimate | null,
): ThbEstimate | null => {
  const { rate, feePercent } = estimateInputs(estimate);
  return rate === null ? null : estimateThb(nano, rate, feePercent);
};
