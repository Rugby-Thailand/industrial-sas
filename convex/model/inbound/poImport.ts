/**
 * Reading a purchase-order spreadsheet, safely.
 *
 * `ADR-0007` §1 asks for previewed import with stable external references, and
 * `INV-0007-12` asks for it to be chunked, resumable, and idempotent per source
 * row. Those three requirements are really one design decision: **the row's own
 * identity travels with it**, so a re-run of a chunk recognises what it already
 * created rather than creating it again.
 *
 * ### Why the parser refuses rather than recovers
 *
 * A lenient CSV reader is the right tool for ingesting logs and the wrong one for
 * creating purchase-order lines. A row with the wrong number of columns is not a
 * row to guess at: guessing puts a quantity in the item column and creates an
 * order for a product that does not exist. Every malformed row is reported, by
 * line number, and *the preview still shows the rows that parsed* — because an
 * import that refuses the whole file over one bad line teaches people to fix the
 * file by deleting rows.
 *
 * This is why `papaparse` — installed, and used nowhere — is not used here. Its
 * error recovery is exactly the behaviour this path must not have.
 *
 * ### The source row reference
 *
 * `sourceRowRef` is `<batchRef>:<lineNumber>`, and it is the idempotency key for
 * the row. Two properties matter and both are tested: it is stable across
 * re-parses of the same file, and it distinguishes two files that contain
 * identical rows. A reference derived from the row's *contents* would collapse
 * two legitimate identical lines into one.
 *
 * No clock, no database, no Convex import (plan §6.2).
 */
import { fail, ok, type Result } from "../result";

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

export type ImportError =
  | { readonly code: "FILE_EMPTY" }
  | { readonly code: "HEADER_MISSING_COLUMN"; readonly column: string }
  | { readonly code: "HEADER_DUPLICATE_COLUMN"; readonly column: string }
  | { readonly code: "FILE_TOO_LARGE"; readonly limit: number }
  | { readonly code: "TOO_MANY_ROWS"; readonly limit: number }
  | { readonly code: "BATCH_REFERENCE_INVALID" }
  | { readonly code: "UNTERMINATED_QUOTE"; readonly line: number }
  | { readonly code: "CHUNK_SIZE_INVALID" }
  | { readonly code: "CURSOR_INVALID" };

/** Why one row could not become a purchase-order line. */
export type RowProblem =
  | {
      readonly code: "COLUMN_COUNT_MISMATCH";
      readonly expected: number;
      readonly found: number;
    }
  | { readonly code: "VALUE_MISSING"; readonly column: string }
  | { readonly code: "QUANTITY_NOT_A_NUMBER"; readonly column: string }
  | { readonly code: "QUANTITY_NOT_POSITIVE"; readonly column: string }
  | { readonly code: "QUANTITY_TOO_PRECISE"; readonly column: string }
  | { readonly code: "VALUE_TOO_LONG"; readonly column: string };

/* -------------------------------------------------------------------------- */
/* Bounds                                                                      */
/* -------------------------------------------------------------------------- */

/** An import file is a spreadsheet a person made, not a data feed. */
export const MAX_IMPORT_CHARACTERS = 2_000_000;
export const MAX_IMPORT_ROWS = 5_000;
export const MAX_CELL_LENGTH = 200;
/** One chunk of rows per mutation, so a large file is many bounded writes. */
export const MAX_CHUNK_SIZE = 50;
export const DEFAULT_CHUNK_SIZE = 25;

/** Three decimal places, matching the ledger's minor units (`ADR-0004`). */
const QUANTITY_SCALE = 1_000;

export const REQUIRED_COLUMNS: readonly string[] = Object.freeze([
  "line_number",
  "sku",
  "quantity",
  "uom",
]);

/* -------------------------------------------------------------------------- */
/* Tokenizing                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Split delimited text into rows of cells.
 *
 * An RFC 4180 subset: comma-separated, `"`-quoted, `""` for a literal quote,
 * `\r\n` or `\n` line endings. A quote that is never closed is an error rather
 * than a row that swallows the rest of the file — the swallowing version is how
 * a 900-line import silently becomes one line.
 */
export function tokenizeDelimited(
  text: string,
): Result<readonly (readonly string[])[], ImportError> {
  if (text.length > MAX_IMPORT_CHARACTERS) {
    return fail({ code: "FILE_TOO_LARGE", limit: MAX_IMPORT_CHARACTERS });
  }

  const rows: string[][] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let quoteOpenedAt = 1;

  const endCell = () => {
    cells.push(cell);
    cell = "";
  };
  const endRow = () => {
    endCell();
    rows.push(cells);
    cells = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] as string;

    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        if (character === "\n") line += 1;
        cell += character;
      }
      continue;
    }

    if (character === '"' && cell.length === 0) {
      quoted = true;
      quoteOpenedAt = line;
      continue;
    }
    if (character === ",") {
      endCell();
      continue;
    }
    if (character === "\r") continue;
    if (character === "\n") {
      endRow();
      line += 1;
      continue;
    }
    cell += character;
  }

  if (quoted) return fail({ code: "UNTERMINATED_QUOTE", line: quoteOpenedAt });

  // A trailing newline is a formatting artefact, not an empty final row.
  if (cell.length > 0 || cells.length > 0) endRow();

  const meaningful = rows.filter(
    (row) => !(row.length === 1 && (row[0] ?? "").trim() === ""),
  );
  if (meaningful.length === 0) return fail({ code: "FILE_EMPTY" });
  if (meaningful.length - 1 > MAX_IMPORT_ROWS) {
    return fail({ code: "TOO_MANY_ROWS", limit: MAX_IMPORT_ROWS });
  }
  return ok(meaningful);
}

/* -------------------------------------------------------------------------- */
/* Preview                                                                     */
/* -------------------------------------------------------------------------- */

/** One row that parsed into something the importer could write. */
export interface ImportRow {
  /** `<batchRef>:<lineNumber>`; the row's idempotency key. */
  readonly sourceRowRef: string;
  /** The file line this came from, for the operator's own spreadsheet. */
  readonly sourceLine: number;
  readonly lineNumber: number;
  readonly sku: string;
  /** Integer minor units, converted from the file's decimal (`ADR-0004`). */
  readonly quantityMinorUnits: number;
  readonly uom: string;
}

/** One row that did not. */
export interface RejectedRow {
  readonly sourceLine: number;
  readonly problem: RowProblem;
}

export interface ImportPreview {
  readonly batchRef: string;
  readonly accepted: readonly ImportRow[];
  readonly rejected: readonly RejectedRow[];
  /** True when nothing at all can be written from this file. */
  readonly empty: boolean;
}

const BATCH_REF = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * Parse a whole file into rows to write and rows to explain.
 *
 * Both halves are returned together, always. A preview that showed only the
 * failures would hide what the import is about to do, and one that showed only
 * the successes would hide what it is about to skip.
 */
export function previewImport(input: {
  readonly batchRef: string;
  readonly text: string;
}): Result<ImportPreview, ImportError> {
  if (!BATCH_REF.test(input.batchRef)) {
    return fail({ code: "BATCH_REFERENCE_INVALID" });
  }

  const tokenized = tokenizeDelimited(input.text);
  if (!tokenized.ok) return tokenized;

  const [headerRow, ...dataRows] = tokenized.value;
  const header = (headerRow ?? []).map((cell) => cell.trim().toLowerCase());

  for (const column of REQUIRED_COLUMNS) {
    if (!header.includes(column)) {
      return fail({ code: "HEADER_MISSING_COLUMN", column });
    }
  }
  for (const [index, column] of header.entries()) {
    if (header.indexOf(column) !== index) {
      return fail({ code: "HEADER_DUPLICATE_COLUMN", column });
    }
  }

  const columnAt = (row: readonly string[], name: string): string =>
    (row[header.indexOf(name)] ?? "").trim();

  const accepted: ImportRow[] = [];
  const rejected: RejectedRow[] = [];

  for (const [index, row] of dataRows.entries()) {
    // Header is line 1, so the first data row is line 2 — the number the
    // operator sees in their own spreadsheet.
    const sourceLine = index + 2;

    if (row.length !== header.length) {
      rejected.push({
        sourceLine,
        problem: {
          code: "COLUMN_COUNT_MISMATCH",
          expected: header.length,
          found: row.length,
        },
      });
      continue;
    }

    const parsed = parseRow({
      batchRef: input.batchRef,
      sourceLine,
      lineNumberText: columnAt(row, "line_number"),
      sku: columnAt(row, "sku"),
      quantityText: columnAt(row, "quantity"),
      uom: columnAt(row, "uom"),
    });

    if (parsed.ok) accepted.push(parsed.value);
    else rejected.push({ sourceLine, problem: parsed.error });
  }

  return ok(
    Object.freeze({
      batchRef: input.batchRef,
      accepted: Object.freeze(accepted),
      rejected: Object.freeze(rejected),
      empty: accepted.length === 0,
    }),
  );
}

function parseRow(input: {
  readonly batchRef: string;
  readonly sourceLine: number;
  readonly lineNumberText: string;
  readonly sku: string;
  readonly quantityText: string;
  readonly uom: string;
}): Result<ImportRow, RowProblem> {
  for (const [column, value] of [
    ["sku", input.sku],
    ["uom", input.uom],
    ["quantity", input.quantityText],
  ] as const) {
    if (value.length === 0) return fail({ code: "VALUE_MISSING", column });
    if (value.length > MAX_CELL_LENGTH) {
      return fail({ code: "VALUE_TOO_LONG", column });
    }
  }

  const lineNumber = Number(input.lineNumberText);
  if (!Number.isSafeInteger(lineNumber) || lineNumber <= 0) {
    return fail({ code: "QUANTITY_NOT_A_NUMBER", column: "line_number" });
  }

  const quantity = parseDecimalCell(input.quantityText);
  if (!quantity.ok) return quantity;

  return ok(
    Object.freeze({
      sourceRowRef: `${input.batchRef}:${lineNumber}`,
      sourceLine: input.sourceLine,
      lineNumber,
      sku: input.sku,
      quantityMinorUnits: quantity.value,
      uom: input.uom.toUpperCase(),
    }),
  );
}

/**
 * Read a decimal quantity into integer minor units.
 *
 * Parsed from the string rather than through `Number`, because `Number("0.1") *
 * 1000` is `100.00000000000001` and the ledger stores integers. A value with
 * more than three decimal places is refused rather than rounded: a spreadsheet
 * saying `1.0005` means something the tenant has to resolve, and silently
 * storing `1.000` or `1.001` decides it for them.
 */
export function parseDecimalCell(text: string): Result<number, RowProblem> {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (match === null) {
    return fail({ code: "QUANTITY_NOT_A_NUMBER", column: "quantity" });
  }

  const whole = match[1] ?? "0";
  const fraction = match[2] ?? "";
  if (fraction.length > 3) {
    return fail({ code: "QUANTITY_TOO_PRECISE", column: "quantity" });
  }

  const minorUnits =
    Number(whole) * QUANTITY_SCALE + Number(fraction.padEnd(3, "0") || "0");

  if (!Number.isSafeInteger(minorUnits)) {
    return fail({ code: "QUANTITY_NOT_A_NUMBER", column: "quantity" });
  }
  if (minorUnits <= 0) {
    return fail({ code: "QUANTITY_NOT_POSITIVE", column: "quantity" });
  }
  return ok(minorUnits);
}

/* -------------------------------------------------------------------------- */
/* Chunking                                                                    */
/* -------------------------------------------------------------------------- */

export interface ImportChunk {
  readonly rows: readonly ImportRow[];
  /** Where the next chunk starts; `null` when this was the last. */
  readonly nextCursor: number | null;
  readonly complete: boolean;
}

/**
 * Take one bounded chunk of accepted rows.
 *
 * The cursor is an **offset into the accepted rows**, not a database cursor.
 * That is what makes the import resumable across mutations without holding a
 * transaction open: the caller re-previews the same file — parsing is
 * deterministic, so the accepted list is identical — and asks for the next
 * offset. Combined with the per-row `sourceRowRef`, a chunk replayed after a
 * crash writes nothing new (`INV-0007-12`).
 */
export function takeChunk(input: {
  readonly accepted: readonly ImportRow[];
  readonly cursor?: number | undefined;
  readonly chunkSize?: number | undefined;
}): Result<ImportChunk, ImportError> {
  const chunkSize = input.chunkSize ?? DEFAULT_CHUNK_SIZE;
  if (
    !Number.isSafeInteger(chunkSize) ||
    chunkSize <= 0 ||
    chunkSize > MAX_CHUNK_SIZE
  ) {
    return fail({ code: "CHUNK_SIZE_INVALID" });
  }

  const cursor = input.cursor ?? 0;
  if (!Number.isSafeInteger(cursor) || cursor < 0) {
    return fail({ code: "CURSOR_INVALID" });
  }
  // A cursor past the end is a stale client, not a silent empty page.
  if (cursor > input.accepted.length) return fail({ code: "CURSOR_INVALID" });

  const rows = input.accepted.slice(cursor, cursor + chunkSize);
  const next = cursor + rows.length;
  const complete = next >= input.accepted.length;

  return ok(
    Object.freeze({
      rows: Object.freeze(rows),
      nextCursor: complete ? null : next,
      complete,
    }),
  );
}
