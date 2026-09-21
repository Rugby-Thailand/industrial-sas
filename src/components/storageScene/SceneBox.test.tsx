import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { sceneColors } from "./sceneColors";
import { SceneBox, sceneStyle } from "./SceneBox";
import { storagePlacementCorners } from "@/lib/storageLayouts/storagePlacementGeometry";
import { projectIsometricPoint } from "@/lib/storageLayouts/isometricGeometry";
const box = {
  xMm: 100,
  yMm: 200,
  zMm: 300,
  widthMm: 1000,
  depthMm: 2000,
  heightMm: 1500,
};
const points = storagePlacementCorners(box).map(projectIsometricPoint);
describe("shared storage box", () => {
  it("renders twelve unique world-space edges and transparent selectable faces", () => {
    const click = vi.fn();
    const { container } = render(
      <svg>
        <g onClick={click}>
          <SceneBox points={points} mode="3d" kind="location" selected />
        </g>
      </svg>,
    );
    const edges = [...container.querySelectorAll("[data-scene-edge]")];
    expect(edges).toHaveLength(12);
    expect(
      new Set(edges.map((e) => e.getAttribute("data-scene-edge"))).size,
    ).toBe(12);
    const vertical = container.querySelector('[data-scene-edge="0-4"]')!;
    expect(
      Number(vertical.getAttribute("y1")) - Number(vertical.getAttribute("y2")),
    ).toBe(1500);
    for (const face of container.querySelectorAll("polygon"))
      expect(face).toHaveAttribute("fill", "transparent");
    fireEvent.click(container.querySelector("polygon")!);
    expect(click).toHaveBeenCalledOnce();
  });
  it("uses four footprint edges in 2D and fills only selected packages", () => {
    const { container, rerender } = render(
      <svg>
        <SceneBox points={points} mode="plan" kind="package" />
      </svg>,
    );
    expect(container.querySelectorAll("[data-scene-edge]")).toHaveLength(4);
    expect(container.querySelector("polygon")).toHaveAttribute(
      "fill",
      "transparent",
    );
    rerender(
      <svg>
        <SceneBox points={points} mode="plan" kind="package" selected />
      </svg>,
    );
    expect(container.querySelector("polygon")).not.toHaveAttribute(
      "fill",
      "transparent",
    );
    expect(container.querySelector('[data-scene-solid="true"]')).not.toBeNull();
  });
  it("retains held status while selected, and prioritizes invalid feedback", () => {
    expect(sceneStyle({ kind: "package", held: true }).dash).toBeDefined();
    expect(sceneStyle({ kind: "location", selected: true }).solid).toBe(false);
    expect(
      sceneStyle({ kind: "package", selected: true, held: true }).dash,
    ).toBeDefined();
    expect(
      sceneStyle({ kind: "location", selected: true, invalid: true }).stroke,
    ).toBe(sceneColors.invalid);
  });
});
