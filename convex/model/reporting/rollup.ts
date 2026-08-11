/**
 * Maintained counters, and the honesty rules that keep them worth reading
 * (`ADR-0011` §6, `INV-0011-07`, `INV-0011-09`).
 *
 * A dashboard tile is a number somebody makes a decision from. "Fourteen
 * receipts open" sends a supervisor to the dock; "0" sends them home. So the two
 * failure modes that matter are not performance ones:
 *
 * 1. **A number nobody can check.** A counter maintained by hand drifts the
 *    first time a transition is missed, and a drifted counter is
 *    indistinguishable from a correct one by looking at it. Every metric here is
 *    therefore paired with a *derivation* — the table and the state that define
 *    it — so a verifier can recompute the number and say which is wrong.
 * 2. **A number that hides its own bug.** A decrement that would go below zero
 *    means a transition was counted twice or an increment was lost. Throwing
 *    would stop a receipt being posted because a *display* counter is wrong,
 *    which is the wrong trade at a dock. Clamping silently would erase the
 *    evidence. So the clamp is recorded: `underflow` travels with the result and
 *    the caller marks the row.
 *
 * Pure module (plan §6.2): no Convex imports, no clock, no I/O.
 */

/** Every maintained metric. Mirrors `rollupMetric` in the validators. */
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

/**
 * The subject key of a site-wide metric.
 *
 * A sentinel rather than an empty string, because an empty string is what an
 * absent value degrades into and the two must not collide in an index prefix.
 * `-` is not a Convex ID, so it cannot be one by accident either.
 */
export const SITE_SUBJECT = "-";

/** Metrics that count per subject rather than per site. */
const PER_SUBJECT: ReadonlySet<RollupMetric> = new Set<RollupMetric>([
  "LOCATION_OCCUPANCY",
]);

export const isPerSubjectMetric = (metric: RollupMetric): boolean =>
  PER_SUBJECT.has(metric);

/**
 * The subject key a metric must be stored under.
 *
 * Refuses the two mismatches rather than coercing either: a site metric handed a
 * subject would silently create a second row nothing reads, and a per-subject
 * metric without one would collapse every location into a single counter that
 * looks plausible and means nothing.
 */
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

/** The result of moving a counter, with the clamp made visible. */
export interface RollupDelta {
  readonly next: number;
  /** True when the requested move would have gone below zero. */
  readonly underflow: boolean;
}

/**
 * Apply a delta to a counter, never going below zero.
 *
 * Total by construction: there is no input for which this fails, because the
 * caller is a domain mutation that must not be stopped by a display counter. A
 * non-integer or non-finite delta is treated as the bug it is and produces an
 * underflow-marked no-op rather than `NaN` on a dashboard — `NaN` renders as a
 * blank tile, which reads as "nothing here" rather than "this is broken".
 */
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

/**
 * What a verification pass found for one counter.
 *
 * `stored` and `derived` are both reported even when they agree, because a
 * reconciliation that only spoke up on failure gives an operator no way to tell
 * "checked and fine" from "not checked".
 */
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

/**
 * Fold a set of comparisons into the summary a runbook acts on.
 *
 * The drifted ones are listed rather than counted: "three counters drifted" is
 * not something anybody can fix, and the fix — rebuild these three — needs their
 * names.
 */
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
