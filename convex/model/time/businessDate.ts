import {
  frozenRecord,
  isRecord,
  isSafeInt,
  isString,
  recordKeys,
  recordValue,
} from "../guards";
import { fail, ok, type Result } from "../result";

export const MIN_BUSINESS_YEAR = 1970;
export const MAX_BUSINESS_YEAR = 2999;

const MS_PER_DAY = 86_400_000;

const MIN_DAY_NUMBER = daysFromCivil(MIN_BUSINESS_YEAR, 1, 1);
const MAX_DAY_NUMBER = daysFromCivil(MAX_BUSINESS_YEAR, 12, 31);

export const BUDDHIST_ERA_YEAR_OFFSET = 543;

export interface BusinessDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

export interface FixedOffsetZone {
  readonly id: string;
  readonly utcOffsetMinutes: number;
}

export const ASIA_BANGKOK: FixedOffsetZone = Object.freeze({
  id: "Asia/Bangkok",
  utcOffsetMinutes: 420,
});

export const UTC: FixedOffsetZone = Object.freeze({
  id: "UTC",
  utcOffsetMinutes: 0,
});

export const FIXED_OFFSET_ZONES: Readonly<Record<string, FixedOffsetZone>> =
  frozenRecord([
    [ASIA_BANGKOK.id, ASIA_BANGKOK],
    [UTC.id, UTC],
  ]);

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
  | { readonly code: "UNSUPPORTED_TIME_ZONE"; readonly id: string }
  | {
      readonly code: "UNSUPPORTED_DISPLAY_CALENDAR";
      readonly calendar: string;
    };

export const isLeapYear = (year: number): boolean =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

export const daysInMonth = (year: number, month: number): number => {
  if (!Number.isInteger(month) || month < 1 || month > 12) return 0;
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
};

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

export const businessDateToIso = (
  date: BusinessDate,
): Result<string, BusinessDateError> => {
  const validated = validateBusinessDate(date);
  return validated.ok ? ok(isoOf(validated.value)) : validated;
};

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

export function zoneById(
  id: string,
): Result<FixedOffsetZone, BusinessDateError> {
  if (!isString(id)) {
    return fail({ code: "UNSUPPORTED_TIME_ZONE", id: describe(id) });
  }
  const zone = recordValue(FIXED_OFFSET_ZONES, id);
  return zone === null ? fail({ code: "UNSUPPORTED_TIME_ZONE", id }) : ok(zone);
}

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

export const businessDatesEqual = (
  a: BusinessDate,
  b: BusinessDate,
): Result<boolean, BusinessDateError> => {
  const compared = compareBusinessDates(a, b);
  return compared.ok ? ok(compared.value === 0) : compared;
};

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

export const endOfMonth = (
  year: number,
  month: number,
): Result<BusinessDate, BusinessDateError> =>
  makeBusinessDate(year, month, daysInMonth(year, month));

export type DisplayCalendar = "GREGORIAN" | "BUDDHIST";

export const formatBusinessDate = (
  date: BusinessDate,
  calendar: DisplayCalendar = "GREGORIAN",
): Result<string, BusinessDateError> => {
  if (calendar !== "GREGORIAN" && calendar !== "BUDDHIST") {
    return fail({
      code: "UNSUPPORTED_DISPLAY_CALENDAR",
      calendar: isString(calendar) ? calendar : describe(calendar),
    });
  }
  const validated = validateBusinessDate(date);
  if (!validated.ok) return validated;
  const { year, month, day } = validated.value;
  return ok(
    calendar === "GREGORIAN"
      ? isoOf(validated.value)
      : `${pad(year + BUDDHIST_ERA_YEAR_OFFSET, 4)}-${pad(month, 2)}-${pad(day, 2)}`,
  );
};

const isoOf = (date: BusinessDate): string =>
  `${pad(date.year, 4)}-${pad(date.month, 2)}-${pad(date.day, 2)}`;

const compareValidBusinessDates = (
  a: BusinessDate,
  b: BusinessDate,
): number => {
  if (a.year !== b.year) return a.year < b.year ? -1 : 1;
  if (a.month !== b.month) return a.month < b.month ? -1 : 1;
  if (a.day !== b.day) return a.day < b.day ? -1 : 1;
  return 0;
};

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

const pad = (value: number, width: number): string =>
  String(value).padStart(width, "0");

const numberOrNaN = (value: unknown): number =>
  typeof value === "number" ? value : Number.NaN;

const describe = (value: unknown): string =>
  value === null ? "null" : typeof value;
