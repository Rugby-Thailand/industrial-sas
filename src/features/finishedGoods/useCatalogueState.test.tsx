import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useCatalogueState } from "./useCatalogueState";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";

const guard = vi.hoisted(() => ({ traversing: false }));
vi.mock("@/lib/navigationGuard", () => ({
  isGuardTraversal: () => guard.traversing,
}));

beforeEach(() => {
  guard.traversing = false;
  localStorage.clear();
  window.history.replaceState(
    { appNavigationIndex: 0 },
    "",
    "/en/finished-goods?other=keep#records",
  );
});
it("reloads preference fallback when the catalogue scope changes", () => {
  localStorage.setItem("scope:a", JSON.stringify({ search: "alpha" }));
  localStorage.setItem(
    "scope:b",
    JSON.stringify({ tab: "pallets", search: "beta" }),
  );
  const hook = renderHook(({ scope }) => useCatalogueState(scope), {
    initialProps: { scope: "scope:a" },
  });
  expect(hook.result.current.state.search).toBe("alpha");
  act(() => hook.result.current.update({ layout: "cards" }));
  hook.rerender({ scope: "scope:b" });
  expect(hook.result.current.state).toMatchObject({
    tab: "pallets",
    layout: "table",
    search: "beta",
  });
  act(() => hook.result.current.update({ search: "bravo" }));
  hook.rerender({ scope: "scope:a" });
  expect(hook.result.current.state).toMatchObject({
    layout: "cards",
    search: "alpha",
  });
});
it("keeps the committed catalogue through a guard traversal and publishes the final commit", () => {
  const hook = renderHook(() => useCatalogueState("warehouse"));
  act(() => hook.result.current.update({ tab: "pallets" }));
  guard.traversing = true;
  act(() => {
    history.replaceState(
      { fgCatalogueScope: "warehouse" },
      "",
      "/en/finished-goods",
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  hook.rerender();
  expect(hook.result.current.state.tab).toBe("pallets");
  act(() => {
    guard.traversing = false;
    window.dispatchEvent(new Event("app-query-state"));
  });
  expect(hook.result.current.state.tab).toBe("products");
});
it("retains the existing legacy single-status preference migration", () => {
  localStorage.setItem(
    "old-view",
    JSON.stringify({ tab: "pallets", status: "STORED" }),
  );
  const hook = renderHook(() => useCatalogueState("old-view"));
  expect(hook.result.current.state.pallets.statuses).toEqual(["STORED"]);
  act(() => hook.result.current.update({ search: "lot" }));
  expect(JSON.parse(localStorage.getItem("old-view") ?? "{}")).toMatchObject({
    pallets: { statuses: ["STORED"] },
    search: "lot",
  });
});
it("hydrates with feature defaults before applying saved browser preferences", async () => {
  localStorage.setItem(
    "hydration-view",
    JSON.stringify({ layout: "cards", search: "saved search" }),
  );
  function Catalogue() {
    const { state } = useCatalogueState("hydration-view");
    return (
      <div>
        {state.layout}:{state.search}
      </div>
    );
  }
  const container = document.createElement("div");
  container.innerHTML = renderToString(<Catalogue />);
  document.body.append(container);
  expect(container.textContent).toBe("table:");
  const recover = vi.fn();
  let root: Root | undefined;
  try {
    await act(async () => {
      root = hydrateRoot(container, <Catalogue />, {
        onRecoverableError: recover,
      });
    });
    expect(recover).not.toHaveBeenCalled();
    expect(container.textContent).toBe("cards:saved search");
  } finally {
    act(() => root?.unmount());
    container.remove();
  }
});
async function traverse(direction: "back" | "forward") {
  await act(async () => {
    const moved = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    window.history[direction]();
    await moved;
  });
}
it("restores actual tab and layout history and groups search typing into one Back step", async () => {
  const hook = renderHook(() => useCatalogueState("user:warehouse"));
  act(() => hook.result.current.update({ tab: "pallets" }));
  expect(window.history.state.appNavigationIndex).toBe(1);
  act(() => hook.result.current.update({ layout: "cards" }));
  expect(window.history.state.appNavigationIndex).toBe(2);
  act(() => hook.result.current.update({ search: "L" }));
  act(() => hook.result.current.update({ search: "LO" }));
  act(() => hook.result.current.update({ search: "LOT" }));
  expect(window.history.state.appNavigationIndex).toBe(3);
  expect(new URLSearchParams(window.location.search).get("other")).toBe("keep");
  expect(window.location.hash).toBe("#records");
  await traverse("back");
  expect(hook.result.current.state).toMatchObject({
    tab: "pallets",
    layout: "cards",
    search: "",
  });
  await traverse("back");
  expect(hook.result.current.state).toMatchObject({
    tab: "pallets",
    layout: "table",
    search: "",
  });
  await traverse("back");
  expect(hook.result.current.state).toMatchObject({
    tab: "products",
    layout: "table",
    search: "",
  });
  await traverse("forward");
  expect(hook.result.current.state.tab).toBe("pallets");
});
