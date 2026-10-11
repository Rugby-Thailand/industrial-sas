import { describe, expect, it } from "vitest";

import { estimateThb } from "./estimate";

describe("presentation baht estimate", () => {
  it("keeps provider USD and the funding fee separate", () => {
    const result = estimateThb(603675, 33.53, 5.5);
    expect(result).not.toBeNull();
    expect(result!.inference).toBeCloseTo(0.000603675 * 33.53, 12);
    expect(result!.withFundingFee).toBeCloseTo(result!.inference * 1.055, 12);
    expect(result!.fundingFee).toBeCloseTo(result!.inference * 0.055, 12);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it.each([
    [NaN, 33.53, 5.5],
    [-1, 33.53, 5.5],
    ["1", 33.53, 5.5],
    [1, 0, 5.5],
    [1, Infinity, 5.5],
    [1, 33.53, -1],
    [1, 33.53, 101],
    [1, 33.53, undefined],
  ])("is unavailable for %s × %s at %s%%", (nano, rate, fee) => {
    expect(estimateThb(nano, rate, fee)).toBeNull();
  });
});
