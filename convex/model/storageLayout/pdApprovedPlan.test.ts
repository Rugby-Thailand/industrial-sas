import { describe, expect, it } from "vitest";
import { pdApprovedPlan, type PdRectangle } from "./pdApprovedPlan";
const overlap = (a: PdRectangle, b: PdRectangle) =>
  a.xMm < b.xMm + b.widthMm &&
  a.xMm + a.widthMm > b.xMm &&
  a.yMm < b.yMm + b.depthMm &&
  a.yMm + a.depthMm > b.yMm;
describe("approved PD geometry", () => {
  it("partitions the whole building into 198 cells and non-overlapping reserved areas", () => {
    const p = pdApprovedPlan();
    expect(p.cells).toHaveLength(198);
    expect(new Set(p.cells.map((c) => c.code)).size).toBe(198);
    const all = [...p.cells, ...p.blocks];
    for (const [i, a] of all.entries()) {
      for (const n of [a.xMm, a.yMm, a.widthMm, a.depthMm])
        expect(Number.isInteger(n)).toBe(true);
      expect(a.xMm).toBeGreaterThanOrEqual(0);
      expect(a.yMm).toBeGreaterThanOrEqual(0);
      expect(a.widthMm).toBeGreaterThan(0);
      expect(a.depthMm).toBeGreaterThan(0);
      expect(a.xMm + a.widthMm).toBeLessThanOrEqual(61500);
      expect(a.yMm + a.depthMm).toBeLessThanOrEqual(11960);
      for (const b of all.slice(i + 1)) expect(overlap(a, b)).toBe(false);
    }
    expect(all.reduce((n, a) => n + a.widthMm * a.depthMm, 0)).toBe(
      61500 * 11960,
    );
    expect(p.cells.reduce((n, a) => n + a.widthMm * a.depthMm, 0)).toBe(
      p.usableAreaSqMm,
    );
  });
  it("includes aisles inside 9420 mm spans and preserves clear stair area", () => {
    const p = pdApprovedPlan();
    expect(
      p.blocks
        .filter((b) => b.areaKind === "NO_STORAGE")
        .reduce((n, b) => n + b.widthMm * b.depthMm, 0),
    ).toBe(20457000);
    expect(
      Math.max(
        ...p.cells
          .filter((c) => /^PD-L[1-6]-/.test(c.code))
          .map((c) => c.xMm + c.widthMm),
      ),
    ).toBe(56520);
    expect(
      p.blocks
        .filter((b) => b.label.startsWith("ทางเดินซอย"))
        .every((b) => b.widthMm === 1600),
    ).toBe(true);
    expect(
      p.blocks.find((b) => b.label.startsWith("ทางเดินหลัก"))?.depthMm,
    ).toBe(1600);
    expect(p.blocks.find((b) => b.areaKind === "STAIRS")?.yMm).toBe(6400);
  });
});
