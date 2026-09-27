import { describe, it, expect } from "vitest";
import { fg1ApprovedPlan } from "./fg1ApprovedPlan";
import { occupiedFootprintAreaSqMm } from "./occupancy";
describe("approved FG1 geometry", () => {
  it("preserves 15 dimensions, equal bottom alignment and corrected R04", () => {
    const p = fg1ApprovedPlan(),
      cell = (code: string) => p.cells.find((c) => c.code === code)!;
    expect(p.cells).toHaveLength(15);
    expect(new Set(p.cells.map((c) => c.code)).size).toBe(15);
    expect(cell("FG1-R04")).toMatchObject({ widthMm: 7350, depthMm: 1600 });
    expect(cell("FG1-L01").yMm).toBe(0);
    expect(cell("FG1-R01").yMm).toBe(3080);
    for (const id of ["FG1-L05", "FG1-R10"]) {
      const c = cell(id);
      expect(c.yMm + c.depthMm).toBe(29930);
    }
    expect(p.widthMm).toBe(12260);
    expect(p.depthMm).toBe(29930);
  });
  it("has only five side aisles, no R09/R10 side or bottom strip, and disjoint walkways", () => {
    const p = fg1ApprovedPlan(),
      side = p.blocks.filter((b) => b.label.startsWith("ทางเดินริมขวา"));
    expect(side).toHaveLength(5);
    expect(side.map((b) => b.label)).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining("R09"),
        expect.stringContaining("R10"),
      ]),
    );
    const overlap = (
      a: (typeof p.cells)[number],
      b: (typeof p.blocks)[number],
    ) =>
      a.xMm < b.xMm + b.widthMm &&
      a.xMm + a.widthMm > b.xMm &&
      a.yMm < b.yMm + b.depthMm &&
      a.yMm + a.depthMm > b.yMm;
    for (const c of p.cells)
      for (const b of p.blocks.filter((b) => !b.label.startsWith("จุดสงวน")))
        expect(overlap(c, b)).toBe(false);
    expect(occupiedFootprintAreaSqMm(p.blocks)).toBe(p.reservedAreaSqMm);
    expect(p.grossAreaSqMm - p.reservedAreaSqMm).toBe(p.usableAreaSqMm);
    expect(
      p.blocks.every(
        (b) => b.xMm + b.widthMm <= 12260 && b.yMm + b.depthMm <= 29930,
      ),
    ).toBe(true);
  });
});
