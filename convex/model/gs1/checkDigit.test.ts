/**
 * Unit tier — the GS1 modulo-10 check digit.
 *
 * The fixtures are published GS1-format keys whose check digits are recomputed by
 * hand in the comments, so the test does not merely agree with the implementation
 * it is testing.
 */
import { describe, expect, it } from "vitest";

import {
  gs1CheckDigit,
  MAX_GS1_KEY_LENGTH,
  verifyGs1CheckDigit,
} from "./checkDigit";

describe("gs1CheckDigit", () => {
  it("computes the documented EAN-13 example", () => {
    // 400638133393: weighting 3,1 from the right gives
    // 3·3+9·1+3·3+3·1+3·3+1·1+8·3+3·1+6·3+0·1+0·3+4·1 = 89, so the digit is 1.
    expect(gs1CheckDigit("400638133393")).toEqual({ ok: true, value: 1 });
  });

  it("computes a UPC-12 and a GTIN-14 example", () => {
    // 03600029145 → sum 58 → digit 2.
    expect(gs1CheckDigit("03600029145")).toEqual({ ok: true, value: 2 });
    // 1061414199999 → sum 147 → digit 3.
    expect(gs1CheckDigit("1061414199999")).toEqual({ ok: true, value: 3 });
  });

  it("computes an SSCC-18 example", () => {
    // 10614141123456789 → sum 143 → digit 7.
    expect(gs1CheckDigit("10614141123456789")).toEqual({ ok: true, value: 7 });
  });

  it("returns zero when the weighted sum is already a multiple of ten", () => {
    // 0000000000000: sum 0, so the check digit is 0 rather than 10.
    expect(gs1CheckDigit("0000000000000")).toEqual({ ok: true, value: 0 });
  });

  it("rejects a non-numeric, empty, or over-long key", () => {
    expect(gs1CheckDigit("")).toEqual({
      ok: false,
      error: { code: "EMPTY", raw: "" },
    });
    expect(gs1CheckDigit("40063813339X")).toEqual({
      ok: false,
      error: { code: "NOT_DIGITS", raw: "40063813339X" },
    });
    expect(gs1CheckDigit(" 400638133393")).toEqual({
      ok: false,
      error: { code: "NOT_DIGITS", raw: " 400638133393" },
    });
    expect(gs1CheckDigit("1".repeat(MAX_GS1_KEY_LENGTH))).toEqual({
      ok: false,
      error: {
        code: "TOO_LONG",
        raw: "1".repeat(MAX_GS1_KEY_LENGTH),
        limit: MAX_GS1_KEY_LENGTH - 1,
      },
    });
  });
});

describe("verifyGs1CheckDigit", () => {
  it("accepts valid keys of every supported length", () => {
    for (const key of [
      "4006381333931",
      "036000291452",
      "10614141999993",
      "106141411234567897",
    ]) {
      expect(verifyGs1CheckDigit(key)).toEqual({ ok: true, value: key });
    }
  });

  it("catches a single-digit error", () => {
    expect(verifyGs1CheckDigit("4006381333932")).toEqual({
      ok: false,
      error: {
        code: "CHECK_DIGIT_MISMATCH",
        raw: "4006381333932",
        expected: 1,
        actual: 2,
      },
    });
    expect(verifyGs1CheckDigit("4006381233931").ok).toBe(false);
  });

  it("catches a transposition of adjacent unequal digits", () => {
    // 4006381333931 with the 6 and 3 swapped.
    expect(verifyGs1CheckDigit("4003681333931").ok).toBe(false);
  });

  it("rejects malformed input rather than guessing", () => {
    expect(verifyGs1CheckDigit("4").ok).toBe(false);
    expect(verifyGs1CheckDigit("").ok).toBe(false);
    expect(verifyGs1CheckDigit("40063813339 1").ok).toBe(false);
    expect(verifyGs1CheckDigit("1".repeat(19))).toEqual({
      ok: false,
      error: {
        code: "TOO_LONG",
        raw: "1".repeat(19),
        limit: MAX_GS1_KEY_LENGTH,
      },
    });
  });
});
