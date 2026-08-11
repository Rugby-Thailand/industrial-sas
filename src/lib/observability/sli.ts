/**
 * The domain service-level indicators this application can honestly measure
 * today, and the events that carry them.
 *
 * Plan §10 Phase 1 asks for "basic domain SLI plumbing". The temptation is to
 * instrument everything; the useful thing is to instrument the two questions
 * the product has already committed to answering:
 *
 * 1. **Does a ledger read succeed, and why not?** Every distinguishable outcome
 *    of `toLedgerPanelState` becomes a dimension, so "operators see denials"
 *    and "operators see nothing configured" are different lines rather than one
 *    error rate.
 * 2. **How long does a server round trip take?** `ADR-0009` §8 makes p95
 *    scan-to-acknowledge under 800 ms a product requirement, gated on `RG-002`.
 *    There is no scan yet, but the read path is the same round trip, and a
 *    latency series that starts now is worth more than one that starts at the
 *    pilot.
 *
 * ### Buckets, not milliseconds
 *
 * A raw duration is a high-cardinality dimension and, worse, a timing side
 * channel: how long a query took can distinguish "no such document" from "a
 * document you may not see". Bucketing to a fixed ladder answers the SLI
 * question and answers nothing else. The ladder is chosen around the 800 ms
 * target so the bucket boundary an alert would fire on is a real boundary.
 */
import { observabilityEvent, type ObservabilityEvent } from "./event";
import type { ObservabilityPort } from "./port";

/** Every event code this application emits. Code-owned, English (`D-06`). */
export const SLI_CODES = Object.freeze({
  ledgerRead: "ledger.read",
  ledgerReadFailed: "ledger.read.failed",
  clientError: "client.error",
});

/**
 * Upper bounds in milliseconds. The last bucket is everything above the
 * previous bound, reported as `Number.POSITIVE_INFINITY`'s stand-in `-1`.
 */
export const LATENCY_BUCKET_BOUNDS_MS: readonly number[] = Object.freeze([
  100, 250, 500, 800, 1_500, 3_000, 10_000,
]);

/** The bucket a duration falls in, as its upper bound; `-1` above the ladder. */
export function latencyBucketMs(durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs < 0) return -1;
  for (const bound of LATENCY_BUCKET_BOUNDS_MS) {
    if (durationMs <= bound) return bound;
  }
  return -1;
}

/** The outcomes a ledger read can have, matching `LedgerPanelState["kind"]`. */
export type LedgerReadOutcome =
  | "READY"
  | "DENIED"
  | "LEDGER_ERROR"
  | "ERROR"
  | "SIGN_IN_REQUIRED"
  | "BACKEND_MISSING"
  | "WAREHOUSE_MISSING";

/** Which screen asked. A closed set, so it is a safe dimension. */
export type LedgerReadSurface = "balances" | "history";

/**
 * Record the outcome of one ledger read.
 *
 * `rowCount` is deliberately absent. It is a number and would therefore survive
 * redaction, and it is also a tenant's stock profile: "warehouse A returned 4
 * rows, warehouse B returned 9000" is business intelligence about a customer,
 * arriving at a sink nobody promised it to.
 */
export function recordLedgerRead(
  port: ObservabilityPort,
  input: {
    readonly surface: LedgerReadSurface;
    readonly outcome: LedgerReadOutcome;
    readonly durationMs?: number;
    readonly requestId?: string;
    readonly preview: boolean;
    readonly occurredAt: number;
  },
): void {
  port.record(ledgerReadEvent(input));
}

/** The event a ledger read produces. Separated so a test can assert its shape. */
export function ledgerReadEvent(input: {
  readonly surface: LedgerReadSurface;
  readonly outcome: LedgerReadOutcome;
  readonly durationMs?: number;
  readonly requestId?: string;
  readonly preview: boolean;
  readonly occurredAt: number;
}): ObservabilityEvent {
  return observabilityEvent({
    code:
      input.outcome === "READY"
        ? SLI_CODES.ledgerRead
        : SLI_CODES.ledgerReadFailed,
    severity:
      input.outcome === "READY" || input.outcome === "WAREHOUSE_MISSING"
        ? "info"
        : input.outcome === "DENIED"
          ? "warning"
          : "error",
    ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
    dimensions: {
      surface: input.surface,
      outcome: input.outcome,
      preview: input.preview,
      ...(input.durationMs === undefined
        ? {}
        : { latencyBucketMs: latencyBucketMs(input.durationMs) }),
    },
    occurredAt: input.occurredAt,
  });
}

/**
 * Record a client-side failure a boundary caught.
 *
 * The code comes from the server's own published error code where there is one,
 * and `UNKNOWN` otherwise. No message and no stack: see `event.ts`.
 */
export function recordClientError(
  port: ObservabilityPort,
  input: {
    readonly code: string;
    readonly surface: string;
    readonly requestId?: string;
    readonly occurredAt: number;
  },
): void {
  port.record(
    observabilityEvent({
      code: SLI_CODES.clientError,
      severity: "error",
      ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
      dimensions: { failureCode: input.code, surface: input.surface },
      occurredAt: input.occurredAt,
    }),
  );
}
