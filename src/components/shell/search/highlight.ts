import { normalizeSearchText } from "../../../../convex/model/search/text";

export interface TextPart {
  readonly text: string;
  readonly match: boolean;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * `text` folded exactly as `normalizeSearchText` folds it, one source
 * character at a time, with the source index of every folded unit. Runs of
 * whitespace collapse to one space and the ends are trimmed, as there.
 */
function foldWithMap(text: string): {
  readonly value: string;
  readonly map: readonly number[];
} {
  let value = "";
  const map: number[] = [];
  for (let index = 0; index < text.length;) {
    const char = String.fromCodePoint(text.codePointAt(index)!);
    if (/\s/.test(char)) {
      if (value !== "" && !value.endsWith(" ")) {
        value += " ";
        map.push(index);
      }
    } else
      for (const unit of normalizeSearchText(char).split("")) {
        value += unit;
        map.push(index);
      }
    index += char.length;
  }
  if (value.endsWith(" ")) {
    value = value.slice(0, -1);
    map.pop();
  }
  return { value, map };
}

/** The longest run of `a` that also occurs in `b`, without edge spaces. */
function longestCommon(a: string, b: string): string {
  let best = "";
  let previous = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const row = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1)
      if (a[i - 1] === b[j - 1]) {
        row[j] = previous[j - 1]! + 1;
        if (row[j]! > best.length) best = a.slice(i - row[j]!, i);
      }
    previous = row;
  }
  return best.trim();
}

/**
 * The parts of `title` that match `query`, compared with the same folding
 * the matcher uses (case, Thai digits, dashes, spacing). The whole query is
 * highlighted when it occurs; otherwise each word of two or more characters;
 * otherwise, as the matcher also accepts a name written inside a longer
 * query ("พาเลทของสินค้า…" finds "สินค้าสำเร็จรูป"), the longest run of
 * three or more characters the two share. A range always covers whole
 * grapheme clusters, so a Thai vowel or tone mark is never split from its
 * consonant.
 */
export function highlightParts(
  title: string,
  query: string,
): readonly TextPart[] {
  const source = title.normalize("NFC");
  const needle = normalizeSearchText(query);
  if (needle === "") return [{ text: source, match: false }];
  const { value, map } = foldWithMap(source);
  const bounds = new Set([source.length]);
  for (const { index } of graphemes.segment(source)) bounds.add(index);

  const ranges: [number, number][] = [];
  const add = (term: string): boolean => {
    const at = value.indexOf(term);
    if (at === -1) return false;
    let start = map[at]!;
    const last = map[at + term.length - 1]!;
    let end = last + String.fromCodePoint(source.codePointAt(last)!).length;
    while (!bounds.has(start)) start -= 1;
    while (!bounds.has(end)) end += 1;
    if (ranges.some(([from, to]) => start < to && from < end)) return false;
    ranges.push([start, end]);
    return true;
  };
  if (!add(needle)) {
    for (const word of needle
      .split(" ")
      .filter((word) => word.length >= 2)
      .sort((a, b) => b.length - a.length))
      add(word);
    const shared = ranges.length === 0 ? longestCommon(value, needle) : "";
    if (shared.length >= 3) add(shared);
  }

  const parts: TextPart[] = [];
  let cursor = 0;
  for (const [start, end] of ranges.sort((a, b) => a[0] - b[0])) {
    if (start > cursor)
      parts.push({ text: source.slice(cursor, start), match: false });
    parts.push({ text: source.slice(start, end), match: true });
    cursor = end;
  }
  if (cursor < source.length)
    parts.push({ text: source.slice(cursor), match: false });
  return parts;
}
