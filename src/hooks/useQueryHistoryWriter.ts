"use client";

import { useEffect, useRef } from "react";
import { updateBrowserQuery } from "@/lib/browser/history";

/** A new view/filter is one Back step; consecutive search keystrokes share a step. */
export function useQueryHistoryWriter() {
  const typing = useRef<{ href: string; time: number } | null>(null);
  useEffect(() => {
    const endTyping = () => {
      typing.current = null;
    };
    window.addEventListener("popstate", endTyping);
    return () => window.removeEventListener("popstate", endTyping);
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
      previous.href === window.location.href &&
      now - previous.time < 1000;
    updateBrowserQuery(change, {
      ...options,
      mode: replace ? "replace" : "push",
    });
    typing.current = options.typing
      ? { href: window.location.href, time: now }
      : null;
  };
}
