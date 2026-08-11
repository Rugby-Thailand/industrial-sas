import { describe, expect, it } from "vitest";

import { convertToBase } from "../uom/itemUom";
import {
  MAX_LABEL_BODY_LENGTH,
  nextTemplateVersion,
  profileFromRows,
  validateAlternateConversion,
  validateBarcodeAlias,
  validateLabelBody,
} from "./catalogueRules";

describe("validateAlternateConversion", () => {
  it("stores a reduced ratio, so two spellings of one factor agree", () => {
    // `24/2` and `12/1` are the same factor. Storing both forms would make an
    // equality check on a conversion table a comparison of spellings.
    const twelve = validateAlternateConversion({
      uom: "case",
      baseUom: "EA",
      toBaseNumerator: 24,
      toBaseDenominator: 2,
    });

    expect(twelve.ok).toBe(true);
    if (!twelve.ok) return;
    expect(twelve.value.toBaseNumerator).toBe(12);
    expect(twelve.value.toBaseDenominator).toBe(1);
    // The UOM code is normalized upper-case, like every other code.
    expect(twelve.value.uom).toBe("CASE");
  });

  it("keeps a factor that no float represents", () => {
    // A drum decanted into three is `1/3`; the whole reason the schema stores
    // two integers rather than a number.
    const third = validateAlternateConversion({
      uom: "THIRD",
      baseUom: "L",
      toBaseNumerator: 1,
      toBaseDenominator: 3,
    });

    expect(third.ok && third.value.toBaseNumerator).toBe(1);
    expect(third.ok && third.value.toBaseDenominator).toBe(3);
  });

  it("refuses the base UOM as its own alternate", () => {
    // At create time there is no profile yet, so discovering the clash only when
    // the table is rebuilt would mean storing a row that can never be read back.
    const clash = validateAlternateConversion({
      uom: "ea",
      baseUom: "EA",
      toBaseNumerator: 1,
      toBaseDenominator: 1,
    });

    expect(clash.ok).toBe(false);
    expect(!clash.ok && clash.error.code).toBe("BASE_UOM_AS_ALTERNATE");
  });

  it.each([
    ["a negative numerator", -12, 1],
    ["a zero numerator", 0, 1],
    ["a zero denominator", 12, 0],
    ["a negative denominator", 12, -1],
    ["a fractional numerator", 1.5, 1],
  ])("refuses %s", (_label, numerator, denominator) => {
    /*
     * `makeRatio` normalizes sign, so `-12/-1` would reduce to `12/1` and be
     * accepted. A caller that sent a negative numerator meant something, and
     * silently agreeing with the wrong reading is worse than refusing.
     */
    const result = validateAlternateConversion({
      uom: "CASE",
      baseUom: "EA",
      toBaseNumerator: numerator,
      toBaseDenominator: denominator,
    });
    expect(result.ok).toBe(false);
  });

  it("refuses a UOM code that is not one, naming the field", () => {
    const bad = validateAlternateConversion({
      uom: "has space",
      baseUom: "EA",
      toBaseNumerator: 1,
      toBaseDenominator: 1,
    });

    expect(!bad.ok && bad.error.code).toBe("UOM_CODE_INVALID");
    expect(!bad.ok && "field" in bad.error && bad.error.field).toBe("uom");
  });

  it("never echoes the value it refused", () => {
    const secret = "SUPPLIER-SECRET-CODE";
    const bad = validateAlternateConversion({
      uom: `${secret} x`,
      baseUom: "EA",
      toBaseNumerator: 1,
      toBaseDenominator: 1,
    });
    expect(JSON.stringify(bad)).not.toContain(secret);
  });
});

describe("profileFromRows", () => {
  it("rebuilds a profile the conversion kernel accepts", () => {
    const profile = profileFromRows({
      itemKey: "WIDGET-001",
      baseUom: "EA",
      rows: [
        { uom: "CASE", toBaseNumerator: 12, toBaseDenominator: 1 },
        { uom: "PALLET", toBaseNumerator: 960, toBaseDenominator: 1 },
      ],
    });

    expect(profile.ok).toBe(true);
    if (!profile.ok) return;

    // Converting through the kernel, not through anything in this module: the
    // arithmetic has exactly one implementation.
    const outcome = convertToBase(profile.value, "CASE", 2_000);
    expect(outcome.kind).toBe("EXACT");
    if (outcome.kind !== "EXACT") return;
    // Two cases of twelve = 24 each = 24000 thousandths.
    expect(outcome.quantity.minorUnits).toBe(24_000);
  });

  it("refuses a duplicate unit, because the kernel does", () => {
    const profile = profileFromRows({
      itemKey: "WIDGET-001",
      baseUom: "EA",
      rows: [
        { uom: "CASE", toBaseNumerator: 12, toBaseDenominator: 1 },
        { uom: "CASE", toBaseNumerator: 24, toBaseDenominator: 1 },
      ],
    });

    expect(profile.ok).toBe(false);
    expect(!profile.ok && profile.error.code).toBe("PROFILE_INVALID");
    expect(
      !profile.ok && "reason" in profile.error && profile.error.reason,
    ).toBe("DUPLICATE_UOM");
  });

  it("refuses a stored row whose ratio is not one", () => {
    // A document is whatever was written into it; `{denominator: 0}` compiles.
    const profile = profileFromRows({
      itemKey: "WIDGET-001",
      baseUom: "EA",
      rows: [{ uom: "CASE", toBaseNumerator: 1, toBaseDenominator: 0 }],
    });

    expect(!profile.ok && profile.error.code).toBe("CONVERSION_NOT_EXACT");
  });

  it("builds a profile with no alternates at all", () => {
    const profile = profileFromRows({
      itemKey: "BULK-001",
      baseUom: "KG",
      rows: [],
    });
    expect(profile.ok && profile.value.alternates).toEqual([]);
  });
});

describe("validateBarcodeAlias", () => {
  it("verifies a GTIN's check digit and pads it to fourteen digits", () => {
    /*
     * The rule that matters. A row claiming `GTIN` for a value whose check digit
     * fails is a row the scan resolver would never produce, so the catalogue
     * would hold an alias no scan can ever match — a dead entry an operator
     * would blame the scanner for.
     */
    const valid = validateBarcodeAlias({
      barcode: "0614141000036",
      kind: "GTIN",
    });

    expect(valid.ok).toBe(true);
    expect(valid.ok && valid.value.barcode).toHaveLength(14);
    expect(valid.ok && valid.value.barcode.endsWith("0614141000036")).toBe(
      true,
    );
  });

  it("refuses a GTIN whose check digit is wrong", () => {
    const wrong = validateBarcodeAlias({
      barcode: "0614141000037",
      kind: "GTIN",
    });

    expect(wrong.ok).toBe(false);
    expect(!wrong.ok && wrong.error.code).toBe("BARCODE_KIND_MISMATCH");
  });

  it("does not judge the other kinds beyond readability", () => {
    // An SSCC's check digit is the resolver's business, an internal LPN's check
    // character is the LPN kernel's, and a supplier's code is the supplier's.
    for (const kind of ["SSCC", "INTERNAL", "SUPPLIER"] as const) {
      const result = validateBarcodeAlias({ barcode: "ABC-123", kind });
      expect(result.ok, kind).toBe(true);
      expect(result.ok && result.value.kind).toBe(kind);
    }
  });

  it("keeps leading zeros, which are part of the value", () => {
    const result = validateBarcodeAlias({
      barcode: "0001234",
      kind: "SUPPLIER",
    });
    expect(result.ok && result.value.barcode).toBe("0001234");
  });

  it("refuses an unreadable scan", () => {
    for (const raw of ["", "   "]) {
      const result = validateBarcodeAlias({ barcode: raw, kind: "SUPPLIER" });
      expect(result.ok, raw).toBe(false);
      expect(!result.ok && result.error.code).toBe("BARCODE_UNREADABLE");
    }
  });
});

describe("validateLabelBody", () => {
  it("accepts a plausible ZPL payload with its newlines", () => {
    const body = "^XA\n^FO50,50^A0N,40,40^FDSTEEL-COIL^FS\n^XZ";
    expect(validateLabelBody(body)).toEqual({ ok: true, value: body });
  });

  it("refuses an empty or whitespace-only body", () => {
    for (const body of ["", "   ", "\n\n"]) {
      expect(validateLabelBody(body).ok, JSON.stringify(body)).toBe(false);
    }
  });

  it("bounds the stored length", () => {
    const long = "^".repeat(MAX_LABEL_BODY_LENGTH + 1);
    expect(validateLabelBody(long).ok).toBe(false);
  });

  it("refuses control characters that are not tab or newline", () => {
    expect(validateLabelBody("^XA ^XZ").ok).toBe(false);
    expect(validateLabelBody("^XA^XZ").ok).toBe(false);
    expect(validateLabelBody("^XA\t^XZ").ok).toBe(true);
  });

  it("does not parse, render, or validate the payload as a printer would", () => {
    /*
     * Deliberately shallow. This repository has no printer transport (`INT-04`)
     * and no physical print evidence (`RG-004`); a validator that accepted only
     * "real" ZPL would imply a verification nobody has performed.
     */
    expect(validateLabelBody("not zpl at all, just prose").ok).toBe(true);
  });
});

describe("nextTemplateVersion", () => {
  it("starts at one for a new code", () => {
    expect(nextTemplateVersion([])).toEqual({ ok: true, value: 1 });
  });

  it("is one above the highest, whatever order it is given", () => {
    expect(nextTemplateVersion([3, 1, 2])).toEqual({ ok: true, value: 4 });
    expect(nextTemplateVersion([2, 3, 1])).toEqual({ ok: true, value: 4 });
  });

  it("refuses a stored version that is not a positive integer", () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(nextTemplateVersion([1, bad]).ok, String(bad)).toBe(false);
    }
  });
});
