import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { trackAppHistory } from "@/lib/browser/appHistory";
import { updateBrowserQuery } from "@/lib/browser/history";
import {
  clearCursorPositions,
  useCursorPagination,
} from "./useCursorPagination";

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
  clearCursorPositions();
});

// A new filter choice (pushed as a new history entry, as useQueryHistoryWriter
// does for non-typing changes) that returns to criteria the user had paged
// through earlier must start at page 1. Back may restore an old page; a new
// forward navigation should not.
it("a newly pushed filter returning to earlier criteria starts at page 1", () => {
  window.history.replaceState(
    { appNavigationIndex: 0 },
    "",
    "/en/finished-goods?tag=all",
  );
  stop = trackAppHistory();
  const hook = renderHook(
    ({ criteria }) => useCursorPagination({ scope: "fg-catalogue", criteria }),
    { initialProps: { criteria: { tag: "all" } } },
  );
  act(() => hook.result.current.next("c1"));
  act(() => hook.result.current.next("c2"));
  expect(hook.result.current.page).toBe(3);

  // User picks tag A: a new entry is pushed (state copied by updateBrowserQuery).
  act(() => updateBrowserQuery((q) => q.set("tag", "A"), { mode: "push" }));
  hook.rerender({ criteria: { tag: "A" } });
  expect(hook.result.current.page).toBe(1);

  // User picks "all" again: another new entry, a fresh filter choice.
  act(() => updateBrowserQuery((q) => q.set("tag", "all"), { mode: "push" }));
  hook.rerender({ criteria: { tag: "all" } });
  expect(window.history.state.appNavigationIndex).toBe(2);
  expect(hook.result.current.page).toBe(1);
  expect(hook.result.current.cursor).toBeNull();
});
