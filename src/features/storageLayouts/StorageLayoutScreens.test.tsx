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
  StorageZoneRow,
} from "@/lib/convex/storageLayoutApi";

import {
  BuildingModelWorkspace,
  BuildingSettingsDialog,
  FloorPlan,
  IsometricBuilding,
  ReservedBlocks,
  StorageCatalogueFilters,
  StorageZoneDraftPreview,
  StorageZonesPanel,
} from "./StorageLayoutScreens";

describe("StorageCatalogueFilters", () => {
  it("keeps search and status in distinct responsive columns", () => {
    renderWithIntl(
      <StorageCatalogueFilters
        search=""
        status="ALL"
        onSearchChange={vi.fn()}
        onStatusChange={vi.fn()}
      />,
      { locale: "en", workspace: false },
    );

    expect(
      screen.getByRole("textbox", { name: "Search buildings" }),
    ).toBeVisible();
    expect(
      screen.getByRole("combobox", { name: "Filter by status" }),
    ).toHaveTextContent("All statuses");
    expect(screen.getByTestId("storage-catalogue-filters")).toHaveClass(
      "sm:grid-cols-[minmax(0,1fr)_14rem]",
    );
  });
});

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
  storageZones: [],
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

describe("BuildingSettingsDialog", () => {
  it("opens the removed building form from a compact plus action", () => {
    renderWithIntl(
      <BuildingSettingsDialog warehouseId="warehouse-a" building={building} />,
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
  it("positions the floor on its previous floor and supports keyboard movement", () => {
    const onPlacementChange = vi.fn();
    renderWithIntl(
      <FloorPlan
        widthMm={20_000}
        depthMm={18_000}
        heightMm={5_000}
        baseWidthMm={30_000}
        baseDepthMm={20_000}
        baseLabel="Floor 1 footprint"
        floorNumber={2}
        offsetXMm={5_000}
        offsetYMm={1_000}
        onPlacementChange={onPlacementChange}
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
    expect(
      screen.queryByText("Position on Floor 1 footprint"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("X 5 m · Y 1 m")).toHaveClass(
      "absolute",
      "right-3",
      "bottom-3",
    );

    fireEvent.keyDown(screen.getByRole("button", { name: "Drag floor 2" }), {
      key: "ArrowRight",
    });
    expect(onPlacementChange).toHaveBeenCalledWith({ xMm: 6_000, yMm: 1_000 });

    fireEvent.click(screen.getByRole("button", { name: "2D plan" }));

    expect(
      screen.getByRole("img", { name: "Floor space plan" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: "3D floor volume" }),
    ).not.toBeInTheDocument();
  });
});

describe("StorageZoneDraftPreview", () => {
  it("moves the 3D draft immediately and warns when it exceeds the floor", () => {
    const onPositionChange = vi.fn();
    const initial = renderWithIntl(
      <StorageZoneDraftPreview
        floorWidthMm={10_000}
        floorDepthMm={10_000}
        floorHeightMm={3_000}
        zoneX="0"
        zoneY="0"
        zoneWidth="2"
        zoneDepth="2"
        stackHeight="2"
        zones={[]}
        onPositionChange={onPositionChange}
      />,
      { locale: "en", workspace: false },
    );
    const initialTop = screen
      .getByRole("img", { name: "Live 3D position" })
      .querySelector('[data-zone-face="top"]')
      ?.getAttribute("points");

    expect(screen.getByText("Fits within floor")).toBeInTheDocument();
    fireEvent.keyDown(
      screen.getByRole("button", { name: "Drag storage zone" }),
      { key: "ArrowRight" },
    );
    expect(onPositionChange).toHaveBeenCalledWith({ xMm: 100, yMm: 0 });

    fireEvent.click(screen.getByRole("button", { name: "2D plan" }));
    expect(
      screen.getByRole("img", { name: "Live 2D position plan" }),
    ).toHaveAttribute("data-view-mode", "plan");
    expect(screen.getByRole("button", { name: "2D plan" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    onPositionChange.mockClear();
    fireEvent.keyDown(
      screen.getByRole("button", { name: "Drag storage zone" }),
      { key: "ArrowDown" },
    );
    expect(onPositionChange).toHaveBeenCalledWith({ xMm: 0, yMm: 100 });
    initial.unmount();

    renderWithIntl(
      <StorageZoneDraftPreview
        floorWidthMm={10_000}
        floorDepthMm={10_000}
        floorHeightMm={3_000}
        zoneX="9"
        zoneY="3"
        zoneWidth="2"
        zoneDepth="2"
        stackHeight="2"
        zones={[]}
        onPositionChange={onPositionChange}
      />,
      { locale: "en", workspace: false },
    );
    const movedTop = screen
      .getByRole("img", { name: "Live 3D position" })
      .querySelector('[data-zone-face="top"]')
      ?.getAttribute("points");

    expect(movedTop).not.toBe(initialTop);
    expect(
      screen.getByText("Outside the floor or overlaps an existing area"),
    ).toBeInTheDocument();
  });

  it("rejects a storage stack that overlaps an unavailable area", () => {
    renderWithIntl(
      <StorageZoneDraftPreview
        floorWidthMm={10_000}
        floorDepthMm={10_000}
        floorHeightMm={3_000}
        zoneX="1"
        zoneY="1"
        zoneWidth="2"
        zoneDepth="2"
        stackHeight="2"
        zones={[]}
        reservedBlocks={[
          {
            id: "lift-core",
            label: "Lift core",
            xMm: 2_000,
            yMm: 2_000,
            widthMm: 2_000,
            depthMm: 2_000,
          },
        ]}
        onPositionChange={vi.fn()}
      />,
      { locale: "en", workspace: false },
    );

    expect(
      screen.getByText("Outside the floor or overlaps an existing area"),
    ).toBeInTheDocument();
  });
});

describe("ReservedBlocks", () => {
  it("opens a draggable live 3D editor for a new reserved zone", () => {
    const setBlocks = vi.fn();
    renderWithIntl(
      <ReservedBlocks
        blocks={[]}
        setBlocks={setBlocks}
        floorWidthMm={10_000}
        floorDepthMm={10_000}
        floorHeightMm={3_000}
        zones={[]}
      />,
      { locale: "en", workspace: false },
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Add unavailable area" }),
    );

    expect(
      screen.getByRole("dialog", { name: "Add unavailable area" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Live 3D reserved area" }),
    ).toBeInTheDocument();
    fireEvent.keyDown(
      screen.getByRole("button", { name: "Drag reserved zone" }),
      { key: "ArrowRight" },
    );
    expect(
      screen.getByRole("spinbutton", { name: "X position (m)" }),
    ).toHaveValue(0.1);
  });

  it("opens an existing reserved zone in the same editor", () => {
    renderWithIntl(
      <ReservedBlocks
        blocks={[
          {
            id: "reserved-a",
            label: "Lift core",
            xMm: 2_000,
            yMm: 3_000,
            widthMm: 1_000,
            depthMm: 1_500,
          },
        ]}
        setBlocks={vi.fn()}
        floorWidthMm={10_000}
        floorDepthMm={10_000}
        floorHeightMm={3_000}
        zones={[]}
      />,
      { locale: "en", workspace: false },
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit Lift core" }));

    expect(
      screen.getByRole("dialog", { name: "Edit unavailable area" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Zone label" })).toHaveValue(
      "Lift core",
    );
    expect(
      screen.getByRole("spinbutton", { name: "X position (m)" }),
    ).toHaveValue(2);
    expect(screen.getByRole("button", { name: "Save changes" })).toBeVisible();
  });
});

describe("StorageZonesPanel", () => {
  it("requires saving unavailable areas before storage stacks can be drawn", () => {
    renderWithIntl(
      <StorageZonesPanel
        warehouseId="warehouse-a"
        buildingId="building-a"
        floorNumber={4}
        floorWidthMm={10_000}
        floorDepthMm={10_000}
        floorHeightMm={3_000}
        zones={[]}
        blocked
      />,
      { locale: "en", workspace: false },
    );

    expect(
      screen.getByRole("button", { name: "Add storage stack" }),
    ).toBeDisabled();
    expect(
      screen.getByText("Save unavailable areas before drawing storage stacks"),
    ).toBeInTheDocument();
  });

  it("opens an existing zone in the draggable 3D editor", () => {
    const zone: StorageZoneRow = {
      zoneId: "zone-a",
      locationId: "location-a",
      code: "BLDG-A-F04-Z01",
      label: "QA Finished Goods Stack",
      qrValue: "ISAS:LOCATION:1:location-a",
      xMm: 3_500,
      yMm: 1_100,
      widthMm: 2_000,
      depthMm: 2_000,
      maxStackHeightMm: 3_000,
      mode: "SIMPLE",
      positions: [],
      placements: [],
    };

    renderWithIntl(
      <StorageZonesPanel
        warehouseId="warehouse-a"
        buildingId="building-a"
        floorNumber={4}
        floorWidthMm={10_000}
        floorDepthMm={10_000}
        floorHeightMm={3_000}
        zones={[zone]}
      />,
      { locale: "en", workspace: false },
    );

    expect(
      screen.getByRole("button", { name: "Add storage stack" }).parentElement,
    ).toHaveClass("grid-cols-[minmax(0,1fr)_auto]");

    fireEvent.click(
      screen.getByRole("button", { name: "Edit QA Finished Goods Stack" }),
    );

    expect(
      screen.getByRole("dialog", { name: "Edit storage stack" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Zone label" })).toHaveValue(
      "QA Finished Goods Stack",
    );
    expect(
      screen.getByRole("spinbutton", { name: "X position (m)" }),
    ).toHaveValue(3.5);
    expect(
      screen.getByRole("spinbutton", { name: "Y position (m)" }),
    ).toHaveValue(1.1);
    expect(screen.getByRole("button", { name: "Save changes" })).toBeVisible();
  });

  it("keeps active stacks editable and reviews occupied impact before saving", () => {
    const zone: StorageZoneRow = {
      zoneId: "zone-live",
      locationId: "location-live",
      code: "BLDG-A-F04-Z02",
      label: "Live finished goods stack",
      qrValue: "ISAS:LOCATION:1:location-live",
      xMm: 4_000,
      yMm: 1_000,
      widthMm: 3_000,
      depthMm: 3_000,
      maxStackHeightMm: 4_000,
      mode: "SIMPLE",
      positions: [],
      placements: [
        {
          placementId: "placement-live",
          handlingUnitId: "handling-unit-live",
          lpn: "LPN-LIVE-01",
          levelIndex: 1,
          widthMm: 1_200,
          depthMm: 1_000,
          heightMm: 1_400,
          orientation: "DEFAULT",
          placedAt: 1,
        },
      ],
    };

    renderWithIntl(
      <StorageZonesPanel
        warehouseId="warehouse-a"
        buildingId="building-a"
        floorNumber={4}
        floorWidthMm={10_000}
        floorDepthMm={10_000}
        floorHeightMm={4_000}
        zones={[zone]}
        layoutStatus="ACTIVE"
      />,
      { locale: "en", workspace: false },
    );

    expect(
      screen.getByRole("button", { name: "Add storage stack" }),
    ).toBeEnabled();
    expect(screen.getByText("Quick Change is available")).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", { name: "Edit Live finished goods stack" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Review impact" }));

    expect(screen.getByText("Review impact before saving")).toBeVisible();
    expect(screen.getAllByText("LPN-LIVE-01")).toHaveLength(2);
    expect(screen.getByText("1.4 m")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Confirm changes" }),
    ).toBeVisible();
  });
});
