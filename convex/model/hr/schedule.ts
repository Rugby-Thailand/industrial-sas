/**
 * HR schedules and the planned day they produce.
 *
 * Status: one shift per employee per business date, ISO weekday working days,
 * a local start/end time, an explicit "ends next day" flag and unpaid break
 * minutes. Site holidays and unscheduled weekdays are nonworking, not absence.
 * No rotations, swaps or per-date overrides.
 */
import { fail, ok, type Result } from "../result";
import {
  MS_PER_MINUTE,
  MINUTES_PER_DAY,
  addDays,
  compareDates,
  fromLocal,
  isIsoDate,
  isoWeekday,
  parseLocalTime,
  toLocal,
  type IsoDate,
} from "./calendar";

/** Longest shift or attendance interval treated as plausible (16 hours). */
export const MAX_PLAUSIBLE_MINUTES = 16 * 60;
/** An open day becomes an exception this long after its planned end. */
export const OPEN_DAY_GRACE_MINUTES = 4 * 60;

export interface Schedule {
  /** ISO weekdays, 1 = Monday … 7 = Sunday. */
  readonly workDays: number[];
  readonly startTime: string;
  readonly endTime: string;
  readonly endsNextDay: boolean;
  readonly breakMinutes: number;
}

export type ScheduleError =
  | { readonly code: "SCHEDULE_DAYS_INVALID" }
  | { readonly code: "SCHEDULE_TIME_INVALID"; readonly field: string }
  | { readonly code: "SCHEDULE_DURATION_INVALID" }
  | { readonly code: "SCHEDULE_BREAK_INVALID" };

export function shiftMinutes(schedule: Schedule): number | null {
  const start = parseLocalTime(schedule.startTime);
  const end = parseLocalTime(schedule.endTime);
  if (start === null || end === null) return null;
  return end + (schedule.endsNextDay ? MINUTES_PER_DAY : 0) - start;
}

/** ISO weekday (1–7); `0` is accepted as the JavaScript spelling of Sunday. */
export const normalizeWeekday = (day: number): number => (day === 0 ? 7 : day);

export function validateSchedule(
  schedule: Schedule,
): Result<Schedule, ScheduleError> {
  const days = Array.isArray(schedule.workDays)
    ? schedule.workDays.map(normalizeWeekday)
    : schedule.workDays;
  if (
    !Array.isArray(days) ||
    days.length > 7 ||
    new Set(days).size !== days.length ||
    days.some((day) => !Number.isInteger(day) || day < 1 || day > 7)
  )
    return fail({ code: "SCHEDULE_DAYS_INVALID" });
  if (parseLocalTime(schedule.startTime) === null)
    return fail({ code: "SCHEDULE_TIME_INVALID", field: "startTime" });
  if (parseLocalTime(schedule.endTime) === null)
    return fail({ code: "SCHEDULE_TIME_INVALID", field: "endTime" });
  const duration = shiftMinutes(schedule);
  if (duration === null || duration <= 0 || duration > MAX_PLAUSIBLE_MINUTES)
    return fail({ code: "SCHEDULE_DURATION_INVALID" });
  if (
    !Number.isInteger(schedule.breakMinutes) ||
    schedule.breakMinutes < 0 ||
    schedule.breakMinutes >= duration
  )
    return fail({ code: "SCHEDULE_BREAK_INVALID" });
  return ok(
    Object.freeze({
      workDays: [...days].sort((a, b) => a - b),
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      endsNextDay: schedule.endsNextDay,
      breakMinutes: schedule.breakMinutes,
    }),
  );
}

export type NonworkingReason = "HOLIDAY" | "UNSCHEDULED" | "NO_SCHEDULE";

/** The plan used for one business date, captured when attendance is recorded. */
export type DayPlan =
  | {
      readonly kind: "SCHEDULED";
      readonly startAt: number;
      readonly endAt: number;
      readonly breakMinutes: number;
      readonly startTime: string;
      readonly endTime: string;
      readonly endsNextDay: boolean;
    }
  | {
      readonly kind: "NONWORKING";
      readonly reason: NonworkingReason;
      readonly holidayName?: string;
      readonly breakMinutes: 0;
    };

export interface Employment {
  readonly startDate: IsoDate;
  readonly endDate?: IsoDate | undefined;
}

export const isEmployedOn = (employment: Employment, date: IsoDate): boolean =>
  compareDates(date, employment.startDate) >= 0 &&
  (employment.endDate === undefined ||
    compareDates(date, employment.endDate) <= 0);

export function planFor(input: {
  readonly date: IsoDate;
  readonly schedule: Schedule | undefined;
  readonly holidayName: string | undefined;
  readonly offsetMinutes: number;
}): DayPlan {
  const { date, schedule, holidayName, offsetMinutes } = input;
  if (holidayName !== undefined)
    return Object.freeze({
      kind: "NONWORKING",
      reason: "HOLIDAY",
      holidayName,
      breakMinutes: 0,
    });
  if (schedule === undefined)
    return Object.freeze({
      kind: "NONWORKING",
      reason: "NO_SCHEDULE",
      breakMinutes: 0,
    });
  if (!schedule.workDays.map(normalizeWeekday).includes(isoWeekday(date)))
    return Object.freeze({
      kind: "NONWORKING",
      reason: "UNSCHEDULED",
      breakMinutes: 0,
    });
  const start = parseLocalTime(schedule.startTime) ?? 0;
  const end =
    (parseLocalTime(schedule.endTime) ?? 0) +
    (schedule.endsNextDay ? MINUTES_PER_DAY : 0);
  return Object.freeze({
    kind: "SCHEDULED",
    startAt: fromLocal(date, start, offsetMinutes),
    endAt: fromLocal(date, end, offsetMinutes),
    breakMinutes: schedule.breakMinutes,
    startTime: schedule.startTime,
    endTime: schedule.endTime,
    endsNextDay: schedule.endsNextDay,
  });
}

/**
 * The business date a clock-in at `now` belongs to.
 *
 * A clock-in before yesterday's overnight shift has ended belongs to
 * yesterday when yesterday has not been clocked into yet (a late overnight
 * arrival). Otherwise it is the local calendar date.
 */
export function resolveClockInDate(input: {
  readonly now: number;
  readonly offsetMinutes: number;
  readonly planOf: (date: IsoDate) => DayPlan;
  readonly hasClockIn: (date: IsoDate) => boolean;
}): IsoDate {
  const today = toLocal(input.now, input.offsetMinutes).date;
  const yesterday = addDays(today, -1);
  const previous = input.planOf(yesterday);
  if (
    previous.kind === "SCHEDULED" &&
    previous.endsNextDay &&
    input.now < previous.endAt &&
    !input.hasClockIn(yesterday)
  )
    return yesterday;
  return today;
}

/** The instant after which an open day without a clock-out is an exception. */
export function openDayDeadline(plan: DayPlan, clockInAt: number): number {
  const longest = clockInAt + MAX_PLAUSIBLE_MINUTES * MS_PER_MINUTE;
  if (plan.kind !== "SCHEDULED") return longest;
  return Math.min(
    longest,
    Math.max(plan.endAt, clockInAt) + OPEN_DAY_GRACE_MINUTES * MS_PER_MINUTE,
  );
}

/**
 * A proposed start belongs to the business date when it is on that date, or
 * — for an overnight shift only — after midnight but before the planned end
 * (a late arrival). A day shift's next-day events belong to the next date.
 */
export function startBelongsToDate(
  plan: DayPlan,
  date: IsoDate,
  offset: number,
  start: { readonly minute: number; readonly nextDay: boolean } | undefined,
): boolean {
  if (start === undefined || !start.nextDay) return true;
  if (plan.kind !== "SCHEDULED" || !plan.endsNextDay) return false;
  return fromLocal(date, start.minute + 1440, offset) < plan.endAt;
}

export const isValidDate = isIsoDate;
