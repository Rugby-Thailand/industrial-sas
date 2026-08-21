import { describe, expect, it } from "vitest";

import {
  buildIsometricBuilding,
  projectIsometricPoint,
  unprojectIsometricDelta,
} from "./isometricGeometry";

describe("isometric geometry", () => {
  it("projects plan coordinates consistently", () => {
    expect(projectIsometricPoint({ x: 10, y: 4, z: 3 })).toEqual({
      x: 6,
      y: 4,
    });
  });

  it("converts a pointer drag back to the floor grid", () => {
    const projectedStart = projectIsometricPoint({ x: 0, y: 0, z: 0 });
    const projectedEnd = projectIsometricPoint({ x: 24, y: 12, z: 0 });

    expect(
      unprojectIsometricDelta(
        {
          x: projectedEnd.x - projectedStart.x,
          y: projectedEnd.y - projectedStart.y,
        },
        0.012,
      ),
    ).toEqual({ x: 2_000, y: 1_000 });
  });

  it("builds one ordered slab per floor with cumulative elevations", () => {
    const result = buildIsometricBuilding(
      [
        { floorNumber: 1, widthMm: 30_000, depthMm: 20_000, heightMm: 4_500 },
        { floorNumber: 2, widthMm: 30_000, depthMm: 20_000, heightMm: 4_000 },
        { floorNumber: 3, widthMm: 20_000, depthMm: 12_000, heightMm: 4_000 },
      ],
      { scale: 0.01, gap: 12 },
    );

    expect(result.slabs.map((slab) => slab.elevationMm)).toEqual([
      0, 4_500, 8_500,
    ]);
    expect(result.slabs[2]!.top.length).toBe(4);
    expect(result.viewBox.width).toBeGreaterThan(0);
    expect(result.viewBox.height).toBeGreaterThan(0);
  });

  it("centers each smaller footprint on the floor immediately below", () => {
    const result = buildIsometricBuilding([
      { floorNumber: 1, widthMm: 30_000, depthMm: 20_000, heightMm: 4_000 },
      { floorNumber: 2, widthMm: 24_000, depthMm: 18_000, heightMm: 4_000 },
      { floorNumber: 3, widthMm: 10_000, depthMm: 10_000, heightMm: 3_000 },
    ]);
    const centroidX = (points: readonly { readonly x: number }[]) =>
      points.reduce((total, point) => total + point.x, 0) / points.length;

    expect(centroidX(result.slabs[1]!.top)).toBe(
      centroidX(result.slabs[0]!.top),
    );
    expect(centroidX(result.slabs[2]!.top)).toBe(
      centroidX(result.slabs[1]!.top),
    );
  });

  it("applies explicit offsets relative to the previous floor", () => {
    const result = buildIsometricBuilding([
      { floorNumber: 1, widthMm: 30_000, depthMm: 20_000, heightMm: 4_000 },
      {
        floorNumber: 2,
        widthMm: 20_000,
        depthMm: 10_000,
        heightMm: 4_000,
        offsetXMm: 0,
        offsetYMm: 0,
      },
      {
        floorNumber: 3,
        widthMm: 10_000,
        depthMm: 5_000,
        heightMm: 3_000,
        offsetXMm: 10_000,
        offsetYMm: 5_000,
      },
    ]);

    expect(result.slabs[1]!.top[0]).toEqual({ x: 0, y: -90 });
    expect(result.slabs[2]!.top[0]).toEqual({ x: 50, y: -55 });
  });
});
