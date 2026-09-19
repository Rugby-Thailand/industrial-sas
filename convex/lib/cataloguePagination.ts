import type { GenericId } from "convex/values";
import type { TenantFunctionContext } from "./tenantFunctions";
import type { TenantIndexPage } from "./tenantDb";

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
    generation?: number;
    read: (
      rawCursor?: string,
      endCursor?: string,
    ) => Promise<TenantIndexPage<T>>;
    hydrate: (document: T) => Promise<R>;
    matches: (row: R) => boolean;
    compare?: (a: R, b: R) => number;
    get: (id: string) => Promise<T | null>;
  },
): Promise<CataloguePage<R>> {
  if (![20, 50, 100].includes(options.pageSize)) return resetCataloguePage();
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
  const state: State = (resumed && resumed.generation === options.generation
    ? resumed
    : null) ?? {
    scope,
    raw: base?.raw,
    end: base?.end,
    pending: base?.pending,
    anchor: base?.anchor,
    ids: [],
    scanned: 0,
    generation: options.generation,
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
    return doc ? options.hydrate(doc) : null;
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
    if (
      error instanceof Error &&
      (/cursor/i.test(error.message) ||
        ("code" in error && error.code === "INVALID_INDEX_QUERY"))
    )
      return resetCataloguePage();
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
  const incoming = await Promise.all(chunk.page.map(options.hydrate));
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
        generation: options.generation,
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
