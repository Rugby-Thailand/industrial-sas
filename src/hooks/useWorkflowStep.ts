"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  getCommittedBrowserQuery,
  removeBrowserQueryKeys,
  subscribeBrowserQuery,
  updateBrowserQuery,
} from "@/lib/browser/history";
import {
  cancelForegroundApprovals,
  cancelGuardedTransition,
  guardedNavigate,
  isGuardTraversal,
  notifyBackAvailability,
  registerHistoryBackHandler,
} from "@/lib/navigationGuard";
import {
  APP_HISTORY_KEY,
  appHistoryIndex,
  subscribeHistoryReplacements,
  subscribeHistoryWrites,
} from "@/lib/browser/appHistory";
import { registerWorkflowController } from "@/lib/browser/workflowControllers";

const event = "app-query-state";
let nextInstanceId = 0;

function parseEntryMarker(
  value: unknown,
  instanceId: string,
):
  | { readonly owned: true; readonly seq: number }
  | { readonly owned: false }
  | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const colon = value.indexOf(":");
  if (colon <= 0) return { owned: false };
  const owner = value.slice(0, colon);
  const seq = Number(value.slice(colon + 1));
  if (!Number.isSafeInteger(seq) || seq <= 0) return { owned: false };
  return owner === instanceId ? { owned: true, seq } : { owned: false };
}

function isTopmostForeground(
  queryKey: string,
  scope: string,
  search: string,
  state: Readonly<Record<string, unknown>> | null,
): boolean {
  if (!scope.startsWith("foreground:")) return true;
  const ownIndex =
    typeof state?.[`${queryKey}OriginIndex`] === "number"
      ? (state[`${queryKey}OriginIndex`] as number)
      : -1;
  for (const key of new URLSearchParams(search).keys()) {
    if (key === queryKey || !key.startsWith("overlay")) continue;
    const otherIndex =
      typeof state?.[`${key}OriginIndex`] === "number"
        ? (state[`${key}OriginIndex`] as number)
        : -1;
    if (otherIndex > ownIndex) return false;
  }
  return true;
}

interface StepTracker {
  readonly instanceId: string;
  readonly getRevocationEpoch: () => number;
  readonly nextEntryMarker: () => string;
  readonly retire: (nextEpoch: number) => boolean;
  readonly isRetired: (marker: unknown, currentEpoch: number) => boolean;
  readonly subscribe: (listener: () => void) => () => void;
}

function createStepTracker(initialEpoch: number): StepTracker {
  const instanceId = String(++nextInstanceId);
  let entrySeq = 0;
  let revocationEpoch = Math.max(0, initialEpoch);
  let retiredUpToSeq = 0;
  let retiredUnowned = initialEpoch > 0;
  const listeners = new Set<() => void>();
  return {
    instanceId,
    getRevocationEpoch: () => revocationEpoch,
    nextEntryMarker: () => {
      entrySeq += 1;
      return `${instanceId}:${entrySeq}`;
    },
    retire: (nextEpoch: number) => {
      if (nextEpoch <= revocationEpoch) return false;
      revocationEpoch = nextEpoch;
      retiredUpToSeq = Math.max(retiredUpToSeq, entrySeq);
      retiredUnowned = true;
      for (const listener of [...listeners]) listener();
      return true;
    },
    isRetired: (marker: unknown, currentEpoch: number) => {
      if (currentEpoch > revocationEpoch) return true;
      const parsed = parseEntryMarker(marker, instanceId);
      if (parsed === null || !parsed.owned) return retiredUnowned;
      return parsed.seq <= retiredUpToSeq;
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

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
    revocationEpoch?: number;
  } = {},
) {
  const epoch = options.revocationEpoch ?? 0;
  const [tracker] = useState(() => createStepTracker(epoch));
  const metadataKey = `${queryKey}Origin`;
  const entryKey = `${queryKey}Entry`;
  const subscribe = useCallback(
    (listener: () => void) => {
      const onHistoryMutation = () => {
        if (!isGuardTraversal()) listener();
      };
      const releaseQuery = subscribeBrowserQuery(event, listener);
      const releaseWrites = subscribeHistoryWrites(onHistoryMutation);
      const releaseReplacements =
        subscribeHistoryReplacements(onHistoryMutation);
      const releaseTracker = tracker.subscribe(listener);
      return () => {
        releaseQuery();
        releaseWrites();
        releaseReplacements();
        releaseTracker();
      };
    },
    [tracker],
  );
  const snapshot = useSyncExternalStore(
    subscribe,
    () => {
      const committed = getCommittedBrowserQuery();
      if (new URLSearchParams(committed.search).get(queryKey) !== "1")
        return "";
      const state = committed.state;
      const originMatches = state?.[metadataKey] === scope ? "1" : "0";
      const topmost = isTopmostForeground(
        queryKey,
        scope,
        committed.search,
        state,
      )
        ? "1"
        : "0";
      const marker =
        typeof state?.[entryKey] === "string" ? state[entryKey] : "";
      const isRetired = tracker.isRetired(marker, epoch) ? "1" : "0";
      // The draft buffer can be removed without changing the URL or the
      // foreground marker. Its completion republishes the query snapshot.
      const retiringDuringGuard =
        isRetired === "1" && isGuardTraversal() ? "1" : "0";
      return `${originMatches}|${topmost}|${isRetired}|${marker}|${retiringDuringGuard}`;
    },
    () => "",
  );
  const step = snapshot !== "";
  const [, topmostFlag = "0", retiredFlag = "0"] = snapshot.split("|");
  const topmost = topmostFlag === "1";
  const retired = step && retiredFlag === "1";
  const active = available && step && !retired;

  const moving = useRef(false);
  const entering = useRef(false);
  const mounted = useRef(true);
  const enterVersion = useRef(0);
  const intentOwnerRef = useRef({});
  const traversalCleanup = useRef<(() => void) | null>(null);
  const afterBack = useRef<(() => void) | undefined>(undefined);
  useLayoutEffect(() => {
    enterVersion.current++;
    mounted.current = true;
    return () => {
      mounted.current = false;
      traversalCleanup.current?.();
      traversalCleanup.current = null;
    };
  }, [queryKey, scope]);
  useLayoutEffect(() => {
    if (epoch <= tracker.getRevocationEpoch()) return;
    entering.current = false;
    afterBack.current = undefined;
    enterVersion.current++;
    traversalCleanup.current?.();
    traversalCleanup.current = null;
    cancelGuardedTransition(intentOwnerRef.current);
    if (scope.startsWith("foreground:")) cancelForegroundApprovals(scope);
    tracker.retire(epoch);
  }, [epoch, scope, tracker]);
  const previousActive = useRef(active);
  useLayoutEffect(() => registerWorkflowController(queryKey), [queryKey]);
  useLayoutEffect(() => {
    moving.current = false;
  }, [step, snapshot]);
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

  const clearStepMetadata = useCallback(() => {
    return {
      [metadataKey]: undefined,
      [`${queryKey}OriginIndex`]: undefined,
      [entryKey]: undefined,
    };
  }, [queryKey, metadataKey, entryKey]);

  function requestBack(onCancel?: () => void) {
    if (entering.current) {
      entering.current = false;
      enterVersion.current++;
      onBack?.();
      return true;
    }
    if (moving.current) return true;
    if (!active) return false;
    if (
      !isTopmostForeground(
        queryKey,
        scope,
        window.location.search,
        window.history.state,
      )
    )
      return false;
    if (options.blocked) return true;
    const traversalVersion = enterVersion.current;
    const expectedEntry: unknown = window.history.state?.[entryKey];
    const expectedScope: unknown = window.history.state?.[metadataKey];
    const isValid = () =>
      mounted.current &&
      traversalVersion === enterVersion.current &&
      new URLSearchParams(window.location.search).get(queryKey) === "1" &&
      window.history.state?.[entryKey] === expectedEntry &&
      window.history.state?.[metadataKey] === expectedScope &&
      isTopmostForeground(
        queryKey,
        scope,
        window.location.search,
        window.history.state,
      );
    guardedNavigate(
      () => {
        if (!isValid()) return;
        traversalCleanup.current?.();
        moving.current = true;
        const ownIndex: unknown =
          window.history.state?.[`${queryKey}OriginIndex`];
        const currentAppIndex = appHistoryIndex();
        const hasPredecessor =
          currentAppIndex === undefined ||
          (typeof ownIndex === "number" &&
            Number.isSafeInteger(ownIndex) &&
            ownIndex >= 0 &&
            ownIndex < currentAppIndex);
        if (window.history.state?.[metadataKey] === scope && hasPredecessor) {
          const destinationPath = window.location.pathname;
          let destinationSearch = removeBrowserQueryKeys(
            window.location.search,
            [queryKey],
          );
          let destinationHash = window.location.hash;
          const rememberIntent = () => {
            if (window.location.pathname !== destinationPath) return;
            destinationSearch = removeBrowserQueryKeys(window.location.search, [
              queryKey,
            ]);
            destinationHash = window.location.hash;
          };
          const finishTraversal = () => {
            cleanupTraversal();
            if (
              !mounted.current ||
              traversalVersion !== enterVersion.current ||
              window.location.pathname !== destinationPath
            )
              return;
            updateBrowserQuery(() => {}, {
              rawSearch: destinationSearch,
              hash: destinationHash,
            });
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
        } else
          updateBrowserQuery(() => {}, {
            rawSearch: removeBrowserQueryKeys(window.location.search, [
              queryKey,
            ]),
            metadata: clearStepMetadata(),
          });
      },
      {
        preserveDraftScope: scope,
        intentOwner: intentOwnerRef.current,
        isValid,
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
    // URLs cannot reconstruct unsent local data after a reload, deep link, or revocation.
    if (
      !step ||
      (available && !retired) ||
      moving.current ||
      options.blocked ||
      (retired && isGuardTraversal())
    )
      return;
    if (
      !topmost ||
      !isTopmostForeground(
        queryKey,
        scope,
        window.location.search,
        window.history.state,
      )
    )
      return;
    const expectedEntry: unknown = window.history.state?.[entryKey];
    const expectedScope: unknown = window.history.state?.[metadataKey];
    const parsed = parseEntryMarker(expectedEntry, tracker.instanceId);
    const ownIndex: unknown = window.history.state?.[`${queryKey}OriginIndex`];
    const currentAppIndex = appHistoryIndex();
    const hasPredecessor =
      currentAppIndex === undefined ||
      (typeof ownIndex === "number" &&
        Number.isSafeInteger(ownIndex) &&
        ownIndex >= 0 &&
        ownIndex < currentAppIndex);
    const shouldConsume =
      expectedScope === scope &&
      hasPredecessor &&
      (!retired || parsed?.owned === true);
    if (!shouldConsume) {
      updateBrowserQuery(() => {}, {
        rawSearch: removeBrowserQueryKeys(window.location.search, [queryKey]),
        metadata: clearStepMetadata(),
      });
      return;
    }
    // A completed, invalidated, or retired owned step owns a real entry.
    // Consume it rather than turning it into a duplicate of the preceding visible page,
    // retaining raw query/hash intent that may have changed while the picker was open.
    const destinationPath = window.location.pathname;
    let destinationSearch = removeBrowserQueryKeys(window.location.search, [
      queryKey,
    ]);
    let destinationHash = window.location.hash;
    let cancelled = false;
    const version = enterVersion.current;
    const isStillTarget = () =>
      !cancelled &&
      mounted.current &&
      version === enterVersion.current &&
      new URLSearchParams(window.location.search).get(queryKey) === "1" &&
      window.history.state?.[entryKey] === expectedEntry &&
      window.history.state?.[metadataKey] === expectedScope &&
      isTopmostForeground(
        queryKey,
        scope,
        window.location.search,
        window.history.state,
      );
    const rememberIntent = () => {
      if (window.location.pathname !== destinationPath) return;
      destinationSearch = removeBrowserQueryKeys(window.location.search, [
        queryKey,
      ]);
      destinationHash = window.location.hash;
    };
    const finish = () => {
      if (cancelled || !mounted.current || version !== enterVersion.current)
        return;
      cleanupInvalidTraversal();
      moving.current = false;
      if (window.location.pathname !== destinationPath) return;
      updateBrowserQuery(() => {}, {
        rawSearch: destinationSearch,
        hash: destinationHash,
      });
    };
    const cleanupInvalidTraversal = () => {
      cancelled = true;
      window.removeEventListener(event, rememberIntent);
      window.removeEventListener("popstate", finish, true);
      if (traversalCleanup.current === cleanupInvalidTraversal)
        traversalCleanup.current = null;
    };
    traversalCleanup.current?.();
    traversalCleanup.current = cleanupInvalidTraversal;
    queueMicrotask(() => {
      if (!isStillTarget()) return;
      guardedNavigate(
        () => {
          if (!isStillTarget()) return;
          moving.current = true;
          // Preserve keystrokes/query intent while native traversal is pending,
          // then restore it before router/popstate subscribers read the URL.
          rememberIntent();
          window.addEventListener(event, rememberIntent);
          window.addEventListener("popstate", finish, {
            once: true,
            capture: true,
          });
          window.history.back();
        },
        {
          preserveDraftScope: scope,
          isValid: isStillTarget,
        },
      );
    });
    return cleanupInvalidTraversal;
  }, [
    step,
    available,
    retired,
    topmost,
    snapshot,
    queryKey,
    metadataKey,
    entryKey,
    scope,
    options.blocked,
    tracker,
    clearStepMetadata,
  ]);

  function enter() {
    afterBack.current = undefined;
    if (entering.current || active) return;
    traversalCleanup.current?.();
    const version = ++enterVersion.current;
    entering.current = true;
    const entry: { claim?: () => boolean } = {};
    const isValid = () => mounted.current && version === enterVersion.current;
    guardedNavigate(
      () => {
        entering.current = false;
        if (!isValid()) {
          window.dispatchEvent(new Event(event));
          return;
        }
        const index = appHistoryIndex() ?? 0;
        const claimed = entry.claim?.() ?? false;
        const entryMarker = tracker.nextEntryMarker();
        const underlay = removeBrowserQueryKeys(window.location.search, [
          queryKey,
        ]);
        updateBrowserQuery(() => {}, {
          rawSearch: `${underlay}${underlay ? "&" : "?"}${encodeURIComponent(queryKey)}=1`,
          mode: claimed ? "replace" : "push",
          metadata: {
            [metadataKey]: scope,
            [`${queryKey}OriginIndex`]: index,
            [entryKey]: entryMarker,
            ...(claimed ? { [APP_HISTORY_KEY]: index + 1 } : {}),
          },
        });
      },
      {
        preserveDraftScope: scope,
        intentOwner: intentOwnerRef.current,
        isValid,
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
  function completeOwned(action: () => void, onCancel?: () => void): boolean {
    if (!mounted.current || options.blocked || moving.current || !active) {
      onCancel?.();
      return false;
    }
    const state = window.history.state;
    const marker: unknown = state?.[entryKey];
    const parsed = parseEntryMarker(marker, tracker.instanceId);
    if (
      new URLSearchParams(window.location.search).get(queryKey) !== "1" ||
      state?.[metadataKey] !== scope ||
      !parsed?.owned ||
      tracker.isRetired(marker, epoch) ||
      !isTopmostForeground(queryKey, scope, window.location.search, state)
    ) {
      onCancel?.();
      return false;
    }
    afterBack.current = action;
    if (!requestBack(onCancel)) {
      afterBack.current = undefined;
      onCancel?.();
      return false;
    }
    return true;
  }
  return { active, enter, back, complete, completeOwned };
}
