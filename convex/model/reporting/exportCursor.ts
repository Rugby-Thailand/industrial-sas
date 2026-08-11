/**
 * Where a chunked export has got to, when "where" is two levels deep.
 *
 * Most exports walk one table and need one cursor. Receipt lines do not: a line
 * has no warehouse of its own, so the walk is *this site's receipts*, and then
 * *each receipt's lines*. A cursor over receipts alone cannot say "I am halfway
 * through receipt 47" — and an implementation that took a fixed number of lines
 * per receipt would silently omit the rest of a large delivery. A stock extract
 * that looks complete and is short is the worst failure this feature has.
 *
 * So the position is a small record rather than a string:
 *
 * - `outer` — the cursor over the parent walk (receipts).
 * - `parentDone` — the parent walk is exhausted; the current subject is the last.
 * - `subjectId` — the parent row currently being drained, if any.
 * - `inner` — the cursor within that parent's children.
 *
 * `parentDone` exists because "no parent cursor" is ambiguous, and the ambiguity
 * is a live lock: the start of a walk and the end of one both have nothing to
 * resume from, so a step that read "no cursor" as "start from the beginning"
 * re-exported the first receipt for ever. Recording exhaustion as its own fact
 * is what tells those two states apart.
 *
 * ### Why the shape forces one cursored read per step
 *
 * A Convex function execution may perform only one indexed read that has a
 * continuation (`convex/lib/tenantStorage.ts`). Advancing the parent and draining
 * a child are therefore *different steps*: `subjectId === undefined` means the
 * next chunk advances the parent and appends nothing; otherwise it drains
 * children and appends rows. Encoding that in the cursor is what keeps the rule
 * checkable rather than remembered.
 *
 * Pure module (plan §6.2): no Convex imports, no I/O.
 */

/** A position in a one- or two-level walk. */
export interface ExportPosition {
  readonly outer?: string;
  readonly parentDone?: boolean;
  readonly subjectId?: string;
  readonly inner?: string;
}

export type ExportCursorError =
  | { readonly code: "CURSOR_UNPARSEABLE" }
  | { readonly code: "CURSOR_MALFORMED" }
  | { readonly code: "CURSOR_TOO_LONG"; readonly length: number };

/**
 * The most an encoded position may occupy.
 *
 * Convex cursors are opaque and can be long; two of them plus a document ID has
 * to stay well inside a document field. A position that exceeded this would be a
 * position that cannot be *stored*, and finding that out at write time — after a
 * chunk had already been rendered — would lose the work.
 */
export const MAX_CURSOR_LENGTH = 8_192;

/** The start of a walk: no parent cursor, no subject, no child cursor. */
export const START_POSITION: ExportPosition = Object.freeze({});

const isStringOrAbsent = (value: unknown): value is string | undefined =>
  value === undefined || typeof value === "string";

/**
 * Encode a position for storage.
 *
 * Absent fields are omitted rather than written as `null`, so a start position
 * encodes to `{}` and the "advance the parent next" state is visibly the absence
 * of a subject rather than a sentinel somebody has to remember the meaning of.
 */
export function encodeExportPosition(
  position: ExportPosition,
):
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: ExportCursorError } {
  const encoded = JSON.stringify({
    ...(position.outer === undefined ? {} : { outer: position.outer }),
    ...(position.parentDone === true ? { parentDone: true } : {}),
    ...(position.subjectId === undefined
      ? {}
      : { subjectId: position.subjectId }),
    ...(position.inner === undefined ? {} : { inner: position.inner }),
  });

  return encoded.length > MAX_CURSOR_LENGTH
    ? { ok: false, error: { code: "CURSOR_TOO_LONG", length: encoded.length } }
    : { ok: true, value: encoded };
}

/**
 * Read a stored position back.
 *
 * An absent cursor is the start of the walk, which is a legitimate state and not
 * an error. Anything present and unreadable *is* an error: continuing from a
 * position nobody can interpret would restart the export from the beginning and
 * duplicate every row already written.
 */
export function decodeExportPosition(
  cursor: string | undefined,
):
  | { readonly ok: true; readonly value: ExportPosition }
  | { readonly ok: false; readonly error: ExportCursorError } {
  if (cursor === undefined || cursor === "") {
    return { ok: true, value: START_POSITION };
  }
  if (cursor.length > MAX_CURSOR_LENGTH) {
    return {
      ok: false,
      error: { code: "CURSOR_TOO_LONG", length: cursor.length },
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cursor);
  } catch {
    return { ok: false, error: { code: "CURSOR_UNPARSEABLE" } };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: { code: "CURSOR_MALFORMED" } };
  }

  const record = parsed as Record<string, unknown>;
  if (
    !isStringOrAbsent(record["outer"]) ||
    !isStringOrAbsent(record["subjectId"]) ||
    !isStringOrAbsent(record["inner"]) ||
    (record["parentDone"] !== undefined && record["parentDone"] !== true)
  ) {
    return { ok: false, error: { code: "CURSOR_MALFORMED" } };
  }

  /*
   * An inner cursor without a subject is incoherent: it says "halfway through a
   * receipt" without saying which. Refusing beats guessing, because guessing
   * means either skipping a receipt's lines or exporting another's twice.
   */
  if (record["inner"] !== undefined && record["subjectId"] === undefined) {
    return { ok: false, error: { code: "CURSOR_MALFORMED" } };
  }

  return {
    ok: true,
    value: Object.freeze({
      ...(record["outer"] === undefined ? {} : { outer: record["outer"] }),
      ...(record["parentDone"] === true ? { parentDone: true } : {}),
      ...(record["subjectId"] === undefined
        ? {}
        : { subjectId: record["subjectId"] }),
      ...(record["inner"] === undefined ? {} : { inner: record["inner"] }),
    }),
  };
}

/**
 * What the next chunk of a two-level walk must do.
 *
 * Named rather than inferred at the call site, so the "one cursored read per
 * execution" rule reads as a decision in the code instead of as a comment.
 */
export type ExportStep = "ADVANCE_SUBJECT" | "DRAIN_SUBJECT" | "FINISHED";

export const stepFor = (position: ExportPosition): ExportStep => {
  if (position.subjectId !== undefined) return "DRAIN_SUBJECT";
  return position.parentDone === true ? "FINISHED" : "ADVANCE_SUBJECT";
};
