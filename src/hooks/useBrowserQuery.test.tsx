import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useBrowserQuery } from "./useBrowserQuery";
import { registerNavigationGuardOwner } from "@/lib/navigationGuard";

beforeEach(() =>
  history.replaceState({ scope: "a" }, "", "/planner?floor=1#map"),
);
async function back() {
  await act(async () => {
    const moved = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    history.back();
    await moved;
  });
}
it("restores scope markers on actual Back even when the pathname and query are unchanged", async () => {
  const hook = renderHook(useBrowserQuery);
  act(() => {
    history.pushState({ scope: "b" }, "", window.location.href);
    window.dispatchEvent(new Event("app-query-state"));
  });
  expect(hook.result.current.state?.scope).toBe("b");
  await back();
  expect(hook.result.current.search).toBe("?floor=1");
  expect(hook.result.current.state?.scope).toBe("a");
});
it("keeps committed query and scope during traversal then notices a metadata-only cleanup", () => {
  let traversing = false;
  const release = registerNavigationGuardOwner({
    requestTransition: (action) => action(),
    isTraversing: () => traversing,
  });
  try {
    const hook = renderHook(useBrowserQuery);
    traversing = true;
    act(() => {
      history.replaceState({ scope: "b" }, "", "/planner?floor=2#map");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    hook.rerender();
    expect(hook.result.current).toMatchObject({
      search: "?floor=1",
      state: { scope: "a" },
    });
    act(() => {
      history.replaceState({ scope: "c" }, "", "/planner?floor=1#map");
      traversing = false;
      window.dispatchEvent(new Event("app-query-state"));
    });
    expect(hook.result.current).toMatchObject({
      search: "?floor=1",
      state: { scope: "c" },
    });
  } finally {
    release();
  }
});
it("keeps a stable snapshot for equivalent cloned state without retaining router trees", () => {
  const spy = vi
    .spyOn(history, "state", "get")
    .mockImplementation(() => ({
      scope: "a",
      __NA: true,
      __PRIVATE_NEXTJS_INTERNALS_TREE: { fresh: [] },
      cataloguePagination: { cursors: [null] },
    }));
  try {
    const hook = renderHook(useBrowserQuery);
    const initial = hook.result.current;
    hook.rerender();
    expect(hook.result.current).toBe(initial);
    expect(hook.result.current.state).toEqual({ scope: "a", __NA: true });
  } finally {
    spy.mockRestore();
  }
});
