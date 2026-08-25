import { describe, expect, it } from "vitest";

import { expectError, expectOk } from "../../../tests/fixtures/domain-results";
import {
  addDays,
  ASIA_BANGKOK,
  BUDDHIST_ERA_YEAR_OFFSET,
  businessDateFromInstant,
  businessDatesEqual,
  businessDateToIso,
  compareBusinessDates,
  daysBetween,
  daysInMonth,
  endOfMonth,
  FIXED_OFFSET_ZONES,
  formatBusinessDate,
  isLeapYear,
  makeBusinessDate,
  MAX_BUSINESS_YEAR,
  MIN_BUSINESS_YEAR,
  parseBusinessDate,
  startOfDayInstant,
  supportedTimeZoneIds,
  UTC,
  validateTimeZone,
  zoneById,
  type BusinessDate,
  type DisplayCalendar,
  type FixedOffsetZone,
} from "./businessDate";

const date = (iso: string) => expectOk(parseBusinessDate(iso));

describe("makeBusinessDate", () => {
  it("accepts a real day", () => {
    expect(parseBusinessDate("2026-08-03")).toEqual({
      ok: true,
      value: { year: 2026, month: 8, day: 3 },
    });
  });

  it("rejects 30 February and 31 April", () => {
    expect(makeBusinessDate(2026, 2, 30)).toEqual({
      ok: false,
      error: { code: "NOT_A_CALENDAR_DATE", year: 2026, month: 2, day: 30 },
    });
    expect(makeBusinessDate(2026, 4, 31).ok).toBe(false);
  });

  it("applies the Gregorian leap rule, including the century cases", () => {
    expect(makeBusinessDate(2028, 2, 29).ok).toBe(true);
    expect(makeBusinessDate(2027, 2, 29).ok).toBe(false);
    expect(makeBusinessDate(2100, 2, 29).ok).toBe(false);
    expect(makeBusinessDate(2000, 2, 29).ok).toBe(true);
  });

  it("rejects a month or day outside the calendar", () => {
    for (const [month, day] of [
      [0, 1],
      [13, 1],
      [1, 0],
      [1, 32],
    ] as const) {
      expect(makeBusinessDate(2026, month, day).ok).toBe(false);
    }
  });

  it("rejects a non-integer field", () => {
    expect(makeBusinessDate(2026, 8, 3.5).ok).toBe(false);
    expect(makeBusinessDate(Number.NaN, 8, 3).ok).toBe(false);
  });

  it("bounds the year", () => {
    expect(makeBusinessDate(MIN_BUSINESS_YEAR - 1, 1, 1)).toEqual({
      ok: false,
      error: {
        code: "YEAR_OUT_OF_RANGE",
        year: MIN_BUSINESS_YEAR - 1,
        minimum: MIN_BUSINESS_YEAR,
        maximum: MAX_BUSINESS_YEAR,
      },
    });
    expect(makeBusinessDate(MAX_BUSINESS_YEAR + 1, 1, 1).ok).toBe(false);
  });

  it("freezes the value", () => {
    expect(Object.isFrozen(date("2026-08-03"))).toBe(true);
  });
});

describe("parseBusinessDate", () => {
  it("accepts only YYYY-MM-DD", () => {
    for (const raw of [
      "2026-8-3",
      "20260803",
      " 2026-08-03",
      "2026-08-03 ",
      "2026-08-03T00:00:00Z",
      "2026/08/03",
      "26-08-03",
      "",
      "2026-08-3",
      "+2026-08-03",
    ]) {
      expect(parseBusinessDate(raw)).toEqual({
        ok: false,
        error: { code: "MALFORMED_ISO_DATE", raw },
      });
    }
  });

  it("round-trips through the ISO form", () => {
    expect(expectOk(businessDateToIso(date("2026-01-09")))).toBe("2026-01-09");
  });
});

describe("businessDateFromInstant", () => {
  const eveningUtc = 1_785_778_200_000;

  it("uses the organization zone, not UTC", () => {
    expect(businessDateFromInstant(eveningUtc, ASIA_BANGKOK)).toEqual({
      ok: true,
      value: { year: 2026, month: 8, day: 4 },
    });
    expect(businessDateFromInstant(eveningUtc, UTC)).toEqual({
      ok: true,
      value: { year: 2026, month: 8, day: 3 },
    });
  });

  it("is independent of the host timezone", () => {
    const original = process.env.TZ;
    const days = new Set<string>();
    try {
      for (const timezone of ["UTC", "Pacific/Kiritimati", "Pacific/Midway"]) {
        process.env.TZ = timezone;
        days.add(
          expectOk(
            businessDateToIso(
              expectOk(businessDateFromInstant(eveningUtc, ASIA_BANGKOK)),
            ),
          ),
        );
      }
    } finally {
      process.env.TZ = original;
    }
    expect([...days]).toEqual(["2026-08-04"]);
  });

  it("handles the exact Bangkok midnight boundary", () => {
    const midnight = 1_785_776_400_000;
    expect(businessDateFromInstant(midnight, ASIA_BANGKOK)).toEqual({
      ok: true,
      value: { year: 2026, month: 8, day: 4 },
    });
    expect(businessDateFromInstant(midnight - 1, ASIA_BANGKOK)).toEqual({
      ok: true,
      value: { year: 2026, month: 8, day: 3 },
    });
  });

  it("converts the epoch itself", () => {
    expect(businessDateFromInstant(0, UTC)).toEqual({
      ok: true,
      value: { year: 1970, month: 1, day: 1 },
    });
    expect(businessDateFromInstant(0, ASIA_BANGKOK)).toEqual({
      ok: true,
      value: { year: 1970, month: 1, day: 1 },
    });
  });

  it("rejects a non-integer or out-of-range instant", () => {
    expect(businessDateFromInstant(1.5, ASIA_BANGKOK)).toEqual({
      ok: false,
      error: { code: "INSTANT_NOT_AN_INTEGER", epochMs: 1.5 },
    });
    expect(businessDateFromInstant(Number.NaN, ASIA_BANGKOK).ok).toBe(false);
    expect(
      businessDateFromInstant(-1_000_000_000_000_000, ASIA_BANGKOK),
    ).toEqual({
      ok: false,
      error: {
        code: "INSTANT_OUT_OF_RANGE",
        epochMs: -1_000_000_000_000_000,
      },
    });
  });

  it("round-trips with startOfDayInstant in both zones", () => {
    for (const zone of [ASIA_BANGKOK, UTC]) {
      for (const iso of [
        "1970-01-02",
        "2026-08-03",
        "2028-02-29",
        "2999-12-30",
      ]) {
        const instant = expectOk(startOfDayInstant(date(iso), zone));
        expect(businessDateFromInstant(instant, zone)).toEqual({
          ok: true,
          value: date(iso),
        });
      }
    }
  });
});

describe("zoneById", () => {
  it("resolves the two supported zones", () => {
    expect(zoneById("Asia/Bangkok")).toEqual({ ok: true, value: ASIA_BANGKOK });
    expect(zoneById("UTC")).toEqual({ ok: true, value: UTC });
  });

  it("fails closed on a daylight-saving zone rather than assuming an offset", () => {
    expect(zoneById("Europe/Berlin")).toEqual({
      ok: false,
      error: { code: "UNSUPPORTED_TIME_ZONE", id: "Europe/Berlin" },
    });
  });
});

describe("ordering and arithmetic", () => {
  it("orders by year, then month, then day", () => {
    expect(
      expectOk(compareBusinessDates(date("2026-01-31"), date("2026-02-01"))),
    ).toBe(-1);
    expect(
      expectOk(compareBusinessDates(date("2027-01-01"), date("2026-12-31"))),
    ).toBe(1);
    expect(
      expectOk(compareBusinessDates(date("2026-08-03"), date("2026-08-03"))),
    ).toBe(0);
    expect(
      expectOk(businessDatesEqual(date("2026-08-03"), date("2026-08-03"))),
    ).toBe(true);
  });

  it("adds days across month, year, and leap boundaries", () => {
    expect(addDays(date("2026-08-31"), 1)).toEqual({
      ok: true,
      value: { year: 2026, month: 9, day: 1 },
    });
    expect(addDays(date("2026-12-31"), 1)).toEqual({
      ok: true,
      value: { year: 2027, month: 1, day: 1 },
    });
    expect(addDays(date("2028-02-28"), 1)).toEqual({
      ok: true,
      value: { year: 2028, month: 2, day: 29 },
    });
    expect(addDays(date("2026-01-01"), -1)).toEqual({
      ok: true,
      value: { year: 2025, month: 12, day: 31 },
    });
  });

  it("rejects a shift out of range or by a fraction", () => {
    expect(addDays(date("2999-12-31"), 1).ok).toBe(false);
    expect(addDays(date("1970-01-01"), -1).ok).toBe(false);
    expect(addDays(date("2026-08-03"), 0.5).ok).toBe(false);
  });

  it("counts days between dates, signed", () => {
    expect(expectOk(daysBetween(date("2026-08-03"), date("2026-08-10")))).toBe(
      7,
    );
    expect(expectOk(daysBetween(date("2026-08-10"), date("2026-08-03")))).toBe(
      -7,
    );
    expect(expectOk(daysBetween(date("2028-02-28"), date("2028-03-01")))).toBe(
      2,
    );
    expect(expectOk(daysBetween(date("2027-02-28"), date("2027-03-01")))).toBe(
      1,
    );
  });

  it("knows month lengths and leap years", () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 13)).toBe(0);
    expect(isLeapYear(2400)).toBe(true);
    expect(isLeapYear(2300)).toBe(false);
    expect(endOfMonth(2026, 2)).toEqual({
      ok: true,
      value: { year: 2026, month: 2, day: 28 },
    });
  });
});

describe("Buddhist Era display", () => {
  it("adds 543 years, for display only", () => {
    const value = date("2026-08-03");
    expect(expectOk(formatBusinessDate(value))).toBe("2026-08-03");
    expect(expectOk(formatBusinessDate(value, "GREGORIAN"))).toBe("2026-08-03");
    expect(expectOk(formatBusinessDate(value, "BUDDHIST"))).toBe("2569-08-03");
    expect(BUDDHIST_ERA_YEAR_OFFSET).toBe(543);
  });

  it("never round-trips back into a stored value", () => {
    const value = date("2026-08-03");
    const reparsed = parseBusinessDate(
      expectOk(formatBusinessDate(value, "BUDDHIST")),
    );
    expect(reparsed).toEqual({
      ok: true,
      value: { year: 2569, month: 8, day: 3 },
    });
    expect(expectOk(compareBusinessDates(expectOk(reparsed), value))).toBe(1);
  });

  it("names an unsupported calendar instead of falling into Buddhist Era", () => {
    const value = date("2026-08-03");
    expect(
      expectError(
        formatBusinessDate(value, "HIJRI" as unknown as DisplayCalendar),
      ),
    ).toEqual({ code: "UNSUPPORTED_DISPLAY_CALENDAR", calendar: "HIJRI" });
    expect(
      expectError(
        formatBusinessDate(value, "gregorian" as unknown as DisplayCalendar),
      ).code,
    ).toBe("UNSUPPORTED_DISPLAY_CALENDAR");
  });

  it("names a calendar that is not a string at all", () => {
    const value = date("2026-08-03");
    const forgedCalendars: readonly [unknown, string][] = [
      [null, "null"],
      [0, "number"],
      [true, "boolean"],
      [{ calendar: "BUDDHIST" }, "object"],
      [["BUDDHIST"], "object"],
      [Symbol("BUDDHIST"), "symbol"],
    ];
    for (const [forgedCalendar, received] of forgedCalendars) {
      expect(
        expectError(
          formatBusinessDate(value, forgedCalendar as DisplayCalendar),
        ),
      ).toEqual({ code: "UNSUPPORTED_DISPLAY_CALENDAR", calendar: received });
    }
  });

  it("still defaults to Gregorian when the argument is omitted or undefined", () => {
    const value = date("2026-08-03");
    expect(expectOk(formatBusinessDate(value))).toBe("2026-08-03");
    expect(
      expectOk(
        formatBusinessDate(value, undefined as unknown as DisplayCalendar),
      ),
    ).toBe("2026-08-03");
  });

  it("rejects the calendar before the date, because the caller chose it", () => {
    const impossible = { year: 2026, month: 13, day: 40 } as BusinessDate;
    expect(
      expectError(
        formatBusinessDate(impossible, "HIJRI" as unknown as DisplayCalendar),
      ).code,
    ).toBe("UNSUPPORTED_DISPLAY_CALENDAR");
  });
});

describe("forged dates and zones", () => {
  const forgedDate = (
    year: unknown,
    month: unknown,
    day: unknown,
  ): BusinessDate => ({ year, month, day }) as unknown as BusinessDate;

  it("refuses to order, render, or shift an impossible date", () => {
    const impossible = forgedDate(2026, 13, 40);
    expect(
      expectError(compareBusinessDates(impossible, date("2026-08-03"))).code,
    ).toBe("NOT_A_CALENDAR_DATE");
    expect(expectError(businessDatesEqual(impossible, impossible)).code).toBe(
      "NOT_A_CALENDAR_DATE",
    );
    expect(expectError(businessDateToIso(impossible)).code).toBe(
      "NOT_A_CALENDAR_DATE",
    );
    expect(expectError(formatBusinessDate(impossible, "BUDDHIST")).code).toBe(
      "NOT_A_CALENDAR_DATE",
    );
    expect(expectError(addDays(impossible, 1)).code).toBe(
      "NOT_A_CALENDAR_DATE",
    );
    expect(expectError(daysBetween(impossible, date("2026-08-03"))).code).toBe(
      "NOT_A_CALENDAR_DATE",
    );
    expect(expectError(startOfDayInstant(impossible, UTC)).code).toBe(
      "NOT_A_CALENDAR_DATE",
    );
  });

  it("refuses a NaN field rather than sorting by it", () => {
    const notANumber = forgedDate(Number.NaN, 8, 3);
    expect(
      expectError(compareBusinessDates(notANumber, date("2026-08-03"))).code,
    ).toBe("NOT_A_CALENDAR_DATE");
    expect(expectError(businessDateToIso(notANumber))).toEqual({
      code: "NOT_A_CALENDAR_DATE",
      year: Number.NaN,
      month: 8,
      day: 3,
    });
  });

  it("rejects a non-object and a non-string wherever one is expected", () => {
    expect(
      expectError(businessDateToIso(null as unknown as BusinessDate)).code,
    ).toBe("NOT_A_CALENDAR_DATE");
    expect(
      expectError(parseBusinessDate(20_260_803 as unknown as string)),
    ).toEqual({ code: "MALFORMED_ISO_DATE", raw: "number" });
    expect(expectError(zoneById(7 as unknown as string))).toEqual({
      code: "UNSUPPORTED_TIME_ZONE",
      id: "number",
    });
  });

  it("rejects a zone whose offset is not the registered one", () => {
    // A fixed-offset zone is only exact because the offset is ours. A forged
    // offset on a real id would shift every business day silently.
    const forgedZone = {
      id: "Asia/Bangkok",
      utcOffsetMinutes: 999,
    } as FixedOffsetZone;
    expect(expectError(validateTimeZone(forgedZone))).toEqual({
      code: "UNSUPPORTED_TIME_ZONE",
      id: "Asia/Bangkok",
    });
    expect(expectError(businessDateFromInstant(0, forgedZone)).code).toBe(
      "UNSUPPORTED_TIME_ZONE",
    );
    expect(
      expectError(startOfDayInstant(date("2026-08-03"), forgedZone)).code,
    ).toBe("UNSUPPORTED_TIME_ZONE");
    expect(
      expectError(
        businessDateFromInstant(0, {
          id: "Europe/Berlin",
          utcOffsetMinutes: 60,
        } as FixedOffsetZone),
      ).code,
    ).toBe("UNSUPPORTED_TIME_ZONE");
  });

  it("keeps the zone registry closed at run time", () => {
    expect(Object.isFrozen(FIXED_OFFSET_ZONES)).toBe(true);
    expect(() => {
      (FIXED_OFFSET_ZONES as Record<string, unknown>)["Europe/Berlin"] = {
        id: "Europe/Berlin",
        utcOffsetMinutes: 60,
      };
    }).toThrow(TypeError);
    expect(zoneById("Europe/Berlin").ok).toBe(false);
    expect(supportedTimeZoneIds()).toEqual(["Asia/Bangkok", "UTC"]);
    expect(Object.isFrozen(ASIA_BANGKOK)).toBe(true);
  });
});
