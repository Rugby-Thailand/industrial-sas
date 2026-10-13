import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { updateBrowserQuery } from "@/lib/browser/history";
import { registerNavigationGuardOwner } from "@/lib/navigationGuard";
import { useWorkspaceQuery, workspaceStateEvent } from "./useWorkspaceQuery";

beforeEach(() =>
  history.replaceState(null, "", "/planner?floor=1&other=keep#map"),
);
it("shares query commits across feature writers and filters temporary restoration", async () => {
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
    await waitFor(() => expect(hook.result.current).toBe("?floor=2"));
    act(() => {
      history.replaceState(null, "", "/planner?floor=3");
      window.dispatchEvent(new Event(workspaceStateEvent));
    });
    expect(hook.result.current).toBe("?floor=3");
  } finally {
    release();
  }
});

it("does not publish a popped editor command before later history listeners correct it", async () => {
  const reader = renderHook(useWorkspaceQuery);
  act(() => {
    window.history.replaceState(
      {},
      "",
      "/th/planner?floor=1&other=keep&editZone=zone-a#map",
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  // Chromium can flush React between native window listeners. A late
  // workflow listener has not yet removed the already dismissed command.
  expect(reader.result.current).toBe("?floor=1&other=keep");
  act(() => updateBrowserQuery((query) => query.delete("editZone")));
  await waitFor(() =>
    expect(reader.result.current).toBe("?floor=1&other=keep"),
  );
  expect(window.location.hash).toBe("#map");
});

it("reads explicit workspace intent immediately and observes shared workflow corrections", async () => {
  const reader = renderHook(useWorkspaceQuery);
  act(() => {
    updateBrowserQuery((query) => query.set("editZone", "zone-a"), {
      event: workspaceStateEvent,
    });
  });
  expect(reader.result.current).toBe("?floor=1&other=keep&editZone=zone-a");
  act(() => updateBrowserQuery((query) => query.delete("editZone")));
  await waitFor(() =>
    expect(reader.result.current).toBe("?floor=1&other=keep"),
  );
});
