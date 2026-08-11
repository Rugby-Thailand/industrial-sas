/**
 * Bounded, resumable job pages.
 *
 * Status: **implemented.** Pure module (plan §6.2): no Convex imports, and no
 * imports outside `convex/model/**`.
 *
 * Reconciliation and expiry reclassification are the two ledger workloads whose
 * size is a property of the tenant rather than of the request: roughly a million
 * ledger lines per tenant per year at the B-11 envelope, and a balance row for
 * every bucket ever used. Neither fits in one Convex function execution, and both
 * have to be resumable across executions (`ADR-0011`, §5 Q34, `RG-018`).
 *
 * So neither is written as a loop over a collection. A job is a *sequence of
 * pages*, and this module is the shape of one page: a strict maximum size, an
 * opaque cursor, and a completion state that is a stored fact rather than an
 * inference from an empty result.
 *
 * Three rules, each of which exists because its absence is a real failure mode:
 *
 * - **The size cap is a rejection, not a clamp.** A caller asking for 5,000 rows
 *   has a plan that a quietly truncated 100 would corrupt, and a job that silently
 *   processes a fraction of what it was told to is the version of this bug nobody
 *   notices. Same reasoning, same constant, as `TENANT_INDEX_MAX_PAGE_SIZE`.
 * - **The cursor is opaque here and validated anyway.** This module never parses
 *   one — it comes from a Convex `paginate` and goes back verbatim — so the only
 *   checkable properties are "non-empty string" and "not absurdly large". Both are
 *   checked, so an attacker-supplied cursor cannot become an unbounded input to
 *   whatever does decode it downstream.
 * - **Completion is explicit.** `complete` comes from the reader that knows the
 *   index is exhausted. Deriving it from `items.length < maxPageSize` is wrong at
 *   the boundary: a page that happens to end exactly on the last row is full *and*
 *   final, and a job that inferred otherwise would run one empty page forever or
 *   stop one page early.
 *
 * Nothing here loops over an external collection, and nothing here holds state
 * between calls: a page is a value, and `nextJobPageRequest` is a function from one
 * page to the request that continues it.
 */
import {
  frozenArray,
  isBoolean,
  isRecord,
  isSafeInt,
  isString,
} from "../guards";
import { fail, ok, type Result } from "../result";

/**
 * The largest page any ledger job may ask for.
 *
 * Deliberately the same 100 as `TENANT_INDEX_MAX_PAGE_SIZE` in
 * `convex/lib/tenantDb.ts`: a job page is served by an indexed read, so a job page
 * larger than a readable page would be a request that cannot be satisfied in one
 * call no matter what this module said.
 */
export const MAX_JOB_PAGE_SIZE = 100;

/** The default when a caller expresses no preference. Conservative on purpose. */
export const DEFAULT_JOB_PAGE_SIZE = 50;

/** The largest cursor this module will carry, in UTF-16 code units. */
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

/** What a job asks its reader for: a bounded size and where to resume. */
export interface JobPageRequest {
  readonly maxPageSize: number;
  /** `null` means "start at the beginning", never "resume from nowhere". */
  readonly cursor: string | null;
}

/**
 * One page of a job.
 *
 * `nextCursor` is `null` exactly when `complete` is `true`; the constructor
 * enforces the biconditional rather than leaving a page that is both finished and
 * resumable, which a caller would have to guess about.
 */
export interface JobPage<Item> {
  readonly items: readonly Item[];
  readonly nextCursor: string | null;
  readonly complete: boolean;
  /** The size that was asked for, so a consumer can tell a full page from a short one. */
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

/**
 * Build a validated page request.
 *
 * An absent `maxPageSize` takes `DEFAULT_JOB_PAGE_SIZE`; a present one is checked,
 * never adjusted. Zero and negative sizes are `PAGE_SIZE_INVALID` rather than
 * "one page of nothing", because a job whose page size is zero never terminates.
 */
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

/**
 * Build a page from what a reader returned.
 *
 * `continuation.isDone` and `continuation.cursor` are the two fields a Convex
 * `paginate` answer carries, named the same way so the adapter is a rename rather
 * than a translation. Both are validated: a reader that claimed completion *and*
 * handed back a cursor, or claimed continuation with none, is a reader whose answer
 * cannot be resumed correctly, and guessing which half to believe is how a job
 * silently skips rows.
 */
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

/**
 * The request that continues a page, or `null` when the job is done.
 *
 * The page size carries over, so a job that started with a size does not silently
 * change it halfway; a caller wanting a different size builds a new request.
 */
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
