import {
  UNKNOWN_USAGE,
  type Feature,
  type UsageFinish,
} from "../model/aiUsage/usage";
import { ACCOUNTING_WRITE_BUDGET_MS, type AiUsagePort } from "./aiUsage";
import { responseUsage } from "./providerUsage";

/**
 * Explicit bounds for the image provider call (BD-07). Every attempt,
 * including reading its response body, ends at `attemptTimeoutMs`; all
 * attempts together end at `totalDeadlineMs`. The only retry is one immediate
 * repeat after an HTTP 5xx answer, and only while a useful budget remains: the
 * extraction writes nothing, so a repeat cannot duplicate data, but it can
 * double provider cost. Timeouts, network errors, 4xx/429, and oversized or
 * malformed successful answers are never retried; a 5xx answer's body never
 * affects its retry. `maxRetries: 0` is a valid policy. These are provider
 * bounds; a tracked call's accounting writes have their own finite window
 * (see {@link requestImageProvider}).
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

/** The provider body as JSON for usage decoding only, or null. */
function usageBody(text: string | typeof ABORTED | typeof TOO_LARGE): unknown {
  if (typeof text !== "string") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * The default bound on each accounting wait of a tracked call. It exceeds
 * the port's own {@link ACCOUNTING_WRITE_BUDGET_MS}, so the real port
 * settles (and logs an unconfirmed finalization) first; this is the
 * backstop for a port that never settles.
 */
export const ACCOUNTING_WINDOW_MS = ACCOUNTING_WRITE_BUDGET_MS + 1_000;

/**
 * Usage recording for one tracked operation. The feature is explicit: the
 * helper serves several paid image features and must not assume one.
 */
export interface ImageProviderTracking {
  readonly port: Pick<AiUsagePort, "begin" | "finish" | "abandon">;
  readonly feature: Feature;
  readonly model: string;
  /** Bound on each finish/abandon wait; defaults to {@link ACCOUNTING_WINDOW_MS}. */
  readonly accountingWindowMs?: number;
}

/**
 * Call the provider through `send` within {@link ImageProviderPolicy}.
 * Returns the model's message content or a static failure reason; it never
 * returns or throws the provider's response body.
 *
 * With `tracking`, each attempt is durably begun before its request, and no
 * request starts once the total deadline has passed: a begin that is still
 * unsettled at the deadline sends nothing (a row it commits later expires),
 * and a begin that settles too late is abandoned. Each sent attempt is
 * finalized once, with its own usage; a 5xx error body is read (bounded) only
 * for usage and never decides whether the retry happens.
 *
 * Two separate bounds apply. `policy.totalDeadlineMs` is the provider
 * deadline: it bounds begins, requests and response bodies, and no request
 * starts after it. Accounting (each finish or abandon) is awaited, never
 * fire-and-forget, but every such wait ends within the accounting window,
 * written or not, and the whole call returns by `totalDeadlineMs +
 * accountingWindowMs`. Nothing in the accounting window sends, retries or
 * replays inference, and an accounting timeout never changes the provider
 * outcome: a successful answer is still returned. A finalization the port
 * could not confirm is logged by the port with its whitelisted response
 * metadata; its pending row otherwise expires to `INTERRUPTED`.
 */
export async function requestImageProvider(
  send: (signal: AbortSignal) => Promise<Response>,
  options: {
    readonly policy?: ImageProviderPolicy;
    readonly now?: () => number;
    readonly tracking?: ImageProviderTracking;
    readonly validateContent?: (content: string) => boolean;
  } = {},
): Promise<ImageProviderOutcome> {
  const policy = options.policy ?? IMAGE_PROVIDER_POLICY;
  const tracking = options.tracking;
  const now = options.now ?? Date.now;
  const started = now();
  const elapsed = () => Math.max(0, now() - started);
  const remaining = () => policy.totalDeadlineMs - elapsed();
  // The independent total timer is the hard bound on inference: begins,
  // requests and bodies. Accounting has its own window below. Wall-clock readings are
  // used only for diagnostics and conservative retry budgeting; clock rollback
  // must never extend the operation. Compose signals without assuming the
  // runtime implements AbortSignal.any.
  const totalController = new AbortController();
  const total = totalController.signal;
  const totalTimer = setTimeout(
    () => totalController.abort(),
    policy.totalDeadlineMs,
  );
  const window = tracking?.accountingWindowMs;
  const accountingWindowMs =
    typeof window === "number" && Number.isFinite(window) && window >= 0
      ? window
      : ACCOUNTING_WINDOW_MS;
  // The hard end of the whole call, accounting included.
  const hardController = new AbortController();
  const hardTimer = tracking
    ? setTimeout(
        () => hardController.abort(),
        policy.totalDeadlineMs + accountingWindowMs,
      )
    : undefined;
  /** Await one accounting write for at most the accounting window. */
  const account = async (write: () => Promise<void>): Promise<void> => {
    const controller = new AbortController();
    const stop = () => controller.abort();
    const timer = setTimeout(stop, accountingWindowMs);
    hardController.signal.addEventListener("abort", stop, { once: true });
    if (hardController.signal.aborted) stop();
    try {
      let pending: Promise<void>;
      try {
        pending = write();
      } catch {
        return;
      }
      await untilAborted(
        pending.catch(() => undefined),
        controller.signal,
      );
    } finally {
      clearTimeout(timer);
      hardController.signal.removeEventListener("abort", stop);
    }
  };
  /** Requests actually sent. */
  let attempts = 0;
  /** The 5xx status of the previous attempt while a retry is pending. */
  let retryOf: number | undefined;
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
  // A retry that cannot start answers with the status that asked for it.
  const giveUp = () =>
    retryOf === undefined ? fail("timeout") : fail("status", retryOf);
  const startable = () =>
    !total.aborted &&
    remaining() > 0 &&
    (retryOf === undefined || remaining() >= policy.minRetryBudgetMs);
  try {
    for (;;) {
      if (!startable()) return giveUp();
      const attemptNo = attempts + 1;
      if (tracking) {
        const begun = await untilAborted(
          tracking.port.begin(tracking.feature, tracking.model, attemptNo),
          total,
        );
        // Unsettled at the deadline: nothing was sent and nothing is awaited.
        if (begun === ABORTED) return giveUp();
        if (!startable()) {
          await account(() => tracking.port.abandon(attemptNo));
          return giveUp();
        }
      }
      // Checked synchronously above: no timer can fire before `send` starts.
      attempts = attemptNo;
      const budget = Math.min(policy.attemptTimeoutMs, remaining());
      let usageResult: UsageFinish = {
        ...UNKNOWN_USAGE,
        status: "NETWORK_ERROR",
      };
      const controller = new AbortController();
      const abortAttempt = () => controller.abort();
      total.addEventListener("abort", abortAttempt, { once: true });
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
        if (response === ABORTED) {
          usageResult = { ...usageResult, status: "TIMEOUT" };
          return fail("timeout");
        }
        let text: string | typeof ABORTED | typeof TOO_LARGE;
        try {
          text = await readBoundedBody(
            response,
            policy.maxResponseBytes,
            controller.signal,
          );
        } catch {
          text = ABORTED;
          if (response.ok) {
            usageResult = { ...usageResult, httpStatus: response.status };
            return fail("network");
          }
        }
        if (!response.ok) {
          // The error body is evidence of cost only. Oversized, malformed,
          // stalled or broken bodies record unknown cost, and never suppress
          // a retry that the status and remaining budget allow.
          usageResult = {
            ...responseUsage(usageBody(text)),
            httpStatus: response.status,
            status: "PROVIDER_ERROR",
          };
          const retry =
            response.status >= 500 &&
            response.status <= 599 &&
            attemptNo <= policy.maxRetries;
          if (retry) {
            retryOf = response.status;
            continue;
          }
          return fail("status", response.status);
        }
        if (text === ABORTED) {
          usageResult = {
            ...usageResult,
            httpStatus: response.status,
            status: "TIMEOUT",
          };
          return fail("timeout");
        }
        if (text === TOO_LARGE) {
          usageResult = {
            ...usageResult,
            httpStatus: response.status,
            status: "UNREADABLE",
          };
          return fail("too_large");
        }
        usageResult = {
          ...responseUsage(usageBody(text)),
          httpStatus: response.status,
          status: "UNREADABLE",
        };
        const content = envelopeContent(text);
        if (content === null) return fail("malformed");
        if (!options.validateContent || options.validateContent(content))
          usageResult = { ...usageResult, status: "SUCCEEDED" };
        return { ok: true, content, attempts, elapsedMs: elapsed() };
      } finally {
        clearTimeout(timer);
        total.removeEventListener("abort", abortAttempt);
        // Exactly one finalization per sent attempt; it retries only the
        // database write and never this request, within the accounting
        // window.
        if (tracking)
          await account(() => tracking.port.finish(attemptNo, usageResult));
      }
    }
  } finally {
    clearTimeout(totalTimer);
    clearTimeout(hardTimer);
  }
}
