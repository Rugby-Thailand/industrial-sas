import type { StorageZoneRow } from "@/lib/convex/storageLayoutApi";
import { occupiedStorageFootprintAreaSqMm } from "./storagePlacementGeometry";
import { storageLocationSummary } from "./storageKit";

/** Shared location matching for the map, collection and management panel. */
const normalize = (value: string) =>
  value.normalize("NFKC").toLocaleLowerCase();
export function matchingStorageLocations(
  zones: readonly StorageZoneRow[],
  search: string,
) {
  const words = normalize(search).trim().split(/\s+/).filter(Boolean);
  return zones.filter((zone) => {
    const text = normalize(
      [
        zone.label,
        zone.code,
        zone.qrValue,
        ...zone.positions.flatMap((p) => [p.label, p.code, p.qrValue]),
        ...zone.placements.flatMap((p) => [p.lpn, p.positionCode ?? ""]),
        ...(zone.locationOnlyPlacements ?? []).flatMap((p) => [
          p.lpn,
          p.positionCode,
        ]),
      ].join(" "),
    );
    return words.every((word) => text.includes(word));
  });
}

/** Unique units and measured footprint; summary-only data stays explicitly incomplete. */
export function locationInventory(zone: StorageZoneRow) {
  const summary = storageLocationSummary(zone);
  return {
    // Some callers only have the unmeasured summary, not its individual rows.
    // In that case the fallback is a lower bound, never a fabricated total.
    units: summary.units,
    totalIncomplete: zone.palletCount === undefined && summary.incomplete,
    stored: summary.stored,
    reserved: summary.reserved,
    unmeasured: summary.unmeasured,
    incomplete: summary.incomplete,
    measuredAreaPartial:
      Boolean(zone.measuredAreaPartial) ||
      summary.unmeasured > 0 ||
      summary.units >
        new Set(zone.placements.map((p) => p.handlingUnitId)).size,
    get measuredFootprintAreaSqMm() {
      return occupiedStorageFootprintAreaSqMm(zone.placements);
    },
  };
}
