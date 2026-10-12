/**
 * Reserved-area labels are free text, and some saved labels repeat the area's
 * size as a suffix (e.g. "Staging · 1 · 2.80 × 8.98 ม."). Where a view already
 * shows the dimensions in a dedicated row, this returns the label without that
 * suffix — but only when the suffix provably restates the area's own
 * width × depth in metres. Any other format returns the label unchanged, and
 * the saved label itself is never modified.
 */
const DIMENSIONS_SUFFIX =
  /^(.*?\S)(?:\s*·\s*|\s+)(\d+(?:\.\d+)?)\s*[×xX]\s*(\d+(?:\.\d+)?)\s*(?:ม\.?|เมตร|m|metres?|meters?)\s*$/iu;

/** Whether `text`, written to its own decimal precision, rounds from `mm`. */
function restatesMillimetres(text: string, mm: number) {
  const decimals = text.split(".")[1]?.length ?? 0;
  const written = Number(text.replace(".", ""));
  const scaled = mm * 10 ** decimals;
  // Integer arithmetic keeps metre conversion from shifting a rounding tie.
  // Unrepresentable precision is an unknown format, so preserve its label.
  return (
    Number.isSafeInteger(written) &&
    Number.isSafeInteger(scaled) &&
    Math.round(scaled / 1000) === written
  );
}

export function areaDisplayLabel(
  label: string,
  widthMm: number,
  depthMm: number,
): string {
  const match = DIMENSIONS_SUFFIX.exec(label);
  if (!match) return label;
  const [, prefix, width, depth] = match;
  if (!prefix || !width || !depth) return label;
  if (!restatesMillimetres(width, widthMm)) return label;
  if (!restatesMillimetres(depth, depthMm)) return label;
  return prefix;
}
