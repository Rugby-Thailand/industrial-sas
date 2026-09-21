import { describe, expect, it } from "vitest";
import type { StorageZoneRow } from "@/lib/convex/storageLayoutApi";
import {
  millimetres,
  placementStatusKey,
  storageAreaSummary,
  storageLocationSummary,
} from "./storageKit";

const zone = (overrides: Partial<StorageZoneRow> = {}): StorageZoneRow => ({
  zoneId: "zone",
  locationId: "location",
  code: "A-01",
  label: "Shelf",
  qrValue: "qr",
  mode: "SIMPLE",
  xMm: 0,
  yMm: 0,
  widthMm: 1_000,
  depthMm: 1_000,
  maxStackHeightMm: 2_000,
  positions: [],
  placements: [],
  ...overrides,
});

describe("storageKit", () => {
  it("rounds valid editable metre values and preserves invalid input as NaN", () => {
    expect(millimetres("1.234")).toBe(1234);
    expect(millimetres("invalid")).toBeNaN();
  });

  it("maps move semantics before ordinary stored/reserved status", () => {
    expect(placementStatusKey({ moveRole: "TARGET", status: "STORED" })).toBe(
      "placementMoveTarget",
    );
    expect(
      placementStatusKey({
        moveRole: "SOURCE",
        moveState: "IN_TRANSIT",
        status: "STORED",
      }),
    ).toBe("placementMoveInTransit");
    expect(placementStatusKey({ status: "RESERVED" })).toBe(
      "placementReserved",
    );
  });

  it("clamps area summaries without manufacturing capacity", () => {
    expect(
      storageAreaSummary({
        grossAreaSqMm: 100,
        usableAreaSqMm: 80,
        storedFootprintAreaSqMm: 90,
        heldFootprintAreaSqMm: 20,
      }),
    ).toEqual({
      gross: 100,
      usable: 80,
      stored: 80,
      reserved: 0,
      free: 0,
      unavailable: 20,
    });
  });

  it("retains unknown inventory as incomplete while counting known units", () => {
    expect(
      storageLocationSummary(zone({ palletCount: 4, unmeasuredPalletCount: 2 }))
        .incomplete,
    ).toBe(true);
    expect(storageLocationSummary(zone({ palletCount: 0 })).units).toBe(0);
  });

  it("counts distinct measured and location-only units together", () => {
    expect(
      storageLocationSummary(
        zone({
          placements: [
            {
              placementId: "measured",
              handlingUnitId: "unit-measured",
              lpn: "L1",
              levelIndex: 0,
              widthMm: 1,
              depthMm: 1,
              heightMm: 1,
              orientation: "DEFAULT",
              placedAt: 1,
              status: "STORED",
            },
          ],
          locationOnlyPlacements: [
            {
              mode: "LOCATION_ONLY",
              placementId: "unmeasured",
              handlingUnitId: "unit-unmeasured",
              lpn: "L2",
              assignmentId: "assignment",
              sequence: 1,
              positionCode: "A-01",
              status: "STORED",
            },
          ],
        }),
      ).units,
    ).toBe(2);
  });
});
