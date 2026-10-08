import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { FloorMapDrawing } from "./FloorMapDrawing";

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
import { floorMapDemo } from "./storageFloorDemoData";

let resize: ResizeObserverCallback;
let observer: ResizeObserver;
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
        observer = this;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

function scene(zoom: number, focus?: { x: number; y: number }) {
  const view = renderWithIntl(
    <FloorMapDrawing
      {...floorMapDemo(false, false)}
      widthMm={60000}
      depthMm={120000}
      zones={[]}
      blocks={[]}
      view="plan"
      rotation={0}
      zoom={zoom}
      focus={focus}
      onFocusChange={vi.fn()}
      selectedAreaIndex={undefined}
      onSelectArea={vi.fn()}
      reference={false}
      showLocationLabels={false}
      showPackages={false}
      selectedId={undefined}
      selectedUnit={undefined}
      matchIds={[]}
      searching={false}
      onSelect={vi.fn()}
    >
      Footer metadata
    </FloorMapDrawing>,
    { locale: "en", workspace: false },
  );
  const svg = view.container.querySelector("svg")!;
  const footer = view.container.querySelector("[data-floor-map-footer]")!;
  return {
    svg,
    resize(width: number, height: number, footerHeight: number) {
      act(() =>
        resize(
          [entry(svg, width, height), entry(footer, width, footerHeight)],
          observer,
        ),
      );
    },
    floor() {
      return svg
        .querySelector(":scope > g > polygon")!
        .getAttribute("points")!
        .split(" ")
        .map((point) => point.split(",").map(Number));
    },
  };
}

describe("floor viewport fitting", () => {
  it("reserves the measured wrapping footer below a portrait floor", () => {
    const view = scene(1);
    for (const footerHeight of [44, 68, 100]) {
      view.resize(294, 476, footerHeight);
      const [, , width, height] = view.svg
        .getAttribute("viewBox")!
        .split(" ")
        .map(Number);
      const unit = width! / 294;
      const ys = view.floor().map((point) => point[1]!);
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(32 * unit - 0.001);
      expect(Math.max(...ys)).toBeLessThanOrEqual(
        height! - (footerHeight + 16) * unit + 0.001,
      );
    }
  });

  it("keeps a committed physical center across narrower and taller viewports at low zoom", () => {
    const view = scene(1.25, { x: 4800, y: 10000 });
    for (const [width, height, footerHeight] of [
      [1390, 397, 44],
      [750, 612, 44],
      [294, 476, 68],
      [1390, 397, 44],
    ]) {
      view.resize(width!, height!, footerHeight!);
      const [, , frameWidth, frameHeight] = view.svg
        .getAttribute("viewBox")!
        .split(" ")
        .map(Number);
      const [tx, ty, zoom] = view.svg
        .querySelector(":scope > g")!
        .getAttribute("transform")!
        .match(/-?[\d.]+/g)!
        .map(Number);
      const centerX = (frameWidth! / 2 - tx!) / zoom!;
      const centerY = (frameHeight! / 2 - ty!) / zoom!;
      const floor = view.floor();
      expect(
        (centerX - floor[0]![0]!) / (floor[1]![0]! - floor[0]![0]!),
      ).toBeCloseTo(0.58, 8);
      expect(
        (centerY - floor[0]![1]!) / (floor[3]![1]! - floor[0]![1]!),
      ).toBeCloseTo(0.5 + 10000 / 120000, 8);
    }
  });
});
