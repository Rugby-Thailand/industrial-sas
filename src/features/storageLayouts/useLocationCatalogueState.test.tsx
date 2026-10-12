import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useLocationCatalogueState } from "./useLocationCatalogueState";

const guard = vi.hoisted(() => ({ traversing: false }));
vi.mock("@/lib/navigationGuard", () => ({
  isGuardTraversal: () => guard.traversing,
}));
const defaults = {
  view: "cards",
  search: "",
  status: "ALL",
  building: "ALL",
  floor: "ALL",
};
beforeEach(() => {
  guard.traversing = false;
  localStorage.clear();
  history.replaceState(
    { appNavigationIndex: 0, cataloguePagination: { page: 3 } },
    "",
    "/en/storage-layouts?other=keep#map",
  );
});
async function traverse(direction: "back" | "forward") {
  await act(async () => {
    const moved = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    history[direction]();
    await moved;
  });
}
it("merges consecutive updates against the actual current URL snapshot", () => {
  const hook = renderHook(() => useLocationCatalogueState("locations:a"));
  act(() => {
    hook.result.current.update({ view: "table" });
    hook.result.current.update({ status: "ACTIVE" });
  });
  expect(hook.result.current.state).toMatchObject({
    view: "table",
    status: "ACTIVE",
  });
  expect(new URLSearchParams(location.search).get("other")).toBe("keep");
  expect(location.hash).toBe("#map");
  expect(history.state.cataloguePagination).toEqual({ page: 3 });
});
it("reloads scoped preferences without carrying another scope's fallback", () => {
  localStorage.setItem(
    "locations:a",
    JSON.stringify({ ...defaults, search: "alpha" }),
  );
  localStorage.setItem(
    "locations:b",
    JSON.stringify({ ...defaults, view: "table", search: "beta" }),
  );
  const hook = renderHook(({ scope }) => useLocationCatalogueState(scope), {
    initialProps: { scope: "locations:a" },
  });
  expect(hook.result.current.state.search).toBe("alpha");
  act(() => hook.result.current.update({ status: "ACTIVE" }));
  hook.rerender({ scope: "locations:b" });
  expect(hook.result.current.state).toMatchObject({
    view: "table",
    search: "beta",
    status: "ALL",
  });
  act(() => hook.result.current.update({ floor: "2" }));
  hook.rerender({ scope: "locations:a" });
  expect(hook.result.current.state).toMatchObject({
    search: "alpha",
    floor: "ALL",
    status: "ACTIVE",
  });
});
it("pins the starting preference and restores filters and grouped typing on Back", async () => {
  localStorage.setItem(
    "locations:a",
    JSON.stringify({ ...defaults, view: "table" }),
  );
  const hook = renderHook(() => useLocationCatalogueState("locations:a"));
  act(() => hook.result.current.update({ status: "ACTIVE" }));
  act(() => hook.result.current.update({ search: "A" }));
  act(() => hook.result.current.update({ search: "AB" }));
  expect(history.state.appNavigationIndex).toBe(2);
  await traverse("back");
  expect(hook.result.current.state).toMatchObject({
    view: "table",
    status: "ACTIVE",
    search: "",
  });
  await traverse("back");
  expect(hook.result.current.state).toMatchObject({
    view: "table",
    status: "ALL",
    search: "",
  });
  await traverse("forward");
  expect(hook.result.current.state.status).toBe("ACTIVE");
});
it("keeps the committed URL during guard restoration even through another render", () => {
  const hook = renderHook(() => useLocationCatalogueState("locations:a"));
  act(() => hook.result.current.update({ status: "ACTIVE" }));
  guard.traversing = true;
  act(() => {
    history.replaceState(
      { locationCatalogueScope: "locations:a" },
      "",
      "/en/storage-layouts",
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  hook.rerender();
  expect(hook.result.current.state.status).toBe("ACTIVE");
  act(() => {
    guard.traversing = false;
    window.dispatchEvent(new Event("app-query-state"));
  });
  expect(hook.result.current.state.status).toBe("ALL");
});
it("validates malformed query state and keeps the existing complete JSON encoding", () => {
  history.replaceState(
    null,
    "",
    "/en/storage-layouts?locations=%7B%22floor%22%3A%220%22%7D",
  );
  const hook = renderHook(() => useLocationCatalogueState("locations:a"));
  expect(hook.result.current.state).toEqual(defaults);
  act(() => hook.result.current.update({ floor: "2" }));
  expect(
    JSON.parse(new URLSearchParams(location.search).get("locations") ?? "{}"),
  ).toEqual({ ...defaults, floor: "2" });
});
