/** User-approved layout envelope; not a surveyed outer building boundary. */
export const FG1_REVISION = "FG1-2026-09-28-bottom-aligned-r1";
export function fg1ApprovedPlan() {
  const cells: {
    code: string;
    xMm: number;
    yMm: number;
    widthMm: number;
    depthMm: number;
  }[] = [];
  const blocks: {
    label: string;
    areaKind: "AISLE" | "NO_STORAGE";
    color: string;
    xMm: number;
    yMm: number;
    widthMm: number;
    depthMm: number;
    displayHeightMm: number;
  }[] = [];
  function block(
    label: string,
    kind: "AISLE" | "NO_STORAGE",
    x: number,
    y: number,
    w: number,
    d: number,
    color: string,
    height = 0,
  ) {
    blocks.push({
      label,
      areaKind: kind,
      xMm: x,
      yMm: y,
      widthMm: w,
      depthMm: d,
      color,
      displayHeightMm: height,
    });
  }
  const left = [
    [0, 4820],
    [6420, 5860],
    [13780, 12400],
    [26480, 1700],
    [28480, 1450],
  ];
  left.forEach(([y, d], i) =>
    cells.push({
      code: `FG1-L0${i + 1}`,
      xMm: 0,
      yMm: y!,
      widthMm: 2870,
      depthMm: d!,
    }),
  );
  let y = 3080;
  [1650, 3000, 3000, 1600, 3000, 2900, 2900, 2900, 1700, 1500].forEach(
    (d, i) => {
      cells.push({
        code: `FG1-R${String(i + 1).padStart(2, "0")}`,
        xMm: 4420,
        yMm: y,
        widthMm: i < 3 ? 7260 : i < 8 ? 7350 : 7840,
        depthMm: d,
      });
      y += d + (i < 9 ? 300 : 0);
    },
  );
  const right = cells.slice(5);
  [26180, 28180].forEach((start, i) =>
    block(
      `ทางเดิน L0${i + 3}–L0${i + 4}`,
      "AISLE",
      0,
      start,
      2870,
      300,
      "#eda576",
    ),
  );
  right
    .slice(0, -1)
    .forEach((z, i) =>
      block(
        `ทางเดิน ${z.code}–${right[i + 1]!.code}`,
        "AISLE",
        4420,
        z.yMm + z.depthMm,
        Math.max(z.widthMm, right[i + 1]!.widthMm) +
          (i >= 3 && i < 7 ? 300 : 0),
        300,
        "#eda576",
      ),
    );
  right
    .slice(3, 8)
    .forEach((z) =>
      block(
        `ทางเดินริมขวา ${z.code} · ขนาดประมาณ`,
        "AISLE",
        z.xMm + z.widthMm,
        z.yMm,
        300,
        z.depthMm,
        "#eda576",
      ),
    );
  block(
    "ห้ามจัดเก็บระหว่าง L01–L02",
    "NO_STORAGE",
    0,
    4820,
    2870,
    1600,
    "#e8cc69",
  );
  block(
    "จุดสงวนใน L02 · ตำแหน่งประมาณ",
    "NO_STORAGE",
    200,
    10900,
    1200,
    650,
    "#cb7c7c",
    750,
  );
  // Central receiving passage stays neutral in the approved 2D view.
  block(
    "พื้นที่รับสินค้าและช่องกลาง",
    "NO_STORAGE",
    2870,
    0,
    1550,
    29930,
    "#8b9292",
  );
  const grossAreaSqMm = 12260 * 29930;
  const reservedAreaSqMm = blocks.reduce(
    (n, b) => n + b.widthMm * b.depthMm,
    0,
  );
  return {
    revision: FG1_REVISION,
    widthMm: 12260,
    depthMm: 29930,
    cells,
    blocks,
    grossAreaSqMm,
    reservedAreaSqMm,
    usableAreaSqMm: grossAreaSqMm - reservedAreaSqMm,
  };
}
