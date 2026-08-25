import { isRecord, isSafeInt, isString } from "../guards";
import { fail, ok, type Result } from "../result";
import {
  convertToBase,
  type ItemUomError,
  type ItemUomProfile,
} from "../uom/itemUom";
import type { Quantity, UomCode } from "../uom/quantity";

export type CountScope = "FULL" | "CYCLE" | "SPOT";
export type CountVisibility = "BLIND" | "VISIBLE";
export type CountMovementPolicy = "FROZEN" | "MOVEMENT_AWARE";
export type CountPlanStatus =
  | "DRAFT"
  | "RELEASED"
  | "IN_PROGRESS"
  | "RECONCILING"
  | "COMPLETED"
  | "CANCELLED";

export interface CountPlanState {
  readonly status: CountPlanStatus;
  readonly scope: CountScope;
  readonly visibility: CountVisibility;
  readonly movementPolicy: CountMovementPolicy;
  readonly createdByUserId: string;
  readonly taskCount: number;
  readonly completedTaskCount: number;
  readonly varianceTaskCount: number;
  readonly freezeExpiresAt?: number;
  readonly releasedByUserId?: string;
  readonly releasedAt?: number;
  readonly completedByUserId?: string;
  readonly completedAt?: number;
  readonly cancelledByUserId?: string;
  readonly cancelledAt?: number;
  readonly cancellationReason?: string;
}

export type CountTaskStatus =
  | "AVAILABLE"
  | "COUNTING"
  | "SUBMITTED"
  | "RECOUNT_REQUIRED"
  | "RECOUNTING"
  | "RECONCILED"
  | "CANCELLED";

export interface CountTaskState {
  readonly status: CountTaskStatus;
  readonly firstCounterUserId?: string;
  readonly secondCounterUserId?: string;
  readonly activeCounterUserId?: string;
  readonly activeCountOrdinal?: 1 | 2;
  readonly submittedCountOrdinal?: 1 | 2;
  readonly firstSubmittedAt?: number;
  readonly secondSubmittedAt?: number;
  readonly entryCount: number;
  readonly recountRequestedByUserId?: string;
  readonly recountRequestedAt?: number;
  readonly recountReason?: string;
  readonly lastDiscardedByUserId?: string;
  readonly lastDiscardedAt?: number;
  readonly lastDiscardReason?: string;
  readonly reconciledByUserId?: string;
  readonly reconciledAt?: number;
}

export const MAX_COUNT_REASON_LENGTH = 240;
export const MAX_COUNT_TASKS_PER_PLAN = 10_000;

export type CountLifecycleError =
  | { readonly code: "INPUT_INVALID"; readonly field: string }
  | { readonly code: "PLAN_NOT_ACTIONABLE"; readonly status: string }
  | { readonly code: "TASK_NOT_ACTIONABLE"; readonly status: string }
  | { readonly code: "FREEZE_EXPIRY_REQUIRED" }
  | { readonly code: "FREEZE_EXPIRED"; readonly expiredAt: number }
  | { readonly code: "TASKS_INCOMPLETE"; readonly remaining: number }
  | { readonly code: "VARIANCES_UNRESOLVED"; readonly count: number }
  | { readonly code: "TASK_NOT_HELD_BY_ACTOR" }
  | { readonly code: "RECOUNT_MUST_USE_DIFFERENT_COUNTER" }
  | { readonly code: "ENTRIES_REQUIRED" }
  | { readonly code: "REASON_REQUIRED" }
  | { readonly code: "REASON_TOO_LONG"; readonly limit: number }
  | { readonly code: "ITEM_MISMATCH" }
  | { readonly code: "QUANTITY_NOT_POSITIVE" }
  | { readonly code: "UOM_REJECTED"; readonly cause: ItemUomError }
  | {
      readonly code: "UOM_INEXACT";
      readonly numerator: number;
      readonly denominator: number;
      readonly uom: string;
    };

const IDENTIFIER_PATTERN = /^[A-Za-z0-9_.-]+$/;
const validIdentifier = (value: unknown): value is string =>
  isString(value) &&
  value.length > 0 &&
  value.length <= 128 &&
  IDENTIFIER_PATTERN.test(value);
const validClock = (value: unknown): value is number =>
  isSafeInt(value) && value >= 0;

function normalizeReason(reason: unknown): Result<string, CountLifecycleError> {
  const normalized = isString(reason) ? reason.trim() : "";
  if (normalized.length === 0) return fail({ code: "REASON_REQUIRED" });
  if (normalized.length > MAX_COUNT_REASON_LENGTH) {
    return fail({ code: "REASON_TOO_LONG", limit: MAX_COUNT_REASON_LENGTH });
  }
  return ok(normalized);
}

export function makeCountPlan(input: {
  readonly scope: CountScope;
  readonly visibility: CountVisibility;
  readonly movementPolicy: CountMovementPolicy;
  readonly createdByUserId: string;
  readonly taskCount: number;
  readonly freezeExpiresAt?: number;
}): Result<CountPlanState, CountLifecycleError> {
  if (!isRecord(input)) return fail({ code: "INPUT_INVALID", field: "input" });
  if (!["FULL", "CYCLE", "SPOT"].includes(input.scope)) {
    return fail({ code: "INPUT_INVALID", field: "scope" });
  }
  if (!["BLIND", "VISIBLE"].includes(input.visibility)) {
    return fail({ code: "INPUT_INVALID", field: "visibility" });
  }
  if (!["FROZEN", "MOVEMENT_AWARE"].includes(input.movementPolicy)) {
    return fail({ code: "INPUT_INVALID", field: "movementPolicy" });
  }
  if (!validIdentifier(input.createdByUserId)) {
    return fail({ code: "INPUT_INVALID", field: "createdByUserId" });
  }
  if (
    !isSafeInt(input.taskCount) ||
    input.taskCount <= 0 ||
    input.taskCount > MAX_COUNT_TASKS_PER_PLAN
  ) {
    return fail({ code: "INPUT_INVALID", field: "taskCount" });
  }
  if (
    input.freezeExpiresAt !== undefined &&
    !validClock(input.freezeExpiresAt)
  ) {
    return fail({ code: "INPUT_INVALID", field: "freezeExpiresAt" });
  }
  if (
    input.movementPolicy === "FROZEN" &&
    input.freezeExpiresAt === undefined
  ) {
    return fail({ code: "FREEZE_EXPIRY_REQUIRED" });
  }
  return ok(
    Object.freeze({
      status: "DRAFT" as const,
      scope: input.scope,
      visibility: input.visibility,
      movementPolicy: input.movementPolicy,
      createdByUserId: input.createdByUserId,
      taskCount: input.taskCount,
      completedTaskCount: 0,
      varianceTaskCount: 0,
      ...(input.freezeExpiresAt === undefined
        ? {}
        : { freezeExpiresAt: input.freezeExpiresAt }),
    }),
  );
}

export function decideCountPlanRelease(input: {
  readonly state: CountPlanState;
  readonly actorUserId: string;
  readonly now: number;
}): Result<CountPlanState, CountLifecycleError> {
  if (!validIdentifier(input.actorUserId))
    return fail({ code: "INPUT_INVALID", field: "actorUserId" });
  if (!validClock(input.now))
    return fail({ code: "INPUT_INVALID", field: "now" });
  if (input.state.status !== "DRAFT") {
    return fail({ code: "PLAN_NOT_ACTIONABLE", status: input.state.status });
  }
  if (
    input.state.movementPolicy === "FROZEN" &&
    (input.state.freezeExpiresAt === undefined ||
      input.state.freezeExpiresAt <= input.now)
  ) {
    return input.state.freezeExpiresAt === undefined
      ? fail({ code: "FREEZE_EXPIRY_REQUIRED" })
      : fail({
          code: "FREEZE_EXPIRED",
          expiredAt: input.state.freezeExpiresAt,
        });
  }
  return ok(
    Object.freeze({
      ...input.state,
      status: "RELEASED" as const,
      releasedByUserId: input.actorUserId,
      releasedAt: input.now,
    }),
  );
}

export function recordCountPlanProgress(input: {
  readonly state: CountPlanState;
  readonly completedTaskCount: number;
  readonly varianceTaskCount: number;
}): Result<CountPlanState, CountLifecycleError> {
  if (
    !["RELEASED", "IN_PROGRESS", "RECONCILING"].includes(input.state.status)
  ) {
    return fail({ code: "PLAN_NOT_ACTIONABLE", status: input.state.status });
  }
  if (
    !isSafeInt(input.completedTaskCount) ||
    !isSafeInt(input.varianceTaskCount) ||
    input.completedTaskCount < 0 ||
    input.completedTaskCount > input.state.taskCount ||
    input.varianceTaskCount < 0 ||
    input.varianceTaskCount > input.completedTaskCount
  ) {
    return fail({ code: "INPUT_INVALID", field: "progress" });
  }
  const status: CountPlanStatus =
    input.completedTaskCount < input.state.taskCount
      ? "IN_PROGRESS"
      : input.varianceTaskCount > 0
        ? "RECONCILING"
        : "IN_PROGRESS";
  return ok(
    Object.freeze({
      ...input.state,
      status,
      completedTaskCount: input.completedTaskCount,
      varianceTaskCount: input.varianceTaskCount,
    }),
  );
}

export function decideCountPlanCompletion(input: {
  readonly state: CountPlanState;
  readonly actorUserId: string;
  readonly now: number;
}): Result<CountPlanState, CountLifecycleError> {
  if (!validIdentifier(input.actorUserId))
    return fail({ code: "INPUT_INVALID", field: "actorUserId" });
  if (!validClock(input.now))
    return fail({ code: "INPUT_INVALID", field: "now" });
  if (!["IN_PROGRESS", "RECONCILING"].includes(input.state.status)) {
    return fail({ code: "PLAN_NOT_ACTIONABLE", status: input.state.status });
  }
  const remaining = input.state.taskCount - input.state.completedTaskCount;
  if (remaining !== 0) return fail({ code: "TASKS_INCOMPLETE", remaining });
  if (input.state.varianceTaskCount !== 0) {
    return fail({
      code: "VARIANCES_UNRESOLVED",
      count: input.state.varianceTaskCount,
    });
  }
  return ok(
    Object.freeze({
      ...input.state,
      status: "COMPLETED" as const,
      completedByUserId: input.actorUserId,
      completedAt: input.now,
    }),
  );
}

export function decideCountPlanCancellation(input: {
  readonly state: CountPlanState;
  readonly actorUserId: string;
  readonly reason: string;
  readonly now: number;
}): Result<CountPlanState, CountLifecycleError> {
  if (["COMPLETED", "CANCELLED"].includes(input.state.status)) {
    return fail({ code: "PLAN_NOT_ACTIONABLE", status: input.state.status });
  }
  if (!validIdentifier(input.actorUserId))
    return fail({ code: "INPUT_INVALID", field: "actorUserId" });
  if (!validClock(input.now))
    return fail({ code: "INPUT_INVALID", field: "now" });
  const reason = normalizeReason(input.reason);
  if (!reason.ok) return reason;
  return ok(
    Object.freeze({
      ...input.state,
      status: "CANCELLED" as const,
      cancelledByUserId: input.actorUserId,
      cancelledAt: input.now,
      cancellationReason: reason.value,
    }),
  );
}

export const availableCountTask = (): CountTaskState =>
  Object.freeze({ status: "AVAILABLE", entryCount: 0 });

export function decideCountTaskStart(input: {
  readonly state: CountTaskState;
  readonly actorUserId: string;
}): Result<CountTaskState, CountLifecycleError> {
  if (!validIdentifier(input.actorUserId))
    return fail({ code: "INPUT_INVALID", field: "actorUserId" });
  if (input.state.status === "AVAILABLE") {
    return ok(
      Object.freeze({
        ...input.state,
        status: "COUNTING" as const,
        firstCounterUserId: input.actorUserId,
        activeCounterUserId: input.actorUserId,
        activeCountOrdinal: 1 as const,
        entryCount: 0,
      }),
    );
  }
  if (input.state.status === "RECOUNT_REQUIRED") {
    if (input.actorUserId === input.state.firstCounterUserId) {
      return fail({ code: "RECOUNT_MUST_USE_DIFFERENT_COUNTER" });
    }
    return ok(
      Object.freeze({
        ...input.state,
        status: "RECOUNTING" as const,
        secondCounterUserId: input.actorUserId,
        activeCounterUserId: input.actorUserId,
        activeCountOrdinal: 2 as const,
        entryCount: 0,
      }),
    );
  }
  return fail({ code: "TASK_NOT_ACTIONABLE", status: input.state.status });
}

export function decideCountTaskSubmission(input: {
  readonly state: CountTaskState;
  readonly actorUserId: string;
  readonly entryCount: number;
  readonly now: number;
  readonly freezeExpiresAt?: number;
}): Result<CountTaskState, CountLifecycleError> {
  if (!["COUNTING", "RECOUNTING"].includes(input.state.status)) {
    return fail({ code: "TASK_NOT_ACTIONABLE", status: input.state.status });
  }
  if (input.state.activeCounterUserId !== input.actorUserId) {
    return fail({ code: "TASK_NOT_HELD_BY_ACTOR" });
  }
  if (!validClock(input.now))
    return fail({ code: "INPUT_INVALID", field: "now" });
  if (
    input.freezeExpiresAt !== undefined &&
    input.freezeExpiresAt <= input.now
  ) {
    return fail({ code: "FREEZE_EXPIRED", expiredAt: input.freezeExpiresAt });
  }
  if (!isSafeInt(input.entryCount) || input.entryCount <= 0) {
    return fail({ code: "ENTRIES_REQUIRED" });
  }
  const ordinal = input.state.activeCountOrdinal;
  if (ordinal !== 1 && ordinal !== 2) {
    return fail({ code: "INPUT_INVALID", field: "activeCountOrdinal" });
  }
  const {
    activeCounterUserId: _activeCounterUserId,
    activeCountOrdinal: _activeCountOrdinal,
    ...inactiveState
  } = input.state;
  return ok(
    Object.freeze({
      ...inactiveState,
      status: "SUBMITTED" as const,
      submittedCountOrdinal: ordinal,
      entryCount: input.entryCount,
      ...(ordinal === 1
        ? { firstSubmittedAt: input.now }
        : { secondSubmittedAt: input.now }),
    }),
  );
}

export function decideCountTaskRecount(input: {
  readonly state: CountTaskState;
  readonly actorUserId: string;
  readonly reason: string;
  readonly now: number;
}): Result<CountTaskState, CountLifecycleError> {
  if (
    input.state.status !== "SUBMITTED" ||
    input.state.submittedCountOrdinal !== 1
  ) {
    return fail({ code: "TASK_NOT_ACTIONABLE", status: input.state.status });
  }
  if (!validIdentifier(input.actorUserId))
    return fail({ code: "INPUT_INVALID", field: "actorUserId" });
  if (!validClock(input.now))
    return fail({ code: "INPUT_INVALID", field: "now" });
  const reason = normalizeReason(input.reason);
  if (!reason.ok) return reason;
  return ok(
    Object.freeze({
      ...input.state,
      status: "RECOUNT_REQUIRED" as const,
      recountRequestedByUserId: input.actorUserId,
      recountRequestedAt: input.now,
      recountReason: reason.value,
      entryCount: 0,
    }),
  );
}

export function decideCountAttemptDiscard(input: {
  readonly state: CountTaskState;
  readonly actorUserId: string;
  readonly reason: string;
  readonly now: number;
}): Result<CountTaskState, CountLifecycleError> {
  if (!["COUNTING", "RECOUNTING"].includes(input.state.status)) {
    return fail({ code: "TASK_NOT_ACTIONABLE", status: input.state.status });
  }
  if (input.state.activeCounterUserId !== input.actorUserId) {
    return fail({ code: "TASK_NOT_HELD_BY_ACTOR" });
  }
  if (!validClock(input.now))
    return fail({ code: "INPUT_INVALID", field: "now" });
  const reason = normalizeReason(input.reason);
  if (!reason.ok) return reason;
  const returnStatus: CountTaskStatus =
    input.state.activeCountOrdinal === 2 ? "RECOUNT_REQUIRED" : "AVAILABLE";
  const {
    activeCounterUserId: _activeCounterUserId,
    activeCountOrdinal: _activeCountOrdinal,
    ...inactiveState
  } = input.state;
  return ok(
    Object.freeze({
      ...inactiveState,
      status: returnStatus,
      entryCount: 0,
      lastDiscardedByUserId: input.actorUserId,
      lastDiscardedAt: input.now,
      lastDiscardReason: reason.value,
    }),
  );
}

export function decideCountTaskReconciled(input: {
  readonly state: CountTaskState;
  readonly actorUserId: string;
  readonly now: number;
}): Result<CountTaskState, CountLifecycleError> {
  if (input.state.status !== "SUBMITTED") {
    return fail({ code: "TASK_NOT_ACTIONABLE", status: input.state.status });
  }
  if (!validIdentifier(input.actorUserId))
    return fail({ code: "INPUT_INVALID", field: "actorUserId" });
  if (!validClock(input.now))
    return fail({ code: "INPUT_INVALID", field: "now" });
  return ok(
    Object.freeze({
      ...input.state,
      status: "RECONCILED" as const,
      reconciledByUserId: input.actorUserId,
      reconciledAt: input.now,
    }),
  );
}

export interface CapturedCountEntry {
  readonly itemKey: string;
  readonly entryUom: UomCode;
  readonly entryMinorUnits: number;
  readonly baseQuantity: Quantity;
}

/** Convert on the trusted side and reject any quantity that would need rounding. */
export function captureCountEntry(input: {
  readonly itemKey: string;
  readonly profile: ItemUomProfile;
  readonly entryUom: UomCode;
  readonly entryMinorUnits: number;
}): Result<CapturedCountEntry, CountLifecycleError> {
  if (input.profile.itemKey !== input.itemKey)
    return fail({ code: "ITEM_MISMATCH" });
  if (!isSafeInt(input.entryMinorUnits) || input.entryMinorUnits < 0) {
    return fail({ code: "QUANTITY_NOT_POSITIVE" });
  }
  const converted = convertToBase(
    input.profile,
    input.entryUom,
    input.entryMinorUnits,
  );
  if (converted.kind === "REJECTED") {
    return fail({ code: "UOM_REJECTED", cause: converted.error });
  }
  if (converted.kind === "INEXACT") {
    return fail({
      code: "UOM_INEXACT",
      numerator: converted.exact.numerator,
      denominator: converted.exact.denominator,
      uom: converted.uom,
    });
  }
  return ok(
    Object.freeze({
      itemKey: input.itemKey,
      entryUom: input.entryUom,
      entryMinorUnits: input.entryMinorUnits,
      baseQuantity: converted.quantity,
    }),
  );
}

export type CountViewerRole =
  "COUNTER" | "RECOUNTER" | "SUPERVISOR" | "AUDITOR";

export interface CountTaskProjectionSource {
  readonly taskId: string;
  readonly locationId: string;
  readonly visibility: CountVisibility;
  readonly systemSnapshotBaseMinorUnits: number;
  readonly movementBaseMinorUnits: number;
  readonly firstCountBaseMinorUnits?: number;
  readonly secondCountBaseMinorUnits?: number;
}

export type CountTaskProjection = Readonly<Record<string, string | number>>;

export function projectCountTaskForViewer(input: {
  readonly source: CountTaskProjectionSource;
  readonly role: CountViewerRole;
}): Result<CountTaskProjection, CountLifecycleError> {
  if (!isRecord(input.source))
    return fail({ code: "INPUT_INVALID", field: "source" });
  if (!["COUNTER", "RECOUNTER", "SUPERVISOR", "AUDITOR"].includes(input.role)) {
    return fail({ code: "INPUT_INVALID", field: "role" });
  }
  if (
    !validIdentifier(input.source.taskId) ||
    !validIdentifier(input.source.locationId)
  ) {
    return fail({ code: "INPUT_INVALID", field: "identity" });
  }
  const privileged = input.role === "SUPERVISOR" || input.role === "AUDITOR";
  const maySeeSystem = privileged || input.source.visibility === "VISIBLE";
  const maySeeFirst = privileged || input.role === "COUNTER";
  const view: Record<string, string | number> = {
    taskId: input.source.taskId,
    locationId: input.source.locationId,
    visibility: input.source.visibility,
  };
  if (maySeeSystem) {
    view.systemSnapshotBaseMinorUnits =
      input.source.systemSnapshotBaseMinorUnits;
    view.movementBaseMinorUnits = input.source.movementBaseMinorUnits;
  }
  if (maySeeFirst && input.source.firstCountBaseMinorUnits !== undefined) {
    view.firstCountBaseMinorUnits = input.source.firstCountBaseMinorUnits;
  }
  if (privileged && input.source.secondCountBaseMinorUnits !== undefined) {
    view.secondCountBaseMinorUnits = input.source.secondCountBaseMinorUnits;
  }
  return ok(Object.freeze(view));
}
