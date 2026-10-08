import { describe, expect, it } from "vitest";
import { floorPlanBounds } from "./floorMapGeometry";

const floor = {
  widthMm: 60000,
  depthMm: 13000,
  baseWidthMm: 50000,
  baseDepthMm: 28000,
  offsetXMm: 10000,
  offsetYMm: 3000,
};

describe("plan footprint", () => {
  it("uses only the floor when the building reference is hidden", () => {
    expect(floorPlanBounds(floor, false)).toEqual({
      xMm: 0,
      yMm: 0,
      widthMm: 60000,
      depthMm: 13000,
    });
  });
  it("includes a building reference extending left and above the floor", () => {
    expect(floorPlanBounds(floor, true)).toEqual({
      xMm: -10000,
      yMm: -3000,
      widthMm: 70000,
      depthMm: 28000,
    });
  });
  it("includes a reference extending right and below with negative offsets", () => {
    expect(
      floorPlanBounds({ ...floor, offsetXMm: -20000, offsetYMm: -5000 }, true),
    ).toEqual({ xMm: 0, yMm: 0, widthMm: 70000, depthMm: 33000 });
  });
});
