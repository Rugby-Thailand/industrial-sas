import { describe, expect, it } from "vitest";

import {
  makeStorageZoneCode,
  makeStorageZoneQrValue,
  planStackPlacement,
  validateStorageZone,
} from "./storageZone";

describe("storage zones", () => {
  it("accepts usable space and refuses overlap with reserved space", () => {
    const base = {
      floorWidthMm: 20_000,
      floorDepthMm: 16_000,
      floorHeightMm: 4_000,
      candidate: {
        xMm: 5_000,
        yMm: 4_000,
        widthMm: 4_000,
        depthMm: 3_000,
        maxStackHeightMm: 3_500,
      },
      zones: [],
    };
    expect(validateStorageZone({ ...base, reserved: [] }).ok).toBe(true);
    expect(
      validateStorageZone({
        ...base,
        reserved: [{ xMm: 8_000, yMm: 6_000, widthMm: 2_000, depthMm: 2_000 }],
      }),
    ).toEqual({ ok: false, error: { code: "ZONE_OVERLAPS_RESERVED_SPACE" } });
  });

  it("uses the floor height and footprint as hard geometry bounds", () => {
    expect(
      validateStorageZone({
        floorWidthMm: 10_000,
        floorDepthMm: 10_000,
        floorHeightMm: 3_000,
        candidate: {
          xMm: 7_000,
          yMm: 0,
          widthMm: 4_000,
          depthMm: 2_000,
          maxStackHeightMm: 3_500,
        },
        reserved: [],
        zones: [],
      }),
    ).toEqual({ ok: false, error: { code: "ZONE_OUT_OF_BOUNDS" } });
  });

  it("places handling units from bottom to top and warns on height overflow", () => {
    expect(
      planStackPlacement({
        zone: { widthMm: 1_200, depthMm: 1_000, maxStackHeightMm: 2_400 },
        placements: [
          { levelIndex: 1, heightMm: 1_000 },
          { levelIndex: 2, heightMm: 900 },
        ],
        handlingUnit: { widthMm: 900, depthMm: 1_100, heightMm: 600 },
      }),
    ).toEqual({
      ok: true,
      value: {
        levelIndex: 3,
        orientation: "ROTATED",
        occupiedHeightMm: 1_900,
        resultingHeightMm: 2_500,
        capacityWarning: true,
      },
    });
  });

  it("creates stable human and scanner identifiers", () => {
    expect(makeStorageZoneCode("BLDG-A", 4, 3)).toBe("BLDG-A-F04-Z03");
    expect(makeStorageZoneQrValue("loc_123")).toBe("ISAS:LOCATION:1:loc_123");
  });
});
