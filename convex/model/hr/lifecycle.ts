/**
 * Employee lifecycle: probation confirmation, offboarding and reinstatement.
 *
 * Status: implemented. The stored `status` (ACTIVE/INACTIVE) keeps its
 * meaning for every existing consumer (clock-in, review, periods). The
 * lifecycle is derived from it plus `probationEndDate` (slice 01),
 * `probationConfirmedDate` and `separation`, so legacy records need no
 * migration. Transitions take effect when recorded; scheduled (future) changes
 * are refused rather than faked:
 * - probation is confirmed on or before today;
 * - offboarding needs a last working day before today, so a person is never
 *   made INACTIVE (unable to clock in/out) on a day they still work;
 * - reinstatement is effective after the last working day, on or before today.
 * Offboarding never changes the linked sign-in or HR roles (S03-23 unknown).
 */
import { fail, ok, type Result } from "../result";
import { compareDates, isIsoDate } from "./calendar";
import { normalizeReason } from "./employee";

export type SeparationType = "RESIGNATION" | "TERMINATION";

export interface Separation {
  readonly type: SeparationType;
  readonly lastWorkingDate: string;
  readonly reason: string;
}

export type EmploymentState =
  "PROBATION" | "ACTIVE" | "INACTIVE" | "RESIGNED" | "TERMINATED";

export interface LifecycleSubject {
  readonly status: "ACTIVE" | "INACTIVE";
  readonly employmentStartDate: string;
  readonly probationEndDate?: string | undefined;
  readonly probationConfirmedDate?: string | undefined;
  readonly separation?: Separation | undefined;
}

/** The truthful employment state of a stored record. */
export function employmentState(subject: LifecycleSubject): EmploymentState {
  if (subject.separation !== undefined)
    return subject.separation.type === "RESIGNATION"
      ? "RESIGNED"
      : "TERMINATED";
  if (subject.status === "INACTIVE") return "INACTIVE";
  if (
    subject.probationEndDate !== undefined &&
    subject.probationConfirmedDate === undefined
  )
    return "PROBATION";
  return "ACTIVE";
}

export const isSeparated = (subject: LifecycleSubject): boolean =>
  subject.separation !== undefined;

export type LifecycleCommand =
  | { readonly kind: "CONFIRM_PROBATION"; readonly effectiveDate: string }
  | {
      readonly kind: "OFFBOARD";
      readonly separationType: SeparationType;
      readonly lastWorkingDate: string;
      readonly reason: string;
    }
  | {
      readonly kind: "REINSTATE";
      readonly effectiveDate: string;
      readonly reason: string;
    };

export type LifecycleErrorCode =
  | "LIFECYCLE_NOT_ON_PROBATION"
  | "LIFECYCLE_ALREADY_SEPARATED"
  | "LIFECYCLE_NOT_SEPARATED"
  | "LIFECYCLE_DATE_INVALID"
  | "LIFECYCLE_DATE_BEFORE_START"
  | "LIFECYCLE_DATE_FUTURE"
  | "LIFECYCLE_LAST_DAY_NOT_PAST"
  | "LIFECYCLE_REINSTATE_BEFORE_EXIT"
  | "LIFECYCLE_REASON_REQUIRED";

export interface LifecycleError {
  readonly code: LifecycleErrorCode;
  readonly field: string;
}

/** The changed employee fields and the immutable event a command records. */
export interface LifecycleTransition {
  readonly patch: {
    readonly status?: "ACTIVE" | "INACTIVE";
    readonly probationConfirmedDate?: string;
    /** `null` clears the stored value. */
    readonly employmentEndDate?: string | null;
    readonly separation?: Separation | null;
  };
  readonly event: {
    readonly type:
      "PROBATION_CONFIRMED" | "RESIGNED" | "TERMINATED" | "REINSTATED";
    readonly effectiveDate: string;
    readonly reason?: string;
    readonly fromState: EmploymentState;
    readonly toState: EmploymentState;
  };
}

const err = (code: LifecycleErrorCode, field: string) => fail({ code, field });

function checkDate(
  value: string,
  field: string,
  subject: LifecycleSubject,
): LifecycleError | null {
  if (!isIsoDate(value)) return { code: "LIFECYCLE_DATE_INVALID", field };
  if (compareDates(value, subject.employmentStartDate) < 0)
    return { code: "LIFECYCLE_DATE_BEFORE_START", field };
  return null;
}

/**
 * Validates one transition against the current record and the organization's
 * `today`, returning the patch and event to store, or the first error.
 */
export function planLifecycleTransition(
  subject: LifecycleSubject,
  command: LifecycleCommand,
  today: string,
): Result<LifecycleTransition, LifecycleError> {
  const from = employmentState(subject);
  if (command.kind === "CONFIRM_PROBATION") {
    if (from !== "PROBATION") return err("LIFECYCLE_NOT_ON_PROBATION", "kind");
    const bad = checkDate(command.effectiveDate, "effectiveDate", subject);
    if (bad) return fail(bad);
    if (compareDates(command.effectiveDate, today) > 0)
      return err("LIFECYCLE_DATE_FUTURE", "effectiveDate");
    return ok({
      patch: { probationConfirmedDate: command.effectiveDate },
      event: {
        type: "PROBATION_CONFIRMED",
        effectiveDate: command.effectiveDate,
        fromState: from,
        toState: "ACTIVE",
      },
    });
  }
  if (command.kind === "OFFBOARD") {
    if (from === "RESIGNED" || from === "TERMINATED")
      return err("LIFECYCLE_ALREADY_SEPARATED", "kind");
    const bad = checkDate(command.lastWorkingDate, "lastWorkingDate", subject);
    if (bad) return fail(bad);
    if (compareDates(command.lastWorkingDate, today) >= 0)
      return err("LIFECYCLE_LAST_DAY_NOT_PAST", "lastWorkingDate");
    const reason = normalizeReason(command.reason);
    if (reason === null) return err("LIFECYCLE_REASON_REQUIRED", "reason");
    const separation: Separation = {
      type: command.separationType,
      lastWorkingDate: command.lastWorkingDate,
      reason,
    };
    const to = employmentState({ ...subject, separation });
    return ok({
      patch: {
        status: "INACTIVE",
        employmentEndDate: command.lastWorkingDate,
        separation,
      },
      event: {
        type: to === "RESIGNED" ? "RESIGNED" : "TERMINATED",
        effectiveDate: command.lastWorkingDate,
        reason,
        fromState: from,
        toState: to,
      },
    });
  }
  if (subject.separation === undefined)
    return err("LIFECYCLE_NOT_SEPARATED", "kind");
  if (!isIsoDate(command.effectiveDate))
    return err("LIFECYCLE_DATE_INVALID", "effectiveDate");
  if (
    compareDates(command.effectiveDate, subject.separation.lastWorkingDate) <= 0
  )
    return err("LIFECYCLE_REINSTATE_BEFORE_EXIT", "effectiveDate");
  if (compareDates(command.effectiveDate, today) > 0)
    return err("LIFECYCLE_DATE_FUTURE", "effectiveDate");
  const reason = normalizeReason(command.reason);
  if (reason === null) return err("LIFECYCLE_REASON_REQUIRED", "reason");
  const next = { ...subject, status: "ACTIVE" as const, separation: undefined };
  return ok({
    patch: { status: "ACTIVE", employmentEndDate: null, separation: null },
    event: {
      type: "REINSTATED",
      effectiveDate: command.effectiveDate,
      reason,
      fromState: from,
      toState: employmentState(next),
    },
  });
}

/**
 * Whether a general employee save keeps an offboarded record consistent:
 * it stays INACTIVE with its last working day until it is reinstated.
 */
export function separationPreserved(
  subject: LifecycleSubject,
  next: {
    readonly status: "ACTIVE" | "INACTIVE";
    readonly employmentEndDate?: string | undefined;
  },
): boolean {
  if (subject.separation === undefined) return true;
  return (
    next.status === "INACTIVE" &&
    next.employmentEndDate === subject.separation.lastWorkingDate
  );
}
