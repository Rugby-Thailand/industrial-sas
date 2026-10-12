"use client";

import { useEffect, useRef } from "react";
import {
  subscribeBrowserQuery,
  updateBrowserQuery,
} from "@/lib/browser/history";

/** A new view/filter is one Back step; consecutive search keystrokes share a step. */
export function useQueryHistoryWriter(scope = "") {
  const typing = useRef<{ href: string; time: number; scope: string } | null>(
    null,
  );
  useEffect(() => {
    const endTyping = () => {
      typing.current = null;
    };
    // Committed traversals terminate typing; internal guard restoration does not.
    return subscribeBrowserQuery("app-query-state", endTyping);
  }, []);
  return (
    change: (query: URLSearchParams) => void,
    options: {
      metadata: Record<string, unknown>;
      event: string;
      typing: boolean;
    },
  ) => {
    const previous = typing.current;
    const now = Date.now();
    const replace =
      options.typing &&
      previous !== null &&
      previous.scope === scope &&
      previous.href === window.location.href &&
      now - previous.time < 1000;
    updateBrowserQuery(change, {
      ...options,
      mode: replace ? "replace" : "push",
    });
    typing.current = options.typing
      ? { href: window.location.href, time: now, scope }
      : null;
  };
}
