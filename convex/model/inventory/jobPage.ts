import {
  frozenArray,
  isBoolean,
  isRecord,
  isSafeInt,
  isString,
} from "../guards";
import { fail, ok, type Result } from "../result";

export const MAX_JOB_PAGE_SIZE = 100;

export const DEFAULT_JOB_PAGE_SIZE = 50;

export const MAX_JOB_CURSOR_LENGTH = 4096;

export type JobPageError =
  | { readonly code: "NOT_A_JOB_PAGE_REQUEST"; readonly received: string }
  | {
      readonly code: "PAGE_SIZE_INVALID";
      readonly received: string;
    }
  | {
      readonly code: "PAGE_SIZE_TOO_LARGE";
      readonly requested: number;
      readonly limit: number;
    }
  | { readonly code: "CURSOR_INVALID"; readonly received: string }
  | {
      readonly code: "CURSOR_TOO_LONG";
      readonly length: number;
      readonly limit: number;
    }
  | {
      readonly code: "PAGE_OVERFLOW";
      readonly returned: number;
      readonly requested: number;
    }
  | {
      readonly code: "CURSOR_MISSING_FOR_CONTINUATION";
    }
  | { readonly code: "CURSOR_PRESENT_ON_COMPLETE_PAGE" };

export interface JobPageRequest {
  readonly maxPageSize: number;

  readonly cursor: string | null;
}

export interface JobPage<Item> {
  readonly items: readonly Item[];
  readonly nextCursor: string | null;
  readonly complete: boolean;

  readonly requestedPageSize: number;
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (isString(value)) {
    return value.length > 48 ? `${value.slice(0, 48)}…` : value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "non-finite";
  }
  return typeof value;
}

function validateCursor(cursor: unknown): Result<string | null, JobPageError> {
  if (cursor === null || cursor === undefined) return ok(null);
  if (!isString(cursor) || cursor.length === 0) {
    return fail({ code: "CURSOR_INVALID", received: describe(cursor) });
  }
  if (cursor.length > MAX_JOB_CURSOR_LENGTH) {
    return fail({
      code: "CURSOR_TOO_LONG",
      length: cursor.length,
      limit: MAX_JOB_CURSOR_LENGTH,
    });
  }
  return ok(cursor);
}

export function makeJobPageRequest(
  input: {
    readonly maxPageSize?: number | undefined;
    readonly cursor?: string | null | undefined;
  } = {},
): Result<JobPageRequest, JobPageError> {
  if (!isRecord(input)) {
    return fail({ code: "NOT_A_JOB_PAGE_REQUEST", received: describe(input) });
  }
  const requested = input.maxPageSize ?? DEFAULT_JOB_PAGE_SIZE;
  if (!isSafeInt(requested) || requested < 1) {
    return fail({ code: "PAGE_SIZE_INVALID", received: describe(requested) });
  }
  if (requested > MAX_JOB_PAGE_SIZE) {
    return fail({
      code: "PAGE_SIZE_TOO_LARGE",
      requested,
      limit: MAX_JOB_PAGE_SIZE,
    });
  }
  const cursor = validateCursor(input.cursor);
  if (!cursor.ok) return cursor;

  return ok(Object.freeze({ maxPageSize: requested, cursor: cursor.value }));
}

export function makeJobPage<Item>(
  request: JobPageRequest,
  items: readonly Item[],
  continuation: {
    readonly isDone: boolean;
    readonly cursor?: string | null | undefined;
  },
): Result<JobPage<Item>, JobPageError> {
  if (!isRecord(request) || !isSafeInt(request.maxPageSize)) {
    return fail({
      code: "NOT_A_JOB_PAGE_REQUEST",
      received: describe(request),
    });
  }
  if (!Array.isArray(items)) {
    return fail({ code: "NOT_A_JOB_PAGE_REQUEST", received: describe(items) });
  }
  if (items.length > request.maxPageSize) {
    return fail({
      code: "PAGE_OVERFLOW",
      returned: items.length,
      requested: request.maxPageSize,
    });
  }
  if (!isRecord(continuation) || !isBoolean(continuation.isDone)) {
    return fail({
      code: "NOT_A_JOB_PAGE_REQUEST",
      received: describe(continuation),
    });
  }
  const cursor = validateCursor(continuation.cursor);
  if (!cursor.ok) return cursor;

  if (continuation.isDone && cursor.value !== null) {
    return fail({ code: "CURSOR_PRESENT_ON_COMPLETE_PAGE" });
  }
  if (!continuation.isDone && cursor.value === null) {
    return fail({ code: "CURSOR_MISSING_FOR_CONTINUATION" });
  }

  return ok(
    Object.freeze({
      items: frozenArray(items),
      nextCursor: cursor.value,
      complete: continuation.isDone,
      requestedPageSize: request.maxPageSize,
    }),
  );
}

export function nextJobPageRequest<Item>(
  page: JobPage<Item>,
): Result<JobPageRequest | null, JobPageError> {
  if (!isRecord(page) || !isBoolean(page.complete)) {
    return fail({ code: "NOT_A_JOB_PAGE_REQUEST", received: describe(page) });
  }
  if (page.complete) return ok(null);
  const cursor = validateCursor(page.nextCursor);
  if (!cursor.ok) return cursor;
  if (cursor.value === null) {
    return fail({ code: "CURSOR_MISSING_FOR_CONTINUATION" });
  }
  return makeJobPageRequest({
    maxPageSize: page.requestedPageSize,
    cursor: cursor.value,
  });
}
