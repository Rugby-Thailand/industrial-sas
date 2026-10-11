/**
 * OpenRouter usage decoding: the adapter boundary where a provider body
 * becomes a validated domain usage record (`model/aiUsage/usage.ts`).
 *
 * This is the only place the provider's decimal USD cost is converted, and
 * rounded, to integer nano-USD (1 USD = 1e9, nearest nano). The raw decimal
 * is kept beside it as `costUsd` for audit. A missing, negative, non-finite,
 * non-numeric or unrepresentable cost is `UNKNOWN`, never zero; an explicit
 * `0` is a reported free call. Only whitelisted billing fields leave this
 * module: no message content, prompt, image or other body text is copied.
 */
import { isRecord } from "../model/guards";
import { fail, type Result } from "../model/result";
import {
  isUsageSource,
  NANO_PER_USD,
  readProviderUsage,
  UNKNOWN_USAGE,
  type ProviderUsage,
  type UsageSource,
  type UsageValueError,
} from "../model/aiUsage/usage";

export type UsageDecodeError =
  { readonly code: "AI_USAGE_SOURCE_INVALID" } | UsageValueError;

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

/**
 * Nano-USD for a provider's decimal cost, rounded to the nearest nano, or
 * undefined when it is not a valid, representable price.
 */
export function providerCostToNano(cost: unknown): number | undefined {
  if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0)
    return undefined;
  const nano = Math.round(cost * NANO_PER_USD);
  return Number.isSafeInteger(nano) ? nano : undefined;
}

/**
 * Whitelisted usage of one provider body, decoded as a chat response
 * (`RESPONSE`) or generation metadata (`GENERATION_LOOKUP`). The source is
 * validated: a forged mode is a structured error, never a stored value.
 * Malformed or missing provider fields are dropped (cost becomes UNKNOWN);
 * reasoning/cache counts are subsets and never added to totals. The body is
 * not retained and nothing throws.
 */
export function decodeProviderUsage(
  body: unknown,
  source: UsageSource,
): Result<ProviderUsage, UsageDecodeError> {
  if (!isUsageSource(source))
    return fail({ code: "AI_USAGE_SOURCE_INVALID" as const });
  const lookup = source === "GENERATION_LOOKUP";
  const root = record(body),
    usage = lookup ? record(root.data) : record(root.usage);
  const inputDetails = record(usage.prompt_tokens_details),
    outputDetails = record(usage.completion_tokens_details);
  const rawCost = lookup ? usage.total_cost : usage.cost;
  const costUsdNano = providerCostToNano(rawCost);
  return readProviderUsage({
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
    unitKind: "MODEL_TOKEN",
    currency: "USD",
    billingStatus: costUsdNano === undefined ? "UNKNOWN" : "REPORTED",
    usageSource: source,
  });
}

/** A chat response's usage; unreadable accounting is UNKNOWN. */
export function responseUsage(body: unknown): ProviderUsage {
  const decoded = decodeProviderUsage(body, "RESPONSE");
  return decoded.ok ? decoded.value : UNKNOWN_USAGE;
}
