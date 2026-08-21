import { describe, expect, it } from "vitest";

import { decideDemandRoute, mergeRouteDecision } from "./demandRouting";

describe("demand routing", () => {
  it("routes fully covered demand to available stock", () => {
    expect(
      decideDemandRoute({
        orderedBaseMinorUnits: 8_000,
        atpBaseMinorUnits: 8_000,
      }),
    ).toEqual({
      ok: true,
      value: {
        decision: "AVAILABLE_STOCK",
        productionShortageBaseMinorUnits: 0,
      },
    });
  });

  it("routes any shortage to production and preserves the exact shortage", () => {
    expect(
      decideDemandRoute({
        orderedBaseMinorUnits: 8_000,
        atpBaseMinorUnits: 3_000,
      }),
    ).toEqual({
      ok: true,
      value: {
        decision: "PRODUCTION",
        productionShortageBaseMinorUnits: 5_000,
      },
    });
  });

  it("merges unlike line routes into a mixed order", () => {
    expect(mergeRouteDecision("AVAILABLE_STOCK", "PRODUCTION")).toBe("MIXED");
    expect(mergeRouteDecision("PRODUCTION", "PRODUCTION")).toBe("PRODUCTION");
    expect(mergeRouteDecision("MIXED", "AVAILABLE_STOCK")).toBe("MIXED");
  });

  it("refuses invalid minor-unit values", () => {
    expect(
      decideDemandRoute({ orderedBaseMinorUnits: 1.5, atpBaseMinorUnits: 0 }),
    ).toMatchObject({ ok: false });
    expect(
      decideDemandRoute({ orderedBaseMinorUnits: 1, atpBaseMinorUnits: -1 }),
    ).toMatchObject({ ok: false });
  });
});
