/** User-approved layout envelope; not a surveyed outer building boundary. */
export const FG1_PREVIOUS_REVISION = "FG1-2026-09-28-bottom-aligned-r1";
export const FG1_REAR_REVISION = "FG1-2026-10-05-no-rear-aisle-r2";
export const FG1_REVISION = "FG1-2026-10-05-r04-r08-7_84-r3";
export const fg1PreviousPlan = () => buildFg1Plan("original");
export const fg1RearPlan = () => buildFg1Plan("rear-reserved");
export const fg1ApprovedPlan = () => buildFg1Plan("expanded");

function buildFg1Plan(variant: "original" | "rear-reserved" | "expanded") {
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
        widthMm: i < 3 ? 7260 : i < 8 && variant !== "expanded" ? 7350 : 7840,
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
          (variant === "original" && i >= 3 && i < 7 ? 300 : 0),
        300,
        "#eda576",
      ),
    );
  if (variant === "original") {
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
  } else if (variant === "rear-reserved") {
    // The rear strip behind R04–R08 is confirmed not to be a passage.
    // Keep its former footprint unavailable until the outer edge is measured.
    right.slice(3, 8).forEach((z, i) => {
      block(
        `ขอบหลัง ${z.code} · ไม่มีทางเดินและห้ามจัดเก็บ`,
        "NO_STORAGE",
        z.xMm + z.widthMm,
        z.yMm,
        300,
        z.depthMm,
        "#8b9292",
      );
      if (i < 4)
        block(
          `ขอบหลังระหว่าง ${z.code}–${right[i + 4]!.code} · ห้ามจัดเก็บ`,
          "NO_STORAGE",
          z.xMm + z.widthMm,
          z.yMm + z.depthMm,
          300,
          300,
          "#8b9292",
        );
    });
  }
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
    revision:
      variant === "original"
        ? FG1_PREVIOUS_REVISION
        : variant === "rear-reserved"
          ? FG1_REAR_REVISION
          : FG1_REVISION,
    widthMm: 12260,
    depthMm: 29930,
    cells,
    blocks,
    grossAreaSqMm,
    reservedAreaSqMm,
    usableAreaSqMm: grossAreaSqMm - reservedAreaSqMm,
  };
}
