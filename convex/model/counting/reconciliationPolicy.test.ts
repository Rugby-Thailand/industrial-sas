import { describe, expect, it } from "vitest";

import {
  assessCountVariance,
  buildCountAdjustmentTransaction,
  decideReconciliation,
  verifyPaperCountReentry,
} from "./reconciliationPolicy";

const NOW = 1_700_000_000_000;
const REQUEST_ID = "0192f0a0-1111-7abc-8def-0123456789ab";

function expectOk<T>(result: { ok: true; value: T } | { ok: false }): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("expected success");
  return result.value;
}

const policy = {
  quantityThresholdBaseMinorUnits: 10_000,
  valueThresholdMinorUnits: 50_000,
  highRiskItemClasses: ["A", "CONTROLLED"],
};

describe("variance assessment and approval", () => {
  it("accounts for in-count movements before calculating variance", () => {
    const assessment = expectOk(
      assessCountVariance({
        systemSnapshotBaseMinorUnits: 100_000,
        inCountMovementBaseMinorUnits: 20_000,
        physicalBaseMinorUnits: 119_000,
        unitValueMinorUnits: 2,
        itemClass: "C",
        policy,
      }),
    );
    expect(assessment).toMatchObject({
      expectedBaseMinorUnits: 120_000,
      varianceBaseMinorUnits: -1_000,
      absoluteVarianceValueMinorUnits: 2_000,
      risk: "STANDARD",
      rootCauseRequired: true,
    });
  });

  it("requires maker-checker and step-up for high-risk adjustments", () => {
    const assessment = expectOk(
      assessCountVariance({
        systemSnapshotBaseMinorUnits: 100_000,
        inCountMovementBaseMinorUnits: 0,
        physicalBaseMinorUnits: 80_000,
        unitValueMinorUnits: 10,
        itemClass: "A",
        policy,
      }),
    );
    expect(assessment.risk).toBe("HIGH");
    const self = decideReconciliation({
      assessment,
      counterUserId: "counter_1",
      approverUserId: "counter_1",
      rootCauseCode: "COUNT_SHORT",
      stepUpVerified: true,
      now: NOW,
    });
    expect(!self.ok && self.error.code).toBe("MAKER_CHECKER_REQUIRED");

    const noStepUp = decideReconciliation({
      assessment,
      counterUserId: "counter_1",
      approverUserId: "supervisor_1",
      rootCauseCode: "COUNT_SHORT",
      now: NOW,
    });
    expect(!noStepUp.ok && noStepUp.error.code).toBe("STEP_UP_REQUIRED");

    expect(
      expectOk(
        decideReconciliation({
          assessment,
          counterUserId: "counter_1",
          approverUserId: "supervisor_1",
          rootCauseCode: "COUNT_SHORT",
          stepUpVerified: true,
          now: NOW,
        }),
      ).kind,
    ).toBe("ADJUSTMENT_APPROVED");
  });

  it("closes an exact match without manufacturing an adjustment", () => {
    const assessment = expectOk(
      assessCountVariance({
        systemSnapshotBaseMinorUnits: 100_000,
        inCountMovementBaseMinorUnits: -5_000,
        physicalBaseMinorUnits: 95_000,
        unitValueMinorUnits: 10,
        itemClass: "C",
        policy,
      }),
    );
    expect(
      expectOk(
        decideReconciliation({
          assessment,
          counterUserId: "counter_1",
          now: NOW,
        }),
      ).kind,
    ).toBe("NO_ADJUSTMENT");
  });
});

describe("adjustment and paper fallback", () => {
  it("builds a balanced reconciliation transaction", () => {
    const assessment = expectOk(
      assessCountVariance({
        systemSnapshotBaseMinorUnits: 100_000,
        inCountMovementBaseMinorUnits: 0,
        physicalBaseMinorUnits: 98_000,
        unitValueMinorUnits: 1,
        itemClass: "C",
        policy,
      }),
    );
    const decision = expectOk(
      decideReconciliation({
        assessment,
        counterUserId: "counter_1",
        approverUserId: "supervisor_1",
        rootCauseCode: "COUNT_SHORT",
        now: NOW,
      }),
    );
    const draft = expectOk(
      buildCountAdjustmentTransaction({
        orgId: "org_1",
        warehouseId: "warehouse_1",
        reconciliationId: "reconcile_1",
        requestId: REQUEST_ID,
        actorUserId: "supervisor_1",
        occurredAt: NOW,
        baseUom: "PCS",
        reasonCodeId: "reason_count_variance",
        bucket: {
          orgId: "org_1",
          warehouseId: "warehouse_1",
          itemId: "item_1",
          location: { kind: "PHYSICAL", locationId: "location_1" },
          stockStatus: "AVAILABLE",
        },
        decision,
      }),
    );
    expect(
      draft.lines.map((line) => line.quantity.minorUnits).sort((a, b) => a - b),
    ).toEqual([-2_000, 2_000]);
    expect(
      draft.lines.find((line) => line.bucket.location.kind === "VIRTUAL")
        ?.quantity.minorUnits,
    ).toBe(2_000);
  });

  it("requires matching paper captures from two people", () => {
    const first = {
      sheetHash: "a".repeat(64),
      lineCount: 12,
      enteredByUserId: "counter_1",
      evidenceId: "evidence_1",
    };
    expect(
      verifyPaperCountReentry({
        first,
        second: { ...first, evidenceId: "evidence_2" },
        verifiedAt: NOW,
      }),
    ).toMatchObject({ ok: false, error: { code: "PAPER_DUAL_KEY_REQUIRED" } });

    const verified = expectOk(
      verifyPaperCountReentry({
        first,
        second: {
          ...first,
          enteredByUserId: "counter_2",
          evidenceId: "evidence_2",
        },
        verifiedAt: NOW,
      }),
    );
    expect(verified.enteredBy).toEqual(["counter_1", "counter_2"]);
  });
});
