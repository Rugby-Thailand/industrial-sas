import { describe, it, expect } from "vitest";
import { floorMapDemo } from "./storageFloorDemoData";
import {
  occupiedStorageFootprintAreaSqMm,
  storagePlacementBoxes,
} from "@/lib/storageLayouts/storagePlacementGeometry";

const overlaps = (
  a: { xMm: number; yMm: number; widthMm: number; depthMm: number },
  b: typeof a,
) =>
  a.xMm < b.xMm + b.widthMm &&
  a.xMm + a.widthMm > b.xMm &&
  a.yMm < b.yMm + b.depthMm &&
  a.yMm + a.depthMm > b.yMm;
describe("populated floor demonstration", () => {
  it.each([false, true])(
    "keeps walkways clear and every unit inside a location (full=%s)",
    (full) => {
      const data = floorMapDemo(full, false);
      expect(data.zones.reduce((sum, z) => sum + z.placements.length, 0)).toBe(
        full ? 120 : 62,
      );
      for (const zone of data.zones) {
        const boxes = storagePlacementBoxes(zone.placements, zone);
        for (const box of boxes) {
          expect(box.xMm).toBeGreaterThanOrEqual(zone.xMm);
          expect(box.yMm).toBeGreaterThanOrEqual(zone.yMm);
          expect(box.xMm + box.widthMm).toBeLessThanOrEqual(
            zone.xMm + zone.widthMm,
          );
          expect(box.yMm + box.depthMm).toBeLessThanOrEqual(
            zone.yMm + zone.depthMm,
          );
          expect(data.blocks.some((b) => overlaps(box, b))).toBe(false);
        }
        boxes.forEach((a, i) =>
          boxes.slice(i + 1).forEach((b) => expect(overlaps(a, b)).toBe(false)),
        );
        if (full)
          expect(occupiedStorageFootprintAreaSqMm(zone.placements)).toBe(
            zone.widthMm * zone.depthMm,
          );
      }
    },
  );
  it("includes full, empty, partial and reserved examples without changing the other scenario", () => {
    const mixed = floorMapDemo(false, true);
    expect(mixed.zones[0]!.placements).toHaveLength(30);
    expect(
      mixed.zones[1]!.placements.filter((p) => p.status === "RESERVED"),
    ).toHaveLength(6);
    expect(mixed.zones[2]!.placements).toHaveLength(8);
    expect(mixed.zones[3]!.placements).toHaveLength(0);
    floorMapDemo(true, true);
    expect(mixed.zones[3]!.placements).toHaveLength(0);
  });
});
