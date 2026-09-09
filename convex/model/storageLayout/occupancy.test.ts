import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { occupiedFootprintAreaSqMm } from "./occupancy";

describe("occupied footprint union", () => {
  it("counts partial overlap, containment and identical move holds only once", () => {
    const source = { xMm: 0, yMm: 0, widthMm: 1_000, depthMm: 1_200 };
    expect(occupiedFootprintAreaSqMm([source, { ...source, xMm: 500 }])).toBe(
      1_800_000,
    );
    expect(
      occupiedFootprintAreaSqMm([source, source, { ...source, widthMm: 500 }]),
    ).toBe(1_200_000);
    expect(occupiedFootprintAreaSqMm([source, { ...source, xMm: 1_000 }])).toBe(
      2_400_000,
    );
  });

  it("matches an independent occupied-cell oracle for random intersecting rectangles", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            xMm: fc.integer({ min: 0, max: 10 }),
            yMm: fc.integer({ min: 0, max: 10 }),
            widthMm: fc.integer({ min: 1, max: 8 }),
            depthMm: fc.integer({ min: 1, max: 8 }),
          }),
          { maxLength: 30 },
        ),
        (rectangles) => {
          const cells = new Set<string>();
          for (const r of rectangles)
            for (let x = r.xMm; x < r.xMm + r.widthMm; x++)
              for (let y = r.yMm; y < r.yMm + r.depthMm; y++)
                cells.add(`${x}:${y}`);
          expect(occupiedFootprintAreaSqMm(rectangles)).toBe(cells.size);
        },
      ),
      { numRuns: 200, seed: 6026 },
    );
  });

  it("handles empty, invalid and large overlapping datasets", () => {
    expect(occupiedFootprintAreaSqMm([])).toBe(0);
    expect(
      occupiedFootprintAreaSqMm([
        { xMm: 0, yMm: 0, widthMm: NaN, depthMm: 2 },
        { xMm: 0, yMm: 0, widthMm: -2, depthMm: 2 },
      ]),
    ).toBe(0);
    expect(
      occupiedFootprintAreaSqMm(
        Array.from({ length: 10_000 }, (_, i) => ({
          xMm: i,
          yMm: 0,
          widthMm: 100,
          depthMm: 100,
        })),
      ),
    ).toBe(1_009_900);
  });
});
