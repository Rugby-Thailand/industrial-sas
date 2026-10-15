import { describe, expect, it } from "vitest";
import { labelEm, planCellLabelLayout } from "./planCellLabelLayout";

describe("plan cell labels", () => {
  it.each([
    [43, 32],
    [86, 58],
    [215, 145],
  ])("keeps one centred 14 px code in a %s × %s px cell", (width, height) => {
    expect(planCellLabelLayout({ width, height, code: "R04" })).toEqual({
      code: { fontSize: 14, offsetY: 0 },
    });
  });

  it.each([
    [40, 32, "R04"],
    [86, 31, "R04"],
    [90, 100, "R03-COLD-001"],
    [0, 0, "R04"],
  ])(
    "hides an unfitting code instead of shrinking or truncating it",
    (width, height, code) => {
      expect(planCellLabelLayout({ width, height, code })).toEqual({});
    },
  );

  it("fits a complete long code once there is enough space", () => {
    expect(
      planCellLabelLayout({ width: 160, height: 40, code: "R03-COLD-001" }),
    ).toEqual({
      code: { fontSize: 14, offsetY: 0 },
    });
  });

  it("does not count Thai combining marks as separate glyph widths", () => {
    expect(labelEm("ว่าง")).toBeCloseTo(0.62 * 3, 8);
  });
});
