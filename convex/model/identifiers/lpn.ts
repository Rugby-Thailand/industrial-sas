/**
 * Licence plate number (`G-041`, `ADR-0005` §12, D-15, §5 Q24).
 *
 * Status: **implemented** as pure value logic. Uniqueness and never-reuse
 * (`INV-0005-05`) are **not** implemented and cannot be: they are properties of
 * the `handlingUnits` table, which does not exist. This module can only make a
 * collision unlikely and a typo detectable; the mutation that issues an LPN still
 * owes the uniqueness check.
 *
 * Two kinds of LPN exist, exactly as D-15 requires:
 *
 * - `SSCC` — an 18-digit GS1 serial shipping container code, used when the tenant
 *   has a GS1 prefix. Its check digit is the GS1 modulo-10 one.
 * - `INTERNAL` — issued here when the tenant has no GS1 prefix, encoded in Code
 *   128 on the label.
 *
 * The internal format is `PREFIX · TIME(9) · RANDOM(4) · CHECK(1)`:
 *
 * - **Prefix** — 1-6 characters, the organization's own namespace. It must start
 *   with a letter, which is what keeps an internal LPN from ever looking like an
 *   SSCC or a GTIN: those are all digits. A prefix belongs to one organization, so
 *   validating against a registered namespace rejects another tenant's label
 *   before any lookup happens.
 * - **Time** — 9 base-31 characters of milliseconds since 2026-01-01Z, giving
 *   roughly 838 years of range and making LPNs issued in order sort in order. The
 *   clock is an argument, never `Date.now()`, so a test issues a known LPN.
 * - **Random** — 4 base-31 characters (about 923,000 values per millisecond) drawn
 *   from an injected entropy source with rejection sampling, so the distribution
 *   is uniform rather than modulo-biased.
 * - **Check** — one character over a 31-symbol alphabet: `sum(value_i × (i+1)) mod
 *   31`. This is **not** a GS1 or ISO 7064 check character and is not described as
 *   one. It is chosen because 31 is prime and the alphabet has exactly 31 symbols,
 *   which makes two properties provable rather than hopeful: every single-character
 *   substitution is caught, and every transposition of two different characters is
 *   caught. Both are asserted in the property suite.
 *
 * The alphabet omits `I`, `L`, `O`, `U`, and `Z`: the first four are the pairs a
 * human misreads on a scuffed thermal label, and dropping one more letter buys the
 * prime modulus the check character needs.
 *
 * Pure module (plan §6.2): no Convex imports.
 */
import { fail, ok, type Result } from "../result";
import { verifyGs1CheckDigit } from "../gs1/checkDigit";

/** 31 symbols: digits plus letters, less `I`, `L`, `O`, `U`, `Z`. Prime size. */
export const LPN_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXY";

/** Base-31 digits of the timestamp component. */
export const LPN_TIME_LENGTH = 9;

/** Base-31 digits of the random component. */
export const LPN_RANDOM_LENGTH = 4;

/** Longest prefix an organization may register. */
export const LPN_MAX_PREFIX_LENGTH = 6;

/** Hard bound on the printed value, so a label layout can be fixed. */
export const LPN_MAX_LENGTH =
  LPN_MAX_PREFIX_LENGTH + LPN_TIME_LENGTH + LPN_RANDOM_LENGTH + 1;

/** Shortest possible internal LPN: a one-character prefix. */
export const LPN_MIN_LENGTH = 1 + LPN_TIME_LENGTH + LPN_RANDOM_LENGTH + 1;

/** 2026-01-01T00:00:00Z, as a literal so no `Date` call runs at import. */
export const LPN_EPOCH_MS = 1_767_225_600_000;

/** 31^9 milliseconds after the epoch: the last representable issue time. */
export const LPN_MAX_ELAPSED_MS = 31 ** LPN_TIME_LENGTH - 1;

/** An SSCC is 18 digits including its GS1 check digit. */
const SSCC_LENGTH = 18;

const ALPHABET_VALUES: ReadonlyMap<string, number> = new Map(
  [...LPN_ALPHABET].map((character, index) => [character, index]),
);

/** Bytes of entropy. Injected so generation is deterministic under test. */
export type EntropySource = (byteLength: number) => Uint8Array;

/** An organization's LPN namespace. One prefix, one tenant. */
export interface LpnNamespace {
  readonly organizationKey: string;
  readonly prefix: string;
}

export interface InternalLpn {
  readonly kind: "INTERNAL";
  readonly value: string;
  readonly prefix: string;
  readonly issuedAtMs: number;
}

export interface SsccLpn {
  readonly kind: "SSCC";
  readonly value: string;
}

export type Lpn = InternalLpn | SsccLpn;

export type LpnError =
  | { readonly code: "INVALID_ORGANIZATION_KEY"; readonly raw: string }
  | { readonly code: "INVALID_PREFIX"; readonly raw: string }
  | {
      readonly code: "INVALID_LENGTH";
      readonly raw: string;
      readonly minimum: number;
      readonly maximum: number;
    }
  | { readonly code: "INVALID_CHARACTER"; readonly raw: string }
  | {
      readonly code: "CHECK_CHARACTER_MISMATCH";
      readonly raw: string;
      readonly expected: string;
      readonly actual: string;
    }
  | {
      readonly code: "PREFIX_NOT_REGISTERED";
      readonly raw: string;
      readonly expected: string;
      readonly actual: string;
    }
  | { readonly code: "CLOCK_NOT_AN_INTEGER"; readonly nowMs: number }
  | {
      readonly code: "CLOCK_OUT_OF_RANGE";
      readonly nowMs: number;
      readonly epochMs: number;
      readonly maximumElapsedMs: number;
    }
  | { readonly code: "ENTROPY_UNAVAILABLE"; readonly requested: number }
  | { readonly code: "ENTROPY_EXHAUSTED"; readonly attempts: number }
  | { readonly code: "INVALID_SSCC"; readonly raw: string };

/* -------------------------------------------------------------------------- */
/* Namespaces                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Registers a namespace. The prefix is folded to upper case, must consist of
 * alphabet characters, and must begin with a letter so the result can never be
 * mistaken for a numeric GS1 key.
 */
export function makeLpnNamespace(
  organizationKey: string,
  prefix: string,
): Result<LpnNamespace, LpnError> {
  const key = organizationKey.trim();
  if (key.length === 0 || key.length > 64) {
    return fail({ code: "INVALID_ORGANIZATION_KEY", raw: organizationKey });
  }
  const folded = prefix
    .trim()
    .replace(/[a-z]/g, (character) => character.toUpperCase());
  if (
    folded.length === 0 ||
    folded.length > LPN_MAX_PREFIX_LENGTH ||
    !isAlphabetOnly(folded) ||
    isDigit(folded[0] as string)
  ) {
    return fail({ code: "INVALID_PREFIX", raw: prefix });
  }
  return ok(Object.freeze({ organizationKey: key, prefix: folded }));
}

/* -------------------------------------------------------------------------- */
/* Generation                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Issues an internal LPN. Both sources of non-determinism are arguments: a clock
 * reading and an entropy function. Nothing here consults the ambient environment,
 * which is what lets a test assert an exact value and what keeps this module
 * usable inside a Convex mutation, where `Math.random` is not allowed.
 */
export function generateInternalLpn(input: {
  readonly namespace: LpnNamespace;
  readonly nowMs: number;
  readonly entropy: EntropySource;
}): Result<InternalLpn, LpnError> {
  const namespace = makeLpnNamespace(
    input.namespace.organizationKey,
    input.namespace.prefix,
  );
  if (!namespace.ok) return namespace;

  if (!Number.isSafeInteger(input.nowMs)) {
    return fail({ code: "CLOCK_NOT_AN_INTEGER", nowMs: input.nowMs });
  }
  const elapsed = input.nowMs - LPN_EPOCH_MS;
  if (elapsed < 0 || elapsed > LPN_MAX_ELAPSED_MS) {
    return fail({
      code: "CLOCK_OUT_OF_RANGE",
      nowMs: input.nowMs,
      epochMs: LPN_EPOCH_MS,
      maximumElapsedMs: LPN_MAX_ELAPSED_MS,
    });
  }

  const randomBound = 31 ** LPN_RANDOM_LENGTH;
  const random = uniformBelow(input.entropy, randomBound);
  if (!random.ok) return random;

  const body =
    namespace.value.prefix +
    encodeBase31(elapsed, LPN_TIME_LENGTH) +
    encodeBase31(random.value, LPN_RANDOM_LENGTH);
  const value = body + checkCharacter(body);
  return ok(
    Object.freeze({
      kind: "INTERNAL" as const,
      value,
      prefix: namespace.value.prefix,
      issuedAtMs: input.nowMs,
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Validates an internal LPN's structure and check character, and — when a
 * namespace is supplied — that the prefix is that organization's. Without the
 * namespace argument this proves the label is well formed, not that it is yours.
 */
export function parseInternalLpn(
  raw: string,
  options: { readonly namespace?: LpnNamespace } = {},
): Result<InternalLpn, LpnError> {
  const folded = raw
    .trim()
    .replace(/[a-z]/g, (character) => character.toUpperCase());
  if (folded.length < LPN_MIN_LENGTH || folded.length > LPN_MAX_LENGTH) {
    return fail({
      code: "INVALID_LENGTH",
      raw,
      minimum: LPN_MIN_LENGTH,
      maximum: LPN_MAX_LENGTH,
    });
  }
  if (!isAlphabetOnly(folded)) {
    return fail({ code: "INVALID_CHARACTER", raw });
  }
  const body = folded.slice(0, -1);
  const expected = checkCharacter(body);
  const actual = folded.slice(-1);
  if (expected !== actual) {
    return fail({ code: "CHECK_CHARACTER_MISMATCH", raw, expected, actual });
  }

  const prefixLength = folded.length - 1 - LPN_TIME_LENGTH - LPN_RANDOM_LENGTH;
  const prefix = folded.slice(0, prefixLength);
  if (isDigit(prefix[0] as string)) {
    return fail({ code: "INVALID_PREFIX", raw });
  }
  if (options.namespace !== undefined && options.namespace.prefix !== prefix) {
    return fail({
      code: "PREFIX_NOT_REGISTERED",
      raw,
      expected: options.namespace.prefix,
      actual: prefix,
    });
  }
  const elapsed = decodeBase31(
    folded.slice(prefixLength, prefixLength + LPN_TIME_LENGTH),
  );
  return ok(
    Object.freeze({
      kind: "INTERNAL" as const,
      value: folded,
      prefix,
      issuedAtMs: LPN_EPOCH_MS + elapsed,
    }),
  );
}

/** Wraps a validated SSCC as an LPN (D-15). Verifies the GS1 check digit. */
export function lpnFromSscc(raw: string): Result<SsccLpn, LpnError> {
  const trimmed = raw.trim();
  if (trimmed.length !== SSCC_LENGTH || !/^[0-9]{18}$/.test(trimmed)) {
    return fail({ code: "INVALID_SSCC", raw });
  }
  return verifyGs1CheckDigit(trimmed).ok
    ? ok(Object.freeze({ kind: "SSCC" as const, value: trimmed }))
    : fail({ code: "INVALID_SSCC", raw });
}

/**
 * A cheap syntactic test for the scan-precedence ladder: does this look like an
 * internal LPN at all? Structure only — `parseInternalLpn` decides.
 */
export const looksLikeInternalLpn = (raw: string): boolean => {
  const trimmed = raw.trim();
  if (trimmed.length < LPN_MIN_LENGTH || trimmed.length > LPN_MAX_LENGTH) {
    return false;
  }
  const folded = trimmed.replace(/[a-z]/g, (character) =>
    character.toUpperCase(),
  );
  return isAlphabetOnly(folded) && !isDigit(folded[0] as string);
};

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * `sum(value_i × (i+1)) mod 31`, rendered as an alphabet character. The modulus
 * equals the alphabet size and is prime, so every character value is distinct
 * modulo 31 and every weight is invertible — which is what makes single-character
 * substitutions and transpositions detectable rather than probable.
 */
export function checkCharacter(body: string): string {
  let sum = 0;
  for (let index = 0; index < body.length; index += 1) {
    const value = ALPHABET_VALUES.get(body[index] as string);
    if (value === undefined) return "";
    sum = (sum + value * (index + 1)) % 31;
  }
  return LPN_ALPHABET[sum] as string;
}

/** Fixed-width base-31, most significant character first. */
export function encodeBase31(value: number, width: number): string {
  let remaining = value;
  const characters: string[] = [];
  for (let position = 0; position < width; position += 1) {
    characters.push(LPN_ALPHABET[remaining % 31] as string);
    remaining = Math.floor(remaining / 31);
  }
  return characters.reverse().join("");
}

/** Inverse of `encodeBase31`. Returns 0 for an empty string. */
export function decodeBase31(encoded: string): number {
  let value = 0;
  for (const character of encoded) {
    value = value * 31 + (ALPHABET_VALUES.get(character) ?? 0);
  }
  return value;
}

/**
 * A uniform integer in `[0, bound)` from injected bytes, by rejection sampling:
 * values in the incomplete final block are discarded rather than folded, so the
 * distribution has no modulo bias. Eight rejections in a row means the source is
 * not behaving, and that fails closed instead of looping.
 */
function uniformBelow(
  entropy: EntropySource,
  bound: number,
): Result<number, LpnError> {
  let range = 1;
  let byteLength = 0;
  while (range < bound) {
    range *= 256;
    byteLength += 1;
  }
  const limit = range - (range % bound);
  const maxAttempts = 8;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const bytes = entropy(byteLength);
    if (bytes.length !== byteLength) {
      return fail({ code: "ENTROPY_UNAVAILABLE", requested: byteLength });
    }
    let value = 0;
    for (const byte of bytes) {
      if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
        return fail({ code: "ENTROPY_UNAVAILABLE", requested: byteLength });
      }
      value = value * 256 + byte;
    }
    if (value < limit) return ok(value % bound);
  }
  return fail({ code: "ENTROPY_EXHAUSTED", attempts: maxAttempts });
}

const isAlphabetOnly = (value: string): boolean => {
  for (const character of value) {
    if (!ALPHABET_VALUES.has(character)) return false;
  }
  return true;
};

const isDigit = (character: string): boolean =>
  character >= "0" && character <= "9";
