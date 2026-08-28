import { describe, expect, it } from "vitest";

import {
  effectiveStorageAreaMode,
  generateRackPositions,
  validateStoragePosition,
} from "./storagePosition";

const area = {
  xMm: 2_000,
  yMm: 1_000,
  widthMm: 12_000,
  depthMm: 6_000,
  maxStackHeightMm: 6_000,
};

describe("storage area modes and leaf positions", () => {
  it("treats a missing migrated mode as SIMPLE", () => {
    expect(effectiveStorageAreaMode(undefined)).toBe("SIMPLE");
  });

  it("allows X/Y floor cells but rejects arbitrary floor elevation", () => {
    expect(
      validateStoragePosition({
        mode: "FLOOR_POSITIONS",
        area,
        position: {
          kind: "FLOOR",
          xMm: 4_000,
          yMm: 2_000,
          widthMm: 2_000,
          depthMm: 2_000,
        },
      }).ok,
    ).toBe(true);
    expect(
      validateStoragePosition({
        mode: "FLOOR_POSITIONS",
        area,
        position: {
          kind: "FLOOR",
          xMm: 4_000,
          yMm: 2_000,
          widthMm: 2_000,
          depthMm: 2_000,
          elevationMm: 900,
        },
      }),
    ).toEqual({
      ok: false,
      error: { code: "FLOOR_POSITION_ELEVATION_FORBIDDEN" },
    });
  });

  it("derives deterministic rack bay, level, slot, and elevation geometry", () => {
    const result = generateRackPositions({
      area,
      fixtureCode: "rack-a",
      bayCount: 3,
      levelCount: 2,
      slotsPerBay: 1,
      bayWidthMm: 3_000,
      rackDepthMm: 1_200,
      levelHeightMm: 2_000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(6);
    expect(result.value[0]).toMatchObject({
      fixtureCode: "RACK-A",
      bayIndex: 1,
      levelIndex: 1,
      slotIndex: 1,
      xMm: 2_000,
      elevationMm: 0,
      codeSuffix: "RACK-A-B01-L01-S01",
    });
    expect(result.value[5]).toMatchObject({
      bayIndex: 3,
      levelIndex: 2,
      xMm: 8_000,
      elevationMm: 2_000,
    });
  });

  it("rejects a rack whose levels exceed the planned area height", () => {
    expect(
      generateRackPositions({
        area,
        fixtureCode: "RACK-A",
        bayCount: 2,
        levelCount: 4,
        slotsPerBay: 1,
        bayWidthMm: 3_000,
        rackDepthMm: 1_200,
        levelHeightMm: 2_000,
      }),
    ).toEqual({ ok: false, error: { code: "RACK_DOES_NOT_FIT_AREA" } });
  });
});
