/**
 * GS1 standard check digit (`G-042`, `G-043`, `ADR-0005` §12).
 *
 * Status: **implemented** for the GS1 modulo-10 check digit, which is the one
 * used by GTIN-8/12/13/14 and SSCC-18. No other GS1 check character scheme is
 * implemented: the price/weight check digit and the check character pair used by
 * some AIs are absent, and this module says so rather than approximating them.
 *
 * The algorithm: weight the data digits alternately 3 and 1 from the rightmost
 * data digit leftwards, sum, and take the difference to the next multiple of ten.
 * It catches every single-digit error and most transpositions, which is why a
 * scanned GTIN with a bad check digit is a rejected scan (`INV-0005-11`) rather
 * than a lookup that happens to miss.
 *
 * Pure module (plan §6.2): no Convex imports.
 */
import { fail, ok, type Result } from "../result";

/** Longest data part accepted: 17 digits plus a check digit is an SSCC. */
export const MAX_GS1_KEY_LENGTH = 18;

export type Gs1CheckDigitError =
  | { readonly code: "EMPTY"; readonly raw: string }
  | { readonly code: "NOT_DIGITS"; readonly raw: string }
  | {
      readonly code: "TOO_LONG";
      readonly raw: string;
      readonly limit: number;
    }
  | {
      readonly code: "CHECK_DIGIT_MISMATCH";
      readonly raw: string;
      readonly expected: number;
      readonly actual: number;
    };

const DIGITS_ONLY = /^[0-9]+$/;

/**
 * The check digit for a string of data digits (the key *without* its check
 * digit).
 */
export function gs1CheckDigit(
  dataDigits: string,
): Result<number, Gs1CheckDigitError> {
  if (dataDigits.length === 0) return fail({ code: "EMPTY", raw: dataDigits });
  if (!DIGITS_ONLY.test(dataDigits)) {
    return fail({ code: "NOT_DIGITS", raw: dataDigits });
  }
  if (dataDigits.length >= MAX_GS1_KEY_LENGTH) {
    return fail({
      code: "TOO_LONG",
      raw: dataDigits,
      limit: MAX_GS1_KEY_LENGTH - 1,
    });
  }
  let sum = 0;
  for (let offset = 0; offset < dataDigits.length; offset += 1) {
    const digit = dataDigits.charCodeAt(dataDigits.length - 1 - offset) - 48;
    sum += digit * (offset % 2 === 0 ? 3 : 1);
  }
  return ok((10 - (sum % 10)) % 10);
}

/**
 * Verifies a complete key, check digit included. Returns the key on success so a
 * caller can use the validated value without re-reading its own input.
 */
export function verifyGs1CheckDigit(
  key: string,
): Result<string, Gs1CheckDigitError> {
  if (key.length < 2) return fail({ code: "EMPTY", raw: key });
  if (!DIGITS_ONLY.test(key)) return fail({ code: "NOT_DIGITS", raw: key });
  if (key.length > MAX_GS1_KEY_LENGTH) {
    return fail({ code: "TOO_LONG", raw: key, limit: MAX_GS1_KEY_LENGTH });
  }
  const expected = gs1CheckDigit(key.slice(0, -1));
  if (!expected.ok) return expected;
  const actual = key.charCodeAt(key.length - 1) - 48;
  return expected.value === actual
    ? ok(key)
    : fail({
        code: "CHECK_DIGIT_MISMATCH",
        raw: key,
        expected: expected.value,
        actual,
      });
}
