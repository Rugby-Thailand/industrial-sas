import { isString } from "../guards";
import { fail, ok, type Result } from "../result";

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

export function gs1CheckDigit(
  dataDigits: string,
): Result<number, Gs1CheckDigitError> {
  if (!isString(dataDigits)) {
    return fail({ code: "NOT_DIGITS", raw: describe(dataDigits) });
  }
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

export function verifyGs1CheckDigit(
  key: string,
): Result<string, Gs1CheckDigitError> {
  if (!isString(key)) return fail({ code: "NOT_DIGITS", raw: describe(key) });
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

const describe = (value: unknown): string =>
  value === null ? "null" : typeof value;
