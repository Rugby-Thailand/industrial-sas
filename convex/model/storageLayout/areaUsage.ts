import {
  occupiedFootprintAreaSqMm,
  type OccupancyRectangle,
} from "./occupancy";

/** Union by zone: stacked pallets share a footprint; separate zones/floors do not. */
export function storageFootprintUsage(
  zones: readonly {
    placements: readonly (Omit<OccupancyRectangle, "xMm" | "yMm"> & {
      xMm?: number;
      yMm?: number;
      status?: string;
    })[];
  }[],
) {
  let storedFootprintAreaSqMm = 0;
  let heldFootprintAreaSqMm = 0;
  for (const zone of zones) {
    const placements = zone.placements.map((p) => ({
      ...p,
      xMm: p.xMm ?? 0,
      yMm: p.yMm ?? 0,
      status: p.status ?? "STORED",
    }));
    const stored = placements.filter((p) => p.status === "STORED");
    const held = placements.filter((p) => p.status === "RESERVED");
    const used = occupiedFootprintAreaSqMm(stored);
    storedFootprintAreaSqMm += used;
    heldFootprintAreaSqMm +=
      occupiedFootprintAreaSqMm([...stored, ...held]) - used;
  }
  return { storedFootprintAreaSqMm, heldFootprintAreaSqMm };
}
