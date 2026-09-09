import { describe, expect, it } from "vitest";

import {
  constrainPalletPlacement,
  resolvePalletSupport,
  type PlacementSurface,
  palletPlacementIssue,
  projectPalletPoint,
  unprojectPalletDelta,
  validDimensions,
  type OccupiedPallet,
} from "./palletGeometry";

const dimensions = { widthMm: 1_200, depthMm: 1_000, heightMm: 1_400 };
const area = { widthMm: 3_000, depthMm: 3_000, heightMm: 3_000 };
const origin = { xMm: 0, yMm: 0, rotation: 0 } as const;

describe("pallet placement geometry", () => {
  it.each([NaN, Infinity, -Infinity, 0, -100, 100_000_001])(
    "rejects invalid size %s",
    (widthMm) => {
      expect(validDimensions({ ...dimensions, widthMm })).toBe(false);
      expect(
        palletPlacementIssue({ ...dimensions, widthMm }, area, origin, []),
      ).toBe("dimensions");
    },
  );

  it("allows an exact fit and touching occupied edges", () => {
    const other: OccupiedPallet = {
      ...dimensions,
      id: "other",
      label: "Other",
      xMm: 1_200,
      yMm: 0,
      status: "STORED",
    };
    expect(
      palletPlacementIssue(dimensions, area, origin, [other]),
    ).toBeUndefined();
    expect(
      palletPlacementIssue(dimensions, dimensions, origin, []),
    ).toBeUndefined();
  });

  it.each(["STORED", "RESERVED"] as const)(
    "detects %s collisions",
    (status) => {
      const other: OccupiedPallet = {
        ...dimensions,
        id: "other",
        label: "Other",
        xMm: 1_100,
        yMm: 0,
        status,
      };
      expect(palletPlacementIssue(dimensions, area, origin, [other])).toBe(
        "overlap",
      );
    },
  );

  it("respects the rotated footprint, boundary, and height", () => {
    const narrowArea = { widthMm: 1_000, depthMm: 1_200, heightMm: 1_400 };
    expect(palletPlacementIssue(dimensions, narrowArea, origin, [])).toBe(
      "boundary",
    );
    expect(
      palletPlacementIssue(
        dimensions,
        narrowArea,
        { ...origin, rotation: 90 },
        [],
      ),
    ).toBeUndefined();
    expect(
      palletPlacementIssue(
        { ...dimensions, heightMm: 3_001 },
        area,
        origin,
        [],
      ),
    ).toBe("height");
    expect(
      palletPlacementIssue(dimensions, area, { ...origin, xMm: NaN }, []),
    ).toBe("boundary");
  });

  it("snaps to 100 mm and clamps to edges including fractional grid edges", () => {
    expect(
      constrainPalletPlacement(
        { ...origin, xMm: 152, yMm: -99 },
        dimensions,
        area,
      ),
    ).toEqual({ ...origin, xMm: 200 });
    expect(
      constrainPalletPlacement(
        { ...origin, xMm: Infinity, yMm: 9_999 },
        dimensions,
        { ...area, depthMm: 2_050 },
      ),
    ).toEqual({ ...origin, yMm: 1_050 });
  });

  it("fixes elevation to its support and prevents movement off its surface", () => {
    const support = {
      xMm: 500,
      yMm: 500,
      zMm: 1_500,
      widthMm: 2_000,
      depthMm: 2_000,
      heightMm: 1_500,
    };
    expect(
      constrainPalletPlacement(
        { ...origin, xMm: -100, yMm: 5_000, zMm: 20 },
        dimensions,
        area,
        support,
      ),
    ).toEqual({ rotation: 0, xMm: 500, yMm: 1_500, zMm: 1_500 });
    expect(palletPlacementIssue(dimensions, area, origin, [], support)).toBe(
      "support",
    );
    expect(
      palletPlacementIssue(
        dimensions,
        area,
        { ...origin, xMm: 500, yMm: 500, zMm: 1_500 },
        [],
        support,
      ),
    ).toBeUndefined();
  });

  it("distinguishes vertically separate rack levels and excludes blocked floor areas", () => {
    const other: OccupiedPallet = {
      ...dimensions,
      id: "below",
      label: "Below",
      xMm: 0,
      yMm: 0,
      zMm: 0,
      status: "STORED",
    };
    expect(
      palletPlacementIssue(dimensions, area, { ...origin, zMm: 1_500 }, [
        other,
      ]),
    ).toBeUndefined();
    expect(
      palletPlacementIssue(dimensions, area, origin, [], undefined, [
        { xMm: 100, yMm: 100, widthMm: 100, depthMm: 100 },
      ]),
    ).toBe("overlap");
  });

  it.each([0, 1, 2, 3])(
    "pointer movement matches projection after camera quarter-turn %s",
    (rotation) => {
      for (const planView of [false, true]) {
        const projected = projectPalletPoint(200, -100, 0, rotation, planView);
        expect(
          unprojectPalletDelta(projected.x, projected.y, rotation, planView),
        ).toEqual({ x: 200, y: -100 });
      }
    },
  );
});

describe("automatic pallet support", () => {
  const base: PlacementSurface = { ...area, xMm: 0, yMm: 0, zMm: 0 };
  const lower: PlacementSurface = {
    ...dimensions,
    xMm: 500,
    yMm: 500,
    zMm: 1400,
    heightMm: 1600,
    supportPalletId: "lower",
  };
  const resolve = (
    p: typeof origin | { xMm: number; yMm: number; rotation: 0 | 90 },
    surfaces: PlacementSurface[] = [lower],
  ) => resolvePalletSupport(p, dimensions, base, surfaces);
  it("raises a footprint onto the top even when only partially overlapping", () => {
    const p = { ...origin, xMm: 400, yMm: 500 };
    const support = resolve(p);
    expect(support.zMm).toBe(1400);
    expect(
      palletPlacementIssue(
        dimensions,
        area,
        { ...p, zMm: support.zMm },
        [],
        support,
      ),
    ).toBe("support");
  });
  it("allows an exact fit without intersecting the lower pallet volume", () => {
    const p = { ...origin, xMm: 500, yMm: 500, zMm: 1400 };
    expect(
      palletPlacementIssue(
        dimensions,
        area,
        p,
        [
          {
            ...dimensions,
            xMm: 500,
            yMm: 500,
            zMm: 0,
            id: "lower",
            label: "Lower",
            status: "STORED",
          },
        ],
        resolve(p),
      ),
    ).toBeUndefined();
  });
  it("keeps the preview above a small base or low ceiling", () => {
    const p = { ...origin, xMm: 500, yMm: 500 };
    for (const candidate of [
      { ...lower, widthMm: 600 },
      { ...lower, heightMm: 300 },
    ]) {
      const support = resolve(p, [candidate]);
      expect(support.zMm).toBe(1400);
      expect(
        palletPlacementIssue(
          dimensions,
          area,
          { ...p, zMm: support.zMm },
          [],
          support,
        ),
      ).toBe(candidate.widthMm === 600 ? "support" : "height");
    }
  });
  it("keeps an overloaded support visible and carries its rejection", () => {
    expect(
      resolve({ ...origin, xMm: 500, yMm: 500 }, [
        { ...lower, blockedReason: "STACK_LEVELS_EXCEEDED" },
      ]),
    ).toMatchObject({ zMm: 1400, blockedReason: "STACK_LEVELS_EXCEEDED" });
  });
  it("drops to the floor when clear or just touching the base", () => {
    expect(resolve({ ...origin, xMm: 1700, yMm: 500 })).toBe(base);
    expect(resolve({ ...origin, xMm: 1800, yMm: 1900 })).toBe(base);
  });
  it("chooses the highest intersecting top and ignores unrelated rack levels", () => {
    expect(
      resolve({ ...origin, xMm: 500, yMm: 500 }, [
        lower,
        { ...lower, zMm: 2800, supportPalletId: "upper" },
        { ...lower, zMm: 4000, baseSupportPositionId: "other-rack" },
      ]).zMm,
    ).toBe(2800);
  });
  it("uses the rotated footprint and returns to an elevated rack", () => {
    const rack = { ...base, zMm: 1000, supportPositionId: "rack" };
    const top = {
      ...lower,
      xMm: 1100,
      baseSupportPositionId: "rack",
      zMm: 2000,
    };
    expect(
      resolvePalletSupport({ ...origin, rotation: 0 }, dimensions, rack, [top])
        .zMm,
    ).toBe(2000);
    expect(
      resolvePalletSupport({ ...origin, rotation: 90 }, dimensions, rack, [top])
        .zMm,
    ).toBe(1000);
  });
});
