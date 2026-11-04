// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  APP_HISTORY_KEY,
  GUARD_HISTORY_KEY,
  subscribeHistoryChanges,
  trackAppHistory,
} from "./appHistory";
import {
  subscribeBrowserQuery,
  updateBrowserQuery,
  updateHistoryMetadata,
} from "./history";
it("query writes retain unrelated URL and history state while allowing router synchronization", () => {
  history.replaceState(
    { __NA: true, _N: true, guard: "kept", cataloguePagination: { page: 3 } },
    "",
    "/?floor=2&editUnit=abc#selection",
  );
  const listener = vi.fn();
  const unsubscribe = subscribeBrowserQuery("query-test", listener);
  updateBrowserQuery((q) => q.delete("editUnit"), {
    metadata: { scope: "warehouse" },
    event: "query-test",
    mode: "push",
  });
  expect(location.search).toBe("?floor=2");
  expect(location.hash).toBe("#selection");
  expect(history.state).toEqual({
    guard: "kept",
    cataloguePagination: { page: 3 },
    scope: "warehouse",
  });
  expect(listener).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new PopStateEvent("popstate"));
  expect(listener).toHaveBeenCalledTimes(2);
  unsubscribe();
  window.dispatchEvent(new PopStateEvent("popstate"));
  expect(listener).toHaveBeenCalledTimes(2);
});
it("metadata changes preserve Next markers and do not touch URL", () => {
  history.replaceState({ __NA: true, tree: "router" }, "", "/?floor=1#zone");
  const replace = vi.spyOn(history, "replaceState");
  updateHistoryMetadata((state) => {
    state.page = 2;
  });
  expect(replace).toHaveBeenLastCalledWith(
    { __NA: true, tree: "router", page: 2 },
    "",
  );
  expect(location.search).toBe("?floor=1");
  replace.mockRestore();
});
it("does not insert a Back step when a pushed query is unchanged", () => {
  history.replaceState(
    { __NA: true, appNavigationIndex: 4, guard: "kept" },
    "",
    "/?floor=1#zone",
  );
  const push = vi.spyOn(history, "pushState");
  updateBrowserQuery((query) => query.set("floor", "1"), {
    mode: "push",
    metadata: { scope: "same" },
  });
  expect(push).not.toHaveBeenCalled();
  expect(history.state).toMatchObject({
    __NA: true,
    appNavigationIndex: 4,
    guard: "kept",
    scope: "same",
  });
  expect(location.hash).toBe("#zone");
  push.mockRestore();
});
it("does not rewrite equivalent query encoding or invoke a router URL restoration", () => {
  history.replaceState(
    { __NA: true, appNavigationIndex: 3 },
    "",
    "/?search=a%20b&floor=1#zone",
  );
  const replace = vi.spyOn(history, "replaceState");
  updateBrowserQuery((query) => query.set("floor", "1"), {
    mode: "push",
    metadata: { scope: "same" },
  });
  expect(location.search).toBe("?search=a%20b&floor=1");
  expect(replace).toHaveBeenLastCalledWith(
    { __NA: true, appNavigationIndex: 3, scope: "same" },
    "",
  );
  replace.mockRestore();
});

describe("tracked pushes and the guard marker", () => {
  const marker = "0d7f4f0e-5b0a-4d43-9a7e-4f3f2c1b9a01";
  const popped = () =>
    new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
  function trackFromMarkedEntry() {
    history.replaceState(
      {
        __NA: true,
        __PRIVATE_NEXTJS_INTERNALS_TREE: { route: "floor" },
        [APP_HISTORY_KEY]: 3,
        [GUARD_HISTORY_KEY]: marker,
        catalogueSession: "floor-session",
      },
      "",
      "/floor?panel=map",
    );
    return trackAppHistory();
  }

  it("drops a copied marker from a pushed query while keeping depth and metadata", async () => {
    const stop = trackFromMarkedEntry();
    try {
      updateBrowserQuery((query) => query.set("panel", "list"), {
        mode: "push",
        metadata: { scope: "floor" },
      });
      expect(location.search).toBe("?panel=list");
      expect(history.state).toEqual({
        __PRIVATE_NEXTJS_INTERNALS_TREE: { route: "floor" },
        [APP_HISTORY_KEY]: 4,
        catalogueSession: "floor-session",
        scope: "floor",
      });
      // The older entry keeps its own marker for an actual Back.
      const back = popped();
      history.back();
      await back;
      expect(location.search).toBe("?panel=map");
      expect(history.state).toMatchObject({
        [APP_HISTORY_KEY]: 3,
        [GUARD_HISTORY_KEY]: marker,
        catalogueSession: "floor-session",
      });
    } finally {
      stop();
    }
  });

  it("drops a copied marker from a direct push of the current state", () => {
    const stop = trackFromMarkedEntry();
    try {
      history.pushState({ ...history.state }, "", "/floor?panel=list");
      expect(history.state).not.toHaveProperty(GUARD_HISTORY_KEY);
      expect(history.state).toMatchObject({
        __NA: true,
        [APP_HISTORY_KEY]: 4,
        catalogueSession: "floor-session",
      });
    } finally {
      stop();
    }
  });

  it("keeps a genuine new buffer marker at the current depth", () => {
    const stop = trackFromMarkedEntry();
    try {
      const fresh = "a3c1e2f4-7b6d-4e8f-9a0b-1c2d3e4f5a6b";
      history.pushState(
        { ...history.state, [GUARD_HISTORY_KEY]: fresh },
        "",
        location.href,
      );
      expect(history.state).toMatchObject({
        __NA: true,
        [APP_HISTORY_KEY]: 3,
        [GUARD_HISTORY_KEY]: fresh,
        catalogueSession: "floor-session",
      });
    } finally {
      stop();
    }
  });

  it("keeps the marker through a same-URL router replacement", () => {
    const stop = trackFromMarkedEntry();
    try {
      history.replaceState(
        { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { route: "next" } },
        "",
        location.href,
      );
      expect(history.state).toMatchObject({
        __PRIVATE_NEXTJS_INTERNALS_TREE: { route: "next" },
        [APP_HISTORY_KEY]: 3,
        [GUARD_HISTORY_KEY]: marker,
        catalogueSession: "floor-session",
      });
    } finally {
      stop();
    }
  });
});

// Next writes history from a useInsertionEffect, where React forbids the
// store reader's update: readers hear of a write once the writing task ends.
it("reports tracked writes to location readers after the write, not inside it", async () => {
  history.replaceState({ [APP_HISTORY_KEY]: 0 }, "", "/en/finished-goods");
  const stop = trackAppHistory();
  const reader = vi.fn();
  const unsubscribe = subscribeHistoryChanges(reader);
  try {
    history.pushState({}, "", "/en/finished-goods/scan");
    expect(reader).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(reader).toHaveBeenCalledOnce();
    // A traversal is already outside React's commit and is reported at once.
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(reader).toHaveBeenCalledTimes(2);
    // A reader that unsubscribes before the report is not called.
    history.pushState({}, "", "/en/finished-goods/scan/records");
    unsubscribe();
    await Promise.resolve();
    expect(reader).toHaveBeenCalledTimes(2);
  } finally {
    unsubscribe();
    stop();
  }
});
