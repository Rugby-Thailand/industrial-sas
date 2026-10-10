/**
 * Convex validators for the AI usage ledger. The domain vocabulary and its
 * arithmetic live in `convex/model/aiUsage/`, which has no Convex imports;
 * the compile-time checks below keep both descriptions of each shape equal.
 */
import { v, type Infer } from "convex/values";

import {
  FEATURES,
  USAGE_STATUSES,
  type Feature,
  type ProviderUsage,
  type UsageFinish,
  type UsageStatus,
} from "../model/aiUsage/usage";
import { METRIC_KEYS, type MetricKey } from "../model/aiUsage/metrics";

const literals = <T extends string>(values: readonly T[]) =>
  v.union(...values.map((value) => v.literal(value)));

export const feature = literals<Feature>(FEATURES);
export const status = literals<UsageStatus>(USAGE_STATUSES);

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

export const metricFields = Object.fromEntries(
  METRIC_KEYS.map((key) => [key, v.number()]),
) as Record<MetricKey, ReturnType<typeof v.number>>;

// Both directions: a field added to one description and not the other fails
// the typecheck instead of silently dropping or rejecting data.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const assert = <T extends true>(value: T) => value;
assert<Same<Infer<typeof feature>, Feature>>(true);
assert<Same<Infer<typeof status>, UsageStatus>>(true);
assert<
  Same<Infer<ReturnType<typeof v.object<typeof usageFields>>>, ProviderUsage>
>(true);
assert<
  Same<Infer<ReturnType<typeof v.object<typeof finishFields>>>, UsageFinish>
>(true);
