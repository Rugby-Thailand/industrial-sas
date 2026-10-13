import { describe, expect, it } from "vitest";

import { findFreePlacement, placementProblem } from "./zonePlacement";
import { measuredMillimetres } from "./measure";

describe("storage spot placement", () => {
  it("finds a narrow gap beside an existing area that a 0.5 m grid misses", () => {
    // A 2.2 m aisle leaves a 1.96 m strip; a 1.9 m spot fits at x = 10.06 m.
    const areas = [{ xMm: 0, yMm: 0, widthMm: 10_060, depthMm: 11_960 }];
    expect(findFreePlacement(12_020, 11_960, 1_900, 2_000, areas)).toEqual({
      xMm: 10_060,
      yMm: 0,
    });
  });

  it("returns null instead of an overlapping origin when nothing fits", () => {
    const full = [{ xMm: 0, yMm: 0, widthMm: 12_000, depthMm: 12_000 }];
    expect(findFreePlacement(12_000, 12_000, 2_000, 2_000, full)).toBeNull();
  });

  it("names the colliding areas and allows unavailable areas inside a spot", () => {
    const areas = [
      {
        xMm: 500,
        yMm: 500,
        widthMm: 100,
        depthMm: 100,
        label: "Column",
        kind: "unavailable" as const,
      },
      {
        xMm: 1_500,
        yMm: 0,
        widthMm: 1_000,
        depthMm: 1_000,
        label: "PD-F01-Z02",
        kind: "spot" as const,
      },
    ];
    const base = {
      heightMm: 2_000,
      floorWidthMm: 10_000,
      floorDepthMm: 10_000,
      floorHeightMm: 4_000,
      areas,
    };
    expect(
      placementProblem({
        ...base,
        draft: { xMm: 0, yMm: 0, widthMm: 1_000, depthMm: 1_000 },
      }),
    ).toBeNull();
    expect(
      placementProblem({
        ...base,
        draft: { xMm: 0, yMm: 0, widthMm: 2_000, depthMm: 1_000 },
      }),
    ).toEqual({ kind: "overlaps", names: ["PD-F01-Z02"] });
    expect(
      placementProblem({
        ...base,
        draft: { xMm: 9_500, yMm: 0, widthMm: 1_000, depthMm: 1_000 },
      }),
    ).toEqual({ kind: "outside" });
    expect(placementProblem({ ...base, draft: null })).toEqual({
      kind: "incomplete",
    });
  });
});

describe("measured millimetres", () => {
  it("keeps survey precision and rejects sub-millimetre or invalid input", () => {
    expect(measuredMillimetres("11.96")).toBe(11_960);
    expect(measuredMillimetres("0.001")).toBe(1);
    expect(measuredMillimetres("12")).toBe(12_000);
    expect(measuredMillimetres("11.9605")).toBeNull();
    expect(measuredMillimetres("-1")).toBeNull();
    expect(measuredMillimetres("")).toBeNull();
    expect(measuredMillimetres("1e3")).toBeNull();
  });
});
