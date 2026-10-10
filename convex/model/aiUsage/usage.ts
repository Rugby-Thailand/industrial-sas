import { v } from "convex/values";
import {
  dayNumber,
  MS_PER_DAY,
  timezoneOffsetMinutes,
  toLocal,
} from "../hr/calendar";

export const feature = v.union(
  v.literal("JOB_TICKET_SCAN"),
  v.literal("AI_SEARCH"),
);
export const status = v.union(
  v.literal("PENDING"),
  v.literal("SUCCEEDED"),
  v.literal("UNREADABLE"),
  v.literal("PROVIDER_ERROR"),
  v.literal("TIMEOUT"),
  v.literal("NETWORK_ERROR"),
  v.literal("INTERRUPTED"),
);
export type Feature = "JOB_TICKET_SCAN" | "AI_SEARCH";
export type UsageStatus =
  | "PENDING"
  | "SUCCEEDED"
  | "UNREADABLE"
  | "PROVIDER_ERROR"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "INTERRUPTED";
export const usageFields = {
  providerGenerationId: v.optional(v.string()),
  actualModel: v.optional(v.string()),
  isByok: v.optional(v.boolean()),
  unitKind: v.literal("MODEL_TOKEN"),
  inputUnitCount: v.optional(v.number()),
  outputUnitCount: v.optional(v.number()),
  totalUnitCount: v.optional(v.number()),
  reasoningUnitCount: v.optional(v.number()),
  cachedInputUnitCount: v.optional(v.number()),
  cacheWriteUnitCount: v.optional(v.number()),
  currency: v.literal("USD"),
  costUsd: v.optional(v.number()),
  costUsdNano: v.optional(v.number()),
  billingStatus: v.union(v.literal("REPORTED"), v.literal("UNKNOWN")),
  usageSource: v.union(v.literal("RESPONSE"), v.literal("GENERATION_LOOKUP")),
};
export const finishFields = {
  ...usageFields,
  status,
  httpStatus: v.optional(v.number()),
};
export interface ProviderUsage {
  providerGenerationId?: string;
  actualModel?: string;
  isByok?: boolean;
  unitKind: "MODEL_TOKEN";
  inputUnitCount?: number;
  outputUnitCount?: number;
  totalUnitCount?: number;
  reasoningUnitCount?: number;
  cachedInputUnitCount?: number;
  cacheWriteUnitCount?: number;
  currency: "USD";
  costUsd?: number;
  costUsdNano?: number;
  billingStatus: "REPORTED" | "UNKNOWN";
  usageSource: "RESPONSE" | "GENERATION_LOOKUP";
}
export type UsageFinish = ProviderUsage & {
  status: UsageStatus;
  httpStatus?: number;
};
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const count = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
const text = (value: unknown): string | undefined =>
  typeof value === "string" && /^[a-zA-Z0-9_./:-]{1,160}$/.test(value)
    ? value
    : undefined;

/** Provider cost is authoritative. Reasoning/cache counts are subsets, never added to totals. */
export function normalizeUsage(
  body: unknown,
  source: ProviderUsage["usageSource"] = "RESPONSE",
): ProviderUsage {
  const root = record(body),
    usage = source === "RESPONSE" ? record(root.usage) : record(root.data);
  const inputDetails = record(usage.prompt_tokens_details),
    outputDetails = record(usage.completion_tokens_details);
  const rawCost = source === "RESPONSE" ? usage.cost : usage.total_cost;
  const cost =
    typeof rawCost === "number" &&
    Number.isFinite(rawCost) &&
    rawCost >= 0 &&
    Number.isSafeInteger(Math.round(rawCost * 1e9))
      ? rawCost
      : undefined;
  const values = {
    providerGenerationId: text(source === "RESPONSE" ? root.id : usage.id),
    actualModel: text(source === "RESPONSE" ? root.model : usage.model),
    isByok: typeof usage.is_byok === "boolean" ? usage.is_byok : undefined,
    inputUnitCount: count(
      source === "RESPONSE" ? usage.prompt_tokens : usage.native_tokens_prompt,
    ),
    outputUnitCount: count(
      source === "RESPONSE"
        ? usage.completion_tokens
        : usage.native_tokens_completion,
    ),
    totalUnitCount: count(usage.total_tokens),
    reasoningUnitCount: count(
      source === "RESPONSE"
        ? outputDetails.reasoning_tokens
        : usage.native_tokens_reasoning,
    ),
    cachedInputUnitCount: count(
      source === "RESPONSE"
        ? inputDetails.cached_tokens
        : usage.native_tokens_cached,
    ),
    cacheWriteUnitCount: count(inputDetails.cache_write_tokens),
    costUsd: cost,
    costUsdNano: cost === undefined ? undefined : Math.round(cost * 1e9),
  };
  return {
    ...Object.fromEntries(
      Object.entries(values).filter(([, value]) => value !== undefined),
    ),
    unitKind: "MODEL_TOKEN",
    currency: "USD",
    billingStatus: cost === undefined ? "UNKNOWN" : "REPORTED",
    usageSource: source,
  };
}

export const metricFields = {
  operationCount: v.number(),
  attemptCount: v.number(),
  successCount: v.number(),
  pendingCount: v.number(),
  knownCostUsdNano: v.number(),
  unknownAttemptCount: v.number(),
  incompleteOperationCount: v.number(),
  completeOperationCount: v.number(),
  completeCostUsdNano: v.number(),
  totalDurationMs: v.number(),
  finishedOperationCount: v.number(),
};
export type Metrics = Record<keyof typeof metricFields, number>;
export const emptyMetrics = (): Metrics => ({
  operationCount: 0,
  attemptCount: 0,
  successCount: 0,
  pendingCount: 0,
  knownCostUsdNano: 0,
  unknownAttemptCount: 0,
  incompleteOperationCount: 0,
  completeOperationCount: 0,
  completeCostUsdNano: 0,
  totalDurationMs: 0,
  finishedOperationCount: 0,
});
export function contribution(op: {
  attemptCount: number;
  knownCostUsdNano: number;
  unknownAttemptCount: number;
  status: UsageStatus;
  durationMs: number;
}): Metrics {
  const pending = op.status === "PENDING",
    complete = !pending && op.unknownAttemptCount === 0;
  return {
    operationCount: 1,
    attemptCount: op.attemptCount,
    successCount: Number(op.status === "SUCCEEDED"),
    pendingCount: Number(pending),
    knownCostUsdNano: op.knownCostUsdNano,
    unknownAttemptCount: op.unknownAttemptCount,
    incompleteOperationCount: Number(!complete),
    completeOperationCount: Number(complete),
    completeCostUsdNano: complete ? op.knownCostUsdNano : 0,
    totalDurationMs: pending ? 0 : op.durationMs,
    finishedOperationCount: Number(!pending),
  };
}
export function addMetrics(
  target: Metrics,
  value: Metrics,
  multiplier = 1,
): Metrics {
  for (const key of Object.keys(metricFields) as (keyof Metrics)[]) {
    target[key] += value[key] * multiplier;
    if (!Number.isSafeInteger(target[key]) || target[key] < 0)
      throw new Error("AI_USAGE_AGGREGATE_INVALID");
  }
  return target;
}

export function reportRange(
  timezone: string,
  now: number,
  input: { period?: "month" | "today"; from?: string; to?: string },
) {
  const offset = timezoneOffsetMinutes(timezone);
  if (!offset.ok) throw new Error("TIMEZONE_UNSUPPORTED");
  const today = toLocal(now, offset.value).date;
  const from =
      input.from ??
      (input.period === "today" ? today : `${today.slice(0, 7)}-01`),
    to = input.to ?? today;
  const first = dayNumber(from),
    last = dayNumber(to);
  if (first === null || last === null || last < first || last - first > 92)
    throw new Error("DATE_RANGE_INVALID");
  const start = first * MS_PER_DAY - offset.value * 60_000,
    end = (last + 1) * MS_PER_DAY - offset.value * 60_000;
  const utcDays = Array.from(
    { length: Math.ceil(end / MS_PER_DAY) - Math.floor(start / MS_PER_DAY) },
    (_, i) => Math.floor(start / MS_PER_DAY) + i,
  );
  return { from, to, start, end, utcDays, timezone };
}

export function estimatedThb(nano: number, fx: number, feePercent: number) {
  const inference = (nano / 1e9) * fx;
  return {
    inference,
    fundingFee: (inference * feePercent) / 100,
    withFundingFee: inference * (1 + feePercent / 100),
  };
}
