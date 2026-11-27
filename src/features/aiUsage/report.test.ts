import { describe, expect, it } from "vitest";

import {
  activeConditionCount,
  formatDateRangeLabel,
  NO_FILTERS,
  presetDateRange,
  validateDateRange,
} from "./report";

describe("AI usage filter helpers", () => {
  it("counts one condition per non-default period or dimension", () => {
    expect(activeConditionCount("month", NO_FILTERS)).toBe(0);
    expect(activeConditionCount("today", NO_FILTERS)).toBe(1);
    expect(activeConditionCount("week", NO_FILTERS)).toBe(1);
    expect(activeConditionCount("custom", NO_FILTERS)).toBe(1);
    expect(
      activeConditionCount("custom", {
        ...NO_FILTERS,
        feature: "AI_SEARCH",
        warehouseId: "wh-1",
      }),
    ).toBe(3);
  });

  it("computes preset ranges in the organization timezone rather than UTC", () => {
    // 2026-11-26 20:00 UTC is already 2026-11-27 03:00 in Asia/Bangkok (+07:00).
    const instant = Date.parse("2026-11-26T20:00:00Z");
    expect(presetDateRange("today", "Asia/Bangkok", instant)).toEqual({
      from: "2026-11-27",
      to: "2026-11-27",
    });
    expect(presetDateRange("week", "Asia/Bangkok", instant)).toEqual({
      from: "2026-11-21",
      to: "2026-11-27",
    });
    expect(presetDateRange("month", "Asia/Bangkok", instant)).toEqual({
      from: "2026-11-01",
      to: "2026-11-27",
    });
    expect(presetDateRange("today", "UTC", instant)).toEqual({
      from: "2026-11-26",
      to: "2026-11-26",
    });
    expect(presetDateRange("week", "Asia/Yangon", instant)).toEqual({
      from: "2026-11-21",
      to: "2026-11-27",
    });
    expect(presetDateRange("week", null, instant)).toBeNull();
    expect(presetDateRange("week", "America/New_York", instant)).toBeNull();
  });

  it("validates custom date ranges against ISO format, order, and 93-day limit", () => {
    expect(validateDateRange("", "2026-10-15")).toBe("required");
    expect(validateDateRange("2026-10-01", "")).toBe("required");
    expect(validateDateRange("2026-02-30", "2026-03-01")).toBe("format");
    expect(validateDateRange("2026-10-16", "2026-10-15")).toBe("order");
    // 93 inclusive calendar days: 2026-07-15 through 2026-10-15 (92-day span).
    expect(validateDateRange("2026-07-15", "2026-10-15")).toBeNull();
    // 94 inclusive calendar days is rejected.
    expect(validateDateRange("2026-07-14", "2026-10-15")).toBe("limit");
    // Leap day is valid on a leap year.
    expect(validateDateRange("2028-02-29", "2028-02-29")).toBeNull();
  });

  it("formats custom date ranges with Intl in the active locale", () => {
    expect(formatDateRangeLabel("2026-10-01", "2026-10-08", "en")).toBe(
      "Oct 1, 2026 – Oct 8, 2026",
    );
    expect(formatDateRangeLabel("2026-10-01", "2026-10-01", "en")).toBe(
      "Oct 1, 2026",
    );
    const th = formatDateRangeLabel("2026-10-01", "2026-10-08", "th");
    expect(th).toContain("ต.ค.");
    expect(th).toContain("–");
  });
});
