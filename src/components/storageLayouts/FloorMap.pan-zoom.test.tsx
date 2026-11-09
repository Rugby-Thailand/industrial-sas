import { fireEvent, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { floorMapDemo } from "@tests/fixtures/storage-floor-demo-data";
import { FloorMap } from "./FloorMap";

vi.mock("@/hooks/useCanManage", () => ({ useCanManage: () => false }));
vi.mock("@/i18n/navigation", () => ({ Link: "a" }));

it("real map drag commits a legal focus that Zoom out must keep inside the floor", () => {
  renderWithIntl(
    <FloorMap
      {...floorMapDemo(false, false)}
      widthMm={60000}
      depthMm={120000}
      zones={[]}
      blocks={[]}
    />,
    { locale: "en", workspace: false },
  );
  const svg = screen.getByRole("group", { name: "Interactive floor map" });
  vi.spyOn(svg, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 920, 660),
  );
  const zoomIn = screen.getByRole("button", { name: "Zoom in" });
  for (let i = 0; i < 13; i++) fireEvent.click(zoomIn);
  expect(zoomIn).toBeDisabled();
  const geometry = () => {
    const [, ty, zoom] = svg
      .querySelector(":scope > g")!
      .getAttribute("transform")!
      .match(/-?[\d.]+/g)!
      .map(Number);
    const ys = svg
      .querySelector(":scope > g > polygon")!
      .getAttribute("points")!
      .split(" ")
      .map((p) => Number(p.split(",")[1]));
    return {
      zoom: zoom!,
      top: ty! + zoom! * Math.min(...ys),
      bottom: ty! + zoom! * Math.max(...ys),
    };
  };
  // Repeated drags stay inside the visible frame and go through the real pan clamp.
  for (let i = 0; i < 5; i++) {
    fireEvent.pointerDown(svg, {
      pointerId: 1,
      button: 0,
      clientX: 400,
      clientY: 500,
    });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 400, clientY: 124 });
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 400, clientY: 124 });
  }
  expect(geometry().zoom).toBe(8);
  expect(geometry().top).toBeLessThanOrEqual(0);
  expect(geometry().bottom).toBeGreaterThanOrEqual(660);
  const zoomOut = screen.getByRole("button", { name: "Zoom out" });
  for (let i = 0; i < 12; i++) fireEvent.click(zoomOut);
  expect(geometry().zoom).toBe(1.25);
  expect(Math.max(0, 660 - geometry().bottom)).toBe(0);
});
