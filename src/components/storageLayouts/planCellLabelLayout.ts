/** A single code in CSS pixels, converted back by screenUnit / zoom. */
export const PLAN_CELL_LABEL = {
  codeMax: 14,
  codeLine: 20 / 14,
  paddingX: 8,
  paddingY: 6,
} as const;

// Thai above/below vowels and tone marks occupy no advance width.
const THAI_COMBINING = /[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/u;

/**
 * Conservative advance-width estimate in ems for the plan's monospace label
 * face; no layout engine is available while rendering. Thai falls back to the
 * system Thai face, whose base glyphs are slightly wider than a mono cell.
 */
export function labelEm(text: string): number {
  let width = 0;
  for (const character of text) {
    if (THAI_COMBINING.test(character)) continue;
    const code = character.codePointAt(0)!;
    width += code >= 0x0e00 && code <= 0x0e7f ? 0.62 : code > 127 ? 1 : 0.6;
  }
  return width;
}

export function planCellLabelLayout({
  width,
  height,
  code,
}: {
  readonly width: number;
  readonly height: number;
  readonly code: string;
}): {
  readonly code?: { readonly fontSize: number; readonly offsetY: number };
} {
  const spec = PLAN_CELL_LABEL;
  if (
    !code.trim() ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < labelEm(code) * spec.codeMax + 2 * spec.paddingX ||
    height < spec.codeMax * spec.codeLine + 2 * spec.paddingY
  )
    return {};
  return { code: { fontSize: spec.codeMax, offsetY: 0 } };
}
