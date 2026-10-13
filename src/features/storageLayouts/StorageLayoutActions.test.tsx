import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as WorkspaceModule from "@/components/providers/WorkspaceProvider";

const mocks = vi.hoisted(() => ({
  mutations: new Map<string, ReturnType<typeof vi.fn>>(),
  queries: new Map<string, unknown>(),
  permissions: [
    "masterData.storageLayout.manage",
    "masterData.storageLayout.activate",
  ] as string[],
  replace: vi.fn(),
}));
const mutationFor = (name: string) => {
  let fn = mocks.mutations.get(name);
  if (!fn) {
    fn = vi.fn().mockResolvedValue({
      ok: true,
      value: { written: true, documentId: "doc", replayed: false },
    });
    mocks.mutations.set(name, fn);
  }
  return fn;
};
vi.mock("convex/react", () => ({
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) =>
    mutationFor(getFunctionName(ref)),
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) =>
    args === "skip" ? undefined : mocks.queries.get(getFunctionName(ref)),
}));
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ userId: "user-a", orgId: "org-a" }),
}));
vi.mock("@/components/providers/WorkspaceProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof WorkspaceModule>()),
  useWorkspace: () => ({
    permissionsReady: true,
    navigationPermissions: mocks.permissions,
    warehouses: [{ id: "warehouse-a", code: "TG", name: "TG-OPT" }],
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
  useRouter: () => ({ push: vi.fn(), replace: mocks.replace }),
}));

import { renderWithIntl } from "@tests/fixtures/intl-render";
import { trackAppHistory } from "@/lib/browser/appHistory";
import type {
  StorageBuildingRow,
  StorageZoneRow,
} from "@/lib/convex/storageLayoutApi";
import { NewBuildingAction } from "./StorageLocationCatalogue";
import {
  BuildingSettingsDialog,
  NewStorageBuildingForm,
  StorageBuildingReview,
  StorageZonesPanel,
} from "./StorageLayoutScreens";
import { StoragePositionsDialog } from "./StoragePositionsDialog";
import { CompleteNamedLayoutDialog } from "./CompleteNamedLayoutDialog";

const MANAGE = "masterData.storageLayout.manage";
const ACTIVATE = "masterData.storageLayout.activate";
let stopHistory: (() => void) | undefined;
beforeEach(() => {
  window.history.replaceState({}, "", "/");
  mocks.mutations.clear();
  mocks.queries.clear();
  mocks.permissions = [MANAGE, ACTIVATE];
  mocks.replace.mockReset();
});
afterEach(() => {
  cleanup();
  stopHistory?.();
  stopHistory = undefined;
});

/** PD as surveyed: 11.96 m deep, which the old 0.1 m step rejected. */
const pd: StorageBuildingRow = {
  buildingId: "pd",
  warehouseId: "warehouse-a",
  code: "PD",
  name: "PD",
  widthMm: 20_000,
  depthMm: 11_960,
  defaultFloorHeightMm: 4_000,
  floorCount: 2,
  totalHeightMm: 8_000,
  grossAreaSqMm: 1,
  reservedAreaSqMm: 0,
  usableAreaSqMm: 1,
  status: "DRAFT",
  version: 5,
};
const openSettings = (building = pd) => {
  const view = renderWithIntl(
    <BuildingSettingsDialog warehouseId="warehouse-a" building={building} />,
    { locale: "en", workspace: false },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Edit building settings" }),
  );
  return view;
};

describe("building settings precision and independent drafts", () => {
  it("saves a rename of PD 11.96 m without rounding its survey geometry", async () => {
    openSettings();
    const depth = screen.getByRole("spinbutton", {
      name: "Depth (m)",
    }) as HTMLInputElement;
    expect(depth).toHaveValue(11.96);
    expect(depth.checkValidity()).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: "Building name" }), {
      target: { value: "PD packing" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save building" }));
    await waitFor(() =>
      expect(
        mutationFor("storageLayouts/writes:updateStorageBuilding"),
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "PD packing",
          widthMm: 20_000,
          depthMm: 11_960,
          defaultFloorHeightMm: 4_000,
          expectedVersion: 5,
        }),
      ),
    );
  });

  it("accepts millimetres, rejects sub-millimetre values and nudges by 0.1 m", () => {
    openSettings();
    const depth = screen.getByRole("spinbutton", {
      name: "Depth (m)",
    }) as HTMLInputElement;
    fireEvent.change(depth, { target: { value: "11.9605" } });
    expect(depth.checkValidity()).toBe(false);
    expect(depth.validationMessage).toBe(
      "Enter metres with up to 3 decimal places (1 mm).",
    );
    fireEvent.change(depth, { target: { value: "11.961" } });
    expect(depth.checkValidity()).toBe(true);
    fireEvent.keyDown(depth, { key: "ArrowUp" });
    expect(depth).toHaveValue(12.061);
  });

  it("keeps the dimensions draft protected after floors are added and previews the new total", async () => {
    openSettings();
    fireEvent.change(screen.getByRole("textbox", { name: "Building name" }), {
      target: { value: "Unsaved name" },
    });
    const total = screen.getByRole("spinbutton", { name: "New total floors" });
    fireEvent.change(total, { target: { value: "4" } });
    expect(
      screen.getByText(
        "2 → 4: adds 2 floors (3–4), inheriting floor 2 dimensions (20 × 11.96 m).",
      ),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Add floors" }));
    expect(
      await screen.findByText("Floors added: the building now has 4 floors."),
    ).toBeVisible();
    expect(
      mutationFor("storageLayouts/writes:changeStorageFloorCount"),
    ).toHaveBeenCalledWith(expect.objectContaining({ floorCount: 4 }));
    // The other form's draft is neither saved nor cleared.
    expect(screen.getByRole("textbox", { name: "Building name" })).toHaveValue(
      "Unsaved name",
    );
    expect(
      mutationFor("storageLayouts/writes:updateStorageBuilding"),
    ).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save building" })).toBeEnabled();
  });

  it("shows a thrown floor-count failure with a retry that reuses its request identity", async () => {
    const add = mutationFor("storageLayouts/writes:changeStorageFloorCount");
    add.mockRejectedValueOnce(new Error("Failed to fetch"));
    openSettings();
    fireEvent.click(screen.getByRole("button", { name: "Add floors" }));
    const failure = await screen.findByTestId("layout-operation-failure");
    expect(failure).toHaveTextContent(
      "Not saved. Your changes are still here.",
    );
    expect(failure).toHaveTextContent("cannot save twice");
    fireEvent.click(within(failure).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(add).toHaveBeenCalledTimes(2));
    expect(add.mock.calls[1]![0].requestId).toBe(
      add.mock.calls[0]![0].requestId,
    );
    expect(await screen.findByText(/now has 3 floors/)).toBeVisible();
  });

  it("removes only the empty top floor after confirmation and explains a refusal", async () => {
    const remove = mutationFor("storageLayouts/writes:removeTopStorageFloor");
    remove.mockResolvedValueOnce({
      ok: true,
      value: { written: false, error: { code: "FLOOR_NOT_EMPTY" } },
    });
    openSettings();
    fireEvent.click(
      screen.getByRole("button", { name: "Remove empty floor 2" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Remove floor 2?" });
    expect(dialog).toHaveTextContent("Only the top floor can be removed");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Remove floor" }),
    );
    expect(
      await within(dialog).findByText(/still has storage spots/),
    ).toBeVisible();
    expect(remove).toHaveBeenCalledWith(
      expect.objectContaining({ floorNumber: 2, expectedVersion: 5 }),
    );
  });

  it("archives with counted impact and explains reactivation; stock blocks confirmation", async () => {
    mocks.queries.set("storageLayouts/writes:buildingLifecycleImpact", {
      ok: true,
      value: {
        found: true,
        version: 5,
        zoneCount: 12,
        positionCount: 3,
        namedRegistrationCount: 1,
        occupied: true,
      },
    });
    openSettings();
    fireEvent.click(screen.getByRole("button", { name: "Archive building" }));
    const dialog = screen.getByRole("dialog", { name: "Archive PD?" });
    expect(dialog).toHaveTextContent(
      "12 storage spots · 3 exact positions · 1 registered location",
    );
    expect(dialog).toHaveTextContent(
      /can reactivate it after the full readiness check/,
    );
    expect(dialog).toHaveTextContent(/still holds stock/);
    expect(
      within(dialog).getByRole("button", { name: "Archive building" }),
    ).toBeDisabled();
  });

  it("offers settings and creation only to managers", () => {
    mocks.permissions = ["masterData.storageLayout.read"];
    renderWithIntl(
      <>
        <BuildingSettingsDialog warehouseId="warehouse-a" building={pd} />
        <NewBuildingAction />
      </>,
      { locale: "en", workspace: false },
    );
    expect(
      screen.queryByRole("button", { name: "Edit building settings" }),
    ).toBeNull();
    expect(screen.queryByRole("link", { name: "New building" })).toBeNull();
  });
});

describe("new building task", () => {
  it("starts without fabricated facts and defaults to one floor", () => {
    renderWithIntl(<NewStorageBuildingForm />, {
      locale: "en",
      workspace: false,
    });
    expect(screen.getByText("Creating in warehouse TG · TG-OPT")).toBeVisible();
    expect(screen.getByRole("textbox", { name: /Building code/ })).toHaveValue(
      "",
    );
    expect(screen.getByRole("textbox", { name: /Building name/ })).toHaveValue(
      "",
    );
    for (const name of [/Width/, /Depth/, /Floor height/])
      expect(screen.getByRole("spinbutton", { name })).toHaveValue(null);
    expect(screen.getByRole("spinbutton", { name: /Floors/ })).toHaveValue(1);
    expect(
      screen.getByText(/1 floor will be created \(floor 1\)\./),
    ).toBeVisible();
  });

  it("tells a viewer they cannot create instead of showing a form", () => {
    mocks.permissions = ["masterData.storageLayout.read"];
    renderWithIntl(<NewStorageBuildingForm />, {
      locale: "en",
      workspace: false,
    });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(
      screen.getByText(
        "View-only access. A warehouse manager can create buildings.",
      ),
    ).toBeVisible();
  });

  it("Back returns to the real catalogue origin with its query and hash, consuming the task entry", async () => {
    const origin = "/en/master-data/storage-layouts?search=pd#catalogue";
    window.history.replaceState({ appNavigationIndex: 0 }, "", origin);
    stopHistory = trackAppHistory();
    window.history.pushState({}, "", "/en/master-data/storage-layouts/new");
    renderWithIntl(<NewStorageBuildingForm />, {
      locale: "en",
      workspace: false,
    });
    fireEvent.click(screen.getByRole("button", { name: "Back to buildings" }));
    await waitFor(() =>
      expect(
        window.location.pathname +
          window.location.search +
          window.location.hash,
      ).toBe(origin),
    );
    expect(window.history.state.appNavigationIndex).toBe(0);
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("Back from a directly opened form replaces it with the catalogue", async () => {
    window.history.replaceState(
      { appNavigationIndex: 0 },
      "",
      "/en/master-data/storage-layouts/new",
    );
    stopHistory = trackAppHistory();
    renderWithIntl(<NewStorageBuildingForm />, {
      locale: "en",
      workspace: false,
    });
    fireEvent.click(screen.getByRole("button", { name: "Back to buildings" }));
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledExactlyOnceWith(
        "/master-data/storage-layouts",
      ),
    );
  });

  it("completes by replacing the form entry with the new building", async () => {
    const origin = "/en/master-data/storage-layouts?search=pd";
    window.history.replaceState({ appNavigationIndex: 0 }, "", origin);
    stopHistory = trackAppHistory();
    window.history.pushState({}, "", "/en/master-data/storage-layouts/new");
    mutationFor(
      "storageLayouts/writes:createStorageBuilding",
    ).mockResolvedValue({
      ok: true,
      value: { written: true, documentId: "pd-new", replayed: false },
    });
    renderWithIntl(<NewStorageBuildingForm />, {
      locale: "en",
      workspace: false,
    });
    const fill = (name: RegExp, value: string, role = "spinbutton") =>
      fireEvent.change(screen.getByRole(role, { name }), {
        target: { value },
      });
    fill(/Building code/, "PD", "textbox");
    fill(/Building name/, "PD", "textbox");
    fill(/Width/, "20");
    fill(/Depth/, "11.96");
    fill(/Floor height/, "4");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create building" }));
    });
    expect(
      mutationFor("storageLayouts/writes:createStorageBuilding"),
    ).toHaveBeenCalledWith(
      expect.objectContaining({ depthMm: 11_960, floorCount: 1 }),
    );
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith(
        "/master-data/storage-layouts/pd-new",
      ),
    );
    expect(window.history.state.appNavigationIndex).toBe(1);
  });
});

function spot(overrides: Partial<StorageZoneRow> = {}): StorageZoneRow {
  return {
    zoneId: "zone-a",
    locationId: "location-a",
    code: "PD-F01-Z01",
    label: "Rack A",
    qrValue: "ISAS:LOCATION:1:location-a",
    revision: "1:1",
    mode: "SIMPLE",
    xMm: 0,
    yMm: 0,
    widthMm: 4_000,
    depthMm: 2_000,
    maxStackHeightMm: 3_000,
    positions: [],
    placements: [],
    ...overrides,
  };
}

describe("storage spot editor actions", () => {
  const renderPanel = (zones: StorageZoneRow[], floorWidthMm = 10_000) =>
    renderWithIntl(
      <StorageZonesPanel
        warehouseId="warehouse-a"
        buildingId="pd"
        floorNumber={1}
        floorWidthMm={floorWidthMm}
        floorDepthMm={2_000}
        floorHeightMm={4_000}
        zones={zones}
      />,
      { locale: "en", workspace: false },
    );

  it("reports no room instead of opening an overlapping 0,0 draft", () => {
    renderPanel([spot({ widthMm: 10_000 })]);
    fireEvent.click(screen.getByRole("button", { name: "Add storage spot" }));
    const dialog = screen.getByRole("dialog", { name: "Add storage spot" });
    expect(dialog).toHaveTextContent("No free 2 × 2 m space on this floor.");
    expect(
      within(dialog).getByRole("spinbutton", { name: "X position (m)" }),
    ).toHaveValue(null);
    expect(
      within(dialog).getByRole("button", { name: "Create storage spot" }),
    ).toBeDisabled();
    fireEvent.change(
      within(dialog).getByRole("spinbutton", { name: "X position (m)" }),
      { target: { value: "0" } },
    );
    fireEvent.change(
      within(dialog).getByRole("spinbutton", { name: "Y position (m)" }),
      { target: { value: "0" } },
    );
    expect(
      within(dialog).getByTestId("zone-placement-status"),
    ).toHaveTextContent("Overlaps PD-F01-Z01 Rack A.");
  });

  it("finds the narrow free gap and creates a rack-mode spot", async () => {
    renderPanel([spot()], 6_000);
    fireEvent.click(screen.getByRole("button", { name: "Add storage spot" }));
    const dialog = screen.getByRole("dialog", { name: "Add storage spot" });
    expect(
      within(dialog).getByRole("spinbutton", { name: "X position (m)" }),
    ).toHaveValue(4);
    fireEvent.click(
      within(dialog).getByRole("combobox", { name: "Storage mode" }),
    );
    fireEvent.click(screen.getByRole("option", { name: "Rack / shelves" }));
    expect(dialog).toHaveTextContent(/add or generate exact positions/);
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Create storage spot" }),
    );
    await waitFor(() =>
      expect(
        mutationFor("storageLayouts/zones:createStorageZone"),
      ).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "RACK", xMm: 4_000, yMm: 0 }),
      ),
    );
  });

  it("confirms an archive with the spot identity and exact-position count", async () => {
    const exact = {
      positionId: "p1",
      locationId: "l1",
      code: "PD-F01-Z01-P1",
      label: "P1",
      qrValue: "ISAS:LOCATION:1:l1",
      kind: "FLOOR" as const,
      isDefault: false,
      breadcrumb: "",
      placements: [],
    };
    renderPanel([
      spot({
        mode: "FLOOR_POSITIONS",
        positions: [
          exact,
          {
            ...exact,
            positionId: "p2",
            locationId: "l2",
            code: "PD-F01-Z01-P2",
          },
        ],
      }),
    ]);
    expect(
      screen.getByText("Spot QR · scanning asks for an exact position"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Exact position QR")).toHaveLength(2);
    fireEvent.click(
      screen.getByRole("button", { name: "Archive spot · PD-F01-Z01" }),
    );
    const archive = mutationFor("storageLayouts/zones:archiveStorageZone");
    expect(archive).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", {
      name: "Archive PD-F01-Z01 · Rack A?",
    });
    expect(dialog).toHaveTextContent("together with 2 exact positions");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Archive spot" }),
    );
    await waitFor(() => expect(archive).toHaveBeenCalledOnce());
    expect(await screen.findByText(/Storage spot archived/)).toBeVisible();
  });
});

describe("exact positions and racks", () => {
  it("previews every generated rack address before committing the exact command", async () => {
    renderWithIntl(
      <StoragePositionsDialog
        warehouseId="warehouse-a"
        zone={spot({ mode: "RACK" })}
        onClose={vi.fn()}
      />,
      { locale: "en", workspace: false },
    );
    const set = (name: string, value: string) =>
      fireEvent.change(screen.getByLabelText(name), { target: { value } });
    expect(screen.getByText(/No exact positions yet/)).toBeVisible();
    set("Rack identity", "r1");
    set("Bays", "2");
    set("Levels", "3");
    set("Bay width (m)", "1.2");
    set("Rack depth (m)", "1");
    set("Level height (m)", "1");
    expect(screen.getByTestId("rack-preview")).toHaveTextContent(
      "Preview: 6 positions from PD-F01-Z01-R1-B01-L01-S01 to PD-F01-Z01-R1-B02-L03-S01",
    );
    expect(screen.getByTestId("rack-preview")).toHaveTextContent(
      "Level elevations: 0, 1, 2 m",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Generate 6 positions" }),
    );
    await waitFor(() =>
      expect(
        mutationFor("storageLayouts/zones:generateRackStoragePositions"),
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          fixtureCode: "R1",
          bayCount: 2,
          levelCount: 3,
          slotsPerBay: 1,
          bayWidthMm: 1_200,
        }),
      ),
    );
    set("Levels", "4");
    expect(screen.getByTestId("rack-preview")).toHaveTextContent(
      "This rack doesn't fit",
    );
  });

  it("adds a floor position with a code preview and keeps it inside the spot", async () => {
    renderWithIntl(
      <StoragePositionsDialog
        warehouseId="warehouse-a"
        zone={spot({ mode: "FLOOR_POSITIONS" })}
        onClose={vi.fn()}
      />,
      { locale: "en", workspace: false },
    );
    fireEvent.change(screen.getByLabelText("Position marker / code"), {
      target: { value: "p-12" },
    });
    expect(screen.getByText("Code PD-F01-Z01-P-12")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Width (m)"), {
      target: { value: "5" },
    });
    fireEvent.change(screen.getByLabelText("Depth (m)"), {
      target: { value: "1" },
    });
    expect(
      screen.getByText("The exact position must stay inside its spot."),
    ).toBeVisible();
    fireEvent.change(screen.getByLabelText("Width (m)"), {
      target: { value: "1.25" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add exact position" }));
    await waitFor(() =>
      expect(
        mutationFor("storageLayouts/zones:createStoragePosition"),
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "P-12",
          xMm: 0,
          yMm: 0,
          widthMm: 1_250,
          depthMm: 1_000,
        }),
      ),
    );
  });
});

describe("server-checked review", () => {
  const layout = {
    ok: true,
    value: {
      found: true,
      building: pd,
      floors: [
        {
          floorId: "f1",
          floorNumber: 1,
          grossAreaSqMm: 1,
          reservedAreaSqMm: 0,
          usableAreaSqMm: 1,
          version: 1,
          storageZones: [spot({ mode: "RACK" })],
          reservedBlocks: [],
        },
      ],
    },
  };
  beforeEach(() => {
    mocks.queries.set(
      "storageLayouts/catalogue:getStorageBuildingLayout",
      layout,
    );
    mocks.queries.set("storageLayouts/catalogue:getStorageBuildingInventory", {
      ok: true,
      value: { found: true, zones: [] },
    });
  });

  it("never claims readiness from a spot count and lists blocking issues with fixes", () => {
    mocks.queries.set("storageLayouts/writes:layoutReadiness", {
      ok: true,
      value: {
        found: true,
        version: 5,
        ready: false,
        zoneCount: 1,
        issues: [
          {
            code: "AREA_REQUIRES_LEAF_POSITION",
            blocking: true,
            floorNumber: 1,
            zoneCode: "PD-F01-Z01",
            zoneLabel: "Rack A",
          },
          { code: "FLOOR_HAS_NO_STORAGE", blocking: false, floorNumber: 2 },
        ],
      },
    });
    renderWithIntl(<StorageBuildingReview buildingId="pd" />, {
      locale: "en",
      workspace: false,
    });
    const blocking = screen.getByTestId("readiness-blocking");
    expect(blocking).toHaveTextContent(
      "Floor 1 · PD-F01-Z01 Rack A · This spot's mode needs exact positions.",
    );
    expect(
      within(blocking).getByRole("link", { name: "Edit floor 1" }),
    ).toHaveAttribute(
      "href",
      "/master-data/storage-layouts/pd?floor=1&editing=1",
    );
    expect(screen.queryByTestId("readiness-ready")).toBeNull();
    expect(screen.getByText("No storage spots on this floor.")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Activate layout" }),
    ).toBeDisabled();
  });

  it("waits for the preflight of the current version before offering activation", () => {
    mocks.queries.set("storageLayouts/writes:layoutReadiness", {
      ok: true,
      value: { found: true, version: 4, ready: true, zoneCount: 1, issues: [] },
    });
    renderWithIntl(<StorageBuildingReview buildingId="pd" />, {
      locale: "en",
      workspace: false,
    });
    expect(
      screen.getByText("Checking the layout on the server…"),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Activate layout" }),
    ).toBeDisabled();
  });

  it("activates after a passing preflight and completes to the building", async () => {
    mocks.queries.set("storageLayouts/writes:layoutReadiness", {
      ok: true,
      value: { found: true, version: 5, ready: true, zoneCount: 1, issues: [] },
    });
    renderWithIntl(<StorageBuildingReview buildingId="pd" />, {
      locale: "en",
      workspace: false,
    });
    expect(screen.getByTestId("readiness-ready")).toHaveTextContent(
      "Server check passed",
    );
    fireEvent.click(screen.getByRole("button", { name: "Activate layout" }));
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith(
        "/master-data/storage-layouts/pd",
      ),
    );
    expect(
      mutationFor("storageLayouts/writes:activateStorageBuilding"),
    ).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 5 }));
  });
});

describe("complete layout for a registered location", () => {
  it("requires measured geometry and keeps the registered identity", async () => {
    mocks.queries.set("storageLayouts/namedLayout:namedLocationLayoutTarget", {
      ok: true,
      value: {
        found: true,
        locationId: "named-a",
        code: "DOCK SHELF",
        version: 1,
        layoutPending: true,
        buildingStatus: "ACTIVE",
      },
    });
    mocks.queries.set("storageLayouts/catalogue:getStorageBuildingLayout", {
      ok: true,
      value: {
        found: true,
        building: pd,
        floors: [
          {
            floorId: "f1",
            floorNumber: 1,
            grossAreaSqMm: 1,
            reservedAreaSqMm: 0,
            usableAreaSqMm: 1,
            version: 1,
            storageZones: [spot()],
            reservedBlocks: [],
          },
        ],
      },
    });
    const completed = vi.fn();
    renderWithIntl(
      <CompleteNamedLayoutDialog
        warehouseId="warehouse-a"
        location={{
          locationId: "named-a",
          code: "DOCK SHELF",
          name: "Dock shelf",
          buildingId: "pd",
        }}
        onClose={vi.fn()}
        onCompleted={completed}
      />,
      { locale: "en", workspace: false },
    );
    const confirm = screen.getByRole("button", { name: "Add to floor plan" });
    expect(confirm).toBeDisabled();
    expect(screen.getByTestId("named-layout-status")).toHaveTextContent(
      "Nothing is estimated.",
    );
    const set = (name: string, value: string) =>
      fireEvent.change(screen.getByLabelText(name), { target: { value } });
    set("Width (m)", "1.2");
    set("Depth (m)", "1");
    set("Maximum stack height (m)", "2.5");
    fireEvent.click(screen.getByRole("button", { name: "Find free space" }));
    expect(screen.getByLabelText("X position (m)")).toHaveValue(4);
    fireEvent.click(confirm);
    await waitFor(() => expect(completed).toHaveBeenCalledOnce());
    expect(
      mutationFor("storageLayouts/namedLayout:completeNamedLocationLayout"),
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        locationId: "named-a",
        expectedVersion: 1,
        floorNumber: 1,
        xMm: 4_000,
        yMm: 0,
        widthMm: 1_200,
        depthMm: 1_000,
        maxStackHeightMm: 2_500,
      }),
    );
  });
});

describe("floor draft save failure", () => {
  it("keeps the floor draft visible after a thrown save and retries the same request", async () => {
    mocks.queries.set("storageLayouts/catalogue:getStorageBuildingLayout", {
      ok: true,
      value: {
        found: true,
        building: pd,
        floors: [
          {
            floorId: "f1",
            floorNumber: 1,
            grossAreaSqMm: 1,
            reservedAreaSqMm: 0,
            usableAreaSqMm: 1,
            version: 3,
            storageZones: [],
            reservedBlocks: [],
          },
        ],
      },
    });
    mocks.queries.set("storageLayouts/catalogue:getStorageBuildingInventory", {
      ok: true,
      value: { found: true, zones: [] },
    });
    const save = mutationFor("storageLayouts/writes:saveStorageFloor");
    save.mockRejectedValueOnce(new Error("Failed to fetch"));
    const { StorageFloorEditor } = await import("./StorageLayoutScreens");
    renderWithIntl(<StorageFloorEditor buildingId="pd" floorNumber={1} />, {
      locale: "en",
      workspace: false,
    });
    fireEvent.click(screen.getByRole("button", { name: /Floor dimensions/ }));
    const width = screen.getByRole("spinbutton", { name: "Width (m)" });
    fireEvent.change(width, { target: { value: "19.995" } });
    fireEvent.click(screen.getByRole("button", { name: "Save floor" }));
    const failure = await screen.findByTestId("layout-operation-failure");
    expect(width).toHaveValue(19.995);
    fireEvent.click(within(failure).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1]![0].requestId).toBe(
      save.mock.calls[0]![0].requestId,
    );
    expect(save.mock.calls[1]![0].floor).toMatchObject({ widthMm: 19_995 });
    expect(
      await screen.findByText(/Floor saved\. You can now add/),
    ).toBeVisible();
  });
});

import { NavigationGuardProvider } from "@/components/navigation/NavigationGuardProvider";

it.each(["remove", "archive"])(
  "consumes successful %s confirmation without a stale pending prompt",
  async (action) => {
    window.history.replaceState(
      null,
      "",
      "/en/master-data/storage-layouts?origin=yes#catalogue",
    );
    stopHistory = trackAppHistory();
    window.history.pushState(
      null,
      "",
      "/en/master-data/storage-layouts/pd?kept=yes#map",
    );
    mocks.queries.set("storageLayouts/writes:buildingLifecycleImpact", {
      ok: true,
      value: {
        found: true,
        version: 5,
        zoneCount: 1,
        positionCount: 1,
        namedRegistrationCount: 0,
        occupied: false,
        canArchive: true,
      },
    });
    renderWithIntl(
      <NavigationGuardProvider>
        <BuildingSettingsDialog warehouseId="warehouse-a" building={pd} />
      </NavigationGuardProvider>,
      { locale: "en", workspace: false },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Edit building settings" }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: action === "remove" ? "Remove empty floor 2" : "Archive building",
      }),
    );
    const title = action === "remove" ? "Remove floor 2?" : "Archive PD?";
    const dialog = screen.getByRole("dialog", { name: title });
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: action === "remove" ? "Remove floor" : "Archive building",
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: title }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("dialog", { name: "Save changes before leaving?" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Building name" })).toHaveValue(
      "PD",
    );
    await waitFor(() =>
      expect(
        [...new URLSearchParams(window.location.search).keys()].filter((key) =>
          key.startsWith("overlay"),
        ),
      ).toHaveLength(1),
    );
    act(() => window.history.back());
    await waitFor(() =>
      expect(
        screen.queryByRole("textbox", { name: "Building name" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      window.location.pathname + window.location.search + window.location.hash,
    ).toBe("/en/master-data/storage-layouts/pd?kept=yes#map");
    act(() => window.history.back());
    await waitFor(() =>
      expect(
        window.location.pathname +
          window.location.search +
          window.location.hash,
      ).toBe("/en/master-data/storage-layouts?origin=yes#catalogue"),
    );
  },
);

it.each(["spot", "position"])(
  "consumes successful %s archival without a stale pending prompt",
  async (kind) => {
    stopHistory = trackAppHistory();
    const zone = spot({
      mode: "FLOOR_POSITIONS",
      positions: [
        {
          positionId: "position-a",
          locationId: "position-location",
          code: "POS-01",
          label: "Exact spot",
          qrValue: "ISAS:LOCATION:1:position-location",
          kind: "FLOOR",
          isDefault: false,
          breadcrumb: "",
          placements: [],
          xMm: 0,
          yMm: 0,
          widthMm: 1000,
          depthMm: 1000,
          revision: "1:1",
        },
      ],
    });
    renderWithIntl(
      <NavigationGuardProvider>
        {kind === "position" ? (
          <StoragePositionsDialog
            warehouseId="warehouse-a"
            zone={zone}
            onClose={vi.fn()}
          />
        ) : (
          <StorageZonesPanel
            warehouseId="warehouse-a"
            buildingId="pd"
            floorNumber={1}
            floorWidthMm={10000}
            floorDepthMm={10000}
            floorHeightMm={4000}
            reservedBlocks={[]}
            zones={[zone]}
          />
        )}
      </NavigationGuardProvider>,
      { locale: "en", workspace: false },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name:
          kind === "position" ? "Archive POS-01" : "Archive spot · PD-F01-Z01",
      }),
    );
    const title =
      kind === "position" ? "Archive POS-01" : "Archive PD-F01-Z01 · Rack A?";
    const dialog = screen.getByRole("dialog", { name: title });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Archive spot" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: title }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("dialog", { name: "Save changes before leaving?" }),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(
        [...new URLSearchParams(window.location.search).keys()].filter((key) =>
          key.startsWith("overlay"),
        ),
      ).toHaveLength(kind === "position" ? 1 : 0),
    );
    if (kind === "position")
      expect(
        screen.getByRole("dialog", { name: "Exact positions · PD-F01-Z01" }),
      ).toBeVisible();
  },
);
it("retries the original floor-count command after a lost response advances the live building", async () => {
  const add = mutationFor("storageLayouts/writes:changeStorageFloorCount");
  add.mockRejectedValueOnce(new Error("Response lost after server committed"));
  const view = renderWithIntl(
    <BuildingSettingsDialog warehouseId="warehouse-a" building={pd} />,
    { locale: "en", workspace: false, preserveProviders: true },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Edit building settings" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Add floors" }));
  await screen.findByTestId("layout-operation-failure");
  const original = add.mock.calls[0]![0];
  view.rerender(
    <BuildingSettingsDialog
      warehouseId="warehouse-a"
      building={{ ...pd, floorCount: 3, version: 6 }}
    />,
  );
  fireEvent.click(
    within(screen.getByTestId("layout-operation-failure")).getByRole("button", {
      name: "Retry",
    }),
  );
  await waitFor(() => expect(add).toHaveBeenCalledTimes(2));
  expect(add.mock.calls[1]![0]).toEqual(original);
});

it("replays named layout completion after a lost response changes its live target", async () => {
  const target = {
    found: true,
    locationId: "named-a",
    code: "DOCK SHELF",
    version: 1,
    layoutPending: true,
    buildingStatus: "ACTIVE",
  };
  mocks.queries.set("storageLayouts/namedLayout:namedLocationLayoutTarget", {
    ok: true,
    value: target,
  });
  mocks.queries.set("storageLayouts/catalogue:getStorageBuildingLayout", {
    ok: true,
    value: {
      found: true,
      building: pd,
      floors: [
        {
          floorId: "f1",
          floorNumber: 1,
          grossAreaSqMm: 1,
          reservedAreaSqMm: 0,
          usableAreaSqMm: 1,
          version: 1,
          storageZones: [],
          reservedBlocks: [],
        },
      ],
    },
  });
  const complete = mutationFor(
    "storageLayouts/namedLayout:completeNamedLocationLayout",
  );
  complete.mockRejectedValueOnce(
    new Error("Response lost after server committed"),
  );
  const props = {
    warehouseId: "warehouse-a",
    location: {
      locationId: "named-a",
      code: "DOCK SHELF",
      name: "Dock shelf",
      buildingId: "pd",
    },
    onClose: vi.fn(),
    onCompleted: vi.fn(),
  };
  const view = renderWithIntl(<CompleteNamedLayoutDialog {...props} />, {
    locale: "en",
    workspace: false,
    preserveProviders: true,
  });
  for (const [name, value] of [
    ["Width (m)", "1.2"],
    ["Depth (m)", "1"],
    ["Maximum stack height (m)", "2.5"],
    ["X position (m)", "0"],
    ["Y position (m)", "0"],
  ])
    fireEvent.change(screen.getByLabelText(name!), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Add to floor plan" }));
  await screen.findByTestId("layout-operation-failure");
  const original = complete.mock.calls[0]![0];
  mocks.queries.set("storageLayouts/namedLayout:namedLocationLayoutTarget", {
    ok: true,
    value: { ...target, version: 2, layoutPending: false },
  });
  view.rerender(<CompleteNamedLayoutDialog {...props} />);
  expect(
    screen.getByRole("button", { name: "Add to floor plan" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(complete).toHaveBeenCalledTimes(2));
  expect(complete.mock.calls[1]![0]).toEqual(original);
  await waitFor(() => expect(props.onCompleted).toHaveBeenCalledOnce());
});

it("uses a distinct floor-count command when the user explicitly adds more after an uncertain save", async () => {
  const add = mutationFor("storageLayouts/writes:changeStorageFloorCount");
  add.mockRejectedValueOnce(new Error("Response lost after server committed"));
  const view = renderWithIntl(
    <BuildingSettingsDialog warehouseId="warehouse-a" building={pd} />,
    { locale: "en", workspace: false, preserveProviders: true },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Edit building settings" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Add floors" }));
  await screen.findByTestId("layout-operation-failure");
  const original = add.mock.calls[0]![0];
  view.rerender(
    <BuildingSettingsDialog
      warehouseId="warehouse-a"
      building={{ ...pd, floorCount: 3, version: 6 }}
    />,
  );
  fireEvent.change(
    screen.getByRole("spinbutton", { name: "New total floors" }),
    { target: { value: "5" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Add floors" }));
  await waitFor(() => expect(add).toHaveBeenCalledTimes(2));
  expect(add.mock.calls[1]![0]).toEqual(
    expect.objectContaining({ floorCount: 5, expectedVersion: 6 }),
  );
  expect(add.mock.calls[1]![0].requestId).not.toBe(original.requestId);
});

it.each([2, 3])(
  "replays removal of reviewed floor %s after a lost response advances the live building",
  async (floorCount) => {
    const remove = mutationFor("storageLayouts/writes:removeTopStorageFloor");
    remove.mockRejectedValueOnce(
      new Error("Response lost after server committed"),
    );
    const view = renderWithIntl(
      <BuildingSettingsDialog
        warehouseId="warehouse-a"
        building={{ ...pd, floorCount }}
      />,
      { locale: "en", workspace: false, preserveProviders: true },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Edit building settings" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: `Remove empty floor ${floorCount}` }),
    );
    fireEvent.click(
      within(
        screen.getByRole("dialog", { name: `Remove floor ${floorCount}?` }),
      ).getByRole("button", { name: "Remove floor" }),
    );
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    const original = remove.mock.calls[0]![0];
    view.rerender(
      <BuildingSettingsDialog
        warehouseId="warehouse-a"
        building={{ ...pd, floorCount: floorCount - 1, version: 6 }}
      />,
    );
    const confirmation = screen.getByRole("dialog", {
      name: `Remove floor ${floorCount}?`,
    });
    fireEvent.click(
      within(confirmation).getByRole("button", { name: "Remove floor" }),
    );
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(2));
    expect(remove.mock.calls[1]![0]).toEqual(original);
    await waitFor(() => expect(confirmation).not.toBeInTheDocument());
    if (floorCount === 3) {
      fireEvent.click(
        screen.getByRole("button", { name: "Remove empty floor 2" }),
      );
      fireEvent.click(
        within(
          screen.getByRole("dialog", { name: "Remove floor 2?" }),
        ).getByRole("button", { name: "Remove floor" }),
      );
      await waitFor(() => expect(remove).toHaveBeenCalledTimes(3));
      expect(remove.mock.calls[2]![0]).toEqual(
        expect.objectContaining({ floorNumber: 2, expectedVersion: 6 }),
      );
      expect(remove.mock.calls[2]![0].requestId).not.toBe(original.requestId);
    }
  },
);
