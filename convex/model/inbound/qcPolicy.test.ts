import { describe, expect, it } from "vitest";

import {
  UNSUPPORTED_SAMPLING_STRATEGIES,
  acceptsDisposition,
  assertSubmittable,
  planDisposition,
  planSample,
  receiptStockStatus,
  resolveQcApplicability,
  statusAfterSubmission,
} from "./qcPolicy";

describe("planSample", () => {
  it("inspects the whole delivery under ALL", () => {
    const plan = planSample({ strategy: "ALL", lotSize: 240 });

    expect(plan.ok && plan.value.sampleSize).toBe(240);
    expect(plan.ok && plan.value.inspectsEverything).toBe(true);
  });

  it("rounds a percentage sample up", () => {
    // 10% of 15 is 1.5. Inspecting one would be less than the tenant configured,
    // and would weaken every plan on an odd lot size.
    const plan = planSample({
      strategy: "PERCENT",
      parameter: 10,
      lotSize: 15,
    });
    expect(plan.ok && plan.value.sampleSize).toBe(2);
  });

  it("never plans a sample of zero for a delivery that exists", () => {
    /*
     * A configured plan that inspects nothing reads as a *passed* inspection in
     * every report that counts them.
     */
    const percent = planSample({
      strategy: "PERCENT",
      parameter: 1,
      lotSize: 10,
    });
    expect(percent.ok && percent.value.sampleSize).toBe(1);
  });

  it("never plans a sample larger than the delivery", () => {
    // `FIXED 100` against 30 units inspects 30: the other 70 do not exist.
    const plan = planSample({ strategy: "FIXED", parameter: 100, lotSize: 30 });

    expect(plan.ok && plan.value.sampleSize).toBe(30);
    expect(plan.ok && plan.value.inspectsEverything).toBe(true);
  });

  it("takes a fixed count when the lot is larger", () => {
    const plan = planSample({ strategy: "FIXED", parameter: 8, lotSize: 500 });

    expect(plan.ok && plan.value.sampleSize).toBe(8);
    expect(plan.ok && plan.value.inspectsEverything).toBe(false);
  });

  it.each(UNSUPPORTED_SAMPLING_STRATEGIES)(
    "refuses %s by name rather than falling back",
    (strategy) => {
      /*
       * Falling back to `ALL` would be the most expensive wrong answer; falling
       * back to `FIXED` would let a regulated customer believe a sampling plan
       * had been applied that never was (plan §2.3, B-01).
       */
      const plan = planSample({ strategy, parameter: 4, lotSize: 100 });

      expect(plan.ok).toBe(false);
      expect(!plan.ok && plan.error.code).toBe("SAMPLING_STRATEGY_UNSUPPORTED");
    },
  );

  it("refuses an unknown strategy", () => {
    expect(planSample({ strategy: "VIBES", lotSize: 10 }).ok).toBe(false);
  });

  it("refuses a missing or nonsensical parameter", () => {
    expect(planSample({ strategy: "FIXED", lotSize: 10 }).ok).toBe(false);
    expect(
      planSample({ strategy: "FIXED", parameter: 0, lotSize: 10 }).ok,
    ).toBe(false);
    expect(
      planSample({ strategy: "PERCENT", parameter: 101, lotSize: 10 }).ok,
    ).toBe(false);
    expect(
      planSample({ strategy: "PERCENT", parameter: 2.5, lotSize: 10 }).ok,
    ).toBe(false);
  });

  it("refuses an empty or fractional lot", () => {
    expect(planSample({ strategy: "ALL", lotSize: 0 }).ok).toBe(false);
    expect(planSample({ strategy: "ALL", lotSize: 1.5 }).ok).toBe(false);
  });
});

describe("resolveQcApplicability", () => {
  const itemProfile = {
    scope: "ITEM" as const,
    enabled: true,
    strategy: "ALL",
  };
  const supplierProfile = {
    scope: "SUPPLIER" as const,
    enabled: false,
    strategy: "FIXED",
    parameter: 5,
  };

  it("is not controlled when no profile matches", () => {
    /*
     * The honest default for an unconfigured tenant. Inventing a hold nobody
     * configured would strand stock at the dock on day one, and `OPS-0007-03` is
     * the open gate that says which items and suppliers are gated.
     */
    const applicability = resolveQcApplicability([]);

    expect(applicability.controlled).toBe(false);
    expect(receiptStockStatus(applicability)).toBe("AVAILABLE");
  });

  it("lets the item profile beat the supplier profile", () => {
    // "This component is critical" is a stronger statement than "this vendor is
    // generally reliable".
    const applicability = resolveQcApplicability([
      supplierProfile,
      itemProfile,
    ]);

    expect(applicability.controlled).toBe(true);
    expect(applicability.matched?.scope).toBe("ITEM");
    expect(receiptStockStatus(applicability)).toBe("QC_HOLD");
  });

  it("honours a supplier profile when no item profile exists", () => {
    const applicability = resolveQcApplicability([
      { ...supplierProfile, enabled: true },
    ]);

    expect(applicability.controlled).toBe(true);
    expect(applicability.matched?.scope).toBe("SUPPLIER");
  });

  it("honours a matched profile that is switched off", () => {
    // A disabled item profile is a decision, and it beats an enabled supplier
    // profile for the same reason an enabled one would.
    const applicability = resolveQcApplicability([
      { ...supplierProfile, enabled: true },
      { ...itemProfile, enabled: false },
    ]);

    expect(applicability.controlled).toBe(false);
    expect(applicability.matched?.scope).toBe("ITEM");
  });
});

describe("planDisposition", () => {
  const held = { sourceStatus: "QC_HOLD", reasonCodeId: "reason_1" };

  it.each([
    ["RELEASE", "AVAILABLE", true],
    ["QUARANTINE", "QUARANTINE", false],
    ["REJECT", "REJECTED", false],
    ["SCRAP", "SCRAP", true],
    ["REWORK", "QC_HOLD", false],
  ])("sends %s to %s", (disposition, target, needsApproval) => {
    const plan = planDisposition({ ...held, disposition });

    expect(plan.ok && plan.value.toStatus).toBe(target);
    expect(plan.ok && plan.value.requiresApproval).toBe(needsApproval);
  });

  it("marks rework as a re-inspection rather than a movement", () => {
    // Not a no-op: the ledger records that a decision was taken, and losing that
    // would lose the only evidence anybody looked.
    const plan = planDisposition({ ...held, disposition: "REWORK" });
    expect(plan.ok && plan.value.isReinspection).toBe(true);
  });

  it("refuses to release stock that is not held", () => {
    /*
     * There is no hold to lift. Posting the transition anyway would move
     * quantity out of a bucket that does not hold it, and the ledger would
     * refuse it later with a message about balances rather than about quality.
     */
    const plan = planDisposition({
      disposition: "RELEASE",
      sourceStatus: "AVAILABLE",
      reasonCodeId: "reason_1",
    });

    expect(!plan.ok && plan.error.code).toBe("SOURCE_STATUS_NOT_HELD");
  });

  it("requires a reason for every disposition", () => {
    // The reason is the only durable record of *why* a batch was rejected once
    // the inspector has gone home (`ADR-0003` §5).
    for (const disposition of [
      "RELEASE",
      "QUARANTINE",
      "REJECT",
      "SCRAP",
      "REWORK",
    ]) {
      const plan = planDisposition({
        disposition,
        sourceStatus: "QC_HOLD",
      });
      expect(!plan.ok && plan.error.code, disposition).toBe("REASON_REQUIRED");
    }
  });

  it("treats a blank reason as no reason", () => {
    const plan = planDisposition({
      ...held,
      disposition: "REJECT",
      reasonCodeId: "  ",
    });
    expect(!plan.ok && plan.error.code).toBe("REASON_REQUIRED");
  });

  it("refuses a disposition it does not know", () => {
    const plan = planDisposition({ ...held, disposition: "MAYBE" });
    expect(!plan.ok && plan.error.code).toBe("DISPOSITION_UNKNOWN");
  });
});

describe("inspection lifecycle", () => {
  it("accepts a disposition only while open", () => {
    expect(acceptsDisposition("OPEN")).toBe(true);
    for (const status of [
      "PENDING_APPROVAL",
      "DISPOSED",
      "CANCELLED",
    ] as const) {
      expect(acceptsDisposition(status), status).toBe(false);
    }
  });

  it("names the state rather than a generic refusal", () => {
    const guard = assertSubmittable("DISPOSED");
    expect(!guard.ok && guard.error.code).toBe("INSPECTION_NOT_OPEN");
    expect(!guard.ok && "status" in guard.error && guard.error.status).toBe(
      "DISPOSED",
    );
  });

  it("parks a disposition that needs a second person", () => {
    const release = planDisposition({
      disposition: "RELEASE",
      sourceStatus: "QC_HOLD",
      reasonCodeId: "reason_1",
    });
    const reject = planDisposition({
      disposition: "REJECT",
      sourceStatus: "QC_HOLD",
      reasonCodeId: "reason_1",
    });

    expect(release.ok && statusAfterSubmission(release.value)).toBe(
      "PENDING_APPROVAL",
    );
    expect(reject.ok && statusAfterSubmission(reject.value)).toBe("DISPOSED");
  });
});
