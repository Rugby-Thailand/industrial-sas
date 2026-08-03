/**
 * Unit tier — exact rational arithmetic.
 *
 * The cases worth writing down are the ones a float implementation gets wrong:
 * thirds, a value that reduces to a whole number only after cross-reduction, and
 * a product that would silently pass 2^53.
 */
import { describe, expect, it } from "vitest";

import { expectOk } from "../../../tests/fixtures/domain-results";
import {
  compareRatios,
  composeRatios,
  formatRatio,
  greatestCommonDivisor,
  invertRatio,
  makeRatio,
  MAX_RATIO_COMPONENT,
  ratiosEqual,
  scaleInteger,
  UNIT_RATIO,
} from "./ratio";

const ratio = (numerator: number, denominator: number) =>
  expectOk(makeRatio(numerator, denominator));

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

  it("freezes the value", () => {
    expect(Object.isFrozen(ratio(3, 2))).toBe(true);
  });
});

describe("composeRatios", () => {
  it("cross-reduces instead of overflowing", () => {
    // 1000000/3 × 3/1000000 is 1/1. Multiplying the numerators first would be
    // 3,000,000,000,000 — still exact, but the same shape at larger components
    // is not, which is why the reduction happens before the multiply.
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
    expect(composeRatios({ numerator: 1, denominator: 0 }, UNIT_RATIO)).toEqual(
      {
        ok: false,
        error: { code: "NOT_POSITIVE", numerator: 1, denominator: 0 },
      },
    );
    expect(
      composeRatios(UNIT_RATIO, { numerator: 0.5, denominator: 1 }).ok,
    ).toBe(false);
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

  it("compares by cross-multiplication", () => {
    expect(compareRatios(ratio(1, 3), ratio(1, 2))).toBe(-1);
    expect(compareRatios(ratio(2, 4), ratio(1, 2))).toBe(0);
    expect(compareRatios(ratio(5, 2), ratio(7, 3))).toBe(1);
    expect(ratiosEqual(ratio(2, 4), ratio(1, 2))).toBe(true);
    expect(ratiosEqual(ratio(1, 3), ratio(1, 2))).toBe(false);
  });

  it("formats for diagnostics only", () => {
    expect(formatRatio(ratio(3, 2))).toBe("3/2");
  });
});

describe("scaleInteger", () => {
  it("is exact when the denominator divides the value", () => {
    expect(scaleInteger(3000, ratio(1, 3))).toEqual({
      kind: "EXACT",
      value: 1000,
    });
    expect(scaleInteger(-3000, ratio(1, 3))).toEqual({
      kind: "EXACT",
      value: -1000,
    });
    expect(scaleInteger(0, ratio(7, 3))).toEqual({ kind: "EXACT", value: 0 });
  });

  it("reports the exact fraction rather than rounding", () => {
    // 1000 thousandths of a unit that is 1/3 of the base is 333.33… — a value no
    // scale of three decimals can hold, and one no ledger may round.
    expect(scaleInteger(1000, ratio(1, 3))).toEqual({
      kind: "INEXACT",
      exact: { numerator: 1000, denominator: 3 },
    });
    expect(scaleInteger(-1000, ratio(1, 3))).toEqual({
      kind: "INEXACT",
      exact: { numerator: -1000, denominator: 3 },
    });
  });

  it("keeps the sign on the numerator and the denominator positive", () => {
    const scaled = scaleInteger(-5, ratio(1, 2));
    expect(scaled.kind).toBe("INEXACT");
    if (scaled.kind === "INEXACT") {
      expect(scaled.exact.numerator).toBe(-5);
      expect(scaled.exact.denominator).toBe(2);
    }
  });

  it("reports overflow instead of an inexact integer", () => {
    expect(scaleInteger(2 ** 53, ratio(2, 1))).toEqual({ kind: "OVERFLOW" });
    expect(
      scaleInteger(Number.MAX_SAFE_INTEGER, ratio(MAX_RATIO_COMPONENT, 1)),
    ).toEqual({ kind: "OVERFLOW" });
    expect(scaleInteger(1.5, UNIT_RATIO)).toEqual({ kind: "OVERFLOW" });
  });
});

describe("greatestCommonDivisor", () => {
  it("handles zero and negative inputs by magnitude", () => {
    expect(greatestCommonDivisor(0, 5)).toBe(5);
    expect(greatestCommonDivisor(5, 0)).toBe(5);
    expect(greatestCommonDivisor(0, 0)).toBe(0);
    expect(greatestCommonDivisor(-12, 18)).toBe(6);
  });
});
