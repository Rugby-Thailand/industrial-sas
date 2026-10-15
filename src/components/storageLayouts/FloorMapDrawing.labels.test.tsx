import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import type { StorageZoneRow } from "@/lib/convex/storageLayoutApi";
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
function fg1Scene(
  zoom: number,
  locale: AppLocale,
  viewport: [number, number],
  configure?: (zones: StorageZoneRow[]) => void,
  focusCode?: string,
) {
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
  configure?.(zones);
  const focusZone = zones.find((zone) => zone.code === focusCode);
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
      focus={
        focusZone
          ? {
              x: focusZone.xMm + focusZone.widthMm / 2 - plan.widthMm / 2,
              y: focusZone.yMm + focusZone.depthMm / 2 - plan.depthMm / 2,
            }
          : undefined
      }
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
        const size = Number(label.getAttribute("font-size"));
        const y = Number(label.getAttribute("y"));
        expect(size * pixels).toBeCloseTo(14, 6);
        expect(
          y - (size * PLAN_CELL_LABEL.codeLine) / 2,
        ).toBeGreaterThanOrEqual(top);
        expect(y + (size * PLAN_CELL_LABEL.codeLine) / 2).toBeLessThanOrEqual(
          bottom,
        );
        expect(label.querySelector("tspan")).toBeNull();
      }
      expect(svg.querySelector("[data-floor-zone-status]")).toBeNull();
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

  it("hides codes that cannot fit at a readable size on mobile", () => {
    const { svg } = fg1Scene(1, "th", [294, 476]);
    expect(svg.querySelector('[data-floor-zone-name="FG1-R04"]')).toBeNull();
    expect(svg.querySelector('[data-map-zone-id="FG1-R04"]')).not.toBeNull();
  });

  it("keeps full codes when their short suffix would be ambiguous", () => {
    const { svg } = fg1Scene(
      5,
      "en",
      [1100, 560],
      (zones) => {
        zones[5] = { ...zones[5]!, code: "COLD-A01" };
        zones[6] = { ...zones[6]!, code: "DRY-A01" };
      },
      "COLD-A01",
    );
    expect(
      svg.querySelector('[data-floor-zone-name="COLD-A01"]'),
    ).toHaveTextContent("COLD-A01");
    expect(
      svg.querySelector('[data-floor-zone-name="DRY-A01"]'),
    ).toHaveTextContent("DRY-A01");
  });

  it("keeps all address segments in a long code and hides it until it fits", () => {
    for (const zoom of [1, 5]) {
      const { svg } = fg1Scene(
        zoom,
        "en",
        [1100, 560],
        (zones) => {
          zones[7] = { ...zones[7]!, code: "FG1-R03-COLD-001" };
        },
        "FG1-R03-COLD-001",
      );
      const label = svg.querySelector(
        '[data-floor-zone-name="FG1-R03-COLD-001"]',
      );
      if (zoom === 1) expect(label).toBeNull();
      else expect(label).toHaveTextContent("R03-COLD-001");
    }
  });

  it("encodes stored, reserved, mixed and incomplete inventory without a second label line", () => {
    const demo = floorMapDemo(false, false);
    const stored = demo.zones[0]!.placements[0]!;
    const reserved = {
      ...stored,
      handlingUnitId: "held",
      placementId: "held",
      status: "RESERVED" as const,
    };
    const { svg } = fg1Scene(2, "en", [1100, 560], (zones) => {
      Object.assign(zones[1]!, { placements: [stored], palletCount: 1 });
      Object.assign(zones[5]!, { placements: [reserved], palletCount: 1 });
      Object.assign(zones[6]!, {
        placements: [stored, reserved],
        palletCount: 2,
      });
    });
    const face = (code: string) =>
      svg.querySelector(`[data-floor-zone-code="${code}"]`)!;
    expect(face("FG1-L01")).toHaveAttribute("data-floor-zone-state", "unknown");
    expect(face("FG1-L01").getAttribute("fill")).toMatch(/^url\(#/);
    expect(face("FG1-L02")).toHaveAttribute("data-floor-zone-state", "stored");
    expect(face("FG1-R01")).toHaveAttribute("stroke-dasharray", "4 3");
    expect(face("FG1-R01")).toHaveAttribute(
      "data-floor-zone-state",
      "reserved",
    );
    expect(face("FG1-R02")).toHaveAttribute("data-floor-zone-state", "mixed");
    expect(face("FG1-R02")).toHaveAttribute("fill", "var(--plan-occupied)");
    expect(face("FG1-R03")).toHaveAttribute("data-floor-zone-state", "empty");
    expect(svg.querySelector("[data-floor-zone-status]")).toBeNull();
  });
});
