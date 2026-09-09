import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import type * as WorkspaceModule from "@/components/providers/WorkspaceProvider";
import { NextIntlClientProvider } from "next-intl";
import { messagesFor } from "@/i18n/messages";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mutation = vi.hoisted(() => vi.fn());
const navigate = vi.hoisted(() => vi.fn());
const layoutAccess = vi.hoisted(() => ({
  manage: true,
  ready: true,
  query: vi.fn<() => unknown>(),
}));
beforeEach(() => {
  navigate.mockReset();
  layoutAccess.manage = true;
  layoutAccess.ready = true;
  layoutAccess.query.mockReset().mockReturnValue(undefined);
  mutation
    .mockReset()
    .mockResolvedValue({ ok: true, value: { written: true } });
});

vi.mock("convex/react", () => ({
  useMutation: () => mutation,
  useQuery: () => layoutAccess.query(),
}));
vi.mock("@/components/providers/WorkspaceProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof WorkspaceModule>()),
  useWorkspace: () => ({
    permissionsReady: layoutAccess.ready,
    navigationPermissions: layoutAccess.manage
      ? ["masterData.storageLayout.manage"]
      : ["masterData.storageLayout.read"],
  }),
}));
vi.mock("@/components/system/QueryGate", () => ({
  QueryGate: ({ children }: { children: (warehouseId: string) => ReactNode }) =>
    children("warehouse-a"),
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...props }: ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
  useRouter: () => ({ push: navigate }),
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
  StorageFloorEditor,
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
  it("opens persisted inventory and aisles directly, updates live data, and switches floors", () => {
    const zone = occupiedTestZone();
    const savedFloors = floors.map((floor) =>
      floor.floorNumber === 2
        ? {
            ...floor,
            storageZones: [zone],
            reservedBlocks: [
              {
                blockId: "aisle",
                label: "Saved walkway",
                xMm: 8000,
                yMm: 0,
                widthMm: 2000,
                depthMm: 18000,
              },
            ],
          }
        : floor,
    );
    const { rerender, container } = render(
      <BuildingModelWorkspace building={building} floors={savedFloors} />,
      {
        wrapper: ({ children }) => (
          <NextIntlClientProvider
            locale="en"
            messages={messagesFor("en")}
            timeZone="Asia/Bangkok"
          >
            {children}
          </NextIntlClientProvider>
        ),
      },
    );
    expect(screen.getByRole("button", { name: /Floor 2/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("region", { name: "Interactive floor map" }),
    ).toBeVisible();
    expect(
      screen.getByText("Saved walkway", { selector: "text" }),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Select location Occupied FG" }),
    );
    expect(
      screen.getByRole("link", { name: "Open pallet P-005" }),
    ).toHaveAttribute("href", "/finished-goods/pallets/held-pallet");
    fireEvent.click(screen.getByRole("button", { name: "Edit Occupied FG" }));
    expect(navigate).toHaveBeenCalledWith(
      "/master-data/storage-layouts/building-a/floors/2?editZone=blocked-zone",
    );
    expect(container.querySelector('a[href$="/demo"]')).toBeNull();
    rerender(
      <BuildingModelWorkspace
        building={building}
        floors={savedFloors.map((floor) => ({
          ...floor,
          storageZones: floor.storageZones.map((z) => ({
            ...z,
            placements: [],
          })),
        }))}
      />,
    );
    expect(
      screen.queryByRole("link", { name: "Open pallet P-005" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Floor 1/ }));
    expect(screen.queryByText("Saved walkway")).not.toBeInTheDocument();
    expect(screen.getByText("No storage locations yet")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Building model" }));
    expect(
      screen.queryByRole("region", { name: "Interactive floor map" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Storage map" }));
    expect(
      screen.getByRole("region", { name: "Interactive floor map" }),
    ).toBeVisible();
    expect(mutation).not.toHaveBeenCalled();
  });
  it("handles buildings without saved floors", () => {
    renderWithIntl(<BuildingModelWorkspace building={building} floors={[]} />, {
      locale: "en",
      workspace: false,
    });
    expect(
      screen.getByText("No floors have been saved for this building."),
    ).toBeVisible();
  });

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
      screen.queryByRole("button", { name: "Drag floor 2" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit floor offset" }));
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
  it("shows the edited zone contents at saved coordinates in both views and draws neighboring heights", () => {
    const editingZone = occupiedTestZone();
    const neighbor = {
      ...occupiedTestZone(),
      zoneId: "neighbor",
      xMm: 5000,
      maxStackHeightMm: 2000,
      placements: [],
    };
    const { container } = renderWithIntl(
      <StorageZoneDraftPreview
        floorWidthMm={10000}
        floorDepthMm={10000}
        floorHeightMm={3000}
        zoneX="0.1"
        zoneY="0"
        zoneWidth="4"
        zoneDepth="4"
        stackHeight="3"
        zones={[neighbor]}
        editingZone={editingZone}
        onPositionChange={vi.fn()}
      />,
      { locale: "en", workspace: false },
    );
    expect(screen.getByText("Fits within floor")).toBeVisible();
    expect(
      container.querySelectorAll('[data-scene-kind="location"]'),
    ).toHaveLength(2);
    expect(
      container.querySelectorAll(
        '[data-scene-kind="location"] [data-scene-edge]',
      ),
    ).toHaveLength(24);
    const saved = container.querySelector('[data-placement-id="held"]');
    expect(saved).toHaveAttribute("data-placement-x-mm", "0");
    expect(saved).toHaveAttribute("data-placement-y-mm", "0");
    expect(saved?.querySelector("polygon")).toHaveAttribute(
      "fill",
      "transparent",
    );
    fireEvent.click(screen.getByRole("button", { name: "2D plan" }));
    expect(
      container.querySelector('[data-placement-id="held"]'),
    ).toHaveAttribute("data-placement-x-mm", "0");
    expect(
      container.querySelectorAll(
        '[data-scene-kind="location"] [data-scene-edge]',
      ),
    ).toHaveLength(8);
  });

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
  it.each([false, true])(
    "disables zone mutation controls for read-only access (permissions loading: %s)",
    (loading) => {
      layoutAccess.manage = loading;
      layoutAccess.ready = !loading;
      const zone = occupiedTestZone();
      renderWithIntl(
        <StorageZonesPanel
          warehouseId="warehouse-a"
          buildingId="building-a"
          floorNumber={1}
          floorWidthMm={10000}
          floorDepthMm={10000}
          floorHeightMm={3000}
          zones={[zone]}
          layoutStatus="ACTIVE"
        />,
        { locale: "en", workspace: false },
      );
      const edit = screen.getByRole("button", { name: `Edit ${zone.label}` });
      expect(edit).toBeDisabled();
      expect(
        screen.getByRole("button", { name: "Add storage stack" }),
      ).toBeDisabled();
      expect(screen.getByRole("button", { name: "Archive" })).toBeDisabled();
      fireEvent.click(edit);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(
        screen.getByText(
          "View-only access. A warehouse manager can change this layout.",
        ),
      ).toBeVisible();
      expect(screen.getByRole("link", { name: "P-005" })).toBeVisible();
      expect(mutation).not.toHaveBeenCalled();
    },
  );

  it("closes a zone editor when manage permission is revoked", () => {
    const zone = occupiedTestZone();
    const content = () => (
      <StorageZonesPanel
        warehouseId="warehouse-a"
        buildingId="building-a"
        floorNumber={1}
        floorWidthMm={10000}
        floorDepthMm={10000}
        floorHeightMm={3000}
        zones={[zone]}
        layoutStatus="ACTIVE"
      />
    );
    const view = render(
      <NextIntlClientProvider locale="en" messages={messagesFor("en")}>
        {content()}
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: `Edit ${zone.label}` }));
    expect(screen.getByRole("dialog")).toBeVisible();
    layoutAccess.manage = false;
    view.rerender(
      <NextIntlClientProvider locale="en" messages={messagesFor("en")}>
        {content()}
      </NextIntlClientProvider>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mutation).not.toHaveBeenCalled();
  });

  it("keeps floor dimensions, unavailable areas and save protected for a viewer", () => {
    layoutAccess.manage = false;
    layoutAccess.query.mockReturnValue({
      ok: true,
      value: {
        found: true,
        building,
        floors: [
          {
            ...floors[1],
            reservedBlocks: [
              {
                blockId: "lift",
                label: "Lift core",
                xMm: 0,
                yMm: 0,
                widthMm: 1000,
                depthMm: 1000,
              },
            ],
          },
        ],
      },
    });
    renderWithIntl(
      <StorageFloorEditor buildingId="building-a" floorNumber={2} />,
      { locale: "en", workspace: false },
    );
    for (const name of ["Width (m)", "Depth (m)", "Floor height (m)"])
      expect(screen.getByRole("spinbutton", { name })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Drag floor 2" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add unavailable area" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Edit Lift core" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Remove Lift core" }),
    ).toBeDisabled();
    const form = screen
      .getByRole("spinbutton", { name: "Width (m)" })
      .closest("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form!);
    expect(mutation).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Floor changes saved" }),
    ).toBeDisabled();
  });

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
    expect(
      screen.getByRole("combobox", { name: "Storage condition (optional)" }),
    ).toHaveTextContent("Not configured");
    expect(
      screen.getByText(
        "Recommendations compare this condition with the product requirement. Unconfigured conditions are shown as unknown.",
      ),
    ).toBeVisible();
  });

  it("keeps active planner spots editable without inventory workflows", () => {
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
      placements: [],
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
    expect(screen.getByRole("button", { name: "Save changes" })).toBeVisible();
    expect(
      screen.queryByText("Stack order · top to bottom"),
    ).not.toBeInTheDocument();
  });
});

describe("storage location anchor navigation", () => {
  const scroll = vi.fn();
  const originalScroll = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "scrollIntoView",
  );
  beforeEach(() => {
    scroll.mockClear();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scroll,
    });
    window.history.replaceState(null, "", "/");
  });
  afterEach(() => {
    window.history.replaceState(null, "", "/");
    if (originalScroll)
      Object.defineProperty(
        HTMLElement.prototype,
        "scrollIntoView",
        originalScroll,
      );
    else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  });
  function panel(zones: readonly StorageZoneRow[]) {
    return (
      <NextIntlClientProvider locale="en" messages={messagesFor("en")}>
        <StorageZonesPanel
          warehouseId="warehouse-a"
          buildingId="building-a"
          floorNumber={1}
          floorWidthMm={10000}
          floorDepthMm={10000}
          floorHeightMm={3000}
          zones={zones}
        />
      </NextIntlClientProvider>
    );
  }
  it("focuses the linked location once data arrives without opening an editor or re-scrolling on query updates", () => {
    const zone = occupiedTestZone();
    window.history.replaceState(null, "", `/#storage-zone-${zone.zoneId}`);
    const view = render(panel([]));
    expect(scroll).not.toHaveBeenCalled();
    view.rerender(panel([zone]));
    expect(
      screen.getByRole("article", { name: `${zone.label} · ${zone.code}` }),
    ).toHaveFocus();
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll).toHaveBeenCalledWith({ block: "start" });
    view.rerender(panel([{ ...zone, label: "Current location name" }]));
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mutation).not.toHaveBeenCalled();
  });
  it("supports the general section anchor and a later hash change to a specific location", () => {
    const zone = occupiedTestZone();
    window.history.replaceState(null, "", "/#storage-stacks-section");
    render(panel([zone]));
    expect(document.getElementById("storage-stacks-section")).toHaveFocus();
    window.history.replaceState(null, "", `/#storage-zone-${zone.zoneId}`);
    fireEvent(window, new HashChangeEvent("hashchange"));
    expect(
      screen.getByRole("article", { name: `${zone.label} · ${zone.code}` }),
    ).toHaveFocus();
    expect(scroll).toHaveBeenCalledTimes(2);
  });
  it("ignores a missing or unrelated fragment without changing focus", () => {
    window.history.replaceState(null, "", "/#storage-zone-missing");
    render(panel([occupiedTestZone()]));
    expect(scroll).not.toHaveBeenCalled();
    expect(document.body).toHaveFocus();
    expect(mutation).not.toHaveBeenCalled();
  });
});

it("shows reserved and stored exact positions on spot cards with pallet links and unchanged square QR boxes", () => {
  const placement = {
    placementId: "placement-one",
    handlingUnitId: "pallet-one",
    lpn: "P-001",
    positionCode: "POS-001",
    levelIndex: 1,
    widthMm: 1_000,
    depthMm: 1_200,
    heightMm: 1_400,
    orientation: "DEFAULT" as const,
    placedAt: 1,
    xMm: 0,
    yMm: 0,
    zMm: 0,
    status: "STORED" as const,
  };
  const zone: StorageZoneRow = {
    zoneId: "zone-one",
    locationId: "location-one",
    label: "FG-1",
    code: "BLDG-F01-Z01",
    qrValue: "ISAS:LOCATION:1:location-one",
    mode: "SIMPLE",
    xMm: 500,
    yMm: 500,
    widthMm: 2_000,
    depthMm: 2_000,
    maxStackHeightMm: 3_000,
    positions: [],
    placements: [
      placement,
      {
        ...placement,
        placementId: "placement-two",
        handlingUnitId: "pallet-two",
        lpn: "P-002",
        positionCode: "POS-002",
        xMm: 1_000,
        status: "RESERVED",
      },
    ],
  };
  const { container } = renderWithIntl(
    <StorageZonesPanel
      warehouseId="warehouse-one"
      buildingId="building-one"
      floorNumber={1}
      floorWidthMm={10_000}
      floorDepthMm={10_000}
      floorHeightMm={3_000}
      zones={[zone]}
    />,
    { locale: "en", workspace: false },
  );
  expect(screen.getByRole("link", { name: "P-001" })).toHaveAttribute(
    "href",
    "/finished-goods/pallets/pallet-one",
  );
  expect(screen.getByRole("link", { name: "P-002" })).toHaveAttribute(
    "href",
    "/finished-goods/pallets/pallet-two",
  );
  expect(screen.getByText("Reserved")).toBeInTheDocument();
  expect(screen.getByText("Stored")).toBeInTheDocument();
  expect(screen.getByText("POS-002")).toBeInTheDocument();
  expect(container.querySelector(".size-24")).toHaveClass(
    "shrink-0",
    "self-start",
    "p-2",
  );
});

it("keeps exact pallets inside the floor viewport and translates local coordinates through floor offsets", () => {
  const placement = {
    placementId: "floor-placement",
    handlingUnitId: "floor-pallet",
    lpn: "P-003",
    levelIndex: 1,
    widthMm: 1_000,
    depthMm: 1_000,
    heightMm: 1_400,
    orientation: "DEFAULT" as const,
    placedAt: 1,
    xMm: 100,
    yMm: 200,
    zMm: 0,
    status: "STORED" as const,
  };
  const zone: StorageZoneRow = {
    zoneId: "floor-zone",
    locationId: "floor-location",
    label: "FG-1",
    code: "FG-1",
    qrValue: "QR",
    mode: "SIMPLE",
    xMm: 500,
    yMm: 500,
    widthMm: 2_000,
    depthMm: 2_000,
    maxStackHeightMm: 3_000,
    positions: [],
    placements: [placement],
  };
  const { container } = renderWithIntl(
    <FloorPlan
      widthMm={8_000}
      depthMm={8_000}
      heightMm={3_000}
      baseWidthMm={10_000}
      baseDepthMm={10_000}
      baseLabel="Base floor"
      floorNumber={2}
      offsetXMm={1_000}
      offsetYMm={2_000}
      onPlacementChange={vi.fn()}
      blocks={[]}
      zones={[zone]}
    />,
    { locale: "en", workspace: false },
  );
  fireEvent.click(screen.getByRole("button", { name: "Edit floor offset" }));
  const svg = screen.getByRole("img", { name: "3D floor volume" });
  const [left, top, width, height] = svg
    .getAttribute("viewBox")!
    .split(" ")
    .map(Number) as [number, number, number, number];
  for (const polygon of container.querySelectorAll(
    "[data-placement-id] polygon",
  ))
    for (const point of polygon.getAttribute("points")!.split(" ")) {
      const [x, y] = point.split(",").map(Number) as [number, number];
      expect(x).toBeGreaterThanOrEqual(left);
      expect(x).toBeLessThanOrEqual(left + width);
      expect(y).toBeGreaterThanOrEqual(top);
      expect(y).toBeLessThanOrEqual(top + height);
    }
  fireEvent.click(screen.getByRole("button", { name: "2D plan" }));
  expect(
    container
      .querySelector('[data-placement-face="top"]')
      ?.getAttribute("points")
      ?.split(" ")[0],
  ).toBe("1600,2700");
});

function occupiedTestZone(): StorageZoneRow {
  return {
    zoneId: "blocked-zone",
    locationId: "blocked-location",
    code: "FG-1",
    label: "Occupied FG",
    qrValue: "QR",
    mode: "SIMPLE",
    xMm: 0,
    yMm: 0,
    widthMm: 4_000,
    depthMm: 4_000,
    maxStackHeightMm: 3_000,
    positions: [],
    placements: [
      {
        placementId: "held",
        handlingUnitId: "held-pallet",
        lpn: "P-005",
        levelIndex: 1,
        widthMm: 1_000,
        depthMm: 1_000,
        heightMm: 1_400,
        orientation: "DEFAULT",
        placedAt: 1,
        xMm: 0,
        yMm: 0,
        zMm: 0,
        status: "RESERVED",
      },
    ],
  };
}

it("disables confirmation for occupied zone geometry while allowing a label-only save", async () => {
  const zone = occupiedTestZone();
  renderWithIntl(
    <StorageZonesPanel
      warehouseId="warehouse-a"
      buildingId="building-a"
      floorNumber={1}
      floorWidthMm={10_000}
      floorDepthMm={10_000}
      floorHeightMm={3_000}
      zones={[zone]}
      layoutStatus="ACTIVE"
    />,
    { locale: "en", workspace: false },
  );
  fireEvent.click(screen.getByRole("button", { name: "Edit Occupied FG" }));
  fireEvent.change(screen.getByRole("spinbutton", { name: "Zone width (m)" }), {
    target: { value: "3" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Review impact" }));
  expect(
    screen.getByRole("button", { name: "Confirm changes" }),
  ).toBeDisabled();
  expect(
    screen.getByText(
      "This area has reserved or stored pallets. Reassign them before changing its dimensions or position.",
    ),
  ).toBeInTheDocument();
  expect(mutation).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Back to edit" }));
  fireEvent.change(screen.getByRole("spinbutton", { name: "Zone width (m)" }), {
    target: { value: "4" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Zone label" }), {
    target: { value: "Renamed FG" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(mutation).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Renamed FG", widthMm: 4_000 }),
    ),
  );
});

it("localizes a concurrent occupancy refusal instead of displaying its raw code", async () => {
  const zone = { ...occupiedTestZone(), placements: [] };
  mutation.mockResolvedValueOnce({
    ok: true,
    value: { written: false, error: { code: "LOCATION_OCCUPIED" } },
  });
  renderWithIntl(
    <StorageZonesPanel
      warehouseId="warehouse-a"
      buildingId="building-a"
      floorNumber={1}
      floorWidthMm={10_000}
      floorDepthMm={10_000}
      floorHeightMm={3_000}
      zones={[zone]}
      layoutStatus="ACTIVE"
    />,
    { locale: "en", workspace: false },
  );
  fireEvent.click(screen.getByRole("button", { name: "Edit Occupied FG" }));
  fireEvent.change(screen.getByRole("spinbutton", { name: "Zone width (m)" }), {
    target: { value: "3" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(
    await within(screen.getByRole("dialog")).findByText(
      "This area has reserved or stored pallets. Release reservations or reassign pallets before changing its structure.",
    ),
  ).toBeInTheDocument();
  expect(
    screen.getAllByText(
      "This area has reserved or stored pallets. Release reservations or reassign pallets before changing its structure.",
    ),
  ).toHaveLength(1);
  expect(screen.queryByText(/LOCATION_OCCUPIED/)).not.toBeInTheDocument();
});

it("blocks occupied building dimension confirmation without blocking its name", () => {
  renderWithIntl(
    <BuildingSettingsDialog
      warehouseId="warehouse-a"
      building={{ ...building, status: "ACTIVE" }}
      placements={occupiedTestZone().placements}
    />,
    { locale: "en", workspace: false },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Edit building settings" }),
  );
  fireEvent.change(screen.getByRole("spinbutton", { name: "Width (m)" }), {
    target: { value: "31" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Review impact" }));
  expect(
    screen.getByRole("button", { name: "Confirm changes" }),
  ).toBeDisabled();
  expect(mutation).not.toHaveBeenCalled();
});

describe("searchable storage spots", () => {
  function show(zones: StorageZoneRow[], locale: "en" | "th" = "en") {
    return renderWithIntl(
      <StorageZonesPanel
        warehouseId="warehouse-a"
        buildingId="building-a"
        floorNumber={1}
        floorWidthMm={10000}
        floorDepthMm={10000}
        floorHeightMm={3000}
        zones={zones}
      />,
      { locale, workspace: false },
    );
  }
  const spare = () => ({
    ...occupiedTestZone(),
    zoneId: "spare",
    code: "BLDG-Z02",
    label: "พื้นที่ว่าง",
    placements: [],
  });
  it("links directly to stored pallets and their move flow", () => {
    const zone = occupiedTestZone();
    show([
      {
        ...zone,
        placements: zone.placements.map((p) => ({
          ...p,
          status: "STORED" as const,
        })),
      },
    ]);
    expect(
      screen.getByRole("link", { name: "Open pallet P-005" }),
    ).toHaveAttribute("href", "/finished-goods/pallets/held-pallet");
    expect(
      screen.getByRole("link", { name: "Move pallet P-005" }),
    ).toHaveAttribute("href", "/finished-goods/pallets/held-pallet/move");
    expect(mutation).not.toHaveBeenCalled();
  });
  it("keeps reserved units viewable without offering a new move", () => {
    show([occupiedTestZone()]);
    expect(
      screen.getByRole("link", { name: "Open pallet P-005" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Move pallet P-005" }),
    ).not.toBeInTheDocument();
  });
  it("resumes existing moves and hides move shortcuts for view-only users", () => {
    const zone = occupiedTestZone();
    const moving = {
      ...zone,
      placements: zone.placements.map((p) => ({
        ...p,
        moveState: "IN_TRANSIT" as const,
      })),
    };
    const view = show([moving]);
    expect(
      screen.getByRole("link", { name: "Continue move for P-005" }),
    ).toHaveAttribute("href", "/finished-goods/pallets/held-pallet/move");
    view.unmount();
    layoutAccess.manage = false;
    show([moving]);
    expect(
      screen.getByRole("link", { name: "Open pallet P-005" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Continue move for P-005" }),
    ).not.toBeInTheDocument();
  });
  it("searches names, codes and pallet numbers without changing stored data", () => {
    show([occupiedTestZone(), spare()]);
    const search = screen.getByRole("searchbox", {
      name: "Search storage spots",
    });
    for (const value of ["  occupied  fg  ", "fg-1", "p-005"]) {
      fireEvent.change(search, { target: { value } });
      expect(screen.getAllByRole("article")).toHaveLength(1);
      expect(screen.getByRole("link", { name: "P-005" })).toBeVisible();
    }
    fireEvent.change(search, { target: { value: "ไม่มีจุดนี้" } });
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(screen.getByText("No matching locations")).toBeVisible();
    fireEvent.click(
      screen.getAllByRole("button", { name: "Clear location search" })[0]!,
    );
    expect(search).toHaveFocus();
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(mutation).not.toHaveBeenCalled();
  });
  it("supports Thai names and distinguishes an empty floor from zero search results", () => {
    const view = show([spare()], "th");
    fireEvent.change(
      screen.getByRole("searchbox", { name: "ค้นหาจุดจัดเก็บ" }),
      { target: { value: "พื้นที่ว่าง" } },
    );
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByText("แสดง 1 จาก 1 จุดจัดเก็บ")).toBeVisible();
    view.unmount();
    show([]);
    expect(screen.getByText("No storage locations yet")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Add storage stack" }),
    ).toBeEnabled();
  });
  it("removes duplicate default QR labels but retains and searches distinct positions", () => {
    const zone = occupiedTestZone();
    const position = {
      locationId: zone.locationId,
      code: zone.code,
      label: zone.label,
      qrValue: zone.qrValue,
      kind: "DEFAULT" as const,
      isDefault: true,
      breadcrumb: "Floor 1",
      placements: [],
    };
    show([
      {
        ...zone,
        positions: [
          position,
          {
            ...position,
            locationId: "rack-slot",
            code: "RACK-02",
            label: "Rack upper",
            qrValue: "QR-RACK-02",
            isDefault: false,
          },
        ],
      },
    ]);
    expect(screen.getAllByRole("img")).toHaveLength(2);
    const details = screen.getByRole("article").querySelector("details");
    expect(details).not.toHaveAttribute("open");
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search storage spots" }),
      { target: { value: "rack-02" } },
    );
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getAllByRole("img")).toHaveLength(2);
    expect(details).toHaveAttribute("open");
    expect(screen.getByText("Rack upper")).toBeVisible();
  });
  it("does not let Enter in search submit the surrounding floor form", () => {
    show([occupiedTestZone()]);
    expect(
      fireEvent.keyDown(screen.getByRole("searchbox"), {
        key: "Enter",
        code: "Enter",
      }),
    ).toBe(false);
    expect(mutation).not.toHaveBeenCalled();
  });
});

describe("interactive floor map", () => {
  const props = () => ({
    widthMm: 10000,
    depthMm: 10000,
    heightMm: 3000,
    baseWidthMm: 10000,
    baseDepthMm: 10000,
    baseLabel: "Previous floor",
    floorNumber: 4,
    offsetXMm: 0,
    offsetYMm: 6000,
    blocks: [],
    zones: [occupiedTestZone()],
  });
  it("fills only the selected physical package and clears it when selecting a location", () => {
    const original = occupiedTestZone();
    const zone = {
      ...original,
      placements: [
        ...original.placements,
        {
          ...original.placements[0]!,
          placementId: "second",
          handlingUnitId: "second-unit",
          lpn: "P-006",
          xMm: 2000,
        },
      ],
    };
    const { container } = renderWithIntl(
      <FloorPlan {...props()} zones={[zone]} />,
      { locale: "en", workspace: false },
    );
    expect(container.querySelector('[data-scene-solid="true"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "P-005 · Reserved" }));
    expect(
      container.querySelectorAll('[data-scene-solid="true"]'),
    ).toHaveLength(1);
    expect(
      container.querySelector('[data-placement-id="second"] polygon'),
    ).toHaveAttribute("fill", "transparent");
    fireEvent.click(
      screen.getByRole("button", { name: "Select location Occupied FG" }),
    );
    expect(container.querySelector('[data-scene-solid="true"]')).toBeNull();
  });

  it("inspects without moving geometry, retains selection across views, and only edits explicitly", () => {
    const edit = vi.fn(),
      move = vi.fn();
    const { container } = renderWithIntl(
      <FloorPlan {...props()} onEditZone={edit} onPlacementChange={move} />,
      { locale: "en", workspace: false },
    );
    expect(container.querySelector("[data-reference-floor]")).toBeNull();
    expect(container.querySelectorAll("[data-height-envelope]")).toHaveLength(
      1,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Select location Occupied FG" }),
    );
    expect(container.querySelector("[data-height-envelope]")).not.toBeNull();
    expect(screen.getByText("Height limit: 3 m")).toBeVisible();
    expect(edit).not.toHaveBeenCalled();
    expect(move).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "2D plan" }));
    expect(container.querySelector("[data-height-envelope]")).toBeNull();
    expect(screen.getByText("Height limit: 3 m")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Edit Occupied FG" }));
    expect(edit).toHaveBeenCalledWith("blocked-zone");
    fireEvent.keyDown(
      screen.getByRole("group", { name: "Interactive floor map" }),
      { key: "Escape" },
    );
    expect(screen.getByText("Select a location")).toBeVisible();
  });
  it("searches units while retaining context, handles no matches, and never submits the form", () => {
    const other = {
      ...occupiedTestZone(),
      zoneId: "other",
      code: "OTHER",
      label: "Other spot",
      placements: [],
    };
    const { container } = renderWithIntl(
      <FloorPlan {...props()} zones={[occupiedTestZone(), other]} />,
      { locale: "en", workspace: false },
    );
    const input = screen.getByRole("searchbox", {
      name: "Search storage spots",
    });
    fireEvent.change(input, { target: { value: "p-005" } });
    expect(
      screen.getByRole("link", { name: "Open pallet P-005" }),
    ).toBeVisible();
    expect(container.querySelectorAll("[data-zone-id]")).toHaveLength(2);
    expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(false);
    fireEvent.change(input, { target: { value: "unknown" } });
    expect(screen.getByRole("status")).toHaveTextContent(
      "No matching locations",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Clear location search" }),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Showing 2 of 2");
    expect(mutation).not.toHaveBeenCalled();
  });
  it("preserves exact placement coordinates under camera rotation and shows local-coordinate details", () => {
    const zone = occupiedTestZone();
    const { container } = renderWithIntl(
      <FloorPlan
        {...props()}
        zones={[
          {
            ...zone,
            xMm: 500,
            placements: zone.placements.map((p) => ({
              ...p,
              xMm: 200,
              yMm: 300,
              zMm: 1400,
              status: "STORED" as const,
            })),
          },
        ]}
      />,
      { locale: "en", workspace: false },
    );
    const box = () => container.querySelector('[data-placement-id="held"]');
    expect(box()).toHaveAttribute("data-placement-x-mm", "700");
    expect(box()).toHaveAttribute("data-placement-z-mm", "1400");
    const before = box()?.querySelector("polygon")?.getAttribute("points");
    fireEvent.click(screen.getByRole("button", { name: "Rotate view" }));
    expect(box()).toHaveAttribute("data-placement-x-mm", "700");
    expect(box()?.querySelector("polygon")?.getAttribute("points")).not.toBe(
      before,
    );
    fireEvent.click(screen.getByRole("button", { name: "P-005 · Stored" }));
    expect(
      screen.getByText("Coordinates are relative to the storage location."),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Move pallet P-005" }),
    ).toHaveAttribute("href", "/finished-goods/pallets/held-pallet/move");
    expect(mutation).not.toHaveBeenCalled();
  });
  it("supports empty floors and gates map edits for read-only users", () => {
    layoutAccess.manage = false;
    const { unmount } = renderWithIntl(<FloorPlan {...props()} zones={[]} />, {
      locale: "th",
      workspace: false,
    });
    expect(screen.getByText("ยังไม่มีจุดจัดเก็บ")).toBeVisible();
    unmount();
    renderWithIntl(<FloorPlan {...props()} onEditZone={vi.fn()} />, {
      locale: "en",
      workspace: false,
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Select location Occupied FG" }),
    );
    expect(
      screen.queryByRole("button", { name: "Edit Occupied FG" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open pallet P-005" }),
    ).toBeVisible();
  });
  it("opens the existing editor from a map request without writing", () => {
    renderWithIntl(
      <StorageZonesPanel
        warehouseId="warehouse-a"
        buildingId="building-a"
        floorNumber={4}
        floorWidthMm={10000}
        floorDepthMm={10000}
        floorHeightMm={3000}
        zones={[occupiedTestZone()]}
        editRequest={{ zoneId: "blocked-zone", nonce: 1 }}
      />,
      { locale: "en", workspace: false },
    );
    expect(
      screen.getByRole("dialog", { name: "Edit storage stack" }),
    ).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Zone label" })).toHaveValue(
      "Occupied FG",
    );
    expect(mutation).not.toHaveBeenCalled();
  });
});

it("renders dense demo scenarios without inventory links or writes", async () => {
  const { FloorMapDemo } =
    await import("@/components/storageLayouts/FloorMapDemo");
  const { container } = renderWithIntl(<FloorMapDemo />, {
    locale: "en",
    workspace: false,
  });
  expect(container.querySelectorAll("[data-placement-id]")).toHaveLength(62);
  expect(container.querySelectorAll("[data-unavailable-area]")).toHaveLength(3);
  fireEvent.click(
    screen.getByRole("button", {
      name: "All storage footprints full · 120 units",
    }),
  );
  expect(container.querySelectorAll("[data-placement-id]")).toHaveLength(120);
  fireEvent.click(screen.getByRole("button", { name: "2D plan" }));
  const labels = [...container.querySelectorAll("[data-floor-callout]")];
  expect(labels).toHaveLength(4);
  const aisles = [
    ...container.querySelectorAll("[data-unavailable-area] polygon"),
  ].map((p) =>
    p
      .getAttribute("points")!
      .split(" ")
      .map((point) => point.split(",").map(Number)),
  );
  for (const label of labels) {
    const x = Number(label.getAttribute("x")),
      y = Number(label.getAttribute("y")),
      w = Number(label.getAttribute("width")),
      h = Number(label.getAttribute("height"));
    for (const points of aisles) {
      const left = Math.min(...points.map((p) => p[0]!)),
        right = Math.max(...points.map((p) => p[0]!)),
        top = Math.min(...points.map((p) => p[1]!)),
        bottom = Math.max(...points.map((p) => p[1]!));
      expect(x < right && x + w > left && y < bottom && y + h > top).toBe(
        false,
      );
    }
  }

  fireEvent.click(
    screen.getByRole("button", {
      name: "Select location FG-A · Full footprint",
    }),
  );
  expect(
    screen.getByText("Floor footprint used or reserved: 100%"),
  ).toBeVisible();
  expect(container.querySelector('a[href*="/pallets/demo-"]')).toBeNull();
  fireEvent.change(
    screen.getByRole("searchbox", { name: "Search storage spots" }),
    { target: { value: "DEMO-P-030" } },
  );
  expect(
    within(
      screen.getByRole("complementary", { name: "Selected location" }),
    ).getAllByRole("listitem")[0],
  ).toHaveTextContent("DEMO-P-030");

  expect(mutation).not.toHaveBeenCalled();
});
