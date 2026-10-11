"use client";

import { createContext, useContext, useLayoutEffect, useRef } from "react";

import type { PageSearchContext } from "@/lib/search/resolveIntent";

export const PageContextSetter = createContext<
  ((context: PageSearchContext | null) => void) | null
>(null);

/**
 * Publish the record a page shows, so AI Search can resolve "this one".
 * The dialog displays it and lets the user clear it; only flags reach the
 * server. Pass null when nothing is selected or it is not loaded yet.
 */
export function usePageSearchContext(context: PageSearchContext | null): void {
  const set = useContext(PageContextSetter);
  const key = context === null ? "" : JSON.stringify(context);
  const latest = useRef(context);
  useLayoutEffect(() => {
    latest.current = context;
  });
  useLayoutEffect(() => {
    if (set === null || key === "") return;
    set(latest.current);
    return () => set(null);
  }, [key, set]);
}
