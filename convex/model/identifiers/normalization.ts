import { isRecord, isSafeInt, isString } from "../guards";
import { fail, ok, type Result } from "../result";
import { verifyGs1CheckDigit } from "../gs1/checkDigit";

export const MAX_RAW_SCAN_LENGTH = 512;

export const MAX_CODE_LENGTH = 64;

export const MAX_LOT_CODE_LENGTH = 20;

const SCANNER_TERMINATORS = /[\r\n\t]+$/;

const RAW_SCAN_FORBIDDEN = /[\u0000-\u001c\u001e\u001f\u007f-\u009f]/;

const CODE_FORBIDDEN = /\p{C}/u;

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

export type CaseFolding = "UPPERCASE" | "PRESERVE";

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

const describe = (value: unknown): string =>
  value === null ? "null" : typeof value;
