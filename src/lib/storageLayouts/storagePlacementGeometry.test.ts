import { describe, expect, it } from "vitest";
import type { StorageStackPlacementRow } from "@/lib/convex/storageLayoutApi";
import {
  maximumOccupiedHeight,
  storagePlacementBoxes,
  uniqueStoragePallets,
  occupiedStorageFootprintAreaSqMm,
} from "./storagePlacementGeometry";

const row: StorageStackPlacementRow = {
  placementId: "a",
  handlingUnitId: "pallet-a",
  lpn: "P-001",
  levelIndex: 1,
  widthMm: 1_000,
  depthMm: 1_200,
  heightMm: 1_400,
  orientation: "DEFAULT",
  placedAt: 1,
};

describe("planner placement geometry", () => {
  it("retains source and destination boxes but counts one moving pallet and a union footprint", () => {
    const placements = [
      {
        ...row,
        placementId: "source",
        xMm: 0,
        yMm: 0,
        zMm: 0,
        status: "STORED" as const,
      },
      {
        ...row,
        placementId: "target",
        xMm: 500,
        yMm: 0,
        zMm: 0,
        status: "RESERVED" as const,
      },
    ];
    expect(storagePlacementBoxes(placements)).toHaveLength(2);
    expect(uniqueStoragePallets(placements)).toHaveLength(1);
    expect(occupiedStorageFootprintAreaSqMm(placements)).toBe(1_800_000);
    expect(
      occupiedStorageFootprintAreaSqMm([
        ...placements,
        { ...placements[0]!, placementId: "higher", zMm: 2_000 },
      ]),
    ).toBe(1_800_000);
  });
  it("keeps side-by-side pallets at the same elevation and reports their highest top", () => {
    const placements = [
      { ...row, xMm: 0, yMm: 0, zMm: 0 },
      { ...row, placementId: "b", xMm: 1_000, yMm: 0, zMm: 0 },
    ];
    expect(
      storagePlacementBoxes(placements, { xMm: 500, yMm: 700 }),
    ).toMatchObject([
      { xMm: 500, yMm: 700, zMm: 0 },
      { xMm: 1_500, yMm: 700, zMm: 0 },
    ]);
    expect(maximumOccupiedHeight(placements)).toBe(1_400);
  });
  it("honors exact rack elevation and does not rotate an already oriented footprint again", () => {
    const placements = [
      {
        ...row,
        xMm: 100,
        yMm: 200,
        zMm: 1_500,
        orientation: "ROTATED" as const,
      },
    ];
    expect(storagePlacementBoxes(placements)[0]).toMatchObject({
      xMm: 100,
      yMm: 200,
      zMm: 1_500,
      widthMm: 1_000,
      depthMm: 1_200,
    });
    expect(maximumOccupiedHeight(placements)).toBe(2_900);
  });
  it("only stacks legacy rows without coordinates", () => {
    const boxes = storagePlacementBoxes([
      row,
      { ...row, placementId: "exact", xMm: 1_000, yMm: 0, zMm: 0 },
      { ...row, placementId: "legacy-two", levelIndex: 2 },
    ]);
    expect(boxes.map((box) => box.zMm)).toEqual([0, 0, 1_400]);
    expect(maximumOccupiedHeight([])).toBe(0);
  });
  it("does not send non-finite dimensions to the drawing", () => {
    expect(storagePlacementBoxes([{ ...row, heightMm: NaN }])).toEqual([]);
  });
});
