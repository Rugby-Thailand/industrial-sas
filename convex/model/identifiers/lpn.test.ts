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
