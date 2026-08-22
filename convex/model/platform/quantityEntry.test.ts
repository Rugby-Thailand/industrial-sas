import { describe, expect, it } from "vitest";

import { makeItemUomProfile, type ItemUomProfile } from "../uom/itemUom";
import {
  MAX_QUANTITY_ENTRY_LENGTH,
  PLAUSIBILITY_FACTOR,
  captureQuantity,
  judgePlausibility,
  normalizeQuantityEntry,
  normalizeThaiDigits,
} from "./quantityEntry";

/** One case is twelve eaches; the base unit is `PCS`. */
const caseProfile: ItemUomProfile = (() => {
  const profile = makeItemUomProfile({
    itemKey: "WIDGET-001",
    baseUom: "PCS",
    alternates: [
      { uom: "CASE", toBase: { numerator: 12, denominator: 1 } },
      { uom: "DRUM", toBase: { numerator: 1, denominator: 3 } },
    ],
  });
  if (!profile.ok) throw new Error("fixture profile is invalid");
  return profile.value;
})();

describe("Thai digits", () => {
  it("maps Thai numerals to ASCII", () => {
    const mapped = normalizeThaiDigits("๑๒๓");
    expect(mapped.ok && mapped.value).toBe("123");
  });

  it("leaves ASCII untouched", () => {
    const mapped = normalizeThaiDigits("123");
    expect(mapped.ok && mapped.value).toBe("123");
  });

  it("refuses a string that mixes numeral systems", () => {
    const mapped = normalizeThaiDigits("1๒");
    expect(!mapped.ok && mapped.error.code).toBe("MIXED_NUMERAL_SYSTEMS");
  });

  it("maps a Thai decimal entry", () => {
    const entry = normalizeQuantityEntry("๑๒.๕");
    expect(entry.ok && entry.value).toBe("12.5");
  });
});

describe("entry normalization", () => {
  it("accepts a plain integer", () => {
    expect(normalizeQuantityEntry(" 42 ")).toEqual({ ok: true, value: "42" });
  });

  it("accepts grouped thousands", () => {
    expect(normalizeQuantityEntry("1,200")).toEqual({
      ok: true,
      value: "1200",
    });
    expect(normalizeQuantityEntry("1 200")).toEqual({
      ok: true,
      value: "1200",
    });
  });

  it("refuses malformed grouping rather than guessing", () => {
    for (const raw of ["1,20", "1,2,00", "12,3456"]) {
      const entry = normalizeQuantityEntry(raw);
      expect(!entry.ok && entry.error.code, raw).toBe("MALFORMED_GROUPING");
    }
  });

  it("never reads a comma as a decimal mark", () => {
    const entry = normalizeQuantityEntry("1,5");
    expect(entry.ok).toBe(false);
  });

  it("refuses a separator inside the fraction", () => {
    const entry = normalizeQuantityEntry("1.2,5");
    expect(entry.ok).toBe(false);
  });

  it("refuses two decimal marks", () => {
    const entry = normalizeQuantityEntry("1.2.3");
    expect(!entry.ok && entry.error.code).toBe("MALFORMED_ENTRY");
  });

  it("refuses an exponent, a hex literal, and trailing text", () => {
    for (const raw of ["1e3", "0x10", "12abc", "."]) {
      expect(normalizeQuantityEntry(raw).ok, raw).toBe(false);
    }
  });

  it("refuses more than three decimals rather than rounding", () => {
    const entry = normalizeQuantityEntry("1.0001");
    expect(!entry.ok && entry.error.code).toBe("PRECISION_EXCEEDED");
  });

  it("refuses an empty entry and an over-long one", () => {
    expect(normalizeQuantityEntry("   ").ok).toBe(false);
    const long = normalizeQuantityEntry(
      "1".repeat(MAX_QUANTITY_ENTRY_LENGTH + 1),
    );
    expect(!long.ok && long.error.code).toBe("ENTRY_TOO_LONG");
  });
});

describe("capture", () => {
  it("captures a base-unit entry without converting", () => {
    const captured = captureQuantity({ text: "12", entryUom: "pcs" });
    expect(captured.ok && captured.value.entered).toEqual({
      uom: "PCS",
      minorUnits: 12_000,
    });
    expect(captured.ok && captured.value.converted).toBe(false);
  });

  it("converts an entry unit to base minor units exactly", () => {
    const captured = captureQuantity({
      text: "3",
      entryUom: "CASE",
      profile: caseProfile,
    });
    expect(captured.ok && captured.value.entered.minorUnits).toBe(3_000);
    expect(captured.ok && captured.value.base).toEqual({
      uom: "PCS",
      minorUnits: 36_000,
    });
    expect(captured.ok && captured.value.converted).toBe(true);
  });

  it("captures a Thai-digit entry in an alternate unit", () => {
    const captured = captureQuantity({
      text: "๒",
      entryUom: "CASE",
      profile: caseProfile,
    });
    expect(captured.ok && captured.value.base.minorUnits).toBe(24_000);
  });

  it("refuses a conversion that does not land on a whole minor unit", () => {
    const captured = captureQuantity({
      text: "0.001",
      entryUom: "DRUM",
      profile: caseProfile,
    });
    expect(!captured.ok && captured.error.code).toBe("UOM_CONVERSION_INEXACT");
  });

  it("refuses a unit the item does not declare", () => {
    const captured = captureQuantity({
      text: "1",
      entryUom: "PALLET",
      profile: caseProfile,
    });
    expect(!captured.ok && captured.error.code).toBe("UOM_NOT_CONVERTIBLE");
  });

  it("refuses a negative entry unless the caller allows one", () => {
    expect(captureQuantity({ text: "-1", entryUom: "PCS" }).ok).toBe(false);
    expect(
      captureQuantity({ text: "-1", entryUom: "PCS", allowNegative: true }).ok,
    ).toBe(true);
  });

  it("refuses zero unless the caller allows it, because a zero count is a decision", () => {
    expect(captureQuantity({ text: "0", entryUom: "PCS" }).ok).toBe(false);
    expect(
      captureQuantity({ text: "0", entryUom: "PCS", allowZero: true }).ok,
    ).toBe(true);
  });

  it("keeps exact thousandths without float drift", () => {
    const captured = captureQuantity({ text: "0.29", entryUom: "KG" });
    expect(captured.ok && captured.value.entered.minorUnits).toBe(290);
  });
});

describe("plausibility", () => {
  it("passes an entry inside the factor", () => {
    expect(
      judgePlausibility({
        enteredBaseMinorUnits: 100_000,
        expectedBaseMinorUnits: 100_000,
      }),
    ).toEqual({ kind: "PLAUSIBLE" });
  });

  it("passes an entry exactly at the ceiling", () => {
    expect(
      judgePlausibility({
        enteredBaseMinorUnits: 100_000 * PLAUSIBILITY_FACTOR,
        expectedBaseMinorUnits: 100_000,
      }).kind,
    ).toBe("PLAUSIBLE");
  });

  it("flags an entry past the ceiling and reports the factor", () => {
    const verdict = judgePlausibility({
      enteredBaseMinorUnits: 1_000_000,
      expectedBaseMinorUnits: 100_000,
    });
    expect(verdict).toEqual({
      kind: "IMPLAUSIBLE",
      expectedBaseMinorUnits: 100_000,
      enteredBaseMinorUnits: 1_000_000,
      factor: 10,
    });
  });

  it("says unchecked, not plausible, when there is no expectation", () => {
    expect(judgePlausibility({ enteredBaseMinorUnits: 1_000_000 }).kind).toBe(
      "UNCHECKED",
    );
  });

  it("judges a negative entry by magnitude", () => {
    expect(
      judgePlausibility({
        enteredBaseMinorUnits: -1_000_000,
        expectedBaseMinorUnits: 100_000,
      }).kind,
    ).toBe("IMPLAUSIBLE");
  });
});
