import type { GenericId } from "convex/values";
import type { TenantFunctionContext } from "./tenantFunctions";
import { TENANT_INDEX_MAX_PAGE_SIZE, type TenantIndexPage } from "./tenantDb";

export type CataloguePage<Row> = {
  status: "ready" | "scanning" | "reset";
  page: Row[];
  isDone: boolean;
  continueCursor: string;
  scanCursor?: string;
  scanned: number;
};
type Identity = { _id: string };
type TenantIdentity = Identity & {
  orgId: GenericId<"organizations">;
};
type Range = { raw?: string | undefined; end?: string | undefined };
type State = {
  scope: string;
  raw?: string | undefined;
  end?: string | undefined;
  pending?: Range[] | undefined;
  ids: string[];
  scanned: number;
  anchor?: string | undefined;
  more?: boolean;
  generation?: number | undefined;
};
const MAX_STATE = 32_768;
export function catalogueScope(ctx: TenantFunctionContext, criteria: unknown) {
  return JSON.stringify([
    ctx.tenant.organization._id,
    ctx.tenant.actor._id,
    criteria,
  ]);
}
export function decodeCatalogueCursor<T>(
  value: string | undefined,
  scope: string,
): T | null {
  if (!value || value.length > MAX_STATE) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      parsed.scope === scope
      ? (parsed as T)
      : null;
  } catch {
    return null;
  }
}
const isCursorError = (error: unknown) =>
  error instanceof Error &&
  (/cursor/i.test(error.message) ||
    ("code" in error && error.code === "INVALID_INDEX_QUERY"));

export const resetCataloguePage = <R>(): CataloguePage<R> => ({
  status: "reset",
  page: [],
  isDone: false,
  continueCursor: "",
  scanned: 0,
});
/** One bounded database page per request. Complex sorts keep only the best N IDs.
 * The opaque scan cursor is continuation state, never an authorization credential.
 * Every retained ID is re-read through tenant access and the caller's scope check.
 */
export async function paginatedScan<
  T extends TenantIdentity,
  R extends Identity,
>(
  ctx: TenantFunctionContext,
  options: {
    scope: unknown;
    pageSize: number;
    cursor?: string | undefined;
    scanCursor?: string | undefined;
    /**
     * Continuation token. A reader is called only when this request resumes a
     * scan, returns scan state, or (with bindContinuation) pages a sort, so a
     * first page answered in one request does not depend on it reactively.
     */
    generation?: number | (() => Promise<number>);
    /** Reset sorted continuation pages when the token has moved. */
    bindContinuation?: boolean;
    read: (
      rawCursor?: string,
      endCursor?: string,
    ) => Promise<TenantIndexPage<T>>;
    hydrate: (document: T) => Promise<R>;
    /** Cheap eligibility check before relation reads, including retained IDs. */
    matchesDocument?: (document: T) => boolean;
    matches: (row: R) => boolean;
    compare?: (a: R, b: R) => number;
    get: (id: string) => Promise<T | null>;
  },
): Promise<CataloguePage<R>> {
  if (![20, 50, 100].includes(options.pageSize)) return resetCataloguePage();
  const token = options.generation;
  let tokenValue: Promise<number | undefined> | undefined;
  const generation = () =>
    (tokenValue ??=
      typeof token === "function" ? token() : Promise.resolve(token));
  const scope = catalogueScope(ctx, [options.scope, options.pageSize]);
  const base = options.cursor
    ? decodeCatalogueCursor<State>(options.cursor, scope)
    : null;
  const resumed = options.scanCursor
    ? decodeCatalogueCursor<State>(options.scanCursor, scope)
    : null;
  const valid = (value: State | null) =>
    value === null ||
    ((value.raw === undefined ||
      (typeof value.raw === "string" && value.raw.length <= MAX_STATE)) &&
      (value.end === undefined || typeof value.end === "string") &&
      (value.pending === undefined ||
        (Array.isArray(value.pending) &&
          value.pending.length <= 16 &&
          value.pending.every(
            (range) =>
              range &&
              typeof range.raw === "string" &&
              typeof range.end === "string",
          ))) &&
      (value.anchor === undefined || typeof value.anchor === "string") &&
      (value.more === undefined || typeof value.more === "boolean"));
  if (
    (options.cursor && !base) ||
    (options.scanCursor && !resumed) ||
    !valid(base) ||
    !valid(resumed)
  )
    return resetCataloguePage();
  if (
    options.bindContinuation &&
    base &&
    base.generation !== (await generation())
  )
    return resetCataloguePage();
  const state: State = (resumed && resumed.generation === (await generation())
    ? resumed
    : null) ?? {
    scope,
    raw: base?.raw,
    end: base?.end,
    pending: base?.pending,
    anchor: base?.anchor,
    ids: [],
    scanned: 0,
  };
  if (
    !Array.isArray(state.ids) ||
    state.ids.length > options.pageSize ||
    state.ids.some((id) => typeof id !== "string") ||
    !Number.isSafeInteger(state.scanned) ||
    state.scanned < 0
  )
    return resetCataloguePage();
  const hydrateId = async (id: string) => {
    const doc = await options.get(id);
    return doc && (!options.matchesDocument || options.matchesDocument(doc))
      ? options.hydrate(doc)
      : null;
  };
  const saved: R[] = [];
  for (const row of await Promise.all(state.ids.map(hydrateId))) {
    if (row !== null && options.matches(row)) saved.push(row);
  }
  const anchor = state.anchor ? await hydrateId(state.anchor) : null;
  if (state.anchor && !anchor) return resetCataloguePage();
  let chunk: Awaited<ReturnType<typeof options.read>>;
  try {
    chunk = await options.read(state.raw, state.end);
  } catch (error) {
    if (isCursorError(error)) return resetCataloguePage();
    throw error;
  }
  if (chunk.pageStatus === "SplitRequired") {
    if (
      !chunk.splitCursor ||
      chunk.splitCursor === state.raw ||
      chunk.splitCursor === state.end ||
      (state.pending?.length ?? 0) >= 16
    )
      throw new Error("CATALOGUE_READ_CAPACITY_EXCEEDED");
    return {
      status: "scanning",
      page: [],
      isDone: false,
      continueCursor: "",
      scanned: state.scanned,
      scanCursor: JSON.stringify({
        ...state,
        generation: await generation(),
        end: chunk.splitCursor,
        pending: [
          { raw: chunk.splitCursor, end: chunk.continueCursor },
          ...(state.pending ?? []),
        ],
      }),
    };
  }
  const remainingRanges = [...(state.pending ?? [])];
  const nextRange =
    state.end && remainingRanges.length
      ? remainingRanges.shift()!
      : { raw: chunk.continueCursor };
  const exhausted =
    chunk.isDone &&
    remainingRanges.length === 0 &&
    !(state.end && state.pending?.length);
  const eligible = options.matchesDocument
    ? chunk.page.filter(options.matchesDocument)
    : chunk.page;
  const incoming = await Promise.all(eligible.map(options.hydrate));
  let candidates = [
    ...new Map(
      [...saved, ...incoming.filter(options.matches)].map((row) => [
        row._id,
        row,
      ]),
    ).values(),
  ];
  if (options.compare) {
    const compare = options.compare;
    candidates = candidates
      .filter((row) => !anchor || compare(row, anchor) > 0)
      .sort(compare);
  }
  const scanned = state.scanned + chunk.page.length;
  const overflow = candidates.length > options.pageSize;
  const selected = options.compare
    ? candidates.slice(0, options.pageSize)
    : candidates;
  // Streaming callers read at most the remaining page capacity, so no matches
  // can be skipped at the index cursor boundary.
  // Native live pages can grow. Preserve the complete range rather than slice
  // records while retaining a continuation cursor beyond those records.
  const more = Boolean(state.more || overflow);
  const done =
    exhausted || (!options.compare && selected.length >= options.pageSize);
  if (!done)
    return {
      status: "scanning",
      page: [],
      isDone: false,
      continueCursor: "",
      scanned,
      scanCursor: JSON.stringify({
        scope,
        raw: nextRange.raw,
        end: nextRange.end,
        pending: remainingRanges,
        ids: selected.map((row) => row._id),
        scanned,
        anchor: state.anchor,
        more,
        generation: await generation(),
      }),
    };
  const isDone = options.compare ? !more : exhausted;
  return {
    status: "ready",
    page: selected,
    isDone,
    scanned,
    continueCursor: isDone
      ? ""
      : JSON.stringify({
          scope,
          ids: [],
          scanned: 0,
          ...(options.bindContinuation
            ? { generation: await generation() }
            : {}),
          ...(options.compare
            ? { anchor: selected.at(-1)?._id }
            : {
                raw: nextRange.raw,
                end: nextRange.end,
                pending: remainingRanges,
              }),
        }),
  };
}
export function remainingScanCapacity(
  scanCursor: string | undefined,
  pageSize: number,
) {
  if (!scanCursor || scanCursor.length > MAX_STATE) return pageSize;
  try {
    const state = JSON.parse(scanCursor);
    return Math.max(
      1,
      pageSize -
        (Array.isArray(state.ids) ? Math.min(state.ids.length, pageSize) : 0),
    );
  } catch {
    return pageSize;
  }
}

export type NativeRangeState = {
  raw?: string | undefined;
  end?: string | undefined;
  pending?:
    Array<{ raw?: string | undefined; end?: string | undefined }> | undefined;
};
export function advanceNativeRange(
  state: NativeRangeState,
  chunk: Pick<
    TenantIndexPage,
    "isDone" | "continueCursor" | "pageStatus" | "splitCursor"
  >,
) {
  if (chunk.pageStatus === "SplitRequired") {
    if (
      !chunk.splitCursor ||
      chunk.splitCursor === state.raw ||
      chunk.splitCursor === state.end ||
      (state.pending?.length ?? 0) >= 16
    )
      throw new Error("CATALOGUE_READ_CAPACITY_EXCEEDED");
    return {
      split: true,
      exhausted: false,
      range: {
        raw: state.raw,
        end: chunk.splitCursor,
        pending: [
          { raw: chunk.splitCursor, end: chunk.continueCursor },
          ...(state.pending ?? []),
        ],
      },
    };
  }
  const pending = [...(state.pending ?? [])];
  const next =
    state.end && pending.length
      ? pending.shift()!
      : { raw: chunk.continueCursor };
  return {
    split: false,
    exhausted:
      chunk.isDone && !pending.length && !(state.end && state.pending?.length),
    range: { ...next, pending },
  };
}

export function validNativeRange(value: unknown): value is NativeRangeState {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const range = value as NativeRangeState;
  return (
    [range.raw, range.end].every(
      (cursor) =>
        cursor === undefined ||
        (typeof cursor === "string" && cursor.length <= 4096),
    ) &&
    (range.pending === undefined ||
      (Array.isArray(range.pending) &&
        range.pending.length <= 16 &&
        range.pending.every(
          (item) =>
            item &&
            typeof item.raw === "string" &&
            typeof item.end === "string" &&
            item.raw.length <= 4096 &&
            item.end.length <= 4096,
        )))
  );
}

type OrderedScanState = {
  scope: string;
  generation: number;
  range: Range;
  ids: string[];
  exhausted: boolean;
  scanned: number;
  offset: number;
  kind: "page" | "scan";
};

/** Scan in index order using one bounded chunk and carry surplus matches
 * through the native cursor boundary. Point-read retained IDs only when
 * returning them, then verify their tenant and eligibility before projecting.
 */
export async function paginatedOrderedScan<T extends TenantIdentity>(
  ctx: TenantFunctionContext,
  options: {
    scope: unknown;
    pageSize: number;
    cursor?: string | undefined;
    scanCursor?: string | undefined;
    generation: () => Promise<number>;
    read: (range: Range) => Promise<TenantIndexPage<T>>;
    get: (id: string) => Promise<T | null>;
    matches: (document: T) => boolean;
  },
): Promise<CataloguePage<T>> {
  const { pageSize, cursor, scanCursor } = options;
  if (![20, 50, 100].includes(pageSize)) return resetCataloguePage();
  const scope = catalogueScope(ctx, [options.scope, pageSize]);
  let currentGeneration: Promise<number> | undefined;
  const generation = () => (currentGeneration ??= options.generation());

  const decode = async (value: string, kind: OrderedScanState["kind"]) => {
    const state = decodeCatalogueCursor<OrderedScanState>(value, scope);
    if (
      !state ||
      state.kind !== kind ||
      !state.range ||
      !validNativeRange(state.range) ||
      !Array.isArray(state.ids) ||
      state.ids.length > TENANT_INDEX_MAX_PAGE_SIZE ||
      !state.ids.every((id) => typeof id === "string") ||
      new Set(state.ids).size !== state.ids.length ||
      typeof state.exhausted !== "boolean" ||
      !Number.isSafeInteger(state.scanned) ||
      state.scanned < 0 ||
      !Number.isSafeInteger(state.offset) ||
      state.offset < 0 ||
      state.generation !== (await generation())
    )
      return null;
    return state;
  };
  const base = cursor ? await decode(cursor, "page") : null;
  const resumed = scanCursor ? await decode(scanCursor, "scan") : null;
  const offset = base?.offset ?? 0;
  if ((cursor && !base) || (scanCursor && resumed?.offset !== offset))
    return resetCataloguePage();

  const state = resumed ?? base;
  const incoming = new Map<string, T>();
  let range = state?.range ?? {};
  let exhausted = state?.exhausted ?? false;
  let scanned = state?.scanned ?? 0;
  const retained = state?.ids ?? [];
  if (!exhausted && retained.length < pageSize) {
    try {
      const chunk = await options.read(range);
      if (chunk.pageStatus === "SplitRequired") {
        if (
          !chunk.splitCursor ||
          chunk.splitCursor === range.raw ||
          chunk.splitCursor === range.end
        )
          throw new Error("CATALOGUE_READ_CAPACITY_EXCEEDED");
        range = { raw: range.raw, end: chunk.splitCursor };
      } else {
        // A bounded split prefix ends at its explicit boundary. Resume the
        // original index range there even if the prefix reports isDone.
        exhausted = !range.end && chunk.isDone;
        range = { raw: range.end ?? chunk.continueCursor };
        scanned += chunk.page.length;
        for (const row of chunk.page)
          if (options.matches(row)) incoming.set(row._id, row);
      }
    } catch (error) {
      if (isCursorError(error)) return resetCataloguePage();
      throw error;
    }
  }
  const ids = [...new Set([...retained, ...incoming.keys()])];
  if (ids.length < pageSize && !exhausted) {
    const next: OrderedScanState = {
      scope,
      generation: await generation(),
      range,
      ids,
      exhausted,
      scanned,
      offset,
      kind: "scan",
    };
    return {
      status: "scanning",
      page: [],
      isDone: false,
      continueCursor: "",
      scanCursor: JSON.stringify(next),
      scanned,
    };
  }

  const page: T[] = [];
  const documents = await Promise.all(
    ids.slice(0, pageSize).map((id) => incoming.get(id) ?? options.get(id)),
  );
  for (const row of documents) {
    if (row === null || !options.matches(row)) return resetCataloguePage();
    page.push(row);
  }

  const surplus = ids.slice(pageSize);
  const isDone = exhausted && surplus.length === 0;
  const next: OrderedScanState | null = isDone
    ? null
    : {
        scope,
        generation: await generation(),
        range,
        ids: surplus,
        exhausted,
        scanned: 0,
        offset: offset + pageSize,
        kind: "page",
      };
  return {
    status: "ready",
    page,
    isDone,
    continueCursor: next ? JSON.stringify(next) : "",
    scanned,
  };
}
