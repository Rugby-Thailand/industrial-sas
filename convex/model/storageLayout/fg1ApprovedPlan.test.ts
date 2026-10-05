import { describe, it, expect } from "vitest";
import { fg1ApprovedPlan, fg1RearPlan } from "./fg1ApprovedPlan";
import { occupiedFootprintAreaSqMm } from "./occupancy";
describe("approved FG1 geometry", () => {
  it("keeps 15 cells and aligns the R04–R08 fronts while extending only those cells to the wall", () => {
    const p = fg1ApprovedPlan(),
      cell = (code: string) => p.cells.find((c) => c.code === code)!;
    expect(p.cells).toHaveLength(15);
    expect(new Set(p.cells.map((c) => c.code)).size).toBe(15);
    for (let i = 1; i <= 3; i++)
      expect(cell(`FG1-R${String(i).padStart(2, "0")}`)).toMatchObject({
        xMm: 4420,
        widthMm: 7260,
      });
    for (let i = 4; i <= 10; i++)
      expect(cell(`FG1-R${String(i).padStart(2, "0")}`)).toMatchObject({
        xMm: 4420,
        widthMm: 7840,
      });
    expect(cell("FG1-R04").depthMm).toBe(1600);
    expect(cell("FG1-L01").yMm).toBe(0);
    expect(cell("FG1-R01").yMm).toBe(3080);
    for (const id of ["FG1-L05", "FG1-R10"]) {
      const c = cell(id);
      expect(c.yMm + c.depthMm).toBe(29930);
    }
    expect(p.widthMm).toBe(12260);
    expect(p.depthMm).toBe(29930);
  });
  it("removes the nine rear-edge reserved blocks without overlapping cells or aisles", () => {
    const p = fg1ApprovedPlan(),
      rear = p.blocks.filter((b) => b.label.startsWith("ขอบหลัง"));
    expect(p.blocks.some((b) => b.label.startsWith("ทางเดินริมขวา"))).toBe(
      false,
    );
    expect(rear).toHaveLength(0);
    expect(p.blocks).toHaveLength(14);
    expect(
      p.blocks.filter(
        (b) =>
          b.areaKind === "AISLE" &&
          b.label.startsWith("ทางเดิน FG1-R0") &&
          /R0[4-7]–FG1-R0[5-8]/.test(b.label),
      ),
    ).toHaveLength(4);
    expect(
      p.blocks
        .filter((b) => /ทางเดิน FG1-R0[4-7]–FG1-R0[5-8]/.test(b.label))
        .every((b) => b.xMm + b.widthMm === 12260),
    ).toBe(true);
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
    expect(p.reservedAreaSqMm).toBe(74_305_500);
    expect(p.usableAreaSqMm).toBe(292_636_300);
    expect(fg1RearPlan().reservedAreaSqMm - p.reservedAreaSqMm).toBe(3_615_000);
    expect(p.grossAreaSqMm - p.reservedAreaSqMm).toBe(p.usableAreaSqMm);
    expect(
      p.blocks.every(
        (b) => b.xMm + b.widthMm <= 12260 && b.yMm + b.depthMm <= 29930,
      ),
    ).toBe(true);
  });
});
