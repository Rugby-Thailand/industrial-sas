"use client";

import {
  useCallback,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";

export interface OperationTicket {
  /** A completed ticket remains current until its committed scope or lifetime ends. */
  readonly isCurrent: () => boolean;
  readonly finish: () => void;
}

/** Private execution mechanics; outcome, retry and persistence belong to callers. */
export function useOperationLifecycle(scope: string | undefined) {
  // Distinct committed visits to the same scope must not adopt old callbacks.
  const owner = useMemo(() => ({ scope }), [scope]);
  const lifecycle = useRef({
    owner,
    generation: 0,
    mounted: false,
    locks: new Map<string | number, symbol>(),
  });

  // Commit refs before descendant layout effects can start a new operation.
  // No state updates happen here, and an abandoned render changes nothing.
  useInsertionEffect(() => {
    const current = lifecycle.current;
    current.owner = owner;
    current.generation += 1;
    current.mounted = true;
    return () => {
      current.mounted = false;
      current.generation += 1;
    };
  }, [owner]);

  // React replays layout lifetimes in StrictMode without replaying insertion
  // effects. Invalidate the old tickets even when the scope text stays equal.
  useLayoutEffect(
    () => () => {
      lifecycle.current.generation += 1;
    },
    [],
  );

  const capture = useCallback(() => {
    const current = lifecycle.current;
    const generation = current.generation;
    return () =>
      current.mounted &&
      current.owner === owner &&
      current.generation === generation;
  }, [owner]);

  const acquire = useCallback(
    (lockKey?: string): OperationTicket | null => {
      const current = lifecycle.current;
      if (!current.mounted || current.owner !== owner) return null;
      // Local workflows may start afresh after changing scope. Domain intent
      // keys (HR) retain their lock until the original request has settled.
      const key = lockKey ?? current.generation;
      if (current.locks.has(key)) return null;
      const token = Symbol("operation");
      current.locks.set(key, token);
      return {
        isCurrent: capture(),
        finish: () => {
          if (current.locks.get(key) === token) current.locks.delete(key);
        },
      };
    },
    [capture, owner],
  );
  return { acquire, capture };
}
