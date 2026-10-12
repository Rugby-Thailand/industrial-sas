"use client";

import { usePathname } from "next/navigation";
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
import { trackAppHistory } from "@/lib/browser/appHistory";

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
  const [transitionPending, startTransition] = useTransition();
  const [links, setLinks] = useState<ReadonlySet<string>>(() => new Set());
  const [historyDestination, setHistoryDestination] = useState<{
    from: string | null;
    to: string;
  } | null>(null);
  const committedPath = useRef(pathname);
  // A restored entry can redirect. Any newly committed route completes the
  // history transition, even when its canonical path differs from the target.
  if (
    historyDestination !== null &&
    (historyDestination.to === pathname || historyDestination.from !== pathname)
  ) {
    setHistoryDestination(null);
  }
  const historyPending =
    historyDestination !== null && historyDestination.to !== pathname;
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
  const prepare = useCallback(() => {
    // A new navigation supersedes any unfinished Back/Forward destination.
    setHistoryDestination(null);
  }, []);
  const navigation = useMemo(
    () => ({ run, report, prepare }),
    [run, report, prepare],
  );

  useLayoutEffect(() => trackAppHistory(), []);
  useLayoutEffect(() => {
    committedPath.current = pathname;
  }, [pathname]);
  useLayoutEffect(() => {
    const onHistory = (event: PopStateEvent) => {
      // Native fragment entries have no Next router tree. Next ignores them,
      // so waiting for their pathname to commit would hide the page forever.
      if (!event.state?.__NA) {
        setHistoryDestination(null);
        return;
      }
      // Query-only navigation is already synchronous; route navigation may need RSC.
      setHistoryDestination(
        window.location.pathname !== committedPath.current
          ? { from: committedPath.current, to: window.location.pathname }
          : null,
      );
    };
    window.addEventListener("popstate", onHistory);
    return () => {
      window.removeEventListener("popstate", onHistory);
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
