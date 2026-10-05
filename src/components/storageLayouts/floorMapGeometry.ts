import type { StorageZoneRow } from "@/lib/convex/storageLayoutApi";
import { locationInventory } from "@/lib/storageLayouts/locationSelectors";
import { resolveAreaColor } from "@/lib/storageLayouts/areaColors";
export interface Area {
  readonly areaKind?: "AISLE" | "PLATFORM" | "STAIRS" | "NO_STORAGE";
  readonly displayHeightMm?: number;
  readonly color?: string;
  readonly xMm: number;
  readonly yMm: number;
  readonly widthMm: number;
  readonly depthMm: number;
  readonly label: string;
}
export const m = (value: number) => Number((value / 1000).toFixed(3));
export const floorZoneUnitCount = (zone: StorageZoneRow) =>
  locationInventory(zone).units;
export const hasUnmeasuredInventory = (zone: StorageZoneRow) =>
  locationInventory(zone).measuredAreaPartial;
// Zoom level from which storage positions show their labels when they fit.
export const labelZoom = 2;
export const planColors = {
  storage: "var(--plan-empty)",
  storageBorder: "var(--plan-wall)",
  storageLabel: "var(--plan-text)",
  aisle: "#ffb68e",
} as const;
export const visualAreaColor = (area: Area) =>
  area.areaKind === "AISLE" ? planColors.aisle : area.color;
export const pdGroupCode = (code: string) =>
  code.match(/^((?:PD|F1|F2|SB)-L\d+)-\d+$/)?.[1];
export const pdCells = (zones: readonly StorageZoneRow[]) =>
  zones.filter((zone) => pdGroupCode(zone.code) !== undefined);
export const isAisleBlock = (block: Area) =>
  /^(?:พื้นที่ทางเดิน|ทางเดิน|(?:main\s+)?aisle|walkway)/i.test(
    block.label.trim(),
  );
export function areaCategory(label: string) {
  const head = label.split(/[·:]/)[0]!.trim();
  return (
    head
      .replace(/\s+(?:PD|F1|F2|SB)-L[\d.]+.*$/i, "")
      .replace(/\s+\d+(?:\.\d+)?(?:\s*(?:m|ม\.?))?.*$/i, "")
      .trim() || head
  );
}
export function groupedAreas(areas: readonly Area[]) {
  const groups = new Map<
    string,
    { label: string; color: string | undefined; count: number }
  >();
  for (const area of areas) {
    const label = areaCategory(area.label);
    const color = visualAreaColor(area);
    const key = `${resolveAreaColor(color)}:${label}`;
    const existing = groups.get(key);
    if (existing) existing.count += 1;
    else groups.set(key, { label, color, count: 1 });
  }
  return [...groups.values()];
}
export function adjacentZone(
  zones: readonly StorageZoneRow[],
  current: StorageZoneRow,
  key: string,
) {
  const horizontal = key === "ArrowLeft" || key === "ArrowRight";
  const sign = key === "ArrowRight" || key === "ArrowDown" ? 1 : -1;
  const centerX = current.xMm + current.widthMm / 2;
  const centerY = current.yMm + current.depthMm / 2;
  return zones
    .filter((zone) => zone.zoneId !== current.zoneId)
    .map((zone) => {
      const dx = zone.xMm + zone.widthMm / 2 - centerX;
      const dy = zone.yMm + zone.depthMm / 2 - centerY;
      const along = (horizontal ? dx : dy) * sign;
      const across = Math.abs(horizontal ? dy : dx);
      return { zone, along, score: along + across * 4 };
    })
    .filter(({ along }) => along > 0)
    .sort((a, b) => a.score - b.score)[0]?.zone;
}
export function groupBounds(zones: readonly StorageZoneRow[]) {
  return {
    xMm: Math.min(...zones.map((zone) => zone.xMm)),
    yMm: Math.min(...zones.map((zone) => zone.yMm)),
    widthMm:
      Math.max(...zones.map((zone) => zone.xMm + zone.widthMm)) -
      Math.min(...zones.map((zone) => zone.xMm)),
    depthMm:
      Math.max(...zones.map((zone) => zone.yMm + zone.depthMm)) -
      Math.min(...zones.map((zone) => zone.yMm)),
  };
}
