/**
 * HR calendar arithmetic: ISO business dates, local wall-clock minutes and
 * instants in a fixed-offset organization timezone.
 *
 * Status: implemented for fixed-offset zones only. Zones with daylight-saving
 * transitions are refused (`TIMEZONE_UNSUPPORTED`) rather than approximated,
 * because a one-hour error in a clock record is a payroll error. No `Date`
 * parsing and no `Intl`: the browser's local zone can never leak into a
 * business date.
 */
import { fail, ok, type Result } from "../result";

export const MINUTES_PER_DAY = 1440;
export const MS_PER_MINUTE = 60_000;
export const MS_PER_DAY = MINUTES_PER_DAY * MS_PER_MINUTE;

/** ISO `YYYY-MM-DD` business date. */
export type IsoDate = string;

/** Fixed UTC offsets in minutes for the zones this module accepts. */
const FIXED_OFFSET_ZONES: Readonly<Record<string, number>> = Object.freeze(
  Object.assign(Object.create(null) as Record<string, number>, {
    UTC: 0,
    "Asia/Bangkok": 420,
    "Asia/Ho_Chi_Minh": 420,
    "Asia/Jakarta": 420,
    "Asia/Phnom_Penh": 420,
    "Asia/Vientiane": 420,
    "Asia/Yangon": 390,
    "Asia/Kolkata": 330,
    "Asia/Singapore": 480,
    "Asia/Kuala_Lumpur": 480,
    "Asia/Manila": 480,
    "Asia/Shanghai": 480,
    "Asia/Hong_Kong": 480,
    "Asia/Taipei": 480,
    "Asia/Tokyo": 540,
    "Asia/Seoul": 540,
  }),
);

export function timezoneOffsetMinutes(
  timezone: string,
): Result<number, { readonly code: "TIMEZONE_UNSUPPORTED" }> {
  const offset =
    typeof timezone === "string" &&
    Object.prototype.hasOwnProperty.call(FIXED_OFFSET_ZONES, timezone)
      ? FIXED_OFFSET_ZONES[timezone]
      : undefined;
  return offset === undefined
    ? fail({ code: "TIMEZONE_UNSUPPORTED" as const })
    : ok(offset);
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Days since 1970-01-01 for a proleptic Gregorian date (Hinnant). */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy =
    Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function civilFromDays(days: number): {
  year: number;
  month: number;
  day: number;
} {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe -
      Math.floor(doe / 1460) +
      Math.floor(doe / 36524) -
      Math.floor(doe / 146096)) /
      365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp + (mp < 10 ? 3 : -9);
  return { year: yoe + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

const pad = (value: number, width = 2) => String(value).padStart(width, "0");

function formatDays(days: number): IsoDate {
  const { year, month, day } = civilFromDays(days);
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** Day number of a real calendar date, or null for `2026-02-30`, `2026-9-1`, etc. */
export function dayNumber(date: unknown): number | null {
  if (typeof date !== "string") return null;
  const match = DATE_PATTERN.exec(date);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || year > 2999 || month < 1 || month > 12 || day < 1)
    return null;
  const days = daysFromCivil(year, month, day);
  return formatDays(days) === date ? days : null;
}

export const isIsoDate = (date: unknown): date is IsoDate =>
  dayNumber(date) !== null;

export function addDays(date: IsoDate, delta: number): IsoDate {
  const days = dayNumber(date);
  if (days === null || !Number.isSafeInteger(delta))
    throw new RangeError("addDays received an invalid date");
  return formatDays(days + delta);
}

/** Inclusive count of dates from `from` to `to`; zero or negative when reversed. */
export function inclusiveDayCount(from: IsoDate, to: IsoDate): number {
  const start = dayNumber(from);
  const end = dayNumber(to);
  if (start === null || end === null) return 0;
  return end - start + 1;
}

export function datesInRange(from: IsoDate, to: IsoDate): readonly IsoDate[] {
  const count = inclusiveDayCount(from, to);
  return Object.freeze(
    Array.from({ length: Math.max(0, count) }, (_, index) =>
      addDays(from, index),
    ),
  );
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: IsoDate): number {
  const days = dayNumber(date);
  if (days === null) throw new RangeError("isoWeekday received invalid date");
  return ((((days % 7) + 7 + 3) % 7) + 1) as number;
}

export const compareDates = (left: IsoDate, right: IsoDate): number =>
  left < right ? -1 : left > right ? 1 : 0;

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Minutes after local midnight for `HH:MM`, or null. */
export function parseLocalTime(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = TIME_PATTERN.exec(value);
  return match === null ? null : Number(match[1]) * 60 + Number(match[2]);
}

export const formatLocalTime = (minutes: number): string =>
  `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;

export interface LocalMoment {
  readonly date: IsoDate;
  readonly minute: number;
}

/** The organization-local date and minute of a UTC instant. */
export function toLocal(instant: number, offsetMinutes: number): LocalMoment {
  const local = instant + offsetMinutes * MS_PER_MINUTE;
  const days = Math.floor(local / MS_PER_DAY);
  return Object.freeze({
    date: formatDays(days),
    minute: Math.floor((local - days * MS_PER_DAY) / MS_PER_MINUTE),
  });
}

/** UTC instant of an organization-local date plus minutes (may exceed a day). */
export function fromLocal(
  date: IsoDate,
  minute: number,
  offsetMinutes: number,
): number {
  const days = dayNumber(date);
  if (days === null || !Number.isSafeInteger(minute))
    throw new RangeError("fromLocal received an invalid date or minute");
  return (days * MINUTES_PER_DAY + minute - offsetMinutes) * MS_PER_MINUTE;
}

/** ISO 8601 UTC instant with second precision, e.g. `2026-10-08T01:23:45Z`. */
export function isoInstant(instant: number): string {
  if (!Number.isSafeInteger(instant))
    throw new RangeError("isoInstant received an invalid instant");
  const { date, minute } = toLocal(instant, 0);
  const seconds = Math.floor(
    (((instant % MS_PER_MINUTE) + MS_PER_MINUTE) % MS_PER_MINUTE) / 1000,
  );
  return `${date}T${formatLocalTime(minute)}:${pad(seconds)}Z`;
}

export const businessDateOf = (
  instant: number,
  offsetMinutes: number,
): IsoDate => toLocal(instant, offsetMinutes).date;
