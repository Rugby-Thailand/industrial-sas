/**
 * Claim, lease, heartbeat, release, and supervisor reassignment for shared
 * operator work (plan §4 invariant 18, §8 `FF-P1-09`).
 *
 * Status: **implemented as the pure state machine.** `convex/platform/tasks.ts`
 * is the tenant-bound writer.
 *
 * ### Why a lease rather than a claim
 *
 * `putawayTasks` already proves the compare-and-set claim (`INV-0007-11`), and
 * it is enough while the only failure mode is two operators pressing at once.
 * It is not enough for a shift: a handheld whose battery dies mid-count holds
 * its task forever, and the only recovery is an administrator editing a row.
 *
 * A lease makes "still working on it" an observable fact with an expiry. The
 * device renews it with a heartbeat; when the renewals stop, the lease lapses
 * and the task returns to the queue **with its partial evidence intact**. That
 * last clause is the whole point — a counter who scanned forty of sixty
 * locations before their battery died must not lose forty scans, and a system
 * that discarded them would teach operators to avoid the handheld entirely.
 *
 * ### What "expired" means here
 *
 * Expiry is decided by comparing the server's clock to the stored
 * `leaseExpiresAt`, and *only* on a transition. Nothing sweeps: a task whose
 * lease lapsed at 14:02 is still stored as `CLAIMED` at 14:03, and it becomes
 * available at the moment somebody asks. That keeps the rule in one place —
 * `decideClaim` — instead of splitting it between a cron and a mutation that
 * would then disagree during the window between them. `describeLease` is what a
 * list read uses to *present* the same fact without writing.
 *
 * ### Who may take a task from whom
 *
 * - Anyone may claim a task that is `AVAILABLE`, or one whose lease has lapsed.
 * - The holder may renew, release, or complete their own task.
 * - A holder whose lease lapsed may still renew it *if nobody else took it*:
 *   walking back into Wi-Fi range should resume the task, not lose it.
 * - Only a supervisor path — `reassignTask`, which the public function guards
 *   with its own permission — may take a live lease from another operator, and
 *   it records who took it from whom and why.
 *
 * Pure module (plan §6.2): no Convex imports.
 */
import { isRecord, isSafeInt, isString } from "../guards";
import { fail, ok, type Result } from "../result";

/* -------------------------------------------------------------------------- */
/* Bounds                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * How long one claim survives without a heartbeat: 5 minutes.
 *
 * Long enough to survive a walk through a shielded aisle and a screen lock;
 * short enough that a shift supervisor is not staring at a task nobody is
 * doing for half an hour. It is a code-owned constant rather than tenant
 * configuration because a tenant that set it to a day would silently reinvent
 * the abandoned-task problem the lease exists to solve.
 */
export const TASK_LEASE_MS = 5 * 60 * 1000;

/** Longest reason accepted on a release or a reassignment. */
export const MAX_TASK_REASON_LENGTH = 240;

export type OperatorTaskStatus =
  "AVAILABLE" | "CLAIMED" | "COMPLETED" | "CANCELLED";

/** Why a claim ended. Stored, because "who dropped this and why" is the question. */
export type TaskReleaseKind =
  /** The holder handed it back on purpose — shift end, priority change. */
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

/** The stored row, as this module reads it. */
export interface OperatorTaskState {
  readonly status: OperatorTaskStatus;
  readonly claimedByUserId?: string | undefined;
  readonly claimedAt?: number | undefined;
  readonly leaseExpiresAt?: number | undefined;
  readonly heartbeatAt?: number | undefined;
  /** How many evidence rows the task already carries; never reset by a release. */
  readonly evidenceCount?: number | undefined;
}

/* -------------------------------------------------------------------------- */
/* Lease presentation                                                          */
/* -------------------------------------------------------------------------- */

/** How a lease reads right now, without writing anything. */
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

/**
 * Present a task's lease.
 *
 * A read-only view, so a board can show "held by Somchai, 3:20 left" and
 * "lease lapsed, available to take" without either state being a write. A
 * `CLAIMED` row with no expiry is treated as expired rather than as an
 * indefinite hold: an unbounded lease is the failure the lease prevents, so
 * the honest reading of a malformed one is "nobody is holding this".
 */
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

/* -------------------------------------------------------------------------- */
/* Claim                                                                       */
/* -------------------------------------------------------------------------- */

export interface ClaimOutcome {
  readonly claimedByUserId: string;
  readonly claimedAt: number;
  readonly leaseExpiresAt: number;
  readonly heartbeatAt: number;
  /** True when this actor already held the task and simply renewed it. */
  readonly alreadyHeld: boolean;
  /**
   * Set when the claim took over a lapsed lease. The caller writes the
   * handover as evidence, so the previous holder's partial work is attributed
   * rather than silently absorbed.
   */
  readonly takenOverFromUserId?: string;
}

/**
 * Decide a claim.
 *
 * Re-claiming a task this actor already holds succeeds and renews the lease —
 * an operator whose screen reconnected must not be told they lost their own
 * task — and it is reported as `alreadyHeld` so the caller does not write a
 * second handover.
 */
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

/* -------------------------------------------------------------------------- */
/* Heartbeat                                                                   */
/* -------------------------------------------------------------------------- */

export interface HeartbeatOutcome {
  readonly leaseExpiresAt: number;
  readonly heartbeatAt: number;
  /** True when the lease had lapsed and this renewal recovered it. */
  readonly recovered: boolean;
}

/**
 * Renew a lease.
 *
 * The holder may renew a lapsed lease **only while nobody else has taken the
 * task** — which is exactly what "still claimed by me" means, since a takeover
 * rewrites `claimedByUserId`. A heartbeat from an operator who lost the task is
 * refused with `TASK_NOT_HELD_BY_ACTOR`, so their screen can say who holds it
 * now instead of pretending the work is still theirs.
 */
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

/* -------------------------------------------------------------------------- */
/* Release and reassignment                                                    */
/* -------------------------------------------------------------------------- */

export interface ReleaseOutcome {
  readonly status: "AVAILABLE";
  readonly releaseKind: TaskReleaseKind;
  readonly previousHolderUserId: string;
  readonly releasedAt: number;
  readonly reason: string;
  /**
   * Evidence rows the task keeps. Always the count it already had: a release
   * never discards partial work (plan §4 invariant 18).
   */
  readonly retainedEvidenceCount: number;
}

/**
 * The holder hands a task back.
 *
 * A reason is required, and it is required from the holder rather than
 * inferred: "shift end", "battery", "priority job" are different operational
 * facts, and a board that could not distinguish them cannot tell a supervisor
 * whether the task is safe to hand to somebody else immediately.
 */
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

/**
 * A supervisor moves a task to another operator.
 *
 * The only path that may take a *live* lease, which is why the public function
 * guards it with a supervisor permission and audits it. Two refusals matter:
 *
 * - Reassigning to the current holder is refused rather than accepted as a
 *   no-op, because a supervisor who meant to move the work would read the
 *   success as proof it moved.
 * - A supervisor cannot reassign a task to themselves through this path. Taking
 *   over work is a claim, and routing it through the supervisor path would let
 *   one permission stand in for two decisions.
 */
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

/* -------------------------------------------------------------------------- */
/* Completion                                                                  */
/* -------------------------------------------------------------------------- */

export interface CompletionOutcome {
  readonly status: "COMPLETED";
  readonly completedByUserId: string;
  readonly completedAt: number;
}

/**
 * Complete a task.
 *
 * A lapsed lease refuses completion, and that refusal is the one place the
 * lease is strict rather than forgiving: a heartbeat may recover a lapsed lease
 * because renewing it changes nothing, but *finishing* work whose ownership
 * lapsed could close a task another operator has since redone. The recovery is
 * one tap — re-claim, then complete — and it is worth the tap.
 */
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

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

/** Trim, compose, and bound a free-text operational reason. */
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
