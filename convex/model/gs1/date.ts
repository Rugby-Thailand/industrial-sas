/**
 * GS1 `YYMMDD` date fields (AI 11 production, AI 15 best before, AI 17
 * expiration) and their conversion to a business date.
 *
 * Status: **implemented** for the three date AIs the inbound slice needs. AI 12
 * (due date), AI 13 (packaging date), AI 16 (sell by), and the date-and-time AIs
 * (7003, 7006…) are **not** implemented and are rejected as unknown by the
 * element-string parser rather than parsed as if they were one of these.
 *
 * Two details decide correctness.
 *
 * 1. **The century is inferred, not stored.** GS1 gives two year digits. The
 *    General Specifications resolve them against the current year: a year 51-99
 *    ahead is the previous century, and a year 50-99 behind is the next one. That
 *    needs a reference year, and taking it from the host clock would make a
 *    parser whose output changes at midnight on New Year, and whose tests are
 *    unrepeatable. So `referenceYear` is a required argument.
 * 2. **`DD` may be `00`.** GS1 allows a day of `00` when only the month is
 *    meaningful. This module keeps that as month precision and refuses to invent
 *    a day; `gs1DateToBusinessDate` takes an explicit policy for what a
 *    month-precision date means, because "the first of the month" and "the last
 *    of the month" are a shelf-life difference of up to 30 days.
 *
 * Pure module (plan §6.2): no Convex imports.
 */
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

/** How precise a GS1 date is. `MONTH` means the day field was `00`. */
export type Gs1DatePrecision = "DAY" | "MONTH";

/** A parsed GS1 date. `day` is absent exactly when precision is `MONTH`. */
export interface Gs1Date {
  readonly yymmdd: string;
  readonly precision: Gs1DatePrecision;
  readonly year: number;
  readonly month: number;
  readonly day: number | null;
}

/** What a month-precision date resolves to. The caller must choose. */
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

/**
 * Parses `YYMMDD` with the GS1 century rule. Rejects a month outside 1-12 and a
 * day that is not a real day of that month; `000000` and `260230` both fail.
 */
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
    // Validate the year and month even though the day is unknown, so an
    // out-of-range century is reported here rather than at resolution time.
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

/**
 * Resolves a parsed GS1 date to a business date under an explicit policy. A
 * `DAY`-precision date ignores the policy; a `MONTH`-precision one is rejected
 * unless the caller has said which end of the month it means.
 *
 * The date is re-validated first. `Gs1Date` is an interface, so
 * `{ precision: "DAY", day: null } as Gs1Date` compiles: without the check, that
 * value would fall through to the month-precision branch and resolve to the first
 * or last day of a month the label never named.
 */
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
  // `REJECT`, and anything a cast put in its place: a policy this module does not
  // recognise must not silently become one that invents a day.
  return fail({ code: "MONTH_PRECISION_REJECTED", raw: value.yymmdd });
}

/**
 * Re-checks a value that claims to be a parsed GS1 date, including that its
 * `yymmdd` still agrees with its fields. A date whose digits and fields disagree
 * is not a parse of anything.
 */
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

/**
 * The GS1 century rule. `difference` is the signed distance from the reference
 * year's own two digits:
 *
 * - 51…99 ahead — the previous century (a date that far in the future is a date
 *   in the past).
 * - 50…99 behind — the next century.
 * - otherwise the reference century.
 */
function resolveCentury(twoDigitYear: number, referenceYear: number): number {
  const referenceTwoDigit = referenceYear % 100;
  const century = referenceYear - referenceTwoDigit;
  const difference = twoDigitYear - referenceTwoDigit;
  if (difference >= 51) return century - 100 + twoDigitYear;
  if (difference <= -50) return century + 100 + twoDigitYear;
  return century + twoDigitYear;
}

/** Two digits, zero-padded. No `Intl`, and no `Date` to ask for a format. */
const pad2 = (value: number): string => String(value).padStart(2, "0");

/** A number for an error field, so a forged operand still reports something. */
const numberOrNaN = (value: unknown): number =>
  typeof value === "number" ? value : Number.NaN;

/** The shape of a value that is not a GS1 date, for the error field. */
const describe = (value: unknown): string =>
  value === null ? "null" : typeof value;
