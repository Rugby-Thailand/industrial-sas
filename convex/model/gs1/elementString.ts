/**
 * GS1 element string parser (`G-044`, `ADR-0005` §13, `INV-0005-11`, §5 Q29).
 *
 * Status: **implemented for nine Application Identifiers and no others.** What is
 * supported is exactly the table below; every other AI — including the
 * decimal-point AIs (`310n` net weight), the AIs with four-digit prefixes, and
 * every date AI other than 11, 15, and 17 — is rejected as `UNKNOWN_AI`. That is
 * a deliberate refusal to guess: a parser that treats an unrecognised AI as data
 * posts stock against the wrong lot, and the plan's rule is explicit rejection
 * with the raw scan retained (`INV-0005-12`).
 *
 * | AI   | Meaning                     | Format                    |
 * | ---- | --------------------------- | ------------------------- |
 * | `00` | SSCC (`G-042`)              | 18 digits, check digit    |
 * | `01` | GTIN (`G-043`)              | 14 digits, check digit    |
 * | `10` | Batch or lot (`G-031`)      | 1-20, AI encodable set 82 |
 * | `11` | Production date             | `YYMMDD`                  |
 * | `15` | Best before date            | `YYMMDD`                  |
 * | `17` | Expiration date             | `YYMMDD`                  |
 * | `21` | Serial (`G-037`, deferred)  | 1-20, AI encodable set 82 |
 * | `30` | Variable count              | 1-8 digits                |
 * | `37` | Count of contained items    | 1-8 digits                |
 *
 * **Variable-length fields and FNC1.** A variable-length field runs to the next
 * FNC1 separator (`GS`, 0x1D) or to the end of the string, which is what the
 * General Specifications require. This parser does not look ahead for something
 * that resembles a following AI: a supplier label that omits the mandatory
 * separator is malformed, and inventing a boundary would be the guess the ADR
 * forbids. In practice the length bound turns most such labels into a
 * `FIELD_TOO_LONG` rejection; where it does not, the lot code contains the
 * remaining characters and the raw scan is retained for diagnosis. This is the
 * limitation `RG-005` (a real supplier-label corpus) exists to measure.
 *
 * **Separator placement is checked, not tolerated.** An FNC1 is legal in exactly
 * one position: terminating a variable-length field that another element follows.
 * A leading separator, one after a predefined-length field, two in a row, and a
 * trailing one are each `UNEXPECTED_SEPARATOR` with the offset. An earlier
 * version of this parser skipped any separator it met between elements, so
 * `10ABC<GS><GS>` and `0100000000000017<GS>` parsed as though they were well
 * formed — and a scan whose separators sit in impossible places is a scan whose
 * field boundaries are not knowable.
 *
 * **Symbology identifiers.** A leading `]C1`, `]d2`, `]Q3`, or `]e0` is recorded
 * and stripped. A leading `]` that is none of those is rejected rather than
 * treated as data.
 *
 * **Dates need a reference year**, which is a required option rather than the
 * host clock; see `convex/model/gs1/date.ts`.
 *
 * Pure module (plan §6.2): no Convex imports.
 */
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

/** FNC1 as scanners emit it: ASCII group separator. */
export const GROUP_SEPARATOR = "\u001d";

/**
 * Longest element string accepted. GS1-128 tops out near 48 data characters and
 * a GS1 DataMatrix carries more; 512 is generous while still bounding the work a
 * malformed scan can cause.
 */
export const MAX_ELEMENT_STRING_LENGTH = 512;

/** The AI encodable character set 82 (GS1 General Specifications figure 7.11-1). */
const AI_82 = /^[!"%&'()*+,\-./0-9:;<=>?A-Z_a-z]+$/;
const DIGITS_ONLY = /^[0-9]+$/;

/** What a supported AI means. Titles are stable identifiers, not UI strings. */
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

/** What a supported AI means, and how it is encoded. Frozen; never widened. */
export interface Gs1AiDefinition {
  readonly ai: string;
  readonly title: Gs1AiTitle;
  readonly charset: "NUMERIC" | "AI82";
  /** Present for predefined-length AIs; those need no FNC1 terminator. */
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

/**
 * The whole supported surface. Nothing outside this record parses.
 *
 * A frozen, null-prototype record rather than a `ReadonlyMap`: the previous
 * `ReadonlyMap` was an ordinary `Map`, so `(SUPPORTED_AIS as
 * Map<string, …>).set("91", …)` compiled and would have taught the parser a new
 * AI — process-wide, for every tenant — from any module that imported it. Query
 * it through `gs1AiDefinition` or `isSupportedGs1Ai`.
 */
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

/** Every AI this parser implements, sorted. The supported surface, enumerated. */
export const supportedGs1Ais = (): readonly string[] =>
  recordKeys(SUPPORTED_AIS);

/** The definition of a supported AI, or `null` for every other AI. */
export const gs1AiDefinition = (ai: string): Gs1AiDefinition | null =>
  isString(ai) ? recordValue(SUPPORTED_AIS, ai) : null;

/** Whether an AI is one of the nine this parser implements. */
export const isSupportedGs1Ai = (ai: string): boolean =>
  gs1AiDefinition(ai) !== null;

/** Symbologies whose identifier prefix means "GS1 element string follows". */
export type Gs1Symbology =
  "GS1-128" | "GS1-DATAMATRIX" | "GS1-QRCODE" | "GS1-DATABAR";

const SYMBOLOGY_IDENTIFIERS: Readonly<Record<string, Gs1Symbology>> =
  frozenRecord([
    ["]C1", "GS1-128"],
    ["]d2", "GS1-DATAMATRIX"],
    ["]Q3", "GS1-QRCODE"],
    ["]e0", "GS1-DATABAR"],
  ]);

/** One parsed element, in the order it appeared. */
export interface Gs1Element {
  readonly ai: string;
  readonly title: Gs1AiTitle;
  readonly value: string;
  readonly date: Gs1Date | null;
}

/**
 * A parsed scan. The named fields are conveniences over `elements`; each is
 * `null` when the AI was absent. `raw` is the string as received, kept because
 * `INV-0005-12` requires the raw scan to be persisted next to its interpretation.
 *
 * `byAi` is a frozen, null-prototype record, and `elements` a frozen array of
 * frozen elements, so a parsed scan cannot be edited after the fact. It was a
 * live `Map` typed `ReadonlyMap`, which meant `(scan.byAi as Map<string,
 * string>).set("01", …)` compiled and rewrote a scan's interpretation while
 * leaving `raw` and `elements` describing the label that was actually read. Read a
 * value with `gs1ValueOf`.
 *
 * `byAi` is a lookup and not a sequence: a record enumerates integer-like keys
 * numerically, so `10` precedes `30` there whatever the label said. Order is
 * `elements`, which keeps the order the AIs appeared in.
 */
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

/** The value a scan carried for an AI, or `null` when the AI was absent. */
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

/**
 * Parses a GS1 element string. Fails closed on anything it does not fully
 * understand, and never returns a partial interpretation.
 */
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
    // A separator can only ever have terminated the previous variable-length
    // field, and that branch consumes it. Anything left here is a separator in a
    // position the specification has no reading for: leading, doubled, trailing,
    // or following a predefined-length field.
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
        // A terminator with nothing after it terminates nothing.
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

/** True when a string is worth handing to the parser at all (precedence stage). */
export const looksLikeGs1ElementString = (raw: string): boolean => {
  if (!isString(raw) || raw.length < 3) return false;
  if (raw.startsWith("]")) return true;
  if (raw.includes(GROUP_SEPARATOR)) return true;
  return isSupportedGs1Ai(raw.slice(0, 2));
};

const dateOf = (elements: readonly Gs1Element[], ai: string): Gs1Date | null =>
  elements.find((element) => element.ai === ai)?.date ?? null;
