export interface OccupancyRectangle {
  readonly xMm: number;
  readonly yMm: number;
  readonly widthMm: number;
  readonly depthMm: number;
}

/** Floor footprint union, including reservations and all supported elevations. */
export function occupiedFootprintAreaSqMm(
  rectangles: readonly OccupancyRectangle[],
): number {
  const valid = rectangles.filter(
    (r) =>
      [r.xMm, r.yMm, r.widthMm, r.depthMm].every(Number.isFinite) &&
      r.widthMm > 0 &&
      r.depthMm > 0,
  );
  if (!valid.length) return 0;
  const ys = [
    ...new Set(valid.flatMap((r) => [r.yMm, r.yMm + r.depthMm])),
  ].sort((a, b) => a - b);
  const yIndex = new Map(ys.map((y, i) => [y, i]));
  const events = valid
    .flatMap((r) => [
      {
        x: r.xMm,
        start: yIndex.get(r.yMm)!,
        end: yIndex.get(r.yMm + r.depthMm)!,
        delta: 1,
      },
      {
        x: r.xMm + r.widthMm,
        start: yIndex.get(r.yMm)!,
        end: yIndex.get(r.yMm + r.depthMm)!,
        delta: -1,
      },
    ])
    .sort((a, b) => a.x - b.x);
  // Coordinate-compressed segment tree keeps large reservation sets O(n log n).
  const counts = new Int32Array(ys.length * 4);
  const covered = new Float64Array(ys.length * 4);
  function update(
    node: number,
    left: number,
    right: number,
    start: number,
    end: number,
    delta: number,
  ) {
    if (start >= right || end <= left) return;
    if (start <= left && end >= right) counts[node] = counts[node]! + delta;
    else {
      const middle = Math.floor((left + right) / 2);
      update(node * 2, left, middle, start, end, delta);
      update(node * 2 + 1, middle, right, start, end, delta);
    }
    covered[node] =
      counts[node]! > 0
        ? ys[right]! - ys[left]!
        : right - left === 1
          ? 0
          : covered[node * 2]! + covered[node * 2 + 1]!;
  }
  let area = 0;
  let previousX = events[0]!.x;
  for (const event of events) {
    area += (event.x - previousX) * covered[1]!;
    update(1, 0, ys.length - 1, event.start, event.end, event.delta);
    previousX = event.x;
  }
  return area;
}
