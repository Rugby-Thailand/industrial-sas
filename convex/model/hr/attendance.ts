/**
 * HR attendance day evaluation: the status, effective interval and minutes of
 * one employee business date.
 *
 * Status: implemented. Originals are never altered here; a certification is a
 * separate input that is valid only for the day revision it was made against,
 * so a later punch automatically invalidates it. Minutes are informational
 * attendance figures, not pay, overtime entitlement or lateness judgements.
 */
import { fail, ok, type Result } from "../result";
import { MS_PER_MINUTE, fromLocal, type IsoDate } from "./calendar";
import {
  MAX_PLAUSIBLE_MINUTES,
  openDayDeadline,
  type DayPlan,
} from "./schedule";

export type Disposition = "WORKED" | "ABSENT" | "LEAVE" | "NONWORKING";
export const DISPOSITIONS: readonly Disposition[] = Object.freeze([
  "WORKED",
  "ABSENT",
  "LEAVE",
  "NONWORKING",
]);

export type DayIssue =
  | "MISSING_RECORD"
  | "MISSING_END"
  | "IMPLAUSIBLE"
  | "UNPLANNED_WORK"
  | "PENDING_CORRECTION";

/**
 * READY — complete and closeable. EXCEPTION — needs review. IN_PROGRESS — an
 * open day still inside its window. UPCOMING — scheduled, not over yet.
 */
export type DayStatus = "READY" | "EXCEPTION" | "IN_PROGRESS" | "UPCOMING";

export interface Certification {
  readonly disposition: Disposition;
  readonly startAt?: number | undefined;
  readonly endAt?: number | undefined;
  /** The day revision this certification was recorded as. */
  readonly revision: number;
}

export interface DayInput {
  readonly plan: DayPlan;
  readonly now: number;
  readonly revision: number;
  readonly clockInAt?: number | undefined;
  readonly clockOutAt?: number | undefined;
  readonly certification?: Certification | undefined;
  readonly pendingCorrection: boolean;
}

export interface DayEvaluation {
  readonly status: DayStatus;
  readonly issue?: DayIssue;
  readonly disposition: Disposition | null;
  readonly effectiveStartAt?: number;
  readonly effectiveEndAt?: number;
  readonly workedMinutes: number;
  readonly outsideShiftMinutes: number;
  readonly certified: boolean;
}

const minutesBetween = (start: number, end: number) =>
  Math.max(0, Math.floor((end - start) / MS_PER_MINUTE));

export function workedMinutes(
  startAt: number,
  endAt: number,
  breakMinutes: number,
): number {
  return Math.max(0, minutesBetween(startAt, endAt) - breakMinutes);
}

/**
 * Minutes of the interval that fall outside the planned shift (information
 * only). Computed from milliseconds and floored once, so seconds either side
 * of the plan never round up into an invented minute.
 */
export function outsideShiftMinutes(
  plan: DayPlan,
  startAt: number,
  endAt: number,
): number {
  const total = Math.max(0, endAt - startAt);
  if (plan.kind !== "SCHEDULED") return Math.floor(total / MS_PER_MINUTE);
  const overlap = Math.max(
    0,
    Math.min(endAt, plan.endAt) - Math.max(startAt, plan.startAt),
  );
  return Math.floor(Math.max(0, total - overlap) / MS_PER_MINUTE);
}

const isPlausible = (startAt: number, endAt: number) =>
  endAt > startAt && endAt - startAt <= MAX_PLAUSIBLE_MINUTES * MS_PER_MINUTE;

export const certificationIsCurrent = (
  certification: Certification | undefined,
  revision: number,
): certification is Certification =>
  certification !== undefined && certification.revision === revision;

function worked(
  plan: DayPlan,
  startAt: number,
  endAt: number,
): Pick<
  DayEvaluation,
  | "effectiveStartAt"
  | "effectiveEndAt"
  | "workedMinutes"
  | "outsideShiftMinutes"
> {
  return {
    effectiveStartAt: startAt,
    effectiveEndAt: endAt,
    workedMinutes: workedMinutes(startAt, endAt, plan.breakMinutes),
    outsideShiftMinutes: outsideShiftMinutes(plan, startAt, endAt),
  };
}

export function evaluateDay(input: DayInput): DayEvaluation {
  const { plan, now, clockInAt, clockOutAt } = input;
  const zero = { workedMinutes: 0, outsideShiftMinutes: 0 };
  const certification = certificationIsCurrent(
    input.certification,
    input.revision,
  )
    ? input.certification
    : undefined;

  const base = ((): DayEvaluation => {
    if (certification !== undefined) {
      if (
        certification.disposition === "WORKED" &&
        certification.startAt !== undefined &&
        certification.endAt !== undefined
      )
        return Object.freeze({
          status: "READY",
          disposition: "WORKED",
          certified: true,
          ...worked(plan, certification.startAt, certification.endAt),
        });
      return Object.freeze({
        status: "READY",
        disposition: certification.disposition,
        certified: true,
        ...zero,
      });
    }
    if (clockInAt !== undefined && clockOutAt !== undefined) {
      const interval = worked(plan, clockInAt, clockOutAt);
      if (!isPlausible(clockInAt, clockOutAt))
        return Object.freeze({
          status: "EXCEPTION",
          issue: "IMPLAUSIBLE",
          disposition: null,
          certified: false,
          ...interval,
        });
      if (plan.kind !== "SCHEDULED")
        return Object.freeze({
          status: "EXCEPTION",
          issue: "UNPLANNED_WORK",
          disposition: null,
          certified: false,
          ...interval,
        });
      return Object.freeze({
        status: "READY",
        disposition: "WORKED",
        certified: false,
        ...interval,
      });
    }
    if (clockInAt !== undefined) {
      return Object.freeze({
        status:
          now < openDayDeadline(plan, clockInAt) ? "IN_PROGRESS" : "EXCEPTION",
        ...(now < openDayDeadline(plan, clockInAt)
          ? {}
          : { issue: "MISSING_END" as const }),
        disposition: null,
        effectiveStartAt: clockInAt,
        certified: false,
        ...zero,
      });
    }
    if (plan.kind !== "SCHEDULED")
      return Object.freeze({
        status: "READY",
        disposition: "NONWORKING",
        certified: false,
        ...zero,
      });
    if (now < plan.endAt)
      return Object.freeze({
        status: "UPCOMING",
        disposition: null,
        certified: false,
        ...zero,
      });
    return Object.freeze({
      status: "EXCEPTION",
      issue: "MISSING_RECORD",
      disposition: null,
      certified: false,
      ...zero,
    });
  })();

  if (!input.pendingCorrection) return base;
  return Object.freeze({
    ...base,
    status: "EXCEPTION",
    issue: "PENDING_CORRECTION",
  });
}

/** One side of a proposed correction: a local time on the business date or the next day. */
export interface LocalTimeInput {
  readonly minute: number;
  readonly nextDay: boolean;
}

export type IntervalError =
  | { readonly code: "CORRECTION_INCOMPLETE" }
  | { readonly code: "CORRECTION_ORDER_INVALID" }
  | { readonly code: "CORRECTION_TOO_LONG" }
  | { readonly code: "CORRECTION_IN_FUTURE" }
  | { readonly code: "CORRECTION_TIME_INVALID" };

/**
 * Resolve a proposed interval for one business date. Missing sides fall back
 * to the original events; the merged pair must be complete, ordered, at most
 * `MAX_PLAUSIBLE_MINUTES` long and not in the future.
 */
export function resolveProposedInterval(input: {
  readonly businessDate: IsoDate;
  readonly offsetMinutes: number;
  readonly now: number;
  readonly start?: LocalTimeInput | undefined;
  readonly end?: LocalTimeInput | undefined;
  readonly originalStartAt?: number | undefined;
  readonly originalEndAt?: number | undefined;
}): Result<
  { readonly startAt: number; readonly endAt: number },
  IntervalError
> {
  const instant = (
    side: LocalTimeInput | undefined,
  ): number | undefined | null => {
    if (side === undefined) return undefined;
    if (
      !Number.isInteger(side.minute) ||
      side.minute < 0 ||
      side.minute >= 1440 ||
      typeof side.nextDay !== "boolean"
    )
      return null;
    return fromLocal(
      input.businessDate,
      side.minute + (side.nextDay ? 1440 : 0),
      input.offsetMinutes,
    );
  };
  const start = instant(input.start);
  const end = instant(input.end);
  if (start === null || end === null)
    return fail({ code: "CORRECTION_TIME_INVALID" });
  const startAt = start ?? input.originalStartAt;
  const endAt = end ?? input.originalEndAt;
  if (startAt === undefined || endAt === undefined)
    return fail({ code: "CORRECTION_INCOMPLETE" });
  if (endAt <= startAt) return fail({ code: "CORRECTION_ORDER_INVALID" });
  if (endAt - startAt > MAX_PLAUSIBLE_MINUTES * MS_PER_MINUTE)
    return fail({ code: "CORRECTION_TOO_LONG" });
  if (endAt > input.now || startAt > input.now)
    return fail({ code: "CORRECTION_IN_FUTURE" });
  return ok(Object.freeze({ startAt, endAt }));
}
