"use client";
import { useState, useLayoutEffect } from "react";
import { isWorkspaceHistoryGuardActive } from "./useWorkspaceNavigationGuard";
export const workspaceStateEvent = "storage-workspace-state";
/** Read committed navigation events, not intermediate URLs used by the Back guard. */
export function useWorkspaceQuery() {
  const [query, setQuery] = useState("");
  useLayoutEffect(() => {
    const read = () => setQuery(window.location.search);
    const readHistory = () => {
      if (!isWorkspaceHistoryGuardActive()) read();
    };
    read();
    window.addEventListener("popstate", readHistory);
    window.addEventListener(workspaceStateEvent, read);
    return () => {
      window.removeEventListener("popstate", readHistory);
      window.removeEventListener(workspaceStateEvent, read);
    };
  }, []);
  return query;
}
