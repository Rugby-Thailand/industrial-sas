"use client";

import { usePathname, useSearchParams } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";

import { RouteLoading } from "./RouteLoading";
import { APP_HISTORY_KEY, appHistoryIndex } from "@/lib/browser/appHistory";
import { updateHistoryMetadata } from "@/lib/browser/history";

const NavigationContext = createContext<{
  run: (action: () => void) => void;
  prepare: (mode: "push" | "replace") => void;
  report: (id: string, pending: boolean) => void;
} | null>(null);
const PendingContext = createContext(false);

export const useNavigationProgress = () => useContext(NavigationContext);

/** Link status and router transitions share one immediate, shell-local fallback. */
export function NavigationProgressProvider({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const search = useSearchParams()?.toString() ?? "";
  const locationKey = `${pathname}?${search}`;
  const [transitionPending, startTransition] = useTransition();
  const [links, setLinks] = useState<ReadonlySet<string>>(() => new Set());
  const [historyDestination, setHistoryDestination] = useState<string | null>(
    null,
  );
  const historyPending =
    historyDestination !== null && historyDestination !== pathname;
  const committedPath = useRef(pathname);
  const committedLocation = useRef(locationKey);
  const index = useRef(0);
  const destinationIndex = useRef<number | undefined>(undefined);
  const report = useCallback((id: string, pending: boolean) => {
    setLinks((current) => {
      if (current.has(id) === pending) return current;
      const next = new Set(current);
      if (pending) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const run = useCallback((action: () => void) => startTransition(action), []);
  const prepare = useCallback((mode: "push" | "replace") => {
    destinationIndex.current =
      (appHistoryIndex() ?? index.current) + (mode === "push" ? 1 : 0);
  }, []);
  const navigation = useMemo(
    () => ({ run, report, prepare }),
    [run, report, prepare],
  );

  useLayoutEffect(() => {
    const savedIndex = appHistoryIndex();
    index.current =
      savedIndex ??
      destinationIndex.current ??
      (committedLocation.current === locationKey ? 0 : index.current + 1);
    destinationIndex.current = undefined;
    committedPath.current = pathname;
    committedLocation.current = locationKey;
    updateHistoryMetadata((state) => {
      state[APP_HISTORY_KEY] = index.current;
    });
  }, [pathname, locationKey]);
  useLayoutEffect(() => {
    const readIndex = () => {
      index.current = appHistoryIndex() ?? index.current;
    };
    const onHistory = () => {
      readIndex();
      // Query-only navigation is already synchronous; route navigation may need RSC.
      setHistoryDestination(
        window.location.pathname !== committedPath.current
          ? window.location.pathname
          : null,
      );
    };
    window.addEventListener("popstate", onHistory);
    window.addEventListener("app-query-state", readIndex);
    return () => {
      window.removeEventListener("popstate", onHistory);
      window.removeEventListener("app-query-state", readIndex);
    };
  }, []);

  return (
    <NavigationContext.Provider value={navigation}>
      <PendingContext.Provider
        value={transitionPending || links.size > 0 || historyPending}
      >
        {children}
      </PendingContext.Provider>
    </NavigationContext.Provider>
  );
}

export function NavigationContent({ children }: { children: ReactNode }) {
  const pending = useContext(PendingContext);
  return (
    <>
      {pending ? <RouteLoading /> : null}
      {/* Retain the editor and its guard while the destination is being prepared. */}
      <div hidden={pending}>{children}</div>
    </>
  );
}
