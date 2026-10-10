/**
 * HR attendance periods: bounded range validation, the complete row set for a
 * site period, its totals and close readiness.
 *
 * Status: implemented for the pilot bounds (at most 50 employees and 31
 * business dates). Exceeding a bound is an explicit error, never a partial
 * period. Rows are generated for every employed date, including scheduled
 * days with no attendance, so an empty period cannot look complete.
 */
import { fail, ok, type Result } from "../result";
import {
  compareDates,
  datesInRange,
  inclusiveDayCount,
  isIsoDate,
  type IsoDate,
} from "./calendar";
import {
  evaluateDay,
  type Certification,
  type DayIssue,
  type DayStatus,
  type Disposition,
} from "./attendance";
import {
  isEmployedOn,
  planFor,
  type DayPlan,
  type Employment,
  type Schedule,
} from "./schedule";

export const MAX_PERIOD_DAYS = 31;
export const MAX_PERIOD_EMPLOYEES = 50;

export type PeriodRangeError =
  | { readonly code: "PERIOD_DATE_INVALID" }
  | { readonly code: "PERIOD_RANGE_INVALID" }
  | {
      readonly code: "PERIOD_TOO_LARGE";
      readonly reason: "DAYS" | "EMPLOYEES";
    };

export function validatePeriodRange(
  startDate: string,
  endDate: string,
): Result<{ readonly days: number }, PeriodRangeError> {
  if (!isIsoDate(startDate) || !isIsoDate(endDate))
    return fail({ code: "PERIOD_DATE_INVALID" });
  const days = inclusiveDayCount(startDate, endDate);
  if (days < 1) return fail({ code: "PERIOD_RANGE_INVALID" });
  if (days > MAX_PERIOD_DAYS)
    return fail({ code: "PERIOD_TOO_LARGE", reason: "DAYS" });
  return ok({ days });
}

export const rangesOverlap = (
  a: { readonly startDate: IsoDate; readonly endDate: IsoDate },
  b: { readonly startDate: IsoDate; readonly endDate: IsoDate },
): boolean =>
  compareDates(a.startDate, b.endDate) <= 0 &&
  compareDates(b.startDate, a.endDate) <= 0;

export interface PeriodEmployee {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly employment: Employment;
  readonly schedule?: Schedule | undefined;
}

export interface RecordedDay {
  readonly plan: DayPlan;
  readonly revision: number;
  readonly clockInAt?: number | undefined;
  readonly clockOutAt?: number | undefined;
  readonly certification?:
    (Certification & { readonly reason?: string | undefined }) | undefined;
}

export interface PeriodRow {
  readonly employeeId: string;
  readonly employeeCode: string;
  readonly employeeName: string;
  readonly businessDate: IsoDate;
  readonly plan: DayPlan;
  readonly actualStartAt?: number;
  readonly actualEndAt?: number;
  readonly workedMinutes: number;
  readonly outsideShiftMinutes: number;
  readonly status: DayStatus;
  readonly issue?: DayIssue;
  readonly disposition: Disposition | null;
  readonly correctionReason?: string;
  readonly recorded: boolean;
}

export interface PeriodTotals {
  readonly employees: number;
  readonly days: number;
  readonly ready: number;
  readonly exceptions: number;
  readonly unfinished: number;
  readonly workedMinutes: number;
  readonly outsideShiftMinutes: number;
  readonly absentDays: number;
  readonly leaveDays: number;
  readonly nonworkingDays: number;
}

export function buildPeriodRows(input: {
  readonly startDate: IsoDate;
  readonly endDate: IsoDate;
  readonly employees: readonly PeriodEmployee[];
  readonly offsetMinutes: number;
  readonly now: number;
  readonly holidayName: (date: IsoDate) => string | undefined;
  readonly recorded: (
    employeeId: string,
    date: IsoDate,
  ) => RecordedDay | undefined;
  readonly pending: (employeeId: string, date: IsoDate) => boolean;
}): readonly PeriodRow[] {
  const dates = datesInRange(input.startDate, input.endDate);
  const employees = [...input.employees].sort((a, b) =>
    a.code < b.code ? -1 : a.code > b.code ? 1 : 0,
  );
  const rows: PeriodRow[] = [];
  for (const employee of employees) {
    for (const date of dates) {
      if (!isEmployedOn(employee.employment, date)) continue;
      const day = input.recorded(employee.id, date);
      const plan =
        day?.plan ??
        planFor({
          date,
          schedule: employee.schedule,
          holidayName: input.holidayName(date),
          offsetMinutes: input.offsetMinutes,
        });
      const evaluation = evaluateDay({
        plan,
        now: input.now,
        revision: day?.revision ?? 0,
        clockInAt: day?.clockInAt,
        clockOutAt: day?.clockOutAt,
        certification: day?.certification,
        pendingCorrection: input.pending(employee.id, date),
      });
      const reason =
        evaluation.certified && day?.certification?.reason
          ? day.certification.reason
          : undefined;
      rows.push(
        Object.freeze({
          employeeId: employee.id,
          employeeCode: employee.code,
          employeeName: employee.name,
          businessDate: date,
          plan,
          ...(evaluation.effectiveStartAt === undefined
            ? {}
            : { actualStartAt: evaluation.effectiveStartAt }),
          ...(evaluation.effectiveEndAt === undefined
            ? {}
            : { actualEndAt: evaluation.effectiveEndAt }),
          workedMinutes: evaluation.workedMinutes,
          outsideShiftMinutes: evaluation.outsideShiftMinutes,
          status: evaluation.status,
          ...(evaluation.issue === undefined
            ? {}
            : { issue: evaluation.issue }),
          disposition: evaluation.disposition,
          ...(reason === undefined ? {} : { correctionReason: reason }),
          recorded: day !== undefined,
        }),
      );
    }
  }
  return Object.freeze(rows);
}

export function periodTotals(
  rows: readonly Pick<
    PeriodRow,
    | "employeeId"
    | "status"
    | "disposition"
    | "workedMinutes"
    | "outsideShiftMinutes"
  >[],
): PeriodTotals {
  let ready = 0;
  let exceptions = 0;
  let unfinished = 0;
  let worked = 0;
  let outside = 0;
  let absent = 0;
  let leave = 0;
  let nonworking = 0;
  const employees = new Set<string>();
  for (const row of rows) {
    employees.add(row.employeeId);
    if (row.status === "READY") ready += 1;
    else if (row.status === "EXCEPTION") exceptions += 1;
    else unfinished += 1;
    worked += row.workedMinutes;
    outside += row.outsideShiftMinutes;
    if (row.disposition === "ABSENT") absent += 1;
    if (row.disposition === "LEAVE") leave += 1;
    if (row.disposition === "NONWORKING") nonworking += 1;
  }
  return Object.freeze({
    employees: employees.size,
    days: rows.length,
    ready,
    exceptions,
    unfinished,
    workedMinutes: worked,
    outsideShiftMinutes: outside,
    absentDays: absent,
    leaveDays: leave,
    nonworkingDays: nonworking,
  });
}

export type CloseBlocker =
  | "PERIOD_INCLUDES_FUTURE"
  | "PERIOD_SHIFT_UNFINISHED"
  | "PERIOD_NOT_READY"
  | "PERIOD_EMPTY";

/** Why a period cannot close now, or null when every row is ready. */
export function closeBlocker(input: {
  readonly endDate: IsoDate;
  readonly today: IsoDate;
  readonly rows: readonly Pick<PeriodRow, "status">[];
}): CloseBlocker | null {
  if (compareDates(input.endDate, input.today) >= 0)
    return "PERIOD_INCLUDES_FUTURE";
  if (input.rows.length === 0) return "PERIOD_EMPTY";
  if (input.rows.some((row) => row.status === "EXCEPTION"))
    return "PERIOD_NOT_READY";
  if (input.rows.some((row) => row.status !== "READY"))
    return "PERIOD_SHIFT_UNFINISHED";
  return null;
}

/** Canonical text of the values a close freezes, for stale-review detection. */
export function periodFingerprintText(rows: readonly PeriodRow[]): string {
  return JSON.stringify(
    rows.map((row) => [
      row.employeeId,
      row.employeeCode,
      row.employeeName,
      row.businessDate,
      row.plan.kind,
      row.plan.kind === "SCHEDULED" ? row.plan.startAt : row.plan.reason,
      row.plan.kind === "SCHEDULED" ? row.plan.endAt : null,
      row.plan.breakMinutes,
      row.actualStartAt ?? null,
      row.actualEndAt ?? null,
      row.workedMinutes,
      row.outsideShiftMinutes,
      row.status,
      row.issue ?? null,
      row.disposition,
      row.correctionReason ?? null,
    ]),
  );
}
