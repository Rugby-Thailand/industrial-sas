import { expect, it } from "vitest";
import { holidayCsv, monthRange } from "./selfService";

it("exports every selected holiday with localized headers, safe text, and CSV quoting", () => {
  const csv = holidayCsv(["Date", "Holiday", "Workplace"], "Main, site", [
    { date: "2026-01-01", name: '=HYPERLINK("unsafe")' },
    { date: "2026-12-31", name: "Year end\ncompany holiday" },
  ]);
  expect(csv).toBe(
    '\uFEFF"Date","Holiday","Workplace"\r\n"2026-01-01","\'=HYPERLINK(""unsafe"")","Main, site"\r\n"2026-12-31","Year end\ncompany holiday","Main, site"\r\n',
  );
});

it("derives leap-year and month ranges while excluding future dates", () => {
  expect(monthRange("2024-02", "2026-10-12")).toEqual({
    from: "2024-02-01",
    to: "2024-02-29",
  });
  expect(monthRange("2026-10", "2026-10-12")).toEqual({
    from: "2026-10-01",
    to: "2026-10-12",
  });
  expect(monthRange("2026-13", "2026-10-12")).toBeNull();
  expect(monthRange("", "2026-10-12")).toBeNull();
});
