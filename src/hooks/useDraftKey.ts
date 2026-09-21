"use client";
import { useAuth } from "@clerk/nextjs";
import { useEffect } from "react";
import { clearCursorPositions } from "./useCursorPagination";
/** Actor-scoped drafts, including pending command IDs. */
export function useDraftKey(scope: string): string | null {
  const { isLoaded, userId } = useAuth();
  useEffect(() => {
    if (isLoaded && !userId) clearCursorPositions();
  }, [isLoaded, userId]);
  return isLoaded && userId ? `${scope}:${userId}` : null;
}
