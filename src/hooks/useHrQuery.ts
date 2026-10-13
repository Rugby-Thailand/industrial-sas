"use client";

import { useQuery, type OptionalRestArgsOrSkip } from "convex/react";
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from "convex/server";
import { useState, useSyncExternalStore } from "react";

// This is an invalidation token only. HR queries and every write still use
// authoritative server time; the browser cannot choose an attendance date.
const REFRESH_MS = 60_000;
let snapshot = 0;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function refresh() {
  if (document.visibilityState === "hidden") return;
  snapshot = Math.max(Date.now(), snapshot + 1);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    timer = setInterval(refresh, REFRESH_MS);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    refresh();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearInterval(timer);
      timer = undefined;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    }
  };
}

const noSubscribe = () => () => {};
const getSnapshot = () => snapshot;
const getServerSnapshot = () => 0;

/**
 * Refresh time-dependent HR reads while keeping the previous subscription live
 * until its replacement answers. A minute tick must not unmount a dirty editor.
 * Both subscriptions always use the caller's current args and Convex auth; no
 * cached result survives an identity, permission, filter or record change.
 */
export function useHrQuery<Query extends FunctionReference<"query">>(
  query: Query,
  args: FunctionArgs<Query> | "skip",
  refreshClock = true,
): FunctionReturnType<Query> | undefined {
  const enabled = refreshClock && args !== "skip";
  const token = useSyncExternalStore(
    enabled ? subscribe : noSubscribe,
    getSnapshot,
    getServerSnapshot,
  );
  const [settledToken, setSettledToken] = useState(token);
  const previousArgs =
    args === "skip"
      ? "skip"
      : enabled
        ? { ...args, clockRefresh: settledToken }
        : args;
  const currentArgs =
    args === "skip" || !enabled || settledToken === token
      ? "skip"
      : { ...args, clockRefresh: token };
  // Convex models optional query arguments as a conditional rest tuple. Each
  // tuple here contains exactly the required args object (or its skip sentinel).
  const previous = useQuery(
    query,
    ...([previousArgs] as OptionalRestArgsOrSkip<Query>),
  );
  const current = useQuery(
    query,
    ...([currentArgs] as OptionalRestArgsOrSkip<Query>),
  );
  if (current !== undefined && settledToken !== token) setSettledToken(token);
  return current ?? previous;
}
