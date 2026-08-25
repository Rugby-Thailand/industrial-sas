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

export const MAX_CURSOR_LENGTH = 8_192;

export const START_POSITION: ExportPosition = Object.freeze({});

const isStringOrAbsent = (value: unknown): value is string | undefined =>
  value === undefined || typeof value === "string";

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

export type ExportStep = "ADVANCE_SUBJECT" | "DRAIN_SUBJECT" | "FINISHED";

export const stepFor = (position: ExportPosition): ExportStep => {
  if (position.subjectId !== undefined) return "DRAIN_SUBJECT";
  return position.parentDone === true ? "FINISHED" : "ADVANCE_SUBJECT";
};
