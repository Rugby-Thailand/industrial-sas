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
import { onNavigationBlocked } from "@/lib/navigationGuard";

const NavigationContext = createContext<{
  run: (action: () => void) => void;
  prepare: (mode: "push" | "replace") => void;
  report: (id: string, pending: boolean) => void;
  back: (action: () => void) => void;
} | null>(null);
const PendingContext = createContext(false);
const ActionPendingContext = createContext(false);

export const useNavigationProgress = () => useContext(NavigationContext);
export const useNavigationPending = () => useContext(ActionPendingContext);

/** Link status and router transitions share one immediate, shell-local fallback. */
export function NavigationProgressProvider({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [transitionPending, startTransition] = useTransition();
  const [links, setLinks] = useState<ReadonlySet<string>>(() => new Set());
  const [backRequested, setBackRequested] = useState(false);
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
  const back = useCallback((action: () => void) => {
    // Native traversal is asynchronous. Cover the gap before popstate, then
    // let the route destination below own feedback until React commits it.
    setBackRequested(true);
    try {
      action();
    } catch (error) {
      setBackRequested(false);
      throw error;
    }
  }, []);
  const prepare = useCallback(() => {
    // A new navigation supersedes any unfinished Back/Forward destination.
    setHistoryDestination(null);
    setBackRequested(false);
  }, []);
  const navigation = useMemo(
    () => ({ run, report, prepare, back }),
    [run, report, prepare, back],
  );

  useLayoutEffect(() => trackAppHistory(), []);
  useLayoutEffect(
    () =>
      onNavigationBlocked(() => {
        setBackRequested(false);
        setHistoryDestination(null);
      }),
    [],
  );
  useLayoutEffect(() => {
    committedPath.current = pathname;
  }, [pathname]);
  useLayoutEffect(() => {
    const onHistory = (event: PopStateEvent) => {
      setBackRequested(false);
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
    const onPageShow = (event: PageTransitionEvent) => {
      // A cross-document Back never dispatches popstate in this document.
      // Forward can restore its requested feedback from the browser cache.
      if (event.persisted) {
        setBackRequested(false);
        setHistoryDestination(null);
      }
    };
    window.addEventListener("popstate", onHistory);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("popstate", onHistory);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  return (
    <NavigationContext.Provider value={navigation}>
      <ActionPendingContext.Provider
        value={
          backRequested || transitionPending || links.size > 0 || historyPending
        }
      >
        <PendingContext.Provider
          value={transitionPending || links.size > 0 || historyPending}
        >
          {children}
        </PendingContext.Provider>
      </ActionPendingContext.Provider>
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
