import { isRecord, isSafeInt, isString } from "../guards";
import { fail, ok, type Result } from "../result";

export const TASK_LEASE_MS = 5 * 60 * 1000;

export const MAX_TASK_REASON_LENGTH = 240;

export type OperatorTaskStatus =
  "AVAILABLE" | "CLAIMED" | "COMPLETED" | "CANCELLED";

/** Why a claim ended. Stored, because "who dropped this and why" is the question. */
export type TaskReleaseKind =
  | "RELEASED"
  /** The lease lapsed and somebody else took it. */
  | "LEASE_EXPIRED"
  /** A supervisor took it from the holder. */
  | "REASSIGNED";

export type TaskAssignmentError =
  | { readonly code: "TASK_NOT_CLAIMABLE"; readonly status: string }
  | { readonly code: "TASK_HELD_BY_ANOTHER_OPERATOR" }
  | { readonly code: "TASK_NOT_CLAIMED"; readonly status: string }
  | { readonly code: "TASK_NOT_HELD_BY_ACTOR" }
  | { readonly code: "TASK_LEASE_EXPIRED" }
  | { readonly code: "REASSIGN_TO_CURRENT_HOLDER" }
  | { readonly code: "REASSIGN_TO_SELF" }
  | { readonly code: "REASON_REQUIRED" }
  | {
      readonly code: "REASON_TOO_LONG";
      readonly limit: number;
      readonly actualLength: number;
    }
  | { readonly code: "CLOCK_INVALID" }
  | { readonly code: "ACTOR_INVALID" };

export interface OperatorTaskState {
  readonly status: OperatorTaskStatus;
  readonly claimedByUserId?: string | undefined;
  readonly claimedAt?: number | undefined;
  readonly leaseExpiresAt?: number | undefined;
  readonly heartbeatAt?: number | undefined;

  readonly evidenceCount?: number | undefined;
}

export type LeaseView =
  | { readonly kind: "UNCLAIMED" }
  | {
      readonly kind: "HELD";
      readonly holderUserId: string;
      readonly expiresAt: number;
      readonly remainingMs: number;
    }
  | {
      readonly kind: "EXPIRED";
      readonly holderUserId: string;
      readonly expiredAt: number;
    }
  | { readonly kind: "CLOSED"; readonly status: OperatorTaskStatus };

export function describeLease(task: OperatorTaskState, now: number): LeaseView {
  if (!isRecord(task) || !isSafeInt(now)) {
    return { kind: "CLOSED", status: "CANCELLED" };
  }
  if (task.status === "COMPLETED" || task.status === "CANCELLED") {
    return { kind: "CLOSED", status: task.status };
  }
  const holder = task.claimedByUserId;
  if (task.status !== "CLAIMED" || holder === undefined) {
    return { kind: "UNCLAIMED" };
  }
  const expiresAt = task.leaseExpiresAt;
  if (expiresAt === undefined || !isSafeInt(expiresAt) || expiresAt <= now) {
    return {
      kind: "EXPIRED",
      holderUserId: holder,
      expiredAt: expiresAt ?? now,
    };
  }
  return {
    kind: "HELD",
    holderUserId: holder,
    expiresAt,
    remainingMs: expiresAt - now,
  };
}

export interface ClaimOutcome {
  readonly claimedByUserId: string;
  readonly claimedAt: number;
  readonly leaseExpiresAt: number;
  readonly heartbeatAt: number;

  readonly alreadyHeld: boolean;

  readonly takenOverFromUserId?: string;
}

export function decideClaim(input: {
  readonly task: OperatorTaskState;
  readonly actorUserId: string;
  readonly now: number;
  readonly leaseMs?: number;
}): Result<ClaimOutcome, TaskAssignmentError> {
  const guard = guardActorAndClock(input);
  if (!guard.ok) return guard;
  const { task, actorUserId, now } = input;
  const leaseMs = isSafeInt(input.leaseMs) ? input.leaseMs! : TASK_LEASE_MS;

  if (task.status === "COMPLETED" || task.status === "CANCELLED") {
    return fail({ code: "TASK_NOT_CLAIMABLE", status: task.status });
  }

  const lease = describeLease(task, now);
  if (lease.kind === "HELD" && lease.holderUserId !== actorUserId) {
    return fail({ code: "TASK_HELD_BY_ANOTHER_OPERATOR" });
  }

  const renewed = {
    claimedByUserId: actorUserId,
    claimedAt: lease.kind === "HELD" ? (task.claimedAt ?? now) : now,
    leaseExpiresAt: now + leaseMs,
    heartbeatAt: now,
  };

  if (lease.kind === "HELD") {
    return ok(Object.freeze({ ...renewed, alreadyHeld: true }));
  }
  if (lease.kind === "EXPIRED") {
    return ok(
      Object.freeze({
        ...renewed,
        claimedAt:
          lease.holderUserId === actorUserId ? (task.claimedAt ?? now) : now,
        alreadyHeld: lease.holderUserId === actorUserId,
        ...(lease.holderUserId === actorUserId
          ? {}
          : { takenOverFromUserId: lease.holderUserId }),
      }),
    );
  }
  return ok(Object.freeze({ ...renewed, alreadyHeld: false }));
}

export interface HeartbeatOutcome {
  readonly leaseExpiresAt: number;
  readonly heartbeatAt: number;

  readonly recovered: boolean;
}

export function decideHeartbeat(input: {
  readonly task: OperatorTaskState;
  readonly actorUserId: string;
  readonly now: number;
  readonly leaseMs?: number;
}): Result<HeartbeatOutcome, TaskAssignmentError> {
  const guard = guardActorAndClock(input);
  if (!guard.ok) return guard;
  const { task, actorUserId, now } = input;
  const leaseMs = isSafeInt(input.leaseMs) ? input.leaseMs! : TASK_LEASE_MS;

  if (task.status !== "CLAIMED") {
    return fail({ code: "TASK_NOT_CLAIMED", status: task.status });
  }
  if (task.claimedByUserId !== actorUserId) {
    return fail({ code: "TASK_NOT_HELD_BY_ACTOR" });
  }

  const lease = describeLease(task, now);
  return ok(
    Object.freeze({
      leaseExpiresAt: now + leaseMs,
      heartbeatAt: now,
      recovered: lease.kind === "EXPIRED",
    }),
  );
}

export interface ReleaseOutcome {
  readonly status: "AVAILABLE";
  readonly releaseKind: TaskReleaseKind;
  readonly previousHolderUserId: string;
  readonly releasedAt: number;
  readonly reason: string;

  readonly retainedEvidenceCount: number;
}

export function decideRelease(input: {
  readonly task: OperatorTaskState;
  readonly actorUserId: string;
  readonly reason: string;
  readonly now: number;
}): Result<ReleaseOutcome, TaskAssignmentError> {
  const guard = guardActorAndClock(input);
  if (!guard.ok) return guard;
  const { task, actorUserId, now } = input;

  if (task.status !== "CLAIMED") {
    return fail({ code: "TASK_NOT_CLAIMED", status: task.status });
  }
  if (task.claimedByUserId !== actorUserId) {
    return fail({ code: "TASK_NOT_HELD_BY_ACTOR" });
  }
  const reason = normalizeTaskReason(input.reason);
  if (!reason.ok) return reason;

  return ok(
    Object.freeze({
      status: "AVAILABLE" as const,
      releaseKind: "RELEASED" as const,
      previousHolderUserId: actorUserId,
      releasedAt: now,
      reason: reason.value,
      retainedEvidenceCount: task.evidenceCount ?? 0,
    }),
  );
}

export interface ReassignOutcome {
  readonly status: "CLAIMED";
  readonly releaseKind: TaskReleaseKind;
  readonly previousHolderUserId?: string;
  readonly claimedByUserId: string;
  readonly claimedAt: number;
  readonly leaseExpiresAt: number;
  readonly heartbeatAt: number;
  readonly reason: string;
  readonly retainedEvidenceCount: number;
}

export function decideReassign(input: {
  readonly task: OperatorTaskState;
  readonly actorUserId: string;
  readonly toUserId: string;
  readonly reason: string;
  readonly now: number;
  readonly leaseMs?: number;
}): Result<ReassignOutcome, TaskAssignmentError> {
  const guard = guardActorAndClock(input);
  if (!guard.ok) return guard;
  const { task, actorUserId, toUserId, now } = input;
  const leaseMs = isSafeInt(input.leaseMs) ? input.leaseMs! : TASK_LEASE_MS;

  if (!isString(toUserId) || toUserId.length === 0) {
    return fail({ code: "ACTOR_INVALID" });
  }
  if (task.status === "COMPLETED" || task.status === "CANCELLED") {
    return fail({ code: "TASK_NOT_CLAIMABLE", status: task.status });
  }
  if (toUserId === actorUserId) {
    return fail({ code: "REASSIGN_TO_SELF" });
  }
  if (task.status === "CLAIMED" && task.claimedByUserId === toUserId) {
    return fail({ code: "REASSIGN_TO_CURRENT_HOLDER" });
  }
  const reason = normalizeTaskReason(input.reason);
  if (!reason.ok) return reason;

  const lease = describeLease(task, now);
  const previousHolderUserId =
    lease.kind === "HELD" || lease.kind === "EXPIRED"
      ? lease.holderUserId
      : undefined;

  return ok(
    Object.freeze({
      status: "CLAIMED" as const,
      releaseKind: (lease.kind === "EXPIRED"
        ? "LEASE_EXPIRED"
        : "REASSIGNED") as TaskReleaseKind,
      ...(previousHolderUserId === undefined ? {} : { previousHolderUserId }),
      claimedByUserId: toUserId,
      claimedAt: now,
      leaseExpiresAt: now + leaseMs,
      heartbeatAt: now,
      reason: reason.value,
      retainedEvidenceCount: task.evidenceCount ?? 0,
    }),
  );
}

export interface CompletionOutcome {
  readonly status: "COMPLETED";
  readonly completedByUserId: string;
  readonly completedAt: number;
}

export function decideCompletion(input: {
  readonly task: OperatorTaskState;
  readonly actorUserId: string;
  readonly now: number;
}): Result<CompletionOutcome, TaskAssignmentError> {
  const guard = guardActorAndClock(input);
  if (!guard.ok) return guard;
  const { task, actorUserId, now } = input;

  if (task.status !== "CLAIMED") {
    return fail({ code: "TASK_NOT_CLAIMED", status: task.status });
  }
  if (task.claimedByUserId !== actorUserId) {
    return fail({ code: "TASK_NOT_HELD_BY_ACTOR" });
  }
  if (describeLease(task, now).kind === "EXPIRED") {
    return fail({ code: "TASK_LEASE_EXPIRED" });
  }

  return ok(
    Object.freeze({
      status: "COMPLETED" as const,
      completedByUserId: actorUserId,
      completedAt: now,
    }),
  );
}

export function normalizeTaskReason(
  raw: string,
): Result<string, TaskAssignmentError> {
  if (!isString(raw)) return fail({ code: "REASON_REQUIRED" });
  const trimmed = raw.trim().normalize("NFC");
  if (trimmed.length === 0) return fail({ code: "REASON_REQUIRED" });
  if (trimmed.length > MAX_TASK_REASON_LENGTH) {
    return fail({
      code: "REASON_TOO_LONG",
      limit: MAX_TASK_REASON_LENGTH,
      actualLength: trimmed.length,
    });
  }
  return ok(trimmed);
}

function guardActorAndClock(input: {
  readonly task?: unknown;
  readonly actorUserId?: unknown;
  readonly now?: unknown;
}): Result<true, TaskAssignmentError> {
  if (!isRecord(input) || !isRecord(input.task)) {
    return fail({ code: "ACTOR_INVALID" });
  }
  if (!isString(input.actorUserId) || input.actorUserId.length === 0) {
    return fail({ code: "ACTOR_INVALID" });
  }
  if (!isSafeInt(input.now) || (input.now as number) < 0) {
    return fail({ code: "CLOCK_INVALID" });
  }
  return ok(true);
}
