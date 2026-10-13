import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFloorWorkspaceView } from "./useFloorWorkspaceView";
beforeEach(() =>
  window.history.replaceState(
    null,
    "",
    "/planner?floor=2&view=storage&editing=1#map",
  ),
);
afterEach(() => vi.restoreAllMocks());
describe("workspace presentation query", () => {
  it("restores list URLs and updates only its own parameter", () => {
    window.history.replaceState(
      { guard: 7 },
      "",
      "/planner?floor=2&view=building&panel=list#map",
    );
    const { result } = renderHook(useFloorWorkspaceView);
    expect(result.current.view).toBe("list");
    act(() => result.current.setView("split"));
    expect(window.location.search).toBe("?floor=2&view=building&panel=split");
    expect(window.history.state.guard).toBe(7);
    expect(window.location.hash).toBe("#map");
    act(() => {
      window.history.replaceState(null, "", "/planner?panel=map");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current.view).toBe("map");
  });
  it("temporarily falls back from split on narrow screens and restores it when widened", () => {
    let narrow = true;
    const listeners = new Set<() => void>();
    const original = window.matchMedia;
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      ...original(query),
      matches: narrow,
      addEventListener: (
        _event: string,
        listener: EventListenerOrEventListenerObject | null,
      ) => {
        if (typeof listener === "function")
          listeners.add(() =>
            listener(new Event("change") as MediaQueryListEvent),
          );
      },
      removeEventListener: () => {},
    }));
    window.history.replaceState(null, "", "/planner?panel=split&floor=2");
    const { result } = renderHook(useFloorWorkspaceView);
    expect(result.current.view).toBe("map");
    expect(result.current.canSplit).toBe(false);
    expect(window.location.search).toBe("?panel=split&floor=2");
    act(() => {
      narrow = false;
      listeners.forEach((listener) => listener());
    });
    expect(result.current.view).toBe("split");
    expect(result.current.canSplit).toBe(true);
  });
  it("handles unknown panels without changing building navigation or edit state", () => {
    window.history.replaceState(
      null,
      "",
      "/planner?panel=invalid&floor=2&view=storage&editing=1",
    );
    const { result } = renderHook(useFloorWorkspaceView);
    expect(result.current.view).toBe("map");
    act(() => result.current.setView("list"));
    expect(window.location.search).toContain("view=storage&editing=1");
  });
  describe("viewport breakpoints without a measured container", () => {
    let viewport: number;
    beforeEach(() => {
      vi.spyOn(window, "matchMedia").mockImplementation((query) => {
        const max = /\(max-width: (\d+)px\)/.exec(query)?.[1];
        return {
          media: query,
          matches: max !== undefined && viewport <= Number(max),
          addEventListener: () => {},
          removeEventListener: () => {},
        } as unknown as MediaQueryList;
      });
    });

    it.each([
      { width: 849, canSplit: false, compact: true },
      { width: 850, canSplit: false, compact: true },
      { width: 851, canSplit: false, compact: false },
      { width: 1099, canSplit: false, compact: false },
      { width: 1100, canSplit: true, compact: false },
    ])("at $width px", ({ width, canSplit, compact }) => {
      viewport = width;
      const { result } = renderHook(useFloorWorkspaceView);
      expect(result.current.canSplit).toBe(canSplit);
      expect(result.current.compactInspector).toBe(compact);
    });

    it.each([
      [1399, true],
      [1400, false],
    ])("keeps a split inspector compact at %ipx: %s", (width, compact) => {
      window.history.replaceState(null, "", "/planner?panel=split");
      viewport = width;
      const { result } = renderHook(useFloorWorkspaceView);
      expect(result.current.view).toBe("split");
      expect(result.current.compactInspector).toBe(compact);
    });
  });
});
