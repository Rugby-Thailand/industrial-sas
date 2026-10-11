import type { BarcodeCrop } from "./barcodeDecoder";

/** Dense edges across the bars identify regions independently of a fixture or label. */
export function linearBarcodeRegions(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  direction: "vertical" | "horizontal" = "vertical",
): BarcodeCrop[] {
  const horizontal = direction === "horizontal";
  const cellWidth = horizontal ? 12 : 24,
    cellHeight = horizontal ? 24 : 12;
  const columns = Math.ceil(width / cellWidth),
    rows = Math.ceil(height / cellHeight);
  const cells = new Uint8Array(columns * rows);
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < columns; cx++) {
      let edges = 0,
        samples = 0;
      for (
        let y = cy * cellHeight + (horizontal ? 1 : 0);
        y < Math.min(height, (cy + 1) * cellHeight);
        y += horizontal ? 1 : 2
      ) {
        for (
          let x = cx * cellWidth + (horizontal ? 0 : 1);
          x < Math.min(width, (cx + 1) * cellWidth);
          x += horizontal ? 2 : 1
        ) {
          const offset = (y * width + x) * 4;
          const previous = offset - (horizontal ? width * 4 : 4);
          const difference =
            Math.abs(
              data[offset]! +
                data[offset + 1]! +
                data[offset + 2]! -
                (data[previous]! + data[previous + 1]! + data[previous + 2]!),
            ) / 3;
          if (difference > 32) edges++;
          samples++;
        }
      }
      if (samples && edges / samples >= 0.2) cells[cy * columns + cx] = 1;
    }
  }
  const found: (BarcodeCrop & { score: number })[] = [];
  for (let start = 0; start < cells.length; start++) {
    if (!cells[start]) continue;
    const stack = [start];
    cells[start] = 0;
    let minX = columns,
      maxX = 0,
      minY = rows,
      maxY = 0,
      count = 0;
    while (stack.length) {
      const index = stack.pop()!;
      const x = index % columns,
        y = Math.floor(index / columns);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      count++;
      // Bridge a short reflection gap, including slightly tilted bars.
      const bridgeX = horizontal ? 1 : 2;
      const bridgeY = horizontal ? 2 : 1;
      for (let dy = -bridgeY; dy <= bridgeY; dy++) {
        for (let dx = -bridgeX; dx <= bridgeX; dx++) {
          const nx = x + dx,
            ny = y + dy;
          if (nx < 0 || nx >= columns || ny < 0 || ny >= rows) continue;
          const next = ny * columns + nx;
          if (cells[next]) {
            cells[next] = 0;
            stack.push(next);
          }
        }
      }
    }
    const bw = (maxX - minX + 1) * cellWidth,
      bh = (maxY - minY + 1) * cellHeight;
    const along = horizontal ? bh : bw;
    const across = horizontal ? bw : bh;
    if (count < 6 || along < 96 || along < across * 1.5) continue;
    const left = Math.max(0, minX * cellWidth - cellWidth);
    const top = Math.max(0, minY * cellHeight - cellHeight);
    const right = Math.min(width, (maxX + 1) * cellWidth + cellWidth);
    const bottom = Math.min(height, (maxY + 1) * cellHeight + cellHeight);
    found.push({
      x: left / width,
      y: top / height,
      width: (right - left) / width,
      height: (bottom - top) / height,
      score: count,
    });
  }
  return found
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(({ score: _score, ...crop }) => crop);
}
