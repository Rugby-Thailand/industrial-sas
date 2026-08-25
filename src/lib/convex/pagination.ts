export interface CursorState {
  readonly stack: readonly string[];
}

export const initialCursorState: CursorState = Object.freeze({
  stack: Object.freeze([]),
});

export const currentCursor = (state: CursorState): string | undefined =>
  state.stack.length === 0 ? undefined : state.stack[state.stack.length - 1];

export const pageNumber = (state: CursorState): number =>
  state.stack.length + 1;

export const isFirstPage = (state: CursorState): boolean =>
  state.stack.length === 0;

export function advance(
  state: CursorState,
  nextCursor: string | null,
): CursorState {
  if (nextCursor === null) return state;
  return Object.freeze({ stack: Object.freeze([...state.stack, nextCursor]) });
}

export function retreat(state: CursorState): CursorState {
  if (state.stack.length === 0) return state;
  return Object.freeze({ stack: Object.freeze(state.stack.slice(0, -1)) });
}

export const reset = (): CursorState => initialCursorState;
