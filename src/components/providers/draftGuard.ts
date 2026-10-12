"use client";

import {
  useNavigationDraft,
  type NavigationDraftControl,
} from "@/components/navigation/navigationDraft";

/**
 * Report an HR form to the shell's navigation guard: whether it holds unsent
 * details (`dirty`, reset by `discard`) and whether one of its writes is in
 * flight (`pending`). A pending write blocks search, AI and link navigation
 * even when the form itself is clean (a certification without a comment),
 * because leaving cannot cancel it and its outcome would be lost. HR forms
 * offer no prompt Save: requests are sent from their own form.
 *
 * Returns the draft's control. Callers that navigate after a successful
 * write call `settle(() => router.push(...))`; existing callers may ignore it.
 */
export function useDraftGuard(
  dirty: boolean,
  discard: () => void,
  pending = false,
): NavigationDraftControl {
  return useNavigationDraft({ dirty, pending, discard });
}

/** A write that must settle before the page is left, with nothing to discard. */
export function usePendingGuard(pending: boolean): NavigationDraftControl {
  return useDraftGuard(false, noop, pending);
}

const noop = () => undefined;
