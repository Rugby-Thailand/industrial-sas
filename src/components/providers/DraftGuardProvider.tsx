"use client";

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useWorkspaceNavigationGuard } from "@/features/storageLayouts/useWorkspaceNavigationGuard";

import {
  DraftGuardContext,
  type DraftEntry,
  type RegisterDraft,
} from "./draftGuard";

/**
 * One guard for every HR form in the shell. Forms report unsent details and
 * in-flight writes; while any form is dirty or pending, clicked links,
 * Back/Forward and programmatic navigation (search, AI, record switches)
 * ask first. A pending write disables discarding and leaving until it
 * settles (the guard's `pending` contract). There is no "save" here:
 * sending an HR request or decision stays on its own form.
 */
export function DraftGuardProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [drafts, setDrafts] = useState<ReadonlyMap<string, DraftEntry>>(
    () => new Map(),
  );
  const latest = useRef(drafts);
  useLayoutEffect(() => {
    latest.current = drafts;
  }, [drafts]);
  const register = useCallback<RegisterDraft>((id, entry) => {
    setDrafts((current) => {
      const before = current.get(id);
      if (
        entry === null
          ? before === undefined
          : before !== undefined &&
            before.dirty === entry.dirty &&
            before.pending === entry.pending &&
            before.discard === entry.discard
      )
        return current;
      const next = new Map(current);
      if (entry === null) next.delete(id);
      else next.set(id, entry);
      return next;
    });
  }, []);
  const entries = [...drafts.values()];
  const guard = useWorkspaceNavigationGuard({
    dirty: entries.some((entry) => entry.dirty),
    pending: entries.some((entry) => entry.pending),
    discard: () => {
      for (const entry of latest.current.values())
        if (entry.dirty && !entry.pending) entry.discard();
    },
  });
  return (
    <DraftGuardContext.Provider value={register}>
      {children}
      {guard.navigationPrompt}
    </DraftGuardContext.Provider>
  );
}
