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
import { floorMapDemo } from "@tests/fixtures/storage-floor-demo-data";

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

function scene(
  zoom: number,
  focus?: { x: number; y: number },
  showLocationLabels = false,
) {
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
      showLocationLabels={showLocationLabels}
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
  it.each([false, true])(
    "reserves the measured wrapping footer below a portrait floor (labels=%s)",
    (labels) => {
      const view = scene(1, undefined, labels);
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
    },
  );

  it.each([undefined, { x: 4800, y: 10000 }])(
    "keeps the physical center within pan bounds across viewport changes (focus=%s)",
    (focus) => {
      const view = scene(1.25, focus);
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
        for (const [center, start, end, frameSize, offset, physicalSize] of [
          [
            centerX,
            floor[0]![0]!,
            floor[1]![0]!,
            frameWidth!,
            focus?.x ?? 0,
            60000,
          ],
          [
            centerY,
            floor[0]![1]!,
            floor[3]![1]!,
            frameHeight!,
            focus?.y ?? 0,
            120000,
          ],
        ] as const) {
          const span = (end - start) * zoom!;
          const visibleStart = frameSize / 2 + (start - center) * zoom!;
          const visibleEnd = visibleStart + span;
          const requestedStart =
            frameSize / 2 - (0.5 + offset / physicalSize) * span;
          const requestedEnd = requestedStart + span;
          const coversFrame = span >= frameSize;
          if (coversFrame) {
            expect(visibleStart).toBeLessThanOrEqual(1e-8);
            expect(visibleEnd).toBeGreaterThanOrEqual(frameSize - 1e-8);
          } else {
            expect(visibleStart).toBeGreaterThanOrEqual(-1e-8);
            expect(visibleEnd).toBeLessThanOrEqual(frameSize + 1e-8);
          }
          const requestedFits = coversFrame
            ? requestedStart <= 0 && requestedEnd >= frameSize
            : requestedStart >= 0 && requestedEnd <= frameSize;
          if (requestedFits) {
            expect((center - start) / (end - start)).toBeCloseTo(
              0.5 + offset / physicalSize,
              8,
            );
          } else {
            // Clamp only as far as needed for a floor edge to meet the frame.
            expect(
              Math.min(
                Math.abs(visibleStart),
                Math.abs(visibleEnd - frameSize),
              ),
            ).toBeLessThan(1e-8);
          }
        }
      }
    },
  );
});
