import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCursorPositions,
  useCursorPagination,
} from "./useCursorPagination";

beforeEach(clearCursorPositions);
describe("cursor navigation", () => {
  it("restores detail-return position but resets when criteria change", () => {
    const first = renderHook(() =>
      useCursorPagination({
        scope: "user:warehouse:products",
        criteria: { search: "" },
      }),
    );
    act(() => first.result.current.next("next-cursor"));
    first.unmount();
    const second = renderHook(
      ({ search }) =>
        useCursorPagination({
          scope: "user:warehouse:products",
          criteria: { search },
        }),
      { initialProps: { search: "" } },
    );
    expect(second.result.current.page).toBe(2);
    expect(second.result.current.cursor).toBe("next-cursor");
    second.rerender({ search: "late match" });
    expect(second.result.current.page).toBe(1);
    expect(second.result.current.cursor).toBeNull();
  });
  it("resets page size and isolates warehouse and actor positions", () => {
    const hook = renderHook(
      ({ scope }) => useCursorPagination({ scope, criteria: {} }),
      { initialProps: { scope: "user-a:warehouse-a" } },
    );
    act(() => hook.result.current.next("private-cursor"));
    act(() => hook.result.current.setPageSize(50));
    expect(hook.result.current.page).toBe(1);
    expect(hook.result.current.pageSize).toBe(50);
    act(() => hook.result.current.next("another-cursor"));
    hook.rerender({ scope: "user-b:warehouse-a" });
    expect(hook.result.current.cursor).toBeNull();
    expect(hook.result.current.pageSize).toBe(20);
  });
  it("uses recorded cursors for previous and replaces obsolete forward history", () => {
    const hook = renderHook(() =>
      useCursorPagination({ scope: "x", criteria: {} }),
    );
    act(() => hook.result.current.next("two"));
    act(() => hook.result.current.next("three"));
    act(() => hook.result.current.previous());
    expect(hook.result.current.cursor).toBe("two");
    act(() => hook.result.current.next("new-three"));
    expect(hook.result.current.cursor).toBe("new-three");
  });
});

it("keeps Next available beyond 10,000 records", () => {
  const hook = renderHook(() =>
    useCursorPagination({ scope: "large", criteria: {} }),
  );
  for (let page = 2; page <= 503; page++)
    act(() => hook.result.current.next(`cursor-${page}`));
  expect(hook.result.current.page).toBe(503);
  expect(hook.result.current.cursor).toBe("cursor-503");
  act(() => hook.result.current.reset());
  expect(hook.result.current.page).toBe(1);
});

it("restores the recorded cursor from browser history", () => {
  const hook = renderHook(
    ({ search }) =>
      useCursorPagination({ scope: "history", criteria: { search } }),
    { initialProps: { search: "first" } },
  );
  act(() => hook.result.current.next("page-two"));
  const saved = window.history.state;
  hook.rerender({ search: "other" });
  expect(hook.result.current.page).toBe(1);
  act(() => {
    window.history.replaceState(saved, "", window.location.href);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  hook.rerender({ search: "first" });
  expect(hook.result.current.cursor).toBe("page-two");
  expect(hook.result.current.page).toBe(2);
});

it("preserves Next router state without scheduling an unchanged URL restore", () => {
  const tree = { tree: ["finished-goods"] };
  window.history.replaceState(
    { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: tree },
    "",
    "/finished-goods",
  );
  const replace = vi.spyOn(window.history, "replaceState");
  const hook = renderHook(() =>
    useCursorPagination({ scope: "next-history", criteria: {} }),
  );
  act(() => hook.result.current.next("next-page"));
  expect(replace).toHaveBeenLastCalledWith(
    expect.objectContaining({
      __NA: true,
      __PRIVATE_NEXTJS_INTERNALS_TREE: tree,
    }),
    "",
  );
  expect(window.location.pathname).toBe("/finished-goods");
  replace.mockRestore();
});
