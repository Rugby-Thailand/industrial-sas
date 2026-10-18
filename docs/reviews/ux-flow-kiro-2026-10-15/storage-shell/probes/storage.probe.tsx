/**
 * Kiro UX-flow probes — storage layout screens (SS-02, SS-04, SS-05).
 * Each test asserts the EXPECTED behaviour; a failure on current source is the
 * evidence. Mocks mirror src/features/storageLayouts/StorageLayoutScreens.test.tsx
 * (Convex, workspace access, router, Clerk and QueryGate seams only).
 */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import type * as WorkspaceModule from "@/components/providers/WorkspaceProvider";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mutation = vi.hoisted(() => vi.fn());
const navigate = vi.hoisted(() => vi.fn());
const access = vi.hoisted(() => ({
  building: vi.fn<() => unknown>(),
  query: vi.fn<(ref: unknown, args: unknown) => unknown>(),
}));

vi.mock("@/features/storageLayouts/useStorageBuilding", () => ({
  useStorageBuilding: () => access.building(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: navigate,
    back: () => window.history.back(),
    replace: navigate,
  }),
}));
vi.mock("convex/react", () => ({
  useMutation: () => mutation,
  useQuery: (ref: unknown, args: unknown) =>
    args === "skip" ? undefined : access.query(ref, args),
}));
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ userId: "user-a", orgId: "org-a" }),
}));
vi.mock("@/components/providers/WorkspaceProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof WorkspaceModule>()),
  useWorkspace: () => ({
    permissionsReady: true,
    navigationPermissions: [
      "masterData.storageLayout.read",
      "masterData.storageLayout.manage",
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
  useRouter: () => ({
    push: navigate,
    back: () => window.history.back(),
    replace: navigate,
  }),
}));

import { renderWithIntl } from "@tests/fixtures/intl-render";
import type {
  StorageBuildingRow,
  StorageFloorRow,
} from "@/lib/convex/storageLayoutApi";
import {
  BuildingModelWorkspace,
  StorageBuildingCatalogue,
  StorageBuildingEditor,
  StorageBuildingReview,
} from "@/features/storageLayouts/StorageLayoutScreens";

const building: StorageBuildingRow = {
  buildingId: "building-a",
  warehouseId: "warehouse-a",
  code: "BLDG-A",
  name: "Main storage",
  widthMm: 30_000,
  depthMm: 20_000,
  defaultFloorHeightMm: 4_000,
  floorCount: 1,
  totalHeightMm: 4_000,
  grossAreaSqMm: 600_000_000,
  reservedAreaSqMm: 0,
  usableAreaSqMm: 600_000_000,
  status: "DRAFT",
  version: 2,
};

const emptyFloors: readonly StorageFloorRow[] = [
  {
    floorId: "floor-1",
    floorNumber: 1,
    grossAreaSqMm: 600_000_000,
    reservedAreaSqMm: 0,
    usableAreaSqMm: 600_000_000,
    version: 1,
    storageZones: [],
    reservedBlocks: [],
  },
];

beforeEach(() => {
  window.history.replaceState({}, "", "/");
  window.localStorage.clear();
  window.sessionStorage.clear();
  navigate.mockReset();
  access.building.mockReset().mockReturnValue(undefined);
  access.query.mockReset().mockReturnValue(undefined);
  mutation
    .mockReset()
    .mockResolvedValue({
      ok: true,
      value: { written: true, documentId: "zone-new" },
    });
});

describe("SS-02 building route recovery states", () => {
  it.each([
    ["building", () => <StorageBuildingEditor buildingId="building-a" />],
    ["review", () => <StorageBuildingReview buildingId="building-a" />],
  ])(
    "SS-02 %s not-found state gives a heading and a way back to the catalogue",
    (_name, ui) => {
      access.building.mockReturnValue({ ok: true, value: { found: false } });
      renderWithIntl(ui(), { locale: "en", workspace: false });
      expect(screen.getByText("Storage building not found.")).toBeVisible();
      console.info(
        "SS-02 headings:",
        screen.queryAllByRole("heading").map((h) => h.textContent),
        "links:",
        screen.queryAllByRole("link").map((a) => a.getAttribute("href")),
        "buttons:",
        screen.queryAllByRole("button").map((b) => b.textContent),
      );
      expect(screen.queryAllByRole("heading").length).toBeGreaterThan(0);
      expect(
        screen
          .queryAllByRole("link")
          .some(
            (a) => a.getAttribute("href") === "/master-data/storage-layouts",
          ),
      ).toBe(true);
    },
  );

  it("SS-02 building read-failure state offers a retry or way back", () => {
    access.building.mockReturnValue({
      ok: false,
      denial: { code: "INTERNAL", requestId: "r" },
    });
    renderWithIntl(<StorageBuildingEditor buildingId="building-a" />, {
      locale: "en",
      workspace: false,
    });
    expect(
      screen.getByText("The storage layout could not be loaded."),
    ).toBeVisible();
    expect(
      screen.queryAllByRole("link").length +
        screen.queryAllByRole("button").length,
    ).toBeGreaterThan(0);
  });
});

describe("SS-04 empty building catalogue", () => {
  it("SS-04 a warehouse with no buildings and no filters gets the first-building empty state", () => {
    access.query.mockReturnValue({
      ok: true,
      value: { status: "ready", page: [], isDone: true, continueCursor: "" },
    });
    renderWithIntl(<StorageBuildingCatalogue />, {
      locale: "en",
      workspace: false,
    });
    // Precondition: default filters (search empty, status ALL).
    expect(screen.getByRole("searchbox", { name: "Search buildings" })).toHaveValue(
      "",
    );
    console.info(
      "SS-04 empty-state text:",
      JSON.stringify(
        document.querySelector("[data-slot=empty-state], .empty-state")
          ?.textContent ?? document.body.textContent?.slice(0, 400),
      ),
    );
    expect(screen.queryByText("No buildings match these filters")).toBeNull();
    expect(screen.getByText("No storage buildings yet")).toBeVisible();
  });

  it("SS-04 Thai: no buildings and no filters is not described as a filter mismatch", () => {
    access.query.mockReturnValue({
      ok: true,
      value: { status: "ready", page: [], isDone: true, continueCursor: "" },
    });
    renderWithIntl(<StorageBuildingCatalogue />, {
      locale: "th",
      workspace: false,
    });
    expect(screen.queryByText("ไม่มีอาคารที่ตรงกับตัวกรอง")).toBeNull();
  });
});

function openCreate() {
  renderWithIntl(
    <BuildingModelWorkspace building={building} floors={emptyFloors} />,
    { locale: "en", workspace: false, preserveProviders: true },
  );
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
  fireEvent.click(screen.getByRole("button", { name: "Add storage stack" }));
  expect(
    screen.getByRole("dialog", { name: "Add storage stack" }),
  ).toBeVisible();
}

async function submitCreate(expectedLabel: string) {
  const create = screen.getByRole("button", { name: "Create storage stack" });
  expect(create).toBeEnabled();
  fireEvent.click(create);
  await waitFor(() =>
    expect(mutation).toHaveBeenCalledWith(
      expect.objectContaining({ label: expectedLabel, floorNumber: 1 }),
    ),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Add storage stack" }),
    ).not.toBeInTheDocument(),
  );
  // Let the history/back bookkeeping settle.
  await new Promise((resolve) => setTimeout(resolve, 50));
}

describe("SS-05 compact workspace create: successful write feedback", () => {
  it("SS-05 a successful create with a typed name does not ask to save/discard the just-saved draft", async () => {
    openCreate();
    fireEvent.change(screen.getByRole("textbox", { name: "Zone label" }), {
      target: { value: "Dock FG" },
    });
    await submitCreate("Dock FG");
    const prompt = screen.queryByRole("dialog", {
      name: "Save changes before leaving?",
    });
    console.info(
      "SS-05 unsaved-changes prompt after successful create:",
      prompt !== null,
      "url:",
      window.location.search,
    );
    expect(prompt).toBeNull();
  });

  it("SS-05 control: a successful create with the default name closes without a prompt", async () => {
    openCreate();
    await submitCreate("Storage stack 1");
    const prompt = screen.queryByRole("dialog", {
      name: "Save changes before leaving?",
    });
    console.info(
      "SS-05 control prompt:",
      prompt !== null,
      "url:",
      window.location.search,
    );
    expect(prompt).toBeNull();
  });

  it("SS-05b a successful create (no selection) shows a success receipt", async () => {
    openCreate();
    await submitCreate("Storage stack 1");
    const receipt = screen.queryByText(/^Storage stack created\./);
    console.info("SS-05b receipt present:", receipt !== null);
    expect(receipt).not.toBeNull();
  });

  it("SS-05 observation: what each prompt choice does after the write already succeeded", async () => {
    openCreate();
    await submitCreate("Storage stack 1");
    const callsAfterCreate = mutation.mock.calls.length;
    const prompt = screen.queryByRole("dialog", {
      name: "Save changes before leaving?",
    });
    if (!prompt) {
      console.info("SS-05 observation: no prompt");
      return;
    }
    const saveButton = screen.getByRole("button", {
      name: "Save and continue",
    });
    console.info(
      "SS-05 observation: Save and continue enabled:",
      !(saveButton as HTMLButtonElement).disabled,
    );
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    console.info(
      "SS-05 observation after Keep editing: url",
      window.location.search,
      "editor dialog open:",
      screen.queryByRole("dialog", { name: "Add storage stack" }) !== null,
      "extra writes:",
      mutation.mock.calls.length - callsAfterCreate,
    );
    expect(mutation.mock.calls.length - callsAfterCreate).toBe(0);
  });

  it("SS-05 observation: choosing Save and continue after the successful create", async () => {
    openCreate();
    await submitCreate("Storage stack 1");
    const callsAfterCreate = mutation.mock.calls.length;
    if (
      !screen.queryByRole("dialog", { name: "Save changes before leaving?" })
    ) {
      console.info("SS-05 save observation: no prompt");
      return;
    }
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    console.info(
      "SS-05 save observation: extra writes",
      mutation.mock.calls.length - callsAfterCreate,
      mutation.mock.calls.slice(callsAfterCreate).map((call) =>
        Object.keys(call[0] ?? {}).sort().join(","),
      ),
      "url:",
      window.location.search,
      "prompt still open:",
      screen.queryByRole("dialog", { name: "Save changes before leaving?" }) !==
        null,
    );
    expect(mutation.mock.calls.length - callsAfterCreate).toBe(0);
  });
});

describe("SS-05 compact workspace update", () => {
  it("SS-05 a successful location rename from the map does not raise an unsaved-changes prompt", async () => {
    const zone = {
      zoneId: "zone-a",
      locationId: "location-a",
      code: "FG-1",
      label: "Dock FG",
      qrValue: "QR-1",
      mode: "SIMPLE" as const,
      xMm: 0,
      yMm: 0,
      widthMm: 2_000,
      depthMm: 2_000,
      maxStackHeightMm: 3_000,
      positions: [],
      placements: [],
    };
    window.history.replaceState({}, "", "/?floor=1&editZone=zone-a");
    renderWithIntl(
      <BuildingModelWorkspace
        building={building}
        floors={[{ ...emptyFloors[0]!, storageZones: [zone] }]}
      />,
      { locale: "en", workspace: false, preserveProviders: true },
    );
    await screen.findByRole("dialog", { name: "Edit storage stack" });
    fireEvent.change(screen.getByRole("textbox", { name: "Zone label" }), {
      target: { value: "Dock FG renamed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(mutation).toHaveBeenCalledWith(
        expect.objectContaining({ label: "Dock FG renamed", zoneId: "zone-a" }),
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Edit storage stack" }),
      ).not.toBeInTheDocument(),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    const prompt = screen.queryByRole("dialog", {
      name: "Save changes before leaving?",
    });
    console.info("SS-05 update prompt:", prompt !== null);
    expect(prompt).toBeNull();
  });
});
