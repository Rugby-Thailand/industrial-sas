/** Approved PD revision. Coordinates are integer millimetres from top left. */
export const PD_REVISION = "PD-61500-11960-2026-09-27-r1";
export interface PdRectangle {
  xMm: number;
  yMm: number;
  widthMm: number;
  depthMm: number;
}
export interface PdBlock extends PdRectangle {
  label: string;
  color: string;
  areaKind: "AISLE" | "PLATFORM" | "STAIRS" | "NO_STORAGE";
  displayHeightMm: number;
}
const edge = (length: number, index: number, count: number) =>
  Math.floor((length * index) / count);
export function pdApprovedPlan() {
  const cells: (PdRectangle & { code: string })[] = [];
  const blocks: PdBlock[] = [];
  function block(
    label: string,
    areaKind: PdBlock["areaKind"],
    xMm: number,
    yMm: number,
    widthMm: number,
    depthMm: number,
    displayHeightMm = 0,
  ) {
    blocks.push({
      label,
      areaKind,
      xMm,
      yMm,
      widthMm,
      depthMm,
      displayHeightMm,
      color:
        areaKind === "AISLE"
          ? "#ffb68e"
          : areaKind === "PLATFORM"
            ? "#ffcaca"
            : areaKind === "STAIRS"
              ? "#dfc18a"
              : "#647d82",
    });
  }
  block("ทางเดินหลัก 1.60 ม.", "AISLE", 0, 2400, 61500, 1600);
  for (let g = 0; g < 6; g++) {
    const n = 12 - g,
      start = g * 10000,
      width = n === 7 ? 11500 : 10000;
    const storage = width - 1600;
    block(
      `ทางเดินซอย PD-L${n} 1.60 ม.`,
      "AISLE",
      start + edge(storage, 4, 6),
      0,
      1600,
      2400,
    );
    for (let c = 0; c < 6; c++)
      cells.push({
        code: `PD-L${n}-${13 - c}`,
        xMm: start + edge(storage, c, 6) + (c >= 4 ? 1600 : 0),
        yMm: 0,
        widthMm: edge(storage, c + 1, 6) - edge(storage, c, 6),
        depthMm: 2400,
      });
    for (let c = 0; c < 7; c++)
      cells.push({
        code: `PD-L${n}-${7 - c}`,
        xMm: start + edge(width, c, 7),
        yMm: 4000,
        widthMm: edge(width, c + 1, 7) - edge(width, c, 7),
        depthMm: 2400,
      });
  }
  block(
    "พื้นปูนยกสูง 0.65 ม. · ลึก 1.41 ม.",
    "PLATFORM",
    0,
    6400,
    59400,
    1410,
    650,
  );
  block("บันได 2.10 × 1.51 ม.", "STAIRS", 59400, 6400, 2100, 1510, 650);
  for (let g = 0; g < 6; g++) {
    const n = 6 - g,
      start = g * 9420,
      count = n === 1 ? 5 : 7,
      width = n === 1 ? 9420 : 9120;
    if (n !== 1)
      block(
        `ทางเดิน PD-L${n} ด้านขวา 0.30 ม.`,
        "AISLE",
        start + 9120,
        7810,
        300,
        4150,
      );
    for (let r = 0; r < 3; r++) {
      const yMm = 7810 + edge(3550, r, 3) + r * 300;
      const depthMm = edge(3550, r + 1, 3) - edge(3550, r, 3);
      for (let c = 0; c < count; c++)
        cells.push({
          code: `PD-L${n}-${(3 - r) * count - c}`,
          xMm: start + edge(width, c, count),
          yMm,
          widthMm: edge(width, c + 1, count) - edge(width, c, count),
          depthMm,
        });
      if (r < 2)
        block(
          `ทางเดิน PD-L${n} ระหว่างแถว ${r + 1} 0.30 ม.`,
          "AISLE",
          start,
          yMm + depthMm,
          width,
          300,
        );
    }
  }
  block(
    "ห้ามจัดเก็บ · ด้านข้างบันได 2.88 ม.",
    "NO_STORAGE",
    56520,
    7810,
    2880,
    4150,
  );
  block(
    "ห้ามจัดเก็บ · หน้าบันได 2.10 ม.",
    "NO_STORAGE",
    59400,
    7910,
    2100,
    4050,
  );
  const reservedAreaSqMm = blocks.reduce(
    (n, b) => n + b.widthMm * b.depthMm,
    0,
  );
  return {
    revision: PD_REVISION,
    widthMm: 61500,
    depthMm: 11960,
    cells,
    blocks,
    grossAreaSqMm: 61500 * 11960,
    reservedAreaSqMm,
    usableAreaSqMm: 61500 * 11960 - reservedAreaSqMm,
  };
}
