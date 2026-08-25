import { describe, expect, it } from "vitest";

import {
  abbreviateIdentifier,
  formatBusinessDateIso,
  formatCount,
  formatInstant,
  formatInstantDate,
  formatMinorUnits,
  UNRENDERABLE,
} from "./formatters";

describe("formatMinorUnits", () => {
  it("renders the digits that are stored, keeping trailing zeros", () => {
    expect(formatMinorUnits(12_000, "KG")).toBe("12.000");
    expect(formatMinorUnits(18_450_500, "KG")).toBe("18450.500");
    expect(formatMinorUnits(1, "EA")).toBe("0.001");
  });

  it("never inserts a grouping separator", () => {
    expect(formatMinorUnits(1_234_568, "L")).toBe("1234.568");
  });

  it("renders a negative balance with its sign", () => {
    expect(formatMinorUnits(-2_500, "EA")).toBe("-2.500");
  });

  it("answers the unrenderable marker rather than NaN for a forged value", () => {
    expect(formatMinorUnits(Number.NaN, "KG")).toBe(UNRENDERABLE);
    expect(formatMinorUnits(1.5, "KG")).toBe(UNRENDERABLE);
    expect(formatMinorUnits(1_000, "not a uom")).toBe(UNRENDERABLE);
  });
});

describe("formatBusinessDateIso", () => {
  it("renders a stored date unchanged in the Gregorian calendar", () => {
    expect(formatBusinessDateIso("2026-08-11")).toBe("2026-08-11");
  });

  it("adds the Buddhist Era offset only when asked", () => {
    expect(formatBusinessDateIso("2026-08-11", "BUDDHIST")).toBe("2569-08-11");

    expect(formatBusinessDateIso("2026-08-11")).toBe("2026-08-11");
  });

  it("refuses a malformed or impossible date instead of shifting it", () => {
    expect(formatBusinessDateIso("2026-8-3")).toBe(UNRENDERABLE);
    expect(formatBusinessDateIso("2026-02-30")).toBe(UNRENDERABLE);
    expect(formatBusinessDateIso("")).toBe(UNRENDERABLE);
  });
});

describe("formatInstant", () => {
  const instant = Date.UTC(2026, 7, 11, 2, 15, 0);

  it("renders in the organization timezone, not the host's", () => {
    expect(formatInstant(instant, "en")).toContain("09:15");
  });

  it("uses the Gregorian calendar even in Thai", () => {
    const rendered = formatInstant(instant, "th");
    expect(rendered).toContain("2026");
    expect(rendered).not.toContain("2569");
  });

  it("uses a 24-hour clock, so no timestamp depends on an AM/PM marker", () => {
    expect(formatInstant(Date.UTC(2026, 7, 11, 14, 5, 0), "en")).toContain(
      "21:05",
    );
  });

  it("answers the marker for a non-finite instant", () => {
    expect(formatInstant(Number.NaN, "th")).toBe(UNRENDERABLE);
  });

  it("answers the marker rather than throwing for an unsupported zone", () => {
    expect(formatInstant(instant, "th", "Mars/Olympus_Mons")).toBe(
      UNRENDERABLE,
    );
  });
});

describe("formatInstantDate", () => {
  it("uses the organization timezone at a Bangkok date boundary", () => {
    const instant = Date.UTC(2026, 7, 10, 18, 30, 0);
    expect(formatInstantDate(instant, "en")).toContain("08/11/2026");
  });

  it("keeps the Gregorian year in Thai", () => {
    expect(formatInstantDate(Date.UTC(2026, 7, 11), "th")).toContain("2026");
  });
});

describe("formatCount", () => {
  it("groups, because a caption is read rather than scanned", () => {
    expect(formatCount(12_345, "en")).toBe("12,345");
  });

  it("uses Latin digits in Thai, matching the quantity columns", () => {
    expect(formatCount(2026, "th")).toBe("2,026");
  });
});

describe("abbreviateIdentifier", () => {
  it("keeps both ends, so two different keys stay distinguishable", () => {
    const left = abbreviateIdentifier("IB1|3:org|5:wh_aa|9:item_left", 6);
    const right = abbreviateIdentifier("IB1|3:org|5:wh_aa|10:item_right", 6);

    expect(left).not.toBe(right);
    expect(left.startsWith("IB1|3:")).toBe(true);
  });

  it("leaves a short value alone", () => {
    expect(abbreviateIdentifier("short", 6)).toBe("short");
  });

  it("refuses a nonsensical keep length rather than producing an empty cell", () => {
    expect(abbreviateIdentifier("anything", 0)).toBe(UNRENDERABLE);
  });
});
