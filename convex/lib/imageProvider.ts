/**
 * Explicit bounds for the image provider call (BD-07). Every attempt,
 * including reading its response body, ends at `attemptTimeoutMs`; all
 * attempts together end at `totalDeadlineMs`. The only retry is one immediate
 * repeat after an HTTP 5xx answer, and only while a useful budget remains: the
 * extraction writes nothing, so a repeat cannot duplicate data, but it can
 * double provider cost. Timeouts, network errors, 4xx/429, oversized and
 * malformed answers are never retried. `maxRetries: 0` is a valid policy.
 */
export interface ImageProviderPolicy {
  readonly attemptTimeoutMs: number;
  readonly totalDeadlineMs: number;
  readonly maxRetries: number;
  readonly minRetryBudgetMs: number;
  readonly maxResponseBytes: number;
}

export const IMAGE_PROVIDER_POLICY: ImageProviderPolicy = Object.freeze({
  attemptTimeoutMs: 40_000,
  totalDeadlineMs: 55_000,
  maxRetries: 1,
  minRetryBudgetMs: 10_000,
  maxResponseBytes: 256 * 1024,
});

export type ImageProviderFailure =
  "timeout" | "network" | "status" | "too_large" | "malformed";

export type ImageProviderOutcome =
  | {
      readonly ok: true;
      readonly content: string;
      readonly attempts: number;
      readonly elapsedMs: number;
    }
  | {
      readonly ok: false;
      readonly reason: ImageProviderFailure;
      readonly status?: number;
      readonly attempts: number;
      readonly elapsedMs: number;
    };

const ABORTED = Symbol("aborted");
const TOO_LARGE = Symbol("too-large");

/** Settle with ABORTED as soon as `signal` aborts, even if `work` ignores it. */
function untilAborted<T>(
  work: Promise<T>,
  signal: AbortSignal,
): Promise<T | typeof ABORTED> {
  if (signal.aborted) {
    work.catch(() => undefined);
    return Promise.resolve(ABORTED);
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => resolve(ABORTED);
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        if (signal.aborted) resolve(ABORTED);
        else reject(error);
      },
    );
  });
}

function discardBody(response: Response) {
  try {
    void response.body?.cancel().catch(() => undefined);
  } catch {
    // Already consumed or locked; nothing else to release.
  }
}

/** Read at most `maxBytes` of the body before the attempt deadline. */
async function readBoundedBody(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<string | typeof ABORTED | typeof TOO_LARGE> {
  const declared = Number(response.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    discardBody(response);
    return TOO_LARGE;
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const next = await untilAborted(reader.read(), signal);
    if (next === ABORTED) {
      void reader.cancel().catch(() => undefined);
      return ABORTED;
    }
    if (next.done) break;
    total += next.value.byteLength;
    if (total > maxBytes) {
      void reader.cancel().catch(() => undefined);
      return TOO_LARGE;
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** First choice's message content, "" when absent, or null if not JSON. */
function envelopeContent(text: string): string | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (body === null || typeof body !== "object") return null;
  const content = (body as { choices?: { message?: { content?: unknown } }[] })
    .choices?.[0]?.message?.content;
  return typeof content === "string" ? content : "";
}

/**
 * Call the provider through `send` within {@link ImageProviderPolicy}.
 * Returns the model's message content or a static failure reason; it never
 * returns or throws the provider's response body.
 */
export async function requestImageProvider(
  send: (signal: AbortSignal) => Promise<Response>,
  options: {
    readonly policy?: ImageProviderPolicy;
    readonly now?: () => number;
  } = {},
): Promise<ImageProviderOutcome> {
  const policy = options.policy ?? IMAGE_PROVIDER_POLICY;
  const now = options.now ?? Date.now;
  const started = now();
  const elapsed = () => Math.max(0, now() - started);
  // The independent total timer is the hard bound. Wall-clock readings are
  // used only for diagnostics and conservative retry budgeting; clock rollback
  // must never extend the operation. Compose signals without assuming the
  // runtime implements AbortSignal.any.
  const totalController = new AbortController();
  const totalTimer = setTimeout(
    () => totalController.abort(),
    policy.totalDeadlineMs,
  );
  let attempts = 0;
  const fail = (
    reason: ImageProviderFailure,
    status?: number,
  ): ImageProviderOutcome => ({
    ok: false,
    reason,
    ...(status === undefined ? {} : { status }),
    attempts,
    elapsedMs: elapsed(),
  });
  try {
    for (;;) {
      const budget = Math.min(
        policy.attemptTimeoutMs,
        policy.totalDeadlineMs - elapsed(),
      );
      if (budget <= 0 || totalController.signal.aborted) return fail("timeout");
      attempts += 1;
      const controller = new AbortController();
      const abortAttempt = () => controller.abort();
      totalController.signal.addEventListener("abort", abortAttempt, {
        once: true,
      });
      const timer = setTimeout(() => controller.abort(), budget);
      try {
        let response: Response | typeof ABORTED;
        try {
          response = await untilAborted(
            send(controller.signal),
            controller.signal,
          );
        } catch {
          return fail("network");
        }
        if (response === ABORTED) return fail("timeout");
        if (!response.ok) {
          discardBody(response);
          const retry =
            !totalController.signal.aborted &&
            response.status >= 500 &&
            response.status <= 599 &&
            attempts <= policy.maxRetries &&
            policy.totalDeadlineMs - elapsed() >= policy.minRetryBudgetMs;
          if (retry) continue;
          return fail("status", response.status);
        }
        let text: string | typeof ABORTED | typeof TOO_LARGE;
        try {
          text = await readBoundedBody(
            response,
            policy.maxResponseBytes,
            controller.signal,
          );
        } catch {
          return fail("network");
        }
        if (text === ABORTED) return fail("timeout");
        if (text === TOO_LARGE) return fail("too_large");
        const content = envelopeContent(text);
        if (content === null) return fail("malformed");
        return { ok: true, content, attempts, elapsedMs: elapsed() };
      } finally {
        clearTimeout(timer);
        totalController.signal.removeEventListener("abort", abortAttempt);
      }
    }
  } finally {
    clearTimeout(totalTimer);
  }
}
