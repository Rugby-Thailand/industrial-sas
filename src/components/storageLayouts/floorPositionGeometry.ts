import type {
  StoragePositionRow,
  StorageZoneRow,
} from "@/lib/convex/storageLayoutApi";

export interface FloorRectangle {
  readonly xMm: number;
  readonly yMm: number;
  readonly widthMm: number;
  readonly depthMm: number;
}

export function floorPositions(
  zone: StorageZoneRow,
): readonly StoragePositionRow[] {
  return zone.positions.filter(
    (position) =>
      position.kind === "FLOOR" &&
      !position.isDefault &&
      position.xMm !== undefined &&
      position.yMm !== undefined &&
      position.widthMm !== undefined &&
      position.depthMm !== undefined,
  );
}

/** Open strips between position rows and columns are walkways in the plan. */
export function positionAisles(zone: StorageZoneRow): FloorRectangle[] {
  const rows = new Map<string, StoragePositionRow[]>();
  for (const position of floorPositions(zone)) {
    const key = `${position.yMm}:${position.depthMm}`;
    rows.set(key, [...(rows.get(key) ?? []), position]);
  }
  const orderedRows = [...rows.values()].sort(
    (a, b) => a[0]!.yMm! - b[0]!.yMm!,
  );
  const aisles: FloorRectangle[] = [];
  for (let index = 0; index < orderedRows.length; index++) {
    const row = orderedRows[index]!;
    const rowStart = row[0]!.yMm!;
    const rowEnd = rowStart + row[0]!.depthMm!;
    const next = orderedRows[index + 1];
    if (next && next[0]!.yMm! > rowEnd) {
      aisles.push({
        xMm: zone.xMm,
        yMm: rowEnd,
        widthMm: zone.widthMm,
        depthMm: next[0]!.yMm! - rowEnd,
      });
    }
    const columns = [...row].sort((a, b) => a.xMm! - b.xMm!);
    for (let column = 0; column < columns.length - 1; column++) {
      const left = columns[column]!;
      const right = columns[column + 1]!;
      const gap = right.xMm! - left.xMm! - left.widthMm!;
      if (gap > 0) {
        aisles.push({
          xMm: left.xMm! + left.widthMm!,
          yMm: rowStart,
          widthMm: gap,
          depthMm: left.depthMm!,
        });
      }
    }
  }
  return aisles;
}
