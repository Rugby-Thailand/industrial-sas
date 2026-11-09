import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { FloorMapDrawing } from "./FloorMapDrawing";
import { floorMapDemo } from "@tests/fixtures/storage-floor-demo-data";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

// Floor bottom edge in viewBox pixels, plus the frame height.
function floorBottom(zoom: number, focus: { x: number; y: number }) {
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
      Footer
    </FloorMapDrawing>,
    { locale: "en", workspace: false },
  );
  const svg = view.container.querySelector("svg")!;
  const [, , , frameHeight] = svg
    .getAttribute("viewBox")!
    .split(" ")
    .map(Number);
  const [, ty, z] = svg
    .querySelector(":scope > g")!
    .getAttribute("transform")!
    .match(/-?[\d.]+/g)!
    .map(Number);
  const ys = svg
    .querySelector(":scope > g > polygon")!
    .getAttribute("points")!
    .split(" ")
    .map((p) => Number(p.split(",")[1]));
  const bottom = ty! + z! * Math.max(...ys);
  view.unmount();
  return { bottom, frameHeight: frameHeight! };
}

describe("floor map camera bounds after zooming out", () => {
  const focus = { x: 0, y: 50000 }; // panned toward the bottom edge at zoom 8

  it("focus is a legal pan result at zoom 8 (floor covers the frame)", () => {
    const { bottom, frameHeight } = floorBottom(8, focus);
    expect(bottom).toBeGreaterThanOrEqual(frameHeight - 0.001);
  });

  it("after Zoom out to 1.25 the floor should still cover the frame bottom", () => {
    const { bottom, frameHeight } = floorBottom(1.25, focus);
    // gap = blank pixels shown below the floor
    expect(Math.max(0, frameHeight - bottom)).toBe(0);
  });
});
