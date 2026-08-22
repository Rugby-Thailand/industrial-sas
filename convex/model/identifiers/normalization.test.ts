/**
 * Unit tier — identifier normalization.
 *
 * The load-bearing assertions are the ones about what normalization must *not* do:
 * leading zeros survive, a lot code keeps its case, and a zero-width character is
 * refused rather than removed.
 */
import { describe, expect, it } from "vitest";

import { expectError, expectOk } from "../../../tests/fixtures/domain-results";
import {
  MAX_CODE_LENGTH,
  MAX_LOT_CODE_LENGTH,
  MAX_RAW_SCAN_LENGTH,
  normalizeCode,
  normalizeGtin,
  normalizeLotCode,
  normalizeRawScan,
  normalizeSku,
} from "./normalization";

const GROUP_SEPARATOR = "\u001d";

describe("normalizeRawScan", () => {
  it("strips the wedge terminator and keeps FNC1", () => {
    expect(normalizeRawScan("0110614141999993\r\n")).toEqual({
      ok: true,
      value: "0110614141999993",
    });
    const withSeparator = `10L1${GROUP_SEPARATOR}21S1`;
    expect(normalizeRawScan(`${withSeparator}\r`)).toEqual({
      ok: true,
      value: withSeparator,
    });
  });

  it("keeps leading zeros and internal spaces untouched", () => {
    expect(normalizeRawScan("000123")).toEqual({ ok: true, value: "000123" });
    expect(normalizeRawScan("A B")).toEqual({ ok: true, value: "A B" });
  });

  it("rejects an empty scan and a control character other than FNC1", () => {
    expect(normalizeRawScan("\r\n")).toEqual({
      ok: false,
      error: { code: "EMPTY", raw: "\r\n" },
    });
    expect(expectError(normalizeRawScan("AB\u0000CD")).code).toBe(
      "CONTROL_CHARACTER",
    );
    expect(expectError(normalizeRawScan("AB\u0007CD")).code).toBe(
      "CONTROL_CHARACTER",
    );
    expect(expectError(normalizeRawScan("AB\u007fCD")).code).toBe(
      "CONTROL_CHARACTER",
    );
  });

  it("bounds the length", () => {
    const overLong = "A".repeat(MAX_RAW_SCAN_LENGTH + 1);
    expect(normalizeRawScan(overLong)).toEqual({
      ok: false,
      error: {
        code: "TOO_LONG",
        raw: overLong,
        limit: MAX_RAW_SCAN_LENGTH,
        actualLength: MAX_RAW_SCAN_LENGTH + 1,
      },
    });
    expect(normalizeRawScan("A".repeat(MAX_RAW_SCAN_LENGTH)).ok).toBe(true);
  });
});

describe("normalizeSku", () => {
  it("never destroys a leading zero", () => {
    expect(normalizeSku("0001")).toEqual({ ok: true, value: "0001" });
    expect(normalizeSku("0")).toEqual({ ok: true, value: "0" });
    expect(normalizeSku("000")).toEqual({ ok: true, value: "000" });
    // The four codes stay four codes.
    const codes = ["1", "01", "001", "0001"].map((raw) =>
      expectOk(normalizeSku(raw)),
    );
    expect(new Set(codes).size).toBe(4);
  });

  it("folds ASCII case and trims the ends", () => {
    expect(normalizeSku("  bolt-m8  ")).toEqual({ ok: true, value: "BOLT-M8" });
    expect(expectOk(normalizeSku("Bolt-M8"))).toBe(
      expectOk(normalizeSku("BOLT-M8")),
    );
  });

  it("leaves Thai text alone and does not change its length", () => {
    const thai = "สลักเกลียว";
    const normalized = expectOk(normalizeSku(thai));
    expect(normalized).toBe(thai.normalize("NFC"));
    expect(normalized.length).toBe(thai.normalize("NFC").length);
  });

  it("applies NFC so two encodings of one string agree", () => {
    // "é" as one code point and as "e" plus a combining acute.
    const composed = "CAF\u00c9";
    const decomposed = "CAFE\u0301";
    expect(expectOk(normalizeSku(decomposed))).toBe(composed);
    expect(expectOk(normalizeSku(composed))).toBe(
      expectOk(normalizeSku(decomposed)),
    );
  });

  it("rejects internal whitespace and category-C code points", () => {
    expect(expectError(normalizeSku("BOLT M8")).code).toBe(
      "WHITESPACE_NOT_ALLOWED",
    );
    // A tab is both whitespace and a control character; the control check runs
    // first, so that is the code reported.
    expect(expectError(normalizeSku("BOLT\tM8")).code).toBe(
      "CONTROL_CHARACTER",
    );
    // A zero-width space is refused, not silently stripped: the stored key must
    // match what a human can read on the screen.
    expect(expectError(normalizeSku("BOLT\u200bM8")).code).toBe(
      "CONTROL_CHARACTER",
    );
    expect(expectError(normalizeSku("BOLT\ufeffM8")).code).toBe(
      "CONTROL_CHARACTER",
    );
    expect(expectError(normalizeSku("BOLT\u00adM8")).code).toBe(
      "CONTROL_CHARACTER",
    );
  });

  it("rejects empty and over-long codes", () => {
    expect(expectError(normalizeSku("   ")).code).toBe("EMPTY");
    expect(normalizeSku("A".repeat(MAX_CODE_LENGTH)).ok).toBe(true);
    expect(expectError(normalizeSku("A".repeat(MAX_CODE_LENGTH + 1)))).toEqual({
      code: "TOO_LONG",
      raw: "A".repeat(MAX_CODE_LENGTH + 1),
      limit: MAX_CODE_LENGTH,
      actualLength: MAX_CODE_LENGTH + 1,
    });
  });

  it("is idempotent", () => {
    for (const raw of ["0001", " bolt-m8 ", "CAFE\u0301", "สลัก"]) {
      const once = expectOk(normalizeSku(raw));
      expect(expectOk(normalizeSku(once))).toBe(once);
    }
  });
});

describe("normalizeLotCode", () => {
  it("preserves case, because GS1 AI 10 is case-sensitive", () => {
    expect(normalizeLotCode("a1")).toEqual({ ok: true, value: "a1" });
    expect(expectOk(normalizeLotCode("A1"))).not.toBe(
      expectOk(normalizeLotCode("a1")),
    );
  });

  it("bounds the code at the GS1 AI 10 limit", () => {
    expect(normalizeLotCode("L".repeat(MAX_LOT_CODE_LENGTH)).ok).toBe(true);
    expect(normalizeLotCode("L".repeat(MAX_LOT_CODE_LENGTH + 1)).ok).toBe(
      false,
    );
  });
});

describe("normalizeCode", () => {
  it("takes its bound and folding policy from the caller", () => {
    expect(
      normalizeCode("abc", { maxLength: 3, caseFolding: "PRESERVE" }),
    ).toEqual({ ok: true, value: "abc" });
    expect(
      normalizeCode("abc", { maxLength: 2, caseFolding: "UPPERCASE" }).ok,
    ).toBe(false);
  });
});

describe("normalizeGtin", () => {
  it("pads every supported length to 14 and keeps the zeros meaningful", () => {
    expect(normalizeGtin("4006381333931")).toEqual({
      ok: true,
      value: "04006381333931",
    });
    expect(normalizeGtin("036000291452")).toEqual({
      ok: true,
      value: "00036000291452",
    });
    expect(normalizeGtin("10614141999993")).toEqual({
      ok: true,
      value: "10614141999993",
    });
  });

  it("accepts an already-padded GTIN-14 and normalizes to the same value", () => {
    expect(expectOk(normalizeGtin("04006381333931"))).toBe(
      expectOk(normalizeGtin("4006381333931")),
    );
  });

  it("rejects a bad check digit", () => {
    expect(expectError(normalizeGtin("4006381333932"))).toEqual({
      code: "CHECK_DIGIT_INVALID",
      raw: "4006381333932",
    });
  });

  it("rejects an unsupported length rather than padding it", () => {
    expect(expectError(normalizeGtin("40063813339"))).toEqual({
      code: "UNSUPPORTED_GTIN_LENGTH",
      raw: "40063813339",
      actualLength: 11,
    });
    expect(expectError(normalizeGtin("106141411234567897")).code).toBe(
      "UNSUPPORTED_GTIN_LENGTH",
    );
  });

  it("rejects non-digits and emptiness", () => {
    expect(expectError(normalizeGtin("400638133393X")).code).toBe("NOT_DIGITS");
    expect(expectError(normalizeGtin("")).code).toBe("EMPTY");
    expect(expectError(normalizeGtin("   ")).code).toBe("EMPTY");
  });
});
