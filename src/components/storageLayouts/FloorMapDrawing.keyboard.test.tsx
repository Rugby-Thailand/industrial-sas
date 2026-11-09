import { fireEvent } from "@testing-library/react";
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

function render3d(rotation: number) {
  const onSelect = vi.fn();
  const view = renderWithIntl(
    <FloorMapDrawing
      {...floorMapDemo(false, false)}
      view="3d"
      rotation={rotation}
      zoom={1}
      focus={undefined}
      onFocusChange={vi.fn()}
      selectedAreaIndex={undefined}
      onSelectArea={vi.fn()}
      reference={false}
      showLocationLabels={false}
      showPackages={false}
      selectedId="DEMO-Z01"
      selectedUnit={undefined}
      matchIds={[]}
      searching={false}
      onSelect={onSelect}
    >
      Footer
    </FloorMapDrawing>,
    { locale: "en", workspace: false },
  );
  // Mean on-screen x of a zone's drawn box.
  const screenX = (id: string) => {
    const xs = [
      ...view.container.querySelectorAll(`[data-zone-id="${id}"] polygon`),
    ].flatMap((p) =>
      p
        .getAttribute("points")!
        .trim()
        .split(/\s+/)
        .map((pt) => Number(pt.split(",")[0])),
    );
    return xs.reduce((a, b) => a + b, 0) / xs.length;
  };
  const from = view.container.querySelector('[data-map-zone-id="DEMO-Z01"]')!;
  fireEvent.keyDown(from, { key: "ArrowRight" });
  const next = onSelect.mock.calls[0]?.[0] as string | undefined;
  const dx = next ? screenX(next) - screenX("DEMO-Z01") : 0;
  view.unmount();
  return { next, dx };
}

describe("floor map keyboard navigation follows the visible rotation", () => {
  it("rotation 0: ArrowRight moves to a zone drawn further right", () => {
    const { next, dx } = render3d(0);
    expect(next).toBe("DEMO-Z02");
    expect(dx).toBeGreaterThan(0);
  });

  it.each([1, 2])(
    "rotation %i: ArrowRight must not jump to a zone drawn to the left",
    (rotation) => {
      const { dx } = render3d(rotation);
      // dx < 0 means focus moved visually LEFT on ArrowRight
      expect(dx).toBeGreaterThanOrEqual(0);
    },
  );
});
