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
  it("returns every location in order as a new array for blank or Unicode-whitespace search", () => {
    const zones = floorMapDemo(false, false).zones;
    for (const search of ["", " \t\n", "\u3000\u00a0\u2003"]) {
      const result = matchingStorageLocations(zones, search);
      expect(result).not.toBe(zones);
      expect(result).toHaveLength(zones.length);
      result.forEach((zone, i) => expect(zone).toBe(zones[i]));
    }
  });
  it("does not read position or placement text for blank search", () => {
    const unread = () => {
      throw new Error("blank search read searchable details");
    };
    const zone: StorageZoneRow = Object.defineProperties(
      { ...base },
      {
        positions: { get: unread },
        placements: { get: unread },
        locationOnlyPlacements: { get: unread },
      },
    );
    expect(matchingStorageLocations([zone], " ")).toEqual([zone]);
  });
  it("requires every word across position and measured placement fields", () => {
    const [first, second] = floorMapDemo(false, false).zones;
    const zone: StorageZoneRow = {
      ...first!,
      positions: [
        {
          locationId: first!.locationId,
          code: "R-07",
          label: "Rack Bay",
          qrValue: "QR:SLOT-7",
          kind: "RACK_SLOT",
          isDefault: false,
          breadcrumb: "",
          placements: [],
        },
      ],
    };
    const zones = [zone, second!];
    expect(
      matchingStorageLocations(zones, "RACK r-07 qr:slot-7 demo-p-001"),
    ).toEqual([zone]);
    expect(matchingStorageLocations(zones, "demo-z01-02")).toEqual([zone]);
    expect(matchingStorageLocations(zones, "demo-p-031")).toEqual([second]);
    expect(matchingStorageLocations(zones, "rack demo-p-031")).toEqual([]);
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
