import { describe, expect, it } from "vitest";

import { planMasterCardDecision } from "./masterCardRelease";

const revision = {
  revisionId: "rev_2",
  revisionNumber: 2,
  status: "IN_REVIEW" as const,
  designKey: "similarity-key",
  authoredByUserId: "maker",
  submittedByUserId: "maker",
};
const card = {
  customerId: "customer_1",
  customerProductCode: "FG-001",
  releasedRevisionId: "rev_1",
};

describe("master-card release plan", () => {
  it("keeps the prior revision RELEASED and changes only its supersession pointer", () => {
    const result = planMasterCardDecision({
      revision,
      card,
      previousRevision: {
        ...revision,
        revisionId: "rev_1",
        revisionNumber: 1,
        status: "RELEASED",
      },
      deciderUserId: "checker",
      decision: "APPROVE",
      decidedAt: 100,
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        previousRevisionPatch: { supersededByRevisionId: "rev_2" },
      },
    });
    expect(
      result.ok &&
        Object.hasOwn(result.value.previousRevisionPatch ?? {}, "status"),
    ).toBe(false);
  });

  it("returns the customer-product uniqueness key for same-transaction enforcement", () => {
    const result = planMasterCardDecision({
      revision,
      card,
      deciderUserId: "checker",
      decision: "APPROVE",
      decidedAt: 100,
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        uniqueCustomerProduct: {
          customerId: "customer_1",
          customerProductCode: "FG-001",
        },
      },
    });
  });
});
