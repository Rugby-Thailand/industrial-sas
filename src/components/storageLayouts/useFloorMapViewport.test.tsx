import { act, render } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useFloorMapViewport } from "./useFloorMapViewport";

function entry(
  target: Element,
  width: number,
  height: number,
): ResizeObserverEntry {
  const size = [{ inlineSize: width, blockSize: height }];
  return {
    target,
    contentRect: new DOMRect(0, 0, width, height),
    borderBoxSize: size,
    contentBoxSize: size,
    devicePixelContentBoxSize: size,
  };
}

afterEach(() => vi.unstubAllGlobals());

it("ignores identical resize notifications but measures same-aspect resizes and footer wrapping", () => {
  let resize: ResizeObserverCallback | undefined;
  let observer: ResizeObserver;
  const disconnect = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
        observer = this;
      }
      observe() {}
      unobserve() {}
      disconnect = disconnect;
    },
  );
  const committed = vi.fn();
  function Scene() {
    const { svg, footer, size, footerHeight } = useFloorMapViewport();
    return (
      <>
        <svg ref={svg} />
        <div ref={footer}>
          {size?.width} × {size?.height} / {footerHeight}
        </div>
      </>
    );
  }
  const view = render(
    <Profiler id="viewport" onRender={committed}>
      <Scene />
    </Profiler>,
  );
  const notify = (width: number, height: number, footerHeight: number) =>
    act(() =>
      resize?.(
        [
          entry(view.container.querySelector("svg")!, width, height),
          entry(view.container.querySelector("div")!, width, footerHeight),
        ],
        observer,
      ),
    );
  notify(1000, 500, 44);
  committed.mockClear();
  // A state bailout can render once before React reuses the previous state.
  notify(1000, 500, 44);
  committed.mockClear();
  for (let index = 0; index < 10; index++) notify(1000, 500, 44);
  expect(committed).not.toHaveBeenCalled();
  notify(500, 250, 68);
  expect(view.container).toHaveTextContent("500 × 250 / 68");
  expect(committed).toHaveBeenCalledTimes(1);
  notify(0, 0, 68);
  expect(view.container).toHaveTextContent("500 × 250 / 68");
  view.unmount();
  expect(disconnect).toHaveBeenCalledOnce();
});
