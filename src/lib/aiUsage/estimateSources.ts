/**
 * Public inputs of the AI usage baht estimate: the USD/THB reference rate and
 * OpenRouter's published card funding policy. Both are global, public facts
 * (no tenant data), loaded server-side and cached for one day. Everything
 * here is pure: parsing never executes upstream content, and any value that
 * fails validation is refused rather than replaced by an assumed one.
 */

/** Bumped whenever the cached shape or parsing rules change. */
export const ESTIMATE_CACHE_VERSION = 1;
/** One day: how long a successfully loaded source is reused. */
export const ESTIMATE_REVALIDATE_SECONDS = 86400;
/**
 * A source older than this was not refreshed on schedule (the refresh is
 * pending or failed) and is labelled stale. One hour of grace covers the
 * background refresh that follows the first request after expiry.
 */
export const ESTIMATE_STALE_AFTER_MS =
  (ESTIMATE_REVALIDATE_SECONDS + 3600) * 1000;

export const FX_SOURCE_URL = "https://api.frankfurter.dev/v2/rate/usd/thb";
export const FX_SOURCE_DOCS = "https://frankfurter.dev/";
export const FUNDING_SOURCE_URL = "https://openrouter.ai/docs/faq.md";
export const FUNDING_SOURCE_DOCS = "https://openrouter.ai/docs/faq";

/** Largest upstream body read; both documents are far smaller. */
export const MAX_SOURCE_BYTES = 512 * 1024;

export interface FxQuote {
  /** THB per 1 USD as published. */
  readonly rate: number;
  /** The publisher's rate date (YYYY-MM-DD); it can trail weekends. */
  readonly date: string;
  /** When this server fetched and validated it (epoch ms). */
  readonly fetchedAt: number;
}

export interface FundingPolicy {
  /** Card (Stripe) credit purchase fee, percent. */
  readonly percent: number;
  /** Minimum fee per card purchase, USD. */
  readonly minimumUsd: number;
  readonly fetchedAt: number;
}

export type SourceState<T> =
  | { readonly status: "READY" | "STALE"; readonly value: T }
  | { readonly status: "UNAVAILABLE" };

/** One frozen estimate snapshot, as shown and exported. */
export interface UsageEstimate {
  readonly version: typeof ESTIMATE_CACHE_VERSION;
  /** When this snapshot was assembled for the page (epoch ms). */
  readonly loadedAt: number;
  readonly fx: SourceState<FxQuote>;
  readonly funding: SourceState<FundingPolicy>;
}

const DAY_MS = 86_400_000;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** A real calendar date, not after the day following `notAfter`. */
function validDate(value: unknown, notAfter: number): value is string {
  if (typeof value !== "string") return false;
  const match = DATE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const time = Date.UTC(y, m - 1, d);
  const back = new Date(time);
  return (
    back.getUTCFullYear() === y &&
    back.getUTCMonth() === m - 1 &&
    back.getUTCDate() === d &&
    y >= 1999 &&
    time <= notAfter + DAY_MS
  );
}

const validFetchedAt = (value: unknown): value is number =>
  finite(value) && Number.isInteger(value) && value > 0;

/**
 * The Frankfurter `/v2/rate/usd/thb` answer, e.g.
 * `{"date":"2026-10-11","base":"USD","quote":"THB","rate":33.583}`.
 * Null unless it is exactly USD→THB with a finite, plausible rate and a
 * valid date.
 */
export function parseFxQuote(
  payload: unknown,
  fetchedAt: number,
): FxQuote | null {
  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    !validFetchedAt(fetchedAt)
  )
    return null;
  const record = payload as Record<string, unknown>;
  if (record.base !== "USD" || record.quote !== "THB") return null;
  const rate = record.rate;
  if (!finite(rate) || rate <= 0 || rate >= 1000) return null;
  if (!validDate(record.date, fetchedAt)) return null;
  return Object.freeze({ rate, date: record.date, fetchedAt });
}

const STRIPE_BRANCH =
  /if\s*\(\s*type\s*===\s*(['"])stripe\1\s*\)\s*return\s*(['"])(\d{1,2}(?:\.\d{1,3})?)%\s*\(\$(\d{1,2}(?:\.\d{1,2})?)\s+minimum\)\2\s*;?/g;

/**
 * The card funding policy from the stripe branch of `getTotalFeeString` in
 * OpenRouter's FAQ markdown, read as text and never executed. On 2026-10-11:
 * `if (type === 'stripe') return '5.5% ($0.80 minimum)';`. Null unless the
 * function exists and its stripe branch appears exactly once with a
 * plausible percentage and minimum.
 */
export function parseFundingPolicy(
  markdown: unknown,
  fetchedAt: number,
): FundingPolicy | null {
  if (
    typeof markdown !== "string" ||
    markdown.length > MAX_SOURCE_BYTES ||
    !validFetchedAt(fetchedAt)
  )
    return null;
  const start = markdown.search(
    /export\s+const\s+getTotalFeeString\s*=\s*\(\s*type\s*,\s*value\s*\)\s*=>\s*\{/,
  );
  if (start < 0) return null;
  const end = markdown.indexOf("\n};", start);
  if (end < 0 || end - start > 2000) return null;
  const body = markdown.slice(start, end);
  const matches = [...body.matchAll(STRIPE_BRANCH)];
  if (matches.length !== 1) return null;
  const percent = Number(matches[0]![3]),
    minimumUsd = Number(matches[0]![4]);
  if (!finite(percent) || percent <= 0 || percent > 20) return null;
  if (!finite(minimumUsd) || minimumUsd < 0 || minimumUsd > 50) return null;
  return Object.freeze({ percent, minimumUsd, fetchedAt });
}

/** Re-validates a value read back from the cache before it is trusted. */
export function revalidateFxQuote(value: unknown): FxQuote | null {
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return parseFxQuote(
    { base: "USD", quote: "THB", rate: record.rate, date: record.date },
    record.fetchedAt as number,
  );
}

export function revalidateFundingPolicy(value: unknown): FundingPolicy | null {
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const { percent, minimumUsd, fetchedAt } = record;
  if (
    !validFetchedAt(fetchedAt) ||
    !finite(percent) ||
    percent <= 0 ||
    percent > 20 ||
    !finite(minimumUsd) ||
    minimumUsd < 0 ||
    minimumUsd > 50
  )
    return null;
  return Object.freeze({ percent, minimumUsd, fetchedAt });
}

/** READY, or STALE when the value outlived its refresh window. */
export function sourceState<T extends { readonly fetchedAt: number }>(
  value: T | null,
  now: number,
): SourceState<T> {
  if (!value) return Object.freeze({ status: "UNAVAILABLE" });
  return Object.freeze({
    status: now - value.fetchedAt > ESTIMATE_STALE_AFTER_MS ? "STALE" : "READY",
    value,
  });
}

/**
 * The snapshot as it reads at `now`: a page left open past a source's
 * refresh window shows that source as STALE. Statuses only ever degrade;
 * the values and their dates are unchanged.
 */
export function withCurrentStatus(
  estimate: UsageEstimate,
  now: number,
): UsageEstimate {
  const age = <T extends { readonly fetchedAt: number }>(
    state: SourceState<T>,
  ): SourceState<T> =>
    state.status === "READY" &&
    now - state.value.fetchedAt > ESTIMATE_STALE_AFTER_MS
      ? Object.freeze({ status: "STALE", value: state.value })
      : state;
  const fx = age(estimate.fx),
    funding = age(estimate.funding);
  return fx === estimate.fx && funding === estimate.funding
    ? estimate
    : Object.freeze({ ...estimate, fx, funding });
}

/** A snapshot with nothing loaded: used when the server could not load. */
export const unavailableEstimate = (loadedAt: number): UsageEstimate =>
  Object.freeze({
    version: ESTIMATE_CACHE_VERSION,
    loadedAt,
    fx: Object.freeze({ status: "UNAVAILABLE" }),
    funding: Object.freeze({ status: "UNAVAILABLE" }),
  });

/** The rate and fee an estimate may use; never an assumed value. */
export function estimateInputs(estimate: UsageEstimate | null): {
  readonly rate: number | null;
  readonly feePercent: number | null;
} {
  const rate =
    estimate && estimate.fx.status !== "UNAVAILABLE"
      ? estimate.fx.value.rate
      : null;
  const feePercent =
    estimate && estimate.funding.status !== "UNAVAILABLE"
      ? estimate.funding.value.percent
      : null;
  return { rate, feePercent };
}
