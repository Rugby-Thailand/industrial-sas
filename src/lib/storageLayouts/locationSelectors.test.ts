import { describe, expect, it } from "vitest";
import { floorMapDemo } from "@/components/storageLayouts/storageFloorDemoData";
import type {
  LocationOnlyPlacementRow,
  StorageZoneRow,
} from "@/lib/convex/storageLayoutApi";
import {
  locationInventory,
  matchingStorageLocations,
} from "./locationSelectors";

const base = floorMapDemo(false, false).zones[0]!;
const saved = (
  handlingUnitId: string,
  status: LocationOnlyPlacementRow["status"] = "STORED",
): LocationOnlyPlacementRow => ({
  mode: "LOCATION_ONLY",
  placementId: handlingUnitId,
  handlingUnitId,
  lpn: "Saved Unit",
  assignmentId: "assignment",
  sequence: 1,
  positionCode: "Shelf B",
  status,
});

describe("shared location selectors", () => {
  it("matches normalized words across location, position and unmeasured unit fields", () => {
    const zone: StorageZoneRow = {
      ...base,
      label: "Ｓｔｏｒｅ",
      locationOnlyPlacements: [saved("u")],
    };
    expect(matchingStorageLocations([zone], "store saved shelf")).toEqual([
      zone,
    ]);
    expect(matchingStorageLocations([zone], "store missing")).toEqual([]);
    expect(matchingStorageLocations([zone], "demo:location")).toEqual([zone]);
  });
  it("deduplicates a unit shared by measured and location-only placements and excludes released rows", () => {
    const unit = base.placements[0]!;
    const zone = {
      ...base,
      placements: [
        unit,
        { ...unit, placementId: "hold", status: "RESERVED" as const },
      ],
      locationOnlyPlacements: [
        saved(unit.handlingUnitId),
        saved("released", "RELEASED"),
      ],
      palletCount: 1,
    };
    expect(locationInventory(zone)).toMatchObject({
      units: 1,
      stored: 1,
      reserved: 1,
      unmeasured: 1,
      incomplete: false,
      measuredAreaPartial: true,
    });
  });
  it("uses authoritative totals and marks missing details rather than inventing empty inventory", () => {
    expect(
      locationInventory({
        ...base,
        placements: [],
        palletCount: 4,
        unmeasuredPalletCount: 3,
      }),
    ).toMatchObject({
      units: 4,
      stored: 0,
      reserved: 0,
      incomplete: true,
      totalIncomplete: false,
    });
    expect(
      locationInventory({ ...base, placements: [], unmeasuredPalletCount: 3 }),
    ).toMatchObject({ units: 3, incomplete: true, totalIncomplete: true });
    expect(locationInventory({ ...base, placements: [] })).toMatchObject({
      units: 0,
      incomplete: false,
      measuredAreaPartial: false,
      measuredFootprintAreaSqMm: 0,
    });
  });
});
