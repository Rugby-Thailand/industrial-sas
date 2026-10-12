"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  browserQueryEvent,
  getCommittedBrowserQuery,
  getServerBrowserQuery,
  subscribeBrowserQuery,
} from "@/lib/browser/history";

/** Shared committed URL snapshot, including scope metadata, for browser query readers. */
export function useBrowserQuery(event = browserQueryEvent) {
  const subscribe = useCallback(
    (listener: () => void) => subscribeBrowserQuery(event, listener),
    [event],
  );
  return useSyncExternalStore(
    subscribe,
    getCommittedBrowserQuery,
    getServerBrowserQuery,
  );
}
