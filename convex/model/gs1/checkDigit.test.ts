import { describe, expect, it } from "vitest";

import {
  gs1CheckDigit,
  MAX_GS1_KEY_LENGTH,
  verifyGs1CheckDigit,
} from "./checkDigit";

describe("gs1CheckDigit", () => {
  it("computes the documented EAN-13 example", () => {
    expect(gs1CheckDigit("400638133393")).toEqual({ ok: true, value: 1 });
  });

  it("computes a UPC-12 and a GTIN-14 example", () => {
    expect(gs1CheckDigit("03600029145")).toEqual({ ok: true, value: 2 });

    expect(gs1CheckDigit("1061414199999")).toEqual({ ok: true, value: 3 });
  });

  it("computes an SSCC-18 example", () => {
    expect(gs1CheckDigit("10614141123456789")).toEqual({ ok: true, value: 7 });
  });

  it("returns zero when the weighted sum is already a multiple of ten", () => {
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
