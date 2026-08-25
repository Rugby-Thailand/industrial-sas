import {
  frozenArray,
  frozenRecord,
  isRecord,
  isSafeInt,
  isString,
  recordKeys,
  recordValue,
} from "../guards";
import { fail, ok, type Result } from "../result";
import { verifyGs1CheckDigit } from "./checkDigit";
import { parseGs1Date, type Gs1Date } from "./date";

export const GROUP_SEPARATOR = "\u001d";

export const MAX_ELEMENT_STRING_LENGTH = 512;

const AI_82 = /^[!"%&'()*+,\-./0-9:;<=>?A-Z_a-z]+$/;
const DIGITS_ONLY = /^[0-9]+$/;

export type Gs1AiTitle =
  | "SSCC"
  | "GTIN"
  | "BATCH_LOT"
  | "PRODUCTION_DATE"
  | "BEST_BEFORE_DATE"
  | "EXPIRATION_DATE"
  | "SERIAL"
  | "VARIABLE_COUNT"
  | "COUNT_OF_TRADE_ITEMS";

export interface Gs1AiDefinition {
  readonly ai: string;
  readonly title: Gs1AiTitle;
  readonly charset: "NUMERIC" | "AI82";

  readonly fixedLength: number | null;
  readonly maxLength: number;
  readonly checkDigit: boolean;
  readonly date: boolean;
}

const definition = (
  ai: string,
  title: Gs1AiTitle,
  charset: Gs1AiDefinition["charset"],
  fixedLength: number | null,
  maxLength: number,
  flags: { readonly checkDigit?: boolean; readonly date?: boolean } = {},
): Gs1AiDefinition =>
  Object.freeze({
    ai,
    title,
    charset,
    fixedLength,
    maxLength,
    checkDigit: flags.checkDigit === true,
    date: flags.date === true,
  });

const SUPPORTED_AIS: Readonly<Record<string, Gs1AiDefinition>> = frozenRecord(
  [
    definition("00", "SSCC", "NUMERIC", 18, 18, { checkDigit: true }),
    definition("01", "GTIN", "NUMERIC", 14, 14, { checkDigit: true }),
    definition("10", "BATCH_LOT", "AI82", null, 20),
    definition("11", "PRODUCTION_DATE", "NUMERIC", 6, 6, { date: true }),
    definition("15", "BEST_BEFORE_DATE", "NUMERIC", 6, 6, { date: true }),
    definition("17", "EXPIRATION_DATE", "NUMERIC", 6, 6, { date: true }),
    definition("21", "SERIAL", "AI82", null, 20),
    definition("30", "VARIABLE_COUNT", "NUMERIC", null, 8),
    definition("37", "COUNT_OF_TRADE_ITEMS", "NUMERIC", null, 8),
  ].map((entry) => [entry.ai, entry] as const),
);

export const supportedGs1Ais = (): readonly string[] =>
  recordKeys(SUPPORTED_AIS);

export const gs1AiDefinition = (ai: string): Gs1AiDefinition | null =>
  isString(ai) ? recordValue(SUPPORTED_AIS, ai) : null;

export const isSupportedGs1Ai = (ai: string): boolean =>
  gs1AiDefinition(ai) !== null;

export type Gs1Symbology =
  "GS1-128" | "GS1-DATAMATRIX" | "GS1-QRCODE" | "GS1-DATABAR";

const SYMBOLOGY_IDENTIFIERS: Readonly<Record<string, Gs1Symbology>> =
  frozenRecord([
    ["]C1", "GS1-128"],
    ["]d2", "GS1-DATAMATRIX"],
    ["]Q3", "GS1-QRCODE"],
    ["]e0", "GS1-DATABAR"],
  ]);

export interface Gs1Element {
  readonly ai: string;
  readonly title: Gs1AiTitle;
  readonly value: string;
  readonly date: Gs1Date | null;
}

export interface Gs1Scan {
  readonly raw: string;
  readonly symbology: Gs1Symbology | null;
  readonly elements: readonly Gs1Element[];
  readonly byAi: Readonly<Record<string, string>>;
  readonly gtin14: string | null;
  readonly sscc18: string | null;
  readonly lot: string | null;
  readonly serial: string | null;
  readonly expirationDate: Gs1Date | null;
  readonly bestBeforeDate: Gs1Date | null;
  readonly productionDate: Gs1Date | null;
  readonly variableCount: string | null;
  readonly countOfTradeItems: string | null;
}

export const gs1ValueOf = (scan: Gs1Scan, ai: string): string | null => {
  if (!isRecord(scan) || !isRecord(scan.byAi) || !isString(ai)) return null;
  const value = recordValue(scan.byAi, ai);
  return isString(value) ? value : null;
};

export type Gs1ParseError =
  | { readonly code: "EMPTY_INPUT" }
  | {
      readonly code: "TOO_LONG";
      readonly length: number;
      readonly limit: number;
    }
  | { readonly code: "UNSUPPORTED_SYMBOLOGY"; readonly prefix: string }
  | { readonly code: "MALFORMED_AI"; readonly offset: number }
  | {
      readonly code: "UNKNOWN_AI";
      readonly ai: string;
      readonly offset: number;
    }
  | {
      readonly code: "DUPLICATE_AI";
      readonly ai: string;
      readonly offset: number;
    }
  | { readonly code: "UNEXPECTED_SEPARATOR"; readonly offset: number }
  | {
      readonly code: "TRUNCATED_FIELD";
      readonly ai: string;
      readonly expectedLength: number;
      readonly actualLength: number;
    }
  | { readonly code: "EMPTY_FIELD"; readonly ai: string }
  | {
      readonly code: "FIELD_TOO_LONG";
      readonly ai: string;
      readonly limit: number;
      readonly actualLength: number;
    }
  | {
      readonly code: "INVALID_CHARACTER";
      readonly ai: string;
      readonly value: string;
    }
  | {
      readonly code: "INVALID_CHECK_DIGIT";
      readonly ai: string;
      readonly value: string;
    }
  | {
      readonly code: "INVALID_DATE";
      readonly ai: string;
      readonly value: string;
    }
  | { readonly code: "INVALID_REFERENCE_YEAR"; readonly referenceYear: number }
  | { readonly code: "NO_ELEMENTS" };

export function parseGs1ElementString(
  raw: string,
  options: { readonly referenceYear: number },
): Result<Gs1Scan, Gs1ParseError> {
  if (!isRecord(options) || !isSafeInt(options.referenceYear)) {
    return fail({
      code: "INVALID_REFERENCE_YEAR",
      referenceYear: isRecord(options)
        ? typeof options.referenceYear === "number"
          ? options.referenceYear
          : Number.NaN
        : Number.NaN,
    });
  }
  if (!isString(raw) || raw.length === 0) return fail({ code: "EMPTY_INPUT" });
  if (raw.length > MAX_ELEMENT_STRING_LENGTH) {
    return fail({
      code: "TOO_LONG",
      length: raw.length,
      limit: MAX_ELEMENT_STRING_LENGTH,
    });
  }

  let symbology: Gs1Symbology | null = null;
  let cursor = 0;
  if (raw.startsWith("]")) {
    const prefix = raw.slice(0, 3);
    const known = recordValue(SYMBOLOGY_IDENTIFIERS, prefix);
    if (known === null) {
      return fail({ code: "UNSUPPORTED_SYMBOLOGY", prefix });
    }
    symbology = known;
    cursor = 3;
  }

  const elements: Gs1Element[] = [];
  const byAi: [string, string][] = [];

  while (cursor < raw.length) {
    if (raw[cursor] === GROUP_SEPARATOR) {
      return fail({ code: "UNEXPECTED_SEPARATOR", offset: cursor });
    }
    const ai = raw.slice(cursor, cursor + 2);
    if (ai.length < 2 || !DIGITS_ONLY.test(ai)) {
      return fail({ code: "MALFORMED_AI", offset: cursor });
    }
    const found = recordValue(SUPPORTED_AIS, ai);
    if (found === null) {
      return fail({ code: "UNKNOWN_AI", ai, offset: cursor });
    }
    if (byAi.some(([seen]) => seen === ai)) {
      return fail({ code: "DUPLICATE_AI", ai, offset: cursor });
    }
    cursor += 2;

    let value: string;
    if (found.fixedLength !== null) {
      value = raw.slice(cursor, cursor + found.fixedLength);
      if (value.length < found.fixedLength || value.includes(GROUP_SEPARATOR)) {
        return fail({
          code: "TRUNCATED_FIELD",
          ai,
          expectedLength: found.fixedLength,
          actualLength:
            value.indexOf(GROUP_SEPARATOR) === -1
              ? value.length
              : value.indexOf(GROUP_SEPARATOR),
        });
      }
      cursor += found.fixedLength;
    } else {
      const separator = raw.indexOf(GROUP_SEPARATOR, cursor);
      const end = separator === -1 ? raw.length : separator;
      value = raw.slice(cursor, end);
      if (value.length === 0) return fail({ code: "EMPTY_FIELD", ai });
      if (value.length > found.maxLength) {
        return fail({
          code: "FIELD_TOO_LONG",
          ai,
          limit: found.maxLength,
          actualLength: value.length,
        });
      }
      if (separator === -1) {
        cursor = raw.length;
      } else {
        if (separator + 1 >= raw.length) {
          return fail({ code: "UNEXPECTED_SEPARATOR", offset: separator });
        }
        cursor = separator + 1;
      }
    }

    const charsetOk =
      found.charset === "NUMERIC" ? DIGITS_ONLY.test(value) : AI_82.test(value);
    if (!charsetOk) {
      return fail({ code: "INVALID_CHARACTER", ai, value });
    }
    if (found.checkDigit && !verifyGs1CheckDigit(value).ok) {
      return fail({ code: "INVALID_CHECK_DIGIT", ai, value });
    }

    let date: Gs1Date | null = null;
    if (found.date) {
      const parsed = parseGs1Date(value, {
        referenceYear: options.referenceYear,
      });
      if (!parsed.ok) return fail({ code: "INVALID_DATE", ai, value });
      date = parsed.value;
    }

    elements.push(Object.freeze({ ai, title: found.title, value, date }));
    byAi.push([ai, value]);
  }

  if (elements.length === 0) return fail({ code: "NO_ELEMENTS" });

  const values = frozenRecord(byAi);
  return ok(
    Object.freeze({
      raw,
      symbology,
      elements: frozenArray(elements),
      byAi: values,
      gtin14: recordValue(values, "01"),
      sscc18: recordValue(values, "00"),
      lot: recordValue(values, "10"),
      serial: recordValue(values, "21"),
      expirationDate: dateOf(elements, "17"),
      bestBeforeDate: dateOf(elements, "15"),
      productionDate: dateOf(elements, "11"),
      variableCount: recordValue(values, "30"),
      countOfTradeItems: recordValue(values, "37"),
    }),
  );
}

export const looksLikeGs1ElementString = (raw: string): boolean => {
  if (!isString(raw) || raw.length < 3) return false;
  if (raw.startsWith("]")) return true;
  if (raw.includes(GROUP_SEPARATOR)) return true;
  return isSupportedGs1Ai(raw.slice(0, 2));
};

const dateOf = (elements: readonly Gs1Element[], ai: string): Gs1Date | null =>
  elements.find((element) => element.ai === ai)?.date ?? null;
