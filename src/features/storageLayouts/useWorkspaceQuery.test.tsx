import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { registerNavigationGuardOwner } from "@/lib/navigationGuard";
import { useWorkspaceQuery, workspaceStateEvent } from "./useWorkspaceQuery";

beforeEach(() =>
  history.replaceState(null, "", "/planner?floor=1&other=keep#map"),
);
it("shares query commits across feature writers and filters temporary restoration", () => {
  let traversing = false;
  const release = registerNavigationGuardOwner({
    requestTransition: (action) => action(),
    isTraversing: () => traversing,
  });
  try {
    const hook = renderHook(useWorkspaceQuery);
    expect(hook.result.current).toBe("?floor=1&other=keep");
    traversing = true;
    act(() => {
      history.replaceState(null, "", "/planner?floor=2");
      window.dispatchEvent(new PopStateEvent("popstate"));
      window.dispatchEvent(new Event(workspaceStateEvent));
    });
    hook.rerender();
    expect(hook.result.current).toBe("?floor=1&other=keep");
    act(() => {
      traversing = false;
      window.dispatchEvent(new Event("app-query-state"));
    });
    expect(hook.result.current).toBe("?floor=2");
    act(() => {
      history.replaceState(null, "", "/planner?floor=3");
      window.dispatchEvent(new Event(workspaceStateEvent));
    });
    expect(hook.result.current).toBe("?floor=3");
  } finally {
    release();
  }
});
