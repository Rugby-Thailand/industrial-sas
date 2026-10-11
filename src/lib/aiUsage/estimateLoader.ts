import {
  ESTIMATE_CACHE_VERSION,
  ESTIMATE_REVALIDATE_SECONDS,
  FUNDING_SOURCE_URL,
  FX_SOURCE_URL,
  MAX_SOURCE_BYTES,
  parseFundingPolicy,
  parseFxQuote,
  revalidateFundingPolicy,
  revalidateFxQuote,
  sourceState,
  type FundingPolicy,
  type FxQuote,
  type UsageEstimate,
} from "./estimateSources";

/** The deadline of one upstream request, body included. */
export const SOURCE_TIMEOUT_MS = 4000;
/** After a failed refresh, this process makes no new request for a while. */
export const FAILURE_BACKOFF_MS = 10 * 60_000;
export const ESTIMATE_CACHE_TAG = "ai-usage-estimate";

/**
 * The persistent cache: Next.js `unstable_cache` in production. A rejected
 * callback is not stored, so a failure is never cached as data.
 */
export type PersistentCache = <T>(
  load: () => Promise<T>,
  keyParts: string[],
  options: { revalidate: number; tags: string[] },
) => () => Promise<T>;

export interface EstimateLoaderDependencies {
  readonly fetch: typeof fetch;
  readonly now: () => number;
  readonly cache: PersistentCache;
  /** Defaults to {@link SOURCE_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
}

class SourceError extends Error {
  constructor(readonly code: "BACKOFF" | "UPSTREAM" | "INVALID" | "TIMEOUT") {
    super(`AI_USAGE_ESTIMATE_${code}`);
  }
}

/**
 * One request at a time per source within a process, and no new request
 * during the back-off that follows a failure. Across processes the shared
 * persistent cache bounds refreshes to about one per day.
 */
function guarded<T>(task: () => Promise<T>, now: () => number) {
  let inFlight: Promise<T> | null = null,
    retryAt = 0;
  return (): Promise<T> => {
    if (inFlight) return inFlight;
    if (now() < retryAt) return Promise.reject(new SourceError("BACKOFF"));
    const run = task().then(
      (value) => {
        retryAt = 0;
        return value;
      },
      (error: unknown) => {
        retryAt = now() + FAILURE_BACKOFF_MS;
        throw error;
      },
    );
    inFlight = run;
    const clear = () => {
      if (inFlight === run) inFlight = null;
    };
    run.then(clear, clear);
    return run;
  };
}

async function readBounded(
  fetcher: typeof fetch,
  url: string,
  accept: string,
  timeoutMs: number,
): Promise<string> {
  let response: Response;
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    response = await fetcher(url, {
      headers: { accept },
      cache: "no-store",
      redirect: "follow",
      signal,
    });
  } catch {
    throw new SourceError(signal.aborted ? "TIMEOUT" : "UPSTREAM");
  }
  const declared = Number(response.headers.get("content-length"));
  if (
    !response.ok ||
    (Number.isFinite(declared) && declared > MAX_SOURCE_BYTES)
  ) {
    void response.body?.cancel().catch(() => undefined);
    throw new SourceError(response.ok ? "INVALID" : "UPSTREAM");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0,
    text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      bytes += value.byteLength;
      if (bytes > MAX_SOURCE_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new SourceError("INVALID");
      }
      text += decoder.decode(value, { stream: true });
    }
  } catch (error) {
    if (error instanceof SourceError) throw error;
    throw new SourceError(signal.aborted ? "TIMEOUT" : "UPSTREAM");
  } finally {
    reader.releaseLock();
  }
}

/**
 * Loads one estimate snapshot. Each source is cached independently for one
 * day, so one failing source never discards the other. A missing or invalid
 * source is UNAVAILABLE; a cached value past its refresh window is STALE.
 * No rate or fee is ever assumed, and no tenant data enters the cache.
 */
export function createEstimateLoader(
  deps: EstimateLoaderDependencies,
): () => Promise<UsageEstimate> {
  const timeoutMs = deps.timeoutMs ?? SOURCE_TIMEOUT_MS;
  const fetchFx = guarded(async (): Promise<FxQuote> => {
    const text = await readBounded(
      deps.fetch,
      FX_SOURCE_URL,
      "application/json",
      timeoutMs,
    );
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new SourceError("INVALID");
    }
    const quote = parseFxQuote(payload, deps.now());
    if (!quote) throw new SourceError("INVALID");
    return quote;
  }, deps.now);
  const fetchFunding = guarded(async (): Promise<FundingPolicy> => {
    const text = await readBounded(
      deps.fetch,
      FUNDING_SOURCE_URL,
      "text/markdown, text/plain",
      timeoutMs,
    );
    const policy = parseFundingPolicy(text, deps.now());
    if (!policy) throw new SourceError("INVALID");
    return policy;
  }, deps.now);
  const options = {
    revalidate: ESTIMATE_REVALIDATE_SECONDS,
    tags: [ESTIMATE_CACHE_TAG],
  };
  const cachedFx = deps.cache(
    fetchFx,
    [ESTIMATE_CACHE_TAG, "fx-usd-thb", `v${ESTIMATE_CACHE_VERSION}`],
    options,
  );
  const cachedFunding = deps.cache(
    fetchFunding,
    [
      ESTIMATE_CACHE_TAG,
      "openrouter-card-funding",
      `v${ESTIMATE_CACHE_VERSION}`,
    ],
    options,
  );
  const settle = async <T>(
    read: () => Promise<unknown>,
    check: (value: unknown) => T | null,
  ): Promise<T | null> => {
    try {
      return check(await read());
    } catch {
      return null;
    }
  };
  return async () => {
    const [fx, funding] = await Promise.all([
      settle(cachedFx, revalidateFxQuote),
      settle(cachedFunding, revalidateFundingPolicy),
    ]);
    const now = deps.now();
    return Object.freeze({
      version: ESTIMATE_CACHE_VERSION,
      loadedAt: now,
      fx: sourceState(fx, now),
      funding: sourceState(funding, now),
    });
  };
}
