import { describe, expect, it } from "vitest";
import {
  labelEm,
  PLAN_CELL_LABEL,
  planCellLabelLayout,
} from "./planCellLabelLayout";

const spec = PLAN_CELL_LABEL;

/** Both line boxes must stay inside the padded cell. */
function expectInside(
  layout: ReturnType<typeof planCellLabelLayout>,
  width: number,
  height: number,
  code: string,
  status: string,
) {
  const half = height / 2 - spec.paddingY + 0.001;
  if (layout.code) {
    const box = (layout.code.fontSize * spec.codeLine) / 2;
    expect(Math.abs(layout.code.offsetY) + box).toBeLessThanOrEqual(half);
    expect(labelEm(code) * layout.code.fontSize).toBeLessThanOrEqual(
      width - 2 * spec.paddingX + 0.001,
    );
  }
  if (layout.status) {
    const box = (layout.status.fontSize * spec.statusLine) / 2;
    expect(Math.abs(layout.status.offsetY) + box).toBeLessThanOrEqual(half);
    expect(labelEm(status) * layout.status.fontSize).toBeLessThanOrEqual(
      width - 2 * spec.paddingX + 0.001,
    );
    // The lines never overlap each other.
    expect(
      layout.status.offsetY -
        (layout.status.fontSize * spec.statusLine) / 2 -
        (layout.code!.offsetY + (layout.code!.fontSize * spec.codeLine) / 2),
    ).toBeGreaterThanOrEqual(spec.gap - 0.001);
  }
}

describe("labelEm", () => {
  it("gives Thai tone and vowel marks no advance width", () => {
    expect(labelEm("ว่าง")).toBeCloseTo(0.62 * 3, 8);
    expect(labelEm("Empty")).toBeCloseTo(3, 8);
    expect(labelEm("4 หน่วย")).toBeCloseTo(0.6 * 2 + 0.62 * 4, 8);
  });
});

describe("planCellLabelLayout", () => {
  // FG1 R-row cell (7.84 × 1.6 m) projected at 100/200/500 % on a desktop map.
  it.each([
    [1, 43, 29],
    [2, 86, 58],
    [5, 215, 145],
  ])(
    "keeps a stable on-screen size at %s× zoom (%s × %s px)",
    (_zoom, width, height) => {
      for (const status of ["Empty", "ว่าง", "4 units", "4 หน่วย"]) {
        const layout = planCellLabelLayout({
          width,
          height,
          code: "R04",
          status,
        });
        expect(layout.code?.fontSize).toBeLessThanOrEqual(spec.codeMax);
        expect(layout.code?.fontSize).toBeGreaterThanOrEqual(spec.codeMin);
        if (layout.status)
          expect(layout.status.fontSize).toBeLessThanOrEqual(spec.statusMax);
        expectInside(layout, width, height, "R04", status);
      }
    },
  );

  it("shows the status only when its two-line layout fits", () => {
    // A short portrait-plan cell keeps its code and drops the status line.
    const short = planCellLabelLayout({
      width: 43,
      height: 24,
      code: "R04",
      status: "ว่าง",
    });
    expect(short.code).toBeDefined();
    expect(short.status).toBeUndefined();
    expect(short.code!.offsetY).toBe(0);
    // The same cell at 200 % has room for both lines.
    const tall = planCellLabelLayout({
      width: 86,
      height: 58,
      code: "R04",
      status: "ว่าง",
    });
    expect(tall.status?.fontSize).toBe(spec.statusMax);
    expect(tall.code!.offsetY).toBeLessThan(0);
    expect(tall.status!.offsetY).toBeGreaterThan(0);
  });

  it("fits narrow cells by width and hides labels that would be unreadable", () => {
    // F1/F2 L1–L3-style narrow portrait cell at 500 %.
    const narrow = planCellLabelLayout({
      width: 30,
      height: 110,
      code: "L3",
      status: "4 หน่วย",
    });
    expect(narrow.code?.fontSize).toBeLessThanOrEqual(spec.codeMax);
    // "4 หน่วย" needs ~3.7 em; 22 px leaves under 9 px, so it is hidden.
    expect(narrow.status).toBeUndefined();
    expectInside(narrow, 30, 110, "L3", "4 หน่วย");
    expect(
      planCellLabelLayout({ width: 14, height: 40, code: "R10", status: "" }),
    ).toEqual({});
    expect(planCellLabelLayout({ width: 60, height: 10, code: "R10" })).toEqual(
      {},
    );
  });

  it("shrinks both lines together before dropping the status", () => {
    const layout = planCellLabelLayout({
      width: 60,
      height: 34,
      code: "L01",
      status: "Empty",
    });
    expect(layout.status).toBeDefined();
    expect(layout.code!.fontSize).toBeLessThan(spec.codeMax);
    expectInside(layout, 60, 34, "L01", "Empty");
  });
});
