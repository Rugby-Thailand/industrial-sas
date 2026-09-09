import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  firstFit,
  placementError,
  boxesOverlap,
  type Surface,
} from "./placement";
const surface: Surface = {
  xMm: 0,
  yMm: 0,
  zMm: 0,
  widthMm: 2000,
  depthMm: 2000,
  heightMm: 3000,
};
describe("exact pallet geometry", () => {
  it("rotates a measured footprint when only the rotated orientation fits", () => {
    expect(
      firstFit(
        { lengthMm: 1800, widthMm: 900, heightMm: 1200 },
        { ...surface, depthMm: 1000 },
        [],
        [],
      ),
    ).toMatchObject({ rotation: 90, widthMm: 1800, depthMm: 900 });
  });
  it("packs against exact edges without treating contact as overlap", () => {
    const obstacle = {
      xMm: 0,
      yMm: 0,
      zMm: 0,
      widthMm: 1200,
      depthMm: 1000,
      heightMm: 1400,
    };
    const next = firstFit(
      { lengthMm: 1200, widthMm: 1000, heightMm: 1400 },
      surface,
      [obstacle],
      [],
    );
    expect(next).toMatchObject({ xMm: 0, yMm: 1000 });
    expect(boxesOverlap(obstacle, next!)).toBe(false);
  });
  it("never floats pallets and separates occupancy on configured elevations", () => {
    const upper = { ...surface, zMm: 1500, heightMm: 1500 };
    const below = {
      xMm: 0,
      yMm: 0,
      zMm: 0,
      widthMm: 2000,
      depthMm: 2000,
      heightMm: 1500,
    };
    expect(
      firstFit(
        { lengthMm: 2000, widthMm: 2000, heightMm: 1500 },
        upper,
        [below],
        [],
      ),
    ).toMatchObject({ zMm: 1500 });
    expect(placementError({ ...below, zMm: 1 }, surface, [], [])).toBe(
      "SUPPORT_REQUIRED",
    );
  });
  it("returns no candidate for impossible height or a fully unavailable footprint", () => {
    expect(
      firstFit({ lengthMm: 1, widthMm: 1, heightMm: 3001 }, surface, [], []),
    ).toBeNull();
    expect(
      firstFit(
        { lengthMm: 1, widthMm: 1, heightMm: 1 },
        surface,
        [],
        [surface],
      ),
    ).toBeNull();
  });
  it("never recommends invalid geometry across randomized dimensions and occupancy", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 3000 }),
        fc.integer({ min: 1, max: 3000 }),
        fc.integer({ min: 1, max: 4000 }),
        fc.array(
          fc.record({
            xMm: fc.integer({ min: 0, max: 2000 }),
            yMm: fc.integer({ min: 0, max: 2000 }),
            zMm: fc.constant(0),
            widthMm: fc.integer({ min: 1, max: 1000 }),
            depthMm: fc.integer({ min: 1, max: 1000 }),
            heightMm: fc.integer({ min: 1, max: 3000 }),
          }),
          { maxLength: 8 },
        ),
        (lengthMm, widthMm, heightMm, occupied) => {
          const fit = firstFit(
            { lengthMm, widthMm, heightMm },
            surface,
            occupied,
            [],
          );
          if (fit)
            expect(placementError(fit, surface, occupied, [])).toBeNull();
        },
      ),
      { numRuns: 300 },
    );
  });

  it("finds the same first exact fit as exhaustive integer-coordinate search", () => {
    fc.assert(
      fc.property(
        fc.record({
          lengthMm: fc.integer({ min: 1, max: 22 }),
          widthMm: fc.integer({ min: 1, max: 22 }),
          heightMm: fc.integer({ min: 1, max: 5 }),
        }),
        fc.array(
          fc.record({
            xMm: fc.integer({ min: 0, max: 24 }),
            yMm: fc.integer({ min: 0, max: 24 }),
            zMm: fc.integer({ min: 0, max: 4 }),
            widthMm: fc.integer({ min: 1, max: 10 }),
            depthMm: fc.integer({ min: 1, max: 10 }),
            heightMm: fc.integer({ min: 1, max: 4 }),
          }),
          { maxLength: 8 },
        ),
        (size, occupied) => {
          const smallSurface = {
            xMm: 3,
            yMm: 5,
            zMm: 1,
            widthMm: 20,
            depthMm: 20,
            heightMm: 4,
          };
          let expected = null;
          search: for (let yMm = 5; yMm < 25; yMm += 1)
            for (let xMm = 3; xMm < 23; xMm += 1)
              for (const rotation of [0, 90] as const) {
                const candidate = {
                  xMm,
                  yMm,
                  zMm: 1,
                  widthMm: rotation === 0 ? size.widthMm : size.lengthMm,
                  depthMm: rotation === 0 ? size.lengthMm : size.widthMm,
                  heightMm: size.heightMm,
                  rotation,
                };
                if (
                  placementError(candidate, smallSurface, occupied, []) === null
                ) {
                  expected = candidate;
                  break search;
                }
              }
          expect(firstFit(size, smallSurface, occupied, [])).toEqual(expected);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("does not do a cubic blocker scan for a dense fully unavailable location", () => {
    let xReads = 0;
    const largeSurface = { ...surface, widthMm: 100_000, depthMm: 100_000 };
    const occupied = Array.from({ length: 1_000 }, (_, index) => ({
      get xMm() {
        xReads += 1;
        if (xReads > 10_000_000)
          throw new Error("Cubic blocker scan regressed");
        return index * 10;
      },
      yMm: index * 10,
      zMm: 0,
      widthMm: 5,
      depthMm: 5,
      heightMm: 1_000,
    }));
    expect(
      firstFit(
        { lengthMm: 1, widthMm: 1, heightMm: 1 },
        largeSurface,
        occupied,
        [largeSurface],
      ),
    ).toBeNull();
    expect(xReads).toBeLessThan(10_000_000);
  });
});
