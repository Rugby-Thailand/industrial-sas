import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  makeItemUomProfile,
  convertFromBase,
  convertToBase,
  type ItemUomProfile,
} from "../../convex/model/uom/itemUom";
import {
  addQuantities,
  formatQuantity,
  makeQuantity,
  MAX_QUANTITY_MINOR_UNITS,
  parseDecimalQuantity,
  QUANTITY_DECIMALS,
  subtractQuantities,
} from "../../convex/model/uom/quantity";
import {
  composeRatios,
  invertRatio,
  makeRatio,
  MAX_RATIO_COMPONENT,
  scaleInteger,
  UNIT_RATIO,
  type Ratio,
} from "../../convex/model/uom/ratio";
import { expectOk } from "../fixtures/domain-results";

const component = fc.integer({ min: 1, max: MAX_RATIO_COMPONENT });

const ratio: fc.Arbitrary<Ratio> = fc
  .tuple(component, component)
  .map(([numerator, denominator]) =>
    expectOk(makeRatio(numerator, denominator)),
  );

const smallRatio: fc.Arbitrary<Ratio> = fc
  .tuple(fc.integer({ min: 1, max: 1000 }), fc.integer({ min: 1, max: 1000 }))
  .map(([numerator, denominator]) =>
    expectOk(makeRatio(numerator, denominator)),
  );

const minorUnits = fc.integer({
  min: -MAX_QUANTITY_MINOR_UNITS,
  max: MAX_QUANTITY_MINOR_UNITS,
});

const gcd = (left: number, right: number): number => {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) [a, b] = [b, a % b];
  return a;
};

describe("ratio reduction", () => {
  it("is canonical: equal values reduce to identical components", () => {
    fc.assert(
      fc.property(
        component,
        component,
        component,
        (numerator, denominator, factor) => {
          const base = expectOk(makeRatio(numerator, denominator));
          const scaled = makeRatio(numerator * factor, denominator * factor);

          if (!scaled.ok) return;
          expect(scaled.value).toEqual(base);
        },
      ),
    );
  });

  it("always produces coprime components", () => {
    fc.assert(
      fc.property(ratio, (value) => {
        expect(gcd(value.numerator, value.denominator)).toBe(1);
      }),
    );
  });
});

describe("ratio composition", () => {
  it("is commutative", () => {
    fc.assert(
      fc.property(ratio, ratio, (left, right) => {
        expect(composeRatios(left, right)).toEqual(composeRatios(right, left));
      }),
    );
  });

  it("has the unit ratio as its identity", () => {
    fc.assert(
      fc.property(ratio, (value) => {
        expect(composeRatios(value, UNIT_RATIO)).toEqual({
          ok: true,
          value,
        });
        expect(composeRatios(UNIT_RATIO, value)).toEqual({
          ok: true,
          value,
        });
      }),
    );
  });

  it("is associative wherever both groupings succeed", () => {
    fc.assert(
      fc.property(smallRatio, smallRatio, smallRatio, (a, b, c) => {
        const leftFirst = composeRatios(a, b);
        const rightFirst = composeRatios(b, c);
        if (!leftFirst.ok || !rightFirst.ok) return;
        const left = composeRatios(leftFirst.value, c);
        const right = composeRatios(a, rightFirst.value);
        if (!left.ok || !right.ok) return;
        expect(left.value).toEqual(right.value);
      }),
    );
  });

  it("round-trips through inversion", () => {
    fc.assert(
      fc.property(ratio, (value) => {
        const inverted = expectOk(invertRatio(value));
        expect(expectOk(invertRatio(inverted))).toEqual(value);
        expect(expectOk(composeRatios(value, inverted))).toEqual(UNIT_RATIO);
      }),
    );
  });

  it("never returns a component outside the declared range", () => {
    fc.assert(
      fc.property(ratio, ratio, (left, right) => {
        const composed = composeRatios(left, right);
        if (!composed.ok) return;
        expect(composed.value.numerator).toBeLessThanOrEqual(
          MAX_RATIO_COMPONENT,
        );
        expect(composed.value.denominator).toBeLessThanOrEqual(
          MAX_RATIO_COMPONENT,
        );
        expect(Number.isSafeInteger(composed.value.numerator)).toBe(true);
        expect(Number.isSafeInteger(composed.value.denominator)).toBe(true);
      }),
    );
  });
});

describe("exact scaling", () => {
  it("is exact for every multiple of the denominator", () => {
    fc.assert(
      fc.property(
        smallRatio,
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        (value, multiple) => {
          const scaled = expectOk(
            scaleInteger(multiple * value.denominator, value),
          );
          expect(scaled).toEqual({
            kind: "EXACT",
            value:
              multiple * value.numerator === 0 ? 0 : multiple * value.numerator,
          });
        },
      ),
    );
  });

  it("round-trips: scale by a ratio, then by its inverse", () => {
    fc.assert(
      fc.property(
        smallRatio,
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        (value, multiple) => {
          const original = multiple * value.denominator;
          const scaled = expectOk(scaleInteger(original, value));
          if (scaled.kind !== "EXACT") return;
          const back = expectOk(
            scaleInteger(scaled.value, expectOk(invertRatio(value))),
          );
          expect(back).toEqual({
            kind: "EXACT",
            value: original === 0 ? 0 : original,
          });
        },
      ),
    );
  });

  it("reports the true value when the result is not an integer", () => {
    fc.assert(
      fc.property(
        smallRatio,
        fc.integer({ min: -100_000, max: 100_000 }),
        (value, input) => {
          const scaled = expectOk(scaleInteger(input, value));
          if (scaled.kind !== "INEXACT") return;

          expect(scaled.exact.numerator * value.denominator).toBe(
            input * value.numerator * scaled.exact.denominator,
          );
          expect(scaled.exact.denominator).toBeGreaterThan(1);
          expect(gcd(scaled.exact.numerator, scaled.exact.denominator)).toBe(1);
        },
      ),
    );
  });

  it("never returns a non-safe integer, whatever the input", () => {
    fc.assert(
      fc.property(
        fc.integer({
          min: -Number.MAX_SAFE_INTEGER,
          max: Number.MAX_SAFE_INTEGER,
        }),
        ratio,
        (input, value) => {
          const scaled = expectOk(scaleInteger(input, value));
          if (scaled.kind === "EXACT") {
            expect(Number.isSafeInteger(scaled.value)).toBe(true);
          }
          if (scaled.kind === "INEXACT") {
            expect(Number.isSafeInteger(scaled.exact.numerator)).toBe(true);
            expect(Number.isSafeInteger(scaled.exact.denominator)).toBe(true);
          }
        },
      ),
    );
  });
});

describe("quantity arithmetic", () => {
  it("is commutative, and never returns a value outside the bound", () => {
    fc.assert(
      fc.property(minorUnits, minorUnits, (left, right) => {
        const a = expectOk(makeQuantity(left, "KG"));
        const b = expectOk(makeQuantity(right, "KG"));
        const forward = addQuantities(a, b);
        expect(forward).toEqual(addQuantities(b, a));
        if (!forward.ok) return;
        expect(Math.abs(forward.value.minorUnits)).toBeLessThanOrEqual(
          MAX_QUANTITY_MINOR_UNITS,
        );
        expect(Number.isSafeInteger(forward.value.minorUnits)).toBe(true);
      }),
    );
  });

  it("subtracts as the inverse of adding", () => {
    fc.assert(
      fc.property(minorUnits, minorUnits, (left, right) => {
        const a = expectOk(makeQuantity(left, "KG"));
        const b = expectOk(makeQuantity(right, "KG"));
        const sum = addQuantities(a, b);
        if (!sum.ok) return;
        expect(subtractQuantities(sum.value, b)).toEqual({
          ok: true,
          value: a,
        });
      }),
    );
  });

  it("round-trips through the decimal form", () => {
    fc.assert(
      fc.property(minorUnits, (value) => {
        const quantity = expectOk(makeQuantity(value, "KG"));
        const formatted = expectOk(formatQuantity(quantity));
        expect(parseDecimalQuantity(formatted, "KG")).toEqual({
          ok: true,
          value: quantity,
        });
      }),
    );
  });

  it("never accepts more than three decimals", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 999_999 }),
        fc.stringMatching(/^[0-9]{4,8}$/),
        (whole, decimals) => {
          const parsed = parseDecimalQuantity(`${whole}.${decimals}`, "KG");
          expect(parsed.ok).toBe(false);
          if (!parsed.ok) {
            expect(parsed.error.code).toBe("PRECISION_EXCEEDED");
          }
        },
      ),
    );
    expect(QUANTITY_DECIMALS).toBe(3);
  });
});

describe("item UOM conversion", () => {
  const profileFor = (toBase: Ratio): ItemUomProfile =>
    expectOk(
      makeItemUomProfile({
        itemKey: "ITEM-1",
        baseUom: "KG",
        alternates: [{ uom: "PACK", toBase }],
      }),
    );

  it("round-trips every exact capture back to the captured amount", () => {
    fc.assert(
      fc.property(
        smallRatio,
        fc.integer({ min: -100_000, max: 100_000 }),
        (toBase, multiple) => {
          const profile = profileFor(toBase);
          const captured = multiple * toBase.denominator;
          const toBaseOutcome = convertToBase(profile, "PACK", captured);
          if (toBaseOutcome.kind !== "EXACT") return;
          const back = convertFromBase(profile, "PACK", toBaseOutcome.quantity);
          expect(back).toEqual({
            kind: "EXACT",
            quantity: { uom: "PACK", minorUnits: captured },
          });
        },
      ),
    );
  });

  it("only ever yields EXACT, INEXACT, or REJECTED — never a rounded value", () => {
    fc.assert(
      fc.property(ratio, minorUnits, (toBase, captured) => {
        const outcome = convertToBase(profileFor(toBase), "PACK", captured);
        expect(["EXACT", "INEXACT", "REJECTED"]).toContain(outcome.kind);
        if (outcome.kind === "EXACT") {
          expect(captured % toBase.denominator === 0).toBe(true);
          expect(Number.isSafeInteger(outcome.quantity.minorUnits)).toBe(true);
        }
        if (outcome.kind === "INEXACT") {
          expect(captured % toBase.denominator === 0).toBe(false);
        }
      }),
    );
  });
});

describe("negative controls", () => {
  it("the exactness property fails when a conversion is allowed to round", () => {
    const roundingScale = (input: number, value: Ratio): number =>
      Math.round((input * value.numerator) / value.denominator);

    const inexactCase = fc
      .tuple(
        fc.integer({ min: 2, max: 1000 }),
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 0, max: 1000 }),
      )
      .map(([denominator, numerator, multiple]) => ({
        ratio: expectOk(makeRatio(numerator, denominator)),
        input: multiple * denominator + 1,
      }));

    const details = fc.check(
      fc.property(inexactCase, ({ ratio: value, input }) => {
        const rounded = roundingScale(input, value);
        // The claim a rounding implementation would have to satisfy: the result,
        // scaled back, returns the input.
        expect(rounded * value.denominator).toBe(input * value.numerator);
      }),
    );
    expect(details.failed).toBe(true);
  });

  it("the overflow property fails without the safe-integer check", () => {
    const unguardedScale = (input: number, value: Ratio): number =>
      (input * value.numerator) / value.denominator;

    const details = fc.check(
      fc.property(
        fc.integer({ min: 2 ** 45, max: Number.MAX_SAFE_INTEGER }),

        fc
          .integer({ min: 1000, max: MAX_RATIO_COMPONENT })
          .map((numerator) => expectOk(makeRatio(numerator, 1))),
        (input, value) => {
          expect(Number.isSafeInteger(unguardedScale(input, value))).toBe(true);
        },
      ),
    );
    expect(details.failed).toBe(true);
  });

  it("the precision property fails when a fourth decimal is truncated", () => {
    const truncatingParse = (raw: string): number => {
      const [whole, decimals = ""] = raw.split(".");
      return Number(`${whole}${decimals.slice(0, 3).padEnd(3, "0")}`);
    };

    const details = fc.check(
      fc.property(fc.stringMatching(/^[0-9]{1,4}\.[0-9]{4}$/), (raw) => {
        const truncated = truncatingParse(raw);
        expect(truncatingParse(`${raw}9`)).not.toBe(truncated);
      }),
    );
    expect(details.failed).toBe(true);
  });
});
