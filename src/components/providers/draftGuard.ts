"use client";

import {
  createContext,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
} from "react";

/** One HR form's unsent details and in-flight write, as the guard sees it. */
export interface DraftEntry {
  /** Entered details that were not sent; `discard` resets them. */
  readonly dirty: boolean;
  /** A write is in flight: nothing may be discarded or left until it settles. */
  readonly pending: boolean;
  readonly discard: () => void;
}

export type RegisterDraft = (id: string, entry: DraftEntry | null) => void;

export const DraftGuardContext = createContext<RegisterDraft | null>(null);

/**
 * Report an HR form to the shell's draft guard: whether it holds unsent
 * details (`dirty`, reset by `discard`) and whether one of its writes is in
 * flight (`pending`). A pending write blocks search, AI and link navigation
 * even when the form itself is clean (a certification without a comment),
 * because leaving cannot cancel it and its outcome would be lost. Without a
 * guard provider (tests, other shells) it is a no-op.
 */
export function useDraftGuard(
  dirty: boolean,
  discard: () => void,
  pending = false,
): void {
  const register = useContext(DraftGuardContext);
  const id = useId();
  const latestDiscard = useRef(discard);
  useLayoutEffect(() => {
    latestDiscard.current = discard;
  });
  const stableDiscard = useCallback(() => latestDiscard.current(), []);
  useLayoutEffect(() => {
    if (register === null) return;
    register(
      id,
      dirty || pending ? { dirty, pending, discard: stableDiscard } : null,
    );
    return () => register(id, null);
  }, [dirty, id, pending, register, stableDiscard]);
}

/** A write that must settle before the page is left, with nothing to discard. */
export function usePendingGuard(pending: boolean): void {
  useDraftGuard(false, noop, pending);
}

const noop = () => undefined;
