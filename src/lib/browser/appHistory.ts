export const APP_HISTORY_KEY = "appNavigationIndex";
export const GUARD_HISTORY_KEY = "__storageWorkspaceGuard";

/** Only entries visited in this app count; history.length includes other sites. */
export function appHistoryIndex(): number | undefined {
  return historyIndex(window.history.state);
}

function historyIndex(state: unknown): number | undefined {
  const value: unknown =
    state !== null && typeof state === "object" && APP_HISTORY_KEY in state
      ? state[APP_HISTORY_KEY]
      : undefined;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

/** Track actual entries, including same-URL refreshes and hash-only navigation.
 * Next can replace its internal state without changing pathname/search. Attach
 * our depth at the history write itself so those commits cannot erase Back.
 */
export function trackAppHistory(): () => void {
  const history = window.history;
  const push = history.pushState;
  const replace = history.replaceState;
  let index = appHistoryIndex() ?? 0;
  let active = true;
  const onPopState = () => {
    index = appHistoryIndex() ?? index;
  };
  const trackedPush: History["pushState"] = (data, unused, url) => {
    if (!active) return push.call(history, data, unused, url);
    const state = { ...data };
    const buffer =
      state[GUARD_HISTORY_KEY] !== undefined &&
      state[GUARD_HISTORY_KEY] !== history.state?.[GUARD_HISTORY_KEY];
    const next = (appHistoryIndex() ?? index) + (buffer ? 0 : 1);
    state[APP_HISTORY_KEY] = next;
    push.call(history, state, unused, url);
    index = next;
  };
  const trackedReplace: History["replaceState"] = (data, unused, url) => {
    if (!active) return replace.call(history, data, unused, url);
    const next = historyIndex(data) ?? appHistoryIndex() ?? index;
    // A same-URL router refresh is still the same entry. Keep its draft guard
    // and catalogue metadata while accepting Next's replacement router tree.
    // Metadata-only writes omit the URL and can intentionally remove fields.
    const sameLocation =
      url != null &&
      new URL(url, window.location.href).href === window.location.href;
    const state = sameLocation ? { ...history.state, ...data } : { ...data };
    replace.call(history, { ...state, [APP_HISTORY_KEY]: next }, unused, url);
    index = next;
  };
  history.pushState = trackedPush;
  history.replaceState = trackedReplace;
  // Omit the URL: a metadata write must not dispatch a router transition.
  trackedReplace(history.state, "");
  window.addEventListener("popstate", onPopState);
  return () => {
    active = false;
    window.removeEventListener("popstate", onPopState);
    // Next may have wrapped these methods after this effect. Leave its patch
    // in place; the captured inactive wrapper simply forwards native writes.
    if (history.pushState === trackedPush) history.pushState = push;
    if (history.replaceState === trackedReplace) history.replaceState = replace;
  };
}
