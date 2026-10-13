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
  useRouter: () => ({
    push: vi.fn(),
    back: () => window.history.back(),
    replace: mocks.replace,
  }),
}));

import { renderWithIntl } from "@tests/fixtures/intl-render";
import { DraftGuardProvider } from "@/components/providers/DraftGuardProvider";
import { trackAppHistory } from "@/lib/browser/appHistory";
import type {
  StorageBuildingRow,
  StorageFloorRow,
  StorageZoneRow,
} from "@/lib/convex/storageLayoutApi";
import {
  BuildingModelWorkspace,
  BuildingSettingsDialog,
  NewStorageBuildingForm,
  StorageFloorEditor,
  StorageZonesPanel,
} from "./StorageLayoutScreens";
import { StoragePositionsDialog } from "./StoragePositionsDialog";
import { NamedLocationCatalogue } from "./NamedLocationCatalogue";

const ORIGIN = "/en/master-data/storage-layouts?search=pd#catalogue";
const BUILDING_URL =
  "/en/master-data/storage-layouts/pd?floor=1&view=storage&kept=yes#map";
let stop: (() => void) | undefined;
beforeEach(() => {
  mocks.mutations.clear();
  mocks.queries.clear();
  mocks.permissions = [
    "masterData.storageLayout.manage",
    "masterData.storageLayout.activate",
  ];
  mocks.replace.mockReset();
  window.history.replaceState({ appNavigationIndex: 0 }, "", ORIGIN);
  stop = trackAppHistory();
  window.history.pushState({}, "", BUILDING_URL);
});
afterEach(() => {
  cleanup();
  stop?.();
  stop = undefined;
});

const href = () =>
  window.location.pathname + window.location.search + window.location.hash;
const params = () => new URLSearchParams(window.location.search);
async function nativeBack() {
  await act(async () => {
    window.history.back();
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
  });
}
async function nativeForward() {
  await act(async () => {
    window.history.forward();
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
  });
}
const guarded = (ui: ReactNode) =>
  renderWithIntl(<DraftGuardProvider>{ui}</DraftGuardProvider>, {
    locale: "en",
    workspace: false,
    preserveProviders: true,
  });
const prompt = () =>
  screen.findByRole("dialog", {
    name: /Save changes before leaving|Leave without sending/,
  });

const building: StorageBuildingRow = {
  buildingId: "pd",
  warehouseId: "warehouse-a",
  code: "PD",
  name: "PD",
  widthMm: 20_000,
  depthMm: 11_960,
  defaultFloorHeightMm: 4_000,
  floorCount: 1,
  totalHeightMm: 4_000,
  grossAreaSqMm: 1,
  reservedAreaSqMm: 0,
  usableAreaSqMm: 1,
  status: "DRAFT",
  version: 5,
};
function zone(overrides: Partial<StorageZoneRow> = {}): StorageZoneRow {
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
const held = {
  placementId: "held",
  handlingUnitId: "held-pallet",
  lpn: "P-005",
  levelIndex: 1,
  widthMm: 1_000,
  depthMm: 1_000,
  heightMm: 1_400,
  orientation: "DEFAULT" as const,
  placedAt: 1,
  xMm: 0,
  yMm: 0,
  zMm: 0,
  status: "STORED" as const,
};
function floor(overrides: Partial<StorageFloorRow> = {}): StorageFloorRow {
  return {
    floorId: "f1",
    floorNumber: 1,
    grossAreaSqMm: 1,
    reservedAreaSqMm: 0,
    usableAreaSqMm: 1,
    version: 3,
    storageZones: [],
    reservedBlocks: [],
    ...overrides,
  };
}
const workspace = (
  floors: readonly StorageFloorRow[] = [floor()],
  row: StorageBuildingRow = building,
) => <BuildingModelWorkspace building={row} floors={floors} />;
async function openFloorDimensions() {
  fireEvent.click(
    await screen.findByRole("button", { name: /Floor dimensions/ }),
  );
  return screen.getByRole("spinbutton", { name: "Width (m)" });
}

describe("floor editor workflow step", () => {
  it("native Back closes the floor editor before leaving the building, keeping floor, query and hash", async () => {
    guarded(workspace());
    fireEvent.click(screen.getByRole("button", { name: "Edit floor 1" }));
    await waitFor(() => expect(params().get("editing")).toBe("1"));
    expect(
      screen.getByRole("button", { name: "Edit floor 1" }),
    ).toHaveAttribute("aria-pressed", "true");
    await nativeBack();
    expect(href()).toBe(BUILDING_URL);
    expect(
      screen.getByRole("button", { name: "Find and view" }),
    ).toHaveAttribute("aria-pressed", "true");
    await nativeBack();
    expect(href()).toBe(ORIGIN);
  });

  it("Find and view consumes the editor entry so the next Back leaves the building", async () => {
    guarded(workspace());
    fireEvent.click(screen.getByRole("button", { name: "Edit floor 1" }));
    await waitFor(() => expect(params().get("editing")).toBe("1"));
    fireEvent.click(screen.getByRole("button", { name: "Find and view" }));
    await waitFor(() => expect(href()).toBe(BUILDING_URL));
    expect(window.history.state.appNavigationIndex).toBe(1);
    await nativeBack();
    expect(href()).toBe(ORIGIN);
  });

  it("header Back closes the floor offset editor, then the floor editor, then leaves the building", async () => {
    guarded(workspace());
    const headerBack = () =>
      fireEvent.click(screen.getAllByRole("button", { name: "Back" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Edit floor 1" }));
    await waitFor(() => expect(params().get("editing")).toBe("1"));
    fireEvent.click(screen.getByRole("button", { name: "Edit floor offset" }));
    await waitFor(() => expect(params().get("floorOffset")).toBe("1"));
    headerBack();
    await waitFor(() => expect(params().get("floorOffset")).toBeNull());
    expect(params().get("editing")).toBe("1");
    headerBack();
    await waitFor(() => expect(href()).toBe(BUILDING_URL));
    headerBack();
    await waitFor(() => expect(href()).toBe(ORIGIN));
  });

  it("clean native Forward reopens the floor editor without a duplicate entry", async () => {
    guarded(workspace());
    fireEvent.click(screen.getByRole("button", { name: "Edit floor 1" }));
    await waitFor(() => expect(params().get("editing")).toBe("1"));
    const length = window.history.length;
    await nativeBack();
    await nativeForward();
    expect(params().get("editing")).toBe("1");
    expect(
      screen.getByRole("button", { name: "Edit floor 1" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(window.history.length).toBe(length);
  });

  it("a direct editing link closes to the same building view instead of leaving", async () => {
    window.history.replaceState(
      { appNavigationIndex: 0 },
      "",
      "/th/master-data/storage-layouts/pd?floor=1&editing=1&kept=yes#map",
    );
    guarded(workspace());
    expect(
      screen.getByRole("button", { name: "Edit floor 1" }),
    ).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Find and view" }));
    await waitFor(() =>
      expect(href()).toBe(
        "/th/master-data/storage-layouts/pd?floor=1&kept=yes#map",
      ),
    );
    expect(window.history.state.appNavigationIndex).toBe(0);
  });

  it("native Back from a dirty floor editor asks first and Keep editing retains the draft", async () => {
    guarded(workspace());
    fireEvent.click(screen.getByRole("button", { name: "Edit floor 1" }));
    await waitFor(() => expect(params().get("editing")).toBe("1"));
    const width = await openFloorDimensions();
    fireEvent.change(width, { target: { value: "19.995" } });
    await nativeBack();
    await prompt();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(params().get("editing")).toBe("1"));
    expect(screen.getByRole("spinbutton", { name: "Width (m)" })).toHaveValue(
      19.995,
    );
  });

  it("remount with an owned editor entry restores the editor and Back still consumes it", async () => {
    const first = guarded(workspace());
    fireEvent.click(screen.getByRole("button", { name: "Edit floor 1" }));
    await waitFor(() => expect(params().get("editing")).toBe("1"));
    first.unmount();
    guarded(workspace());
    expect(
      screen.getByRole("button", { name: "Edit floor 1" }),
    ).toHaveAttribute("aria-pressed", "true");
    await nativeBack();
    expect(href()).toBe(BUILDING_URL);
  });
});

describe("floor draft nested steps", () => {
  const occupied = () => [
    floor({ storageZones: [zone({ placements: [held] })] }),
  ];

  it("native Back returns floor impact review to the dirty floor editor without discarding dimensions", async () => {
    guarded(workspace(occupied()));
    fireEvent.click(screen.getByRole("button", { name: "Edit floor 1" }));
    await waitFor(() => expect(params().get("editing")).toBe("1"));
    fireEvent.change(await openFloorDimensions(), {
      target: { value: "19.5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review impact" }));
    await screen.findByTestId("layout-blocked-impact");
    expect(params().get("floorImpact")).toBe("1");
    await nativeBack();
    await waitFor(() =>
      expect(screen.queryByTestId("layout-blocked-impact")).toBeNull(),
    );
    expect(
      screen.queryByRole("dialog", { name: /Save changes before leaving/ }),
    ).toBeNull();
    expect(params().get("editing")).toBe("1");
    expect(screen.getByRole("spinbutton", { name: "Width (m)" })).toHaveValue(
      19.5,
    );
    expect(
      mutationFor("storageLayouts/writes:saveStorageFloor"),
    ).not.toHaveBeenCalled();
  });

  it("Cancel from the impact review consumes both steps before closing the editor", async () => {
    guarded(workspace(occupied()));
    fireEvent.click(screen.getByRole("button", { name: "Edit floor 1" }));
    await waitFor(() => expect(params().get("editing")).toBe("1"));
    fireEvent.change(await openFloorDimensions(), {
      target: { value: "19.5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review impact" }));
    await screen.findByTestId("layout-blocked-impact");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await prompt();
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(href()).toBe(BUILDING_URL));
    await nativeBack();
    expect(href()).toBe(ORIGIN);
  });

  it("native Back closes the floor offset editor and returns to the map in the same editor", async () => {
    guarded(workspace());
    fireEvent.click(screen.getByRole("button", { name: "Edit floor 1" }));
    await waitFor(() => expect(params().get("editing")).toBe("1"));
    fireEvent.click(screen.getByRole("button", { name: "Edit floor offset" }));
    await screen.findByRole("img", { name: "3D floor volume" });
    expect(params().get("floorOffset")).toBe("1");
    await nativeBack();
    await waitFor(() =>
      expect(screen.queryByRole("img", { name: "3D floor volume" })).toBeNull(),
    );
    expect(params().get("editing")).toBe("1");
    expect(
      screen.getByRole("button", { name: "Edit floor offset" }),
    ).toBeVisible();
  });

  it("keeps an unsaved floor draft when a newer saved version arrives and offers an explicit reload", async () => {
    const view = guarded(workspace());
    fireEvent.click(screen.getByRole("button", { name: "Edit floor 1" }));
    await waitFor(() => expect(params().get("editing")).toBe("1"));
    fireEvent.change(await openFloorDimensions(), {
      target: { value: "19.995" },
    });
    view.rerender(
      <DraftGuardProvider>
        {workspace([floor({ version: 4, widthMm: 18_000 })], {
          ...building,
          version: 6,
        })}
      </DraftGuardProvider>,
    );
    expect(screen.getByRole("spinbutton", { name: "Width (m)" })).toHaveValue(
      19.995,
    );
    const conflict = screen.getByTestId("floor-version-conflict");
    expect(conflict).toHaveTextContent("Your draft is kept");
    fireEvent.click(
      within(conflict).getByRole("button", {
        name: "Load latest floor (discard my draft)",
      }),
    );
    expect(screen.getByRole("spinbutton", { name: "Width (m)" })).toHaveValue(
      18,
    );
    expect(screen.queryByTestId("floor-version-conflict")).toBeNull();
  });

  it("the standalone floor editor keeps its draft across a realtime version update", async () => {
    const layout = (version: number) => ({
      ok: true,
      value: {
        found: true,
        building: { ...building, version: version + 2 },
        floors: [floor({ version })],
      },
    });
    mocks.queries.set(
      "storageLayouts/catalogue:getStorageBuildingLayout",
      layout(3),
    );
    mocks.queries.set("storageLayouts/catalogue:getStorageBuildingInventory", {
      ok: true,
      value: { found: true, zones: [] },
    });
    const view = guarded(
      <StorageFloorEditor buildingId="pd" floorNumber={1} />,
    );
    fireEvent.change(await openFloorDimensions(), {
      target: { value: "19.995" },
    });
    mocks.queries.set(
      "storageLayouts/catalogue:getStorageBuildingLayout",
      layout(4),
    );
    view.rerender(
      <DraftGuardProvider>
        <StorageFloorEditor buildingId="pd" floorNumber={1} />
      </DraftGuardProvider>,
    );
    expect(screen.getByRole("spinbutton", { name: "Width (m)" })).toHaveValue(
      19.995,
    );
    expect(screen.getByTestId("floor-version-conflict")).toBeVisible();
  });
});

describe("storage spot editor foregrounds", () => {
  const panel = (zones: StorageZoneRow[]) => (
    <StorageZonesPanel
      warehouseId="warehouse-a"
      buildingId="pd"
      floorNumber={1}
      floorWidthMm={10_000}
      floorDepthMm={10_000}
      floorHeightMm={4_000}
      zones={zones}
    />
  );

  it("native Back returns from zone impact review to the same spot draft with the editor open", async () => {
    guarded(panel([zone({ placements: [held] })]));
    fireEvent.click(screen.getByRole("button", { name: "Edit Rack A" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Edit storage spot",
    });
    fireEvent.change(
      within(dialog).getByRole("spinbutton", { name: "Width (m)" }),
      {
        target: { value: "5" },
      },
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Review impact" }),
    );
    await screen.findByTestId("layout-blocked-impact");
    expect(params().get("zoneImpact")).toBe("1");
    await nativeBack();
    await waitFor(() =>
      expect(screen.queryByTestId("layout-blocked-impact")).toBeNull(),
    );
    expect(
      screen.queryByRole("dialog", { name: /Save changes before leaving/ }),
    ).toBeNull();
    expect(
      screen.getByRole("dialog", { name: "Edit storage spot" }),
    ).toBeVisible();
    expect(screen.getByRole("spinbutton", { name: "Width (m)" })).toHaveValue(
      5,
    );
  });

  it("Cancel on a dirty spot editor asks before discarding, then the next Back leaves the building", async () => {
    guarded(panel([zone()]));
    fireEvent.click(screen.getByRole("button", { name: "Edit Rack A" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Edit storage spot",
    });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Name" }), {
      target: { value: "Unsent name" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await prompt();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue(
        "Unsent name",
      ),
    );
    fireEvent.click(
      within(
        screen.getByRole("dialog", { name: "Edit storage spot" }),
      ).getByRole("button", { name: "Cancel" }),
    );
    await prompt();
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Edit storage spot" }),
      ).toBeNull(),
    );
    await waitFor(() => expect(href()).toBe(BUILDING_URL));
    await nativeBack();
    expect(href()).toBe(ORIGIN);
  });

  it("a pending spot save keeps its editor through native Back and closes it once the write settles", async () => {
    let finish!: (value: unknown) => void;
    mutationFor("storageLayouts/zones:updateStorageZone").mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    guarded(panel([zone()]));
    fireEvent.click(screen.getByRole("button", { name: "Edit Rack A" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Edit storage spot",
    });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Name" }), {
      target: { value: "Renamed" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );
    await nativeBack();
    expect(
      screen.getByRole("dialog", { name: "Edit storage spot" }),
    ).toBeVisible();
    const keep = screen.queryByRole("button", { name: "Keep editing" });
    if (keep) fireEvent.click(keep);
    await act(async () =>
      finish({
        ok: true,
        value: { written: true, documentId: "zone-a", replayed: false },
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Edit storage spot" }),
      ).toBeNull(),
    );
    await waitFor(() => expect(href()).toBe(BUILDING_URL));
    expect(
      screen.getByText(
        "Storage spot saved. Its code and QR label are unchanged.",
      ),
    ).toBeVisible();
    await nativeBack();
    expect(href()).toBe(ORIGIN);
  });

  it("retries a thrown spot save with the same request identity and keeps the draft", async () => {
    const update = mutationFor("storageLayouts/zones:updateStorageZone");
    update.mockRejectedValueOnce(new Error("Failed to fetch"));
    guarded(panel([zone()]));
    fireEvent.click(screen.getByRole("button", { name: "Edit Rack A" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Edit storage spot",
    });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Name" }), {
      target: { value: "Retry me" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );
    const failure = await screen.findByTestId("layout-operation-failure");
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue(
      "Retry me",
    );
    fireEvent.click(within(failure).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls[1]![0].requestId).toBe(
      update.mock.calls[0]![0].requestId,
    );
    expect(update.mock.calls[1]![0]).toMatchObject({
      label: "Retry me",
      expectedRevision: "1:1",
    });
  });

  it("native Back cancels a spot archive confirmation and the next Back leaves the building", async () => {
    guarded(panel([zone()]));
    fireEvent.click(
      screen.getByRole("button", { name: "Archive spot · PD-F01-Z01" }),
    );
    await screen.findByRole("dialog", { name: "Archive PD-F01-Z01 · Rack A?" });
    await nativeBack();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(href()).toBe(BUILDING_URL);
    expect(
      mutationFor("storageLayouts/zones:archiveStorageZone"),
    ).not.toHaveBeenCalled();
    await nativeBack();
    expect(href()).toBe(ORIGIN);
  });
});

describe("exact position manager steps", () => {
  const exact = {
    positionId: "p1",
    revision: "2:2",
    locationId: "l1",
    code: "PD-F01-Z01-P1",
    label: "P1",
    qrValue: "ISAS:LOCATION:1:l1",
    kind: "FLOOR" as const,
    isDefault: false,
    xMm: 0,
    yMm: 0,
    widthMm: 1_000,
    depthMm: 1_000,
    breadcrumb: "",
    placements: [],
  };
  const grid = zone({ mode: "FLOOR_POSITIONS", positions: [exact] });

  it("native Back returns from editing a position to the manager with the add draft retained", async () => {
    guarded(
      <StoragePositionsDialog
        warehouseId="warehouse-a"
        zone={grid}
        onClose={vi.fn()}
      />,
    );
    await screen.findByRole("dialog", {
      name: "Exact positions · PD-F01-Z01",
    });
    fireEvent.change(screen.getByLabelText("Position marker / code"), {
      target: { value: "P-12" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Edit PD-F01-Z01-P1" }));
    await waitFor(() => expect(params().get("positionEdit")).toBe("1"));
    expect(screen.getByRole("form", { name: "Save position" })).toBeVisible();
    await nativeBack();
    await waitFor(() =>
      expect(screen.queryByRole("form", { name: "Save position" })).toBeNull(),
    );
    expect(
      screen.getByRole("dialog", { name: "Exact positions · PD-F01-Z01" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Position marker / code")).toHaveValue("P-12");
  });

  it("a saved position edit consumes its step and keeps the manager open", async () => {
    guarded(
      <StoragePositionsDialog
        warehouseId="warehouse-a"
        zone={grid}
        onClose={vi.fn()}
      />,
    );
    await screen.findByRole("dialog", {
      name: "Exact positions · PD-F01-Z01",
    });
    const before = window.history.state.appNavigationIndex as number;
    fireEvent.click(screen.getByRole("button", { name: "Edit PD-F01-Z01-P1" }));
    const form = await screen.findByRole("form", { name: "Save position" });
    fireEvent.change(within(form).getByLabelText("Position label"), {
      target: { value: "Marker 1" },
    });
    fireEvent.click(
      within(form).getByRole("button", { name: "Save position" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("form", { name: "Save position" })).toBeNull(),
    );
    await waitFor(() => expect(params().get("positionEdit")).toBeNull());
    expect(window.history.state.appNavigationIndex).toBe(before);
    expect(
      mutationFor("storageLayouts/zones:updateStoragePosition"),
    ).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Marker 1", expectedRevision: "2:2" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Exact positions · PD-F01-Z01" }),
    ).toBeVisible();
  });
});

describe("registered location layout completion", () => {
  const registration = (floorNumber?: number) => ({
    locationId: "named-a",
    buildingId: "pd",
    buildingName: "PD",
    buildingCode: "PD",
    code: "DOCK SHELF",
    name: "Dock shelf",
    layoutPending: true,
    ...(floorNumber === undefined ? {} : { floorNumber, floorId: "f2" }),
  });
  function seed(floorNumber?: number) {
    mocks.queries.set("finishedGoods/jobScanLocations:page", {
      ok: true,
      value: {
        status: "ready",
        page: [{ _id: "named-a", location: registration(floorNumber) }],
        items: [registration(floorNumber)],
        isDone: true,
        continueCursor: "",
      },
    });
    mocks.queries.set("storageLayouts/namedLayout:namedLocationLayoutTarget", {
      ok: true,
      value: {
        found: true,
        locationId: "named-a",
        code: "DOCK SHELF",
        version: 1,
        layoutPending: true,
        buildingStatus: "ACTIVE",
        ...(floorNumber === undefined ? {} : { floorNumber }),
      },
    });
    mocks.queries.set("storageLayouts/catalogue:getStorageBuildingLayout", {
      ok: true,
      value: {
        found: true,
        building: { ...building, floorCount: 2 },
        floors: [floor(), floor({ floorId: "f2", floorNumber: 2 })],
      },
    });
  }
  const catalogue = () => (
    <NamedLocationCatalogue
      warehouseId="warehouse-a"
      search=""
      status="ALL"
      building="ALL"
      floor="ALL"
    />
  );
  const fill = (name: string, value: string) =>
    fireEvent.change(screen.getByLabelText(name), { target: { value } });

  it("locks an assigned floor, completes on that floor and consumes the dialog entry", async () => {
    seed(2);
    guarded(catalogue());
    fireEvent.click(
      screen.getByRole("button", { name: "Complete layout · DOCK SHELF" }),
    );
    await screen.findByRole("dialog", { name: "Complete layout · DOCK SHELF" });
    expect(screen.getByRole("combobox", { name: "Floor" })).toBeDisabled();
    expect(screen.getByTestId("named-floor-locked")).toHaveTextContent(
      "Registered on floor 2. Job records keep that floor",
    );
    fill("Width (m)", "1.2");
    fill("Depth (m)", "1");
    fill("X position (m)", "0");
    fill("Y position (m)", "0");
    fill("Maximum stack height (m)", "2.5");
    fireEvent.click(screen.getByRole("button", { name: "Add to floor plan" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(
      mutationFor("storageLayouts/namedLayout:completeNamedLocationLayout"),
    ).toHaveBeenCalledWith(expect.objectContaining({ floorNumber: 2 }));
    expect(
      screen.getByText(
        "DOCK SHELF is now on floor 2. Its code and QR are unchanged.",
      ),
    ).toBeVisible();
    await waitFor(() => expect(href()).toBe(BUILDING_URL));
    await nativeBack();
    expect(href()).toBe(ORIGIN);
  });

  it("explains a floor conflict refusal and keeps the measured draft", async () => {
    seed();
    mutationFor(
      "storageLayouts/namedLayout:completeNamedLocationLayout",
    ).mockResolvedValue({
      ok: true,
      value: {
        written: false,
        error: { code: "NAMED_LOCATION_FLOOR_CONFLICT", field: "floorNumber" },
      },
    });
    guarded(catalogue());
    fireEvent.click(
      screen.getByRole("button", { name: "Complete layout · DOCK SHELF" }),
    );
    await screen.findByRole("dialog", { name: "Complete layout · DOCK SHELF" });
    expect(screen.getByRole("combobox", { name: "Floor" })).toBeEnabled();
    fill("Width (m)", "1.2");
    fill("Depth (m)", "1");
    fill("X position (m)", "0");
    fill("Y position (m)", "0");
    fill("Maximum stack height (m)", "2.5");
    fireEvent.click(screen.getByRole("button", { name: "Add to floor plan" }));
    expect(
      await screen.findByText(/registered on another floor/),
    ).toBeVisible();
    expect(screen.getByLabelText("Width (m)")).toHaveValue(1.2);
  });

  it("Cancel closes the unsent registration layout after consent and the next Back leaves", async () => {
    seed();
    guarded(catalogue());
    fireEvent.click(
      screen.getByRole("button", { name: "Complete layout · DOCK SHELF" }),
    );
    await screen.findByRole("dialog", { name: "Complete layout · DOCK SHELF" });
    fill("Width (m)", "1.2");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await prompt();
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(href()).toBe(BUILDING_URL));
    await nativeBack();
    expect(href()).toBe(ORIGIN);
  });
});

describe("building settings and creation", () => {
  it("native Back dismisses building settings before leaving the building", async () => {
    guarded(
      <BuildingSettingsDialog warehouseId="warehouse-a" building={building} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Edit building settings" }),
    );
    await screen.findByRole("dialog", { name: "Building dimensions" });
    await nativeBack();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(href()).toBe(BUILDING_URL);
    await nativeBack();
    expect(href()).toBe(ORIGIN);
  });

  it("native Back keeps a pending floor removal confirmation and its settings open", async () => {
    let finish!: (value: unknown) => void;
    mutationFor("storageLayouts/writes:removeTopStorageFloor").mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    guarded(
      <BuildingSettingsDialog
        warehouseId="warehouse-a"
        building={{ ...building, floorCount: 2 }}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Edit building settings" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Remove empty floor 2" }),
    );
    const confirm = await screen.findByRole("dialog", {
      name: "Remove floor 2?",
    });
    fireEvent.click(
      within(confirm).getByRole("button", { name: "Remove floor" }),
    );
    await nativeBack();
    expect(
      screen.getByRole("dialog", { name: "Remove floor 2?" }),
    ).toBeVisible();
    const keep = screen.queryByRole("button", { name: "Keep editing" });
    if (keep) fireEvent.click(keep);
    await act(async () =>
      finish({ ok: true, value: { written: true, documentId: "pd" } }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Remove floor 2?" }),
      ).toBeNull(),
    );
    expect(
      screen.getByRole("dialog", { name: "Building dimensions" }),
    ).toBeVisible();
    expect(screen.getByText("Floor 2 removed.")).toBeVisible();
  });

  it("blocks native Back while building creation is in flight", async () => {
    window.history.pushState({}, "", "/en/master-data/storage-layouts/new");
    let finish!: (value: unknown) => void;
    mutationFor("storageLayouts/writes:createStorageBuilding").mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    guarded(<NewStorageBuildingForm />);
    const fill = (name: RegExp, value: string, role = "spinbutton") =>
      fireEvent.change(screen.getByRole(role, { name }), {
        target: { value },
      });
    fill(/Building code/, "PD", "textbox");
    fill(/Building name/, "PD", "textbox");
    fill(/Width/, "20");
    fill(/Depth/, "11.96");
    fill(/Floor height/, "4");
    fireEvent.click(screen.getByRole("button", { name: "Create building" }));
    await nativeBack();
    expect(window.location.pathname).toBe(
      "/en/master-data/storage-layouts/new",
    );
    const keep = screen.queryByRole("button", { name: "Keep editing" });
    if (keep) fireEvent.click(keep);
    await act(async () =>
      finish({
        ok: true,
        value: { written: true, documentId: "pd-new", replayed: false },
      }),
    );
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith(
        "/master-data/storage-layouts/pd-new",
      ),
    );
  });
});

describe("layout task intent", () => {
  it("separates find, store and edit tasks and keeps viewing read-only", async () => {
    guarded(workspace([floor({ storageZones: [zone()] })]));
    const tasks = screen.getByRole("group", { name: "Task" });
    expect(
      within(tasks).getByRole("button", { name: "Find and view" }),
    ).toHaveAttribute("aria-pressed", "true");
    // Storing is the existing Finished goods selection flow; a draft
    // building cannot store yet, and nothing implies a selected unit.
    expect(
      within(tasks).getByRole("button", { name: "Store goods" }),
    ).toBeDisabled();
    expect(
      screen.getByText("Storing is available after the building is activated."),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Add storage spot" }),
    ).toBeNull();
    fireEvent.click(
      within(tasks).getByRole("button", { name: "Edit floor 1" }),
    );
    await waitFor(() => expect(params().get("editing")).toBe("1"));
    expect(
      screen.getByRole("button", { name: "Add storage spot" }),
    ).toBeVisible();
    expect(params().get("kept")).toBe("yes");
    expect(window.location.hash).toBe("#map");
  });

  it("links an active building's Store task to the inventory selection flow", () => {
    guarded(
      workspace([floor({ storageZones: [zone()] })], {
        ...building,
        status: "ACTIVE",
      }),
    );
    const store = within(screen.getByRole("group", { name: "Task" })).getByRole(
      "link",
      { name: "Store goods" },
    );
    expect(store).toHaveAttribute("href", "/finished-goods");
    expect(store).toHaveAccessibleDescription(
      "Choose a unit in Finished goods, then use Store to pick its spot here.",
    );
  });

  it("opens layout help with the business checklist and QR explanation", async () => {
    guarded(
      workspace([
        floor({ storageZones: [zone({ mode: "RACK", positions: [] })] }),
      ]),
    );
    fireEvent.click(screen.getByRole("button", { name: "Layout help" }));
    const help = await screen.findByRole("dialog", {
      name: "Set up a storage layout",
    });
    const items = within(help).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Building measured and named · Done",
      "Floors match the real building · Done",
      "Storage spots placed on each used floor · Done",
      "Exact positions added for rack, platform or grid spots (optional) · To do",
      "Reviewed and activated · To do",
    ]);
    expect(help).toHaveTextContent("Spot QR and exact position QR");
    expect(help).toHaveTextContent("Connection status is on the Setup page");
    await nativeBack();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(href()).toBe(BUILDING_URL);
  });
});

describe("storage foreground caller regressions", () => {
  it("native Back dismisses the mobile location inspector before leaving the building", async () => {
    const original = window.matchMedia;
    const media = vi
      .spyOn(window, "matchMedia")
      .mockImplementation((query) => ({
        ...original(query),
        matches: [
          "(max-width: 580px)",
          "(max-width: 850px)",
          "(max-width: 1099px)",
          "(max-width: 1399px)",
        ].includes(query),
      }));
    try {
      guarded(workspace([floor({ storageZones: [zone()] })]));
      fireEvent.click(
        screen.getByRole("button", { name: "Select location Rack A" }),
      );
      expect(
        await screen.findByRole("dialog", { name: "Location details" }),
      ).toBeVisible();
      await nativeBack();
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );
      expect(href()).toBe(BUILDING_URL);
      expect(
        screen.getByRole("button", { name: "Select location Rack A" }),
      ).toHaveAttribute("aria-pressed", "true");
      await nativeBack();
      expect(href()).toBe(ORIGIN);
    } finally {
      media.mockRestore();
    }
  });

  it("native Back guards unsent unavailable-area edits and keeps the area draft", async () => {
    guarded(workspace());
    fireEvent.click(screen.getByRole("button", { name: "Edit floor 1" }));
    await openFloorDimensions();
    fireEvent.click(
      screen.getByRole("button", { name: "Add unavailable area" }),
    );
    const area = await screen.findByRole("dialog", {
      name: "Add unavailable area",
    });
    fireEvent.change(within(area).getByRole("textbox", { name: "Name" }), {
      target: { value: "Unsent lift core" },
    });
    await nativeBack();
    const guard = await prompt();
    fireEvent.click(
      within(guard).getByRole("button", { name: "Keep editing" }),
    );
    expect(within(area).getByRole("textbox", { name: "Name" })).toHaveValue(
      "Unsent lift core",
    );
    expect(href()).toContain("editing=1");
    expect(mocks.mutations.size).toBeGreaterThan(0);
    for (const mutation of mocks.mutations.values())
      expect(mutation).not.toHaveBeenCalled();
  });

  it("discarding only the unavailable-area foreground retains dirty floor dimensions", async () => {
    guarded(workspace());
    fireEvent.click(screen.getByRole("button", { name: "Edit floor 1" }));
    fireEvent.change(await openFloorDimensions(), {
      target: { value: "19.995" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Add unavailable area" }),
    );
    const area = await screen.findByRole("dialog", {
      name: "Add unavailable area",
    });
    fireEvent.change(within(area).getByRole("textbox", { name: "Name" }), {
      target: { value: "Discard only this" },
    });
    await nativeBack();
    fireEvent.click(
      within(await prompt()).getByRole("button", { name: /Discard/ }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Add unavailable area" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("spinbutton", { name: "Width (m)" })).toHaveValue(
      19.995,
    );
    expect(params().get("editing")).toBe("1");
    await nativeBack();
    expect(await prompt()).toBeVisible();
    fireEvent.click(
      within(await prompt()).getByRole("button", { name: "Keep editing" }),
    );
    expect(screen.getByRole("spinbutton", { name: "Width (m)" })).toHaveValue(
      19.995,
    );
  });

  it("native Back cancels exact position archive before dismissing its retained manager", async () => {
    const exact = {
      positionId: "p1",
      revision: "2:2",
      locationId: "l1",
      code: "PD-F01-Z01-P1",
      label: "P1",
      qrValue: "ISAS:LOCATION:1:l1",
      kind: "FLOOR" as const,
      isDefault: false,
      xMm: 0,
      yMm: 0,
      widthMm: 1000,
      depthMm: 1000,
      breadcrumb: "",
      placements: [],
    };
    const close = vi.fn();
    guarded(
      <StoragePositionsDialog
        warehouseId="warehouse-a"
        zone={zone({ mode: "FLOOR_POSITIONS", positions: [exact] })}
        onClose={close}
      />,
    );
    const archiveButton = await screen.findByRole("button", {
      name: "Archive PD-F01-Z01-P1",
    });
    const managerHref = href();
    fireEvent.click(archiveButton);
    expect(
      await screen.findByRole("dialog", { name: "Archive PD-F01-Z01-P1" }),
    ).toBeVisible();
    await nativeBack();
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Archive PD-F01-Z01-P1" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("dialog", { name: "Exact positions · PD-F01-Z01" }),
    ).toBeVisible();
    expect(
      mutationFor("storageLayouts/zones:archiveStoragePosition"),
    ).not.toHaveBeenCalled();
    expect(href()).toBe(managerHref);
    await nativeBack();
    expect(close).toHaveBeenCalledOnce();
    expect(href()).toBe(BUILDING_URL);
  });
});
