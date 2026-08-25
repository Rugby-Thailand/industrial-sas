import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  gs1CheckDigit,
  verifyGs1CheckDigit,
} from "../../convex/model/gs1/checkDigit";
import {
  GROUP_SEPARATOR,
  parseGs1ElementString,
} from "../../convex/model/gs1/elementString";
import {
  checkCharacter,
  decodeBase31,
  encodeBase31,
  generateInternalLpn,
  LPN_ALPHABET,
  LPN_EPOCH_MS,
  LPN_MAX_ELAPSED_MS,
  LPN_MAX_LENGTH,
  makeLpnNamespace,
  parseInternalLpn,
  type EntropySource,
} from "../../convex/model/identifiers/lpn";
import {
  normalizeGtin,
  normalizeLotCode,
  normalizeSku,
} from "../../convex/model/identifiers/normalization";
import { resolveScan } from "../../convex/model/identifiers/scanResolution";
import { expectOk } from "../fixtures/domain-results";

const skuText = fc.stringMatching(/^[0-9A-Za-z._\-/]{1,40}$/);
const lotText = fc.stringMatching(/^[0-9A-Za-z._\-/]{1,20}$/);
const digits = (length: number) =>
  fc.stringMatching(new RegExp(`^[0-9]{${length}}$`));

const namespace = expectOk(makeLpnNamespace("org_acme", "PA"));

const entropyFrom = (bytes: readonly number[]): EntropySource => {
  let offset = 0;
  return (byteLength: number) => {
    const slice = new Uint8Array(byteLength);
    for (let index = 0; index < byteLength; index += 1) {
      slice[index] = bytes[(offset + index) % bytes.length] ?? 0;
    }
    offset += byteLength;
    return slice;
  };
};

describe("normalization stability", () => {
  it("is idempotent for SKUs and lot codes", () => {
    fc.assert(
      fc.property(skuText, (raw) => {
        const once = normalizeSku(raw);
        if (!once.ok) return;
        expect(normalizeSku(once.value)).toEqual(once);
      }),
    );
    fc.assert(
      fc.property(lotText, (raw) => {
        const once = normalizeLotCode(raw);
        if (!once.ok) return;
        expect(normalizeLotCode(once.value)).toEqual(once);
      }),
    );
  });

  it("never changes a code's length and never removes a leading zero", () => {
    fc.assert(
      fc.property(skuText, (raw) => {
        const normalized = normalizeSku(raw);
        if (!normalized.ok) return;
        expect(normalized.value.length).toBe(raw.normalize("NFC").length);
        expect(normalized.value.startsWith("0")).toBe(raw.startsWith("0"));
      }),
    );
  });

  it("keeps codes that differ only by leading zeros distinct", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 1, max: 6 }),
        digits(4),
        (leftZeros, rightZeros, body) => {
          if (leftZeros === rightZeros) return;
          const left = expectOk(normalizeSku("0".repeat(leftZeros) + body));
          const right = expectOk(normalizeSku("0".repeat(rightZeros) + body));
          expect(left).not.toBe(right);
        },
      ),
    );
  });

  it("folds SKU case but preserves lot case", () => {
    fc.assert(
      fc.property(skuText, (raw) => {
        const lower = normalizeSku(raw.toLowerCase());
        const upper = normalizeSku(raw.toUpperCase());
        if (!lower.ok || !upper.ok) return;
        expect(lower.value).toBe(upper.value);
      }),
    );
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z]{1,10}$/), (raw) => {
        const lower = expectOk(normalizeLotCode(raw));
        const upper = expectOk(normalizeLotCode(raw.toUpperCase()));
        expect(lower).not.toBe(upper);
      }),
    );
  });
});

describe("GS1 check digits", () => {
  it("round-trips: a computed digit always verifies", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[0-9]{1,17}$/), (data) => {
        const digit = expectOk(gs1CheckDigit(data));
        expect(verifyGs1CheckDigit(`${data}${digit}`)).toEqual({
          ok: true,
          value: `${data}${digit}`,
        });
      }),
    );
  });

  it("catches every single-digit substitution", () => {
    fc.assert(
      fc.property(
        digits(13),
        fc.nat(),
        fc.integer({ min: 1, max: 9 }),
        (data, position, delta) => {
          const key = `${data}${expectOk(gs1CheckDigit(data))}`;
          const index = position % key.length;
          const original = key.charCodeAt(index) - 48;
          const replacement = (original + delta) % 10;
          const mutated =
            key.slice(0, index) + String(replacement) + key.slice(index + 1);
          expect(verifyGs1CheckDigit(mutated).ok).toBe(false);
        },
      ),
    );
  });
});

describe("GS1 element strings", () => {
  const gtinBody = digits(13).map(
    (body) => `${body}${expectOk(gs1CheckDigit(body))}`,
  );
  const ssccBody = digits(17).map(
    (body) => `${body}${expectOk(gs1CheckDigit(body))}`,
  );
  const lotValue = fc.stringMatching(/^[0-9A-Za-z\-]{1,20}$/);
  const dateValue = fc
    .tuple(
      fc.integer({ min: 0, max: 99 }),
      fc.integer({ min: 1, max: 12 }),
      fc.integer({ min: 1, max: 28 }),
    )
    .map(
      ([year, month, day]) =>
        `${String(year).padStart(2, "0")}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`,
    );

  it("round-trips a GTIN, expiry, and lot label", () => {
    fc.assert(
      fc.property(gtinBody, dateValue, lotValue, (gtin, expiry, lot) => {
        const raw = `01${gtin}17${expiry}10${lot}`;
        const scan = expectOk(
          parseGs1ElementString(raw, { referenceYear: 2026 }),
        );
        expect(scan.gtin14).toBe(gtin);
        expect(scan.expirationDate?.yymmdd).toBe(expiry);
        expect(scan.lot).toBe(lot);
        expect(scan.raw).toBe(raw);
      }),
    );
  });

  it("round-trips an SSCC pallet label, with the lot last or separated", () => {
    fc.assert(
      fc.property(ssccBody, lotValue, fc.boolean(), (sscc, lot, separate) => {
        const raw = separate
          ? `00${sscc}10${lot}${GROUP_SEPARATOR}3012`
          : `00${sscc}10${lot}`;
        const scan = expectOk(
          parseGs1ElementString(raw, { referenceYear: 2026 }),
        );
        expect(scan.sscc18).toBe(sscc);
        expect(scan.lot).toBe(lot);
        expect(scan.variableCount).toBe(separate ? "12" : null);
      }),
    );
  });

  it("rejects every separator position the grammar does not have", () => {
    fc.assert(
      fc.property(gtinBody, lotValue, (gtin, lot) => {
        for (const raw of [
          `${GROUP_SEPARATOR}01${gtin}`,
          `01${gtin}${GROUP_SEPARATOR}10${lot}`,
          `10${lot}${GROUP_SEPARATOR}${GROUP_SEPARATOR}01${gtin}`,
          `10${lot}${GROUP_SEPARATOR}`,
        ]) {
          const parsed = parseGs1ElementString(raw, { referenceYear: 2026 });
          expect(parsed.ok).toBe(false);
          if (!parsed.ok) {
            expect(parsed.error.code).toBe("UNEXPECTED_SEPARATOR");
          }
        }
      }),
    );
  });

  it("rejects a GTIN whose check digit was mutated", () => {
    fc.assert(
      fc.property(gtinBody, fc.integer({ min: 1, max: 9 }), (gtin, delta) => {
        const digit = (Number(gtin.slice(-1)) + delta) % 10;
        const raw = `01${gtin.slice(0, -1)}${digit}`;
        const parsed = parseGs1ElementString(raw, { referenceYear: 2026 });
        expect(parsed.ok).toBe(false);
        if (!parsed.ok) expect(parsed.error.code).toBe("INVALID_CHECK_DIGIT");
      }),
    );
  });
});

describe("LPN generation and validation", () => {
  const bytes = fc.array(fc.integer({ min: 0, max: 254 }), {
    minLength: 3,
    maxLength: 12,
  });
  const clock = fc.integer({
    min: LPN_EPOCH_MS,
    max: LPN_EPOCH_MS + LPN_MAX_ELAPSED_MS,
  });

  it("always issues a value that validates, is bounded, and is not all digits", () => {
    fc.assert(
      fc.property(clock, bytes, (nowMs, entropyBytes) => {
        const issued = generateInternalLpn({
          namespace,
          nowMs,
          entropy: entropyFrom(entropyBytes),
        });
        if (!issued.ok) {
          expect(issued.error.code).toBe("ENTROPY_EXHAUSTED");
          return;
        }
        expect(issued.value.value.length).toBeLessThanOrEqual(LPN_MAX_LENGTH);
        expect(/^[0-9]+$/.test(issued.value.value)).toBe(false);
        expect(parseInternalLpn(issued.value.value, { namespace })).toEqual({
          ok: true,
          value: issued.value,
        });
        expect(issued.value.issuedAtMs).toBe(nowMs);
      }),
    );
  });

  it("resolves as an LPN through the scan ladder, never as a SKU", () => {
    fc.assert(
      fc.property(clock, bytes, (nowMs, entropyBytes) => {
        const issued = generateInternalLpn({
          namespace,
          nowMs,
          entropy: entropyFrom(entropyBytes),
        });
        if (!issued.ok) return;
        const resolved = resolveScan(issued.value.value, {
          referenceYear: 2026,
          namespaces: [namespace],
        });
        expect(expectOk(resolved).interpretation.kind).toBe("INTERNAL_LPN");
      }),
    );
  });

  it("catches every single-character substitution", () => {
    fc.assert(
      fc.property(
        clock,
        bytes,
        fc.nat(),
        fc.integer({ min: 1, max: 30 }),
        (nowMs, entropyBytes, position, delta) => {
          const issued = generateInternalLpn({
            namespace,
            nowMs,
            entropy: entropyFrom(entropyBytes),
          });
          if (!issued.ok) return;
          const value = issued.value.value;
          const index = position % value.length;
          const replacement = LPN_ALPHABET[
            (LPN_ALPHABET.indexOf(value[index] as string) + delta) % 31
          ] as string;
          const mutated =
            value.slice(0, index) + replacement + value.slice(index + 1);
          expect(parseInternalLpn(mutated).ok).toBe(false);
        },
      ),
    );
  });

  it("catches every transposition of two different characters", () => {
    fc.assert(
      fc.property(
        clock,
        bytes,
        fc.nat(),
        fc.nat(),
        (nowMs, entropyBytes, left, right) => {
          const issued = generateInternalLpn({
            namespace,
            nowMs,
            entropy: entropyFrom(entropyBytes),
          });
          if (!issued.ok) return;
          const value = issued.value.value;
          const first = left % value.length;
          const second = right % value.length;
          if (first === second) return;
          const [low, high] =
            first < second ? [first, second] : [second, first];
          if (value[low] === value[high]) return;
          const mutated =
            value.slice(0, low) +
            (value[high] as string) +
            value.slice(low + 1, high) +
            (value[low] as string) +
            value.slice(high + 1);
          expect(parseInternalLpn(mutated).ok).toBe(false);
        },
      ),
    );
  });

  it("round-trips base-31 encoding at the declared width", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: LPN_MAX_ELAPSED_MS }), (value) => {
        const encoded = encodeBase31(value, 9);
        expect(encoded).not.toBeNull();
        if (encoded === null) return;
        expect(encoded).toHaveLength(9);
        expect(decodeBase31(encoded)).toBe(value);
      }),
    );
  });
});

describe("negative controls", () => {
  it("the substitution property fails for a check character that ignores values", () => {
    const constantCheck = () => LPN_ALPHABET[0] as string;
    const validates = (value: string): boolean =>
      value.slice(-1) === constantCheck();

    const details = fc.check(
      fc.property(
        fc.stringMatching(/^[0-9ABCDEFGHJKMNPQRSTVWXY]{14}$/),
        fc.integer({ min: 1, max: 30 }),
        (body, delta) => {
          const value = body + constantCheck();
          const replacement = LPN_ALPHABET[
            (LPN_ALPHABET.indexOf(value[0] as string) + delta) % 31
          ] as string;
          expect(validates(replacement + value.slice(1))).toBe(false);
        },
      ),
    );
    expect(details.failed).toBe(true);
  });

  it("the transposition property fails for an unweighted checksum", () => {
    const unweighted = (body: string): string => {
      let sum = 0;
      for (const character of body) sum += LPN_ALPHABET.indexOf(character);
      return LPN_ALPHABET[sum % 31] as string;
    };

    // The first two characters are fixed and different, so every generated case
    // is a transposition an unweighted sum cannot see.
    const details = fc.check(
      fc.property(
        fc.stringMatching(/^[0-9ABCDEFGHJKMNPQRSTVWXY]{12}$/),
        (tail) => {
          expect(unweighted(`10${tail}`)).not.toBe(unweighted(`01${tail}`));
        },
      ),
    );
    expect(details.failed).toBe(true);

    fc.assert(
      fc.property(
        fc.stringMatching(/^[0-9ABCDEFGHJKMNPQRSTVWXY]{12}$/),
        (tail) => {
          expect(checkCharacter(`10${tail}`)).not.toBe(
            checkCharacter(`01${tail}`),
          );
        },
      ),
    );
  });

  it("the normalization property fails for a trimming normalizer", () => {
    const trimZeros = (raw: string): string => raw.replace(/^0+/, "");

    const details = fc.check(
      fc.property(fc.integer({ min: 1, max: 4 }), digits(4), (zeros, body) => {
        expect(trimZeros("0".repeat(zeros) + body)).not.toBe(trimZeros(body));
      }),
    );
    expect(details.failed).toBe(true);
  });

  it("the GTIN property fails when the check digit is not verified", () => {
    const unverifiedGtin = (raw: string): string => raw.padStart(14, "0");

    const details = fc.check(
      fc.property(digits(12), fc.integer({ min: 1, max: 9 }), (body, delta) => {
        const valid = `${body}${expectOk(gs1CheckDigit(body))}`;
        const broken = `${valid.slice(0, -1)}${(Number(valid.slice(-1)) + delta) % 10}`;
        // The claim the real normalizer keeps: whatever comes out has a valid
        // check digit. The padding mutation cannot keep it.
        expect(verifyGs1CheckDigit(unverifiedGtin(broken)).ok).toBe(true);
      }),
    );
    expect(details.failed).toBe(true);

    const valid = `${"061414100000".slice(0, 12)}`;
    const digit = expectOk(gs1CheckDigit(valid));
    expect(normalizeGtin(`${valid}${(digit + 1) % 10}`).ok).toBe(false);
  });
});
