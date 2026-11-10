/**
 * History-state markers the app stamps on its own entries, and the reader of
 * the app entry depth. This leaf imports nothing, so the history writer
 * (`appHistory`), the query writer (`history`) and the navigation guard
 * bridge (`navigationGuard`) can all read it without importing each other.
 * `appHistory` re-exports these names for its existing callers.
 */

export const APP_ROUTE_ORIGIN_KEY = "appRouteOrigin";
export const APP_HISTORY_KEY = "appNavigationIndex";
/** The navigation guard owner's same-URL buffer entry carries this marker. */
export const GUARD_HISTORY_KEY = "__storageWorkspaceGuard";

/** Only entries visited in this app count; history.length includes other sites. */
export function appHistoryIndex(): number | undefined {
  return historyIndex(window.history.state);
}

/** The validated app depth stamped on a history state, if any. */
export function historyIndex(state: unknown): number | undefined {
  const value: unknown =
    state !== null && typeof state === "object" && APP_HISTORY_KEY in state
      ? state[APP_HISTORY_KEY]
      : undefined;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}
