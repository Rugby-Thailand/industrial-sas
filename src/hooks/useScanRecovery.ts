"use client";

import { useState } from "react";

/** Automatic continuations of one logical page before asking the user. */
export const MAX_AUTOMATIC_SCAN_STEPS = 50;

type ScanValue = {
  readonly status: string;
  readonly scanCursor?: string | undefined;
};
type Outcome = { readonly ok: boolean; readonly value?: unknown };
type State = {
  key: string;
  cursor?: string | undefined;
  steps: number;
  /** The response that issued `cursor`; it is not an answer to it. */
  from?: unknown;
};

/**
 * Scan continuation with recovery for bounded-scan lists.
 *
 * - `attempt` changes the serialized query arguments on Retry, so Convex
 *   opens a fresh subscription instead of reusing the failed one (it keys
 *   subscriptions by function and arguments).
 * - A `scanning` answer without a new cursor is `stalled`: it is never
 *   followed automatically, so a malformed or non-advancing response cannot
 *   spin forever.
 * - After `MAX_AUTOMATIC_SCAN_STEPS` continuations the page is `paused` until
 *   the user chooses to keep searching.
 *
 * Pass `track(outcome).outcome` and `.continuation` to `useCatalogueSync`.
 */
export function useScanRecovery(key: string) {
  const [retries, setRetries] = useState({ key, attempt: 0 });
  const attempt = retries.key === key ? retries.attempt : 0;
  if (retries.key !== key) setRetries({ key, attempt: 0 });
  const scanKey = JSON.stringify([key, attempt]);
  const [stored, setState] = useState<State>({ key: scanKey, steps: 0 });
  const state: State =
    stored.key === scanKey ? stored : { key: scanKey, steps: 0 };
  if (stored !== state) setState(state);

  function track<O extends Outcome | undefined>(outcome: O) {
    const value =
      outcome?.ok && outcome.value && typeof outcome.value === "object"
        ? (outcome.value as ScanValue)
        : null;
    const scanning = value?.status === "scanning";
    const stalled =
      scanning &&
      value !== state.from &&
      (!value.scanCursor || value.scanCursor === state.cursor);
    const paused =
      scanning && !stalled && state.steps >= MAX_AUTOMATIC_SCAN_STEPS;
    return {
      stalled,
      paused,
      /** Withheld from automatic continuation while stalled or paused. */
      outcome: stalled || paused ? undefined : outcome,
      continuation: {
        cursor: state.cursor,
        advance: (next?: string) =>
          setState((previous) => {
            const base =
              previous.key === scanKey ? previous : { key: scanKey, steps: 0 };
            if (base.cursor === next) return base;
            return next
              ? {
                  key: scanKey,
                  cursor: next,
                  steps: base.steps + 1,
                  from: value,
                }
              : { key: scanKey, steps: 0 };
          }),
      },
    };
  }

  return {
    /** Send as `scanCursor`. */
    cursor: state.cursor,
    /** Send as `attempt` when non-zero; the server ignores its value. */
    attempt,
    /** Part of any client cache key for this page's responses. */
    key: scanKey,
    track,
    /** Start this page again with a fresh subscription. */
    retry: () => setRetries({ key, attempt: attempt + 1 }),
    /** Continue a paused search for another budget of steps. */
    resume: () => setState({ ...state, steps: 0 }),
  };
}
