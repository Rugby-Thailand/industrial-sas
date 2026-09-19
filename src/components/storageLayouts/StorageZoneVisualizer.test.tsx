import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { StorageStackPlacementRow } from "@/lib/convex/storageLayoutApi";
import { StorageZoneVisualizer } from "./StorageZoneVisualizer";

const row: StorageStackPlacementRow = {
  placementId: "one",
  handlingUnitId: "pallet-one",
  lpn: "P-001",
  positionCode: "POS-001",
  levelIndex: 1,
  widthMm: 1_000,
  depthMm: 1_000,
  heightMm: 1_400,
  orientation: "DEFAULT",
  placedAt: 1,
  xMm: 0,
  yMm: 0,
  zMm: 0,
  status: "STORED",
};
const zones = [
  {
    id: "FG-1",
    xMm: 500,
    yMm: 700,
    widthMm: 2_000,
    depthMm: 2_000,
    placements: [
      row,
      {
        ...row,
        placementId: "two",
        lpn: "P-002",
        xMm: 1_000,
        status: "RESERVED" as const,
      },
    ],
  },
];
const selection = {
  id: "draft",
  xMm: 4_000,
  yMm: 4_000,
  widthMm: 1_000,
  depthMm: 1_000,
  heightMm: 1_000,
};

describe("planner occupancy rendering", () => {
  it.each(["plan", "3d"] as const)(
    "shows last-confirmed source and held destination during a move in %s",
    (mode) => {
      const { container } = render(
        <StorageZoneVisualizer
          mode={mode}
          ariaLabel="Floor"
          floorWidthMm={10_000}
          floorDepthMm={10_000}
          floorHeightMm={3_000}
          selection={selection}
          reservedBlocks={[]}
          zones={[
            {
              ...zones[0]!,
              placements: [
                { ...row, moveRole: "SOURCE", moveState: "IN_TRANSIT" },
                {
                  ...row,
                  placementId: "two",
                  xMm: 500,
                  status: "RESERVED",
                  moveRole: "TARGET",
                  moveState: "IN_TRANSIT",
                },
              ],
            },
          ]}
          moveInTransitLabel="ตำแหน่งยืนยันล่าสุด · กำลังย้าย"
          moveTargetLabel="จองปลายทางการย้าย"
        />,
      );
      const source = container.querySelector('[data-placement-id="one"]')!;
      const target = container.querySelector('[data-placement-id="two"]')!;
      expect(source.querySelector("title")).toHaveTextContent(
        "ตำแหน่งยืนยันล่าสุด · กำลังย้าย",
      );
      expect(target.querySelector("title")).toHaveTextContent(
        "จองปลายทางการย้าย",
      );
      expect(source?.querySelector("[data-scene-kind]")).toHaveAttribute(
        "stroke-dasharray",
        "5 4",
      );
      expect(source?.querySelector("[data-scene-kind]")).toHaveAttribute(
        "stroke",
        "#b6c2d1",
      );
      expect(target?.querySelector("[data-scene-kind]")).toHaveAttribute(
        "stroke-dasharray",
        "5 4",
      );
      expect(target?.querySelector("[data-scene-kind]")).toHaveAttribute(
        "stroke",
        "#e5af52",
      );
    },
  );
  it.each(["plan", "3d"] as const)(
    "shows exact side-by-side footprints in %s with distinct hold status",
    (mode) => {
      const { container } = render(
        <StorageZoneVisualizer
          mode={mode}
          ariaLabel="Floor"
          floorWidthMm={10_000}
          floorDepthMm={10_000}
          floorHeightMm={3_000}
          selection={selection}
          zones={zones}
          reservedBlocks={[]}
        />,
      );
      const one = container.querySelector('[data-placement-id="one"]');
      const two = container.querySelector('[data-placement-id="two"]');
      expect(one).toHaveAttribute("data-placement-x-mm", "500");
      expect(two).toHaveAttribute("data-placement-x-mm", "1500");
      expect(one).toHaveAttribute("data-placement-z-mm", "0");
      expect(two).toHaveAttribute("data-placement-z-mm", "0");
      expect(one).toHaveAttribute("data-placement-status", "STORED");
      expect(two).toHaveAttribute("data-placement-status", "RESERVED");
      expect(one?.querySelector("polygon")?.getAttribute("points")).not.toEqual(
        two?.querySelector("polygon")?.getAttribute("points"),
      );
    },
  );

  it("fits every elevated pallet face inside the responsive SVG viewBox", () => {
    const { container } = render(
      <div style={{ width: 320 }}>
        <StorageZoneVisualizer
          mode="3d"
          ariaLabel="Mobile floor"
          floorWidthMm={100_000}
          floorDepthMm={2_000}
          floorHeightMm={10_000}
          selection={{ ...selection, xMm: 0, yMm: 0 }}
          zones={[
            {
              ...zones[0]!,
              xMm: 0,
              yMm: 0,
              placements: [{ ...row, zMm: 5_000, heightMm: 5_000 }],
            },
          ]}
          reservedBlocks={[]}
        />
      </div>,
    );
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveClass("w-full");
    const [left, top, width, height] = svg
      .getAttribute("viewBox")!
      .split(" ")
      .map(Number) as [number, number, number, number];
    for (const polygon of container.querySelectorAll(
      "[data-placement-id] polygon",
    )) {
      for (const point of polygon.getAttribute("points")!.split(" ")) {
        const [x, y] = point.split(",").map(Number) as [number, number];
        expect(x).toBeGreaterThanOrEqual(left);
        expect(x).toBeLessThanOrEqual(left + width);
        expect(y).toBeGreaterThanOrEqual(top);
        expect(y).toBeLessThanOrEqual(top + height);
      }
    }
  });
});
