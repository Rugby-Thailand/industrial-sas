/**
 * Rendering a row set as CSV somebody can open without being attacked by it.
 *
 * CSV looks like the format with no decisions in it, which is why it has more
 * bugs than any other export format. Three of them are load-bearing here:
 *
 * 1. **Quoting.** A field containing a comma, a quote, or a newline must be
 *    quoted and its quotes doubled (RFC 4180). A Thai supplier name with a comma
 *    in it silently shifts every later column otherwise, and nobody reads the
 *    misalignment as corruption — they read the wrong number.
 * 2. **Formula injection.** A field beginning `=`, `+`, `-`, `@`, tab, or
 *    carriage return is executed by spreadsheet software when the file is
 *    opened. An item code somebody typed as `=cmd|...` becomes code running on a
 *    supervisor's laptop. The value is preserved exactly and prefixed with a
 *    single quote, which every spreadsheet reads as "this is text".
 * 3. **Line endings.** CRLF, because that is what RFC 4180 says and what Excel
 *    on Windows expects; a Thai-locale Excel opening an LF-only file is a
 *    support ticket nobody can reproduce on a Mac.
 *
 * A BOM is emitted for the same reason: without it, Excel decodes UTF-8 Thai as
 * Windows-874 and every product name becomes mojibake. The BOM is stated in the
 * contract rather than assumed, because a checksum over the artifact has to
 * cover it.
 *
 * Pure module (plan §6.2): no Convex imports, no I/O.
 */

/** RFC 4180's terminator. */
export const CSV_LINE_ENDING = "\r\n";

/** What makes Excel read a UTF-8 file as UTF-8. */
export const CSV_BOM = "﻿";

/** The characters a spreadsheet treats as the start of a formula. */
const FORMULA_STARTERS = ["=", "+", "-", "@", "\t", "\r"];

/**
 * One field, quoted and de-fanged.
 *
 * The value is never altered, only wrapped: an injection-prefixed field still
 * round-trips to the original string once the leading quote is stripped, so an
 * export remains evidence rather than a lossy rendering.
 */
export function csvField(value: string): string {
  const guarded = FORMULA_STARTERS.some((starter) => value.startsWith(starter))
    ? `'${value}`
    : value;

  return /[",\r\n]/.test(guarded)
    ? `"${guarded.replaceAll('"', '""')}"`
    : guarded;
}

/** One record, in the column order its caller declared. */
export function csvRow(values: readonly string[]): string {
  return values.map(csvField).join(",");
}

/**
 * A header line plus its rows, ready to append to.
 *
 * The header is emitted separately from the rows because an export is written in
 * chunks: the first chunk carries the header, and every later chunk appends rows
 * to an artifact that already has one. A renderer that always emitted a header
 * would produce a file with one per chunk, which reads as data.
 */
export function csvHeader(columns: readonly string[]): string {
  return `${CSV_BOM}${csvRow(columns)}${CSV_LINE_ENDING}`;
}

export function csvRows(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => `${csvRow(row)}${CSV_LINE_ENDING}`).join("");
}

/**
 * The size of a string as bytes, not as characters.
 *
 * Thai is three bytes per character in UTF-8, so a length check in characters
 * under-counts a Thai export by a factor of three — and the cap this feeds
 * exists to keep a document within a storage limit measured in bytes.
 */
export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Whether one more chunk still fits.
 *
 * Asked *before* appending rather than after, because an artifact that has
 * already exceeded its limit cannot be written back to check.
 */
export function fitsWithin(
  currentBytes: number,
  additionBytes: number,
  capBytes: number,
): boolean {
  return currentBytes + additionBytes <= capBytes;
}
