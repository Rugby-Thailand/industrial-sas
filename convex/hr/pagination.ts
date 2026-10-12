/**
 * Bounded cursor traversal for HR record lists.
 *
 * A list is an ordered sequence of tenant index ranges ("lanes"), e.g. one
 * per authorized site. Each request reads at most one native page (Convex
 * permits one per query) plus a few small `take` peeks that fully consume
 * short following lanes. Rows are matched against the criteria before the
 * expensive presentation hydration, so filters and search cover the whole
 * authorized dataset rather than a capped first read.
 *
 * Matches beyond the requested page size are carried, in order, as IDs at
 * the start of the next page, so a large native chunk never skips or
 * duplicates a row. While a page is still being filled the answer is
 * `scanning` with a continuation (the client resumes it automatically,
 * see `useCatalogueSync`); a page is `ready` once it is full or every lane is
 * exhausted.
 *
 * The cursor is continuation state only, never a credential: it is bound to
 * the organization, actor, surface, criteria and page size; its lane must be
 * one of the lanes computed from the actor's current access; and every
 * retained ID is re-read through tenant access and re-matched (including the
 * authorization check) before it is shown. A cursor that fails any check
 * answers `reset`.
 */
import { v } from "convex/values";

import {
  advanceNativeRange,
  catalogueScope,
  validNativeRange,
  type NativeRangeState,
} from "../lib/cataloguePagination";
import type {
  TenantIndexEquality,
  TenantIndexRange,
  TenantOwnedDocument,
} from "../lib/tenantDb";
import type { TenantTableName } from "../lib/schemaPolicy";
import type { TenantFunctionContext } from "../lib/tenantFunctions";

/** Page sizes every HR list endpoint accepts. */
export const HR_PAGE_SIZES = [20, 50] as const;
export type HrPageSize = (typeof HR_PAGE_SIZES)[number];
export const isHrPageSize = (value: unknown): value is HrPageSize =>
  value === 20 || value === 50;

/** Rows one native read may return (tenant pages allow at most 100). */
export const HR_MAX_CHUNK = 99;
/** Following lanes one request may examine after its native read. */
const MAX_PEEKED_LANES = 8;
const MAX_CURSOR_LENGTH = 16_384;

export interface HrLane {
  /**
   * Stable identity and position, e.g. a site code or ID. A resumed cursor
   * naming an unfinished lane must still resolve to an authorized lane.
   */
  readonly key: string;
  readonly index: string;
  readonly equality: TenantIndexEquality;
  readonly range?: TenantIndexRange;
  readonly order?: "asc" | "desc";
  /** A lane known to hold no matching rows (e.g. an inactive site). */
  readonly skip?: boolean;
}

/**
 * The ordered lanes of a list, read incrementally so their number is not
 * bounded: `after` returns the next lanes after a position (bounded reads,
 * never a native page), `resolve` re-authorizes the lane a cursor names.
 */
export interface HrLaneSource {
  readonly resolve: (key: string) => Promise<HrLane | null>;
  readonly after: (
    key: string | null,
    limit: number,
  ) => Promise<readonly HrLane[]>;
}

/** A fixed, already authorized list of lanes. */
export function staticLanes(lanes: readonly HrLane[]): HrLaneSource {
  return {
    resolve: async (key) => lanes.find((lane) => lane.key === key) ?? null,
    after: async (key, limit) => {
      const start =
        key === null ? 0 : lanes.findIndex((lane) => lane.key === key) + 1;
      // A position that is no longer listed ends the traversal safely.
      return start === 0 && key !== null
        ? []
        : lanes.slice(start, start + limit);
    },
  };
}

export interface HrPage<Row> {
  readonly status: "ready" | "scanning" | "reset";
  readonly page: Row[];
  readonly isDone: boolean;
  readonly continueCursor: string;
  readonly scanCursor?: string;
  /** Index rows examined by this request (diagnostic, not a total). */
  readonly scanned: number;
}

type State = {
  readonly v: 2;
  readonly scope: string;
  /** Lane key; "" before the first lane or once every lane is finished. */
  readonly lane: string;
  /** The lane is finished: continue with the lanes after it. */
  readonly finished: boolean;
  readonly range: NativeRangeState;
  /** Matched IDs not yet shown, in traversal order. */
  readonly ids: readonly string[];
};

export const resetHrPage = <Row>(): HrPage<Row> => ({
  status: "reset",
  page: [],
  isDone: false,
  continueCursor: "",
  scanned: 0,
});

function decode(
  value: string | undefined,
  scope: string,
  maxIds: number,
): State | null | "invalid" {
  if (value === undefined || value === "") return null;
  if (value.length > MAX_CURSOR_LENGTH) return "invalid";
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return "invalid";
    const state = parsed as Partial<State>;
    if (
      state.v !== 2 ||
      state.scope !== scope ||
      typeof state.lane !== "string" ||
      state.lane.length > 512 ||
      typeof state.finished !== "boolean" ||
      !validNativeRange(state.range) ||
      state.range === undefined ||
      !Array.isArray(state.ids) ||
      state.ids.length > maxIds ||
      state.ids.some((id) => typeof id !== "string" || id.length > 64)
    )
      return "invalid";
    return state as State;
  } catch {
    return "invalid";
  }
}

const isCursorError = (error: unknown) =>
  error instanceof Error &&
  (/cursor/i.test(error.message) ||
    ("code" in error && error.code === "INVALID_INDEX_QUERY"));

export async function hrScanPage<
  Document extends TenantOwnedDocument & { readonly _id: string },
  Row,
>(
  ctx: TenantFunctionContext,
  options: {
    /** Names the list; part of the cursor binding. */
    readonly surface: string;
    /** Every criterion that changes the result set; part of the binding. */
    readonly criteria: unknown;
    readonly pageSize: HrPageSize;
    readonly cursor?: string | undefined;
    readonly scanCursor?: string | undefined;
    readonly table: TenantTableName;
    readonly lanes: readonly HrLane[] | HrLaneSource;
    /** Index rows per native read; defaults to the page size. */
    readonly chunk?: number;
    /**
     * Following lanes this request may finish with bounded `take`s. Use 0
     * when matching a row is itself expensive, so one request never
     * evaluates more than `chunk` rows.
     */
    readonly peekLanes?: number;
    /** Authorization and criteria; must hold for retained IDs too. */
    readonly match: (document: Document) => boolean | Promise<boolean>;
    /** True when this and every later row of its lane cannot match. */
    readonly beyond?: (document: Document) => boolean;
    /** Presentation of a matched row; null drops it. */
    readonly hydrate: (document: Document) => Promise<Row | null>;
  },
): Promise<HrPage<Row>> {
  const source = Array.isArray(options.lanes)
    ? staticLanes(options.lanes as readonly HrLane[])
    : (options.lanes as HrLaneSource);
  const chunk = Math.min(
    HR_MAX_CHUNK,
    Math.max(1, Math.floor(options.chunk ?? options.pageSize)),
  );
  const peekLanes = Math.max(
    0,
    Math.min(MAX_PEEKED_LANES, options.peekLanes ?? MAX_PEEKED_LANES),
  );
  const scope = catalogueScope(ctx, [
    "hr",
    options.surface,
    options.criteria,
    options.pageSize,
  ]);
  // Reading stops once a page is full, so at most one chunk can overflow it.
  const maxIds = options.pageSize + chunk;
  const resumed = decode(options.scanCursor, scope, maxIds);
  const started = decode(options.cursor, scope, maxIds);
  if (resumed === "invalid" || started === "invalid") return resetHrPage();
  const state: State = resumed ??
    started ?? { v: 2, scope, lane: "", finished: false, range: {}, ids: [] };

  const ids = [...state.ids];
  const seen = new Set(ids);
  const loaded = new Map<string, Document>();
  let scanned = 0;

  const consider = async (rows: readonly Document[]) => {
    let ended = false;
    for (const row of rows) {
      if (options.beyond?.(row)) {
        ended = true;
        break;
      }
      if (seen.has(row._id) || !(await options.match(row))) continue;
      seen.add(row._id);
      ids.push(row._id);
      loaded.set(row._id, row);
    }
    return ended;
  };
  const reader = (lane: HrLane) =>
    ctx.tenantDb.byIndex<Document>(
      options.table,
      lane.index,
      lane.equality,
      lane.range,
    );

  // Position after this request: the lane being read (unfinished, with its
  // native range), or the last finished lane, or done.
  let position: {
    lane: string;
    finished: boolean;
    range: NativeRangeState;
    done: boolean;
  } = {
    lane: state.lane,
    finished: state.finished,
    range: state.range,
    done: false,
  };
  const fresh = state.lane === "" && !state.finished;
  const exhaustedState = state.lane === "" && state.finished;

  try {
    if (exhaustedState) position = { ...position, done: true };
    else if (ids.length < options.pageSize) {
      // The unfinished lane to read natively, if any.
      let current: HrLane | null = null;
      if (state.lane === "" && !state.finished) {
        current = (await source.after(null, 1))[0] ?? null;
        if (current === null) position = { ...position, done: true };
      } else if (!state.finished) {
        current = await source.resolve(state.lane);
        // A lane that is no longer authorized (revoked site) resets.
        if (current === null) return resetHrPage();
      }
      let lastFinished: string | null = state.finished ? state.lane : null;
      let continueAfter = current === null && !position.done;
      if (current !== null && current.skip) {
        lastFinished = current.key;
        continueAfter = true;
      } else if (current !== null) {
        const range = state.finished || fresh ? {} : state.range;
        const answer = await reader(current).page({
          limit: chunk,
          ...(range.raw ? { cursor: range.raw } : {}),
          ...(range.end ? { endCursor: range.end } : {}),
          ...(current.order ? { order: current.order } : {}),
        });
        const step = advanceNativeRange(range, answer);
        if (step.split)
          return scanning(
            { lane: current.key, finished: false, range: step.range },
            scanned,
          );
        scanned += answer.page.length;
        const ended = await consider(answer.page);
        if (step.exhausted || ended) {
          lastFinished = current.key;
          continueAfter = true;
        } else {
          position = {
            lane: current.key,
            finished: false,
            range: step.range,
            done: false,
          };
        }
      }
      if (continueAfter) {
        position = {
          lane: lastFinished ?? "",
          finished: lastFinished !== null,
          range: {},
          done: false,
        };
        if (ids.length < options.pageSize) {
          // Examine the following lanes with bounded reads only.
          const next = await source.after(lastFinished, peekLanes + 1);
          let budget = peekLanes;
          let finishedAll = true;
          for (const lane of next) {
            if (ids.length >= options.pageSize) {
              finishedAll = false;
              break;
            }
            if (!lane.skip && budget === 0) {
              // Persist the next lane even when this request cannot peek it.
              // Otherwise a zero-peek scan would return the same finished
              // lane forever instead of reading this lane on its next call.
              position = {
                lane: lane.key,
                finished: false,
                range: {},
                done: false,
              };
              finishedAll = false;
              break;
            }
            if (!lane.skip) {
              budget -= 1;
              const rows = await reader(lane).take(chunk + 1, lane.order);
              scanned += rows.length;
              const window = rows.slice(0, chunk);
              if (
                rows.length > chunk &&
                !window.some((row) => options.beyond?.(row))
              ) {
                // Too long to finish here: the next request pages it natively.
                position = {
                  lane: lane.key,
                  finished: false,
                  range: {},
                  done: false,
                };
                finishedAll = false;
                break;
              }
              await consider(window);
            }
            position = {
              lane: lane.key,
              finished: true,
              range: {},
              done: false,
            };
          }
          // Every following lane is finished and the source has no more.
          if (finishedAll && next.length <= peekLanes)
            position = { ...position, done: true };
        }
      }
    }
  } catch (error) {
    if (isCursorError(error)) return resetHrPage();
    throw error;
  }

  const persisted = {
    lane: position.done ? "" : position.lane,
    finished: position.done ? true : position.finished,
    range: position.done ? {} : position.range,
  };
  if (ids.length < options.pageSize && !position.done)
    return scanning(persisted, scanned);

  const shown = ids.slice(0, options.pageSize);
  const rest = ids.slice(options.pageSize);
  const page: Row[] = [];
  for (const id of shown) {
    // Rows read in an earlier request are re-read and re-authorized now.
    let document = loaded.get(id) ?? null;
    if (document === null) {
      document = await ctx.tenantDb.get<Document>(options.table, id);
      if (document === null || !(await options.match(document))) continue;
    }
    const row = await options.hydrate(document);
    if (row !== null) page.push(row);
  }
  const isDone = position.done && rest.length === 0;
  return {
    status: "ready",
    page,
    isDone,
    continueCursor: isDone
      ? ""
      : JSON.stringify({ v: 2, scope, ...persisted, ids: rest }),
    scanned,
  };

  function scanning(
    next: Pick<State, "lane" | "finished" | "range">,
    rows: number,
  ): HrPage<Row> {
    return {
      status: "scanning",
      page: [],
      isDone: false,
      continueCursor: "",
      scanCursor: JSON.stringify({ v: 2, scope, ...next, ids }),
      scanned: rows,
    };
  }
}

/** Case-insensitive, whitespace-normalized contains matching. */
export function normalizeSearch(text: string | undefined): string {
  return (text ?? "")
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}

export const containsSearch = (search: string, ...fields: readonly string[]) =>
  search === "" ||
  fields
    .join(" ")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .toLocaleLowerCase()
    .includes(search);

export const MAX_HR_SEARCH_LENGTH = 100;

/** Arguments shared by the paged HR list endpoints. */
export const hrPageArgs = {
  pageSize: v.optional(v.number()),
  cursor: v.optional(v.string()),
  scanCursor: v.optional(v.string()),
  /** A client retry counter; ignored, it only opens a fresh subscription. */
  attempt: v.optional(v.number()),
};

/**
 * The validated page size and normalized search text, or the refusal code.
 * Unsupported sizes are refused rather than clamped, so a client cannot be
 * shown a different page than it asked for.
 */
export function hrListInput(args: {
  readonly pageSize?: number | undefined;
  readonly search?: string | undefined;
}):
  | {
      readonly ok: true;
      readonly pageSize: HrPageSize;
      readonly search: string;
    }
  | {
      readonly ok: false;
      readonly code: "PAGE_SIZE_INVALID" | "SEARCH_INVALID";
    } {
  const pageSize = args.pageSize ?? 20;
  if (!isHrPageSize(pageSize)) return { ok: false, code: "PAGE_SIZE_INVALID" };
  const search = normalizeSearch(args.search);
  if (search.length > MAX_HR_SEARCH_LENGTH)
    return { ok: false, code: "SEARCH_INVALID" };
  return { ok: true, pageSize, search };
}
