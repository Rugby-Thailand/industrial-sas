"use client";

import { useCallback, useSyncExternalStore } from "react";

const getServerSnapshot = () => false;

/**
 * Whether a CSS media query matches the viewport. The server and the
 * hydrating render read false; the client then reads `.matches`. The
 * subscription stays the same until `query` changes, and removes its
 * listener from the same MediaQueryList it subscribed to. There is no shared
 * cache: each caller subscribes for itself.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    [query],
  );
  const getSnapshot = useCallback(
    () => window.matchMedia(query).matches,
    [query],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
