/**
 * Screen-pixel layout for the code and status lines inside a simple plan cell.
 *
 * The plan is drawn in frame units and then zoomed by its parent group, so a
 * label sized in frame units grows with every zoom step. Callers measure the
 * cell's projected size in CSS pixels, lay the label out here, and convert the
 * result back with `pixelsToFrame = screenUnit / zoom`.
 */
export interface PlanCellLabelLine {
  /** Font size in CSS pixels. */
  readonly fontSize: number;
  /** Line centre relative to the cell centre, in CSS pixels. */
  readonly offsetY: number;
}

export interface PlanCellLabelLayout {
  readonly code?: PlanCellLabelLine;
  readonly status?: PlanCellLabelLine;
}

export const PLAN_CELL_LABEL = {
  codeMax: 14,
  codeMin: 8,
  statusMax: 11,
  statusMin: 9,
  paddingX: 4,
  paddingY: 3,
  gap: 2,
  // Line boxes in ems. Thai status text carries marks above and below the
  // base line, so it needs a taller box than the Latin code.
  codeLine: 1.15,
  statusLine: 1.4,
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
  status,
}: {
  /** Projected cell width in CSS pixels. */
  readonly width: number;
  /** Projected cell height in CSS pixels. */
  readonly height: number;
  readonly code: string;
  readonly status?: string | undefined;
}): PlanCellLabelLayout {
  const spec = PLAN_CELL_LABEL;
  const innerWidth = width - 2 * spec.paddingX;
  const innerHeight = height - 2 * spec.paddingY;
  if (innerWidth <= 0 || innerHeight <= 0) return {};
  const codeSize = Math.min(
    spec.codeMax,
    innerWidth / Math.max(labelEm(code), 1),
    innerHeight / spec.codeLine,
  );
  if (codeSize < spec.codeMin) return {};
  const single = { code: { fontSize: codeSize, offsetY: 0 } };
  if (!status) return single;
  const statusSize = Math.min(
    spec.statusMax,
    innerWidth / Math.max(labelEm(status), 1),
  );
  const total =
    codeSize * spec.codeLine + spec.gap + statusSize * spec.statusLine;
  // Shrink both lines together when the cell is slightly short, but never
  // below their readable minimums; otherwise keep the code alone.
  const fit = Math.min(1, (innerHeight - spec.gap) / (total - spec.gap));
  const codeFont = codeSize * fit;
  const statusFont = statusSize * fit;
  if (codeFont < spec.codeMin || statusFont < spec.statusMin) return single;
  const codeBox = codeFont * spec.codeLine;
  const statusBox = statusFont * spec.statusLine;
  const top = -(codeBox + spec.gap + statusBox) / 2;
  return {
    code: { fontSize: codeFont, offsetY: top + codeBox / 2 },
    status: {
      fontSize: statusFont,
      offsetY: top + codeBox + spec.gap + statusBox / 2,
    },
  };
}
