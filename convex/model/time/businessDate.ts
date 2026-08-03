/**
 * Business date (`G-105`): a calendar day in the organization's timezone.
 *
 * Status: **implemented** as a pure value object. Nothing persists it yet: no
 * table stores a business date, and no Convex function produces one.
 *
 * Three rules shape this module.
 *
 * 1. **A business date is not a timestamp.** Timestamps are UTC epoch
 *    milliseconds (`G-111`); a business date is the day an operator would write
 *    on paper, in the organization's zone, default `Asia/Bangkok` (D-05). A UTC
 *    date is wrong for Bangkok for seven hours of every day.
 * 2. **No `Date`, no `Intl`, no locale.** `new Date("2026-08-03")` and
 *    `new Date(2026, 7, 3)` disagree by the host offset, `Intl` ordering is
 *    locale-dependent, and `String.prototype.localeCompare` orders by collation.
 *    Every conversion here is integer arithmetic over the proleptic Gregorian
 *    calendar, so a run on a laptop in Bangkok, a CI runner in UTC, and a
 *    Convex host in `us-east` produce the same value.
 * 3. **Buddhist Era is display-only** (`G-106`, D-06). BE never enters a stored
 *    field, a comparison, or a sort key. `formatBusinessDate` can render it; no
 *    function in this file parses it, and `compareBusinessDates` only accepts a
 *    `BusinessDate`, whose `year` is Gregorian by construction.
 *
 * Timezone support is deliberately narrow: only fixed-offset zones exist here,
 * and only the two the MVP needs. `Asia/Bangkok` has been UTC+7 with no daylight
 * saving since 1920, so fixed-offset arithmetic is exact for it. A zone with DST
 * cannot be added by writing an offset — it needs a real rule set, which is why
 * the registry is closed and `zoneById` fails on anything else.
 *
 * **Nothing here trusts the shape of its argument.** `BusinessDate` and
 * `FixedOffsetZone` are interfaces, so `{ year: 2026, month: 13, day: 40 } as
 * BusinessDate` and `{ id: "Asia/Bangkok", utcOffsetMinutes: 1e20 } as
 * FixedOffsetZone` both compile, and a date read back from a document is exactly
 * that kind of value. Every function below re-validates and returns a `Result`,
 * and a zone is only accepted when the closed registry holds that id *with that
 * offset* — a forged offset is `UNSUPPORTED_TIME_ZONE`, not arithmetic. That is
 * why `compareBusinessDates`, `businessDateToIso`, `daysBetween`, and
 * `startOfDayInstant` answer a `Result` rather than a bare value: an unvalidated
 * date would otherwise sort by `NaN` or render as `NaN-NaN-NaN`.
 *
 * Pure module (plan §6.2): no Convex imports.
 */
import {
  frozenRecord,
  isRecord,
  isSafeInt,
  isString,
  recordKeys,
  recordValue,
} from "../guards";
import { fail, ok, type Result } from "../result";

/* -------------------------------------------------------------------------- */
/* Bounds                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Representable years. The lower bound predates any plausible manufacture date
 * for stock in a WMS; the upper bound is past any plausible expiry. Both exist
 * so that a corrupt input (a 6-digit year, a negative epoch) is rejected rather
 * than producing an ISO string no index can be trusted to order.
 */
export const MIN_BUSINESS_YEAR = 1970;
export const MAX_BUSINESS_YEAR = 2999;

/** Milliseconds in a day. Fixed-offset zones have no shorter or longer days. */
const MS_PER_DAY = 86_400_000;

/** Day numbers (days since 1970-01-01) that bracket the representable years. */
const MIN_DAY_NUMBER = daysFromCivil(MIN_BUSINESS_YEAR, 1, 1);
const MAX_DAY_NUMBER = daysFromCivil(MAX_BUSINESS_YEAR, 12, 31);

/** Buddhist Era is 543 years ahead of the Common Era. Display only (`G-106`). */
export const BUDDHIST_ERA_YEAR_OFFSET = 543;

/* -------------------------------------------------------------------------- */
/* Values                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A Gregorian calendar day. Immutable, and only ever produced by the
 * constructors below, all of which validate. `month` is 1-12 and `day` is 1-31
 * — not the 0-based month of `Date`, which is a standing source of off-by-one
 * bugs.
 */
export interface BusinessDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/** A zone with a constant UTC offset. Not a general timezone (see the header). */
export interface FixedOffsetZone {
  readonly id: string;
  readonly utcOffsetMinutes: number;
}

/** The organization default (D-05). UTC+7 year round, no daylight saving. */
export const ASIA_BANGKOK: FixedOffsetZone = Object.freeze({
  id: "Asia/Bangkok",
  utcOffsetMinutes: 420,
});

/** Present for reporting and tests that need an unshifted day boundary. */
export const UTC: FixedOffsetZone = Object.freeze({
  id: "UTC",
  utcOffsetMinutes: 0,
});

/**
 * The closed registry. Adding a DST zone requires more than a table row.
 *
 * A frozen, null-prototype record rather than a `ReadonlyMap`: a `Map` typed
 * `ReadonlyMap` is still a `Map`, so one cast would have let any module register
 * a zone — or replace `Asia/Bangkok` — for the whole process.
 */
export const FIXED_OFFSET_ZONES: Readonly<Record<string, FixedOffsetZone>> =
  frozenRecord([
    [ASIA_BANGKOK.id, ASIA_BANGKOK],
    [UTC.id, UTC],
  ]);

/** Every supported zone id, sorted. The registry's only enumeration. */
export const supportedTimeZoneIds = (): readonly string[] =>
  recordKeys(FIXED_OFFSET_ZONES);

export type BusinessDateError =
  | { readonly code: "MALFORMED_ISO_DATE"; readonly raw: string }
  | {
      readonly code: "NOT_A_CALENDAR_DATE";
      readonly year: number;
      readonly month: number;
      readonly day: number;
    }
  | {
      readonly code: "YEAR_OUT_OF_RANGE";
      readonly year: number;
      readonly minimum: number;
      readonly maximum: number;
    }
  | { readonly code: "INSTANT_NOT_AN_INTEGER"; readonly epochMs: number }
  | { readonly code: "INSTANT_OUT_OF_RANGE"; readonly epochMs: number }
  | { readonly code: "UNSUPPORTED_TIME_ZONE"; readonly id: string };

/* -------------------------------------------------------------------------- */
/* Construction                                                                */
/* -------------------------------------------------------------------------- */

/** True for a leap year in the proleptic Gregorian calendar. */
export const isLeapYear = (year: number): boolean =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/** Days in a month, 1-12. Returns 0 for a month outside that range. */
export const daysInMonth = (year: number, month: number): number => {
  if (!Number.isInteger(month) || month < 1 || month > 12) return 0;
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
};

/** The only constructor. Rejects 2026-02-30 and every other non-day. */
export function makeBusinessDate(
  year: number,
  month: number,
  day: number,
): Result<BusinessDate, BusinessDateError> {
  if (!isSafeInt(year) || !isSafeInt(month) || !isSafeInt(day)) {
    return fail({
      code: "NOT_A_CALENDAR_DATE",
      year: numberOrNaN(year),
      month: numberOrNaN(month),
      day: numberOrNaN(day),
    });
  }
  if (year < MIN_BUSINESS_YEAR || year > MAX_BUSINESS_YEAR) {
    return fail({
      code: "YEAR_OUT_OF_RANGE",
      year,
      minimum: MIN_BUSINESS_YEAR,
      maximum: MAX_BUSINESS_YEAR,
    });
  }
  if (day < 1 || day > daysInMonth(year, month)) {
    return fail({ code: "NOT_A_CALENDAR_DATE", year, month, day });
  }
  return ok(Object.freeze({ year, month, day }));
}

/**
 * Re-checks a value that claims to be a `BusinessDate` and answers a frozen one.
 *
 * The gate every operation below goes through. A forged date is not exotic: it is
 * what a document field, a request body, or a cast produces, and an impossible
 * one must fail as an error rather than order a pick list by `NaN`.
 */
export function validateBusinessDate(
  date: BusinessDate,
): Result<BusinessDate, BusinessDateError> {
  if (!isRecord(date)) {
    return fail({
      code: "NOT_A_CALENDAR_DATE",
      year: Number.NaN,
      month: Number.NaN,
      day: Number.NaN,
    });
  }
  return makeBusinessDate(date.year, date.month, date.day);
}

/**
 * Re-checks a value that claims to be a zone against the closed registry: the id
 * must be registered *and* carry the offset the registry declares. A forged
 * offset on a real id is `UNSUPPORTED_TIME_ZONE`, because an offset this module
 * did not choose is not a zone it can do exact arithmetic for.
 */
export function validateTimeZone(
  zone: FixedOffsetZone,
): Result<FixedOffsetZone, BusinessDateError> {
  if (!isRecord(zone) || !isString(zone.id)) {
    return fail({ code: "UNSUPPORTED_TIME_ZONE", id: describe(zone) });
  }
  const registered = recordValue(FIXED_OFFSET_ZONES, zone.id);
  if (
    registered === null ||
    registered.utcOffsetMinutes !== zone.utcOffsetMinutes
  ) {
    return fail({ code: "UNSUPPORTED_TIME_ZONE", id: zone.id });
  }
  return ok(registered);
}

/**
 * Parses exactly `YYYY-MM-DD`. Deliberately strict: `2026-8-3`, `20260803`,
 * ` 2026-08-03`, and `2026-08-03T00:00:00Z` are all rejected, because a lenient
 * date parser is how a day silently shifts.
 */
export function parseBusinessDate(
  raw: string,
): Result<BusinessDate, BusinessDateError> {
  if (!isString(raw)) {
    return fail({ code: "MALFORMED_ISO_DATE", raw: describe(raw) });
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (match === null) return fail({ code: "MALFORMED_ISO_DATE", raw });
  return makeBusinessDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

/** `YYYY-MM-DD`. The only storage and index form (D-05). */
export const businessDateToIso = (
  date: BusinessDate,
): Result<string, BusinessDateError> => {
  const validated = validateBusinessDate(date);
  return validated.ok ? ok(isoOf(validated.value)) : validated;
};

/**
 * The business date an instant falls on, in the given zone. This is the only
 * bridge from a timestamp to a day, and it takes the zone explicitly so no
 * caller can accidentally use the host's.
 */
export function businessDateFromInstant(
  epochMs: number,
  zone: FixedOffsetZone,
): Result<BusinessDate, BusinessDateError> {
  const validatedZone = validateTimeZone(zone);
  if (!validatedZone.ok) return validatedZone;
  if (!isSafeInt(epochMs)) {
    return fail({
      code: "INSTANT_NOT_AN_INTEGER",
      epochMs: numberOrNaN(epochMs),
    });
  }
  const localMs = epochMs + validatedZone.value.utcOffsetMinutes * 60_000;
  const dayNumber = Math.floor(localMs / MS_PER_DAY);
  if (dayNumber < MIN_DAY_NUMBER || dayNumber > MAX_DAY_NUMBER) {
    return fail({ code: "INSTANT_OUT_OF_RANGE", epochMs });
  }
  const civil = civilFromDays(dayNumber);
  return makeBusinessDate(civil.year, civil.month, civil.day);
}

/**
 * The instant a business day begins in a zone. Round-trips with
 * `businessDateFromInstant` for every representable day, which is the property
 * that proves the two conversions agree.
 */
export const startOfDayInstant = (
  date: BusinessDate,
  zone: FixedOffsetZone,
): Result<number, BusinessDateError> => {
  const validated = validateBusinessDate(date);
  if (!validated.ok) return validated;
  const validatedZone = validateTimeZone(zone);
  if (!validatedZone.ok) return validatedZone;
  return ok(
    daysFromCivil(
      validated.value.year,
      validated.value.month,
      validated.value.day,
    ) *
      MS_PER_DAY -
      validatedZone.value.utcOffsetMinutes * 60_000,
  );
};

/** Looks a zone up by id. Fails closed rather than defaulting to UTC. */
export function zoneById(
  id: string,
): Result<FixedOffsetZone, BusinessDateError> {
  if (!isString(id)) {
    return fail({ code: "UNSUPPORTED_TIME_ZONE", id: describe(id) });
  }
  const zone = recordValue(FIXED_OFFSET_ZONES, id);
  return zone === null ? fail({ code: "UNSUPPORTED_TIME_ZONE", id }) : ok(zone);
}

/* -------------------------------------------------------------------------- */
/* Arithmetic and ordering                                                     */
/* -------------------------------------------------------------------------- */

/**
 * -1, 0, or 1, or a named error for an operand that is not a calendar day.
 * Compares the calendar fields directly: no `Date`, no string collation, no
 * locale — `localeCompare` would order `"2026-08-03"` by the host's collation
 * table, which is not a promise any locale keeps.
 */
export function compareBusinessDates(
  a: BusinessDate,
  b: BusinessDate,
): Result<number, BusinessDateError> {
  const left = validateBusinessDate(a);
  if (!left.ok) return left;
  const right = validateBusinessDate(b);
  if (!right.ok) return right;
  return ok(compareValidBusinessDates(left.value, right.value));
}

/** Structural equality; `BusinessDate` has no identity beyond its fields. */
export const businessDatesEqual = (
  a: BusinessDate,
  b: BusinessDate,
): Result<boolean, BusinessDateError> => {
  const compared = compareBusinessDates(a, b);
  return compared.ok ? ok(compared.value === 0) : compared;
};

/** Shifts by whole days. Rejects a shift out of the representable range. */
export function addDays(
  date: BusinessDate,
  days: number,
): Result<BusinessDate, BusinessDateError> {
  const validated = validateBusinessDate(date);
  if (!validated.ok) return validated;
  if (!isSafeInt(days)) {
    return fail({
      code: "INSTANT_NOT_AN_INTEGER",
      epochMs: numberOrNaN(days),
    });
  }
  const dayNumber =
    daysFromCivil(
      validated.value.year,
      validated.value.month,
      validated.value.day,
    ) + days;
  if (dayNumber < MIN_DAY_NUMBER || dayNumber > MAX_DAY_NUMBER) {
    return fail({ code: "INSTANT_OUT_OF_RANGE", epochMs: days });
  }
  const civil = civilFromDays(dayNumber);
  return makeBusinessDate(civil.year, civil.month, civil.day);
}

/** Signed whole days from `from` to `to`. Exact for every representable pair. */
export const daysBetween = (
  from: BusinessDate,
  to: BusinessDate,
): Result<number, BusinessDateError> => {
  const start = validateBusinessDate(from);
  if (!start.ok) return start;
  const end = validateBusinessDate(to);
  if (!end.ok) return end;
  return ok(
    daysFromCivil(end.value.year, end.value.month, end.value.day) -
      daysFromCivil(start.value.year, start.value.month, start.value.day),
  );
};

/**
 * The last day of a month. Needed because GS1 dates may carry `00` as the day
 * (`convex/model/gs1/date.ts`), and resolving that to a real day is a policy
 * the caller chooses rather than something a parser guesses.
 */
export const endOfMonth = (
  year: number,
  month: number,
): Result<BusinessDate, BusinessDateError> =>
  makeBusinessDate(year, month, daysInMonth(year, month));

/* -------------------------------------------------------------------------- */
/* Display                                                                     */
/* -------------------------------------------------------------------------- */

/** Calendar representations. `BUDDHIST` is for rendering only (`G-106`). */
export type DisplayCalendar = "GREGORIAN" | "BUDDHIST";

/**
 * Formats for display. `BUDDHIST` adds 543 to the Gregorian year and is only
 * ever an output: no parser in this module accepts a BE year, so a BE value
 * cannot re-enter storage or ordering by accident.
 */
export const formatBusinessDate = (
  date: BusinessDate,
  calendar: DisplayCalendar = "GREGORIAN",
): Result<string, BusinessDateError> => {
  const validated = validateBusinessDate(date);
  if (!validated.ok) return validated;
  const { year, month, day } = validated.value;
  return ok(
    calendar === "GREGORIAN"
      ? isoOf(validated.value)
      : `${pad(year + BUDDHIST_ERA_YEAR_OFFSET, 4)}-${pad(month, 2)}-${pad(day, 2)}`,
  );
};

/* -------------------------------------------------------------------------- */
/* Calendar arithmetic                                                         */
/* -------------------------------------------------------------------------- */

/** `YYYY-MM-DD` for a date this module has already validated. */
const isoOf = (date: BusinessDate): string =>
  `${pad(date.year, 4)}-${pad(date.month, 2)}-${pad(date.day, 2)}`;

/**
 * Field order on two dates this module has already validated. Private on
 * purpose: an exported comparator that skips validation is exactly the hole
 * `compareBusinessDates` closes, and a caller outside this file cannot have
 * established the precondition.
 *
 * Callers that need to order many dates cheaply compare their ISO forms instead:
 * `YYYY-MM-DD` sorts chronologically by code unit for every representable year,
 * and `businessDateToIso` validates on the way in.
 */
const compareValidBusinessDates = (
  a: BusinessDate,
  b: BusinessDate,
): number => {
  if (a.year !== b.year) return a.year < b.year ? -1 : 1;
  if (a.month !== b.month) return a.month < b.month ? -1 : 1;
  if (a.day !== b.day) return a.day < b.day ? -1 : 1;
  return 0;
};

/**
 * Days since 1970-01-01 for a proleptic Gregorian date, and its inverse below.
 * These are Howard Hinnant's `days_from_civil` / `civil_from_days`, which are
 * branch-free integer algorithms valid across eras. They replace `Date.UTC`
 * because `Date` carries a host-dependent parsing surface we do not want
 * anywhere near a stored day.
 */
function daysFromCivil(year: number, month: number, day: number): number {
  const shifted = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(shifted / 400);
  const yearOfEra = shifted - era * 400;
  const dayOfYear =
    Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 +
    Math.floor(yearOfEra / 4) -
    Math.floor(yearOfEra / 100) +
    dayOfYear;
  return era * 146_097 + dayOfEra - 719_468;
}

function civilFromDays(dayNumber: number): {
  year: number;
  month: number;
  day: number;
} {
  const shifted = dayNumber + 719_468;
  const era = Math.floor(shifted / 146_097);
  const dayOfEra = shifted - era * 146_097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36_524) -
      Math.floor(dayOfEra / 146_096)) /
      365,
  );
  const dayOfYear =
    dayOfEra -
    (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthPrime = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthPrime + 2) / 5) + 1;
  const month = monthPrime + (monthPrime < 10 ? 3 : -9);
  return { year: yearOfEra + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

/** Zero-pads a non-negative integer. No `Intl`: grouping is locale-dependent. */
const pad = (value: number, width: number): string =>
  String(value).padStart(width, "0");

/** A number for an error field, so a forged operand still reports something. */
const numberOrNaN = (value: unknown): number =>
  typeof value === "number" ? value : Number.NaN;

/** The shape of a value that is not a date or a zone, for the error field. */
const describe = (value: unknown): string =>
  value === null ? "null" : typeof value;
