/**
 * HR employee registry input rules.
 *
 * Status: implemented. Codes are organization-unique upper-case identifiers;
 * uniqueness, account links and cross-organization references are enforced by
 * the Convex layer, which owns the data.
 */
import { fail, ok, type Result } from "../result";
import { compareDates, isIsoDate } from "./calendar";

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,31}$/;
export const MAX_NAME_LENGTH = 120;
export const MAX_REASON_LENGTH = 500;
export const MIN_REASON_LENGTH = 3;

export type EmployeeFieldError = {
  readonly code:
    | "EMPLOYEE_CODE_INVALID"
    | "EMPLOYEE_NAME_INVALID"
    | "EMPLOYMENT_DATE_INVALID"
    | "EMPLOYMENT_RANGE_INVALID"
    | "SELF_SUPERVISOR";
  readonly field: string;
};

export interface EmployeeDraft {
  readonly code: string;
  readonly displayName: string;
  readonly employmentStartDate: string;
  readonly employmentEndDate?: string | undefined;
  readonly userId?: string | undefined;
  readonly supervisorUserId?: string | undefined;
}

export const normalizeEmployeeCode = (code: string): string =>
  code.trim().toUpperCase();

export function validateEmployeeDraft(
  draft: EmployeeDraft,
): Result<EmployeeDraft, EmployeeFieldError> {
  const code = normalizeEmployeeCode(draft.code);
  if (!CODE_PATTERN.test(code))
    return fail({ code: "EMPLOYEE_CODE_INVALID", field: "code" });
  const displayName = draft.displayName.trim().replace(/\s+/g, " ");
  if (displayName.length < 1 || displayName.length > MAX_NAME_LENGTH)
    return fail({ code: "EMPLOYEE_NAME_INVALID", field: "displayName" });
  if (!isIsoDate(draft.employmentStartDate))
    return fail({
      code: "EMPLOYMENT_DATE_INVALID",
      field: "employmentStartDate",
    });
  if (
    draft.employmentEndDate !== undefined &&
    !isIsoDate(draft.employmentEndDate)
  )
    return fail({
      code: "EMPLOYMENT_DATE_INVALID",
      field: "employmentEndDate",
    });
  if (
    draft.employmentEndDate !== undefined &&
    compareDates(draft.employmentEndDate, draft.employmentStartDate) < 0
  )
    return fail({
      code: "EMPLOYMENT_RANGE_INVALID",
      field: "employmentEndDate",
    });
  if (
    draft.userId !== undefined &&
    draft.supervisorUserId !== undefined &&
    draft.userId === draft.supervisorUserId
  )
    return fail({ code: "SELF_SUPERVISOR", field: "supervisorUserId" });
  return ok(
    Object.freeze({
      ...draft,
      code,
      displayName,
    }),
  );
}

/** A trimmed reason of 3–500 characters, or null. */
export function normalizeReason(reason: string | undefined): string | null {
  if (typeof reason !== "string") return null;
  const value = reason.trim();
  return value.length >= MIN_REASON_LENGTH && value.length <= MAX_REASON_LENGTH
    ? value
    : null;
}
