/**
 * What the user's own words refer to: employee-code tokens, dates, a
 * period version and the selected page record ("this", "ตรงนี้").
 *
 * One reader for AI grounding, the scoped server search and normal search,
 * so they agree on what counts as an explicit reference. Codes follow the
 * stored schema (`[A-Z0-9][A-Z0-9._-]{0,31}`, so `A`, `12` and `NIGHT` are
 * valid) and are only ever compared as whole tokens, never as substrings.
 * Tokens inside a date, time or version expression are not codes:
 * `EMP-EVAL-001 2026-10-08` names one employee and one day.
 */
import type { IsoDate } from "../hr/calendar";
import { readScan, scanDates, type DateReading } from "./dates";
import { EMPLOYEE_CODE, normalizeSearchText } from "./text";

/** Exact code lookups one request may make; more is reported incomplete. */
export const MAX_EXACT_CODES = 8;

type Span = readonly [number, number];

/** Case is kept so `NIGHT` (written as a code) differs from `night`. */
function foldCase(input: string): string {
  return input
    .normalize("NFC")
    .replace(/[๐-๙]/g, (digit) => String(digit.charCodeAt(0) - 0x0e50))
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** A version keyword; what follows it decides the reading. */
const VERSION_WORD =
  /(?<![a-z0-9._-])(?:v|ver|version|revision)(?![a-z])|ฉบับ(?:ที่)?|เวอร์ชั่?น(?:ที่)?/g;
/** A plain number right after the keyword: `v1`, `ฉบับที่ 2`, not `1/2`. */
const VERSION_NUMBER = /^\.?\s*(\d+)(?![\d.,/-]\d|[a-z])/;
/** "the latest / this version" asks for what the page shows by default. */
const DEFAULT_AFTER =
  /^\s*(?:ล่าสุด|ปัจจุบัน|นี้|ที่เลือก|latest|current|newest|this|selected)/;
const DEFAULT_BEFORE = /(?:latest|current|newest|this|selected|the)\s*$/;
/** "รหัส V1", "code V1": an employee code that looks like a version. */
const CODE_BEFORE =
  /(?:รหัส(?:พนักงาน)?|พนักงาน|(?<![a-z])(?:code|employee|emp|id)(?![a-z]))\s*$/;
const TIME =
  /(?<!\d)\d{1,2}[:.]\d{2}(?!\d)(?:\s*(?:น\.?|นาฬิกา|am|pm))?|(?<!\d)\d{1,2}\s*(?:am|pm|โมง|ทุ่ม)(?![a-z])/g;

export type VersionReading =
  | { readonly kind: "NONE" }
  | { readonly kind: "ONE"; readonly version: number }
  /** "v0", "v1.5", "v-1", "ฉบับเก่า", or two numbers: never guessed. */
  | { readonly kind: "INVALID" };

/**
 * Matches the words this, here, selected… that point at the visible record.
 * `วันนี้` (today) and `เดือนนี้` (this month) are dates, not references.
 */
const SELECTION_REFERENCE =
  /ตรงนี้|รายการนี้|อันนี้|คนนี้|พนักงานนี้|พนักงานคนนี้|วันที่เลือก|รายการที่เลือก|ที่เลือกไว้|ที่เลือกอยู่|คำขอนี้|เคสนี้|งวดนี้|ฉบับนี้|(?<![a-z])(?:this|that) (?:one|employee|person|day|date|period|record|request|item|entry|row|case)(?![a-z])|(?<![a-z])(?:here|selected|this)$|(?<![a-z])(?:here|selected)(?![a-z])/;

/** Upper-case words that are not employee codes when written in a request. */
const NOT_CODES = new Set([
  "HR",
  "OT",
  "CSV",
  "AI",
  "ID",
  "PDF",
  "QR",
  "URL",
  "API",
  "I",
  "OK",
  "THE",
]);

export interface QueryReferences {
  /** Dates of the query (see `readDates`). */
  readonly dates: DateReading;
  /** An explicit period version, e.g. `v1`, `ฉบับ 1`. */
  readonly version: VersionReading;
  /**
   * Every whole Latin/digit token outside date and time expressions,
   * upper-cased like a stored code. A model's code must be one of these.
   */
  readonly tokens: readonly string[];
  /**
   * The tokens that read as codes on their own: containing a digit, written
   * in capitals (`NIGHT`), or the whole query, and not a version (`v1`;
   * "รหัส V1" is a code). Two of them are never one person; each is looked
   * up exactly.
   */
  readonly codes: readonly string[];
  /** The query refers to the record selected on the page. */
  readonly selection: boolean;
}

const inside = (spans: readonly Span[], start: number, end: number) =>
  spans.some(([from, to]) => start < to && from < end);

function readVersion(source: string): {
  readonly reading: VersionReading;
  readonly spans: readonly Span[];
} {
  const spans: Span[] = [];
  const numbers = new Set<number>();
  let invalid = false;
  VERSION_WORD.lastIndex = 0;
  for (
    let m = VERSION_WORD.exec(source);
    m !== null;
    m = VERSION_WORD.exec(source)
  ) {
    const end = m.index + m[0].length;
    const rest = source.slice(end);
    if (CODE_BEFORE.test(source.slice(0, m.index))) continue;
    const number = VERSION_NUMBER.exec(rest);
    if (number !== null) {
      spans.push([m.index, end + number[0].length]);
      const value = Number(number[1]);
      if (number[1]!.length > 6 || value < 1) invalid = true;
      else numbers.add(value);
      continue;
    }
    spans.push([m.index, end]);
    // "v-1", "version zero", "ฉบับ abc", "ฉบับเก่า": a version was asked
    // for but not one this reader can name, so it is never guessed.
    if (
      !DEFAULT_AFTER.test(rest) &&
      !DEFAULT_BEFORE.test(source.slice(0, m.index))
    )
      invalid = true;
  }
  if (invalid || numbers.size > 1)
    return { reading: { kind: "INVALID" }, spans };
  const only = [...numbers][0];
  return {
    reading:
      only === undefined ? { kind: "NONE" } : { kind: "ONE", version: only },
    spans,
  };
}

/** Read every explicit reference in `query`. */
export function readReferences(
  query: string,
  today: IsoDate | null,
): QueryReferences {
  const source = normalizeSearchText(query);
  const scan = scanDates(query, today);
  const version = readVersion(source);
  // Dates and times are never codes. A version (`v1`) is never detected as
  // a code either, but stays a whole token the model may name exactly.
  const spans: Span[] = [...scan.spans];
  TIME.lastIndex = 0;
  for (let m = TIME.exec(source); m !== null; m = TIME.exec(source))
    spans.push([m.index, m.index + m[0].length]);

  // Offsets of the case-preserving text match `source` when lower-casing
  // keeps the length (always for Latin codes); otherwise case is ignored.
  const folded = foldCase(query);
  const cased = folded.length === source.length ? folded : source;
  const tokens: string[] = [];
  const codes: string[] = [];
  const pattern = /[a-z0-9][a-z0-9._-]*/g;
  const all: {
    readonly token: string;
    readonly written: string;
    readonly version: boolean;
  }[] = [];
  for (let m = pattern.exec(source); m !== null; m = pattern.exec(source)) {
    const raw = m[0].replace(/[._-]+$/, "");
    const end = m.index + raw.length;
    if (raw === "" || inside(spans, m.index, end)) continue;
    if (!EMPLOYEE_CODE.test(raw)) continue;
    all.push({
      token: raw.toUpperCase(),
      written: cased.slice(m.index, end),
      version: inside(version.spans, m.index, end),
    });
  }
  const whole = all.length === 1 && source === all[0]!.token.toLowerCase();
  for (const { token, written, version: inVersion } of all) {
    if (!tokens.includes(token)) tokens.push(token);
    const strong =
      !inVersion &&
      (/\d/.test(token) ||
        whole ||
        (written === token && /[A-Z]/.test(written) && !NOT_CODES.has(token)));
    if (strong && !codes.includes(token)) codes.push(token);
  }
  return {
    dates: readScan(scan),
    version: version.reading,
    tokens,
    codes,
    selection: SELECTION_REFERENCE.test(source),
  };
}

/** Words for oneself; a "name" made of them is the actor, not an employee. */
const SELF_WORDS =
  /^(?:ฉัน|ของฉัน|ผม|ของผม|ดิฉัน|หนู|เรา|ตัวเอง|ของตัวเอง|me|my|mine|myself|i)$/;

export const isSelfWord = (text: string): boolean =>
  SELF_WORDS.test(normalizeSearchText(text));
