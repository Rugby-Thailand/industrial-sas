import type { TenantFunctionContext } from "./tenantFunctions";
import type { TenantIndexPage, TenantOwnedDocument } from "./tenantDb";
import {
  advanceNativeRange,
  catalogueScope,
  validNativeRange,
  type NativeRangeState,
} from "./cataloguePagination";

/**
 * Bounded, cursor-stable record pages for collections whose text criteria have
 * no usable index (arbitrary case-insensitive substring search).
 *
 * Each request performs at most one native index page read plus by-ID re-reads
 * of rows it already passed. Matching rows are never sliced away behind a
 * native cursor: rows read after a page fills are carried in the cursor
 * (`tail`) and re-evaluated live by the next page.
 *
 * Two response protocols share the same page cursors:
 *
 * - `progressive` (current clients): a page that has not filled answers
 *   `scanning` with the rows found so far and a `scanCursor` that continues
 *   the same logical page. Its `continueCursor` is empty, so it can never be
 *   mistaken for the next page.
 * - short pages (default; clients that know only `items`, `continueCursor`
 *   and `isDone`): each response is a complete `ready` page of the rows found
 *   by this bounded request, possibly fewer than `pageSize` or none, with an
 *   honest continuation. No row is repeated or skipped across responses.
 *
 * Cursors are unsigned continuation state, not credentials. They are bound to
 * the organization, actor and criteria, structurally validated (unique,
 * well-formed IDs; page and scan states are not interchangeable), and every
 * retained ID is re-read through tenant access and re-checked by `accept`,
 * so editing one can neither widen scope nor resurrect a deleted row.
 */
export type BoundedRecordPage<Row> =
  | {
      status: "ready";
      items: Row[];
      isDone: boolean;
      continueCursor: string;
      scanned: number;
    }
  | {
      status: "scanning";
      items: Row[];
      isDone: false;
      /** Empty: a scanning page has no next page yet. Use `scanCursor`. */
      continueCursor: "";
      scanCursor: string;
      scanned: number;
    }
  | {
      /** The cursor does not belong to these criteria; start at page one. */
      status: "reset";
      items: Row[];
      isDone: true;
      continueCursor: "";
      scanned: 0;
    };

type State = {
  v: 2;
  /** `page` starts a page; `scan` continues the page it was issued for. */
  k: "page" | "scan";
  scope: string;
  range: NativeRangeState;
  /** Accepted rows already collected for the page being scanned. */
  ids: string[];
  /** Rows passed by the native cursor but not yet shown, in index order. */
  tail: string[];
  scanned: number;
  exhausted?: true;
};

/** Index rows one filtered request may inspect (the adapter's native maximum). */
export const BOUNDED_SCAN_CHUNK = 100;
const MAX_PAGE_SIZE = 100;
/** A tail holds at most one native chunk's unread rows (≤101 rows read). */
const MAX_TAIL = 128;
const MAX_CURSOR_LENGTH = 32_768;
/** Convex document IDs: URL-safe identifier characters only. */
const DOCUMENT_ID = /^[0-9A-Za-z_]{1,64}$/;

const resetPage = <Row>(): BoundedRecordPage<Row> => ({
  status: "reset",
  items: [],
  isDone: true,
  continueCursor: "",
  scanned: 0,
});

function idList(value: unknown, max: number): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= max &&
    value.every((id) => typeof id === "string" && DOCUMENT_ID.test(id))
  );
}

function decode(
  value: string,
  scope: string,
  kind: State["k"],
  pageSize: number,
): State | null {
  if (value.length > MAX_CURSOR_LENGTH) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return null;
  const state = parsed as Partial<State>;
  if (
    state.v !== 2 ||
    state.k !== kind ||
    state.scope !== scope ||
    state.range === undefined ||
    !validNativeRange(state.range) ||
    !idList(state.ids, pageSize - 1) ||
    !idList(state.tail, MAX_TAIL) ||
    !Number.isSafeInteger(state.scanned) ||
    (state.scanned ?? -1) < 0 ||
    (state.exhausted !== undefined && state.exhausted !== true)
  )
    return null;
  // Transitions the server issues: a page state carries only unread rows; a
  // scan state carries only accepted rows of an unfinished, unexhausted page.
  const valid =
    kind === "page"
      ? state.ids.length === 0 &&
        state.scanned === 0 &&
        (!state.exhausted || state.tail.length > 0)
      : state.tail.length === 0 && !state.exhausted;
  const all = [...state.ids, ...state.tail];
  return valid && new Set(all).size === all.length ? (state as State) : null;
}

function cursorError(error: unknown) {
  return (
    error instanceof Error &&
    (/cursor/i.test(error.message) ||
      ("code" in error &&
        (error.code === "INVALID_INDEX_QUERY" ||
          error.code === "INVALID_CURSOR")))
  );
}

export async function boundedRecordPage<
  T extends TenantOwnedDocument & { readonly _id: string },
  Row,
>(
  ctx: TenantFunctionContext,
  options: {
    /** Every criterion that changes membership or order. */
    scope: unknown;
    pageSize: number;
    cursor?: string | null | undefined;
    scanCursor?: string | undefined;
    /** True when `accept` may reject rows, so reads use the full chunk. */
    filtering: boolean;
    /** A legacy plain native cursor is accepted only when not filtering. */
    acceptNativeCursor?: boolean;
    /** Answer `scanning` progress instead of short pages (see above). */
    progressive?: boolean;
    read: (
      range: { raw?: string | undefined; end?: string | undefined },
      limit: number,
    ) => Promise<TenantIndexPage<T>>;
    get: (id: string) => Promise<T | null>;
    accept: (document: T) => boolean | Promise<boolean>;
    hydrate: (documents: T[]) => Promise<Row[]>;
  },
): Promise<BoundedRecordPage<Row>> {
  const pageSize = options.pageSize;
  if (
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > MAX_PAGE_SIZE
  )
    return resetPage();
  const scope = catalogueScope(ctx, [options.scope, pageSize]);
  let state: State | null = {
    v: 2,
    k: "page",
    scope,
    range: {},
    ids: [],
    tail: [],
    scanned: 0,
  };
  if (options.scanCursor)
    state = options.progressive
      ? decode(options.scanCursor, scope, "scan", pageSize)
      : null;
  else if (options.cursor) {
    const decoded = decode(options.cursor, scope, "page", pageSize);
    state =
      decoded ??
      (options.acceptNativeCursor &&
      !options.filtering &&
      options.cursor.length <= 4096 &&
      !options.cursor.startsWith("{")
        ? { ...state, range: { raw: options.cursor } }
        : null);
  }
  if (!state) return resetPage();
  const accepted = async (document: T | null) =>
    document !== null && (await options.accept(document));

  const page: T[] = [];
  for (const document of await Promise.all(state.ids.map(options.get)))
    if (document && (await accepted(document))) page.push(document);
  // Rows passed by the native cursor but not shown yet. Unread candidates of a
  // filled page become the next cursor's tail.
  let remainder: T[] = [];
  let scanned = state.scanned;
  const consume = async (documents: readonly (T | null)[]) => {
    const present = documents.filter((doc): doc is T => doc !== null);
    for (let index = 0; index < present.length; index++) {
      if (page.length >= pageSize) {
        remainder = [...remainder, ...present.slice(index)];
        return;
      }
      if (await accepted(present[index]!)) page.push(present[index]!);
    }
  };
  const tail = await Promise.all(state.tail.map(options.get));
  scanned += tail.length;
  await consume(tail);
  let range = state.range;
  let exhausted = state.exhausted === true;
  if (page.length < pageSize && !exhausted) {
    const limit = options.filtering
      ? BOUNDED_SCAN_CHUNK
      : Math.min(pageSize - page.length + 1, BOUNDED_SCAN_CHUNK);
    let chunk: TenantIndexPage<T>;
    try {
      chunk = await options.read({ raw: range.raw, end: range.end }, limit);
    } catch (error) {
      if (cursorError(error)) return resetPage();
      throw error;
    }
    const next = advanceNativeRange(range, chunk);
    range = next.range;
    if (!next.split) {
      scanned += chunk.page.length;
      exhausted = next.exhausted;
      await consume(chunk.page);
    }
  }
  if (page.length < pageSize && !exhausted) {
    if (!options.progressive)
      // A complete short page: its rows are not carried into the next one.
      return {
        status: "ready",
        items: await options.hydrate(page),
        isDone: false,
        scanned,
        continueCursor: JSON.stringify({
          v: 2,
          k: "page",
          scope,
          range,
          ids: [],
          tail: [],
          scanned: 0,
        } satisfies State),
      };
    const scanCursor = JSON.stringify({
      v: 2,
      k: "scan",
      scope,
      range,
      ids: page.map((row) => row._id),
      tail: [],
      scanned,
    } satisfies State);
    return {
      status: "scanning",
      items: await options.hydrate(page),
      isDone: false,
      continueCursor: "",
      scanCursor,
      scanned,
    };
  }
  let more = !exhausted;
  if (!more)
    for (const document of remainder)
      if (await accepted(document)) {
        more = true;
        break;
      }
  return {
    status: "ready",
    items: await options.hydrate(page),
    isDone: !more,
    scanned,
    continueCursor: more
      ? JSON.stringify({
          v: 2,
          k: "page",
          scope,
          range,
          ids: [],
          tail: remainder.map((row) => row._id),
          scanned: 0,
          ...(exhausted ? { exhausted: true as const } : {}),
        } satisfies State)
      : "",
  };
}
