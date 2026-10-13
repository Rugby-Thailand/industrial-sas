"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import {
  subscribeBrowserQuery,
  updateBrowserQuery,
} from "@/lib/browser/history";
import {
  guardedNavigate,
  registerHistoryBackHandler,
  notifyBackAvailability,
} from "@/lib/navigationGuard";
import { appHistoryIndex, APP_HISTORY_KEY } from "@/lib/browser/appHistory";
import { registerWorkflowController } from "@/lib/browser/workflowControllers";

const event = "app-query-state";
const subscribe = (listener: () => void) =>
  subscribeBrowserQuery(event, listener);

/** One native history step, with drafts owned and retained by the calling page. */
export function useWorkflowStep(
  queryKey: string,
  scope: string,
  available: boolean,
  onBack?: () => void,
  options: {
    priority?: number;
    onForward?: () => void;
    blocked?: boolean;
  } = {},
) {
  const step = useSyncExternalStore(
    subscribe,
    () => new URLSearchParams(window.location.search).get(queryKey) === "1",
    () => false,
  );
  const active = available && step;
  const metadataKey = `${queryKey}Origin`;
  const moving = useRef(false);
  const entering = useRef(false);
  const mounted = useRef(true);
  const enterVersion = useRef(0);
  const traversalCleanup = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    enterVersion.current++;
    mounted.current = true;
    return () => {
      mounted.current = false;
      traversalCleanup.current?.();
      traversalCleanup.current = null;
    };
  }, [queryKey, scope]);
  const previousActive = useRef(active);
  const afterBack = useRef<(() => void) | undefined>(undefined);
  useLayoutEffect(() => registerWorkflowController(queryKey), [queryKey]);
  useLayoutEffect(() => {
    moving.current = false;
  }, [step]);
  useLayoutEffect(() => {
    if (previousActive.current && !active) {
      onBack?.();
      const action = afterBack.current;
      afterBack.current = undefined;
      if (action) {
        const path = window.location.pathname;
        const version = enterVersion.current;
        // Browsers run microtasks between popstate listeners. A successor
        // dispatched from a microtask (a router push) would precede Next's own
        // listener, whose RESTORE then cancels it. A task runs after them all.
        setTimeout(() => {
          if (
            mounted.current &&
            path === window.location.pathname &&
            version === enterVersion.current
          )
            action();
        }, 0);
      }
    }
    if (!previousActive.current && active) options.onForward?.();
    previousActive.current = active;
  });

  function requestBack(onCancel?: () => void) {
    if (entering.current) {
      entering.current = false;
      enterVersion.current++;
      onBack?.();
      return true;
    }
    if (moving.current) return true;
    if (!active) return false;
    if (scope.startsWith("foreground:")) {
      // Mounted order differs from the order in which foregrounds are opened.
      const ownIndex = window.history.state?.[`${queryKey}OriginIndex`] ?? -1;
      for (const key of new URLSearchParams(window.location.search).keys()) {
        if (
          key.startsWith("overlay") &&
          (window.history.state?.[`${key}OriginIndex`] ?? -1) > ownIndex
        )
          return false;
      }
    }
    if (options.blocked) return true;
    const traversalVersion = enterVersion.current;
    guardedNavigate(
      () => {
        if (!mounted.current || traversalVersion !== enterVersion.current)
          return;
        traversalCleanup.current?.();
        moving.current = true;
        if (window.history.state?.[metadataKey] === scope) {
          const destination = new URL(window.location.href);
          destination.searchParams.delete(queryKey);
          const rememberIntent = () => {
            if (window.location.pathname !== destination.pathname) return;
            destination.search = window.location.search;
            destination.hash = window.location.hash;
            destination.searchParams.delete(queryKey);
          };
          const finishTraversal = () => {
            cleanupTraversal();
            if (
              !mounted.current ||
              traversalVersion !== enterVersion.current ||
              window.location.pathname !== destination.pathname
            )
              return;
            updateBrowserQuery(
              (query) => {
                for (const key of [...query.keys()]) query.delete(key);
                for (const [key, value] of destination.searchParams)
                  query.append(key, value);
              },
              { hash: destination.hash },
            );
          };
          const cleanupTraversal = () => {
            window.removeEventListener(event, rememberIntent);
            window.removeEventListener("popstate", finishTraversal, true);
            if (traversalCleanup.current === cleanupTraversal)
              traversalCleanup.current = null;
          };
          traversalCleanup.current = cleanupTraversal;
          window.addEventListener(event, rememberIntent);
          window.addEventListener("popstate", finishTraversal, {
            once: true,
            capture: true,
          });
          window.history.back();
        } else updateBrowserQuery((query) => query.delete(queryKey));
      },
      {
        preserveDraftScope: scope,
        onCancel: () => {
          afterBack.current = undefined;
          moving.current = false;
          onCancel?.();
        },
      },
    );
    return true;
  }
  function back() {
    return requestBack();
  }
  const latestBack = useRef(back);
  useLayoutEffect(() => {
    latestBack.current = back;
  });
  const stableBack = useCallback(() => latestBack.current(), []);
  const availableBack = useRef(active);
  useLayoutEffect(() => {
    availableBack.current = active;
    notifyBackAvailability();
  }, [active]);
  useLayoutEffect(
    () =>
      registerHistoryBackHandler(
        stableBack,
        options.priority,
        () => availableBack.current,
      ),
    [stableBack, options.priority],
  );
  useEffect(() => {
    // URLs cannot reconstruct unsent local data after a reload or deep link.
    if (!step || available || moving.current || options.blocked) return;
    if (window.history.state?.[metadataKey] !== scope) {
      updateBrowserQuery((query) => query.delete(queryKey));
      return;
    }
    // A completed or invalidated local step owns a real entry. Consume it,
    // rather than turning it into a duplicate of the preceding visible page.
    // Retain query/hash intent that may have changed while the picker was open.
    const destination = new URL(window.location.href);
    destination.searchParams.delete(queryKey);
    let cancelled = false;
    const version = enterVersion.current;
    const finish = () => {
      if (cancelled || !mounted.current || version !== enterVersion.current)
        return;
      moving.current = false;
      if (window.location.pathname !== destination.pathname) return;
      updateBrowserQuery(
        (query) => {
          for (const key of [...query.keys()]) query.delete(key);
          for (const [key, value] of destination.searchParams)
            query.append(key, value);
        },
        { hash: destination.hash },
      );
    };
    const cleanupInvalidTraversal = () => {
      cancelled = true;
      window.removeEventListener("popstate", finish);
      if (traversalCleanup.current === cleanupInvalidTraversal)
        traversalCleanup.current = null;
    };
    traversalCleanup.current?.();
    traversalCleanup.current = cleanupInvalidTraversal;
    queueMicrotask(() =>
      guardedNavigate(
        () => {
          if (cancelled) return;
          moving.current = true;
          window.addEventListener("popstate", finish, { once: true });
          window.history.back();
        },
        { preserveDraftScope: scope },
      ),
    );
    return cleanupInvalidTraversal;
  }, [step, available, queryKey, metadataKey, scope, options.blocked]);

  function enter() {
    afterBack.current = undefined;
    if (entering.current || active) return;
    traversalCleanup.current?.();
    const version = ++enterVersion.current;
    entering.current = true;
    const entry: { claim?: () => boolean } = {};
    guardedNavigate(
      () => {
        entering.current = false;
        if (!mounted.current || version !== enterVersion.current) {
          window.dispatchEvent(new Event(event));
          return;
        }
        const index = appHistoryIndex() ?? 0;
        const claimed = entry.claim?.() ?? false;
        updateBrowserQuery((query) => query.set(queryKey, "1"), {
          mode: claimed ? "replace" : "push",
          metadata: {
            [metadataKey]: scope,
            [`${queryKey}OriginIndex`]: index,
            ...(claimed ? { [APP_HISTORY_KEY]: index + 1 } : {}),
          },
        });
      },
      {
        preserveDraftScope: scope,
        entry,
        onCancel: () => {
          entering.current = false;
          enterVersion.current++;
        },
      },
    );
  }
  function complete(action: () => void, onCancel?: () => void) {
    if (!mounted.current || options.blocked) {
      onCancel?.();
      return;
    }
    if (moving.current) return;
    // Native Back delivers onBack before a parent's imperative completion handle
    // has refreshed. Its old active closure must not traverse the consumed entry.
    if (
      !active ||
      new URLSearchParams(window.location.search).get(queryKey) !== "1"
    ) {
      guardedNavigate(action, { ...(onCancel ? { onCancel } : {}) });
      return;
    }
    afterBack.current = action;
    if (!requestBack(onCancel)) {
      afterBack.current = undefined;
      onCancel?.();
    }
  }
  return { active, enter, back, complete };
}
