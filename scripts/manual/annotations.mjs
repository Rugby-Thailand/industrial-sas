/**
 * Red rectangles, red underlines, and the number beside each one.
 *
 * The same fragments serve two outputs, which is the point of the module: the
 * standalone `*-annotated.svg` beside each screenshot (what the Markdown guide
 * links to) and the inline overlay inside a generated HTML page. They must agree,
 * because a reviewer who moves a coordinate looks at one of them and trusts the
 * other.
 *
 * Two shapes exist, and the numbered badge is common to both. A rectangle frames
 * a control or a card; an underline marks a value inside a dense row, where a
 * rectangle would enclose four other things and point at none of them. Each is
 * tied to a step number rather than to its own position in the list, so the
 * number an operator reads in the picture is the number of the instruction that
 * mentions it — the previous generator numbered by position, and three steps in
 * the Thai guide had to say "box 2" while being step 3.
 */
import {
  ANNOTATION_COLOR,
  BADGE_INSET,
  BADGE_RADIUS,
  RECT_STROKE_WIDTH,
  UNDERLINE_STROKE_WIDTH,
} from "./schema.mjs";

/** Corner radius of an annotation rectangle. */
const RECT_CORNER_RADIUS = 12;

/**
 * XML text and attribute escaping.
 *
 * Thai prose needs none of this, but an author is free to write `&` or a quote in
 * an aria-label, and an SVG that silently stops parsing is worse than one that
 * looks wrong.
 *
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
 * The numbered badge drawn at an annotation's origin.
 *
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
 * One annotation as SVG markup, indented for a two-space document.
 *
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
 * Every annotation of one task, as the body of an SVG.
 *
 * @param {readonly import("./schema.mjs").ManualAnnotation[]} annotations
 * @returns {string}
 */
export function renderAnnotationLayer(annotations) {
  return annotations.map(renderAnnotation).join("\n\n");
}

/**
 * The accessible name of a task's standalone overlay.
 *
 * Exported because three callers need the *same* string — the asset generator
 * writes it, the guard re-renders it to detect staleness, and the test asserts
 * it. A second copy of this sentence would make every overlay permanently
 * "stale" the day one of them was edited.
 *
 * Thai only: it labels the Thai guide's illustration, and the HTML manual builds
 * its own bilingual caption.
 *
 * @param {{ title: import("./schema.mjs").LocalizedText }} task
 * @returns {string}
 */
export const overlayLabel = (task) =>
  `${task.title.th} — ภาพหน้าจอพร้อมกรอบคำแนะนำสีแดง`;

/**
 * A standalone SVG: the screenshot, and the overlay on top of it.
 *
 * Non-destructive by construction — the PNG is referenced, never rewritten — so
 * a coordinate change costs one regenerated text file and the captured pixels
 * stay pixel-exact.
 *
 * `width` and `height` are the *measured* size of the referenced PNG. Declaring
 * anything else makes `preserveAspectRatio` letterbox the screenshot and moves
 * every annotation off its target.
 *
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
 * The overlay alone, for inlining into an HTML page over an `<img>`.
 *
 * Inline rather than a linked `*-annotated.svg`: an SVG loaded through `<img>`
 * may not fetch the external PNG it references, so a linked overlay renders as
 * red boxes on nothing. The picture is therefore composed in the document — a
 * raster `<img>` with a vector layer above it — which also keeps the screenshot
 * responsive and the annotations crisp at any width.
 *
 * `aria-hidden`: the numbers repeat the step list beneath, and a screen-reader
 * user gets them there in words.
 *
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
