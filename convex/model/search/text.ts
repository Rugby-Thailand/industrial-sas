/**
 * Search text normalization shared by the menu matcher, the HR entity
 * resolvers and AI grounding.
 *
 * Thai vowels and tone marks are kept: removing them would merge different
 * names. Only width/case/digit/dash variants that never change meaning are
 * folded, so `EMP–๐๐๓` and `emp-003` compare equal.
 */

const THAI_DIGIT = /[๐-๙]/g;
const DASHES = /[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g;

export const MAX_SEARCH_TEXT = 300;

export function normalizeSearchText(input: string): string {
  return input
    .normalize("NFC")
    .replace(THAI_DIGIT, (digit) => String(digit.charCodeAt(0) - 0x0e50))
    .replace(DASHES, "-")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Employee codes as stored, before upper-casing (see `normalizeEmployeeCode`):
 * one to 32 characters, so `A`, `12` and `NIGHT` are valid codes. Which
 * tokens of a query count as codes is decided in `references.ts`.
 */
export const EMPLOYEE_CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;

/** True when `needle` occurs in `haystack` after normalization. */
export const containsNormalized = (haystack: string, needle: string) => {
  const target = normalizeSearchText(needle);
  return target.length > 0 && normalizeSearchText(haystack).includes(target);
};
