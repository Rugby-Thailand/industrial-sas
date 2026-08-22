/**
 * Unit tier — quantity as integer minor units.
 *
 * Three groups matter: what the decimal parser refuses (because that is the
 * operator-facing surface), what the bounds refuse (because that is where
 * exactness ends), and that a forged value cannot slip into arithmetic.
 */
import { describe, expect, it } from "vitest";

import { expectError, expectOk } from "../../../tests/fixtures/domain-results";
import {
  absoluteQuantity,
  addQuantities,
  compareQuantities,
  formatQuantity,
  isZeroQuantity,
  makeQuantity,
  MAX_QUANTITY_MINOR_UNITS,
  negateQuantity,
  normalizeUomCode,
  parseDecimalQuantity,
  QUANTITY_DECIMALS,
  QUANTITY_SCALE,
  quantityFromBaseUnits,
  requireNonZeroQuantity,
  subtractQuantities,
  sumQuantities,
  zeroQuantity,
  type Quantity,
  type QuantityFormatOptions,
} from "./quantity";

const kilograms = (minorUnits: number) =>
  expectOk(makeQuantity(minorUnits, "KG"));

/** The options bag, named locally so the forged-cast lines stay readable. */
type FormatOptions = QuantityFormatOptions;

/** A value that claims to be a `Quantity` and is not one. */
const forged = (minorUnits: unknown, uom: unknown): Quantity =>
  ({ minorUnits, uom }) as unknown as Quantity;

describe("normalizeUomCode", () => {
  it("folds ASCII case and trims", () => {
    expect(normalizeUomCode(" kg ")).toEqual({ ok: true, value: "KG" });
    expect(normalizeUomCode("Case20")).toEqual({ ok: true, value: "CASE20" });
  });

  it("rejects punctuation, a leading digit, and an over-long code", () => {
    for (const raw of ["", "1KG", "K G", "KG-1", "KILOGRAMMES12", "กก"]) {
      expect(normalizeUomCode(raw)).toEqual({
        ok: false,
        error: { code: "INVALID_UOM_CODE", raw },
      });
    }
  });
});

describe("makeQuantity", () => {
  it("carries the scale as a documented constant", () => {
    expect(QUANTITY_SCALE).toBe(1000);
    expect(QUANTITY_DECIMALS).toBe(3);
  });

  it("accepts a signed integer within bounds and freezes it", () => {
    expect(makeQuantity(1005, "KG")).toEqual({
      ok: true,
      value: { uom: "KG", minorUnits: 1005 },
    });
    expect(Object.isFrozen(kilograms(1))).toBe(true);
    expect(makeQuantity(-1, "KG").ok).toBe(true);
  });

  it("rejects a fraction of a minor unit", () => {
    expect(makeQuantity(0.5, "KG")).toEqual({
      ok: false,
      error: { code: "NOT_AN_INTEGER", value: 0.5 },
    });
    expect(makeQuantity(Number.NaN, "KG").ok).toBe(false);
    expect(makeQuantity(Number.POSITIVE_INFINITY, "KG").ok).toBe(false);
    expect(makeQuantity(2 ** 53, "KG").ok).toBe(false);
  });

  it("bounds the magnitude in both directions", () => {
    expect(makeQuantity(MAX_QUANTITY_MINOR_UNITS, "KG").ok).toBe(true);
    expect(makeQuantity(-MAX_QUANTITY_MINOR_UNITS, "KG").ok).toBe(true);
    expect(makeQuantity(MAX_QUANTITY_MINOR_UNITS + 1, "KG")).toEqual({
      ok: false,
      error: {
        code: "OUT_OF_RANGE",
        value: MAX_QUANTITY_MINOR_UNITS + 1,
        limit: MAX_QUANTITY_MINOR_UNITS,
      },
    });
  });

  it("builds from whole base units", () => {
    expect(quantityFromBaseUnits(5, "KG")).toEqual({
      ok: true,
      value: { uom: "KG", minorUnits: 5000 },
    });
    expect(quantityFromBaseUnits(0.5, "KG").ok).toBe(false);
    expect(quantityFromBaseUnits(Number.MAX_SAFE_INTEGER, "KG").ok).toBe(false);
  });

  it("has a zero for every UOM", () => {
    expect(zeroQuantity("PCS")).toEqual({
      ok: true,
      value: { uom: "PCS", minorUnits: 0 },
    });
    expect(isZeroQuantity(kilograms(0))).toBe(true);
    expect(isZeroQuantity(kilograms(1))).toBe(false);
  });
});

describe("parseDecimalQuantity", () => {
  it("parses whole numbers, decimals, and signs", () => {
    expect(parseDecimalQuantity("12", "PCS")).toEqual({
      ok: true,
      value: { uom: "PCS", minorUnits: 12_000 },
    });
    expect(parseDecimalQuantity("1.005", "KG")).toEqual({
      ok: true,
      value: { uom: "KG", minorUnits: 1005 },
    });
    expect(parseDecimalQuantity("-0.25", "KG")).toEqual({
      ok: true,
      value: { uom: "KG", minorUnits: -250 },
    });
    expect(parseDecimalQuantity("+3.5", "KG")).toEqual({
      ok: true,
      value: { uom: "KG", minorUnits: 3500 },
    });
    expect(parseDecimalQuantity("0.001", "KG")).toEqual({
      ok: true,
      value: { uom: "KG", minorUnits: 1 },
    });
    expect(parseDecimalQuantity("0000012", "PCS")).toEqual({
      ok: true,
      value: { uom: "PCS", minorUnits: 12_000 },
    });
  });

  it("rejects a fourth decimal instead of rounding it away", () => {
    expect(parseDecimalQuantity("1.0001", "KG")).toEqual({
      ok: false,
      error: {
        code: "PRECISION_EXCEEDED",
        raw: "1.0001",
        maximumDecimals: QUANTITY_DECIMALS,
      },
    });
    // Even trailing zeros are refused: accepting "1.0000" while refusing
    // "1.0001" is a rule no operator can predict.
    expect(parseDecimalQuantity("1.0000", "KG").ok).toBe(false);
  });

  it("rejects everything a lenient number parser would accept", () => {
    for (const raw of [
      "",
      " 1",
      "1 ",
      "1.",
      ".5",
      "1e3",
      "0x10",
      "12abc",
      "1,000",
      "--1",
      "1.2.3",
      "๑๒",
      "Infinity",
      "NaN",
    ]) {
      expect(parseDecimalQuantity(raw, "KG")).toEqual({
        ok: false,
        error: { code: "MALFORMED_DECIMAL", raw },
      });
    }
  });

  it("rejects a value past the magnitude bound", () => {
    expect(parseDecimalQuantity("1000000000.001", "KG").ok).toBe(false);
    expect(parseDecimalQuantity("1000000000.000", "KG").ok).toBe(true);
  });
});

describe("arithmetic", () => {
  it("adds and subtracts within a UOM", () => {
    expect(addQuantities(kilograms(1500), kilograms(2500))).toEqual({
      ok: true,
      value: { uom: "KG", minorUnits: 4000 },
    });
    expect(subtractQuantities(kilograms(1000), kilograms(2500))).toEqual({
      ok: true,
      value: { uom: "KG", minorUnits: -1500 },
    });
  });

  it("refuses to mix UOMs", () => {
    const pieces = expectOk(makeQuantity(12_000, "PCS"));
    expect(addQuantities(kilograms(1000), pieces)).toEqual({
      ok: false,
      error: { code: "UOM_MISMATCH", left: "KG", right: "PCS" },
    });
    expect(compareQuantities(kilograms(1000), pieces).ok).toBe(false);
    expect(subtractQuantities(kilograms(1000), pieces).ok).toBe(false);
  });

  it("rejects a sum that leaves the bound rather than wrapping", () => {
    const large = kilograms(MAX_QUANTITY_MINOR_UNITS);
    expect(addQuantities(large, kilograms(1))).toEqual({
      ok: false,
      error: {
        code: "OUT_OF_RANGE",
        value: MAX_QUANTITY_MINOR_UNITS + 1,
        limit: MAX_QUANTITY_MINOR_UNITS,
      },
    });
  });

  it("re-validates a forged operand", () => {
    expect(addQuantities({ uom: "KG", minorUnits: 0.5 }, kilograms(1))).toEqual(
      {
        ok: false,
        error: { code: "NOT_AN_INTEGER", value: 0.5 },
      },
    );
    expect(
      addQuantities({ uom: "not a uom", minorUnits: 1 }, kilograms(1)).ok,
    ).toBe(false);
    expect(
      addQuantities(
        { uom: "KG", minorUnits: Number.MAX_SAFE_INTEGER },
        kilograms(1),
      ).ok,
    ).toBe(false);
  });

  it("negates, absolutes, and compares", () => {
    expect(negateQuantity(kilograms(1500))).toEqual({
      ok: true,
      value: { uom: "KG", minorUnits: -1500 },
    });
    expect(absoluteQuantity(kilograms(-1500))).toEqual({
      ok: true,
      value: { uom: "KG", minorUnits: 1500 },
    });
    expect(compareQuantities(kilograms(1), kilograms(2))).toEqual({
      ok: true,
      value: -1,
    });
    expect(compareQuantities(kilograms(2), kilograms(2))).toEqual({
      ok: true,
      value: 0,
    });
    expect(compareQuantities(kilograms(3), kilograms(2))).toEqual({
      ok: true,
      value: 1,
    });
  });

  it("sums a list, including the empty one", () => {
    expect(sumQuantities([], "KG")).toEqual({
      ok: true,
      value: { uom: "KG", minorUnits: 0 },
    });
    expect(
      sumQuantities([kilograms(1), kilograms(2), kilograms(-3)], "KG"),
    ).toEqual({ ok: true, value: { uom: "KG", minorUnits: 0 } });
    expect(sumQuantities([expectOk(makeQuantity(1, "PCS"))], "KG").ok).toBe(
      false,
    );
  });

  it("gates the zero-quantity posting", () => {
    expect(requireNonZeroQuantity(kilograms(0))).toEqual({
      ok: false,
      error: { code: "ZERO_NOT_ALLOWED", uom: "KG" },
    });
    expect(requireNonZeroQuantity(kilograms(-1)).ok).toBe(true);
  });
});

describe("formatQuantity", () => {
  it("shows the digits that are stored, with no locale involved", () => {
    expect(expectOk(formatQuantity(kilograms(1005)))).toBe("1.005");
    expect(expectOk(formatQuantity(kilograms(-1005)))).toBe("-1.005");
    expect(expectOk(formatQuantity(kilograms(1)))).toBe("0.001");
    expect(expectOk(formatQuantity(kilograms(0)))).toBe("0.000");
    expect(expectOk(formatQuantity(kilograms(12_000)))).toBe("12.000");
    expect(expectOk(formatQuantity(kilograms(1_000_000_000)))).toBe(
      "1000000.000",
    );
  });

  it("can trim trailing zeros for display", () => {
    const options = { trimTrailingZeros: true } as const;
    expect(expectOk(formatQuantity(kilograms(12_000), options))).toBe("12");
    expect(expectOk(formatQuantity(kilograms(12_500), options))).toBe("12.5");
    expect(expectOk(formatQuantity(kilograms(0), options))).toBe("0");
    expect(expectOk(formatQuantity(kilograms(-500), options))).toBe("-0.5");
  });

  it("refuses to render a forged quantity as digits", () => {
    // `NaN.NaN` on a warehouse screen is worse than a rejection: it looks like a
    // reading. Formatting claims the digits shown are the digits stored, which is
    // only true of a value this module built.
    expect(expectError(formatQuantity(forged(Number.NaN, "KG"))).code).toBe(
      "NOT_AN_INTEGER",
    );
    expect(expectError(formatQuantity(forged(1.5, "KG"))).code).toBe(
      "NOT_AN_INTEGER",
    );
    expect(expectError(formatQuantity(forged(1000, "kg-1"))).code).toBe(
      "INVALID_UOM_CODE",
    );
    expect(expectError(formatQuantity(null as unknown as Quantity))).toEqual({
      code: "NOT_A_QUANTITY",
      received: "null",
    });
  });

  // The options bag is as forgeable as the quantity: it arrives from a caller
  // whose type checker may have been satisfied by a cast, or from a value that
  // was `undefined` one call earlier. Dereferencing it threw a `TypeError` out of
  // a module that promises every failure is a `Result`.
  it("names an options bag that is not an object instead of throwing", () => {
    expect(
      expectError(
        formatQuantity(kilograms(1005), null as unknown as FormatOptions),
      ),
    ).toEqual({
      code: "INVALID_FORMAT_OPTIONS",
      field: "options",
      received: "null",
    });
    expect(
      expectError(
        formatQuantity(kilograms(1005), "trim" as unknown as FormatOptions),
      ).code,
    ).toBe("INVALID_FORMAT_OPTIONS");
    expect(
      expectError(
        formatQuantity(kilograms(1005), (() => {}) as unknown as FormatOptions),
      ).code,
    ).toBe("INVALID_FORMAT_OPTIONS");
    // An array has no `trimTrailingZeros`, so it would have been read as the
    // default rather than as the caller error it is.
    expect(
      expectError(
        formatQuantity(kilograms(1005), [] as unknown as FormatOptions),
      ).code,
    ).toBe("INVALID_FORMAT_OPTIONS");
  });

  // A truthy non-boolean must not be reinterpreted as `true`: `trimTrailingZeros`
  // decides whether a stored digit is shown, and guessing at it is how two
  // screens disagree about the same quantity.
  it("names a forged trimTrailingZeros instead of reinterpreting it", () => {
    for (const forgedFlag of ["true", "", 1, 0, null, {}]) {
      expect(
        expectError(
          formatQuantity(kilograms(12_000), {
            trimTrailingZeros: forgedFlag,
          } as unknown as FormatOptions),
        ).code,
      ).toBe("INVALID_FORMAT_OPTIONS");
    }
    expect(
      expectError(
        formatQuantity(kilograms(12_000), {
          trimTrailingZeros: "true",
        } as unknown as FormatOptions),
      ),
    ).toEqual({
      code: "INVALID_FORMAT_OPTIONS",
      field: "trimTrailingZeros",
      received: "string",
    });
  });

  it("still accepts an absent flag and an explicit false", () => {
    expect(expectOk(formatQuantity(kilograms(12_000), {}))).toBe("12.000");
    expect(
      expectOk(formatQuantity(kilograms(12_000), { trimTrailingZeros: false })),
    ).toBe("12.000");
    // `exactOptionalPropertyTypes` is on, so an explicit `undefined` is not
    // expressible without a cast — and is exactly what a preferences document
    // read back, or an object literal built from an absent field, hands over. The
    // interface stays strict and the cast stands in for that caller.
    expect(
      expectOk(
        formatQuantity(kilograms(12_000), {
          trimTrailingZeros: undefined,
        } as unknown as FormatOptions),
      ),
    ).toBe("12.000");
  });

  it("reports the invalid options before the quantity", () => {
    // Both are wrong here. The options are what the caller controls, and a
    // rejection that blamed the quantity would send them looking in the wrong
    // place.
    expect(
      expectError(
        formatQuantity(
          forged(Number.NaN, "KG"),
          null as unknown as FormatOptions,
        ),
      ).code,
    ).toBe("INVALID_FORMAT_OPTIONS");
  });
});

describe("forged quantities", () => {
  it("cannot enter arithmetic through a cast", () => {
    const bad = forged(Number.NaN, "KG");
    expect(expectError(addQuantities(kilograms(1), bad)).code).toBe(
      "NOT_AN_INTEGER",
    );
    expect(expectError(subtractQuantities(bad, kilograms(1))).code).toBe(
      "NOT_AN_INTEGER",
    );
    expect(expectError(compareQuantities(bad, kilograms(1))).code).toBe(
      "NOT_AN_INTEGER",
    );
    expect(expectError(negateQuantity(bad)).code).toBe("NOT_AN_INTEGER");
    expect(expectError(absoluteQuantity(bad)).code).toBe("NOT_AN_INTEGER");
    expect(expectError(requireNonZeroQuantity(bad)).code).toBe(
      "NOT_AN_INTEGER",
    );
    expect(expectError(sumQuantities([kilograms(1), bad], "KG")).code).toBe(
      "NOT_AN_INTEGER",
    );
  });

  it("names a value that is not a quantity at all", () => {
    expect(
      expectError(addQuantities(kilograms(1), undefined as unknown as Quantity))
        .code,
    ).toBe("NOT_A_QUANTITY");
    expect(
      expectError(sumQuantities("KG" as unknown as readonly Quantity[], "KG"))
        .code,
    ).toBe("NOT_A_QUANTITY");
  });

  it("validates a UOM code that is not a string", () => {
    expect(expectError(makeQuantity(1000, 12 as unknown as string))).toEqual({
      code: "INVALID_UOM_CODE",
      raw: "number",
    });
    expect(
      expectError(parseDecimalQuantity(12 as unknown as string, "KG")),
    ).toEqual({ code: "MALFORMED_DECIMAL", raw: "number" });
  });

  it("answers false rather than throwing for a zero test", () => {
    expect(isZeroQuantity(forged(Number.NaN, "KG"))).toBe(false);
    expect(isZeroQuantity(null as unknown as Quantity)).toBe(false);
  });

  it("returns frozen values that a cast cannot rewrite", () => {
    const value = kilograms(1005);
    expect(Object.isFrozen(value)).toBe(true);
    expect(() => {
      (value as { minorUnits: number }).minorUnits = 9;
    }).toThrow(TypeError);
    expect(value.minorUnits).toBe(1005);
  });
});
