/**
 * Unit tier — the counter arithmetic behind every dashboard tile.
 *
 * The properties under test are the ones that decide whether a number on a
 * screen can be believed: a counter never reads negative, a clamp is never
 * silent, and a metric can only be stored under a subject key its own shape
 * allows.
 */
import { describe, expect, it } from "vitest";

import {
  applyRollupDelta,
  compareRollup,
  isPerSubjectMetric,
  ROLLUP_METRICS,
  SITE_SUBJECT,
  subjectKeyFor,
  summarizeRollups,
} from "./rollup";

describe("subjectKeyFor", () => {
  it("stores a site metric under the sentinel", () => {
    expect(subjectKeyFor("RECEIPTS_OPENED")).toEqual({
      ok: true,
      value: SITE_SUBJECT,
    });
  });

  it("refuses a subject on a site metric rather than creating a row nothing reads", () => {
    expect(subjectKeyFor("RECEIPTS_OPENED", "loc_1")).toEqual({
      ok: false,
      error: { code: "SUBJECT_NOT_ALLOWED", metric: "RECEIPTS_OPENED" },
    });
  });

  it("requires a subject for a per-subject metric", () => {
    /*
     * Without this, every location's occupancy would fold into one counter that
     * looks plausible and describes nothing.
     */
    expect(subjectKeyFor("LOCATION_OCCUPANCY")).toEqual({
      ok: false,
      error: { code: "SUBJECT_REQUIRED", metric: "LOCATION_OCCUPANCY" },
    });
  });

  it("keeps a per-subject metric under its own subject", () => {
    expect(subjectKeyFor("LOCATION_OCCUPANCY", "loc_1")).toEqual({
      ok: true,
      value: "loc_1",
    });
  });

  it("treats whitespace as absent, because a padded ID is not an ID", () => {
    expect(subjectKeyFor("LOCATION_OCCUPANCY", "   ")).toEqual({
      ok: false,
      error: { code: "SUBJECT_REQUIRED", metric: "LOCATION_OCCUPANCY" },
    });
    expect(subjectKeyFor("RECEIPTS_OPENED", "  ")).toEqual({
      ok: true,
      value: SITE_SUBJECT,
    });
  });

  it("classifies exactly one metric as per-subject", () => {
    const perSubject = ROLLUP_METRICS.filter(isPerSubjectMetric);
    expect(perSubject).toEqual(["LOCATION_OCCUPANCY"]);
  });

  it("never uses a sentinel a document ID could collide with", () => {
    // Convex IDs are alphanumeric; `-` cannot be one by accident.
    expect(SITE_SUBJECT).toBe("-");
    expect(/^[a-z0-9]+$/i.test(SITE_SUBJECT)).toBe(false);
  });
});

describe("applyRollupDelta", () => {
  it("adds and subtracts", () => {
    expect(applyRollupDelta(3, 1)).toEqual({ next: 4, underflow: false });
    expect(applyRollupDelta(3, -1)).toEqual({ next: 2, underflow: false });
  });

  it("clamps at zero and says that it did", () => {
    /*
     * The clamp keeps a dock working when a display counter is wrong; the flag
     * is what stops the clamp from erasing the evidence that it was.
     */
    expect(applyRollupDelta(0, -1)).toEqual({ next: 0, underflow: true });
  });

  it("never answers NaN, which renders as an empty tile", () => {
    expect(applyRollupDelta(5, Number.NaN)).toEqual({
      next: 5,
      underflow: true,
    });
    expect(applyRollupDelta(Number.NaN, 1)).toEqual({
      next: 0,
      underflow: true,
    });
  });

  it("treats a fractional delta as the bug it is", () => {
    expect(applyRollupDelta(5, 0.5)).toEqual({ next: 5, underflow: true });
  });
});

describe("verification", () => {
  it("reports agreement as well as drift", () => {
    // "Checked and fine" has to be distinguishable from "not checked".
    const summary = summarizeRollups([
      compareRollup("RECEIPTS_OPENED", "-", 4, 4),
      compareRollup("QC_PENDING", "-", 2, 2),
    ]);

    expect(summary).toEqual({ checked: 2, drifted: [], balanced: true });
  });

  it("names the counters that drifted, because a count is not actionable", () => {
    const summary = summarizeRollups([
      compareRollup("RECEIPTS_OPENED", "-", 4, 3),
      compareRollup("QC_PENDING", "-", 2, 2),
    ]);

    expect(summary.balanced).toBe(false);
    expect(summary.drifted).toEqual([
      {
        metric: "RECEIPTS_OPENED",
        subjectKey: "-",
        stored: 4,
        derived: 3,
        drifted: true,
      },
    ]);
  });
});
