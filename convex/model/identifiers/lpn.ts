import { isFunction, isRecord, isSafeInt, isString } from "../guards";
import { fail, ok, type Result } from "../result";
import { verifyGs1CheckDigit } from "../gs1/checkDigit";
import { normalizeCode, MAX_CODE_LENGTH } from "./normalization";

export const LPN_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXY";

export const LPN_TIME_LENGTH = 9;

export const LPN_RANDOM_LENGTH = 4;

export const LPN_MAX_PREFIX_LENGTH = 6;

export const MAX_ORGANIZATION_KEY_LENGTH = MAX_CODE_LENGTH;

export const LPN_MAX_LENGTH =
  LPN_MAX_PREFIX_LENGTH + LPN_TIME_LENGTH + LPN_RANDOM_LENGTH + 1;

export const LPN_MIN_LENGTH = 1 + LPN_TIME_LENGTH + LPN_RANDOM_LENGTH + 1;

export const LPN_EPOCH_MS = 1_767_225_600_000;

export const LPN_MAX_ELAPSED_MS = 31 ** LPN_TIME_LENGTH - 1;

const SSCC_LENGTH = 18;

const ALPHABET_VALUES: ReadonlyMap<string, number> = new Map(
  [...LPN_ALPHABET].map((character, index) => [character, index]),
);

export type EntropySource = (byteLength: number) => Uint8Array;

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

export function makeLpnNamespace(
  organizationKey: string,
  prefix: string,
): Result<LpnNamespace, LpnError> {
  if (!isString(organizationKey)) {
    return fail({
      code: "INVALID_ORGANIZATION_KEY",
      raw: describe(organizationKey),
    });
  }
  if (!isString(prefix)) {
    return fail({ code: "INVALID_PREFIX", raw: describe(prefix) });
  }
  const key = normalizeCode(organizationKey, {
    maxLength: MAX_ORGANIZATION_KEY_LENGTH,
    caseFolding: "PRESERVE",
  });
  if (!key.ok) {
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
  return ok(Object.freeze({ organizationKey: key.value, prefix: folded }));
}

export const validateLpnNamespace = (
  namespace: LpnNamespace,
): Result<LpnNamespace, LpnError> =>
  isRecord(namespace)
    ? makeLpnNamespace(namespace.organizationKey, namespace.prefix)
    : fail({ code: "INVALID_PREFIX", raw: describe(namespace) });

export function generateInternalLpn(input: {
  readonly namespace: LpnNamespace;
  readonly nowMs: number;
  readonly entropy: EntropySource;
}): Result<InternalLpn, LpnError> {
  if (!isRecord(input)) {
    return fail({ code: "INVALID_PREFIX", raw: describe(input) });
  }
  const namespace = validateLpnNamespace(input.namespace);
  if (!namespace.ok) return namespace;

  if (!isSafeInt(input.nowMs)) {
    return fail({
      code: "CLOCK_NOT_AN_INTEGER",
      nowMs: typeof input.nowMs === "number" ? input.nowMs : Number.NaN,
    });
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
  if (!isFunction(input.entropy)) {
    return fail({ code: "ENTROPY_UNAVAILABLE", requested: 0 });
  }

  const randomBound = 31 ** LPN_RANDOM_LENGTH;
  const random = uniformBelow(input.entropy, randomBound);
  if (!random.ok) return random;

  const time = encodeBase31(elapsed, LPN_TIME_LENGTH);
  const tail = encodeBase31(random.value, LPN_RANDOM_LENGTH);
  if (time === null || tail === null) {
    // Unreachable with the bounds checked above; still an error rather than a
    // truncated identifier, because a wrong LPN is worse than no LPN.
    return fail({
      code: "CLOCK_OUT_OF_RANGE",
      nowMs: input.nowMs,
      epochMs: LPN_EPOCH_MS,
      maximumElapsedMs: LPN_MAX_ELAPSED_MS,
    });
  }
  const body = namespace.value.prefix + time + tail;
  const check = checkCharacter(body);
  if (check === null) {
    return fail({ code: "INVALID_CHARACTER", raw: body });
  }
  return ok(
    Object.freeze({
      kind: "INTERNAL" as const,
      value: body + check,
      prefix: namespace.value.prefix,
      issuedAtMs: input.nowMs,
    }),
  );
}

export function parseInternalLpn(
  raw: string,
  options: { readonly namespace?: LpnNamespace } = {},
): Result<InternalLpn, LpnError> {
  if (!isString(raw)) {
    return fail({ code: "INVALID_CHARACTER", raw: describe(raw) });
  }
  if (!isRecord(options)) {
    return fail({ code: "INVALID_PREFIX", raw: describe(options) });
  }
  const namespace =
    options.namespace === undefined
      ? null
      : validateLpnNamespace(options.namespace);
  if (namespace !== null && !namespace.ok) return namespace;

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
  if (expected === null) return fail({ code: "INVALID_CHARACTER", raw });
  if (expected !== actual) {
    return fail({ code: "CHECK_CHARACTER_MISMATCH", raw, expected, actual });
  }

  const prefixLength = folded.length - 1 - LPN_TIME_LENGTH - LPN_RANDOM_LENGTH;
  const prefix = folded.slice(0, prefixLength);
  if (isDigit(prefix[0] as string)) {
    return fail({ code: "INVALID_PREFIX", raw });
  }
  if (namespace !== null && namespace.value.prefix !== prefix) {
    return fail({
      code: "PREFIX_NOT_REGISTERED",
      raw,
      expected: namespace.value.prefix,
      actual: prefix,
    });
  }
  const elapsed = decodeBase31(
    folded.slice(prefixLength, prefixLength + LPN_TIME_LENGTH),
  );
  if (elapsed === null) return fail({ code: "INVALID_CHARACTER", raw });
  return ok(
    Object.freeze({
      kind: "INTERNAL" as const,
      value: folded,
      prefix,
      issuedAtMs: LPN_EPOCH_MS + elapsed,
    }),
  );
}

export function lpnFromSscc(raw: string): Result<SsccLpn, LpnError> {
  if (!isString(raw)) {
    return fail({ code: "INVALID_SSCC", raw: describe(raw) });
  }
  const trimmed = raw.trim();
  if (trimmed.length !== SSCC_LENGTH || !/^[0-9]{18}$/.test(trimmed)) {
    return fail({ code: "INVALID_SSCC", raw });
  }
  return verifyGs1CheckDigit(trimmed).ok
    ? ok(Object.freeze({ kind: "SSCC" as const, value: trimmed }))
    : fail({ code: "INVALID_SSCC", raw });
}

export const looksLikeInternalLpn = (raw: string): boolean => {
  if (!isString(raw)) return false;
  const trimmed = raw.trim();
  if (trimmed.length < LPN_MIN_LENGTH || trimmed.length > LPN_MAX_LENGTH) {
    return false;
  }
  const folded = trimmed.replace(/[a-z]/g, (character) =>
    character.toUpperCase(),
  );
  return isAlphabetOnly(folded) && !isDigit(folded[0] as string);
};

export function checkCharacter(body: string): string | null {
  if (!isString(body) || body.length === 0) return null;
  let sum = 0;
  for (let index = 0; index < body.length; index += 1) {
    const value = ALPHABET_VALUES.get(body[index] as string);
    if (value === undefined) return null;
    sum = (sum + value * (index + 1)) % 31;
  }
  return LPN_ALPHABET[sum] as string;
}

export function encodeBase31(value: number, width: number): string | null {
  if (!isSafeInt(value) || value < 0) return null;
  if (!isSafeInt(width) || width < 1 || width > LPN_TIME_LENGTH) return null;
  if (value > 31 ** width - 1) return null;
  let remaining = value;
  const characters: string[] = [];
  for (let position = 0; position < width; position += 1) {
    characters.push(LPN_ALPHABET[remaining % 31] as string);
    remaining = Math.floor(remaining / 31);
  }
  return characters.reverse().join("");
}

export function decodeBase31(encoded: string): number | null {
  if (!isString(encoded) || encoded.length === 0) return null;
  let value = 0;
  for (const character of encoded) {
    const digit = ALPHABET_VALUES.get(character);
    if (digit === undefined) return null;
    value = value * 31 + digit;
  }
  return isSafeInt(value) ? value : null;
}

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
    let bytes: unknown;
    try {
      bytes = entropy(byteLength);
    } catch {
      return fail({ code: "ENTROPY_UNAVAILABLE", requested: byteLength });
    }
    const value = readEntropyBytes(bytes, byteLength);
    if (value === null) {
      return fail({ code: "ENTROPY_UNAVAILABLE", requested: byteLength });
    }
    if (value < limit) return ok(value % bound);
  }
  return fail({ code: "ENTROPY_EXHAUSTED", attempts: maxAttempts });
}

function readEntropyBytes(bytes: unknown, byteLength: number): number | null {
  try {
    if (!(bytes instanceof Uint8Array)) return null;
    if (bytes.length !== byteLength || bytes.byteLength !== byteLength) {
      return null;
    }
    let value = 0;
    for (let index = 0; index < byteLength; index += 1) {
      const byte: unknown = bytes[index];
      if (!isSafeInt(byte) || byte < 0 || byte > 255) return null;
      value = value * 256 + byte;
    }
    return isSafeInt(value) ? value : null;
  } catch {
    return null;
  }
}

const isAlphabetOnly = (value: string): boolean => {
  for (const character of value) {
    if (!ALPHABET_VALUES.has(character)) return false;
  }
  return true;
};

const isDigit = (character: string): boolean =>
  isString(character) && character >= "0" && character <= "9";

const describe = (value: unknown): string =>
  value === null ? "null" : typeof value;
