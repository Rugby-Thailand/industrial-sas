/**
 * Identifier normalization: raw scans (`G-047`), SKUs (`G-027`), lot codes
 * (`G-031`), and GTINs (`G-043`).
 *
 * Status: **implemented.** No table stores a normalized identifier yet, and no
 * uniqueness check consumes one.
 *
 * Normalization exists so that two inputs that mean the same thing produce the
 * same key, and two inputs that mean different things never do. The second half
 * is the one that gets broken: the usual mistakes are trimming or numerically
 * coercing a code, which turns `"0001"` into `1` and collides four SKUs into
 * one. Nothing here touches leading zeros, and no function converts a code to a
 * number. `normalizeGtin` *adds* leading zeros — a GTIN-13 is a GTIN-14 with a
 * leading zero — which is the one padding GS1 defines.
 *
 * Case folding is a policy, not a detail, so it is per identifier kind and
 * documented:
 *
 * - **SKU** — folded to upper case. The SKU is the tenant's own code, and
 *   `abc-1` and `ABC-1` on two purchase orders are the same item; treating them
 *   as two is worse than the loss of a case distinction nobody relies on.
 *   Folding is ASCII-only, because `toUpperCase` on arbitrary Unicode can change
 *   a string's length (`ß` → `SS`) and Thai has no case at all.
 * - **Lot code** — case preserved. GS1 AI 10 is case-sensitive, so `A1` and `a1`
 *   from two supplier labels may genuinely be two lots. Folding them would merge
 *   two batches into one, and a merged batch cannot be un-merged after a recall.
 *
 * Both bounds and character rules fail closed. Control, format, surrogate, and
 * unassigned code points are rejected rather than stripped: a zero-width joiner
 * inside a code is either an attack or a copy-paste accident, and silently
 * removing it produces a key that does not match what anyone can see.
 *
 * Pure module (plan §6.2): no Convex imports.
 */
import { isRecord, isSafeInt, isString } from "../guards";
import { fail, ok, type Result } from "../result";
import { verifyGs1CheckDigit } from "../gs1/checkDigit";

/** Longest raw scan accepted; matches the element-string bound. */
export const MAX_RAW_SCAN_LENGTH = 512;

/** Longest human code accepted for a SKU or similar tenant identifier. */
export const MAX_CODE_LENGTH = 64;

/** Longest lot code accepted: the GS1 AI 10 bound, so a scan always fits. */
export const MAX_LOT_CODE_LENGTH = 20;

/** Terminators a keyboard-wedge scanner appends. Stripped from the tail only. */
const SCANNER_TERMINATORS = /[\r\n\t]+$/;

/**
 * Control characters that must not appear in a raw scan: C0 except the group
 * separator, DEL, and C1.
 */
const RAW_SCAN_FORBIDDEN = /[\u0000-\u001c\u001e\u001f\u007f-\u009f]/;

/** Anything in Unicode category C — control, format, surrogate, private, unassigned. */
const CODE_FORBIDDEN = /\p{C}/u;

/** Whitespace of any kind, which no code may contain internally. */
const ANY_WHITESPACE = /\s/u;

export type IdentifierError =
  | { readonly code: "EMPTY"; readonly raw: string }
  | {
      readonly code: "TOO_LONG";
      readonly raw: string;
      readonly limit: number;
      readonly actualLength: number;
    }
  | { readonly code: "CONTROL_CHARACTER"; readonly raw: string }
  | { readonly code: "WHITESPACE_NOT_ALLOWED"; readonly raw: string }
  | { readonly code: "NOT_DIGITS"; readonly raw: string }
  | {
      readonly code: "UNSUPPORTED_GTIN_LENGTH";
      readonly raw: string;
      readonly actualLength: number;
    }
  | { readonly code: "CHECK_DIGIT_INVALID"; readonly raw: string };

/** Whether a code keeps its case. See the header for why this is per kind. */
export type CaseFolding = "UPPERCASE" | "PRESERVE";

/**
 * Cleans a scan of its transport artefacts and nothing else: strips the trailing
 * terminator the wedge appends, then validates length and characters. The group
 * separator survives, because it is FNC1 and the GS1 parser needs it.
 *
 * This is not the value to persist as the raw scan (`INV-0005-12`) — persist what
 * arrived. This is the value to parse.
 */
export function normalizeRawScan(raw: string): Result<string, IdentifierError> {
  if (!isString(raw)) return fail({ code: "EMPTY", raw: describe(raw) });
  const trimmed = raw.replace(SCANNER_TERMINATORS, "");
  if (trimmed.length === 0) return fail({ code: "EMPTY", raw });
  if (trimmed.length > MAX_RAW_SCAN_LENGTH) {
    return fail({
      code: "TOO_LONG",
      raw,
      limit: MAX_RAW_SCAN_LENGTH,
      actualLength: trimmed.length,
    });
  }
  if (RAW_SCAN_FORBIDDEN.test(trimmed)) {
    return fail({ code: "CONTROL_CHARACTER", raw });
  }
  return ok(trimmed);
}

/**
 * Normalizes a human code: trims the ends, rejects internal whitespace and any
 * category-C code point, applies NFC so two encodings of the same Thai or
 * accented string agree, and folds ASCII case when asked.
 *
 * NFC runs before the length check, because composing can shorten a string and
 * the bound must apply to the stored form.
 */
export function normalizeCode(
  raw: string,
  options: { readonly maxLength: number; readonly caseFolding: CaseFolding },
): Result<string, IdentifierError> {
  if (!isString(raw)) return fail({ code: "EMPTY", raw: describe(raw) });
  if (
    !isRecord(options) ||
    !isSafeInt(options.maxLength) ||
    options.maxLength < 1 ||
    (options.caseFolding !== "UPPERCASE" && options.caseFolding !== "PRESERVE")
  ) {
    // A normalizer with no bound, or with a folding policy this module does not
    // implement, would either accept an unbounded key or fold a case it was told
    // to preserve. Both are `TOO_LONG`-class refusals rather than a guess.
    return fail({
      code: "TOO_LONG",
      raw,
      limit: 0,
      actualLength: raw.length,
    });
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) return fail({ code: "EMPTY", raw });
  if (CODE_FORBIDDEN.test(trimmed)) {
    return fail({ code: "CONTROL_CHARACTER", raw });
  }
  if (ANY_WHITESPACE.test(trimmed)) {
    return fail({ code: "WHITESPACE_NOT_ALLOWED", raw });
  }
  const composed = trimmed.normalize("NFC");
  const folded =
    options.caseFolding === "UPPERCASE"
      ? composed.replace(/[a-z]/g, (character) => character.toUpperCase())
      : composed;
  if (folded.length > options.maxLength) {
    return fail({
      code: "TOO_LONG",
      raw,
      limit: options.maxLength,
      actualLength: folded.length,
    });
  }
  return ok(folded);
}

/** The tenant's item code (`G-027`). Case-insensitive by the policy above. */
export const normalizeSku = (raw: string): Result<string, IdentifierError> =>
  normalizeCode(raw, {
    maxLength: MAX_CODE_LENGTH,
    caseFolding: "UPPERCASE",
  });

/** A lot code (`G-031`). Case-sensitive, because GS1 AI 10 is. */
export const normalizeLotCode = (
  raw: string,
): Result<string, IdentifierError> =>
  normalizeCode(raw, {
    maxLength: MAX_LOT_CODE_LENGTH,
    caseFolding: "PRESERVE",
  });

/**
 * Normalizes a GTIN (`G-043`) to its 14-digit form and verifies the check digit.
 *
 * GTIN-8, -12, -13, and -14 are all accepted and left-padded with zeros to 14, as
 * GS1 defines: the zeros are meaningful, and the padded form is the only one two
 * labels of different lengths can be compared in. Any other length is rejected —
 * an 11-digit "GTIN" is a mis-scan, not a short GTIN.
 */
export function normalizeGtin(raw: string): Result<string, IdentifierError> {
  if (!isString(raw)) return fail({ code: "EMPTY", raw: describe(raw) });
  const trimmed = raw.trim();
  if (trimmed.length === 0) return fail({ code: "EMPTY", raw });
  if (!/^[0-9]+$/.test(trimmed)) return fail({ code: "NOT_DIGITS", raw });
  if (
    trimmed.length !== 8 &&
    trimmed.length !== 12 &&
    trimmed.length !== 13 &&
    trimmed.length !== 14
  ) {
    return fail({
      code: "UNSUPPORTED_GTIN_LENGTH",
      raw,
      actualLength: trimmed.length,
    });
  }
  if (!verifyGs1CheckDigit(trimmed).ok) {
    return fail({ code: "CHECK_DIGIT_INVALID", raw });
  }
  return ok(trimmed.padStart(14, "0"));
}

/** The shape of a value that is not an identifier at all, for the error field. */
const describe = (value: unknown): string =>
  value === null ? "null" : typeof value;
