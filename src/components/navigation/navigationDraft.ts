"use client";

import {
  createContext,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";

import {
  announceNavigationIntent,
  type Transition,
} from "@/lib/navigationGuard";

/** One editor's unsaved work and in-flight write, as the shell guard sees it. */
export const DraftForegroundContext = createContext<string | undefined>(
  undefined,
);

export interface DraftRegistration {
  readonly workflowScope?: string | undefined;
  readonly foregroundScope?: string | undefined;
  /** Entered details that were not saved or sent; `discard` resets them. */
  readonly dirty: boolean;
  /** A write is in flight: nothing may be discarded or left until it settles. */
  readonly pending: boolean;
  readonly discard: () => void;
  /** Offered only when this is the sole dirty entry. Resolves false on failure. */
  readonly save?: () => Promise<boolean>;
  /** Shown instead of allowing Save (e.g. an unfinished nested editor). */
  readonly saveBlockedReason?: string;
}

export interface NavigationDraftControl {
  /** Run `action` now when nothing is guarded; otherwise ask first. */
  readonly requestTransition: (action: Transition) => void;
  /**
   * This entry's work is complete (saved or cleared). It stops guarding at
   * once, and stays inert until it next reports clean. `then` runs after the
   * shell's history buffer is removed, or through the normal prompt when
   * other entries still hold unsaved or pending work.
   */
  readonly settle: (then?: Transition) => void;
}

export interface NavigationDraftOwner {
  readonly update: (id: string, entry: DraftRegistration | null) => void;
  readonly settle: (id: string, then?: Transition) => void;
  readonly requestTransition: (action: Transition) => void;
}

export const NavigationDraftContext =
  createContext<NavigationDraftOwner | null>(null);

let missingOwnerWarned = false;

/**
 * Register one editor with the shell guard. Without a provider (auth and
 * public shells, isolated tests) transitions run directly and a dirty
 * registration warns once in development: there is no local fallback owner.
 */
export function useNavigationDraft(
  entry: DraftRegistration,
): NavigationDraftControl {
  const owner = useContext(NavigationDraftContext);
  const inheritedForeground = useContext(DraftForegroundContext);
  const foregroundScope = entry.foregroundScope ?? inheritedForeground;
  const id = useId();
  const latest = useRef(entry);
  useLayoutEffect(() => {
    latest.current = entry;
  });
  const discard = useCallback(() => latest.current.discard(), []);
  const save = useCallback(
    () => latest.current.save?.() ?? Promise.resolve(false),
    [],
  );
  const { dirty, pending, saveBlockedReason } = entry;
  const saveable = entry.save !== undefined;
  useLayoutEffect(() => {
    if (owner === null) {
      if (
        dirty &&
        !missingOwnerWarned &&
        process.env.NODE_ENV !== "production"
      ) {
        missingOwnerWarned = true;
        console.error(
          "useNavigationDraft: no NavigationGuardProvider is mounted; unsaved work is not guarded.",
        );
      }
      return;
    }
    owner.update(id, {
      dirty,
      pending,
      workflowScope: entry.workflowScope,
      foregroundScope,
      discard,
      ...(saveable ? { save } : {}),
      ...(saveBlockedReason ? { saveBlockedReason } : {}),
    });
  }, [
    owner,
    id,
    dirty,
    pending,
    discard,
    save,
    saveable,
    saveBlockedReason,
    entry.workflowScope,
    foregroundScope,
  ]);
  useLayoutEffect(() => {
    if (owner === null) return;
    return () => owner.update(id, null);
  }, [owner, id]);
  return useMemo(
    () => ({
      requestTransition: (action: Transition) => {
        if (owner === null) {
          announceNavigationIntent();
          action();
        } else owner.requestTransition(action);
      },
      settle: (then?: Transition) => {
        if (owner === null) then?.();
        else owner.settle(id, then);
      },
    }),
    [owner, id],
  );
}
