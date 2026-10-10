/**
 * AI usage accounting values: the provider usage decoder and the vocabulary
 * shared by the ledger, projections and reports.
 *
 * Status: implemented for OpenRouter chat responses (`RESPONSE`) and
 * generation metadata (`GENERATION_LOOKUP`). Pure TypeScript: the Convex
 * validators for these shapes live in `convex/aiUsage/validators.ts`.
 * Cost is integer nano-USD (1 USD = 1e9); the provider's decimal cost is kept
 * alongside it and rounded exactly once, here. Missing cost is `UNKNOWN`,
 * never zero. Not supported: currencies other than USD, and any unit other
 * than model tokens.
 */
import { isRecord } from "../guards";

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
export type UsageSource = "RESPONSE" | "GENERATION_LOOKUP";

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

/**
 * Where a provider caller records usage. The Convex adapter
 * (`convex/lib/aiUsage.ts`) binds it to the authorized tenant scope; the
 * caller names only the feature and model.
 */
export interface AiUsageRecorder {
  begin(feature: Feature, model: string, attemptNo: number): Promise<void>;
  finish(attemptNo: number, result: UsageFinish): Promise<void>;
  /** Close a begun attempt that never sent a request. Best effort. */
  abandon(attemptNo: number): Promise<void>;
}

const record = (value: unknown): Record<string, unknown> =>
  isRecord(value) && !Array.isArray(value) ? value : {};
const count = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
const text = (value: unknown): string | undefined =>
  typeof value === "string" && /^[a-zA-Z0-9_./:-]{1,160}$/.test(value)
    ? value
    : undefined;

/** Exact nano-USD for a provider cost, or undefined when it is not a valid price. */
export function costToNano(cost: unknown): number | undefined {
  if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0)
    return undefined;
  const nano = Math.round(cost * NANO_PER_USD);
  return Number.isSafeInteger(nano) ? nano : undefined;
}

/**
 * Whitelisted usage of one provider body; never throws. Provider cost is
 * authoritative. Reasoning/cache counts are subsets, never added to totals.
 * The result is a new frozen record; the body is not retained.
 */
export function normalizeUsage(
  body: unknown,
  source: UsageSource = "RESPONSE",
): ProviderUsage {
  const lookup = source === "GENERATION_LOOKUP";
  const root = record(body),
    usage = lookup ? record(root.data) : record(root.usage);
  const inputDetails = record(usage.prompt_tokens_details),
    outputDetails = record(usage.completion_tokens_details);
  const rawCost = lookup ? usage.total_cost : usage.cost;
  const costUsdNano = costToNano(rawCost);
  const values: Record<string, unknown> = {
    providerGenerationId: text(lookup ? usage.id : root.id),
    actualModel: text(lookup ? usage.model : root.model),
    isByok: typeof usage.is_byok === "boolean" ? usage.is_byok : undefined,
    inputUnitCount: count(
      lookup ? usage.native_tokens_prompt : usage.prompt_tokens,
    ),
    outputUnitCount: count(
      lookup ? usage.native_tokens_completion : usage.completion_tokens,
    ),
    totalUnitCount: count(usage.total_tokens),
    reasoningUnitCount: count(
      lookup ? usage.native_tokens_reasoning : outputDetails.reasoning_tokens,
    ),
    cachedInputUnitCount: count(
      lookup ? usage.native_tokens_cached : inputDetails.cached_tokens,
    ),
    cacheWriteUnitCount: count(inputDetails.cache_write_tokens),
    costUsd: costUsdNano === undefined ? undefined : rawCost,
    costUsdNano,
  };
  const present = Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  );
  return Object.freeze({
    ...present,
    unitKind: "MODEL_TOKEN" as const,
    currency: "USD" as const,
    billingStatus:
      costUsdNano === undefined ? ("UNKNOWN" as const) : ("REPORTED" as const),
    usageSource: source,
  });
}
