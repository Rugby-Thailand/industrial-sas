import { describe, expect, it } from "vitest";

import { annexPalletPlan } from "../../staging/annexDemo";

describe("annexPalletPlan", () => {
  it("adds 905 square metres without entering the protected aisle space", () => {
    const plan = annexPalletPlan();
    expect(plan).toHaveLength(905);
    expect(plan.length * 1_000_000).toBe(905_000_000);
    expect(plan.filter((pallet) => pallet.status === "RESERVED")).toHaveLength(
      36,
    );
    expect(
      new Set(
        plan.map((pallet) => `${pallet.zoneCode}:${pallet.xMm}:${pallet.yMm}`),
      ),
    ).toHaveLength(plan.length);
  });
});
