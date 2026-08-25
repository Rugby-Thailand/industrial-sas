import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { convertToBase } from "../../convex/model/uom/itemUom";
import { makeRatio } from "../../convex/model/uom/ratio";
import {
  nextTemplateVersion,
  profileFromRows,
  validateAlternateConversion,
  validateBarcodeAlias,
  validateLabelBody,
  MAX_LABEL_BODY_LENGTH,
} from "../../convex/model/masterData/catalogueRules";

describe("alternate conversions", () => {
  it("stores a reduced factor, so equal factors store identically", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5_000 }),
        fc.integer({ min: 1, max: 5_000 }),
        fc.integer({ min: 2, max: 50 }),
        (numerator, denominator, scale) => {
          const plain = validateAlternateConversion({
            uom: "CASE",
            baseUom: "EA",
            toBaseNumerator: numerator,
            toBaseDenominator: denominator,
          });
          const scaled = validateAlternateConversion({
            uom: "CASE",
            baseUom: "EA",
            toBaseNumerator: numerator * scale,
            toBaseDenominator: denominator * scale,
          });

          expect(plain.ok && scaled.ok).toBe(true);
          if (!plain.ok || !scaled.ok) return;
          expect(scaled.value.toBaseNumerator).toBe(
            plain.value.toBaseNumerator,
          );
          expect(scaled.value.toBaseDenominator).toBe(
            plain.value.toBaseDenominator,
          );
        },
      ),
      { seed: 20260811, numRuns: 250 },
    );
  });

  it("never stores a non-positive or non-integer factor", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ min: -1_000, max: 0 }),
          fc
            .double({ min: 0.1, max: 10, noNaN: true })
            .filter((value) => !Number.isInteger(value)),
        ),
        (bad) => {
          const result = validateAlternateConversion({
            uom: "CASE",
            baseUom: "EA",
            toBaseNumerator: bad,
            toBaseDenominator: 1,
          });
          expect(result.ok).toBe(false);
        },
      ),
      { seed: 20260811, numRuns: 200 },
    );
  });

  it("refuses the base unit however it is spelled", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Za-z]{1,6}$/),
        fc.stringMatching(/^[ \t]{0,3}$/),
        (base, padding) => {
          const result = validateAlternateConversion({
            uom: `${padding}${base.toLowerCase()}${padding}`,
            baseUom: base.toUpperCase(),
            toBaseNumerator: 1,
            toBaseDenominator: 1,
          });
          expect(result.ok).toBe(false);
        },
      ),
      { seed: 20260811, numRuns: 200 },
    );
  });

  it("round-trips a stored factor through the conversion kernel", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 500 }),
        fc.integer({ min: 1, max: 20 }),
        (factor, count) => {
          const stored = validateAlternateConversion({
            uom: "CASE",
            baseUom: "EA",
            toBaseNumerator: factor,
            toBaseDenominator: 1,
          });
          expect(stored.ok).toBe(true);
          if (!stored.ok) return;

          const profile = profileFromRows({
            itemKey: "ITEM-1",
            baseUom: "EA",
            rows: [stored.value],
          });
          expect(profile.ok).toBe(true);
          if (!profile.ok) return;

          const outcome = convertToBase(profile.value, "CASE", count * 1_000);
          expect(outcome.kind).toBe("EXACT");
          if (outcome.kind !== "EXACT") return;
          expect(outcome.quantity.minorUnits).toBe(count * factor * 1_000);
        },
      ),
      { seed: 20260811, numRuns: 250 },
    );
  });

  it("builds a profile from any set of distinct units", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.stringMatching(/^[A-Z]{2,6}$/), {
          minLength: 1,
          maxLength: 6,
        }),
        (uoms) => {
          fc.pre(!uoms.includes("EA"));

          const rows = uoms.map((uom, index) => ({
            uom,
            toBaseNumerator: index + 1,
            toBaseDenominator: 1,
          }));
          const profile = profileFromRows({
            itemKey: "ITEM-1",
            baseUom: "EA",
            rows,
          });

          expect(profile.ok).toBe(true);
          expect(profile.ok && profile.value.alternates).toHaveLength(
            uoms.length,
          );
        },
      ),
      { seed: 20260811, numRuns: 200 },
    );
  });

  it("refuses any set containing a repeated unit", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[A-Z]{2,6}$/), (uom) => {
        fc.pre(uom !== "EA");
        const profile = profileFromRows({
          itemKey: "ITEM-1",
          baseUom: "EA",
          rows: [
            { uom, toBaseNumerator: 1, toBaseDenominator: 1 },
            { uom, toBaseNumerator: 2, toBaseDenominator: 1 },
          ],
        });
        expect(profile.ok).toBe(false);
      }),
      { seed: 20260811, numRuns: 150 },
    );
  });
});

describe("barcode aliases", () => {
  it("accepts every GTIN it can build a valid check digit for", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 9 }), {
          minLength: 13,
          maxLength: 13,
        }),
        (digits) => {
          const weighted = digits.reduce(
            (sum, digit, index) => sum + digit * (index % 2 === 0 ? 3 : 1),
            0,
          );
          const check = (10 - (weighted % 10)) % 10;
          const gtin = `${digits.join("")}${check}`;

          const result = validateBarcodeAlias({
            barcode: gtin,
            kind: "GTIN",
          });
          expect(result.ok, gtin).toBe(true);
          expect(result.ok && result.value.barcode).toHaveLength(14);
        },
      ),
      { seed: 20260811, numRuns: 200 },
    );
  });

  it("refuses a fourteen-digit value whose check digit is wrong", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 9 }), {
          minLength: 13,
          maxLength: 13,
        }),
        fc.integer({ min: 1, max: 9 }),
        (digits, offset) => {
          const weighted = digits.reduce(
            (sum, digit, index) => sum + digit * (index % 2 === 0 ? 3 : 1),
            0,
          );
          const correct = (10 - (weighted % 10)) % 10;
          const wrong = (correct + offset) % 10;

          const result = validateBarcodeAlias({
            barcode: `${digits.join("")}${wrong}`,
            kind: "GTIN",
          });
          expect(result.ok).toBe(false);
        },
      ),
      { seed: 20260811, numRuns: 200 },
    );
  });

  it("never answers a blank or whitespace-only alias", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[ \t]{0,10}$/),
        fc.constantFrom(
          "SSCC" as const,
          "INTERNAL" as const,
          "SUPPLIER" as const,
        ),
        (blank, kind) => {
          expect(validateBarcodeAlias({ barcode: blank, kind }).ok).toBe(false);
        },
      ),
      { seed: 20260811, numRuns: 150 },
    );
  });

  it("preserves the exact value for non-GTIN kinds", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9-]{0,30}$/),
        fc.constantFrom(
          "SSCC" as const,
          "INTERNAL" as const,
          "SUPPLIER" as const,
        ),
        (raw, kind) => {
          const result = validateBarcodeAlias({ barcode: raw, kind });
          expect(result.ok && result.value.barcode).toBe(raw);
          expect(result.ok && result.value.kind).toBe(kind);
        },
      ),
      { seed: 20260811, numRuns: 200 },
    );
  });
});

describe("label bodies and versions", () => {
  it("accepts any bounded printable body and returns it trimmed", () => {
    fc.assert(
      fc.property(
        fc
          .stringMatching(/^[\x20-\x7E\t\n]{1,200}$/)
          .filter((body) => body.trim().length > 0),
        (body) => {
          const result = validateLabelBody(body);
          expect(result.ok).toBe(true);
          expect(result.ok && result.value).toBe(body.trim());
        },
      ),
      { seed: 20260811, numRuns: 250 },
    );
  });

  it("refuses any body carrying a forbidden control character", () => {
    fc.assert(
      fc.property(
        fc
          .integer({ min: 0, max: 31 })
          .filter((code) => code !== 9 && code !== 10 && code !== 13),
        (code) => {
          const body = `^XA${String.fromCharCode(code)}^XZ`;
          expect(validateLabelBody(body).ok).toBe(false);
        },
      ),
      { seed: 20260811, numRuns: 100 },
    );
  });

  it("bounds the stored body length", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 200 }), (extra) => {
        const long = "^".repeat(MAX_LABEL_BODY_LENGTH + extra);
        expect(validateLabelBody(long).ok).toBe(false);
      }),
      { seed: 20260811, numRuns: 50 },
    );
  });

  it("is always one above the highest existing version", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: 500 }), { maxLength: 30 }),
        (versions) => {
          const next = nextTemplateVersion(versions);
          expect(next.ok).toBe(true);
          if (!next.ok) return;

          expect(next.value).toBe(Math.max(0, ...versions) + 1);

          expect(versions.includes(next.value)).toBe(false);
        },
      ),
      { seed: 20260811, numRuns: 250 },
    );
  });
});

describe("ratio reduction, as the store relies on it", () => {
  it("agrees with the kernel that reduced factors compare equal", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000 }),
        fc.integer({ min: 1, max: 1_000 }),
        (numerator, denominator) => {
          const stored = validateAlternateConversion({
            uom: "CASE",
            baseUom: "EA",
            toBaseNumerator: numerator,
            toBaseDenominator: denominator,
          });
          const kernel = makeRatio(numerator, denominator);

          expect(stored.ok && kernel.ok).toBe(true);
          if (!stored.ok || !kernel.ok) return;
          expect(stored.value.toBaseNumerator).toBe(kernel.value.numerator);
          expect(stored.value.toBaseDenominator).toBe(kernel.value.denominator);
        },
      ),
      { seed: 20260811, numRuns: 250 },
    );
  });
});
