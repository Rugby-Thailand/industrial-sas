import { fireEvent, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
  useQuery: () => undefined,
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...props }: ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
  useRouter: () => ({ push: vi.fn() }),
}));

import { renderWithIntl } from "@tests/fixtures/intl-render";

import type {
  StorageBuildingRow,
  StorageFloorRow,
} from "@/lib/convex/storageLayoutApi";

import {
  BuildingModelWorkspace,
  BuildingSettingsSheet,
  FloorPlan,
  IsometricBuilding,
} from "./StorageLayoutScreens";

const building: StorageBuildingRow = {
  buildingId: "building-a",
  warehouseId: "warehouse-a",
  code: "BLDG-A",
  name: "Main storage",
  widthMm: 30_000,
  depthMm: 20_000,
  defaultFloorHeightMm: 4_000,
  floorCount: 4,
  totalHeightMm: 16_000,
  grossAreaSqMm: 2_232_000_000,
  reservedAreaSqMm: 24_000_000,
  usableAreaSqMm: 2_208_000_000,
  status: "DRAFT",
  version: 2,
};

const floors: readonly StorageFloorRow[] = [1, 2, 3, 4].map((floorNumber) => ({
  floorId: `floor-${floorNumber}`,
  floorNumber,
  ...(floorNumber === 2 ? { widthMm: 24_000, depthMm: 18_000 } : {}),
  ...(floorNumber === 3 ? { heightMm: 5_000 } : {}),
  grossAreaSqMm: floorNumber === 2 ? 432_000_000 : 600_000_000,
  reservedAreaSqMm: floorNumber === 2 ? 24_000_000 : 0,
  usableAreaSqMm: floorNumber === 2 ? 408_000_000 : 600_000_000,
  version: floorNumber === 2 ? 2 : 1,
  reservedBlocks: [],
}));

describe("BuildingModelWorkspace", () => {
  it("consolidates floor dimensions and edit links into the model rail", () => {
    renderWithIntl(
      <BuildingModelWorkspace building={building} floors={floors} />,
      { locale: "en", workspace: false },
    );

    expect(screen.getAllByRole("button", { name: /Floor \d/ })).toHaveLength(4);
    expect(screen.getByText("24 × 18 × 4 m")).toBeInTheDocument();
    expect(screen.getByText("30 × 20 × 5 m")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Edit floor/ })).toHaveLength(4);

    fireEvent.click(screen.getByRole("button", { name: /Floor 2/ }));
    expect(screen.getByRole("button", { name: /Floor 2/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

describe("BuildingSettingsSheet", () => {
  it("opens the removed building form from a compact plus action", () => {
    renderWithIntl(
      <BuildingSettingsSheet warehouseId="warehouse-a" building={building} />,
      { locale: "en", workspace: false },
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Edit building settings" }),
    );

    expect(
      screen.getByRole("dialog", { name: "Building dimensions" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Building name" })).toHaveValue(
      "Main storage",
    );
    expect(screen.getByRole("button", { name: "Add floors" })).toBeVisible();
  });
});

describe("IsometricBuilding", () => {
  it("paints lower floors before upper floors so the building remains stacked", () => {
    renderWithIntl(
      <IsometricBuilding
        building={building}
        floors={floors}
        highlightedFloorNumber={1}
      />,
      { locale: "en", workspace: false },
    );

    const model = screen.getByRole("img", {
      name: "Isometric building model",
    });
    const paintOrder = Array.from(model.querySelectorAll(":scope > g > g")).map(
      (floor) => floor.querySelector("text")?.textContent,
    );

    expect(paintOrder).toEqual(["1", "2", "3", "4"]);
  });

  it("connects adjacent equal floor envelopes instead of exploding the stack", () => {
    renderWithIntl(
      <IsometricBuilding
        building={building}
        floors={floors}
        highlightedFloorNumber={4}
      />,
      { locale: "en", workspace: false },
    );

    const model = screen.getByRole("img", {
      name: "Isometric building model",
    });
    const floorGroups = model.querySelectorAll(":scope > g > g");
    const floorThreeTop = floorGroups[2]!.querySelectorAll("polygon")[2]!;
    const floorFourLeft = floorGroups[3]!.querySelectorAll("polygon")[0]!;
    const floorFourRight = floorGroups[3]!.querySelectorAll("polygon")[1]!;
    const points = (polygon: SVGPolygonElement) =>
      polygon.getAttribute("points")!.split(" ");

    expect(points(floorFourLeft).slice(2)).toEqual(
      points(floorThreeTop).slice(2),
    );
    expect(points(floorFourRight).slice(2)).toEqual([
      points(floorThreeTop)[2],
      points(floorThreeTop)[1],
    ]);
  });
});

describe("FloorPlan", () => {
  it("opens in 3D with all dimensions and retains a precision plan view", () => {
    renderWithIntl(
      <FloorPlan
        widthMm={20_000}
        depthMm={18_000}
        heightMm={5_000}
        maximumWidthMm={30_000}
        maximumDepthMm={20_000}
        blocks={[
          {
            id: "reserved-a",
            label: "Lift core",
            xMm: 2_000,
            yMm: 3_000,
            widthMm: 4_000,
            depthMm: 5_000,
          },
        ]}
      />,
      { locale: "en", workspace: false },
    );

    expect(
      screen.getByRole("img", { name: "3D floor volume" }),
    ).toBeInTheDocument();
    expect(screen.getByText("20 × 18 × 5 m")).toBeInTheDocument();
    expect(screen.getByText("H 5 m")).toBeInTheDocument();
    expect(screen.getByText("Lift core")).toBeInTheDocument();
    const volume = screen.getByRole("img", { name: "3D floor volume" });
    const topFace = volume.querySelectorAll("polygon")[6]!;
    expect(topFace.getAttribute("points")).toBe("48,-24 288,96 72,204 -168,84");

    fireEvent.click(screen.getByRole("button", { name: "Plan" }));

    expect(
      screen.getByRole("img", { name: "Floor space plan" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: "3D floor volume" }),
    ).not.toBeInTheDocument();
  });
});
