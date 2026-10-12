import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { useQueryHistoryWriter } from "./useQueryHistoryWriter";

beforeEach(() =>
  history.replaceState({ appNavigationIndex: 0 }, "", "/catalogue#records"),
);
it("ends a typing group after a real hash-only Back traversal", async () => {
  const hook = renderHook(useQueryHistoryWriter);
  const write = (search: string) =>
    hook.result.current((query) => query.set("search", search), {
      metadata: {},
      event: "typing-test",
      typing: true,
    });
  act(() => write("A"));
  history.pushState(
    { ...history.state, appNavigationIndex: 2 },
    "",
    "?search=A#other",
  );
  await act(async () => {
    const moved = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    history.back();
    await moved;
  });
  act(() => write("AB"));
  expect(history.state.appNavigationIndex).toBe(2);
  expect(location.hash).toBe("#records");
});
it("starts a separate typing group after the writer scope changes", () => {
  const hook = renderHook(({ scope }) => useQueryHistoryWriter(scope), {
    initialProps: { scope: "a" },
  });
  act(() =>
    hook.result.current((query) => query.set("search", "A"), {
      metadata: {},
      event: "typing-test",
      typing: true,
    }),
  );
  hook.rerender({ scope: "b" });
  act(() =>
    hook.result.current((query) => query.set("search", "B"), {
      metadata: {},
      event: "typing-test",
      typing: true,
    }),
  );
  expect(history.state.appNavigationIndex).toBe(2);
});
