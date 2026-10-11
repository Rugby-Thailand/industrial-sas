import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { useCatalogueState } from "./useCatalogueState";

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(
    { appNavigationIndex: 0 },
    "",
    "/en/finished-goods?other=keep#records",
  );
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
