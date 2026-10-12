"use client";
import { useBrowserQuery } from "@/hooks/useBrowserQuery";
export const workspaceStateEvent = "storage-workspace-state";
/** Read committed navigation events, not intermediate URLs used by the Back guard. */
export function useWorkspaceQuery() {
  return useBrowserQuery(workspaceStateEvent).search;
}
