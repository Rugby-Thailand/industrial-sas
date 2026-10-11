import { api } from "../../../convex/_generated/api";
import type { Feature } from "../../../convex/model/aiUsage/usage";
import { clientRef, type RefValue } from "@/lib/convex/clientRef";
import { estimateThb, type ThbEstimate } from "./estimate";

export const summaryRef = clientRef(api.aiUsage.reports.summary);
export type Report = Exclude<RefValue<typeof summaryRef>, { error: string }>;
export type Settings = Report["settings"];
export type Metrics = Report["byFeature"][Feature];

/** The report's filter controls; an empty string means "all". */
export interface UsageFilters {
  readonly feature: "" | Feature;
  readonly actorUserId: string;
  readonly warehouseId: string;
  readonly requestedModel: string;
  readonly environment: string;
}

export const NO_FILTERS: UsageFilters = Object.freeze({
  feature: "",
  actorUserId: "",
  warehouseId: "",
  requestedModel: "",
  environment: "",
});

export const activeFilterCount = (filters: UsageFilters): number =>
  Object.values(filters).filter(Boolean).length;

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
 * The estimate from the administrator's saved settings only. Null without
 * settings, or when the saved values cannot produce a finite estimate: no
 * rate or fee is ever assumed here.
 */
export const configuredEstimate = (
  nano: number,
  settings: Settings,
): ThbEstimate | null =>
  settings ? estimateThb(nano, settings.usdThbRate, settings.feePercent) : null;
