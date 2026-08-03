/**
 * Unit tier — quantity as integer minor units.
 *
 * Three groups matter: what the decimal parser refuses (because that is the
 * operator-facing surface), what the bounds refuse (because that is where
 * exactness ends), and that a forged value cannot slip into arithmetic.
 */
import { describe, expect, it } from "vitest";

import { expectOk } from "../../../tests/fixtures/domain-results";
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
} from "./quantity";

const kilograms = (minorUnits: number) =>
  expectOk(makeQuantity(minorUnits, "KG"));

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
    expect(formatQuantity(kilograms(1005))).toBe("1.005");
    expect(formatQuantity(kilograms(-1005))).toBe("-1.005");
    expect(formatQuantity(kilograms(1))).toBe("0.001");
    expect(formatQuantity(kilograms(0))).toBe("0.000");
    expect(formatQuantity(kilograms(12_000))).toBe("12.000");
    expect(formatQuantity(kilograms(1_000_000_000))).toBe("1000000.000");
  });

  it("can trim trailing zeros for display", () => {
    const options = { trimTrailingZeros: true } as const;
    expect(formatQuantity(kilograms(12_000), options)).toBe("12");
    expect(formatQuantity(kilograms(12_500), options)).toBe("12.5");
    expect(formatQuantity(kilograms(0), options)).toBe("0");
    expect(formatQuantity(kilograms(-500), options)).toBe("-0.5");
  });
});
