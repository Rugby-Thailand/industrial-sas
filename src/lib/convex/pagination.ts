/**
 * Forward-only cursor paging, as a pure reducer.
 *
 * The ledger reads are cursor-paged and deliberately have no `collect` and no
 * offset: a tenant accumulates on the order of a million ledger lines a year
 * (B-11), so there is no "page 7" to jump to and no total to count. A cursor
 * names where the *next* page starts and nothing else.
 *
 * That leaves "go back" needing somewhere to remember the cursors already used,
 * and the browser is the only place that has them. The stack below is that
 * memory: pushing on the way forward, popping on the way back. The stack is
 * bounded by how many times an operator pressed "next", which is a bound an
 * operator enforces themselves.
 *
 * Kept separate from React so the interesting cases — retreating from the first
 * page, advancing past the end — are unit-testable without rendering anything.
 */

export interface CursorState {
  /** Cursors used so far. Empty means the first page. */
  readonly stack: readonly string[];
}

export const initialCursorState: CursorState = Object.freeze({
  stack: Object.freeze([]),
});

/** The cursor for the page currently displayed; `undefined` on the first. */
export const currentCursor = (state: CursorState): string | undefined =>
  state.stack.length === 0 ? undefined : state.stack[state.stack.length - 1];

/** 1-based, for display. There is no total page count and never will be. */
export const pageNumber = (state: CursorState): number =>
  state.stack.length + 1;

export const isFirstPage = (state: CursorState): boolean =>
  state.stack.length === 0;

/**
 * Move to the page starting at `nextCursor`.
 *
 * A `null` cursor means the server said there is no next page, so this is a
 * no-op rather than a push of `"null"`. Callers still disable the control; this
 * makes the state machine safe even when one forgets.
 */
export function advance(
  state: CursorState,
  nextCursor: string | null,
): CursorState {
  if (nextCursor === null) return state;
  return Object.freeze({ stack: Object.freeze([...state.stack, nextCursor]) });
}

/** Move back one page. A no-op on the first page. */
export function retreat(state: CursorState): CursorState {
  if (state.stack.length === 0) return state;
  return Object.freeze({ stack: Object.freeze(state.stack.slice(0, -1)) });
}

/**
 * Back to the first page.
 *
 * Used when the warehouse changes: a cursor is only meaningful inside the query
 * it came from, and carrying one across warehouses would ask the server to
 * resume a scan of a different index.
 */
export const reset = (): CursorState => initialCursorState;
