import { describe, expect, it } from "vitest";

import {
  addDays,
  datesInRange,
  dayNumber,
  fromLocal,
  isoInstant,
  isoWeekday,
  parseLocalTime,
  timezoneOffsetMinutes,
  toLocal,
} from "./calendar";

const BANGKOK = 420;

describe("HR calendar", () => {
  it("accepts only real ISO calendar dates", () => {
    expect(dayNumber("2026-10-08")).not.toBeNull();
    expect(dayNumber("2028-02-29")).not.toBeNull();
    for (const bad of [
      "2026-02-29",
      "2026-02-30",
      "2026-13-01",
      "2026-9-1",
      "",
      20261008,
    ])
      expect(dayNumber(bad)).toBeNull();
  });

  it("matches dates to weekdays", () => {
    expect(isoWeekday("2026-10-08")).toBe(4); // Thursday
    expect(isoWeekday("2026-10-11")).toBe(7); // Sunday
    expect(isoWeekday("2026-10-12")).toBe(1); // Monday
    expect(isoWeekday("1970-01-01")).toBe(4);
  });

  it("crosses months and years", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
    expect(datesInRange("2026-09-29", "2026-10-02")).toEqual([
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
    ]);
  });

  it("converts organization-local wall time without the host time zone", () => {
    const instant = fromLocal("2026-10-08", 8 * 60 + 23, BANGKOK);
    expect(isoInstant(instant)).toBe("2026-10-08T01:23:00Z");
    expect(toLocal(instant, BANGKOK)).toEqual({
      date: "2026-10-08",
      minute: 503,
    });
    // 02:00 UTC on the 8th is still the 8th in Bangkok; 20:00 UTC is the 9th.
    expect(toLocal(Date.UTC(2026, 9, 8, 20, 0), BANGKOK).date).toBe(
      "2026-10-09",
    );
  });

  it("refuses timezones with daylight-saving transitions", () => {
    expect(timezoneOffsetMinutes("Asia/Bangkok")).toEqual({
      ok: true,
      value: 420,
    });
    expect(timezoneOffsetMinutes("Europe/London").ok).toBe(false);
    expect(timezoneOffsetMinutes("toString").ok).toBe(false);
  });

  it("parses local HH:MM times strictly", () => {
    expect(parseLocalTime("22:00")).toBe(1320);
    expect(parseLocalTime("00:00")).toBe(0);
    for (const bad of ["24:00", "7:00", "07:60", "07:00Z", null])
      expect(parseLocalTime(bad)).toBeNull();
  });
});
