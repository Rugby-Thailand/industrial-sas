"use client";
import { useState, useSyncExternalStore } from "react";
import {
  browserQueryEvent,
  getCommittedBrowserQuery,
} from "@/lib/browser/history";
import { isGuardTraversal } from "@/lib/navigationGuard";
export const workspaceStateEvent = "storage-workspace-state";

function createWorkspaceQueryStore() {
  let query = getCommittedBrowserQuery().search;
  return {
    // Keep the published value through unrelated React renders as well.
    getSnapshot: () => query,
    subscribe: (listener: () => void) => {
      let frame: number | undefined;
      const read = () => {
        if (isGuardTraversal()) return;
        const next = getCommittedBrowserQuery().search;
        if (query !== next) {
          query = next;
          listener();
        }
      };
      const readHistory = () => {
        // Chromium can flush React/microtasks between native window listeners.
        // Read after all listeners restore the workflow URL, so a popped
        // editZone command cannot reopen an editor that was just dismissed.
        if (frame !== undefined) cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          frame = undefined;
          read();
        });
      };
      read();
      window.addEventListener("popstate", readHistory);
      window.addEventListener(browserQueryEvent, readHistory);
      // Explicit workspace intent still opens immediately.
      window.addEventListener(workspaceStateEvent, read);
      return () => {
        if (frame !== undefined) cancelAnimationFrame(frame);
        window.removeEventListener("popstate", readHistory);
        window.removeEventListener(browserQueryEvent, readHistory);
        window.removeEventListener(workspaceStateEvent, read);
      };
    },
  };
}
const serverSnapshot = () => "";

/** Read committed navigation events, not intermediate URLs used by the Back guard. */
export function useWorkspaceQuery() {
  const [store] = useState(createWorkspaceQueryStore);
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    serverSnapshot,
  );
}
