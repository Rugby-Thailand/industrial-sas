import {
  hasWorkflowController,
  isRetiredWorkflowController,
  workflowRouteChanged,
  WORKFLOW_CONTROLLERS_EVENT,
} from "./workflowControllers";
import { updateBrowserQuery } from "./history";

export const APP_ROUTE_ORIGIN_KEY = "appRouteOrigin";
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

function routePath(url: URL): string {
  return url.pathname.replace(/^\/(?:en|th)(?=\/|$)/, "") || "/";
}

function unchangedQuery(current: URL, destination: URL, key: string): boolean {
  const values = current.searchParams.getAll(key);
  const next = destination.searchParams.getAll(key);
  return (
    values.length === next.length &&
    values.every((value, i) => value === next[i])
  );
}

function internalSource(value: string, current: URL): URL | undefined {
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\u0000-\u0020\u007f]/.test(value)
  )
    return;
  const source = new URL(value, current);
  return source.origin === current.origin ? source : undefined;
}

/** Next's router.replace can omit custom state even though it keeps this entry. */
function replacementMetadata(
  destination: URL,
  index: number,
): Record<string, unknown> {
  const current = new URL(window.location.href);
  const previous = window.history.state;
  const kept: Record<string, unknown> = {};
  const origin: unknown = previous?.[APP_ROUTE_ORIGIN_KEY];
  if (
    origin &&
    typeof origin === "object" &&
    "href" in origin &&
    typeof origin.href === "string" &&
    internalSource(origin.href, current) &&
    "index" in origin &&
    typeof origin.index === "number" &&
    Number.isSafeInteger(origin.index) &&
    origin.index >= 0 &&
    origin.index < index
  )
    kept[APP_ROUTE_ORIGIN_KEY] = origin;
  if (routePath(current) !== routePath(destination)) return kept;
  for (const key of destination.searchParams.keys()) {
    const scope: unknown = previous?.[`${key}Origin`];
    const ownIndex: unknown = previous?.[`${key}OriginIndex`];
    if (
      destination.searchParams.get(key) === "1" &&
      unchangedQuery(current, destination, key) &&
      typeof scope === "string" &&
      typeof ownIndex === "number" &&
      Number.isSafeInteger(ownIndex) &&
      ownIndex >= 0 &&
      ownIndex < index
    ) {
      kept[`${key}Origin`] = scope;
      kept[`${key}OriginIndex`] = ownIndex;
    }
  }
  const editor: unknown = previous?.hrEmployeeEditorOrigin;
  if (
    routePath(destination) === "/hr/employees" &&
    ["edit", "new"].includes(destination.searchParams.get("mode") ?? "") &&
    ["mode", "employee"].every((key) =>
      unchangedQuery(current, destination, key),
    ) &&
    editor &&
    typeof editor === "object" &&
    "url" in editor &&
    typeof editor.url === "string" &&
    "index" in editor &&
    editor.index === index &&
    index > 0
  ) {
    const source = internalSource(editor.url, current);
    if (source && routePath(source) === "/hr/employees")
      kept.hrEmployeeEditorOrigin = editor;
  }
  return kept;
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
    const destination =
      url == null
        ? new URL(window.location.href)
        : new URL(url, window.location.href);
    if (!buffer && destination.pathname !== window.location.pathname) {
      workflowRouteChanged();
      state[APP_ROUTE_ORIGIN_KEY] = {
        href:
          window.location.pathname +
          window.location.search +
          window.location.hash,
        index: appHistoryIndex() ?? index,
      };
    } else if (history.state?.[APP_ROUTE_ORIGIN_KEY])
      state[APP_ROUTE_ORIGIN_KEY] = history.state[APP_ROUTE_ORIGIN_KEY];
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
    const state = sameLocation
      ? { ...history.state, ...data }
      : {
          ...(url != null
            ? replacementMetadata(new URL(url, window.location.href), next)
            : {}),
          ...data,
        };
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
  let orphanFrame: number | undefined;
  let currentPath = window.location.pathname;
  let initializing = true;
  const onPopState = () => {
    if (currentPath !== window.location.pathname) {
      workflowRouteChanged();
      currentPath = window.location.pathname;
    }
    const initial = initializing;
    index = appHistoryIndex() ?? index;

    if (orphanFrame !== undefined) cancelAnimationFrame(orphanFrame);
    orphanFrame = requestAnimationFrame(() => {
      if (activeOwner !== owner || history.state?.[GUARD_HISTORY_KEY]) return;
      const destination = new URL(window.location.href);
      const missing = [...destination.searchParams.keys()].filter(
        (key) =>
          key.startsWith("overlay") &&
          !hasWorkflowController(key) &&
          (initial || isRetiredWorkflowController(key, destination.pathname)),
      );
      if (missing.length === 0) return;
      const indices = missing.flatMap((key) => {
        const value: unknown = history.state?.[`${key}OriginIndex`];
        return typeof history.state?.[`${key}Origin`] === "string" &&
          typeof value === "number" &&
          Number.isSafeInteger(value) &&
          value >= 0 &&
          value < (appHistoryIndex() ?? 0)
          ? [value]
          : [];
      });
      missing.forEach((key) => destination.searchParams.delete(key));
      const restore = () => {
        if (window.location.pathname !== destination.pathname) return;
        updateBrowserQuery(
          (query) => {
            for (const key of [...query.keys()]) query.delete(key);
            for (const [key, value] of destination.searchParams)
              query.append(key, value);
          },
          { hash: destination.hash },
        );
      };
      if (indices.length === 0) {
        restore();
        return;
      }
      window.addEventListener("popstate", restore, { once: true });
      history.go(Math.min(...indices) - (appHistoryIndex() ?? 0));
    });
  };

  // Omit the URL: a metadata write must not dispatch a router transition.
  history.replaceState(history.state, "");
  window.addEventListener("popstate", onPopState);
  window.addEventListener(WORKFLOW_CONTROLLERS_EVENT, onPopState);
  onPopState();
  initializing = false;
  return () => {
    window.removeEventListener("popstate", onPopState);
    window.removeEventListener(WORKFLOW_CONTROLLERS_EVENT, onPopState);
    if (orphanFrame !== undefined) cancelAnimationFrame(orphanFrame);
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
