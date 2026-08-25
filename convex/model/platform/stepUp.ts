import { isRecord, isSafeInt, isString } from "../guards";
import { fail, ok, type Result } from "../result";

export const STEP_UP_APPROVAL_TTL_MS = 5 * 60 * 1000;

export const MAX_STEP_UP_REASON_LENGTH = 240;

/** What an approval may authorize. Closed, so possession cannot widen. */
export const STEP_UP_OPERATIONS: readonly string[] = Object.freeze([
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

export interface StepUpGrantInput {
  readonly operation: string;

  readonly targetRef: string;

  readonly operatorUserId: string;

  readonly approverUserId: string;

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

  readonly expiresAt: number;
}

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
