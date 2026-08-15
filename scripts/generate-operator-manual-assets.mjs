import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Rebuild the annotated screenshots used by the Thai operator guide.
 *
 * The annotations are SVG overlays rather than destructive raster edits. This
 * keeps the captured UI pixel-exact while making every red rectangle and step
 * number easy to review or move when the interface changes.
 */
const sourceRoot = resolve(
  process.argv[2] ??
    join(process.cwd(), "../industrial-sas-visual-audit/after-final"),
);
const outputRoot = join(process.cwd(), "docs/manuals/assets/operator-guide-th");

const screens = [
  {
    name: "dashboard",
    width: 1280,
    height: 2007,
    boxes: [
      [205, 158, 270, 58],
      [270, 1080, 965, 300],
    ],
  },
  {
    name: "items",
    width: 1280,
    height: 1543,
    boxes: [
      [1090, 525, 120, 435],
      [278, 1110, 980, 380],
    ],
  },
  {
    name: "suppliers",
    width: 1280,
    height: 1290,
    boxes: [
      [1010, 540, 145, 285],
      [278, 970, 980, 270],
    ],
  },
  {
    name: "purchase-orders",
    width: 1280,
    height: 1206,
    boxes: [
      [1010, 465, 115, 205],
      [278, 815, 980, 335],
    ],
  },
  {
    name: "purchase-order-detail",
    width: 1280,
    height: 1539,
    boxes: [
      [278, 840, 980, 325],
      [278, 1238, 980, 250],
    ],
  },
  {
    name: "receiving",
    width: 1280,
    height: 1447,
    boxes: [
      [278, 745, 980, 245],
      [278, 1062, 980, 335],
    ],
  },
  {
    name: "receipt-detail",
    width: 1280,
    height: 2589,
    boxes: [
      [278, 610, 980, 710],
      [278, 1360, 980, 300],
      [278, 1710, 980, 555],
    ],
  },
  {
    name: "quality",
    width: 1280,
    height: 1285,
    boxes: [
      [278, 378, 980, 260],
      [278, 775, 980, 455],
    ],
  },
  {
    name: "putaway",
    width: 1280,
    height: 1197,
    boxes: [
      [278, 378, 980, 395],
      [278, 905, 980, 115],
    ],
  },
  {
    name: "inventory-balances",
    width: 1280,
    height: 1197,
    boxes: [[278, 367, 980, 570]],
  },
  {
    name: "inventory-history",
    width: 1280,
    height: 1197,
    boxes: [[278, 335, 980, 335]],
  },
  {
    name: "reports",
    width: 1280,
    height: 1197,
    boxes: [
      [278, 262, 980, 240],
      [278, 525, 980, 345],
    ],
  },
  {
    name: "handheld-home",
    width: 1280,
    height: 900,
    boxes: [
      [430, 96, 420, 178],
      [430, 380, 420, 330],
    ],
  },
];

const annotation = ([x, y, width, height], index) => {
  const circleX = x + 8;
  const circleY = y + 8;
  return `
  <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="12"
    fill="none" stroke="#ff3b30" stroke-width="7"/>
  <circle cx="${circleX}" cy="${circleY}" r="22" fill="#ff3b30"
    stroke="#ffffff" stroke-width="3"/>
  <text x="${circleX}" y="${circleY + 8}" text-anchor="middle"
    font-family="Arial, sans-serif" font-size="24" font-weight="700"
    fill="#ffffff">${index + 1}</text>`;
};

mkdirSync(outputRoot, { recursive: true });

for (const screen of screens) {
  const sourceName = `${screen.name}--th--desktop-1280.png`;
  const pngName = `${screen.name}.png`;
  const svgName = `${screen.name}-annotated.svg`;
  copyFileSync(join(sourceRoot, sourceName), join(outputRoot, pngName));

  const svg = `<svg xmlns="http://www.w3.org/2000/svg"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  width="${screen.width}" height="${screen.height}"
  viewBox="0 0 ${screen.width} ${screen.height}" role="img"
  aria-label="ภาพหน้าจอ ${screen.name} พร้อมกรอบคำแนะนำสีแดง">
  <image href="${pngName}" xlink:href="${pngName}" x="0" y="0"
    width="${screen.width}" height="${screen.height}"/>
  ${screen.boxes.map(annotation).join("\n").trim()}
</svg>\n`;
  writeFileSync(join(outputRoot, svgName), svg, "utf8");
}

console.log(`Generated ${screens.length} annotated manual screenshots.`);
