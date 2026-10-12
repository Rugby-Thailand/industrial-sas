import { compareValues } from "convex/values";
import type { TenantFunctionContext } from "./tenantFunctions";
import {
  TENANT_INDEX_MAX_PAGE_SIZE,
  TENANT_INDEX_TIEBREAKER,
  type TenantIndexBound,
  type TenantIndexEquality,
  type TenantIndexRange,
  type TenantOwnedDocument,
  type TenantTableName,
} from "./tenantDb";
import { catalogueScope, decodeCatalogueCursor } from "./cataloguePagination";

/**
 * One ordered key range scanned by `keysetScan`. Rows are visited in index
 * order (`keyField`, then `_creationTime`), so a position can stop after any
 * row. Every read is a bounded `take()` (no `.paginate()`), so one request may
 * read several ranges.
 *
 * `equalities` lists index prefixes that share this key range. They are merged
 * in key order, not concatenated: a row that moves from one prefix to another
 * without changing its key (for example a legacy row whose optional
 * `buildingId` is backfilled) keeps its traversal position, so a cursor can
 * neither skip nor repeat it.
 */
export interface KeysetSegment {
  readonly table: TenantTableName;
  readonly index: string;
  /** Equality terms after `orgId`; the tenant prefix is injected by tenantDb. */
  readonly equalities: readonly TenantIndexEquality[];
  /** The index field that immediately follows each equality prefix. */
  readonly keyField: string;
  readonly lower?: TenantIndexBound;
  readonly upper?: TenantIndexBound;
  /** Most rows match: read only what the page still needs (plus one). */
  readonly dense?: boolean;
  /** Free-form label returned to callers, for example "prefix" or "fallback". */
  readonly phase?: string;
}

type KeysetRow = TenantOwnedDocument & {
  readonly _id: string;
  readonly _creationTime: number;
} & Record<string, unknown>;

/** Segment, last consumed key, its creation time and its document ID. */
type Position = { s: number; k?: string | number; t?: number; i?: string };
type State = {
  scope: string;
  base: Position;
  pos: Position;
  ids: string[];
  scanned: number;
  generation?: number | undefined;
  /** IDs shown on the previous page; never repeated on this one. */
  prior?: string[] | undefined;
  /** Unfinished evaluation of one row, resumed on the next request. */
  inner?: { id: string; state: unknown } | undefined;
};

export type KeysetPage<R> = {
  status: "ready" | "scanning" | "reset";
  /** Ready rows, or rows matched so far on this page while `scanning`. */
  page: R[];
  isDone: boolean;
  continueCursor: string;
  scanCursor?: string;
  scanned: number;
  /** Phase of the segment the scan is in (or stopped in). */
  phase?: string | undefined;
};

/** Per-request work counter shared by the scan and its evaluator. */
export interface KeysetWork {
  reads: number;
  /** Work units left in this request; may be zero or negative. */
  remaining: () => number;
}

/** Returned by an evaluator that ran out of budget part-way through a row. */
export class KeysetSuspend {
  constructor(readonly state: unknown) {}
}

export const resetKeysetPage = <R>(): KeysetPage<R> => ({
  status: "reset",
  page: [],
  isDone: false,
  continueCursor: "",
  scanned: 0,
});

const MAX_INNER_STATE = 8_192;

function validPosition(value: unknown, segments: number): value is Position {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const pos = value as Record<string, unknown>;
  if (!Number.isSafeInteger(pos.s) || (pos.s as number) < 0) return false;
  if ((pos.s as number) > segments) return false;
  const hasKey = pos.k !== undefined;
  if (hasKey !== (pos.t !== undefined)) return false;
  if (
    hasKey &&
    !(
      (typeof pos.k === "string" && pos.k.length <= 1_000) ||
      (typeof pos.k === "number" && Number.isFinite(pos.k))
    )
  )
    return false;
  if (hasKey && !(typeof pos.t === "number" && Number.isFinite(pos.t)))
    return false;
  if (pos.i !== undefined && (typeof pos.i !== "string" || pos.i.length > 64))
    return false;
  return true;
}

const validIds = (value: unknown, max: number) =>
  Array.isArray(value) &&
  value.length <= max &&
  value.every((id) => typeof id === "string" && id.length <= 64);

function samePosition(a: Position, b: Position) {
  return a.s === b.s && a.k === b.k && a.t === b.t && a.i === b.i;
}

/** Index order: key, then creation time; the ID only breaks exact ties. */
function compareRows(keyField: string) {
  return (a: KeysetRow, b: KeysetRow) =>
    compareValues(
      a[keyField] as string | number,
      b[keyField] as string | number,
    ) ||
    a._creationTime - b._creationTime ||
    (a._id < b._id ? -1 : a._id > b._id ? 1 : 0);
}

/** Smallest string greater than every string that starts with `prefix`, by code point. */
export function prefixSuccessor(prefix: string): string | undefined {
  const points = [...prefix].map((char) => char.codePointAt(0)!);
  while (points.length) {
    const last = points.pop()!;
    if (last < 0x10ffff) {
      const next = last + 1 === 0xd800 ? 0xe000 : last + 1;
      return String.fromCodePoint(...points, next);
    }
  }
  return undefined;
}

/**
 * Split one key range into `[prefix, successor)` and the two ranges around
 * it. Callers scan the first as an indexed fast path and the others as a
 * broader fallback; the three are disjoint, so traversal never repeats a row.
 */
export function prefixSegments(
  base: Omit<KeysetSegment, "lower" | "upper" | "dense" | "phase">,
  prefix: string,
): { prefix: KeysetSegment; rest: KeysetSegment[] } {
  const successor = prefixSuccessor(prefix);
  const lower = { value: prefix, inclusive: true };
  const upper = successor ? { value: successor, inclusive: false } : undefined;
  return {
    prefix: {
      ...base,
      lower,
      ...(upper ? { upper } : {}),
      dense: true,
      phase: "prefix",
    },
    rest: [
      {
        ...base,
        upper: { value: prefix, inclusive: false },
        phase: "fallback",
      },
      ...(successor
        ? [
            {
              ...base,
              lower: { value: successor, inclusive: true },
              phase: "fallback",
            },
          ]
        : []),
    ],
  };
}

/** True when `row` is strictly after `pos` in (key, creation time, ID) order. */
function afterPosition(row: KeysetRow, pos: Position) {
  if (row._creationTime !== pos.t) return row._creationTime > pos.t!;
  // An exact key/time tie is ordered by ID; without a boundary ID the
  // boundary row cannot be told apart, so the tie is treated as consumed.
  return pos.i !== undefined && row._id > pos.i;
}

/** Rows of one equality prefix after `pos`, and whether the read was full. */
async function readRange(
  ctx: TenantFunctionContext,
  segment: KeysetSegment,
  equality: TenantIndexEquality,
  pos: Position,
  limit: number,
): Promise<{ rows: KeysetRow[]; full: boolean; read: number }> {
  const take = (terms: TenantIndexEquality, range?: TenantIndexRange) =>
    ctx.tenantDb
      .byIndex<KeysetRow>(segment.table, segment.index, terms, range)
      .take(limit);
  const range = (
    lower: TenantIndexBound | undefined,
  ): TenantIndexRange | undefined =>
    lower || segment.upper
      ? {
          field: segment.keyField,
          ...(lower ? { lower } : {}),
          ...(segment.upper ? { upper: segment.upper } : {}),
        }
      : undefined;
  if (pos.k === undefined) {
    const rows = [...(await take(equality, range(segment.lower)))];
    return { rows, full: rows.length >= limit, read: rows.length };
  }
  // Remaining rows with the same key (an equal creation time is included and
  // then ordered by ID, so exact ties are neither skipped nor repeated), then
  // rows after that key.
  const sameRaw = await take(
    [...equality, { field: segment.keyField, value: pos.k }],
    {
      field: TENANT_INDEX_TIEBREAKER,
      lower: { value: pos.t!, inclusive: true },
    },
  );
  const same = [...sameRaw]
    .sort(compareRows(segment.keyField))
    .filter((row) => afterPosition(row, pos));
  if (sameRaw.length >= limit)
    return { rows: same, full: true, read: sameRaw.length };
  const after = await ctx.tenantDb
    .byIndex<KeysetRow>(
      segment.table,
      segment.index,
      equality,
      range({ value: pos.k, inclusive: false }),
    )
    .take(limit - sameRaw.length);
  return {
    rows: [...same, ...after],
    full: after.length >= limit - sameRaw.length,
    read: sameRaw.length + after.length,
  };
}

/** The next `limit` rows of a single-prefix segment after an optional boundary row. */
export async function readKeysetRange(
  ctx: TenantFunctionContext,
  segment: KeysetSegment,
  after: { key: string | number; time: number; id: string } | undefined,
  limit: number,
) {
  return readRange(
    ctx,
    segment,
    segment.equalities[0]!,
    after ? { s: 0, k: after.key, t: after.time, i: after.id } : { s: 0 },
    limit,
  );
}

/** The next `limit` rows of a merged segment after `pos`, and whether more may follow. */
async function readMerged(
  ctx: TenantFunctionContext,
  segment: KeysetSegment,
  pos: Position,
  limit: number,
) {
  const parts = await Promise.all(
    segment.equalities.map((equality) =>
      readRange(ctx, segment, equality, pos, limit),
    ),
  );
  const read = parts.reduce((sum, part) => sum + part.read, 0);
  const merged = parts
    .flatMap((part) => part.rows)
    .sort(compareRows(segment.keyField));
  return {
    rows: merged.slice(0, limit),
    more: merged.length > limit || parts.some((part) => part.full),
    read,
  };
}

/**
 * Bounded keyset traversal over ordered index segments.
 *
 * Work: each request stops once index rows plus evaluator reads reach
 * `maxWork`. Budget is checked between evaluation chunks (at most `pageSize`
 * rows) and, for `sequential` scans, before every row; a sequential evaluator
 * can return `KeysetSuspend` to continue one row (for example a long
 * descendant history) on the next request instead of truncating it.
 *
 * Cursors are bound to tenant, actor, criteria and page size. Positions are
 * (key, creation time, ID) of the last consumed row; equal keys are ordered by
 * creation time and exact key/time ties by ID, so ties at a boundary are
 * neither skipped nor repeated. Cursor policy for keys that change (location
 * codes are immutable in every application writer; building codes are not):
 * - a page cursor whose boundary row now has a different key is reset, so the
 *   client restarts from page 1 instead of resuming at a stale boundary;
 * - rows shown on the previous page are excluded from the next one, so a row
 *   re-keyed past the boundary is not shown twice in a row; accumulating
 *   clients also de-duplicate by ID;
 * - a row re-keyed to before the current boundary is found again from page 1.
 * Retained IDs are re-read and re-evaluated on every continuation.
 */
export async function keysetScan<T extends KeysetRow, R>(
  ctx: TenantFunctionContext,
  options: {
    scope: unknown;
    pageSize: number;
    cursor?: string | undefined;
    scanCursor?: string | undefined;
    generation?: number | undefined;
    segments: readonly KeysetSegment[];
    /**
     * Match and hydrate one row; `null` excludes it. Count extra reads in
     * `work`. `resume` is a suspended evaluation's state. `retained` rows
     * already matched earlier on this page: re-check authorization and
     * eligibility, but an evaluator may skip repeating expensive text work.
     */
    evaluate: (
      row: T,
      work: KeysetWork,
      context: { resume?: unknown; retained?: boolean },
    ) => Promise<R | null | KeysetSuspend>;
    get: (id: string) => Promise<T | null>;
    maxWork?: number;
    /** Evaluate one row at a time so the evaluator may suspend. */
    sequential?: boolean;
    /**
     * Find one further match before a full page is `ready`, so a ready page's
     * `isDone` means that no later row matches (the search is exhausted), not
     * only that the page is complete. The look-ahead row is not returned; the
     * next page starts with it.
     */
    lookahead?: boolean;
  },
): Promise<KeysetPage<R>> {
  const { pageSize, segments } = options;
  if (![20, 50, 100].includes(pageSize)) return resetKeysetPage();
  const maxWork = options.maxWork ?? 400;
  const scope = catalogueScope(ctx, [
    options.scope,
    pageSize,
    options.lookahead ? "keyset:3+" : "keyset:3",
  ]);
  const decode = (value: string | undefined) =>
    value ? decodeCatalogueCursor<State>(value, scope) : null;
  const base = decode(options.cursor);
  const resumed = decode(options.scanCursor);
  if ((options.cursor && !base) || (options.scanCursor && !resumed))
    return resetKeysetPage();
  const validState = (value: State | null) =>
    value === null ||
    (validPosition(value.pos, segments.length) &&
      validPosition(value.base, segments.length) &&
      validIds(value.ids, pageSize) &&
      (value.prior === undefined || validIds(value.prior, 100)) &&
      (value.inner === undefined ||
        (typeof value.inner === "object" &&
          value.inner !== null &&
          typeof value.inner.id === "string" &&
          value.inner.id.length <= 64 &&
          JSON.stringify(value.inner.state ?? null).length <=
            MAX_INNER_STATE)) &&
      Number.isSafeInteger(value.scanned) &&
      value.scanned >= 0);
  if (!validState(base) || !validState(resumed)) return resetKeysetPage();
  const start: Position = base ? base.pos : { s: 0 };
  const prior = new Set(base?.prior ?? []);
  // A continuation must belong to the page the client says it is on.
  if (resumed && !samePosition(resumed.base, start)) return resetKeysetPage();
  const restart = !resumed || resumed.generation !== options.generation;
  let rowsRead = 0;
  const work: KeysetWork = {
    reads: 0,
    remaining: () => maxWork - rowsRead - work.reads,
  };
  // A boundary row whose key changed means the page boundary moved.
  if (restart && start.i && start.k !== undefined) {
    const anchor = await options.get(start.i);
    work.reads += 1;
    const field = segments[start.s]?.keyField;
    if (
      anchor &&
      field &&
      (anchor[field] !== start.k || anchor._creationTime !== start.t)
    )
      return resetKeysetPage();
  }
  let pos: Position = restart ? start : resumed.pos;
  let scanned = restart ? 0 : resumed.scanned;
  let inner = restart ? undefined : resumed.inner;

  const matched: R[] = [];
  const matchedIds: string[] = [];
  const consume = (id: string, row: R) => {
    if (matchedIds.includes(id)) return;
    matchedIds.push(id);
    matched.push(row);
  };
  if (!restart && resumed.ids.length) {
    const saved = await Promise.all(
      resumed.ids.map(async (id) => {
        const doc = await options.get(id);
        work.reads += 1;
        if (!doc) return null;
        const result = await options.evaluate(doc, work, { retained: true });
        return result instanceof KeysetSuspend ? null : ([id, result] as const);
      }),
    );
    for (const entry of saved) if (entry?.[1]) consume(entry[0], entry[1]);
  }

  // Rows wanted before stopping: the page, plus one look-ahead match.
  const want = pageSize + (options.lookahead ? 1 : 0);
  let exhausted = pos.s >= segments.length;
  let moreKnown = false;
  let found = false;
  let suspended: { id: string; state: unknown } | undefined;
  // Every request consumes at least one row (or resumes one), so a scan
  // always advances even when retained rows used the whole budget.
  let progressed = false;
  const filled = () => !options.lookahead && matched.length >= pageSize;
  scan: while (!exhausted && !found && !filled()) {
    if (progressed && work.remaining() <= 0) break;
    const segment = segments[pos.s]!;
    const needed = want - matched.length;
    const limit = Math.min(
      TENANT_INDEX_MAX_PAGE_SIZE,
      segment.dense ? needed + 1 : Math.max(1, work.remaining()),
    );
    const { rows, more, read } = await readMerged(ctx, segment, pos, limit);
    rowsRead += read;
    // Only reachable with more than `limit` exact key/time ties: report no
    // progress (the client sees a repeated cursor) instead of spinning here.
    if (!rows.length && more) {
      moreKnown = true;
      break;
    }
    let consumed = 0;
    while (consumed < rows.length && !filled()) {
      // Stop between chunks (or rows) once this request's budget is spent.
      if (consumed > 0 && work.remaining() <= 0) {
        moreKnown = true;
        break scan;
      }
      const size = options.sequential ? 1 : Math.max(1, want - matched.length);
      const chunk = rows.slice(consumed, consumed + size);
      const results = await Promise.all(
        chunk.map((row) => {
          if (prior.has(row._id)) return Promise.resolve(null);
          const resume = inner?.id === row._id ? inner.state : undefined;
          return options.evaluate(row as T, work, { resume });
        }),
      );
      for (const [offset, result] of results.entries()) {
        const row = chunk[offset]!;
        if (result instanceof KeysetSuspend) {
          // Leave `pos` before this row; it is resumed with its own state.
          suspended = { id: row._id, state: result.state };
          break scan;
        }
        if (result && matched.length >= pageSize) {
          // A later match exists: leave it unconsumed for the next page.
          found = true;
          break scan;
        }
        if (inner?.id === row._id) inner = undefined;
        progressed = true;
        consumed += 1;
        scanned += 1;
        const key = row[segment.keyField];
        if (typeof key !== "string" && typeof key !== "number")
          throw new Error("KEYSET_KEY_INVALID");
        pos = { s: pos.s, k: key, t: row._creationTime, i: row._id };
        if (result) consume(row._id, result);
        if (filled()) break;
      }
    }
    if (consumed < rows.length) {
      moreKnown = true;
      break;
    }
    if (!more) {
      pos = { s: pos.s + 1 };
      exhausted = pos.s >= segments.length;
    }
  }
  const phase = segments[Math.min(pos.s, segments.length - 1)]?.phase;
  const settled = options.lookahead
    ? found || exhausted
    : matched.length >= pageSize || exhausted;
  if (!settled) {
    const next: State = {
      scope,
      base: start,
      pos,
      ids: matchedIds,
      scanned,
      generation: options.generation,
      ...(suspended ? { inner: suspended } : {}),
    };
    return {
      status: "scanning",
      page: matched,
      isDone: false,
      continueCursor: "",
      scanned,
      phase,
      scanCursor: JSON.stringify(next),
    };
  }
  const isDone = options.lookahead ? !found : exhausted && !moreKnown;
  return {
    status: "ready",
    page: matched,
    isDone,
    scanned,
    phase,
    continueCursor: isDone
      ? ""
      : JSON.stringify({
          scope,
          base: pos,
          pos,
          ids: [],
          scanned: 0,
          prior: matchedIds,
        } satisfies State),
  };
}
