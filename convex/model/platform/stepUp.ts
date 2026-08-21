/**
 * Supervisor step-up **on the operator's device**, without giving that browser
 * a reusable elevated scope (plan §4 invariant 19, §8 `FF-P1-11`).
 *
 * Status: **implemented as the pure decision.** `convex/platform/stepUp.ts`
 * mints the approval and `convex/platform/tasks.ts` consumes it.
 *
 * ### The problem this solves
 *
 * An operator hits something they may not do alone — a count ten times the
 * expectation, an FEFO override, a disposition beyond their threshold. The
 * supervisor is standing next to them, and the realistic options are all bad:
 *
 * - Sign the supervisor into the handheld. The session outlives the approval,
 *   and the next operator inherits it.
 * - Give the operator a supervisor role "temporarily". Nobody removes it.
 * - Type a supervisor PIN. That is a shared credential this system refuses to
 *   store at all (`INV-0001-06`, and `schemaPolicy.ts` fails the build on a
 *   field named after one).
 *
 * ### What happens instead
 *
 * The approver authenticates as themselves — Clerk stays the identity
 * authority — and the *approval mutation runs under the approver's own
 * identity*, with its permission carrying `STEP_UP` so Clerk reverification
 * freshness is enforced by the existing evaluator. What that mutation writes is
 * not a session and not a role: it is one **single-use approval bound to five
 * things at once** — organization, operation, target, operator, and device.
 *
 * The operator's browser then holds an approval **id**. That id:
 *
 * - authorizes exactly one operation on exactly one target;
 * - is refused if the actor consuming it is not the operator it was minted for;
 * - is refused if the device differs from the one it was minted on;
 * - is refused after `expiresAt`, which is minutes, not hours;
 * - is refused a second time, because consumption is recorded.
 *
 * So the browser gains no scope it can reuse: possession of the id lets it
 * finish the one action a supervisor watched, and nothing else. That is the
 * difference between an approval and an elevation.
 *
 * ### Why the approver is checked against the operator here
 *
 * Because "the supervisor approved their own work" is the failure this exists
 * to prevent, and the general maker-checker evaluator cannot see it: the maker
 * of a quantity entry is the operator, and the approval is a separate document
 * written in a separate transaction. `decideStepUpGrant` is where the two are
 * compared.
 *
 * Pure module (plan §6.2): no Convex imports.
 */
import { isRecord, isSafeInt, isString } from "../guards";
import { fail, ok, type Result } from "../result";

/* -------------------------------------------------------------------------- */
/* Bounds                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * How long an approval stays usable: 5 minutes.
 *
 * The approval exists for the seconds between "supervisor looked at the screen"
 * and "operator pressed confirm". Long enough for a conversation and a re-scan;
 * short enough that an approval cannot be banked at the start of a shift and
 * spent at the end of it.
 */
export const STEP_UP_APPROVAL_TTL_MS = 5 * 60 * 1000;

/** Longest reason accepted. A reason is required: no silent approvals. */
export const MAX_STEP_UP_REASON_LENGTH = 240;

/** What an approval may authorize. Closed, so possession cannot widen. */
export const STEP_UP_OPERATIONS: readonly string[] = Object.freeze([
  /** A captured quantity beyond the task's plausibility ceiling. */
  "work.evidence.implausibleQuantity",
]);

export type StepUpDecision = "APPROVED" | "REJECTED";

export type StepUpError =
  | { readonly code: "OPERATION_NOT_APPROVABLE"; readonly operation: string }
  | { readonly code: "APPROVER_IS_OPERATOR" }
  | { readonly code: "REASON_REQUIRED" }
  | {
      readonly code: "REASON_TOO_LONG";
      readonly limit: number;
      readonly actualLength: number;
    }
  | { readonly code: "TARGET_REQUIRED" }
  | { readonly code: "DEVICE_REQUIRED" }
  | { readonly code: "OPERATOR_REQUIRED" }
  | { readonly code: "CLOCK_INVALID" };

/* -------------------------------------------------------------------------- */
/* Granting                                                                    */
/* -------------------------------------------------------------------------- */

export interface StepUpGrantInput {
  /** What the operator is trying to do; must be in `STEP_UP_OPERATIONS`. */
  readonly operation: string;
  /** The document the approval is about — a task, a line, a transaction. */
  readonly targetRef: string;
  /** The person who will consume the approval. */
  readonly operatorUserId: string;
  /** The person granting it, authenticated as themselves. */
  readonly approverUserId: string;
  /** The device the operator is holding; the approval is bound to it. */
  readonly deviceId: string;
  readonly decision: StepUpDecision;
  readonly reason: string;
  readonly now: number;
  readonly ttlMs?: number;
}

export interface StepUpGrant {
  readonly operation: string;
  readonly targetRef: string;
  readonly operatorUserId: string;
  readonly approverUserId: string;
  readonly deviceId: string;
  readonly decision: StepUpDecision;
  readonly reason: string;
  readonly grantedAt: number;
  /** After this instant the approval is dead, consumed or not. */
  readonly expiresAt: number;
}

/**
 * Decide whether one approval may be minted.
 *
 * A `REJECTED` decision is recorded rather than discarded: "the supervisor
 * looked and said no" is exactly the evidence an exception review needs, and a
 * system that only stored approvals would make refusals invisible.
 *
 * The device is required even for a rejection, because the record answers
 * "where was this decided", and a rejection with no device is a decision
 * nobody can place.
 */
export function decideStepUpGrant(
  input: StepUpGrantInput,
): Result<StepUpGrant, StepUpError> {
  if (!isRecord(input)) return fail({ code: "OPERATOR_REQUIRED" });
  if (!isSafeInt(input.now) || input.now < 0) {
    return fail({ code: "CLOCK_INVALID" });
  }
  if (
    !isString(input.operation) ||
    !STEP_UP_OPERATIONS.includes(input.operation)
  ) {
    return fail({
      code: "OPERATION_NOT_APPROVABLE",
      operation: isString(input.operation) ? input.operation : "",
    });
  }
  if (!isString(input.targetRef) || input.targetRef.length === 0) {
    return fail({ code: "TARGET_REQUIRED" });
  }
  if (!isString(input.operatorUserId) || input.operatorUserId.length === 0) {
    return fail({ code: "OPERATOR_REQUIRED" });
  }
  if (!isString(input.deviceId) || input.deviceId.length === 0) {
    return fail({ code: "DEVICE_REQUIRED" });
  }
  if (
    !isString(input.approverUserId) ||
    input.approverUserId.length === 0 ||
    input.approverUserId === input.operatorUserId
  ) {
    return fail({ code: "APPROVER_IS_OPERATOR" });
  }

  const reason = normalizeStepUpReason(input.reason);
  if (!reason.ok) return reason;

  const ttl =
    isSafeInt(input.ttlMs) && (input.ttlMs as number) > 0
      ? (input.ttlMs as number)
      : STEP_UP_APPROVAL_TTL_MS;

  return ok(
    Object.freeze({
      operation: input.operation,
      targetRef: input.targetRef,
      operatorUserId: input.operatorUserId,
      approverUserId: input.approverUserId,
      deviceId: input.deviceId,
      decision: input.decision === "REJECTED" ? "REJECTED" : "APPROVED",
      reason: reason.value,
      grantedAt: input.now,
      expiresAt: input.now + ttl,
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* Consuming                                                                   */
/* -------------------------------------------------------------------------- */

/** The stored approval, as the consuming command reads it. */
export interface StoredStepUpApproval {
  readonly approvalId: string;
  readonly operation: string;
  readonly targetRef: string;
  readonly operatorUserId: string;
  readonly approverUserId: string;
  readonly deviceId: string;
  readonly decision: StepUpDecision;
  readonly expiresAt: number;
  readonly consumedAt?: number | undefined;
}

export type StepUpRefusal =
  | "APPROVAL_NOT_FOUND"
  | "APPROVAL_OPERATION_MISMATCH"
  | "APPROVAL_TARGET_MISMATCH"
  | "APPROVAL_OPERATOR_MISMATCH"
  | "APPROVAL_DEVICE_MISMATCH"
  | "APPROVAL_REJECTED"
  | "APPROVAL_EXPIRED"
  | "APPROVAL_ALREADY_CONSUMED";

export interface StepUpConsumption {
  readonly approvalId: string;
  readonly approverUserId: string;
  readonly consumedAt: number;
}

/**
 * Decide whether an approval may be spent on this exact attempt.
 *
 * Every mismatch is its own refusal code, and the codes are what the operator's
 * screen translates: "that approval was for a different task" and "that
 * approval has expired" are different instructions to the person holding the
 * scanner. They are deliberately not collapsed into one generic denial, because
 * the approval id is not a secret — it authorizes nothing on its own — so
 * naming the mismatch discloses nothing an attacker could use, and hiding it
 * would cost a supervisor a second trip.
 */
export function decideStepUpConsumption(input: {
  readonly approval: StoredStepUpApproval | null;
  readonly operation: string;
  readonly targetRef: string;
  readonly operatorUserId: string;
  readonly deviceId: string;
  readonly now: number;
}): Result<StepUpConsumption, { readonly code: StepUpRefusal }> {
  if (!isRecord(input) || !isSafeInt(input.now)) {
    return fail({ code: "APPROVAL_NOT_FOUND" });
  }
  const approval = input.approval;
  if (approval === null || !isRecord(approval)) {
    return fail({ code: "APPROVAL_NOT_FOUND" });
  }
  if (approval.operation !== input.operation) {
    return fail({ code: "APPROVAL_OPERATION_MISMATCH" });
  }
  if (approval.targetRef !== input.targetRef) {
    return fail({ code: "APPROVAL_TARGET_MISMATCH" });
  }
  if (approval.operatorUserId !== input.operatorUserId) {
    return fail({ code: "APPROVAL_OPERATOR_MISMATCH" });
  }
  if (approval.deviceId !== input.deviceId) {
    return fail({ code: "APPROVAL_DEVICE_MISMATCH" });
  }
  if (approval.decision !== "APPROVED") {
    return fail({ code: "APPROVAL_REJECTED" });
  }
  if (approval.consumedAt !== undefined) {
    return fail({ code: "APPROVAL_ALREADY_CONSUMED" });
  }
  if (!isSafeInt(approval.expiresAt) || approval.expiresAt <= input.now) {
    return fail({ code: "APPROVAL_EXPIRED" });
  }

  return ok(
    Object.freeze({
      approvalId: approval.approvalId,
      approverUserId: approval.approverUserId,
      consumedAt: input.now,
    }),
  );
}

/** Trim, compose, and bound the approver's stated reason. */
export function normalizeStepUpReason(
  raw: string,
): Result<string, StepUpError> {
  if (!isString(raw)) return fail({ code: "REASON_REQUIRED" });
  const trimmed = raw.trim().normalize("NFC");
  if (trimmed.length === 0) return fail({ code: "REASON_REQUIRED" });
  if (trimmed.length > MAX_STEP_UP_REASON_LENGTH) {
    return fail({
      code: "REASON_TOO_LONG",
      limit: MAX_STEP_UP_REASON_LENGTH,
      actualLength: trimmed.length,
    });
  }
  return ok(trimmed);
}
