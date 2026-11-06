/**
 * Code-point n-grams for exact substring indexes.
 *
 * If `needle` occurs in `text` (UTF-16 `includes`) and `needle` is well formed,
 * the occurrence starts and ends on code-point boundaries, so every n-gram of
 * the needle is an n-gram of the text. Postings keyed by n-gram are therefore
 * a complete candidate superset; callers re-check `includes` on live data.
 */

/** Gram value of rows that are not posted gram by gram (always candidates). */
export const UNPOSTED_GRAM = "";

/** No lone surrogate: substring and code-point containment agree. */
export function isWellFormed(text: string) {
  return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(
    text,
  );
}

export function codePointLength(text: string) {
  let length = 0;
  for (const _ of text) length++;
  return length;
}

/** Distinct n-grams in first-occurrence order; empty below n code points. */
export function gramsOf(text: string, n: number): string[] {
  const points = [...text];
  const grams = new Set<string>();
  for (let start = 0; start + n <= points.length; start++)
    grams.add(points.slice(start, start + n).join(""));
  return [...grams];
}

/**
 * At most `limit` distinct grams of a needle, spread from both ends: any
 * subset is a valid filter, and spreading keeps rare ends (codes, suffixes).
 */
export function probeGrams(needle: string, n: number, limit: number) {
  const grams = gramsOf(needle, n);
  if (grams.length <= limit) return grams;
  // Steps are wider than one gram, so the picked positions are distinct.
  return Array.from(
    { length: limit },
    (_, index) =>
      grams[Math.round((index * (grams.length - 1)) / (limit - 1))]!,
  );
}
