/**
 * AI usage accounting values: the vocabulary shared by the ledger,
 * projections and reports, and the validated provider usage record.
 *
 * Status: implemented. Pure TypeScript with no floating arithmetic and no
 * rounding: the provider body decoder, which turns OpenRouter's decimal USD
 * cost into integer nano-USD (1 USD = 1e9), is the adapter
 * `convex/lib/providerUsage.ts`, and the Convex validators for these shapes
 * live in `convex/aiUsage/validators.ts`. This module owns the vocabulary
 * and `readProviderUsage`, the validated frozen constructor every decoded
 * record passes through. Missing cost is `UNKNOWN`, never zero. Not
 * supported: currencies other than USD, and any unit other than model tokens.
 */
import { isRecord, isSafeInt, isString } from "../guards";
import { fail, ok, type Result } from "../result";

export const FEATURES = Object.freeze([
  "JOB_TICKET_SCAN",
  "LOCATION_LABEL_SCAN",
  "AI_SEARCH",
] as const);
export type Feature = (typeof FEATURES)[number];
export const isFeature = (value: unknown): value is Feature =>
  (FEATURES as readonly unknown[]).includes(value);

export const USAGE_STATUSES = Object.freeze([
  "PENDING",
  "SUCCEEDED",
  "UNREADABLE",
  "PROVIDER_ERROR",
  "TIMEOUT",
  "NETWORK_ERROR",
  "INTERRUPTED",
] as const);
export type UsageStatus = (typeof USAGE_STATUSES)[number];
export const isUsageStatus = (value: unknown): value is UsageStatus =>
  (USAGE_STATUSES as readonly unknown[]).includes(value);

export type BillingStatus = "REPORTED" | "UNKNOWN";
export const USAGE_SOURCES = Object.freeze([
  "RESPONSE",
  "GENERATION_LOOKUP",
] as const);
export type UsageSource = (typeof USAGE_SOURCES)[number];
export const isUsageSource = (value: unknown): value is UsageSource =>
  (USAGE_SOURCES as readonly unknown[]).includes(value);

/** The most provider attempts one operation may have (one 5xx retry). */
export const MAX_ATTEMPTS = 2;

export const NANO_PER_USD = 1_000_000_000;

export interface ProviderUsage {
  readonly providerGenerationId?: string;
  readonly actualModel?: string;
  readonly isByok?: boolean;
  readonly unitKind: "MODEL_TOKEN";
  readonly inputUnitCount?: number;
  readonly outputUnitCount?: number;
  readonly totalUnitCount?: number;
  readonly reasoningUnitCount?: number;
  readonly cachedInputUnitCount?: number;
  readonly cacheWriteUnitCount?: number;
  readonly currency: "USD";
  readonly costUsd?: number;
  readonly costUsdNano?: number;
  readonly billingStatus: BillingStatus;
  readonly usageSource: UsageSource;
}

export type UsageFinish = ProviderUsage & {
  readonly status: UsageStatus;
  readonly httpStatus?: number;
};

/** Usage of an attempt with no readable provider accounting. */
export const UNKNOWN_USAGE: ProviderUsage = Object.freeze({
  unitKind: "MODEL_TOKEN",
  currency: "USD",
  billingStatus: "UNKNOWN",
  usageSource: "RESPONSE",
});

export type UsageValueError = {
  readonly code: "AI_USAGE_VALUE_INVALID";
  readonly field: string;
};
const invalid = (field: string) =>
  fail({ code: "AI_USAGE_VALUE_INVALID" as const, field });

/**
 * Where a provider caller records usage. The Convex adapter
 * (`convex/lib/aiUsage.ts`) binds it to the authorized tenant scope; the
 * caller names only the feature and model.
 */
export interface AiUsageRecorder {
  begin(feature: Feature, model: string, attemptNo: number): Promise<void>;
  /**
   * Finalize a sent attempt. Settles within the adapter's finite accounting
   * budget, written or not; it never repeats the provider request.
   */
  finish(attemptNo: number, result: UsageFinish): Promise<void>;
  /** Close a begun attempt that never sent a request. Best effort, bounded. */
  abandon(attemptNo: number): Promise<void>;
  /**
   * The whitelisted usage of one provider response body. Decoding the
   * provider's decimal cost belongs to the adapter, not to this layer.
   */
  responseUsage(body: unknown): ProviderUsage;
}

const isCount = (value: unknown): value is number =>
  isSafeInt(value) && value >= 0;
const isLabel = (value: unknown): value is string =>
  isString(value) && /^[a-zA-Z0-9_./:-]{1,160}$/.test(value);

const COUNT_FIELDS = Object.freeze([
  "inputUnitCount",
  "outputUnitCount",
  "totalUnitCount",
  "reasoningUnitCount",
  "cachedInputUnitCount",
  "cacheWriteUnitCount",
] as const);
const USAGE_KEYS: ReadonlySet<string> = new Set([
  ...COUNT_FIELDS,
  "providerGenerationId",
  "actualModel",
  "isByok",
  "unitKind",
  "currency",
  "costUsd",
  "costUsdNano",
  "billingStatus",
  "usageSource",
]);

/**
 * Validate one whitelisted usage record and return a frozen copy, or name
 * the first field that is wrong. Integer nano-USD is the authoritative
 * amount; `costUsd` is the provider's decimal exactly as reported, kept for
 * audit and never used in arithmetic here. A record with a cost is
 * `REPORTED`; one without is `UNKNOWN`, never zero. Unknown keys are
 * refused, so nothing outside the whitelist can ride along.
 */
export function readProviderUsage(
  value: unknown,
): Result<ProviderUsage, UsageValueError> {
  if (!isRecord(value) || Array.isArray(value)) return invalid("usage");
  for (const key of Object.keys(value))
    if (!USAGE_KEYS.has(key)) return invalid(key);
  if (value.unitKind !== "MODEL_TOKEN") return invalid("unitKind");
  if (value.currency !== "USD") return invalid("currency");
  if (!isUsageSource(value.usageSource)) return invalid("usageSource");
  for (const field of ["providerGenerationId", "actualModel"] as const)
    if (value[field] !== undefined && !isLabel(value[field]))
      return invalid(field);
  if (value.isByok !== undefined && typeof value.isByok !== "boolean")
    return invalid("isByok");
  for (const field of COUNT_FIELDS)
    if (value[field] !== undefined && !isCount(value[field]))
      return invalid(field);
  if (value.costUsdNano !== undefined && !isCount(value.costUsdNano))
    return invalid("costUsdNano");
  if (
    value.costUsd !== undefined &&
    (typeof value.costUsd !== "number" ||
      !Number.isFinite(value.costUsd) ||
      value.costUsd < 0)
  )
    return invalid("costUsd");
  if ((value.costUsd === undefined) !== (value.costUsdNano === undefined))
    return invalid("costUsdNano");
  const reported = value.costUsdNano !== undefined;
  if (value.billingStatus !== (reported ? "REPORTED" : "UNKNOWN"))
    return invalid("billingStatus");
  return ok(
    Object.freeze(
      Object.fromEntries(
        Object.entries(value).filter(([, field]) => field !== undefined),
      ),
    ) as unknown as ProviderUsage,
  );
}
