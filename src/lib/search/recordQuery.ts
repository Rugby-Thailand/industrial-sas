/**
 * What part of a normal search query names a record.
 *
 * The date and version expressions are cut out by position, explicit codes
 * are looked up exactly, and only whole task phrases are removed around a
 * name: a whole word ("ตรวจคำขอ สมชาย"), a task phrase written directly in
 * front of the name ("แก้ตารางงานสมชาย"), or a polite particle after it.
 * Nothing is removed from inside or from the end of a name, and a prefix is
 * only cut where the rest can begin a Thai syllable, so "กิตติคุณ" and
 * "คุณากร" are searched whole. Latin words are removed only as whole words.
 */
import {
  readReferences,
  type VersionReading,
} from "../../../convex/model/search/references";
import { normalizeSearchText } from "../../../convex/model/search/text";
import { STATIC_DESTINATIONS } from "../navigation";

/** Words before a name: "ของ สมชาย", "คุณสมชาย", "ให้ EMP-1". */
const LEADING = [
  "ของ",
  "ให้",
  "ช่วย",
  "ไปที่",
  "เปิด",
  "คุณ",
  "วันที่",
  "for",
  "the",
  "of",
  "open",
  "on",
];
/** Polite particles after a request, never part of a name. */
const TRAILING = ["หน่อย", "ด้วย", "ครับ", "ค่ะ", "please"];
/** The actor, not a record. */
const SELF = ["ฉัน", "ของฉัน", "ผม", "ของผม", "ดิฉัน", "ตัวเอง", "my", "me"];

const byLength = (words: readonly string[]) =>
  [...new Set(words.map(normalizeSearchText))]
    .filter((word) => word.length > 0)
    .sort((a, b) => b.length - a.length);
const TASKS = byLength(STATIC_DESTINATIONS.flatMap((entry) => entry.aliases));
const PREFIXES = byLength([...TASKS, ...LEADING, ...SELF]);
const WHOLE = new Set(byLength([...TASKS, ...LEADING, ...TRAILING, ...SELF]));
const SUFFIXES = byLength(TRAILING);

const THAI = /[\u0E00-\u0E7F]/;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Vowels and marks that continue a syllable and cannot start one. */
const CONTINUES_SYLLABLE = /^[\u0E30-\u0E3A\u0E45-\u0E4E]/;

/**
 * Cut task phrases from the front of the first Thai word (where the rest can
 * begin a syllable) and polite particles from the end of the last, so a
 * surname such as "ชั้นดี" or "กิตติคุณ" is never cut.
 */
function stripThai(word: string, first: boolean, last: boolean): string {
  let rest = word;
  for (let changed = true; changed && rest !== "";) {
    changed = false;
    if (WHOLE.has(rest)) return "";
    for (const prefix of first ? PREFIXES : []) {
      if (!THAI.test(prefix) || prefix.length < 3) continue;
      const after = rest.slice(prefix.length);
      if (
        rest.startsWith(prefix) &&
        after !== "" &&
        !CONTINUES_SYLLABLE.test(after)
      ) {
        rest = after;
        changed = true;
        break;
      }
    }
    for (const suffix of last ? SUFFIXES : []) {
      const before = rest.slice(0, rest.length - suffix.length);
      if (THAI.test(suffix) && rest.endsWith(suffix) && before.length >= 2) {
        rest = before;
        changed = true;
        break;
      }
    }
  }
  return rest;
}

export interface RecordQuery {
  /** Text for the name comparison (two or more characters), or null. */
  readonly text: string | null;
  /** Explicit employee codes for the exact lookup (any valid length). */
  readonly codes: readonly string[];
  readonly day: {
    readonly date: string;
    readonly inferredYear: boolean;
  } | null;
  readonly range: {
    readonly from: string;
    readonly to: string;
    readonly inferredYear: boolean;
  } | null;
  /** An explicit period version (`v1`, `ฉบับ 1`), never the latest by default. */
  readonly version: VersionReading;
}

export function recordQuery(query: string, today: string | null): RecordQuery {
  const refs = readReferences(query, today);
  const reading = refs.dates;
  const mention = reading.kind === "ONE" ? reading.mention : null;
  const day =
    mention?.kind === "DATE"
      ? { date: mention.date, inferredYear: mention.inferredYear }
      : null;
  const range =
    mention?.kind === "RANGE"
      ? {
          from: mention.from,
          to: mention.to,
          inferredYear: mention.inferredYear,
        }
      : null;

  let rest = normalizeSearchText(query);
  // Cut expressions by their own text, longest first, before reading words.
  if (mention !== null) rest = rest.split(mention.text).join(" ");
  // Codes with a digit are never names; whole tokens only ("EMP-1" ≠ "EMP-10").
  for (const code of refs.codes.filter((code) => /\d/.test(code)))
    rest = rest.replace(
      new RegExp(
        `(?<![a-z0-9._-])${escape(code.toLowerCase())}(?![a-z0-9_-]|\\.[a-z0-9])`,
        "g",
      ),
      " ",
    );
  rest = rest.replace(
    /(?<![a-z0-9._-])(?:v|ver|version|revision)\.?\s*\d+|(?:ฉบับ|เวอร์ชั่?น)(?:ที่)?\s*\d+/g,
    " ",
  );
  // Multi-word task phrases ("edit schedule", "ตั้งค่า hr") as whole words.
  for (const phrase of TASKS.filter((task) => task.includes(" ")))
    rest = rest.replace(
      new RegExp(`(?<![a-z0-9])${escape(phrase)}(?![a-z0-9])`, "g"),
      " ",
    );
  const words = rest.split(" ").filter((word) => word !== "");
  const kept: string[] = [];
  words.forEach((word, index) => {
    const value = THAI.test(word)
      ? stripThai(word, kept.length === 0, index === words.length - 1)
      : WHOLE.has(word)
        ? ""
        : word;
    if (value !== "") kept.push(value);
  });
  const text = kept.join(" ");
  return {
    text: text.length >= 2 ? text : null,
    codes: refs.codes,
    day,
    range,
    version: refs.version,
  };
}
