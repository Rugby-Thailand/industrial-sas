import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import type { AppLocale } from "@/i18n/routing";
import { fg1ApprovedPlan } from "../../../convex/model/storageLayout/fg1ApprovedPlan";
import { FloorMapDrawing } from "./FloorMapDrawing";
import { PLAN_CELL_LABEL } from "./planCellLabelLayout";
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

function entry(target: Element, width: number, height: number) {
  const size = [{ inlineSize: width, blockSize: height }];
  return {
    target,
    contentRect: new DOMRect(0, 0, width, height),
    borderBoxSize: size,
    contentBoxSize: size,
    devicePixelContentBoxSize: size,
  } satisfies ResizeObserverEntry;
}

/** The approved portrait FG1 plan with one occupied cell. */
function fg1Scene(zoom: number, locale: AppLocale, viewport: [number, number]) {
  const plan = fg1ApprovedPlan(),
    demo = floorMapDemo(false, false);
  const zones = plan.cells.map((cell) => ({
    ...demo.zones[0]!,
    ...cell,
    zoneId: cell.code,
    label: cell.code,
    positions: [],
    placements: [],
    ...(cell.code === "FG1-L01"
      ? { palletCount: 4, unmeasuredPalletCount: 4 }
      : { palletCount: 0, unmeasuredPalletCount: 0 }),
  }));
  const view = renderWithIntl(
    <FloorMapDrawing
      {...demo}
      widthMm={plan.widthMm}
      depthMm={plan.depthMm}
      zones={zones}
      blocks={plan.blocks}
      view="plan"
      rotation={0}
      zoom={zoom}
      focus={undefined}
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
    { locale, workspace: false },
  );
  const svg = view.container.querySelector("svg")!;
  const footer = view.container.querySelector("[data-floor-map-footer]")!;
  act(() =>
    resize([entry(svg, ...viewport), entry(footer, viewport[0], 44)], observer),
  );
  const frameWidth = Number(svg.getAttribute("viewBox")!.split(" ")[2]);
  // CSS pixels per local (pre-zoom) SVG unit.
  const pixels = (zoom * viewport[0]) / frameWidth;
  return { svg, pixels };
}

describe("simple plan cell labels", () => {
  it.each<[AppLocale, number]>([
    ["en", 1],
    ["en", 2],
    ["en", 5],
    ["th", 1],
    ["th", 2],
    ["th", 5],
  ])(
    "keep FG1 labels readable and inside each cell (%s, %s×)",
    (locale, zoom) => {
      const { svg, pixels } = fg1Scene(zoom, locale, [1100, 560]);
      const labels = [...svg.querySelectorAll("[data-floor-zone-name]")];
      expect(labels.length).toBeGreaterThan(0);
      for (const label of labels) {
        const face = label.previousElementSibling!;
        expect(face).toHaveAttribute("data-zone-face", "plan");
        const top = Number(face.getAttribute("y"));
        const bottom = top + Number(face.getAttribute("height"));
        const lines = [
          [label, PLAN_CELL_LABEL.codeLine],
          ...[...label.querySelectorAll("[data-floor-zone-status]")].map(
            (line) => [line, PLAN_CELL_LABEL.statusLine] as const,
          ),
        ] as const;
        for (const [line, height] of lines) {
          const size = Number(line.getAttribute("font-size"));
          const y = Number(line.getAttribute("y"));
          // On-screen size is independent of the parent zoom.
          expect(size * pixels).toBeLessThanOrEqual(PLAN_CELL_LABEL.codeMax);
          expect(size * pixels).toBeGreaterThanOrEqual(PLAN_CELL_LABEL.codeMin);
          expect(y - (size * height) / 2).toBeGreaterThanOrEqual(top);
          expect(y + (size * height) / 2).toBeLessThanOrEqual(bottom);
        }
      }
      const status = [...svg.querySelectorAll("[data-floor-zone-status]")];
      if (zoom >= 2) {
        // The FG1 R-row has room for its second line from 200 %.
        expect(status.length).toBeGreaterThanOrEqual(10);
        expect(
          svg.querySelector(
            '[data-floor-zone-name="FG1-L01"] [data-floor-zone-status]',
          ),
        ).toHaveTextContent(locale === "th" ? "4 หน่วย" : "4 units");
        expect(
          svg.querySelector(
            '[data-floor-zone-name="FG1-R04"] [data-floor-zone-status]',
          ),
        ).toHaveTextContent(locale === "th" ? "ว่าง" : "Empty");
      }
    },
  );

  it("keeps the code size stable from 200 % to 500 %", () => {
    const sizes = [2, 5].map((zoom) => {
      const { svg, pixels } = fg1Scene(zoom, "th", [1100, 560]);
      const label = svg.querySelector('[data-floor-zone-name="FG1-R05"]')!;
      const size = Number(label.getAttribute("font-size")) * pixels;
      return size;
    });
    expect(sizes[0]).toBeCloseTo(sizes[1]!, 6);
  });

  it("hides the status line in a narrow portrait viewport when two lines cannot fit", () => {
    const { svg } = fg1Scene(1, "th", [294, 476]);
    expect(
      svg.querySelector(
        '[data-floor-zone-name="FG1-R04"] [data-floor-zone-status]',
      ),
    ).toBeNull();
  });
});
