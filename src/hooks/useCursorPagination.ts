"use client";

import { useEffect, useState } from "react";

export type PageSize = 20 | 50 | 100;
type Position = {
  criteria: string;
  size: PageSize;
  cursors: (string | null)[];
  index: number;
  offset: number;
};
const positions = new Map<string, Position>();
const MAX_SCOPES = 24;
const MAX_HISTORY = 500;
const initial = (criteria: string, size: PageSize = 20): Position => ({
  criteria,
  size,
  cursors: [null],
  index: 0,
  offset: 0,
});
function validPosition(value: unknown): value is Position {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<Position>;
  return (
    typeof state.criteria === "string" &&
    [20, 50, 100].includes(state.size ?? 0) &&
    Array.isArray(state.cursors) &&
    state.cursors.length > 0 &&
    state.cursors.length <= MAX_HISTORY &&
    state.cursors.every(
      (cursor) => cursor === null || typeof cursor === "string",
    ) &&
    Number.isSafeInteger(state.index) &&
    (state.index ?? -1) >= 0 &&
    (state.index ?? -1) < state.cursors.length &&
    Number.isSafeInteger(state.offset) &&
    (state.offset ?? -1) >= 0
  );
}
function remembered(scope: string, criteria: string) {
  const history =
    typeof window !== "undefined"
      ? window.history.state?.cataloguePagination
      : undefined;
  const saved =
    history?.scope === scope
      ? (history.value as Position)
      : positions.get(scope);
  return validPosition(saved) && saved.criteria === criteria
    ? saved
    : initial(criteria);
}

/** Bounded cursor history only: records always come from the authorized live query. */
export function useCursorPagination({
  scope,
  criteria,
}: {
  scope: string;
  criteria: unknown;
}) {
  const fingerprint = JSON.stringify(criteria);
  const [stored, setStored] = useState(() => ({
    scope,
    value: remembered(scope, fingerprint),
  }));
  let value = stored.value;
  if (stored.scope !== scope || value.criteria !== fingerprint) {
    const history =
      typeof window !== "undefined"
        ? window.history.state?.cataloguePagination
        : undefined;
    value =
      history?.scope === scope &&
      validPosition(history.value) &&
      history.value.criteria === fingerprint
        ? (history.value as Position)
        : initial(fingerprint, stored.scope === scope ? value.size : 20);
    setStored({ scope, value });
  }
  useEffect(() => {
    const restore = () =>
      setStored({ scope, value: remembered(scope, fingerprint) });
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [scope, fingerprint]);
  function save(next: Position) {
    positions.delete(scope);
    positions.set(scope, next);
    while (positions.size > MAX_SCOPES)
      positions.delete(positions.keys().next().value!);
    const history = {
      ...window.history.state,
      cataloguePagination: { scope, value: next },
    };
    // This updates navigation metadata only. Retain Next's current tree and
    // omit the URL so its patched history API does not schedule a route restore.
    window.history.replaceState(history, "");
    setStored({ scope, value: next });
  }
  return {
    page: value.offset + value.index + 1,
    pageSize: value.size,
    cursor: value.cursors[value.index] ?? null,
    canPrevious: value.index > 0,
    historyTruncated: value.offset > 0 && value.index === 0,
    previous: () => {
      if (value.index > 0) save({ ...value, index: value.index - 1 });
    },
    next: (cursor: string) => {
      if (!cursor) return;
      const cursors = [...value.cursors.slice(0, value.index + 1), cursor];
      const trim = Math.max(0, cursors.length - MAX_HISTORY);
      save({
        ...value,
        cursors: cursors.slice(trim),
        index: cursors.length - trim - 1,
        offset: value.offset + trim,
      });
    },
    reset: () => save(initial(fingerprint, value.size)),
    setPageSize: (size: PageSize) => save(initial(fingerprint, size)),
  };
}

export function clearCursorPositions() {
  positions.clear();
  if (
    typeof window !== "undefined" &&
    window.history.state?.cataloguePagination
  ) {
    const state = { ...window.history.state };
    delete state.cataloguePagination;
    window.history.replaceState(state, "");
  }
}
