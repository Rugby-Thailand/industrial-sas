/**
 * Unit tier — LPN generation and validation.
 *
 * Generation is deterministic here because both non-deterministic inputs are
 * arguments: a fixed clock reading and a fixed byte source. That is what lets the
 * suite assert an exact printed value, and it is the same property a Convex
 * mutation needs in order to be replayable.
 */
import { describe, expect, it } from "vitest";

import { expectError, expectOk } from "../../../tests/fixtures/domain-results";
import {
  checkCharacter,
  decodeBase31,
  encodeBase31,
  generateInternalLpn,
  looksLikeInternalLpn,
  LPN_ALPHABET,
  LPN_EPOCH_MS,
  LPN_MAX_ELAPSED_MS,
  LPN_MAX_LENGTH,
  LPN_MIN_LENGTH,
  lpnFromSscc,
  makeLpnNamespace,
  MAX_ORGANIZATION_KEY_LENGTH,
  parseInternalLpn,
  type EntropySource,
} from "./lpn";

const namespace = expectOk(makeLpnNamespace("org_acme", "PA"));
const other = expectOk(makeLpnNamespace("org_rival", "XQ"));

/** A byte source that always returns the same bytes: deterministic by design. */
const fixedEntropy =
  (...bytes: readonly number[]): EntropySource =>
  (byteLength: number) =>
    new Uint8Array(
      Array.from({ length: byteLength }, (_unused, index) => bytes[index] ?? 0),
    );

const nowMs = LPN_EPOCH_MS + 123_456_789;

describe("LPN_ALPHABET", () => {
  it("has 31 unambiguous symbols and a prime size", () => {
    expect(LPN_ALPHABET.length).toBe(31);
    expect(new Set(LPN_ALPHABET).size).toBe(31);
    for (const excluded of ["I", "L", "O", "U", "Z"]) {
      expect(LPN_ALPHABET.includes(excluded)).toBe(false);
    }
  });
});

describe("makeLpnNamespace", () => {
  it("folds case and accepts alphabet characters after a letter", () => {
    expect(makeLpnNamespace("org_acme", "pa")).toEqual({
      ok: true,
      value: { organizationKey: "org_acme", prefix: "PA" },
    });
    expect(expectOk(makeLpnNamespace("org_acme", "PA01")).prefix).toBe("PA01");
  });

  it("rejects a numeric-leading, over-long, or ambiguous prefix", () => {
    for (const prefix of ["", "1PA", "PAPAPAP", "PAI", "PA-1", "PAO"]) {
      expect(expectError(makeLpnNamespace("org_acme", prefix)).code).toBe(
        "INVALID_PREFIX",
      );
    }
  });

  it("rejects an empty organization key", () => {
    expect(expectError(makeLpnNamespace("  ", "PA")).code).toBe(
      "INVALID_ORGANIZATION_KEY",
    );
  });

  // The key was only trimmed and length-checked, so anything in between survived.
  // It identifies a tenant, and a key carrying a zero-width joiner or an internal
  // space is a second key for the same organization — which is how one tenant's
  // prefix ends up registered twice under names an operator cannot tell apart.
  it("rejects a key that is not a bounded whitespace-free identifier", () => {
    const rejected = [
      "",
      "  ",
      "org acme",
      "org\tacme",
      "org\nacme",
      "org\u00a0acme",
      "org\u0000acme",
      "org\u200dacme",
      "org\u202eacme",
      "org\ufeffacme",
      "org\u2028acme",
      "a".repeat(MAX_ORGANIZATION_KEY_LENGTH + 1),
    ];
    for (const organizationKey of rejected) {
      expect(expectError(makeLpnNamespace(organizationKey, "PA")).code).toBe(
        "INVALID_ORGANIZATION_KEY",
      );
    }
  });

  it("still accepts the keys a tenant really has, and trims the ends", () => {
    for (const organizationKey of [
      "org_acme",
      "org-acme-2",
      "k57a9v3m2q8x1n4p6r0t5w7y",
      "บริษัท",
      "a".repeat(MAX_ORGANIZATION_KEY_LENGTH),
    ]) {
      expect(
        expectOk(makeLpnNamespace(organizationKey, "PA")).organizationKey,
      ).toBe(organizationKey);
    }
    expect(expectOk(makeLpnNamespace(" org_acme ", "PA")).organizationKey).toBe(
      "org_acme",
    );
    // Every kind of whitespace is trimmed from the ends, not just a space. What
    // is refused is whitespace *inside* the key, which is where two keys start
    // looking like one.
    expect(
      expectOk(makeLpnNamespace("\u2028org_acme\u00a0", "PA")).organizationKey,
    ).toBe("org_acme");
  });

  it("keeps the case of an organization key, because it may be a document id", () => {
    expect(expectOk(makeLpnNamespace("Org_Acme", "PA")).organizationKey).toBe(
      "Org_Acme",
    );
  });

  it("rejects an organization key that is not a string", () => {
    for (const organizationKey of [null, undefined, 42, {}, []]) {
      expect(
        expectError(
          makeLpnNamespace(organizationKey as unknown as string, "PA"),
        ).code,
      ).toBe("INVALID_ORGANIZATION_KEY");
    }
  });
});

describe("generateInternalLpn", () => {
  it("is deterministic for a given clock and entropy", () => {
    const first = expectOk(
      generateInternalLpn({ namespace, nowMs, entropy: fixedEntropy(1, 2, 3) }),
    );
    const second = expectOk(
      generateInternalLpn({ namespace, nowMs, entropy: fixedEntropy(1, 2, 3) }),
    );
    expect(first.value).toBe(second.value);
    expect(first).toEqual({
      kind: "INTERNAL",
      value: first.value,
      prefix: "PA",
      issuedAtMs: nowMs,
    });
  });

  it("produces a value of the documented shape and length", () => {
    const lpn = expectOk(
      generateInternalLpn({ namespace, nowMs, entropy: fixedEntropy(1, 2, 3) }),
    );
    expect(lpn.value).toHaveLength(2 + 9 + 4 + 1);
    expect(lpn.value.startsWith("PA")).toBe(true);
    expect(lpn.value.length).toBeLessThanOrEqual(LPN_MAX_LENGTH);
    expect(lpn.value.length).toBeGreaterThanOrEqual(LPN_MIN_LENGTH);
    // The time component decodes back to the issuing instant.
    expect(decodeBase31(lpn.value.slice(2, 11))).toBe(nowMs - LPN_EPOCH_MS);
  });

  it("round-trips through the validator", () => {
    const lpn = expectOk(
      generateInternalLpn({ namespace, nowMs, entropy: fixedEntropy(9, 9, 9) }),
    );
    expect(parseInternalLpn(lpn.value, { namespace })).toEqual({
      ok: true,
      value: lpn,
    });
  });

  it("is never all digits, so it cannot be read as a GS1 key", () => {
    for (let offset = 0; offset < 32; offset += 1) {
      const lpn = expectOk(
        generateInternalLpn({
          namespace,
          nowMs: nowMs + offset * 7919,
          entropy: fixedEntropy(offset, offset + 1, offset + 2),
        }),
      );
      expect(/^[0-9]+$/.test(lpn.value)).toBe(false);
    }
  });

  it("sorts in issue order for one namespace", () => {
    const values = [0, 1, 1000, 1_000_000].map(
      (offset) =>
        expectOk(
          generateInternalLpn({
            namespace,
            nowMs: nowMs + offset,
            entropy: fixedEntropy(0, 0, 0),
          }),
        ).value,
    );
    expect([...values].sort()).toEqual(values);
  });

  it("rejects a clock outside the representable window", () => {
    expect(
      expectError(
        generateInternalLpn({
          namespace,
          nowMs: LPN_EPOCH_MS - 1,
          entropy: fixedEntropy(1),
        }),
      ).code,
    ).toBe("CLOCK_OUT_OF_RANGE");
    expect(
      expectError(
        generateInternalLpn({
          namespace,
          nowMs: LPN_EPOCH_MS + LPN_MAX_ELAPSED_MS + 1,
          entropy: fixedEntropy(1),
        }),
      ).code,
    ).toBe("CLOCK_OUT_OF_RANGE");
    expect(
      expectError(
        generateInternalLpn({
          namespace,
          nowMs: nowMs + 0.5,
          entropy: fixedEntropy(1),
        }),
      ).code,
    ).toBe("CLOCK_NOT_AN_INTEGER");
  });

  it("fails closed when the entropy source misbehaves", () => {
    expect(
      expectError(
        generateInternalLpn({
          namespace,
          nowMs,
          entropy: () => new Uint8Array(0),
        }),
      ).code,
    ).toBe("ENTROPY_UNAVAILABLE");
    // Three 0xff bytes are always in the rejected tail, so sampling never
    // succeeds and the loop gives up instead of folding a biased value in.
    expect(
      expectError(
        generateInternalLpn({
          namespace,
          nowMs,
          entropy: fixedEntropy(255, 255, 255),
        }),
      ).code,
    ).toBe("ENTROPY_EXHAUSTED");
  });
});

describe("parseInternalLpn", () => {
  const lpn = expectOk(
    generateInternalLpn({ namespace, nowMs, entropy: fixedEntropy(4, 5, 6) }),
  );

  it("accepts the value it issued, case-insensitively and trimmed", () => {
    expect(parseInternalLpn(` ${lpn.value.toLowerCase()} `).ok).toBe(true);
  });

  it("catches a single-character substitution", () => {
    for (let index = 0; index < lpn.value.length; index += 1) {
      const original = lpn.value[index] as string;
      const replacement = LPN_ALPHABET[
        (LPN_ALPHABET.indexOf(original) + 1) % 31
      ] as string;
      const mutated =
        lpn.value.slice(0, index) + replacement + lpn.value.slice(index + 1);
      expect(parseInternalLpn(mutated).ok).toBe(false);
    }
  });

  it("catches a transposition of two adjacent unequal characters", () => {
    let transpositionsTested = 0;
    for (let index = 0; index + 1 < lpn.value.length; index += 1) {
      const left = lpn.value[index] as string;
      const right = lpn.value[index + 1] as string;
      if (left === right) continue;
      transpositionsTested += 1;
      const mutated =
        lpn.value.slice(0, index) + right + left + lpn.value.slice(index + 2);
      expect(parseInternalLpn(mutated).ok).toBe(false);
    }
    expect(transpositionsTested).toBeGreaterThan(0);
  });

  it("rejects a foreign namespace before any lookup", () => {
    expect(parseInternalLpn(lpn.value, { namespace: other })).toEqual({
      ok: false,
      error: {
        code: "PREFIX_NOT_REGISTERED",
        raw: lpn.value,
        expected: "XQ",
        actual: "PA",
      },
    });
  });

  it("rejects the wrong length, an ambiguous character, and a numeric prefix", () => {
    expect(expectError(parseInternalLpn(lpn.value.slice(2))).code).toBe(
      "INVALID_LENGTH",
    );
    // A one-character deletion still has a legal length for a shorter prefix, so
    // it is the check character that refuses it.
    expect(expectError(parseInternalLpn(lpn.value.slice(1))).code).toBe(
      "CHECK_CHARACTER_MISMATCH",
    );
    expect(
      expectError(parseInternalLpn(`${lpn.value}${LPN_ALPHABET[0]}`)).code,
    ).toBe("CHECK_CHARACTER_MISMATCH");
    expect(expectError(parseInternalLpn(`PAO${lpn.value.slice(3)}`)).code).toBe(
      "INVALID_CHARACTER",
    );
    // All zeros satisfies the check character (the weighted sum is zero), and is
    // still refused: an all-digit value is a GS1 key's shape, not an LPN's.
    expect(expectError(parseInternalLpn("0".repeat(LPN_MIN_LENGTH))).code).toBe(
      "INVALID_PREFIX",
    );
  });

  it("rejects a well-formed body whose check character was recomputed wrong", () => {
    const body = lpn.value.slice(0, -1);
    const wrong = LPN_ALPHABET[
      (LPN_ALPHABET.indexOf(checkCharacter(body) ?? "0") + 5) % 31
    ] as string;
    expect(expectError(parseInternalLpn(body + wrong)).code).toBe(
      "CHECK_CHARACTER_MISMATCH",
    );
  });
});

describe("lpnFromSscc", () => {
  it("accepts a valid SSCC", () => {
    expect(lpnFromSscc("106141411234567897")).toEqual({
      ok: true,
      value: { kind: "SSCC", value: "106141411234567897" },
    });
  });

  it("rejects a wrong length, non-digits, or a bad check digit", () => {
    for (const raw of [
      "10614141123456789",
      "1061414112345678970",
      "10614141123456789X",
      "106141411234567890",
    ]) {
      expect(expectError(lpnFromSscc(raw))).toEqual({
        code: "INVALID_SSCC",
        raw,
      });
    }
  });
});

describe("base-31 coding", () => {
  it("round-trips every value it encodes", () => {
    for (const value of [0, 1, 30, 31, 960, 961, 123_456_789]) {
      expect(decodeBase31(encodeBase31(value, 9) ?? "")).toBe(value);
    }
  });

  it("is fixed width and most-significant first", () => {
    expect(encodeBase31(0, 4)).toBe("0000");
    expect(encodeBase31(1, 4)).toBe("0001");
    expect(encodeBase31(31, 4)).toBe("0010");
  });

  it("answers null rather than a plausible wrong value", () => {
    // `decodeBase31` read an unknown character as zero, which turned a corrupt
    // time component into a believable issue date; `encodeBase31` silently
    // truncated a value too large for its width, which would have issued two
    // pallets the same LPN.
    expect(decodeBase31("AB!")).toBeNull();
    expect(decodeBase31("")).toBeNull();
    expect(decodeBase31(null as unknown as string)).toBeNull();
    expect(encodeBase31(31 ** 4, 4)).toBeNull();
    expect(encodeBase31(-1, 4)).toBeNull();
    expect(encodeBase31(Number.NaN, 4)).toBeNull();
    expect(encodeBase31(1, 0)).toBeNull();
    expect(checkCharacter("")).toBeNull();
    expect(checkCharacter("AB!")).toBeNull();
    expect(checkCharacter(null as unknown as string)).toBeNull();
  });
});

describe("misbehaving injected dependencies", () => {
  it("returns a structured error when the entropy source throws", () => {
    // Web Crypto inside a sandbox, an exhausted hardware source, and a stub in a
    // test can all throw. A throw at this boundary would have escaped every
    // caller's `Result` handling.
    const throwing: EntropySource = () => {
      throw new Error("no entropy device");
    };
    expect(
      expectError(generateInternalLpn({ namespace, nowMs, entropy: throwing })),
    ).toEqual({ code: "ENTROPY_UNAVAILABLE", requested: 3 });
  });

  it("returns a structured error when the entropy source is not one", () => {
    for (const entropy of [
      undefined as unknown as EntropySource,
      42 as unknown as EntropySource,
      (() => null) as unknown as EntropySource,
      (() => "bytes") as unknown as EntropySource,
    ]) {
      expect(
        expectError(generateInternalLpn({ namespace, nowMs, entropy })).code,
      ).toBe("ENTROPY_UNAVAILABLE");
    }
  });

  // The byte reader used to accept anything with a plausible `length` and then
  // iterate it. `{ length: 3 }` satisfied `isRecord` and the length check, so the
  // `for…of` threw "is not iterable" straight out of `generateInternalLpn` — the
  // one function in this module whose whole contract is that a misbehaving
  // injected dependency is a `Result`.
  it("refuses a forged byte view instead of throwing while reading it", () => {
    const forgedSources: readonly EntropySource[] = [
      // The original defect: a record with the right `length` and no bytes.
      (() => ({ length: 3 })) as unknown as EntropySource,
      (() => ({ length: 3, 0: 1, 1: 2, 2: 3 })) as unknown as EntropySource,
      // An array is indexable and iterable, and is still not the contract.
      (() => [1, 2, 3]) as unknown as EntropySource,
      (() => new Int8Array([1, 2, 3])) as unknown as EntropySource,
      (() => new Uint16Array([1, 2, 3])) as unknown as EntropySource,
      (() => new DataView(new ArrayBuffer(3))) as unknown as EntropySource,
      (() => new ArrayBuffer(3)) as unknown as EntropySource,
      // A plain object that brands itself as a `Uint8Array` via `toStringTag`.
      (() =>
        ({
          length: 3,
          [Symbol.toStringTag]: "Uint8Array",
        }) as unknown) as unknown as EntropySource,
    ];
    for (const entropy of forgedSources) {
      expect(() =>
        generateInternalLpn({ namespace, nowMs, entropy }),
      ).not.toThrow();
      expect(
        expectError(generateInternalLpn({ namespace, nowMs, entropy })),
      ).toEqual({ code: "ENTROPY_UNAVAILABLE", requested: 3 });
    }
  });

  it("refuses a hostile byte view whose reads throw", () => {
    // A `Proxy` over a real `Uint8Array` passes `instanceof`, because the trap
    // forwards `getPrototypeOf`. Every read of it is what throws, so the read
    // itself has to be inside the boundary.
    const throwingIterator: EntropySource = () => {
      const bytes = new Uint8Array([1, 2, 3]);
      return new Proxy(bytes, {
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("hostile iterator");
          }
          return Reflect.get(target, property, receiver) as unknown;
        },
      });
    };
    const throwingIndex: EntropySource = () =>
      new Proxy(new Uint8Array([1, 2, 3]), {
        get(target, property, receiver) {
          if (property === "0") throw new Error("hostile index");
          return Reflect.get(target, property, receiver) as unknown;
        },
      });
    const throwingLength: EntropySource = () =>
      new Proxy(new Uint8Array([1, 2, 3]), {
        get(target, property, receiver) {
          if (property === "length") throw new Error("hostile length");
          return Reflect.get(target, property, receiver) as unknown;
        },
      });
    const throwingGetter: EntropySource = () => {
      const bytes = new Uint8Array([1, 2, 3]);
      // A subclass instance is a `Uint8Array`, and this one throws on iteration.
      class Hostile extends Uint8Array {
        override [Symbol.iterator](): ArrayIterator<number> {
          throw new Error("hostile subclass");
        }
      }
      return new Hostile(bytes);
    };
    for (const entropy of [
      throwingIterator,
      throwingIndex,
      throwingLength,
      throwingGetter,
    ]) {
      expect(() =>
        generateInternalLpn({ namespace, nowMs, entropy }),
      ).not.toThrow();
      const issued = generateInternalLpn({ namespace, nowMs, entropy });
      // A hostile source either fails closed or is read as the bytes it really
      // holds. What it must never do is throw, and it must never produce an LPN
      // out of a value this module could not read.
      if (issued.ok) {
        expect(parseInternalLpn(issued.value.value, { namespace }).ok).toBe(
          true,
        );
      } else {
        expect(issued.error.code).toBe("ENTROPY_UNAVAILABLE");
      }
    }
  });

  it("refuses a byte view of the wrong length or with a non-byte in it", () => {
    expect(
      expectError(
        generateInternalLpn({
          namespace,
          nowMs,
          entropy: () => new Uint8Array(2),
        }),
      ),
    ).toEqual({ code: "ENTROPY_UNAVAILABLE", requested: 3 });
    expect(
      expectError(
        generateInternalLpn({
          namespace,
          nowMs,
          entropy: () => new Uint8Array(4),
        }),
      ).code,
    ).toBe("ENTROPY_UNAVAILABLE");
  });

  it("validates the namespace it is asked to issue under", () => {
    expect(
      expectError(
        generateInternalLpn({
          namespace: { organizationKey: "org_acme", prefix: "1A" } as never,
          nowMs,
          entropy: fixedEntropy(1, 1, 1),
        }),
      ).code,
    ).toBe("INVALID_PREFIX");
    expect(
      expectError(
        generateInternalLpn({
          namespace: null as never,
          nowMs,
          entropy: fixedEntropy(1, 1, 1),
        }),
      ).code,
    ).toBe("INVALID_PREFIX");
  });

  it("validates a namespace it is asked to check a scan against", () => {
    // A namespace reached this comparison unchecked, so a forged one decided
    // whose label a scan was. An unusable prefix is now an error, and a merely
    // unnormalized one is folded rather than silently failing to match.
    const lpn = expectOk(
      generateInternalLpn({ namespace, nowMs, entropy: fixedEntropy(1, 1, 1) }),
    );
    for (const prefix of ["1A", "", "PAAAAAAA", "PO"]) {
      expect(
        expectError(
          parseInternalLpn(lpn.value, {
            namespace: { organizationKey: "org_acme", prefix } as never,
          }),
        ).code,
      ).toBe("INVALID_PREFIX");
    }
    expect(
      expectOk(
        parseInternalLpn(lpn.value, {
          namespace: { organizationKey: "org_acme", prefix: " pa " } as never,
        }),
      ).prefix,
    ).toBe("PA");
    expect(
      expectError(
        parseInternalLpn(lpn.value, {
          namespace: expectOk(makeLpnNamespace("org_rival", "XQ")),
        }),
      ).code,
    ).toBe("PREFIX_NOT_REGISTERED");
  });

  it("treats a scan that is not a string as an invalid character", () => {
    expect(expectError(parseInternalLpn(12 as unknown as string))).toEqual({
      code: "INVALID_CHARACTER",
      raw: "number",
    });
    expect(lpnFromSscc(null as unknown as string).ok).toBe(false);
    expect(looksLikeInternalLpn(null as unknown as string)).toBe(false);
  });
});

describe("looksLikeInternalLpn", () => {
  it("is true only for a plausible internal shape", () => {
    const lpn = expectOk(
      generateInternalLpn({ namespace, nowMs, entropy: fixedEntropy(1, 1, 1) }),
    );
    expect(looksLikeInternalLpn(lpn.value)).toBe(true);
    expect(looksLikeInternalLpn(lpn.value.toLowerCase())).toBe(true);
    expect(looksLikeInternalLpn("106141411234567897")).toBe(false);
    expect(looksLikeInternalLpn("PA")).toBe(false);
    expect(looksLikeInternalLpn(`PA${"O".repeat(13)}`)).toBe(false);
  });
});
