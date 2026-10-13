import { APP_HISTORY_KEY, appHistoryIndex } from "./appHistory";
import { isGuardTraversal } from "@/lib/navigationGuard";

export const browserQueryEvent = "app-query-state";
type HistoryMarkers = Readonly<
  Record<string, string | number | boolean | null>
>;
export type BrowserQuerySnapshot = {
  search: string;
  /** Scalar entry markers only. Router trees and feature payloads remain in browser history. */
  state: HistoryMarkers | null;
};
const serverSnapshot: BrowserQuerySnapshot = { search: "", state: null };
let committed: { href: string; snapshot: BrowserQuerySnapshot } | undefined;

function historyMarkers(): HistoryMarkers | null {
  const value: unknown = window.history.state;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, marker]) =>
        marker === null ||
        ["string", "number", "boolean"].includes(typeof marker),
    ),
  );
}
function sameMarkers(a: HistoryMarkers | null, b: HistoryMarkers | null) {
  if (a === null || b === null) return a === b;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && Object.is(a[key], b[key]))
  );
}

/** Only the current browser entry is cached; no feature data or preferences live here. */
export function getCommittedBrowserQuery(): BrowserQuerySnapshot {
  if (typeof window === "undefined") return serverSnapshot;
  // A restoring/removing guard may briefly visit another entry. Even an unrelated
  // React render must keep reading the last committed URL and its scope markers.
  if (committed && isGuardTraversal()) return committed.snapshot;
  const href = window.location.href;
  const state = historyMarkers();
  if (
    !committed ||
    committed.href !== href ||
    !sameMarkers(committed.snapshot.state, state)
  )
    committed = { href, snapshot: { search: window.location.search, state } };
  return committed.snapshot;
}

export function getServerBrowserQuery(): BrowserQuerySnapshot {
  return serverSnapshot;
}

/** Change only owned query parameters, preserving the hash and other features' state. */
export function updateBrowserQuery(
  change: (query: URLSearchParams) => void,
  options: {
    mode?: "push" | "replace";
    metadata?: Record<string, unknown>;
    event?: string;
    hash?: string;
  } = {},
) {
  const url = new URL(window.location.href);
  const previousHash = url.hash;
  const previousQuery = url.searchParams.toString();
  change(url.searchParams);
  if (options.hash !== undefined) url.hash = options.hash;
  const state = { ...window.history.state, ...options.metadata };
  const changed =
    url.searchParams.toString() !== previousQuery || url.hash !== previousHash;
  const push = options.mode === "push" && changed;
  const index = appHistoryIndex();
  if (push && index !== undefined) state[APP_HISTORY_KEY] = index + 1;
  if (changed) {
    // Let Next's patched API synchronize URL changes rather than treating them as internal.
    delete state.__NA;
    delete state._N;
    window.history[push ? "pushState" : "replaceState"](
      state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  } else {
    // Unchanged query writes are metadata-only, preserving the exact URL and
    // router markers without requesting a redundant Next URL restoration.
    window.history.replaceState(state, "");
  }
  if (options.event) window.dispatchEvent(new Event(options.event));
  window.dispatchEvent(new Event(browserQueryEvent));
}

/** Metadata-only writes must retain Next's router markers and omit a URL. */
export function updateHistoryMetadata(
  change: (state: Record<string, unknown>) => void,
) {
  const state = { ...window.history.state };
  change(state);
  window.history.replaceState(state, "");
}
export function subscribeBrowserQuery(event: string, listener: () => void) {
  let previous = getCommittedBrowserQuery();
  const notify = () => {
    if (isGuardTraversal()) return;
    const next = getCommittedBrowserQuery();
    // Writers emit both their legacy feature event and the common commit event.
    if (next !== previous) {
      previous = next;
      listener();
    }
  };
  const traverse = () => {
    if (isGuardTraversal()) return;
    previous = getCommittedBrowserQuery();
    listener();
  };
  const events = new Set([event, browserQueryEvent]);
  window.addEventListener("popstate", traverse);
  for (const name of events) window.addEventListener(name, notify);
  return () => {
    window.removeEventListener("popstate", traverse);
    for (const name of events) window.removeEventListener(name, notify);
  };
}
