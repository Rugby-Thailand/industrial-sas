import { describe, expect, it } from "vitest";

import { expectError, expectOk } from "../../../tests/fixtures/domain-results";
import {
  compareRatios,
  composeRatios,
  formatRatio,
  invertRatio,
  makeExactFraction,
  makeRatio,
  MAX_RATIO_COMPONENT,
  ratiosEqual,
  scaleInteger,
  UNIT_RATIO,
  validateExactFraction,
  validateRatio,
  type ExactFraction,
  type Ratio,
} from "./ratio";

const ratio = (numerator: number, denominator: number) =>
  expectOk(makeRatio(numerator, denominator));

const forged = (numerator: unknown, denominator: unknown): Ratio =>
  ({ numerator, denominator }) as unknown as Ratio;

describe("makeRatio", () => {
  it("reduces to lowest terms", () => {
    expect(makeRatio(1000, 250)).toEqual({
      ok: true,
      value: { numerator: 4, denominator: 1 },
    });
    expect(makeRatio(6, 4)).toEqual({
      ok: true,
      value: { numerator: 3, denominator: 2 },
    });
  });

  it("rejects a zero or negative component", () => {
    expect(makeRatio(1, 0)).toEqual({
      ok: false,
      error: { code: "NOT_POSITIVE", numerator: 1, denominator: 0 },
    });
    expect(makeRatio(0, 1).ok).toBe(false);
    expect(makeRatio(-1, 2).ok).toBe(false);
    expect(makeRatio(1, -2).ok).toBe(false);
  });

  it("rejects a non-integer component", () => {
    expect(makeRatio(1.5, 2)).toEqual({
      ok: false,
      error: { code: "NOT_AN_INTEGER", numerator: 1.5, denominator: 2 },
    });
    expect(makeRatio(1, Number.POSITIVE_INFINITY).ok).toBe(false);
    expect(makeRatio(Number.NaN, 1).ok).toBe(false);
    expect(makeRatio(2 ** 53, 1).ok).toBe(false);
  });

  it("bounds each component", () => {
    expect(makeRatio(MAX_RATIO_COMPONENT, 1).ok).toBe(true);
    expect(makeRatio(MAX_RATIO_COMPONENT + 1, 1)).toEqual({
      ok: false,
      error: {
        code: "COMPONENT_OUT_OF_RANGE",
        numerator: MAX_RATIO_COMPONENT + 1,
        denominator: 1,
        limit: MAX_RATIO_COMPONENT,
      },
    });
  });

  it("freezes the value and the result wrapper", () => {
    const result = makeRatio(3, 2);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(expectOk(result))).toBe(true);
  });

  it("cannot be rewritten through a cast", () => {
    const value = ratio(3, 2);
    expect(() => {
      (value as { numerator: number }).numerator = 9;
    }).toThrow(TypeError);
    expect(value.numerator).toBe(3);
  });
});

describe("validateRatio", () => {
  it("answers the reduced form of a valid ratio", () => {
    expect(expectOk(validateRatio(forged(2, 4)))).toEqual({
      numerator: 1,
      denominator: 2,
    });
  });

  it("names what is wrong with a forged one", () => {
    expect(expectError(validateRatio(forged(1, 0))).code).toBe("NOT_POSITIVE");
    expect(expectError(validateRatio(forged("1", "2"))).code).toBe(
      "NOT_AN_INTEGER",
    );
    expect(expectError(validateRatio(null as unknown as Ratio))).toEqual({
      code: "NOT_A_FRACTION",
      received: "null",
    });
    expect(expectError(validateRatio(undefined as unknown as Ratio)).code).toBe(
      "NOT_A_FRACTION",
    );
  });
});

describe("makeExactFraction", () => {
  it("accepts a signed numerator and a positive denominator", () => {
    expect(expectOk(makeExactFraction(-5, 2))).toEqual({
      numerator: -5,
      denominator: 2,
    });
    expect(expectOk(makeExactFraction(0, 3)).numerator).toBe(0);
  });

  it("rejects a zero, negative, or over-large denominator", () => {
    expect(expectError(makeExactFraction(1, 0)).code).toBe("NOT_POSITIVE");
    expect(expectError(makeExactFraction(1, -2)).code).toBe("NOT_POSITIVE");
    expect(
      expectError(makeExactFraction(1, MAX_RATIO_COMPONENT + 1)).code,
    ).toBe("COMPONENT_OUT_OF_RANGE");
  });

  it("reduces by the greatest common divisor", () => {
    expect(expectOk(makeExactFraction(2, 4))).toEqual({
      numerator: 1,
      denominator: 2,
    });
    expect(expectOk(makeExactFraction(1000, 250))).toEqual({
      numerator: 4,
      denominator: 1,
    });
  });

  it("reduces a negative numerator without moving the sign", () => {
    expect(expectOk(makeExactFraction(-2, 4))).toEqual({
      numerator: -1,
      denominator: 2,
    });
    expect(expectOk(makeExactFraction(-1000, 250))).toEqual({
      numerator: -4,
      denominator: 1,
    });
  });

  it("normalizes every zero to 0/1", () => {
    expect(expectOk(makeExactFraction(0, 3))).toEqual({
      numerator: 0,
      denominator: 1,
    });

    expect(Object.is(expectOk(makeExactFraction(-0, 7)).numerator, 0)).toBe(
      true,
    );
  });

  it("keeps both components inside the declared bounds after reducing", () => {
    const reduced = expectOk(
      makeExactFraction(MAX_RATIO_COMPONENT * 2, MAX_RATIO_COMPONENT),
    );
    expect(reduced).toEqual({ numerator: 2, denominator: 1 });
    expect(Number.isSafeInteger(reduced.numerator)).toBe(true);
    expect(reduced.denominator).toBeLessThanOrEqual(MAX_RATIO_COMPONENT);
  });
});

describe("validateExactFraction", () => {
  it("reduces a forged unreduced fraction rather than passing it through", () => {
    expect(expectOk(validateExactFraction(forged(2, 4)))).toEqual({
      numerator: 1,
      denominator: 2,
    });
    expect(expectOk(validateExactFraction(forged(0, 5)))).toEqual({
      numerator: 0,
      denominator: 1,
    });
  });

  it("still names the invalid cases", () => {
    expect(expectError(validateExactFraction(forged(1, 0))).code).toBe(
      "NOT_POSITIVE",
    );
    expect(
      expectError(validateExactFraction(null as unknown as ExactFraction)).code,
    ).toBe("NOT_A_FRACTION");
  });
});

describe("composeRatios", () => {
  it("cross-reduces instead of overflowing", () => {
    expect(
      composeRatios(
        ratio(MAX_RATIO_COMPONENT, 3),
        ratio(3, MAX_RATIO_COMPONENT),
      ),
    ).toEqual({ ok: true, value: UNIT_RATIO });
  });

  it("multiplies exactly", () => {
    expect(composeRatios(ratio(12, 1), ratio(5, 2))).toEqual({
      ok: true,
      value: { numerator: 30, denominator: 1 },
    });
    expect(composeRatios(ratio(1, 3), ratio(1, 3))).toEqual({
      ok: true,
      value: { numerator: 1, denominator: 9 },
    });
  });

  it("is commutative and has an identity", () => {
    const left = ratio(7, 12);
    const right = ratio(15, 4);
    expect(composeRatios(left, right)).toEqual(composeRatios(right, left));
    expect(composeRatios(left, UNIT_RATIO)).toEqual({ ok: true, value: left });
  });

  it("rejects a composition that leaves the declared range", () => {
    const large = ratio(MAX_RATIO_COMPONENT, 1);
    expect(composeRatios(large, large)).toEqual({
      ok: false,
      error: {
        code: "COMPONENT_OUT_OF_RANGE",
        numerator: MAX_RATIO_COMPONENT * MAX_RATIO_COMPONENT,
        denominator: 1,
        limit: MAX_RATIO_COMPONENT,
      },
    });
  });

  it("re-validates a forged operand", () => {
    expect(composeRatios(forged(1, 0), UNIT_RATIO)).toEqual({
      ok: false,
      error: { code: "NOT_POSITIVE", numerator: 1, denominator: 0 },
    });
    expect(composeRatios(UNIT_RATIO, forged(0.5, 1)).ok).toBe(false);
    expect(composeRatios(UNIT_RATIO, forged(1, "2")).ok).toBe(false);
  });
});

describe("invertRatio and comparison", () => {
  it("inverts and round-trips", () => {
    const value = ratio(12, 5);
    const inverted = expectOk(invertRatio(value));
    expect(inverted).toEqual({ numerator: 5, denominator: 12 });
    expect(expectOk(invertRatio(inverted))).toEqual(value);
    expect(expectOk(composeRatios(value, inverted))).toEqual(UNIT_RATIO);
  });

  it("refuses to invert a forged ratio", () => {
    expect(expectError(invertRatio(forged(1, 0))).code).toBe("NOT_POSITIVE");
    expect(expectError(invertRatio(forged(0, 1))).code).toBe("NOT_POSITIVE");
    expect(
      expectError(invertRatio(forged(1, Number.POSITIVE_INFINITY))).code,
    ).toBe("NOT_AN_INTEGER");
  });

  it("compares by cross-multiplication", () => {
    expect(expectOk(compareRatios(ratio(1, 3), ratio(1, 2)))).toBe(-1);
    expect(expectOk(compareRatios(ratio(2, 4), ratio(1, 2)))).toBe(0);
    expect(expectOk(compareRatios(ratio(5, 2), ratio(7, 3)))).toBe(1);
    expect(expectOk(ratiosEqual(ratio(2, 4), ratio(1, 2)))).toBe(true);
    expect(expectOk(ratiosEqual(ratio(1, 3), ratio(1, 2)))).toBe(false);
  });

  it("compares an unreduced forgery by value, not by field", () => {
    expect(expectOk(compareRatios(forged(2, 4), ratio(1, 2)))).toBe(0);
    expect(expectOk(ratiosEqual(forged(2, 4), ratio(1, 2)))).toBe(true);
  });

  it("fails closed rather than answering an order for a forged operand", () => {
    expect(
      expectError(compareRatios(forged(Number.NaN, 1), UNIT_RATIO)).code,
    ).toBe("NOT_AN_INTEGER");
    expect(expectError(ratiosEqual(forged(1, 0), UNIT_RATIO)).code).toBe(
      "NOT_POSITIVE",
    );
  });

  it("formats for diagnostics only, and only a real fraction", () => {
    expect(expectOk(formatRatio(ratio(3, 2)))).toBe("3/2");
    expect(expectOk(formatRatio(expectOk(makeExactFraction(-1000, 3))))).toBe(
      "-1000/3",
    );
    expect(expectError(formatRatio(forged(1, 0))).code).toBe("NOT_POSITIVE");
    expect(expectError(formatRatio(forged(Number.NaN, Number.NaN))).code).toBe(
      "NOT_AN_INTEGER",
    );
  });

  // `formatRatio` validates through `validateExactFraction`, so it renders the
  // reduced form. An operator-facing message must not show `2/4` for a value the
  // type promises is `1/2`.
  it("renders the reduced form of an unreduced operand", () => {
    expect(expectOk(formatRatio(forged(2, 4)))).toBe("1/2");
    expect(expectOk(formatRatio(forged(0, 5)))).toBe("0/1");
  });
});

describe("scaleInteger", () => {
  it("is exact when the denominator divides the value", () => {
    expect(expectOk(scaleInteger(3000, ratio(1, 3)))).toEqual({
      kind: "EXACT",
      value: 1000,
    });
    expect(expectOk(scaleInteger(-3000, ratio(1, 3)))).toEqual({
      kind: "EXACT",
      value: -1000,
    });
    expect(expectOk(scaleInteger(0, ratio(7, 3)))).toEqual({
      kind: "EXACT",
      value: 0,
    });
  });

  it("reports the exact fraction rather than rounding", () => {
    expect(expectOk(scaleInteger(1000, ratio(1, 3)))).toEqual({
      kind: "INEXACT",
      exact: { numerator: 1000, denominator: 3 },
    });
    expect(expectOk(scaleInteger(-1000, ratio(1, 3)))).toEqual({
      kind: "INEXACT",
      exact: { numerator: -1000, denominator: 3 },
    });
  });

  it("keeps the sign on the numerator and the denominator positive", () => {
    const scaled = expectOk(scaleInteger(-5, ratio(1, 2)));
    expect(scaled.kind).toBe("INEXACT");
    if (scaled.kind === "INEXACT") {
      expect(scaled.exact.numerator).toBe(-5);
      expect(scaled.exact.denominator).toBe(2);
    }
  });

  it("reports an INEXACT remainder already in lowest terms", () => {
    const cases: readonly [number, Ratio][] = [
      [1000, ratio(1, 3)],
      [500, ratio(3, 7)],
      [7, ratio(5, 6)],
      [-9, ratio(4, 15)],
      [2, ratio(1000, 999)],
    ];
    for (const [value, factor] of cases) {
      const scaled = expectOk(scaleInteger(value, factor));
      expect(scaled.kind).toBe("INEXACT");
      if (scaled.kind !== "INEXACT") continue;
      const { numerator, denominator } = scaled.exact;
      expect(expectOk(validateExactFraction(scaled.exact))).toEqual({
        numerator,
        denominator,
      });
    }
  });

  it("reports overflow instead of an inexact integer", () => {
    expect(expectOk(scaleInteger(2 ** 53, ratio(2, 1)))).toEqual({
      kind: "OVERFLOW",
    });
    expect(
      expectOk(
        scaleInteger(Number.MAX_SAFE_INTEGER, ratio(MAX_RATIO_COMPONENT, 1)),
      ),
    ).toEqual({ kind: "OVERFLOW" });
    expect(expectOk(scaleInteger(1.5, UNIT_RATIO))).toEqual({
      kind: "OVERFLOW",
    });
  });

  it("rejects a forged factor instead of scaling by it", () => {
    expect(expectError(scaleInteger(1000, forged(1, 0))).code).toBe(
      "NOT_POSITIVE",
    );
    expect(expectError(scaleInteger(1000, forged(0, 1))).code).toBe(
      "NOT_POSITIVE",
    );
    expect(expectError(scaleInteger(1000, forged(1, -1))).code).toBe(
      "NOT_POSITIVE",
    );

    expect(expectOk(scaleInteger(1000, forged(2, 4)))).toEqual({
      kind: "EXACT",
      value: 500,
    });
  });

  it("terminates on a non-finite factor", () => {
    const started = Date.now();
    expect(
      expectError(scaleInteger(1, forged(1, Number.POSITIVE_INFINITY))).code,
    ).toBe("NOT_AN_INTEGER");
    expect(expectError(scaleInteger(1, forged(Number.NaN, 1))).code).toBe(
      "NOT_AN_INTEGER",
    );
    expect(
      expectError(scaleInteger(1, forged(Number.POSITIVE_INFINITY, 2))).code,
    ).toBe("NOT_AN_INTEGER");
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
