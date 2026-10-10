/**
 * Deterministic date expressions for search and AI grounding.
 *
 * Supported: วันนี้/เมื่อวาน/เมื่อวานซืน/พรุ่งนี้ (today, yesterday, …),
 * "N วันก่อน" / "N days ago", ISO dates, d/m/yyyy, Thai and English month
 * names (full or abbreviated, with or without dots), day ranges such as
 * "19–25 ก.ย. 2569", Thai digits, and Buddhist-era (≥ 2400 or พ.ศ.) or
 * Common-era years. Relative words use the organization business date
 * supplied by the caller, so the browser's zone never decides "yesterday".
 * An overnight shift belongs to the business date it started on, which is
 * exactly what these dates name.
 *
 * Two explicit dates joined by "to" / "ถึง" / a dash are one range
 * ("2026-09-19 to 2026-09-25"). A weekday written next to a date is
 * accepted only when it is that date's weekday; any other weekday, and
 * relative qualifiers ("last week", "เดือนนี้") next to a date, are a
 * conflict, never silently dropped. Two-digit years, d/m with an ambiguous
 * CE order and missing years are reported so the caller asks or confirms
 * instead of guessing.
 */
import {
  addDays,
  compareDates,
  isIsoDate,
  isoWeekday,
  type IsoDate,
} from "../hr/calendar";
import { normalizeSearchText } from "./text";

export type DateMention =
  | {
      readonly kind: "DATE";
      readonly date: IsoDate;
      readonly text: string;
      /** The year was not written; the latest past occurrence was assumed. */
      readonly inferredYear: boolean;
    }
  | {
      readonly kind: "RANGE";
      readonly from: IsoDate;
      readonly to: IsoDate;
      readonly text: string;
      readonly inferredYear: boolean;
    }
  | {
      readonly kind: "AMBIGUOUS" | "INVALID";
      readonly text: string;
    };

export interface DateScan {
  readonly mentions: readonly DateMention[];
  /** Date-like words this parser deliberately does not interpret. */
  readonly unsupported: boolean;
  /** ISO weekdays (1 = Monday) named in the text. */
  readonly weekdays: readonly number[];
  /** Relative qualifiers such as "last week" or "เดือนนี้". */
  readonly qualifiers: boolean;
  /**
   * `[start, end)` offsets in `normalizeSearchText(text)` of every date or
   * temporal expression, so tokens inside them are never employee codes.
   */
  readonly spans: readonly (readonly [number, number])[];
}

const MONTH_NAMES: readonly (readonly [number, readonly string[]])[] = [
  [1, ["มกราคม", "ม.ค.", "january", "jan"]],
  [2, ["กุมภาพันธ์", "ก.พ.", "february", "feb"]],
  [3, ["มีนาคม", "มี.ค.", "march", "mar"]],
  [4, ["เมษายน", "เม.ย.", "april", "apr"]],
  [5, ["พฤษภาคม", "พ.ค.", "may"]],
  [6, ["มิถุนายน", "มิ.ย.", "june", "jun"]],
  [7, ["กรกฎาคม", "ก.ค.", "july", "jul"]],
  [8, ["สิงหาคม", "ส.ค.", "august", "aug"]],
  [9, ["กันยายน", "ก.ย.", "september", "sept", "sep"]],
  [10, ["ตุลาคม", "ต.ค.", "october", "oct"]],
  [11, ["พฤศจิกายน", "พ.ย.", "november", "nov"]],
  [12, ["ธันวาคม", "ธ.ค.", "december", "dec"]],
];

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Dots in Thai abbreviations are optional: ต.ค. / ต.ค / ตค. */
const monthPattern = (name: string) =>
  /[a-z]/.test(name)
    ? `(?<![a-z])${escape(name)}(?![a-z])`
    : name.split(".").filter(Boolean).map(escape).join("\\.?") +
      (name.includes(".") ? "\\.?" : "");

const MONTH_LOOKUP: readonly (readonly [RegExp, number])[] =
  MONTH_NAMES.flatMap(([month, names]) =>
    names.map(
      (name) => [new RegExp(`^${monthPattern(name)}$`), month] as const,
    ),
  );
const MONTH = `(${MONTH_NAMES.flatMap(([, names]) => names)
  .sort((a, b) => b.length - a.length)
  .map(monthPattern)
  .join("|")})`;
const ENGLISH_MONTH = `(${MONTH_NAMES.flatMap(([, names]) => names)
  .filter((name) => /[a-z]/.test(name))
  .sort((a, b) => b.length - a.length)
  .map(monthPattern)
  .join("|")})`;
const ERA = "(พ\\.?ศ\\.?|ค\\.?ศ\\.?|b\\.?e\\.?|c\\.?e\\.?|a\\.?d\\.?)";
const YEAR = `(?:\\s*,?\\s*${ERA}?\\s*(\\d{2,4})(?!\\d))?`;
const DAY = "(?<!\\d)(\\d{1,2})(?!\\d)";
const RANGE_JOIN = "\\s*(?:-|ถึง|to|until)\\s*";

function monthNumber(text: string): number | null {
  for (const [pattern, month] of MONTH_LOOKUP)
    if (pattern.test(text)) return month;
  return null;
}

type Year =
  | { readonly kind: "YEAR"; readonly year: number }
  | { readonly kind: "MISSING" }
  | { readonly kind: "AMBIGUOUS" };

function resolveYear(
  era: string | undefined,
  digits: string | undefined,
): Year {
  if (digits === undefined) return { kind: "MISSING" };
  if (digits.length !== 4) return { kind: "AMBIGUOUS" };
  const value = Number(digits);
  const buddhist =
    era !== undefined && /^(พ|b)/.test(era)
      ? true
      : era !== undefined
        ? false
        : value >= 2400;
  return { kind: "YEAR", year: buddhist ? value - 543 : value };
}

const pad = (value: number) => String(value).padStart(2, "0");
const iso = (year: number, month: number, day: number) =>
  `${String(year).padStart(4, "0")}-${pad(month)}-${pad(day)}`;

/** A written day/month with its year, or the latest past occurrence. */
function dated(
  day: number,
  month: number,
  year: Year,
  today: IsoDate | null,
): { date: IsoDate; inferred: boolean } | "AMBIGUOUS" | "INVALID" {
  if (year.kind === "AMBIGUOUS") return "AMBIGUOUS";
  if (year.kind === "MISSING") {
    if (today === null) return "AMBIGUOUS";
    const current = Number(today.slice(0, 4));
    for (const candidate of [current, current - 1]) {
      const date = iso(candidate, month, day);
      if (isIsoDate(date) && compareDates(date, today) <= 0)
        return { date, inferred: true };
    }
    return "INVALID";
  }
  const date = iso(year.year, month, day);
  return isIsoDate(date) ? { date, inferred: false } : "INVALID";
}

interface Found {
  readonly start: number;
  readonly end: number;
  readonly mention: DateMention;
}

const RELATIVE: readonly (readonly [RegExp, number])[] = [
  [/เมื่อวานซืน|day before yesterday/g, -2],
  [/เมื่อวานนี้|เมื่อวาน|วานนี้|yesterday/g, -1],
  [/วันนี้|(?<![a-z])today(?![a-z])/g, 0],
  [/พรุ่งนี้|(?<![a-z])tomorrow(?![a-z])/g, 1],
];

const WEEKDAYS: readonly (readonly [RegExp, number])[] = [
  [/วันจันทร์|(?<![a-z])monday(?![a-z])/g, 1],
  [/วันอังคาร|(?<![a-z])tuesday(?![a-z])/g, 2],
  [/วันพุธ|(?<![a-z])wednesday(?![a-z])/g, 3],
  [/วันพฤหัส(?:บดี)?|(?<![a-z])thursday(?![a-z])/g, 4],
  [/วันศุกร์|(?<![a-z])friday(?![a-z])/g, 5],
  [/วันเสาร์|(?<![a-z])saturday(?![a-z])/g, 6],
  [/วันอาทิตย์|(?<![a-z])sunday(?![a-z])/g, 7],
];

/** Relative periods this parser does not resolve to a day. */
const QUALIFIERS =
  /(?:สัปดาห์|อาทิตย์|เดือน|ปี)(?:ที่แล้ว|ก่อน|นี้|หน้า)|(?<![a-z])(?:last|this|next|previous|past) (?:week|month|year)(?![a-z])|(?<![a-z])(?:last|next) (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?![a-z])/g;

/** Between two dates, these make one range: "a to b", "a – b", "a ถึง b". */
const BETWEEN_RANGE = /^\s*(?:-|ถึง|จนถึง|to|until|through|thru)\s*$/;

/** Every date expression in `text`, longest match first where they overlap. */
export function scanDates(text: string, today: IsoDate | null): DateScan {
  const source = normalizeSearchText(text);
  const found: Found[] = [];
  const add = (match: RegExpExecArray, mention: DateMention) =>
    found.push({
      start: match.index,
      end: match.index + match[0].length,
      mention,
    });
  const each = (pattern: string | RegExp, fn: (m: RegExpExecArray) => void) => {
    const regex =
      typeof pattern === "string" ? new RegExp(pattern, "g") : pattern;
    regex.lastIndex = 0;
    for (let m = regex.exec(source); m !== null; m = regex.exec(source)) fn(m);
  };
  const single = (
    m: RegExpExecArray,
    day: number,
    month: number | null,
    year: Year,
  ) => {
    const text = m[0].trim();
    if (month === null) return add(m, { kind: "INVALID", text });
    const result = dated(day, month, year, today);
    if (result === "AMBIGUOUS" || result === "INVALID")
      return add(m, { kind: result, text });
    add(m, {
      kind: "DATE",
      date: result.date,
      text,
      inferredYear: result.inferred,
    });
  };
  const range = (
    m: RegExpExecArray,
    fromDay: number,
    fromMonth: number | null,
    toDay: number,
    toMonth: number | null,
    year: Year,
  ) => {
    const text = m[0].trim();
    if (fromMonth === null || toMonth === null)
      return add(m, { kind: "INVALID", text });
    const to = dated(toDay, toMonth, year, today);
    if (to === "AMBIGUOUS" || to === "INVALID")
      return add(m, { kind: to, text });
    // A missing year was inferred from the end date so the range stays whole.
    const fromYear: Year = {
      kind: "YEAR",
      year: Number(to.date.slice(0, 4)) - (fromMonth > toMonth ? 1 : 0),
    };
    const from = dated(fromDay, fromMonth, fromYear, today);
    if (from === "AMBIGUOUS" || from === "INVALID")
      return add(m, { kind: from, text });
    if (compareDates(from.date, to.date) > 0)
      return add(m, { kind: "INVALID", text });
    add(m, {
      kind: "RANGE",
      from: from.date,
      to: to.date,
      text,
      inferredYear: to.inferred,
    });
  };

  for (const [pattern, delta] of RELATIVE)
    each(pattern, (m) => {
      const text = m[0];
      if (today === null) return add(m, { kind: "AMBIGUOUS", text });
      add(m, {
        kind: "DATE",
        date: addDays(today, delta),
        text,
        inferredYear: false,
      });
    });
  each(/(?<!\d)(\d{1,3})\s*(?:วันก่อน|วันที่แล้ว|days? ago)/g, (m) => {
    const count = Number(m[1]);
    if (today === null || count > 366)
      return add(m, { kind: "AMBIGUOUS", text: m[0] });
    add(m, {
      kind: "DATE",
      date: addDays(today, -count),
      text: m[0],
      inferredYear: false,
    });
  });
  each(/(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/g, (m) =>
    single(
      m,
      Number(m[3]),
      Number(m[2]) >= 1 && Number(m[2]) <= 12 ? Number(m[2]) : null,
      resolveYear(undefined, m[1]),
    ),
  );
  each(/(?<![\d.])(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})(?![\d])/g, (m) => {
    const first = Number(m[1]);
    const second = Number(m[2]);
    const year = resolveYear(undefined, m[3]);
    if (year.kind !== "YEAR") return add(m, { kind: "AMBIGUOUS", text: m[0] });
    const buddhist = Number(m[3]) >= 2400;
    // A Buddhist-era year is Thai day/month order. A Common-era year with
    // both parts ≤ 12 could be either order, so it is asked, not guessed.
    if (!buddhist && first <= 12 && second <= 12 && first !== second)
      return add(m, { kind: "AMBIGUOUS", text: m[0] });
    const dayFirst = buddhist || second <= 12;
    const [day, month] = dayFirst ? [first, second] : [second, first];
    single(m, day, month <= 12 ? month : null, year);
  });
  each(`${DAY}\\s*${MONTH}${RANGE_JOIN}${DAY}\\s*${MONTH}${YEAR}`, (m) =>
    range(
      m,
      Number(m[1]),
      monthNumber(m[2]!),
      Number(m[3]),
      monthNumber(m[4]!),
      resolveYear(m[5], m[6]),
    ),
  );
  each(`${DAY}${RANGE_JOIN}${DAY}\\s*${MONTH}${YEAR}`, (m) => {
    const month = monthNumber(m[3]!);
    range(m, Number(m[1]), month, Number(m[2]), month, resolveYear(m[4], m[5]));
  });
  each(`${DAY}\\s*${MONTH}${YEAR}`, (m) =>
    single(m, Number(m[1]), monthNumber(m[2]!), resolveYear(m[3], m[4])),
  );
  each(
    `${ENGLISH_MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?!\\d)(?:\\s*,?\\s*(\\d{4})(?!\\d))?`,
    (m) =>
      single(m, Number(m[2]), monthNumber(m[1]!), resolveYear(undefined, m[3])),
  );

  // Keep the longest expression where matches overlap (a range over its parts).
  found.sort(
    (a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start,
  );
  const kept: Found[] = [];
  for (const candidate of found)
    if (
      !kept.some(
        (other) => candidate.start < other.end && other.start < candidate.end,
      )
    )
      kept.push(candidate);
  kept.sort((a, b) => a.start - b.start);

  // "2026-09-19 to 2026-09-25": two explicit days joined as one range.
  const joined: Found[] = [];
  for (const entry of kept) {
    const previous = joined.at(-1);
    if (
      previous !== undefined &&
      previous.mention.kind === "DATE" &&
      entry.mention.kind === "DATE" &&
      BETWEEN_RANGE.test(source.slice(previous.end, entry.start))
    ) {
      const from = previous.mention;
      const to = entry.mention;
      const text = source.slice(previous.start, entry.end);
      joined[joined.length - 1] = {
        start: previous.start,
        end: entry.end,
        mention:
          compareDates(from.date, to.date) > 0
            ? { kind: "INVALID", text }
            : {
                kind: "RANGE",
                from: from.date,
                to: to.date,
                text,
                inferredYear: from.inferredYear || to.inferredYear,
              },
      };
    } else joined.push(entry);
  }

  const spans: (readonly [number, number])[] = found.map(
    (entry) => [entry.start, entry.end] as const,
  );
  const weekdays: number[] = [];
  for (const [pattern, weekday] of WEEKDAYS)
    each(pattern, (m) => {
      weekdays.push(weekday);
      spans.push([m.index, m.index + m[0].length]);
    });
  let qualifiers = false;
  each(QUALIFIERS, (m) => {
    qualifiers = true;
    spans.push([m.index, m.index + m[0].length]);
  });
  return {
    mentions: joined.map((entry) => entry.mention),
    unsupported: qualifiers || weekdays.length > 0,
    weekdays,
    qualifiers,
    spans,
  };
}

export type DateReading =
  | { readonly kind: "NONE" }
  | { readonly kind: "ONE"; readonly mention: DateMention }
  | { readonly kind: "CONFLICT" }
  | { readonly kind: "UNSUPPORTED" };

/**
 * One unambiguous reading of the text, or why there is none. A weekday or
 * relative qualifier that disagrees with the written date is a conflict:
 * the recognised fragment alone is never taken.
 */
export function readDates(text: string, today: IsoDate | null): DateReading {
  return readScan(scanDates(text, today));
}

export function readScan(scan: DateScan): DateReading {
  const distinct = new Map<string, DateMention>();
  for (const mention of scan.mentions)
    distinct.set(
      mention.kind === "DATE"
        ? mention.date
        : mention.kind === "RANGE"
          ? `${mention.from}/${mention.to}`
          : `${mention.kind}:${mention.text}`,
      mention,
    );
  if (distinct.size > 1) return { kind: "CONFLICT" };
  const only = [...distinct.values()][0];
  if (only === undefined)
    return scan.unsupported ? { kind: "UNSUPPORTED" } : { kind: "NONE" };
  if (scan.qualifiers) return { kind: "CONFLICT" };
  if (scan.weekdays.length > 0) {
    // "วันพฤหัสบดีที่ 8 ต.ค. 2569" names the same day twice; any other
    // weekday, or a weekday beside a range, cannot be reconciled.
    const consistent =
      only.kind === "DATE" &&
      scan.weekdays.every((weekday) => weekday === isoWeekday(only.date));
    if (!consistent) return { kind: "CONFLICT" };
  }
  return { kind: "ONE", mention: only };
}
