import { isRecord, isSafeInt, isString } from "../guards";
import { fail, ok, type Result } from "../result";
import {
  endOfMonth,
  makeBusinessDate,
  MAX_BUSINESS_YEAR,
  MIN_BUSINESS_YEAR,
  type BusinessDate,
  type BusinessDateError,
} from "../time/businessDate";

export type Gs1DatePrecision = "DAY" | "MONTH";

/** A parsed GS1 date. `day` is absent exactly when precision is `MONTH`. */
export interface Gs1Date {
  readonly yymmdd: string;
  readonly precision: Gs1DatePrecision;
  readonly year: number;
  readonly month: number;
  readonly day: number | null;
}

export type MonthPrecisionPolicy =
  "REJECT" | "FIRST_DAY_OF_MONTH" | "LAST_DAY_OF_MONTH";

export type Gs1DateError =
  | { readonly code: "MALFORMED_DATE"; readonly raw: string }
  | { readonly code: "NOT_A_CALENDAR_DATE"; readonly raw: string }
  | {
      readonly code: "REFERENCE_YEAR_OUT_OF_RANGE";
      readonly referenceYear: number;
    }
  | { readonly code: "MONTH_PRECISION_REJECTED"; readonly raw: string }
  | { readonly code: "OUT_OF_RANGE"; readonly error: BusinessDateError };

export function parseGs1Date(
  raw: string,
  options: { readonly referenceYear: number },
): Result<Gs1Date, Gs1DateError> {
  if (!isRecord(options) || !isSafeInt(options.referenceYear)) {
    return fail({
      code: "REFERENCE_YEAR_OUT_OF_RANGE",
      referenceYear: isRecord(options)
        ? numberOrNaN(options.referenceYear)
        : Number.NaN,
    });
  }
  const { referenceYear } = options;
  if (referenceYear < MIN_BUSINESS_YEAR || referenceYear > MAX_BUSINESS_YEAR) {
    return fail({ code: "REFERENCE_YEAR_OUT_OF_RANGE", referenceYear });
  }
  if (!isString(raw)) {
    return fail({ code: "MALFORMED_DATE", raw: describe(raw) });
  }
  const match = /^(\d{2})(\d{2})(\d{2})$/.exec(raw);
  if (match === null) return fail({ code: "MALFORMED_DATE", raw });

  const twoDigitYear = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const year = resolveCentury(twoDigitYear, referenceYear);

  if (month < 1 || month > 12)
    return fail({ code: "NOT_A_CALENDAR_DATE", raw });
  if (day === 0) {
    const firstOfMonth = makeBusinessDate(year, month, 1);
    if (!firstOfMonth.ok) {
      return fail({ code: "OUT_OF_RANGE", error: firstOfMonth.error });
    }
    return ok(
      Object.freeze({
        yymmdd: raw,
        precision: "MONTH" as const,
        year,
        month,
        day: null,
      }),
    );
  }
  const validated = makeBusinessDate(year, month, day);
  if (!validated.ok) {
    return validated.error.code === "YEAR_OUT_OF_RANGE"
      ? fail({ code: "OUT_OF_RANGE", error: validated.error })
      : fail({ code: "NOT_A_CALENDAR_DATE", raw });
  }
  return ok(
    Object.freeze({
      yymmdd: raw,
      precision: "DAY" as const,
      year,
      month,
      day,
    }),
  );
}

// Month-only GS1 dates require an explicit policy; never invent a day.
export function gs1DateToBusinessDate(
  date: Gs1Date,
  options: { readonly monthPrecision: MonthPrecisionPolicy },
): Result<BusinessDate, Gs1DateError> {
  const validated = validateGs1Date(date);
  if (!validated.ok) return validated;
  const value = validated.value;
  if (!isRecord(options)) {
    return fail({ code: "MONTH_PRECISION_REJECTED", raw: value.yymmdd });
  }
  if (value.precision === "DAY" && value.day !== null) {
    const resolved = makeBusinessDate(value.year, value.month, value.day);
    return resolved.ok
      ? resolved
      : fail({ code: "OUT_OF_RANGE", error: resolved.error });
  }
  if (options.monthPrecision === "FIRST_DAY_OF_MONTH") {
    const resolved = makeBusinessDate(value.year, value.month, 1);
    return resolved.ok
      ? resolved
      : fail({ code: "OUT_OF_RANGE", error: resolved.error });
  }
  if (options.monthPrecision === "LAST_DAY_OF_MONTH") {
    const resolved = endOfMonth(value.year, value.month);
    return resolved.ok
      ? resolved
      : fail({ code: "OUT_OF_RANGE", error: resolved.error });
  }
  return fail({ code: "MONTH_PRECISION_REJECTED", raw: value.yymmdd });
}

export function validateGs1Date(date: Gs1Date): Result<Gs1Date, Gs1DateError> {
  if (!isRecord(date) || !isString(date.yymmdd)) {
    return fail({ code: "MALFORMED_DATE", raw: describe(date) });
  }
  const { yymmdd, precision, year, month, day } = date;
  if (
    !isSafeInt(year) ||
    !isSafeInt(month) ||
    (precision !== "DAY" && precision !== "MONTH") ||
    (precision === "MONTH" ? day !== null : !isSafeInt(day))
  ) {
    return fail({ code: "MALFORMED_DATE", raw: yymmdd });
  }
  if (year < 0 || month < 1 || month > 12) {
    return fail({ code: "NOT_A_CALENDAR_DATE", raw: yymmdd });
  }
  const expected = `${pad2(year % 100)}${pad2(month)}${pad2(precision === "MONTH" ? 0 : (day as number))}`;
  if (yymmdd !== expected) {
    return fail({ code: "MALFORMED_DATE", raw: yymmdd });
  }
  const calendar = makeBusinessDate(
    year,
    month,
    precision === "MONTH" ? 1 : (day as number),
  );
  if (!calendar.ok) {
    return calendar.error.code === "YEAR_OUT_OF_RANGE"
      ? fail({ code: "OUT_OF_RANGE", error: calendar.error })
      : fail({ code: "NOT_A_CALENDAR_DATE", raw: yymmdd });
  }
  return ok(
    Object.freeze({
      yymmdd,
      precision,
      year,
      month,
      day: precision === "MONTH" ? null : (day as number),
    }),
  );
}

function resolveCentury(twoDigitYear: number, referenceYear: number): number {
  const referenceTwoDigit = referenceYear % 100;
  const century = referenceYear - referenceTwoDigit;
  const difference = twoDigitYear - referenceTwoDigit;
  if (difference >= 51) return century - 100 + twoDigitYear;
  if (difference <= -50) return century + 100 + twoDigitYear;
  return century + twoDigitYear;
}

const pad2 = (value: number): string => String(value).padStart(2, "0");

const numberOrNaN = (value: unknown): number =>
  typeof value === "number" ? value : Number.NaN;

const describe = (value: unknown): string =>
  value === null ? "null" : typeof value;
