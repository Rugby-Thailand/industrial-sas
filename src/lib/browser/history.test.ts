// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
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
