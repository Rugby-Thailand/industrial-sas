export const APP_HISTORY_KEY = "appNavigationIndex";
/** The navigation guard owner's same-URL buffer entry carries this marker. */
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

type Tracker = {
  readonly push: History["pushState"];
  readonly replace: History["replaceState"];
  readonly nativePush: History["pushState"];
  readonly nativeReplace: History["replaceState"];
};

/**
 * One wrapper pair per document. Next's Router captures whatever
 * pushState/replaceState exist when its effect runs (after ours), so once
 * captured our wrapper cannot be removed from its chain. Instead the wrapper
 * stays installed and merely passes through while no shell is tracking, and a
 * later shell reactivates the same wrapper rather than stacking another.
 */
let installed: Tracker | null = null;
let activeOwner: object | null = null;
let index = 0;
const writeListeners = new Set<() => void>();

/**
 * Observe tracked writes that create or move to another entry: every push,
 * and replacements that change the URL. Same-URL refreshes and
 * metadata-only writes are not reported. The navigation guard owner uses
 * this to invalidate a buffer removal another write overtook.
 */
export function subscribeHistoryWrites(listener: () => void): () => void {
  writeListeners.add(listener);
  return () => {
    writeListeners.delete(listener);
  };
}

/**
 * Observe every change of the current entry: tracked writes and browser
 * traversals (`popstate`). For `useSyncExternalStore` readers of location or
 * depth; each reader keeps its own snapshot.
 */
export function subscribeHistoryChanges(listener: () => void): () => void {
  const release = subscribeHistoryWrites(listener);
  window.addEventListener("popstate", listener);
  return () => {
    release();
    window.removeEventListener("popstate", listener);
  };
}

function notifyWrite() {
  for (const listener of [...writeListeners]) listener();
}

function install(history: History): Tracker {
  const nativePush = history.pushState;
  const nativeReplace = history.replaceState;
  const push: History["pushState"] = (data, unused, url) => {
    if (activeOwner === null)
      return nativePush.call(history, data, unused, url);
    const state = { ...data };
    // The guard's buffer duplicates the current page; it is not a new step.
    const buffer =
      state[GUARD_HISTORY_KEY] !== undefined &&
      state[GUARD_HISTORY_KEY] !== history.state?.[GUARD_HISTORY_KEY];
    // Any other push is a new app entry. A writer that copied the current
    // state (e.g. a pushed query) must not carry the guard marker into it, or
    // a later owner would adopt that copy as its buffer at the wrong depth.
    if (!buffer) delete state[GUARD_HISTORY_KEY];
    const next = (appHistoryIndex() ?? index) + (buffer ? 0 : 1);
    state[APP_HISTORY_KEY] = next;
    nativePush.call(history, state, unused, url);
    index = next;
    notifyWrite();
  };
  const replace: History["replaceState"] = (data, unused, url) => {
    if (activeOwner === null)
      return nativeReplace.call(history, data, unused, url);
    const next = historyIndex(data) ?? appHistoryIndex() ?? index;
    // A same-URL router refresh is still the same entry. Keep its guard and
    // catalogue metadata while accepting Next's replacement router tree.
    // Metadata-only writes omit the URL and may intentionally remove fields.
    const sameLocation =
      url != null &&
      new URL(url, window.location.href).href === window.location.href;
    const state = sameLocation ? { ...history.state, ...data } : { ...data };
    nativeReplace.call(
      history,
      { ...state, [APP_HISTORY_KEY]: next },
      unused,
      url,
    );
    index = next;
    if (url != null && !sameLocation) notifyWrite();
  };
  history.pushState = push;
  history.replaceState = replace;
  return { push, replace, nativePush, nativeReplace };
}

/**
 * Track actual app entries, including same-URL refreshes and hash-only
 * navigation, by stamping depth at the history write itself. Returns the
 * shell's cleanup. Holds no payload, cache or account data.
 */
export function trackAppHistory(): () => void {
  const history = window.history;
  const owner = {};
  installed ??= install(history);
  activeOwner = owner;
  index = appHistoryIndex() ?? 0;
  const onPopState = () => {
    index = appHistoryIndex() ?? index;
  };
  // Omit the URL: a metadata write must not dispatch a router transition.
  history.replaceState(history.state, "");
  window.addEventListener("popstate", onPopState);
  return () => {
    window.removeEventListener("popstate", onPopState);
    if (activeOwner === owner) activeOwner = null;
    const tracker = installed;
    // Only restore methods nobody wrapped after us; otherwise stay installed
    // as a pass-through inside the captured chain.
    if (
      tracker !== null &&
      activeOwner === null &&
      history.pushState === tracker.push &&
      history.replaceState === tracker.replace
    ) {
      history.pushState = tracker.nativePush;
      history.replaceState = tracker.nativeReplace;
      installed = null;
    }
  };
}
