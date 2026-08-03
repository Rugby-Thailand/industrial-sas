/**
 * Unit tier — GS1 `YYMMDD` dates.
 *
 * The century rule is the interesting part: the same six digits mean different
 * years depending on when they are read, so the reference year is pinned in every
 * case. If it were taken from the host clock, this file would start failing on
 * 1 January of some future year, which is exactly the bug the injected reference
 * year prevents.
 */
import { describe, expect, it } from "vitest";

import { expectError, expectOk } from "../../../tests/fixtures/domain-results";
import {
  gs1DateToBusinessDate,
  parseGs1Date,
  validateGs1Date,
  type Gs1Date,
  type MonthPrecisionPolicy,
} from "./date";

const at = (referenceYear: number) => ({ referenceYear });

describe("parseGs1Date", () => {
  it("parses a day-precision date", () => {
    expect(parseGs1Date("260803", at(2026))).toEqual({
      ok: true,
      value: {
        yymmdd: "260803",
        precision: "DAY",
        year: 2026,
        month: 8,
        day: 3,
      },
    });
  });

  it("applies the century rule around the reference year", () => {
    const year = (yymmdd: string, reference: number) => {
      const parsed = parseGs1Date(yymmdd, at(reference));
      return parsed.ok ? parsed.value.year : parsed.error.code;
    };
    // Reference 2026: +50 stays in this century, +51 is the previous one.
    expect(year("760101", 2026)).toBe(2076);
    expect(year("770101", 2026)).toBe(1977);
    // Reference 2026: 50 years behind is still this century.
    expect(year("000101", 2026)).toBe(2000);
    // Reference 2095: a small YY is the next century.
    expect(year("100101", 2095)).toBe(2110);
    expect(year("450101", 2095)).toBe(2145);
    expect(year("460101", 2095)).toBe(2046);
  });

  it("keeps month precision when the day is 00 instead of inventing one", () => {
    expect(parseGs1Date("260800", at(2026))).toEqual({
      ok: true,
      value: {
        yymmdd: "260800",
        precision: "MONTH",
        year: 2026,
        month: 8,
        day: null,
      },
    });
  });

  it("rejects an impossible date", () => {
    for (const raw of ["261301", "260001", "260230", "260931", "270229"]) {
      expect(parseGs1Date(raw, at(2026))).toEqual({
        ok: false,
        error: { code: "NOT_A_CALENDAR_DATE", raw },
      });
    }
    expect(parseGs1Date("280229", at(2026)).ok).toBe(true);
  });

  it("rejects a malformed field", () => {
    for (const raw of ["", "2608", "2608031", "26080a", "26-08-03"]) {
      expect(parseGs1Date(raw, at(2026))).toEqual({
        ok: false,
        error: { code: "MALFORMED_DATE", raw },
      });
    }
  });

  it("requires a plausible reference year", () => {
    expect(parseGs1Date("260803", at(1969))).toEqual({
      ok: false,
      error: { code: "REFERENCE_YEAR_OUT_OF_RANGE", referenceYear: 1969 },
    });
    expect(parseGs1Date("260803", at(2026.5)).ok).toBe(false);
  });

  it("reports a resolved year outside the representable range", () => {
    // Reference 2999 with YY 49 is 50 years "behind", so the rule puts it in the
    // next century: 3049, which no business date holds.
    const parsed = parseGs1Date("490101", at(2999));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.code).toBe("OUT_OF_RANGE");
  });
});

describe("gs1DateToBusinessDate", () => {
  const dayPrecision = parseGs1Date("260803", at(2026));
  const monthPrecision = parseGs1Date("260200", at(2026));

  it("passes a day-precision date through unchanged", () => {
    expect(dayPrecision.ok).toBe(true);
    if (!dayPrecision.ok) return;
    expect(
      gs1DateToBusinessDate(dayPrecision.value, { monthPrecision: "REJECT" }),
    ).toEqual({ ok: true, value: { year: 2026, month: 8, day: 3 } });
  });

  it("makes the caller choose what a month-precision date means", () => {
    expect(monthPrecision.ok).toBe(true);
    if (!monthPrecision.ok) return;
    expect(
      gs1DateToBusinessDate(monthPrecision.value, { monthPrecision: "REJECT" }),
    ).toEqual({
      ok: false,
      error: { code: "MONTH_PRECISION_REJECTED", raw: "260200" },
    });
    expect(
      gs1DateToBusinessDate(monthPrecision.value, {
        monthPrecision: "FIRST_DAY_OF_MONTH",
      }),
    ).toEqual({ ok: true, value: { year: 2026, month: 2, day: 1 } });
    // February 2026 has 28 days, so "the end of the month" is a calendar fact,
    // not a fixed 30 or 31.
    expect(
      gs1DateToBusinessDate(monthPrecision.value, {
        monthPrecision: "LAST_DAY_OF_MONTH",
      }),
    ).toEqual({ ok: true, value: { year: 2026, month: 2, day: 28 } });
  });
});

describe("forged parsed dates and policies", () => {
  const real = expectOk(parseGs1Date("260803", at(2026)));

  it("refuses a date whose precision and day disagree", () => {
    // `{ precision: "DAY", day: null }` used to fall through to the
    // month-precision branch and resolve to a day the label never named.
    const dayWithoutADay = {
      ...real,
      day: null,
    } as unknown as Gs1Date;
    expect(
      expectError(
        gs1DateToBusinessDate(dayWithoutADay, {
          monthPrecision: "FIRST_DAY_OF_MONTH",
        }),
      ).code,
    ).toBe("MALFORMED_DATE");
    const monthWithADay = {
      yymmdd: "260800",
      precision: "MONTH",
      year: 2026,
      month: 8,
      day: 1,
    } as unknown as Gs1Date;
    expect(expectError(validateGs1Date(monthWithADay)).code).toBe(
      "MALFORMED_DATE",
    );
  });

  it("refuses a date whose digits and fields disagree", () => {
    const rewritten = { ...real, month: 9 } as Gs1Date;
    expect(expectError(validateGs1Date(rewritten))).toEqual({
      code: "MALFORMED_DATE",
      raw: "260803",
    });
    expect(
      expectError(
        gs1DateToBusinessDate(rewritten, { monthPrecision: "REJECT" }),
      ).code,
    ).toBe("MALFORMED_DATE");
  });

  it("refuses an impossible calendar date and a non-object", () => {
    expect(
      expectError(
        validateGs1Date({
          yymmdd: "260230",
          precision: "DAY",
          year: 2026,
          month: 2,
          day: 30,
        } as Gs1Date),
      ).code,
    ).toBe("NOT_A_CALENDAR_DATE");
    expect(expectError(validateGs1Date(null as unknown as Gs1Date))).toEqual({
      code: "MALFORMED_DATE",
      raw: "null",
    });
  });

  it("treats a month-precision policy it does not implement as a rejection", () => {
    const monthOnly = expectOk(parseGs1Date("260200", at(2026)));
    expect(
      expectError(
        gs1DateToBusinessDate(monthOnly, {
          monthPrecision: "MIDDLE_OF_MONTH" as MonthPrecisionPolicy,
        }),
      ),
    ).toEqual({ code: "MONTH_PRECISION_REJECTED", raw: "260200" });
    expect(
      expectError(
        gs1DateToBusinessDate(
          monthOnly,
          null as unknown as { monthPrecision: MonthPrecisionPolicy },
        ),
      ).code,
    ).toBe("MONTH_PRECISION_REJECTED");
  });

  it("rejects a reference year or raw value it cannot use", () => {
    expect(expectError(parseGs1Date("260803", at(Number.NaN))).code).toBe(
      "REFERENCE_YEAR_OUT_OF_RANGE",
    );
    expect(
      expectError(
        parseGs1Date("260803", null as unknown as { referenceYear: number }),
      ).code,
    ).toBe("REFERENCE_YEAR_OUT_OF_RANGE");
    expect(
      expectError(parseGs1Date(260_803 as unknown as string, at(2026))),
    ).toEqual({ code: "MALFORMED_DATE", raw: "number" });
  });
});
