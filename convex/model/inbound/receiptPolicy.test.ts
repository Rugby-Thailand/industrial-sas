import { describe, expect, it } from "vitest";

import {
  MAX_RECEIPT_MINOR_UNITS,
  NO_TOLERANCE,
  acceptsReceipt,
  additionalPermissionFor,
  assessReceipt,
  classifyLineKind,
  isPlausibleDuplicate,
  makeTolerance,
  planUnderClose,
  statusAfterReceipt,
  toleranceAllowance,
  type ReceiptTolerance,
} from "./receiptPolicy";

const fivePercent = (): ReceiptTolerance => {
  const tolerance = makeTolerance(5, 100);
  if (!tolerance.ok) throw new Error("fixture tolerance is invalid");
  return tolerance.value;
};

describe("makeTolerance", () => {
  it("reduces, so two spellings of one percentage agree", () => {
    const five = makeTolerance(5, 100);
    const twentieth = makeTolerance(1, 20);

    expect(five.ok && five.value.kind).toBe("FRACTION");
    expect(five).toEqual(twentieth);
  });

  it("treats a zero numerator as no tolerance at all", () => {
    expect(makeTolerance(0, 100)).toEqual({ ok: true, value: NO_TOLERANCE });
  });

  it("refuses a tolerance of one hundred percent or more", () => {
    /*
     * "Accept at least twice what was ordered without approval" should not be
     * expressible by a typo in a denominator.
     */
    expect(makeTolerance(100, 100).ok).toBe(false);
    expect(makeTolerance(3, 2).ok).toBe(false);
  });

  it("refuses a negative or non-integer tolerance", () => {
    expect(makeTolerance(-5, 100).ok).toBe(false);
    expect(makeTolerance(5, 0).ok).toBe(false);
    expect(makeTolerance(2.5, 100).ok).toBe(false);
  });
});

describe("toleranceAllowance", () => {
  it("is the ordered quantity when nothing is configured", () => {
    expect(toleranceAllowance(100_000, NO_TOLERANCE)).toEqual({
      ok: true,
      value: 100_000,
    });
  });

  it("rounds the allowance down, never up", () => {
    /*
     * The header's rule, in numbers. 2.5% of 41 units is 1.025; rounding up
     * would admit two, making the tenant's tolerance larger than the one they
     * configured — and larger by a different amount at every order quantity.
     */
    const twoAndAHalf = makeTolerance(25, 1000);
    expect(twoAndAHalf.ok).toBe(true);
    if (!twoAndAHalf.ok) return;

    expect(toleranceAllowance(41, twoAndAHalf.value)).toEqual({
      ok: true,
      value: 42,
    });
  });

  it("computes a percentage no float represents exactly", () => {
    // 5% of 1,000,003 is 50,000.15. The allowance is the floor, exactly.
    expect(toleranceAllowance(1_000_003, fivePercent())).toEqual({
      ok: true,
      value: 1_050_003,
    });
  });

  it("refuses an ordered quantity that is not a positive integer", () => {
    expect(toleranceAllowance(0, NO_TOLERANCE).ok).toBe(false);
    expect(toleranceAllowance(-1, NO_TOLERANCE).ok).toBe(false);
    expect(toleranceAllowance(1.5, NO_TOLERANCE).ok).toBe(false);
  });

  it("refuses an ordered quantity past the module's bound", () => {
    expect(
      toleranceAllowance(MAX_RECEIPT_MINOR_UNITS + 1, NO_TOLERANCE).ok,
    ).toBe(false);
  });
});

describe("assessReceipt", () => {
  const base = {
    orderedMinorUnits: 100_000,
    alreadyReceivedMinorUnits: 0,
    tolerance: NO_TOLERANCE,
  };

  it("calls a short delivery partial and says what is outstanding", () => {
    const assessment = assessReceipt({ ...base, incomingMinorUnits: 60_000 });

    expect(assessment.ok).toBe(true);
    if (!assessment.ok) return;
    expect(assessment.value.classification).toBe("PARTIAL");
    expect(assessment.value.remainingMinorUnits).toBe(40_000);
    expect(assessment.value.requiresApproval).toBe(false);
  });

  it("classifies against the line total, not against one posting", () => {
    /*
     * The load-bearing case. Two postings of 60 against an order of 100 is an
     * over-receipt; a rule that asked "is *this* posting over?" answers no twice
     * and lets 120 units in without an approval.
     */
    const assessment = assessReceipt({
      ...base,
      alreadyReceivedMinorUnits: 60_000,
      incomingMinorUnits: 60_000,
    });

    expect(assessment.ok && assessment.value.classification).toBe(
      "OVER_BEYOND_TOLERANCE",
    );
    expect(assessment.ok && assessment.value.overByMinorUnits).toBe(20_000);
    expect(assessment.ok && assessment.value.requiresApproval).toBe(true);
  });

  it("calls an exact delivery complete with nothing outstanding", () => {
    const assessment = assessReceipt({ ...base, incomingMinorUnits: 100_000 });

    expect(assessment.ok && assessment.value.classification).toBe("COMPLETE");
    expect(assessment.ok && assessment.value.remainingMinorUnits).toBe(0);
    expect(assessment.ok && assessment.value.overByMinorUnits).toBe(0);
  });

  it("admits an over-shipment inside the configured tolerance without approval", () => {
    const assessment = assessReceipt({
      ...base,
      tolerance: fivePercent(),
      incomingMinorUnits: 105_000,
    });

    expect(assessment.ok && assessment.value.classification).toBe(
      "OVER_WITHIN_TOLERANCE",
    );
    expect(assessment.ok && assessment.value.requiresApproval).toBe(false);
    expect(assessment.ok && assessment.value.overByMinorUnits).toBe(5_000);
  });

  it("requires approval one unit past the allowance", () => {
    // The boundary is the whole point of `INV-0007-02`, so it is asserted at the
    // unit either side rather than somewhere comfortably beyond it.
    const inside = assessReceipt({
      ...base,
      tolerance: fivePercent(),
      incomingMinorUnits: 105_000,
    });
    const outside = assessReceipt({
      ...base,
      tolerance: fivePercent(),
      incomingMinorUnits: 105_001,
    });

    expect(inside.ok && inside.value.requiresApproval).toBe(false);
    expect(outside.ok && outside.value.requiresApproval).toBe(true);
  });

  it("distinguishes an unconfigured tolerance from a configured zero", () => {
    /*
     * Arithmetically identical, factually different: `OPS-0007-02` requires the
     * pilot tenant to confirm a tolerance, and "never configured" must not read
     * as "deliberately set to zero".
     */
    const none = assessReceipt({ ...base, incomingMinorUnits: 100_001 });
    const zero = assessReceipt({
      ...base,
      tolerance: (() => {
        const made = makeTolerance(0, 100);
        return made.ok ? made.value : NO_TOLERANCE;
      })(),
      incomingMinorUnits: 100_001,
    });

    expect(none.ok && none.value.toleranceConfigured).toBe(false);
    expect(zero.ok && zero.value.toleranceConfigured).toBe(false);
    expect(none.ok && none.value.classification).toBe("OVER_BEYOND_TOLERANCE");
  });

  it("refuses a zero or negative posting", () => {
    // A correction is a reversal, with its own permission and its own maker.
    expect(assessReceipt({ ...base, incomingMinorUnits: 0 }).ok).toBe(false);
    expect(assessReceipt({ ...base, incomingMinorUnits: -1 }).ok).toBe(false);
  });

  it("refuses a fractional posting", () => {
    expect(assessReceipt({ ...base, incomingMinorUnits: 1.5 }).ok).toBe(false);
  });

  it("refuses a negative already-received figure", () => {
    const assessment = assessReceipt({
      ...base,
      alreadyReceivedMinorUnits: -1,
      incomingMinorUnits: 10,
    });
    expect(!assessment.ok && assessment.error.code).toBe("QUANTITY_NEGATIVE");
  });

  it("never echoes a quantity back in a refusal", () => {
    const assessment = assessReceipt({ ...base, incomingMinorUnits: -987_654 });
    expect(JSON.stringify(assessment)).not.toContain("987654");
  });
});

describe("statusAfterReceipt", () => {
  it("leaves a partially received line open", () => {
    const assessment = assessReceipt({
      orderedMinorUnits: 100,
      alreadyReceivedMinorUnits: 0,
      incomingMinorUnits: 40,
      tolerance: NO_TOLERANCE,
    });
    expect(assessment.ok && statusAfterReceipt(assessment.value)).toBe("OPEN");
  });

  it("completes an over-received line rather than leaving it open", () => {
    // An open over-received line would accumulate forever without crossing any
    // threshold a human reviews.
    const assessment = assessReceipt({
      orderedMinorUnits: 100,
      alreadyReceivedMinorUnits: 0,
      incomingMinorUnits: 140,
      tolerance: NO_TOLERANCE,
    });
    expect(assessment.ok && statusAfterReceipt(assessment.value)).toBe(
      "COMPLETE",
    );
  });

  it("accepts stock only on an open line", () => {
    expect(acceptsReceipt("OPEN")).toBe(true);
    for (const status of ["COMPLETE", "CLOSED_SHORT", "CANCELLED"] as const) {
      expect(acceptsReceipt(status), status).toBe(false);
    }
  });
});

describe("planUnderClose", () => {
  const open = {
    status: "OPEN" as const,
    orderedMinorUnits: 100_000,
    receivedMinorUnits: 60_000,
  };

  it("reports the shortfall it is closing", () => {
    const plan = planUnderClose({ ...open, reasonCodeId: "reason_1" });
    expect(plan.ok && plan.value.shortfallMinorUnits).toBe(40_000);
  });

  it("refuses to close short without a reason", () => {
    // `INV-0007-03`. The reason is the row a buyer later reads to ask why the
    // supplier under-delivered; a close without one discards its own evidence.
    const plan = planUnderClose(open);
    expect(!plan.ok && plan.error.code).toBe("REASON_REQUIRED");
  });

  it("treats a blank reason as no reason", () => {
    const plan = planUnderClose({ ...open, reasonCodeId: "   " });
    expect(!plan.ok && plan.error.code).toBe("REASON_REQUIRED");
  });

  it("refuses to close a line that received everything", () => {
    // Recording a shortfall of zero would put a fictional supplier failure into
    // the tenant's own reporting.
    const plan = planUnderClose({
      ...open,
      receivedMinorUnits: 100_000,
      reasonCodeId: "reason_1",
    });
    expect(plan.ok).toBe(false);
  });

  it("refuses to close a line that is not open", () => {
    const plan = planUnderClose({
      ...open,
      status: "CANCELLED",
      reasonCodeId: "reason_1",
    });
    expect(!plan.ok && plan.error.code).toBe("LINE_NOT_OPEN");
  });
});

describe("classifyLineKind", () => {
  it("is blind when no order line is named", () => {
    expect(classifyLineKind({ hasOrderLine: false })).toBe("BLIND");
  });

  it("separates a cancelled line from an unexpected item", () => {
    /*
     * Both are exceptions and the follow-up differs: a cancelled line means
     * somebody on this side cancelled it, an unexpected item means the supplier
     * shipped something else.
     */
    expect(
      classifyLineKind({
        hasOrderLine: true,
        lineStatus: "CANCELLED",
        itemMatchesLine: true,
      }),
    ).toBe("CANCELLED_LINE");

    expect(
      classifyLineKind({
        hasOrderLine: true,
        lineStatus: "OPEN",
        itemMatchesLine: false,
      }),
    ).toBe("UNEXPECTED");
  });

  it("is ordered only when the line is named and the item matches", () => {
    expect(
      classifyLineKind({
        hasOrderLine: true,
        lineStatus: "OPEN",
        itemMatchesLine: true,
      }),
    ).toBe("ORDERED");
  });

  it("demands an extra permission for every exception kind", () => {
    expect(additionalPermissionFor("ORDERED")).toBeUndefined();
    expect(additionalPermissionFor("UNEXPECTED")).toBe(
      "receiving.receipt.unexpected",
    );
    expect(additionalPermissionFor("CANCELLED_LINE")).toBe(
      "receiving.receipt.unexpected",
    );
    expect(additionalPermissionFor("BLIND")).toBe("receiving.receipt.blind");
  });
});

describe("isPlausibleDuplicate", () => {
  const probe = {
    itemId: "item_1",
    lotCode: "L1",
    minorUnits: 12_000,
    occurredAt: 1_000_000,
  };

  it("warns about an identical posting seconds later", () => {
    expect(
      isPlausibleDuplicate({ ...probe, occurredAt: 1_030_000 }, [probe]),
    ).toBe(true);
  });

  it("says nothing about the same pallet an hour later", () => {
    expect(
      isPlausibleDuplicate({ ...probe, occurredAt: 4_600_000 }, [probe]),
    ).toBe(false);
  });

  it("distinguishes a different lot, item, or quantity", () => {
    expect(
      isPlausibleDuplicate({ ...probe, occurredAt: 1_010_000, lotCode: "L2" }, [
        probe,
      ]),
    ).toBe(false);
    expect(
      isPlausibleDuplicate(
        { ...probe, occurredAt: 1_010_000, itemId: "item_2" },
        [probe],
      ),
    ).toBe(false);
    expect(
      isPlausibleDuplicate(
        { ...probe, occurredAt: 1_010_000, minorUnits: 12_001 },
        [probe],
      ),
    ).toBe(false);
  });

  it("treats a missing lot code on both sides as a match", () => {
    const noLot = { itemId: "item_1", minorUnits: 5, occurredAt: 10 };
    expect(isPlausibleDuplicate({ ...noLot, occurredAt: 20 }, [noLot])).toBe(
      true,
    );
  });

  it("says nothing when there is nothing recent to compare against", () => {
    expect(isPlausibleDuplicate(probe, [])).toBe(false);
  });
});
