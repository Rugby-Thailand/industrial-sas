import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState, type ComponentProps, type ReactNode } from "react";
import type * as WorkspaceModule from "@/components/providers/WorkspaceProvider";
import { NextIntlClientProvider } from "next-intl";
import { messagesFor } from "@/i18n/messages";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mutation = vi.hoisted(() => vi.fn());
const navigate = vi.hoisted(() => vi.fn());
const layoutAccess = vi.hoisted(() => ({
  manage: true,
  activate: false,
  ready: true,
  query: vi.fn<() => unknown>(),
}));
beforeEach(() => {
  window.history.replaceState({}, "", "/");
  navigate.mockReset();
  layoutAccess.manage = true;
  layoutAccess.activate = false;
  layoutAccess.ready = true;
  layoutAccess.query.mockReset().mockReturnValue(undefined);
  mutation
    .mockReset()
    .mockResolvedValue({ ok: true, value: { written: true } });
});

vi.mock("./useStorageBuilding", () => ({
  useStorageBuilding: () => layoutAccess.query(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigate, replace: navigate }),
}));
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ userId: "user-a", orgId: "org-a" }),
}));

vi.mock("convex/react", () => ({
  useMutation: () => mutation,
  useQuery: () => layoutAccess.query(),
}));
vi.mock("@/components/providers/WorkspaceProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof WorkspaceModule>()),
  useWorkspace: () => ({
    permissionsReady: layoutAccess.ready,
    navigationPermissions: [
      layoutAccess.manage
        ? "masterData.storageLayout.manage"
        : "masterData.storageLayout.read",
      ...(layoutAccess.activate ? ["masterData.storageLayout.activate"] : []),
    ],
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
  useRouter: () => ({ push: navigate, replace: navigate }),
}));

import { renderWithIntl } from "@tests/fixtures/intl-render";
import {
  NavigationGuardProvider,
  useNavigationDraft,
} from "@/components/navigation/NavigationGuardProvider";
import { isGuardTraversal } from "@/lib/navigationGuard";
import { trackAppHistory } from "@/lib/browser/appHistory";

import type {
  StorageBuildingRow,
  StorageFloorRow,
  StorageZoneRow,
} from "@/lib/convex/storageLayoutApi";

import {
  NewStorageBuildingForm,
  BuildingModelWorkspace,
  BuildingSettingsDialog,
  FloorPlan,
  IsometricBuilding,
  ReservedBlocks,
  StorageBuildingCatalogue,
  StorageCatalogueFilters,
  StorageZoneDraftPreview,
  StorageZonesPanel,
  StorageFloorEditor,
  StorageBuildingReview,
} from "./StorageLayoutScreens";

function floorButton(floor: number) {
  const name = `Floor ${floor}`;
  if (!screen.queryByRole("button", { name }))
    fireEvent.click(screen.getByRole("button", { name: "Building floors" }));
  return screen.getByRole("button", { name });
}
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

  it("places a page action to the right of, and outside, the search field", () => {
    renderWithIntl(
      <StorageCatalogueFilters
        search=""
        status="ALL"
        onSearchChange={vi.fn()}
        onStatusChange={vi.fn()}
        action={<button type="button">Building</button>}
      />,
      { locale: "en", workspace: false },
    );
    const input = screen.getByRole("textbox", { name: "Search buildings" });
    const action = screen.getByRole("button", { name: "Building" });
    const field = input.closest("label")!;
    expect(field).not.toContainElement(action);
    expect(field.parentElement).toContainElement(action);
    expect(field.nextElementSibling).toBe(action);
  });

  it("shows one New building action beside the search in each catalogue view", () => {
    localStorage.clear();
    renderWithIntl(<StorageBuildingCatalogue />, {
      locale: "en",
      workspace: false,
    });
    const only = () => {
      const actions = screen.getAllByRole("link", { name: "New building" });
      expect(actions).toHaveLength(1);
      expect(actions[0]).toHaveAttribute(
        "href",
        "/master-data/storage-layouts/new",
      );
      expect(actions[0]).toHaveTextContent(/^Building$/);
      return actions[0]!;
    };
    expect(
      screen
        .getByRole("textbox", { name: "Search buildings" })
        .closest("label")!.nextElementSibling,
    ).toBe(only());
    fireEvent.click(screen.getByRole("button", { name: "All locations" }));
    expect(
      screen.getByRole("textbox", { name: "Search locations" })
        .nextElementSibling,
    ).toBe(only());
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
  it("opens persisted inventory and aisles directly, updates live data, and switches floors", async () => {
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
    expect(floorButton(2)).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Building floors" }));
    expect(
      screen.getByRole("region", { name: "Interactive floor map" }),
    ).toBeVisible();
    expect(
      container.querySelector("[data-unavailable-area] title"),
    ).toHaveTextContent("Saved walkway");
    fireEvent.click(
      screen.getByRole("button", { name: "Select location Occupied FG" }),
    );
    const details = screen.getByRole("complementary", {
      name: "Selected location",
    });
    // The hosted inspector has one heading and one closing action.
    expect(
      within(details).getAllByRole("heading", { name: "Location details" }),
    ).toHaveLength(1);
    expect(within(details).queryByText("Selected location")).toBeNull();
    expect(
      within(details).queryByRole("button", { name: "Clear selection" }),
    ).toBeNull();
    expect(
      within(details).getAllByRole("button", { name: "Hide details" }),
    ).toHaveLength(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      within(details).getByRole("link", { name: "Open pallet P-005" }),
    ).toHaveAttribute("href", "/finished-goods/pallets/held-pallet");
    fireEvent.click(
      within(details).getByRole("button", { name: "Edit Occupied FG" }),
    );
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Close dialog",
      }),
    );
    // Closing consumes the editor's own history entry before other actions.
    await waitFor(() => expect(window.location.search).not.toMatch(/overlay/));
    fireEvent.click(
      within(
        screen.getByRole("complementary", { name: "Selected location" }),
      ).getByRole("button", { name: "Hide details" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("complementary", { name: "Selected location" }),
    ).not.toBeInTheDocument();
    // Hiding keeps the selection, so the details can be reopened.
    fireEvent.click(screen.getByRole("button", { name: /Location details$/ }));
    expect(
      screen.getByRole("complementary", { name: "Selected location" }),
    ).toBeVisible();
    expect(window.location.search).not.toContain("editZone");
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
    fireEvent.click(floorButton(1));
    await waitFor(() =>
      expect(floorButton(1)).toHaveAttribute("aria-pressed", "true"),
    );
    expect(screen.queryByText("Saved walkway")).not.toBeInTheDocument();
    expect(
      within(
        screen.getByRole("region", { name: "Interactive floor map" }),
      ).getByText("No storage locations yet"),
    ).toBeVisible();
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
  it("shares table selection with the map and renders only selected management details", () => {
    const zone = occupiedTestZone();
    renderWithIntl(
      <BuildingModelWorkspace
        building={building}
        floors={floors.map((floor) =>
          floor.floorNumber === 2 ? { ...floor, storageZones: [zone] } : floor,
        )}
      />,
      { locale: "en", workspace: false },
    );
    fireEvent.click(screen.getByRole("button", { name: "Table view" }));
    const table = screen.getByRole("table");
    expect(
      screen.queryByRole("article", { name: `${zone.label} · ${zone.code}` }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      within(table).getByRole("button", {
        name: `Select location ${zone.code} · ${zone.label}`,
      }),
    );
    expect(
      screen.getByRole("article", { name: `${zone.label} · ${zone.code}` }),
    ).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const drawer = document.querySelector<HTMLElement>(
      "[data-inline-location-details]",
    )!;
    fireEvent.click(
      within(drawer).getByRole("button", { name: "Clear selection" }),
    );
    expect(
      document.getElementById("storage-stacks-section"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("article", { name: `${zone.label} · ${zone.code}` }),
    ).not.toBeInTheDocument();
  });
  it("opens the existing create editor from the compact location toolbar", async () => {
    renderWithIntl(
      <BuildingModelWorkspace building={building} floors={floors} />,
      { locale: "en", workspace: false },
    );
    expect(
      document.getElementById("storage-stacks-section"),
    ).not.toBeInTheDocument();
    // The add action is a direct toolbar control, not a nested overflow menu.
    expect(
      screen.queryByRole("button", { name: "More actions" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "Display options" }),
    ).toHaveLength(1);
    // Viewing is read-only; the add action belongs to the editing task.
    expect(
      screen.queryByRole("button", { name: "Add storage spot" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Edit floor \d$/ }));
    const add = await screen.findByRole("button", { name: "Add storage spot" });
    expect(add).toHaveAttribute("type", "button");
    expect(add).toBeEnabled();
    fireEvent.click(add);
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByLabelText("Name")).toBeVisible();
    expect(mutation).not.toHaveBeenCalled();
  });
  it("puts the one building edit pen after the name and before the code", () => {
    renderWithIntl(
      <BuildingModelWorkspace
        building={building}
        floors={floors}
        settingsAction={
          <BuildingSettingsDialog
            warehouseId="warehouse-a"
            building={building}
          />
        }
      />,
      { locale: "en", workspace: false },
    );
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveAccessibleName(building.name);
    const edits = screen.getAllByRole("button", {
      name: "Edit building settings",
    });
    expect(edits).toHaveLength(1);
    expect(heading).not.toContainElement(edits[0]!);
    expect(heading.nextElementSibling).toBe(edits[0]);
    expect(edits[0]!.nextElementSibling).toHaveTextContent(building.code);
    fireEvent.click(edits[0]!);
    expect(
      screen.getByRole("dialog", { name: "Building dimensions" }),
    ).toBeVisible();
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

  it.each([
    [
      "en",
      "Select location FG-2",
      "Selected location",
      "No stored or reserved units yet",
      "Floor 2",
    ],
    [
      "th",
      "เลือกจุดจัดเก็บ FG-2",
      "จุดจัดเก็บที่เลือก",
      "ยังไม่มีหน่วยที่จัดเก็บหรือจอง",
      "ชั้น 2",
    ],
  ] as const)(
    "states an empty location and its identity once in the %s desktop inspector",
    (locale, select, region, empty, floor) => {
      // Imported records often use the code as their name.
      const zone = {
        ...occupiedTestZone(),
        zoneId: "empty-zone",
        code: "FG-2",
        label: "FG-2",
        placements: [],
      };
      renderWithIntl(
        <BuildingModelWorkspace
          building={building}
          floors={floors.map((row) =>
            row.floorNumber === 2 ? { ...row, storageZones: [zone] } : row,
          )}
        />,
        { locale, workspace: false },
      );
      fireEvent.click(screen.getByRole("button", { name: select }));
      const details = screen.getByRole("complementary", { name: region });
      expect(within(details).getAllByText(empty)).toHaveLength(1);
      expect(within(details).getAllByText("FG-2")).toHaveLength(1);
      expect(within(details).getByText(floor)).toBeVisible();
      // The article keeps its full accessible identity.
      expect(
        within(details).getByRole("article", { name: "FG-2 · FG-2" }),
      ).toBeInTheDocument();
    },
  );

  it("consolidates floor dimensions and edits the selected floor in place", () => {
    renderWithIntl(
      <BuildingModelWorkspace building={building} floors={floors} />,
      { locale: "en", workspace: false },
    );

    floorButton(1);
    expect(screen.getAllByRole("button", { name: /^Floor \d$/ })).toHaveLength(
      4,
    );
    expect(within(floorButton(2)).getByText("0 locations")).toBeInTheDocument();
    expect(within(floorButton(3)).getByText("0 locations")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Edit floor/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit floor 1" })).toBeVisible();

    fireEvent.click(floorButton(2));
    expect(floorButton(2)).toHaveAttribute("aria-pressed", "true");
  });
});

describe("unified floor editing", () => {
  function mount() {
    window.history.replaceState(
      {},
      "",
      "/master-data/storage-layouts/building-a?floor=2&editing=1",
    );
    return render(
      <BuildingModelWorkspace building={building} floors={floors} />,
      {
        wrapper: ({ children }) => (
          <NextIntlClientProvider
            locale="en"
            messages={messagesFor("en")}
            timeZone="Asia/Bangkok"
          >
            <NavigationGuardProvider>{children}</NavigationGuardProvider>
          </NextIntlClientProvider>
        ),
      },
    );
  }
  it("protects a draft when switching floors and discards only explicitly", async () => {
    mount();
    expect(
      screen.getAllByRole("region", { name: "Interactive floor map" }),
    ).toHaveLength(1);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Width (m)" }), {
      target: { value: "22" },
    });
    fireEvent.click(floorButton(1));
    expect(
      screen.getByRole("dialog", { name: "Save changes before leaving?" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByRole("spinbutton", { name: "Width (m)" })).toHaveValue(
      22,
    );
    fireEvent.click(floorButton(1));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    await waitFor(() =>
      expect(floorButton(1)).toHaveAttribute("aria-pressed", "true"),
    );
    expect(mutation).not.toHaveBeenCalled();
  });
  it("retains a draft after a failed save-and-switch", async () => {
    mutation.mockRejectedValue(new Error("offline"));
    mount();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Width (m)" }), {
      target: { value: "22" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Building model" }));
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    await screen.findByText(
      "Could not save. Your changes are still here. Review them and try again.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByRole("spinbutton", { name: "Width (m)" })).toHaveValue(
      22,
    );
    expect(screen.getByRole("button", { name: "Storage map" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
  it("retains the original version and draft when a concurrent update arrives", async () => {
    const view = mount();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Width (m)" }), {
      target: { value: "22" },
    });
    view.rerender(
      <BuildingModelWorkspace
        building={building}
        floors={floors.map((floor) =>
          floor.floorNumber === 2
            ? { ...floor, widthMm: 23000, version: 3 }
            : floor,
        )}
      />,
    );
    expect(screen.getByRole("spinbutton", { name: "Width (m)" })).toHaveValue(
      22,
    );
    mutation.mockResolvedValue({
      ok: true,
      value: { written: false, error: { code: "VERSION_CONFLICT" } },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Save floor",
      }),
    );
    await waitFor(() =>
      expect(mutation).toHaveBeenCalledWith(
        expect.objectContaining({ expectedFloorVersion: 2 }),
      ),
    );
    expect(screen.getByRole("spinbutton", { name: "Width (m)" })).toHaveValue(
      22,
    );
  });
  it("keeps archived layouts read-only even with an editing URL", () => {
    window.history.replaceState({}, "", "/?floor=2&editing=1");
    renderWithIntl(
      <BuildingModelWorkspace
        building={{ ...building, status: "ARCHIVED" }}
        floors={floors}
      />,
      { locale: "en", workspace: false },
    );
    expect(
      screen.queryByRole("button", { name: "Close floor editing" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("spinbutton", { name: "Width (m)" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add storage spot" }),
    ).not.toBeInTheDocument();
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

/** FloorPlan's offset editor is caller-owned; tests hold the open state. */
function OffsetFloorPlan(props: ComponentProps<typeof FloorPlan>) {
  const [open, setOpen] = useState(false);
  return (
    <FloorPlan
      {...props}
      offsetEditing={open}
      onOffsetEditingChange={setOpen}
    />
  );
}

describe("FloorPlan", () => {
  it("positions the floor on its previous floor and supports keyboard movement", () => {
    const onPlacementChange = vi.fn();
    renderWithIntl(
      <OffsetFloorPlan
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
    expect(
      screen.getByText("Lift core", { selector: "text" }),
    ).toBeInTheDocument();
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
      .getByRole("group", { name: "Live 3D position" })
      .querySelector('[data-zone-face="top"]')
      ?.getAttribute("points");

    expect(screen.getByText("Fits within floor")).toBeInTheDocument();
    fireEvent.keyDown(
      screen.getByRole("button", { name: "Drag storage spot" }),
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
      screen.getByRole("button", { name: "Drag storage spot" }),
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
      .getByRole("group", { name: "Live 3D position" })
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
      screen.getByRole("group", { name: "Live 3D reserved area" }),
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
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue(
      "Lift core",
    );
    expect(
      screen.getByRole("spinbutton", { name: "X position (m)" }),
    ).toHaveValue(2);
    expect(
      screen.getByRole("button", { name: "Apply to floor draft" }),
    ).toBeVisible();
  });
});

describe("Unavailable area color saving", () => {
  it.each([false, true])(
    "saves a color-only edit without changing geometry (occupied: %s)",
    async (occupied) => {
      // Imported plans carry a type and display height without an input; a
      // colour edit must keep both so it stays a colour-only change (F03).
      const block = {
        blockId: "lift",
        label: "Lift core",
        areaKind: "STAIRS" as const,
        displayHeightMm: 2_500,
        xMm: 22000,
        yMm: 16000,
        widthMm: 1000,
        depthMm: 1000,
      };
      layoutAccess.query.mockReturnValue({
        ok: true,
        value: {
          found: true,
          building: { ...building, status: "ACTIVE" },
          floors: [
            {
              ...floors[1],
              reservedBlocks: [block],
              storageZones: occupied ? [occupiedTestZone()] : [],
            },
          ],
        },
      });
      renderWithIntl(
        <StorageFloorEditor buildingId="building-a" floorNumber={2} />,
        { locale: "en", workspace: false },
      );
      expect(
        screen.getByRole("button", { name: "Floor saved" }),
      ).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: "Edit Lift core" }));
      fireEvent.click(screen.getByRole("button", { name: "Office" }));
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      // Cancel consumes the dialog's own entry before the next edit opens.
      await waitFor(() =>
        expect(window.location.search).not.toMatch(/overlay/),
      );
      expect(
        screen.getByRole("button", { name: "Floor saved" }),
      ).toBeDisabled();
      expect(mutation).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Edit Lift core" }));
      expect(screen.getByRole("button", { name: "Default" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      fireEvent.click(screen.getByRole("button", { name: "Office" }));
      expect(screen.getByText("Display height 2.5 m is kept.")).toBeVisible();
      fireEvent.click(
        screen.getByRole("button", { name: "Apply to floor draft" }),
      );
      // The area dialog closes after its applied draft settles.
      const save = await screen.findByRole("button", {
        name: "Save floor",
      });
      expect(save).toBeEnabled();
      fireEvent.click(save);
      await waitFor(() => expect(mutation).toHaveBeenCalledOnce());
      expect(mutation).toHaveBeenCalledWith(
        expect.objectContaining({
          floor: expect.objectContaining({
            reservedBlocks: [
              {
                id: "lift",
                label: "Lift core",
                areaKind: "STAIRS",
                displayHeightMm: 2_500,
                color: "#145CA1",
                xMm: 22000,
                yMm: 16000,
                widthMm: 1000,
                depthMm: 1000,
              },
            ],
          }),
        }),
      );
    },
  );
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
        screen.getByRole("button", { name: "Add storage spot" }),
      ).toBeDisabled();
      expect(
        screen.getByRole("button", { name: `Archive spot · ${zone.code}` }),
      ).toBeDisabled();
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
    expect(screen.getByRole("button", { name: "Floor saved" })).toBeDisabled();
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
      screen.getByRole("button", { name: "Add storage spot" }),
    ).toBeDisabled();
    expect(
      screen.getByText("Save the floor draft before editing storage spots"),
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
      screen.getByRole("button", { name: "Add storage spot" }).parentElement,
    ).toHaveClass("grid-cols-[minmax(0,1fr)_auto]");

    fireEvent.click(
      screen.getByRole("button", { name: "Edit QA Finished Goods Stack" }),
    );

    expect(
      screen.getByRole("dialog", { name: "Edit storage spot" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue(
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

  it("reports each stack write through one shared outcome: refusal keeps the editor, success names create or update", async () => {
    const zone: StorageZoneRow = {
      zoneId: "zone-a",
      locationId: "location-a",
      code: "BLDG-A-F04-Z01",
      label: "QA Finished Goods Stack",
      qrValue: "ISAS:LOCATION:1:location-a",
      revision: "1:100",
      xMm: 3_500,
      yMm: 1_100,
      widthMm: 2_000,
      depthMm: 2_000,
      maxStackHeightMm: 3_000,
      mode: "SIMPLE",
      positions: [],
      placements: [],
    };
    const panel = (zones: readonly StorageZoneRow[]) => (
      <StorageZonesPanel
        warehouseId="warehouse-a"
        buildingId="building-a"
        floorNumber={4}
        floorWidthMm={10_000}
        floorDepthMm={10_000}
        floorHeightMm={3_000}
        zones={zones}
      />
    );
    const view = renderWithIntl(panel([zone]), {
      locale: "en",
      workspace: false,
      preserveProviders: true,
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Edit QA Finished Goods Stack" }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "My rename" },
    });
    mutation.mockResolvedValueOnce({
      ok: true,
      value: { written: false, error: { code: "VERSION_CONFLICT" } },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(mutation).toHaveBeenCalledOnce());
    expect(mutation.mock.calls[0]?.[0]).toMatchObject({
      zoneId: "zone-a",
      expectedRevision: "1:100",
    });
    expect(mutation.mock.calls[0]?.[0]).not.toHaveProperty(
      "confirmOccupiedChange",
    );
    // A stale draft is kept, never silently overwritten or discarded (F19).
    expect(
      await screen.findByTestId("zone-version-conflict"),
    ).toHaveTextContent("Another manager changed this spot");
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue(
      "My rename",
    );
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    view.rerender(
      panel([{ ...zone, label: "Their rename", revision: "2:200" }]),
    );
    fireEvent.click(screen.getByRole("button", { name: "Keep my draft" }));
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue(
      "My rename",
    );
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(mutation).toHaveBeenCalledTimes(2));
    expect(mutation.mock.calls[1]?.[0]).toMatchObject({
      label: "My rename",
      expectedRevision: "2:200",
    });
    // The editor closes once the write and its draft have settled.
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(
      screen.getByText(
        "Storage spot saved. Its code and QR label are unchanged.",
      ),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Add storage spot" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Create storage spot" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(
      screen.getByText(
        "Storage spot created. Its code and QR label are ready.",
      ),
    ).toBeVisible();
    const created = mutation.mock.calls.at(-1)?.[0];
    expect(created).toMatchObject({ buildingId: "building-a", floorNumber: 4 });
    expect(created).not.toHaveProperty("zoneId");
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
      screen.getByRole("button", { name: "Add storage spot" }),
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
    <OffsetFloorPlan
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
  fireEvent.change(screen.getByRole("spinbutton", { name: "Width (m)" }), {
    target: { value: "3" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Review impact" }));
  // A stop with recovery, not a disabled Confirm that implies an override.
  const stop = screen.getByTestId("layout-blocked-impact");
  expect(stop).toHaveTextContent("Can't save while stock is here");
  expect(
    within(stop).getByRole("link", { name: "Open P-005 to move or release" }),
  ).toHaveAttribute("href", "/finished-goods/pallets/held-pallet");
  expect(
    screen.queryByRole("button", { name: "Confirm changes" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Save changes" }),
  ).not.toBeInTheDocument();
  expect(mutation).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Back to edit" }));
  // Back to edit consumes the review step and returns to the same draft.
  expect(
    await screen.findByRole("button", { name: "Review impact" }),
  ).toBeVisible();
  expect(screen.getByRole("spinbutton", { name: "Width (m)" })).toHaveValue(3);
  expect(window.location.search).not.toContain("zoneImpact");
  fireEvent.change(screen.getByRole("spinbutton", { name: "Width (m)" }), {
    target: { value: "4" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
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
  fireEvent.change(screen.getByRole("spinbutton", { name: "Width (m)" }), {
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

it("allows widening an occupied building but blocks changing its floor height", async () => {
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
  fireEvent.click(screen.getByRole("button", { name: "Save building" }));
  expect(mutation).toHaveBeenCalledWith(
    expect.objectContaining({
      widthMm: 31_000,
      depthMm: 20_000,
      defaultFloorHeightMm: 4_000,
    }),
  );
  expect(await screen.findByText("Building saved.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Save building" })).toBeDisabled();

  mutation.mockClear();
  fireEvent.change(
    screen.getByRole("spinbutton", { name: "Floor height (m)" }),
    { target: { value: "5" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Review impact" }));
  expect(screen.getByTestId("layout-blocked-impact")).toHaveTextContent(
    "Units without measurements",
  );
  expect(
    screen.queryByRole("button", { name: "Confirm changes" }),
  ).not.toBeInTheDocument();
  expect(mutation).not.toHaveBeenCalled();
});

describe("searchable storage spots", () => {
  it("lists location-only units without showing an empty location or geometric footprint", () => {
    const zone = {
      ...occupiedTestZone(),
      placements: [],
      palletCount: 1,
      unmeasuredPalletCount: 1,
      measuredAreaPartial: true,
      locationOnlyPlacements: [
        {
          mode: "LOCATION_ONLY" as const,
          placementId: "location-placement",
          handlingUnitId: "scan-pallet",
          lpn: "SCAN-001",
          assignmentId: "assignment-a",
          sequence: 1,
          positionCode: "LOC-1",
          status: "STORED" as const,
        },
      ],
    };
    show([zone]);
    expect(screen.getByRole("link", { name: "SCAN-001" })).toHaveAttribute(
      "href",
      "/finished-goods/pallets/scan-pallet",
    );
    expect(screen.getByText(/Coordinates unmeasured/)).toBeVisible();
    expect(
      screen.queryByText("No pallets at this spot"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Move pallet/ }),
    ).not.toBeInTheDocument();
  });

  function show(
    zones: StorageZoneRow[],
    locale: "en" | "th" = "en",
    compact = false,
  ) {
    return renderWithIntl(
      <StorageZonesPanel
        compact={compact}
        selectedZoneId={zones[0]?.zoneId}
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
      screen.getByRole("button", { name: "Add storage spot" }),
    ).toBeEnabled();
  });
  it("keeps the zone QR scannable in compact details without child positions", async () => {
    const zone = { ...occupiedTestZone(), positions: [] };
    show([zone], "en", true);
    fireEvent.click(screen.getByText("QR labels (1)"));
    await waitFor(() =>
      expect(
        screen.getByRole("img", { name: `QR code for ${zone.code}` }),
      ).toBeVisible(),
    );
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
    const details = screen.getByRole("article").querySelectorAll("details")[1];
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
  it("uses the shared live renderer for FG1 with one view toggle and the real inspector", () => {
    const select = vi.fn();
    const zones = [
      ...Array.from(
        { length: 5 },
        (_, i) => `FG1-L${String(i + 1).padStart(2, "0")}`,
      ),
      ...Array.from(
        { length: 10 },
        (_, i) => `FG1-R${String(i + 1).padStart(2, "0")}`,
      ),
    ].map((code) => ({
      ...occupiedTestZone(),
      zoneId: code,
      code,
      label: code,
      placements: [],
    }));
    const { container } = renderWithIntl(
      <FloorPlan
        {...props()}
        floorNumber={1}
        zones={zones}
        onSelectionChange={select}
        locationInspector={<p>Live location inspector</p>}
      />,
      { locale: "en", workspace: false },
    );
    expect(container.querySelectorAll("[data-reference-zone]")).toHaveLength(0);
    expect(container.querySelectorAll("[data-map-zone-id]")).toHaveLength(15);
    expect(screen.getAllByRole("button", { name: "2D plan" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "3D view" })).toHaveLength(1);
    fireEvent.click(
      screen.getByRole("button", {
        name: /^Select location FG1-L01$/,
      }),
    );
    expect(select).toHaveBeenCalledWith("FG1-L01");
    expect(screen.getByText("Live location inspector")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "3D view" }));
    expect(screen.getAllByRole("button", { name: "3D view" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "3D view" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
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
    fireEvent.click(screen.getByRole("button", { name: "3D view" }));
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
    fireEvent.click(screen.getByRole("button", { name: "3D view" }));
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
    expect(
      screen.queryByRole("complementary", { name: "Selected location" }),
    ).not.toBeInTheDocument();
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
      name: "Search storage locations",
    });
    fireEvent.change(input, { target: { value: "p-005" } });
    fireEvent.click(screen.getByRole("button", { name: "Split view" }));
    fireEvent.click(
      within(screen.getByRole("table")).getByRole("button", {
        name: /Select location/,
      }),
    );
    expect(
      screen.getByRole("link", { name: "Open pallet P-005" }),
    ).toBeVisible();
    expect(container.querySelectorAll("[data-zone-id]")).toHaveLength(2);
    expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(false);
    fireEvent.change(input, { target: { value: "unknown" } });
    expect(screen.getByText("No storage locations match")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(
      3,
    );
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
    fireEvent.click(screen.getByRole("button", { name: "3D view" }));
    const box = () => container.querySelector('[data-placement-id="held"]');
    expect(box()).toHaveAttribute("data-placement-x-mm", "700");
    expect(box()).toHaveAttribute("data-placement-z-mm", "1400");
    const before = box()?.querySelector("polygon")?.getAttribute("points");
    fireEvent.click(screen.getByRole("button", { name: "Display options" }));
    fireEvent.click(screen.getByRole("button", { name: "Rotate view" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Rotate view" }), {
      key: "Escape",
    });
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
      screen.getByRole("dialog", { name: "Edit storage spot" }),
    ).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue(
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
  fireEvent.click(screen.getByRole("button", { name: "3D view" }));
  expect(container.querySelectorAll("[data-placement-id]")).toHaveLength(62);
  expect(container.querySelectorAll("[data-unavailable-area]")).toHaveLength(3);
  fireEvent.click(
    screen.getByRole("button", {
      name: "All storage footprints full · 120 units",
    }),
  );
  expect(container.querySelectorAll("[data-placement-id]")).toHaveLength(120);
  fireEvent.click(screen.getByRole("button", { name: "2D plan" }));
  fireEvent.click(screen.getByRole("button", { name: "Display options" }));
  fireEvent.click(screen.getByRole("button", { name: "Show detailed labels" }));
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
  fireEvent.click(screen.getByRole("button", { name: "Table view" }));
  expect(container.querySelector('a[href*="/pallets/demo-"]')).toBeNull();
  fireEvent.change(
    screen.getByRole("searchbox", { name: "Search storage locations" }),
    { target: { value: "DEMO-P-030" } },
  );
  const row = within(screen.getByRole("table")).getByRole("button", {
    name: /Select location/,
  });
  expect(row).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(row);
  expect(container.querySelector("[data-inline-location-details]")).toBeNull();
  fireEvent.click(row);
  expect(
    within(
      container.querySelector<HTMLElement>("[data-inline-location-details]")!,
    ).getByText("DEMO-P-030"),
  ).toBeVisible();

  expect(mutation).not.toHaveBeenCalled();
});

describe("building creation execution", () => {
  it("preserves inputs and retry identity after a thrown response, then changes identity with the payload", async () => {
    mutation.mockRejectedValue(new Error("NETWORK_FAILURE"));
    const view = renderWithIntl(<NewStorageBuildingForm />, {
      locale: "en",
      workspace: false,
    });
    const form = view.container.querySelector("form")!;
    fireEvent.submit(form);
    await waitFor(() =>
      expect(screen.getByText(/NETWORK_FAILURE/)).toBeVisible(),
    );
    const first = mutation.mock.calls[0]![0];
    fireEvent.submit(form);
    await waitFor(() => expect(mutation).toHaveBeenCalledTimes(2));
    expect(mutation.mock.calls[1]![0].requestId).toBe(first.requestId);
    await waitFor(() =>
      expect(screen.getByText(/NETWORK_FAILURE/)).toBeVisible(),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Building code" }), {
      target: { value: "NEW-CODE" },
    });
    fireEvent.submit(form);
    await waitFor(() => expect(mutation).toHaveBeenCalledTimes(3));
    expect(mutation.mock.calls[2]![0].requestId).not.toBe(first.requestId);
    expect(navigate).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByText(/NETWORK_FAILURE/)).toBeVisible(),
    );
    mutation.mockResolvedValue({
      ok: true,
      value: { written: true, documentId: "new-building" },
    });
    fireEvent.submit(form);
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        "/master-data/storage-layouts/new-building",
      ),
    );
  });

  it("does not navigate when the create resolves after the form unmounts", async () => {
    let finish!: (value: unknown) => void;
    mutation.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const view = renderWithIntl(<NewStorageBuildingForm />, {
      locale: "en",
      workspace: false,
    });
    fireEvent.submit(view.container.querySelector("form")!);
    await waitFor(() => expect(mutation).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () =>
      finish({
        ok: true,
        value: { written: true, documentId: "late-building" },
      }),
    );
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("mobile storage workspace", () => {
  let mobile = true;
  let stopHistory = () => {};
  const listeners = new Set<EventListenerOrEventListenerObject>();
  beforeEach(() => {
    mobile = true;
    listeners.clear();
    const original = window.matchMedia;
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      ...original(query),
      matches:
        [
          "(max-width: 580px)",
          "(max-width: 850px)",
          "(max-width: 1099px)",
          "(max-width: 1399px)",
        ].includes(query) && mobile,
      addEventListener: (
        _type: string,
        listener: EventListenerOrEventListenerObject | null,
      ) => {
        if (typeof listener === "function") listeners.add(listener);
      },
      removeEventListener: (
        _type: string,
        listener: EventListenerOrEventListenerObject | null,
      ) => {
        if (typeof listener === "function") listeners.delete(listener);
      },
    }));
  });
  afterEach(() => {
    stopHistory();
    vi.restoreAllMocks();
  });
  function mount(zone = occupiedTestZone()) {
    const savedFloors = floors.map((floor) =>
      floor.floorNumber === 2 ? { ...floor, storageZones: [zone] } : floor,
    );
    return renderWithIntl(
      <NavigationGuardProvider>
        <BuildingModelWorkspace building={building} floors={savedFloors} />
      </NavigationGuardProvider>,
      {
        locale: "en",
        workspace: false,
        preserveProviders: true,
      },
    );
  }
  function selectMap() {
    const button = within(
      screen.getByRole("group", { name: "Interactive floor map" }),
    ).getByRole("button", { name: "Select location Occupied FG" });
    button.focus();
    fireEvent.click(button);
    return button;
  }
  function holdInspectorExitAnimation() {
    const computedStyle = window.getComputedStyle;
    // Browser computed styles stay live as Radix updates data-state.
    return vi
      .spyOn(window, "getComputedStyle")
      .mockImplementation((node, pseudo) => {
        const style = computedStyle(node, pseudo);
        if (node.getAttribute("data-slot") !== "sheet-content") return style;
        return new Proxy(style, {
          get(target, key) {
            if (key === "animationName")
              return node.getAttribute("data-state") === "closed"
                ? "inspector-exit"
                : "none";
            return Reflect.get(target, key);
          },
        });
      });
  }
  it("opens details only on interaction and keeps map selection, zoom and focus after Escape", async () => {
    mount();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    const map = screen.getByRole("group", { name: "Interactive floor map" });
    const opener = selectMap();
    const transform = map.querySelector("g")?.getAttribute("transform");
    expect(
      screen.getByRole("dialog", { name: "Location details" }),
    ).toBeVisible();
    const sheet = screen.getByRole("dialog", { name: "Location details" });
    // The sheet owns the only heading and close action; details stay intact.
    expect(within(sheet).queryByText("Selected location")).toBeNull();
    expect(
      within(sheet).queryByRole("button", { name: "Clear selection" }),
    ).toBeNull();
    expect(
      within(sheet).getAllByRole("button", { name: "Close dialog" }),
    ).toHaveLength(1);
    expect(
      within(sheet).getByRole("button", { name: "Edit Occupied FG" }),
    ).toBeEnabled();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(opener).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(opener).toHaveFocus());
    expect(map.querySelector("g")?.getAttribute("transform")).toBe(transform);
    expect(mutation).not.toHaveBeenCalled();
  });
  it("shares list selection and retains search through map/list switches", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Table view" }));
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "Occupied" },
    });
    const row = screen.getByRole("button", {
      name: /Select location .*Occupied FG/,
    });
    row.focus();
    fireEvent.click(row);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      document.querySelector("[data-inline-location-details]"),
    ).not.toBeNull();
    expect(row).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(row).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "Edit Occupied FG" }));
    await screen.findByRole("dialog", { name: "Edit storage spot" });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    // The closed editor's guard buffer is removed before the next step.
    await waitFor(() =>
      expect(window.history.state?.__storageWorkspaceGuard).toBeUndefined(),
    );
    expect(isGuardTraversal()).toBe(false);
    expect(row).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Show on map" }));
    expect(
      within(
        screen.getByRole("group", { name: "Interactive floor map" }),
      ).getByRole("button", { name: "Select location Occupied FG" }),
    ).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Table view" }));
    expect(screen.getByRole("searchbox")).toHaveValue("Occupied");
  });
  it("closes the sheet before opening the single existing editor and retains selection on cancel", async () => {
    mount();
    selectMap();
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Edit Occupied FG",
      }),
    );
    await screen.findByRole("dialog", { name: "Edit storage spot" });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(document.querySelector('[data-slot="sheet-overlay"]')).toBeNull();
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue(
      "Occupied FG",
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(
      within(
        screen.getByRole("group", { name: "Interactive floor map" }),
      ).getByRole("button", { name: "Select location Occupied FG" }),
    ).toHaveAttribute("aria-pressed", "true");
    // The closed editor's guard buffer is removed before the next step.
    await waitFor(() =>
      expect(window.history.state?.__storageWorkspaceGuard).toBeUndefined(),
    );
    expect(isGuardTraversal()).toBe(false);
    expect(new URLSearchParams(window.location.search).has("editZone")).toBe(
      false,
    );
    expect(mutation).not.toHaveBeenCalled();
  });
  it("waits for the mobile inspector's native Back before opening the zone editor and consumes Close before the next Back", async () => {
    window.history.replaceState(
      { appNavigationIndex: 0 },
      "",
      "/en/finished-goods?origin=1#source",
    );
    stopHistory = trackAppHistory();
    window.history.pushState(
      { appNavigationIndex: 1 },
      "",
      "/en/master-data/storage-layouts/building-a?floor=2&view=storage&kept=yes#map",
    );
    mount();
    selectMap();

    // A rendering frame is allowed to run before an asynchronous native Back.
    // Hold that traversal so the inspector-to-editor handoff cannot pass by luck.
    const nativeBack = window.history.back.bind(window.history);
    const back = vi
      .spyOn(window.history, "back")
      .mockImplementationOnce(() => {});
    const popped = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    fireEvent.click(
      within(
        screen.getByRole("dialog", { name: "Location details" }),
      ).getByRole("button", { name: "Edit Occupied FG" }),
    );
    // A second tap while native Back is pending must not lose the handoff.
    fireEvent.click(
      within(
        screen.getByRole("dialog", { name: "Location details" }),
      ).getByRole("button", { name: "Edit Occupied FG" }),
    );
    expect(back).toHaveBeenCalledOnce();
    try {
      await act(async () => {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
      });
      expect(
        screen.queryByRole("dialog", { name: "Edit storage spot" }),
      ).toBeNull();
      expect(window.location.search).not.toContain("editZone");
    } finally {
      await act(async () => {
        nativeBack();
        await popped;
      });
    }

    await screen.findByRole("dialog", { name: "Edit storage spot" });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(window.history.state.appNavigationIndex).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() =>
      expect(window.history.state.appNavigationIndex).toBe(1),
    );
    expect(window.location.search).not.toContain("editZone");
    expect(window.location.search).not.toContain("overlay");

    act(() => window.history.back());
    await waitFor(() =>
      expect(
        window.location.pathname +
          window.location.search +
          window.location.hash,
      ).toBe("/en/finished-goods?origin=1#source"),
    );
    expect(mutation).not.toHaveBeenCalled();
  });
  it("waits for the mobile inspector's exit animation before opening a single zone editor with focus", async () => {
    // Radix retains the closing sheet's focus scope until its animation ends.
    const styles = holdInspectorExitAnimation();
    try {
      mount();
      selectMap();
      const inspector = screen.getByRole("dialog", {
        name: "Location details",
      });
      const inspectorKey = [
        ...new URLSearchParams(window.location.search).keys(),
      ].find((key) => key.startsWith("overlay"))!;
      fireEvent.click(
        within(inspector).getByRole("button", { name: "Edit Occupied FG" }),
      );
      await waitFor(() =>
        expect(inspector).toHaveAttribute("data-state", "closed"),
      );
      await waitFor(() =>
        expect(
          new URLSearchParams(window.location.search).has(inspectorKey),
        ).toBe(false),
      );
      await act(async () => {
        await new Promise(requestAnimationFrame);
      });
      expect(
        screen.queryByRole("dialog", { name: "Edit storage spot" }),
      ).toBeNull();

      const end = new Event("animationend", { bubbles: true });
      Object.defineProperty(end, "animationName", { value: "inspector-exit" });
      fireEvent(inspector, end);
      const editor = await screen.findByRole("dialog", {
        name: "Edit storage spot",
      });
      await waitFor(() =>
        expect(editor.contains(document.activeElement)).toBe(true),
      );
      expect(inspector).not.toBeInTheDocument();
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
      expect(within(editor).getByRole("textbox", { name: "Name" })).toHaveValue(
        "Occupied FG",
      );
      expect(mutation).not.toHaveBeenCalled();
    } finally {
      cleanup();
      styles.mockRestore();
    }
  });
  it("does not replay a mobile inspector action after the workspace unmounts during its exit animation", async () => {
    const styles = holdInspectorExitAnimation();
    try {
      const view = mount();
      selectMap();
      const inspector = screen.getByRole("dialog", {
        name: "Location details",
      });
      const inspectorKey = [
        ...new URLSearchParams(window.location.search).keys(),
      ].find((key) => key.startsWith("overlay"))!;
      fireEvent.click(
        within(inspector).getByRole("button", { name: "Edit Occupied FG" }),
      );
      await waitFor(() =>
        expect(inspector).toHaveAttribute("data-state", "closed"),
      );
      await waitFor(() =>
        expect(
          new URLSearchParams(window.location.search).has(inspectorKey),
        ).toBe(false),
      );
      await act(async () => {
        await new Promise(requestAnimationFrame);
      });
      // A new route removes the still-animating workspace. Its later focus
      // cleanup must not run an action belonging to the removed inspector.
      await act(async () => {
        view.unmount();
        window.history.replaceState(
          {},
          "",
          "/en/finished-goods?origin=1#source",
        );
        await new Promise(requestAnimationFrame);
      });
      expect(
        window.location.pathname +
          window.location.search +
          window.location.hash,
      ).toBe("/en/finished-goods?origin=1#source");
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(mutation).not.toHaveBeenCalled();
    } finally {
      cleanup();
      styles.mockRestore();
    }
  });
  it("restores map focus after a refused inspector handoff is cancelled and the inspector is closed manually", async () => {
    function PendingWrite({ pending }: { pending: boolean }) {
      useNavigationDraft({ dirty: false, pending, discard: () => {} });
      return null;
    }
    const savedFloors = floors.map((floor) =>
      floor.floorNumber === 2
        ? { ...floor, storageZones: [occupiedTestZone()] }
        : floor,
    );
    const content = (pending: boolean) => (
      <NavigationGuardProvider>
        <PendingWrite pending={pending} />
        <BuildingModelWorkspace building={building} floors={savedFloors} />
      </NavigationGuardProvider>
    );
    const view = renderWithIntl(content(false), {
      locale: "en",
      workspace: false,
      preserveProviders: true,
    });
    const opener = selectMap();
    view.rerender(content(true));
    fireEvent.click(
      within(
        screen.getByRole("dialog", { name: "Location details" }),
      ).getByRole("button", { name: "Edit Occupied FG" }),
    );
    const prompt = await screen.findByRole("dialog", {
      name: "Save changes before leaving?",
    });
    expect(
      within(prompt).getByRole("button", { name: "Discard changes" }),
    ).toBeDisabled();
    fireEvent.click(
      within(prompt).getByRole("button", { name: "Keep editing" }),
    );
    expect(
      screen.queryByRole("dialog", { name: "Edit storage spot" }),
    ).toBeNull();

    // The background write settles; the user chooses an ordinary Close, not
    // the editor action they cancelled in the guard prompt.
    view.rerender(content(false));
    await waitFor(() => expect(isGuardTraversal()).toBe(false));
    await waitFor(() =>
      expect(window.history.state?.__storageWorkspaceGuard).toBeUndefined(),
    );
    fireEvent.click(
      within(
        screen.getByRole("dialog", { name: "Location details" }),
      ).getByRole("button", { name: "Close dialog" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(opener).toHaveFocus());
    expect(window.location.search).not.toContain("editZone");
    expect(mutation).not.toHaveBeenCalled();
  });
  it.each([
    ["Close dialog", false],
    ["Cancel", false],
    ["Close dialog", true],
    ["Cancel", true],
  ] as const)(
    "%s dismisses the mobile zone editor with the shell guard and consumes its entry before the next Back (dirty: %s)",
    async (closeLabel, dirty) => {
      window.history.replaceState(
        { appNavigationIndex: 0 },
        "",
        "/en/finished-goods?origin=1#source",
      );
      stopHistory = trackAppHistory();
      window.history.pushState(
        { appNavigationIndex: 1 },
        "",
        "/en/master-data/storage-layouts/building-a?floor=2&view=storage&kept=yes#map",
      );
      const zone = occupiedTestZone();
      const content = (key: number) => (
        <NavigationGuardProvider>
          <BuildingModelWorkspace
            key={key}
            building={building}
            floors={floors.map((floor) =>
              floor.floorNumber === 2
                ? { ...floor, storageZones: [zone] }
                : floor,
            )}
          />
        </NavigationGuardProvider>
      );
      const view = renderWithIntl(content(0), {
        locale: "en",
        workspace: false,
        preserveProviders: true,
      });
      selectMap();
      fireEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", {
          name: "Edit Occupied FG",
        }),
      );
      await screen.findByRole("dialog", { name: "Edit storage spot" });
      if (dirty)
        fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
          target: { value: "Unsent location" },
        });
      fireEvent.click(screen.getByRole("button", { name: closeLabel }));
      if (dirty) {
        fireEvent.click(
          await screen.findByRole("button", { name: "Keep editing" }),
        );
        expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue(
          "Unsent location",
        );
        fireEvent.click(screen.getByRole("button", { name: closeLabel }));
        fireEvent.click(
          await screen.findByRole("button", { name: "Discard changes" }),
        );
      }
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await waitFor(() => expect(isGuardTraversal()).toBe(false));
      await waitFor(() =>
        expect(
          [...new URLSearchParams(window.location.search).keys()].filter(
            (key) => key.startsWith("overlay"),
          ),
        ).toHaveLength(0),
      );
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(window.location.pathname).toBe(
        "/en/master-data/storage-layouts/building-a",
      );
      expect(new URLSearchParams(window.location.search).get("kept")).toBe(
        "yes",
      );
      expect(window.location.hash).toBe("#map");
      expect(window.location.search).not.toContain("editZone");
      expect(document.body.style.pointerEvents).not.toBe("none");
      // A refreshed/remounted caller must not replay the dismissed URL command.
      await act(async () => view.rerender(content(1)));
      expect(screen.queryByRole("dialog")).toBeNull();
      act(() => window.history.back());
      await waitFor(() =>
        expect(
          window.location.pathname +
            window.location.search +
            window.location.hash,
        ).toBe("/en/finished-goods?origin=1#source"),
      );
      expect(mutation).not.toHaveBeenCalled();
    },
  );
  it("closes a directly linked mobile zone editor through native Back and restores it on Forward", async () => {
    const zone = occupiedTestZone();
    window.history.replaceState(
      { appNavigationIndex: 0 },
      "",
      "/th/master-data/storage-layouts/building-a?floor=2&view=storage&kept=yes&editZone=blocked-zone#map",
    );
    mount(zone);
    await screen.findByRole("dialog", { name: "Edit storage spot" });
    act(() => window.history.back());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() =>
      expect(window.location.search).not.toContain("editZone"),
    );
    expect(window.location.pathname).toBe(
      "/th/master-data/storage-layouts/building-a",
    );
    expect(window.location.hash).toBe("#map");
    act(() => window.history.forward());
    await screen.findByRole("dialog", { name: "Edit storage spot" });
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue(
      zone.label,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() =>
      expect(window.location.search).not.toContain("editZone"),
    );
    expect(mutation).not.toHaveBeenCalled();
  });
  it("blocks mobile zone Close and native Back while a write is pending, then permits guarded closure", async () => {
    let failWrite: () => void = () => {};
    mutation.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          failWrite = () => reject(new Error("NETWORK_ERROR"));
        }),
    );
    mount();
    selectMap();
    fireEvent.click(screen.getByRole("button", { name: "Edit Occupied FG" }));
    await screen.findByRole("dialog", { name: "Edit storage spot" });
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "Pending location" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByRole("button", { name: "Updating…" });
    const pendingQuery = window.location.search;
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(
      screen.getByRole("dialog", { name: "Edit storage spot" }),
    ).toBeVisible();
    await act(async () => {
      window.history.back();
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    await waitFor(() => expect(window.location.search).toBe(pendingQuery));
    expect(
      screen.getByRole("dialog", { name: "Edit storage spot" }),
    ).toBeVisible();
    await act(async () => failWrite());
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Updating…" })).toBeNull(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Discard changes" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() =>
      expect(window.location.search).not.toContain("editZone"),
    );
    expect(mutation).toHaveBeenCalledOnce();
  });
  it("restores URL selection as summary and resets its scope when changing floors", async () => {
    const zone = occupiedTestZone();
    window.history.replaceState(
      {},
      "",
      `/?floor=2#storage-zone-${zone.zoneId}`,
    );
    mount(zone);
    await waitFor(() =>
      expect(
        within(
          screen.getByRole("group", { name: "Interactive floor map" }),
        ).getByRole("button", { name: "Select location Occupied FG" }),
      ).toHaveAttribute("aria-pressed", "true"),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    selectMap();
    // The floor selector is outside the trapped sheet; change through URL as a live navigation would.
    window.history.replaceState({}, "", "/?floor=1");
    // Use the actual query event exported by the workspace controller.
    const { workspaceStateEvent } = await import("./useWorkspaceQuery");
    fireEvent(window, new Event(workspaceStateEvent));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(floorButton(1)).toHaveAttribute("aria-pressed", "true");
  });
  it("dismisses removed locations on refresh and releases the sheet on desktop resize", async () => {
    const view = mount();
    selectMap();
    const { act } = await import("@testing-library/react");
    act(() => {
      mobile = false;
      listeners.forEach((listener) =>
        typeof listener === "function"
          ? listener(new Event("change"))
          : listener.handleEvent(new Event("change")),
      );
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(document.body.style.pointerEvents).not.toBe("none");
    expect(screen.getByRole("article", { name: /Occupied FG/ })).toBeVisible();
    act(() => {
      mobile = true;
      listeners.forEach((listener) =>
        typeof listener === "function"
          ? listener(new Event("change"))
          : listener.handleEvent(new Event("change")),
      );
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    selectMap();
    view.rerender(
      <BuildingModelWorkspace building={building} floors={floors} />,
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(document.body.style.pointerEvents).not.toBe("none");
  });
  it.each([
    ["en", "Select location Occupied FG", "Location details", "Floor 2"],
    ["th", "เลือกจุดจัดเก็บ Occupied FG", "รายละเอียดจุดจัดเก็บ", "ชั้น 2"],
  ] as const)(
    "shows the selected location code and floor once in the %s mobile sheet",
    (locale, select, title, floor) => {
      const savedFloors = floors.map((row) =>
        row.floorNumber === 2
          ? { ...row, storageZones: [occupiedTestZone()] }
          : row,
      );
      renderWithIntl(
        <NavigationGuardProvider>
          <BuildingModelWorkspace building={building} floors={savedFloors} />
        </NavigationGuardProvider>,
        { locale, workspace: false, preserveProviders: true },
      );
      fireEvent.click(
        within(
          screen.getByRole("group", {
            name:
              locale === "th" ? "แผนผังชั้นแบบโต้ตอบ" : "Interactive floor map",
          }),
        ).getByRole("button", { name: select }),
      );
      const sheet = screen.getByRole("dialog", { name: title });
      // The accessible description still names the location and floor.
      expect(sheet).toHaveAccessibleDescription(`FG-1 · ${floor}`);
      // Visible text nodes naming the code or floor (not the QR image title).
      const visible = (text: string) =>
        within(sheet).queryAllByText((_, node) =>
          Boolean(
            node &&
            node.tagName !== "title" &&
            !node.closest(".sr-only") &&
            [...node.childNodes].some(
              (child) =>
                child.nodeType === Node.TEXT_NODE &&
                child.textContent?.includes(text),
            ),
          ),
        );
      expect(visible("FG-1")).toHaveLength(1);
      expect(visible(floor)).toHaveLength(1);
      expect(within(sheet).getByText(`Occupied FG · ${floor}`)).toBeVisible();
    },
  );
});

describe("building lifecycle capacity feedback", () => {
  it.each(["en", "th"] as const)(
    "blocks archive and identifies partial counts in %s",
    (locale) => {
      layoutAccess.activate = true;
      layoutAccess.query.mockReturnValue({
        ok: true,
        value: {
          found: true,
          version: 2,
          zoneCount: 18,
          positionCount: 1700,
          namedRegistrationCount: 0,
          complete: false,
          capacityExceeded: true,
          canArchive: false,
          occupied: false,
        },
      });
      renderWithIntl(
        <BuildingSettingsDialog
          warehouseId="warehouse-a"
          building={building}
        />,
        { locale, workspace: false },
      );
      fireEvent.click(
        screen.getByRole("button", {
          name:
            locale === "en" ? "Edit building settings" : "แก้ไขการตั้งค่าอาคาร",
        }),
      );
      const archiveLabel =
        locale === "en" ? "Archive building" : "เก็บถาวรอาคาร";
      fireEvent.click(screen.getByRole("button", { name: archiveLabel }));
      const dialog = screen.getByRole("dialog", {
        name:
          locale === "en"
            ? "Archive Main storage?"
            : "เก็บถาวร Main storage หรือไม่",
      });
      expect(dialog).toHaveTextContent(
        locale === "en"
          ? "This building has more storage areas and positions than can be checked safely at once."
          : "อาคารนี้มีพื้นที่และตำแหน่งจัดเก็บมากเกินกว่าจะตรวจสอบอย่างปลอดภัยในครั้งเดียว",
      );
      expect(within(dialog).getByTestId("lifecycle-impact")).toHaveTextContent(
        locale === "en"
          ? "Minimum counts; some addresses are not included."
          : "จำนวนขั้นต่ำ บางตำแหน่งยังไม่รวมอยู่ในยอดนี้",
      );
      const confirm = within(dialog).getByRole("button", {
        name: archiveLabel,
      });
      expect(confirm).toBeDisabled();
      fireEvent.click(confirm);
      expect(mutation).not.toHaveBeenCalled();
    },
  );
  it("shows a useful capacity explanation in the server readiness review", () => {
    layoutAccess.activate = true;
    layoutAccess.query.mockReturnValue({
      ok: true,
      value: {
        found: true,
        building,
        floors,
        version: building.version,
        ready: false,
        issues: [{ code: "LAYOUT_CAPACITY_LIMIT", blocking: true }],
      },
    });
    renderWithIntl(<StorageBuildingReview buildingId={building.buildingId} />, {
      locale: "en",
      workspace: false,
    });
    expect(
      screen.getByText(/This building has more storage areas and positions/),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Activate layout" }),
    ).toBeDisabled();
  });
});
