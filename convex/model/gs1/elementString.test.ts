/**
 * Unit tier — the GS1 element-string parser.
 *
 * The fixtures are built from keys whose check digits are verified in
 * `checkDigit.test.ts`, so a failure here is a parsing failure rather than an
 * arithmetic one. The negative cases are the ones that decide whether a mis-scan
 * becomes a rejection or a wrong posting: an unknown AI, a truncated fixed field,
 * a variable field past its bound, a bad check digit, and a duplicate AI.
 */
import { describe, expect, it } from "vitest";

import { expectError, expectOk } from "../../../tests/fixtures/domain-results";
import {
  GROUP_SEPARATOR,
  looksLikeGs1ElementString,
  MAX_ELEMENT_STRING_LENGTH,
  gs1AiDefinition,
  gs1ValueOf,
  isSupportedGs1Ai,
  parseGs1ElementString,
  supportedGs1Ais,
  type Gs1Scan,
} from "./elementString";

const GTIN14 = "10614141999993";
const SSCC18 = "106141411234567897";
const options = { referenceYear: 2026 } as const;

const parse = (raw: string) => parseGs1ElementString(raw, options);

describe("supported surface", () => {
  it("is exactly the nine documented AIs", () => {
    expect(supportedGs1Ais()).toEqual([
      "00",
      "01",
      "10",
      "11",
      "15",
      "17",
      "21",
      "30",
      "37",
    ]);
  });
});

describe("parseGs1ElementString", () => {
  it("parses a supplier label: GTIN, expiry, lot", () => {
    const scan = expectOk(parse(`01${GTIN14}17260831` + "10LOT-A1"));
    expect(scan.gtin14).toBe(GTIN14);
    expect(scan.lot).toBe("LOT-A1");
    expect(scan.expirationDate).toEqual({
      yymmdd: "260831",
      precision: "DAY",
      year: 2026,
      month: 8,
      day: 31,
    });
    expect(scan.elements.map((element) => element.title)).toEqual([
      "GTIN",
      "EXPIRATION_DATE",
      "BATCH_LOT",
    ]);
    expect(scan.symbology).toBeNull();
    expect(scan.raw).toContain(GTIN14);
  });

  it("terminates a variable field at FNC1 and continues parsing", () => {
    const raw = `01${GTIN14}10LOT-A1${GROUP_SEPARATOR}21SERIAL-9`;
    const scan = expectOk(parse(raw));
    expect(scan.lot).toBe("LOT-A1");
    expect(scan.serial).toBe("SERIAL-9");
  });

  it("records and strips a symbology identifier", () => {
    expect(expectOk(parse(`]C101${GTIN14}`)).symbology).toBe("GS1-128");
    expect(expectOk(parse(`]d201${GTIN14}`)).symbology).toBe("GS1-DATAMATRIX");
    expect(expectOk(parse(`]Q301${GTIN14}`)).symbology).toBe("GS1-QRCODE");
    expect(expectOk(parse(`]e001${GTIN14}`)).symbology).toBe("GS1-DATABAR");
  });

  it("rejects an unknown symbology instead of reading it as data", () => {
    expect(expectError(parse(`]A001${GTIN14}`))).toEqual({
      code: "UNSUPPORTED_SYMBOLOGY",
      prefix: "]A0",
    });
  });

  it("rejects a separator in a position the specification has no reading for", () => {
    // Each of these parsed as well formed while the parser skipped any separator
    // it met between elements. A scan whose separators are in impossible places
    // has field boundaries nobody can reconstruct, so it fails closed.
    expect(expectError(parse(`${GROUP_SEPARATOR}01${GTIN14}`))).toEqual({
      code: "UNEXPECTED_SEPARATOR",
      offset: 0,
    });
    expect(expectError(parse(`01${GTIN14}${GROUP_SEPARATOR}17260831`))).toEqual(
      { code: "UNEXPECTED_SEPARATOR", offset: 16 },
    );
    expect(
      expectError(parse(`10LOT-A1${GROUP_SEPARATOR}${GROUP_SEPARATOR}21S1`)),
    ).toEqual({ code: "UNEXPECTED_SEPARATOR", offset: 9 });
    expect(expectError(parse(`10LOT-A1${GROUP_SEPARATOR}`))).toEqual({
      code: "UNEXPECTED_SEPARATOR",
      offset: 8,
    });
    expect(expectError(parse(`]C1${GROUP_SEPARATOR}01${GTIN14}`))).toEqual({
      code: "UNEXPECTED_SEPARATOR",
      offset: 3,
    });
  });

  it("still accepts the one legal separator position", () => {
    const scan = expectOk(
      parse(`10LOT-A1${GROUP_SEPARATOR}21SERIAL-9${GROUP_SEPARATOR}3005`),
    );
    expect(scan.lot).toBe("LOT-A1");
    expect(scan.serial).toBe("SERIAL-9");
    expect(scan.variableCount).toBe("05");
  });

  it("parses an SSCC pallet label with a count", () => {
    const scan = expectOk(parse(`00${SSCC18}3712`));
    expect(scan.sscc18).toBe(SSCC18);
    expect(scan.countOfTradeItems).toBe("12");
  });

  it("parses production and best-before dates, including month precision", () => {
    const scan = expectOk(parse(`01${GTIN14}11260801${"15260900"}`));
    expect(scan.productionDate?.precision).toBe("DAY");
    expect(scan.bestBeforeDate).toEqual({
      yymmdd: "260900",
      precision: "MONTH",
      year: 2026,
      month: 9,
      day: null,
    });
  });

  it("indexes every element by AI and keeps the order in `elements`", () => {
    const scan = expectOk(parse(`01${GTIN14}3005${GROUP_SEPARATOR}10L1`));
    // `byAi` is a lookup, not a sequence: a record orders integer-like keys
    // numerically, so order lives in `elements`, which is the value that has it.
    expect(gs1ValueOf(scan, "01")).toBe(GTIN14);
    expect(gs1ValueOf(scan, "30")).toBe("05");
    expect(gs1ValueOf(scan, "10")).toBe("L1");
    expect(gs1ValueOf(scan, "17")).toBeNull();
    expect(scan.elements.map((element) => element.ai)).toEqual([
      "01",
      "30",
      "10",
    ]);
    expect(scan.variableCount).toBe("05");
  });

  it("rejects an unknown AI, including one this parser deliberately omits", () => {
    // 3103 is net weight with three decimals: a real AI, not implemented here,
    // and never guessed at.
    expect(expectError(parse(`01${GTIN14}3103001234`))).toEqual({
      code: "UNKNOWN_AI",
      ai: "31",
      offset: 16,
    });
    expect(expectError(parse("9912345"))).toEqual({
      code: "UNKNOWN_AI",
      ai: "99",
      offset: 0,
    });
  });

  it("rejects a truncated fixed-length field", () => {
    expect(expectError(parse("0110614141"))).toEqual({
      code: "TRUNCATED_FIELD",
      ai: "01",
      expectedLength: 14,
      actualLength: 8,
    });
    expect(expectError(parse(`01${GTIN14}172608`))).toEqual({
      code: "TRUNCATED_FIELD",
      ai: "17",
      expectedLength: 6,
      actualLength: 4,
    });
  });

  it("rejects a fixed-length field cut short by a separator", () => {
    expect(expectError(parse(`0110614141${GROUP_SEPARATOR}10L1`))).toEqual({
      code: "TRUNCATED_FIELD",
      ai: "01",
      expectedLength: 14,
      actualLength: 8,
    });
  });

  it("rejects a variable field past its bound", () => {
    expect(expectError(parse(`10${"L".repeat(21)}`))).toEqual({
      code: "FIELD_TOO_LONG",
      ai: "10",
      limit: 20,
      actualLength: 21,
    });
    expect(expectError(parse(`30${"1".repeat(9)}`))).toEqual({
      code: "FIELD_TOO_LONG",
      ai: "30",
      limit: 8,
      actualLength: 9,
    });
  });

  it("rejects an empty variable field", () => {
    expect(expectError(parse(`10${GROUP_SEPARATOR}21S1`))).toEqual({
      code: "EMPTY_FIELD",
      ai: "10",
    });
    expect(expectError(parse("10"))).toEqual({ code: "EMPTY_FIELD", ai: "10" });
  });

  it("rejects a character outside the AI encodable set", () => {
    expect(expectError(parse("10LOT A1"))).toEqual({
      code: "INVALID_CHARACTER",
      ai: "10",
      value: "LOT A1",
    });
    expect(expectError(parse("10ล็อต"))).toEqual({
      code: "INVALID_CHARACTER",
      ai: "10",
      value: "ล็อต",
    });
    expect(expectError(parse("300a")).code).toBe("INVALID_CHARACTER");
  });

  it("rejects a bad check digit on a GTIN and an SSCC", () => {
    expect(expectError(parse("0110614141999994"))).toEqual({
      code: "INVALID_CHECK_DIGIT",
      ai: "01",
      value: "10614141999994",
    });
    expect(expectError(parse("00106141411234567890")).code).toBe(
      "INVALID_CHECK_DIGIT",
    );
  });

  it("rejects an impossible date", () => {
    expect(expectError(parse(`01${GTIN14}17261301`))).toEqual({
      code: "INVALID_DATE",
      ai: "17",
      value: "261301",
    });
  });

  it("rejects a duplicate AI rather than picking one", () => {
    expect(expectError(parse(`01${GTIN14}10L1${GROUP_SEPARATOR}10L2`))).toEqual(
      { code: "DUPLICATE_AI", ai: "10", offset: 21 },
    );
  });

  it("rejects empty, over-long, and non-numeric-AI input", () => {
    expect(expectError(parse(""))).toEqual({ code: "EMPTY_INPUT" });
    const overLong = `10${"L".repeat(MAX_ELEMENT_STRING_LENGTH)}`;
    expect(expectError(parse(overLong))).toEqual({
      code: "TOO_LONG",
      length: overLong.length,
      limit: MAX_ELEMENT_STRING_LENGTH,
    });
    expect(expectError(parse("A1234")).code).toBe("MALFORMED_AI");
    expect(expectError(parse("0")).code).toBe("MALFORMED_AI");
    expect(expectError(parse(GROUP_SEPARATOR + GROUP_SEPARATOR))).toEqual({
      code: "UNEXPECTED_SEPARATOR",
      offset: 0,
    });
    expect(expectError(parse(`]C1`))).toEqual({ code: "NO_ELEMENTS" });
  });

  it("documents the unseparated-variable-field limitation", () => {
    // A label that omits the mandatory FNC1 after AI 10 does not silently split
    // into two elements: the rest of the string is the lot value, and it is
    // rejected once it passes 20 characters. This is the known parser limitation
    // the supplier-label corpus (RG-005) exists to measure.
    const scan = expectOk(parse("10LOT-A117260831"));
    expect(scan.lot).toBe("LOT-A117260831");
    expect(scan.expirationDate).toBeNull();
    expect(expectError(parse("10LOT-A1-LONGER-CODE17260831")).code).toBe(
      "FIELD_TOO_LONG",
    );
  });

  it("freezes what it returns", () => {
    const scan = expectOk(parse(`01${GTIN14}`));
    expect(Object.isFrozen(scan)).toBe(true);
    expect(Object.isFrozen(scan.elements)).toBe(true);
    expect(Object.isFrozen(scan.elements[0])).toBe(true);
  });
});

describe("looksLikeGs1ElementString", () => {
  it("is true for a symbology identifier, a separator, or a supported AI", () => {
    expect(looksLikeGs1ElementString(`]C101${GTIN14}`)).toBe(true);
    expect(looksLikeGs1ElementString(`ABC${GROUP_SEPARATOR}DEF`)).toBe(true);
    expect(looksLikeGs1ElementString(`01${GTIN14}`)).toBe(true);
  });

  it("is false for a short string or an unsupported leading AI", () => {
    expect(looksLikeGs1ElementString("01")).toBe(false);
    expect(looksLikeGs1ElementString("PL0000000000AB")).toBe(false);
    expect(looksLikeGs1ElementString("4006381333931")).toBe(false);
  });
});

describe("immutability and forged input", () => {
  const scan = expectOk(parse(`01${GTIN14}10L1`));

  it("does not hand out a mutable interpretation", () => {
    // `byAi` was a live `Map` typed `ReadonlyMap`: this cast rewrote a scan's
    // interpretation while `raw` and `elements` still described the real label.
    expect(Object.isFrozen(scan.byAi)).toBe(true);
    expect(() => {
      (scan.byAi as Record<string, string>)["01"] = "99999999999999";
    }).toThrow(TypeError);
    expect(() => {
      (scan.byAi as Record<string, string>)["17"] = "260831";
    }).toThrow(TypeError);
    expect(scan.gtin14).toBe(GTIN14);
    expect(gs1ValueOf(scan, "17")).toBeNull();
  });

  it("does not resolve a lookup through the object prototype", () => {
    // A record with `Object.prototype` in its chain answers `toString` with a
    // function while the type promises a string.
    expect(gs1ValueOf(scan, "toString")).toBeNull();
    expect(gs1ValueOf(scan, "constructor")).toBeNull();
    expect(scan.byAi["toString"]).toBeUndefined();
  });

  it("keeps the supported AI table closed at run time", () => {
    expect(isSupportedGs1Ai("91")).toBe(false);
    expect(gs1AiDefinition("91")).toBeNull();
    expect(Object.isFrozen(gs1AiDefinition("01"))).toBe(true);
    expect(() => {
      (gs1AiDefinition("01") as unknown as { maxLength: number }).maxLength = 2;
    }).toThrow(TypeError);
    expect(gs1AiDefinition("01")?.maxLength).toBe(14);
    expect(gs1AiDefinition("toString")).toBeNull();
  });

  it("rejects a reference year it cannot use", () => {
    expect(
      expectError(
        parseGs1ElementString(`01${GTIN14}17260831`, {
          referenceYear: Number.NaN,
        }),
      ),
    ).toEqual({ code: "INVALID_REFERENCE_YEAR", referenceYear: Number.NaN });
    expect(
      expectError(
        parseGs1ElementString(`01${GTIN14}`, {
          referenceYear: "2026" as unknown as number,
        }),
      ).code,
    ).toBe("INVALID_REFERENCE_YEAR");
  });

  it("treats a non-string scan as empty rather than throwing", () => {
    expect(
      expectError(parseGs1ElementString(null as unknown as string, options)),
    ).toEqual({ code: "EMPTY_INPUT" });
    expect(looksLikeGs1ElementString(null as unknown as string)).toBe(false);
    expect(gs1ValueOf(null as unknown as Gs1Scan, "01")).toBeNull();
  });
});
