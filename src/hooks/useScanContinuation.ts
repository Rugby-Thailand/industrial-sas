"use client";

import { useEffect, useState } from "react";

/** Keep scan continuation separate from the user's page position. */
export function useScanContinuation(key: string) {
  const [state, setState] = useState<{ key: string; cursor?: string }>({ key });
  const cursor = state.key === key ? state.cursor : undefined;
  if (state.key !== key) setState({ key });
  return {
    cursor,
    advance: (next?: string) =>
      setState((current) =>
        current.key === key && current.cursor === next
          ? current
          : { key, ...(next ? { cursor: next } : {}) },
      ),
  };
}

export function useDebouncedSearch(value: string, delay = 250) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return settled;
}
