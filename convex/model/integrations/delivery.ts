import { fail, ok, type Result } from "../result";

export type DeliveryStatus =
  | "PENDING"
  | "DELIVERING"
  | "RETRY_WAIT"
  | "DELIVERED"
  | "DEAD_LETTER"
  | "CANCELLED";

export interface DeliveryState {
  readonly status: DeliveryStatus;
  readonly attemptCount: number;
  readonly availableAt: number;
  readonly leaseExpiresAt?: number;
  readonly deliveredAt?: number;
  readonly lastFailureCode?: string;
}

export type DeliveryError = {
  readonly code:
    "NOT_READY" | "LEASE_ACTIVE" | "NOT_DELIVERING" | "ALREADY_FINAL";
};

export function claimDelivery(
  state: DeliveryState,
  now: number,
  leaseMs: number,
): Result<DeliveryState, DeliveryError> {
  if (state.status === "DELIVERED" || state.status === "CANCELLED") {
    return fail({ code: "ALREADY_FINAL" });
  }
  if (state.status === "DELIVERING" && (state.leaseExpiresAt ?? 0) > now) {
    return fail({ code: "LEASE_ACTIVE" });
  }
  if (
    state.status !== "PENDING" &&
    state.status !== "RETRY_WAIT" &&
    state.status !== "DELIVERING"
  ) {
    return fail({ code: "NOT_READY" });
  }
  if (state.availableAt > now) return fail({ code: "NOT_READY" });
  return ok({
    ...state,
    status: "DELIVERING",
    attemptCount: state.attemptCount + 1,
    leaseExpiresAt: now + leaseMs,
  });
}

export function recordDeliveryResult(
  state: DeliveryState,
  outcome: "DELIVERED" | "RETRYABLE_FAILURE" | "PERMANENT_FAILURE",
  now: number,
  failureCode: string | undefined,
  maxAttempts = 5,
): Result<DeliveryState, DeliveryError> {
  if (state.status === "DELIVERED" && outcome === "DELIVERED") return ok(state);
  if (state.status !== "DELIVERING") return fail({ code: "NOT_DELIVERING" });
  const { leaseExpiresAt: _leaseExpiresAt, ...withoutLease } = state;
  if (outcome === "DELIVERED") {
    return ok({ ...withoutLease, status: "DELIVERED", deliveredAt: now });
  }
  if (outcome === "PERMANENT_FAILURE" || state.attemptCount >= maxAttempts) {
    return ok({
      ...withoutLease,
      status: "DEAD_LETTER",
      ...(failureCode === undefined ? {} : { lastFailureCode: failureCode }),
    });
  }
  const delayMs = Math.min(
    60 * 60 * 1_000,
    30_000 * 2 ** (state.attemptCount - 1),
  );
  return ok({
    ...withoutLease,
    status: "RETRY_WAIT",
    availableAt: now + delayMs,
    ...(failureCode === undefined ? {} : { lastFailureCode: failureCode }),
  });
}

export function retryDeadLetter(
  state: DeliveryState,
  now: number,
): Result<DeliveryState, DeliveryError> {
  if (state.status !== "DEAD_LETTER" && state.status !== "RETRY_WAIT") {
    return fail({ code: "NOT_READY" });
  }
  return ok({ ...state, status: "PENDING", availableAt: now });
}
