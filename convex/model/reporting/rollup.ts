export const ROLLUP_METRICS = Object.freeze([
  "RECEIPTS_OPENED",
  "RECEIPT_LINES_POSTED",
  "QC_PENDING",
  "QC_PARKED",
  "PUTAWAY_READY",
  "PUTAWAY_CLAIMED",
  "LOCATION_OCCUPANCY",
] as const);

export type RollupMetric = (typeof ROLLUP_METRICS)[number];

export const SITE_SUBJECT = "-";

const PER_SUBJECT: ReadonlySet<RollupMetric> = new Set<RollupMetric>([
  "LOCATION_OCCUPANCY",
]);

export const isPerSubjectMetric = (metric: RollupMetric): boolean =>
  PER_SUBJECT.has(metric);

export type SubjectKeyError =
  | { readonly code: "SUBJECT_NOT_ALLOWED"; readonly metric: RollupMetric }
  | { readonly code: "SUBJECT_REQUIRED"; readonly metric: RollupMetric };

export function subjectKeyFor(
  metric: RollupMetric,
  subjectId?: string | undefined,
):
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: SubjectKeyError } {
  const given = subjectId === undefined ? "" : subjectId.trim();

  if (isPerSubjectMetric(metric)) {
    return given === ""
      ? { ok: false, error: { code: "SUBJECT_REQUIRED", metric } }
      : { ok: true, value: given };
  }
  return given === ""
    ? { ok: true, value: SITE_SUBJECT }
    : { ok: false, error: { code: "SUBJECT_NOT_ALLOWED", metric } };
}

export interface RollupDelta {
  readonly next: number;

  readonly underflow: boolean;
}

export function applyRollupDelta(current: number, delta: number): RollupDelta {
  if (!Number.isSafeInteger(current) || !Number.isSafeInteger(delta)) {
    return {
      next: Number.isSafeInteger(current) ? current : 0,
      underflow: true,
    };
  }

  const next = current + delta;
  return next < 0 ? { next: 0, underflow: true } : { next, underflow: false };
}

export interface RollupComparison {
  readonly metric: RollupMetric;
  readonly subjectKey: string;
  readonly stored: number;
  readonly derived: number;
  readonly drifted: boolean;
}

export function compareRollup(
  metric: RollupMetric,
  subjectKey: string,
  stored: number,
  derived: number,
): RollupComparison {
  return {
    metric,
    subjectKey,
    stored,
    derived,
    drifted: stored !== derived,
  };
}

export interface RollupVerification {
  readonly checked: number;
  readonly drifted: readonly RollupComparison[];
  readonly balanced: boolean;
}

export function summarizeRollups(
  comparisons: readonly RollupComparison[],
): RollupVerification {
  const drifted = comparisons.filter((comparison) => comparison.drifted);
  return {
    checked: comparisons.length,
    drifted: Object.freeze([...drifted]),
    balanced: drifted.length === 0,
  };
}
