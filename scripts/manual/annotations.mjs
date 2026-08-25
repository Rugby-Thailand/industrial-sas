import {
  ANNOTATION_COLOR,
  BADGE_INSET,
  BADGE_RADIUS,
  RECT_STROKE_WIDTH,
  UNDERLINE_STROKE_WIDTH,
} from "./schema.mjs";

const RECT_CORNER_RADIUS = 12;

/**
 * @param {string} value
 * @returns {string}
 */
export const escapeXml = (value) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/**
 * @param {import("./schema.mjs").ManualAnnotation} annotation
 * @returns {string}
 */
const badge = (annotation) => {
  const cx = annotation.x + BADGE_INSET;
  const cy = annotation.y + BADGE_INSET;
  return `  <circle cx="${cx}" cy="${cy}" r="${BADGE_RADIUS}" fill="${ANNOTATION_COLOR}"
    stroke="#ffffff" stroke-width="3"/>
  <text x="${cx}" y="${cy + 8}" text-anchor="middle"
    font-family="Arial, sans-serif" font-size="24" font-weight="700"
    fill="#ffffff">${annotation.step}</text>`;
};

/**
 * @param {import("./schema.mjs").ManualAnnotation} annotation
 * @returns {string}
 */
export function renderAnnotation(annotation) {
  if (annotation.kind === "underline") {
    const x2 = annotation.x + annotation.width;
    return `  <line x1="${annotation.x}" y1="${annotation.y}" x2="${x2}" y2="${annotation.y}"
    stroke="${ANNOTATION_COLOR}" stroke-width="${UNDERLINE_STROKE_WIDTH}"
    stroke-linecap="round"/>
${badge(annotation)}`;
  }
  return `  <rect x="${annotation.x}" y="${annotation.y}" width="${annotation.width}" height="${annotation.height}" rx="${RECT_CORNER_RADIUS}"
    fill="none" stroke="${ANNOTATION_COLOR}" stroke-width="${RECT_STROKE_WIDTH}"/>
${badge(annotation)}`;
}

/**
 * @param {readonly import("./schema.mjs").ManualAnnotation[]} annotations
 * @returns {string}
 */
export function renderAnnotationLayer(annotations) {
  return annotations.map(renderAnnotation).join("\n\n");
}

/**
 * @param {{ title: import("./schema.mjs").LocalizedText }} task
 * @returns {string}
 */
export const overlayLabel = (task) =>
  `${task.title.th} — ภาพหน้าจอพร้อมกรอบคำแนะนำสีแดง`;

/**
 * @param {object} input
 * @param {string} input.image Basename of the PNG, in the same directory.
 * @param {number} input.width
 * @param {number} input.height
 * @param {readonly import("./schema.mjs").ManualAnnotation[]} input.annotations
 * @param {string} input.label Accessible name, in Thai.
 * @returns {string}
 */
export function renderAnnotatedSvg({
  image,
  width,
  height,
  annotations,
  label,
}) {
  const png = `${image}.png`;
  return `<svg xmlns="http://www.w3.org/2000/svg"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  width="${width}" height="${height}"
  viewBox="0 0 ${width} ${height}" role="img"
  aria-label="${escapeXml(label)}">
  <image href="${png}" xlink:href="${png}" x="0" y="0"
    width="${width}" height="${height}"/>
${renderAnnotationLayer(annotations)}
</svg>
`;
}

/**
 * @param {object} input
 * @param {number} input.width
 * @param {number} input.height
 * @param {readonly import("./schema.mjs").ManualAnnotation[]} input.annotations
 * @returns {string}
 */
export function renderInlineOverlay({ width, height, annotations }) {
  return `<svg class="overlay" viewBox="0 0 ${width} ${height}"
  xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
${renderAnnotationLayer(annotations)}
</svg>`;
}
