import { observabilityEvent, type ObservabilityEvent } from "./event";
import type { ObservabilityPort } from "./port";

export const SLI_CODES = Object.freeze({
  ledgerRead: "ledger.read",
  ledgerReadFailed: "ledger.read.failed",
  clientError: "client.error",
});

export const LATENCY_BUCKET_BOUNDS_MS: readonly number[] = Object.freeze([
  100, 250, 500, 800, 1_500, 3_000, 10_000,
]);

export function latencyBucketMs(durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs < 0) return -1;
  for (const bound of LATENCY_BUCKET_BOUNDS_MS) {
    if (durationMs <= bound) return bound;
  }
  return -1;
}

export type LedgerReadOutcome =
  | "READY"
  | "DENIED"
  | "LEDGER_ERROR"
  | "ERROR"
  | "SIGN_IN_REQUIRED"
  | "BACKEND_MISSING"
  | "WAREHOUSE_MISSING";

export type LedgerReadSurface = "balances" | "history";

export function recordLedgerRead(
  port: ObservabilityPort,
  input: {
    readonly surface: LedgerReadSurface;
    readonly outcome: LedgerReadOutcome;
    readonly durationMs?: number;
    readonly requestId?: string;
    readonly occurredAt: number;
  },
): void {
  port.record(ledgerReadEvent(input));
}

export function ledgerReadEvent(input: {
  readonly surface: LedgerReadSurface;
  readonly outcome: LedgerReadOutcome;
  readonly durationMs?: number;
  readonly requestId?: string;
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
      ...(input.durationMs === undefined
        ? {}
        : { latencyBucketMs: latencyBucketMs(input.durationMs) }),
    },
    occurredAt: input.occurredAt,
  });
}

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
