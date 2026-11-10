import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ComponentProps, ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as WorkspaceModule from "@/components/providers/WorkspaceProvider";

const mocks = vi.hoisted(() => ({ save: vi.fn(), otherWrite: vi.fn() }));
vi.mock("convex/react", () => ({
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref) === "storageLayouts/writes:saveStorageFloor"
      ? mocks.save
      : mocks.otherWrite,
  useQuery: () => undefined,
}));
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ userId: "user-a", orgId: "org-a" }),
}));
vi.mock("@/components/providers/WorkspaceProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof WorkspaceModule>()),
  useWorkspace: () => ({
    permissionsReady: true,
    navigationPermissions: ["masterData.storageLayout.manage"],
    warehouses: [{ id: "warehouse-a", code: "TG", name: "TG-OPT" }],
  }),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...props }: ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import { renderWithIntl } from "@tests/fixtures/intl-render";
import { DraftGuardProvider } from "@/components/providers/DraftGuardProvider";
import { trackAppHistory } from "@/lib/browser/appHistory";
import { isGuardTraversal } from "@/lib/navigationGuard";
import type {
  StorageBuildingRow,
  StorageFloorRow,
} from "@/lib/convex/storageLayoutApi";
import { BuildingModelWorkspace } from "./StorageLayoutScreens";

const origin = "/en/master-data/storage-layouts?search=pd#catalogue";
const buildingUrl = "/en/master-data/storage-layouts/pd?floor=1&kept=yes#map";
const href = () =>
  window.location.pathname + window.location.search + window.location.hash;
const building: StorageBuildingRow = {
  buildingId: "pd",
  warehouseId: "warehouse-a",
  code: "PD",
  name: "PD",
  widthMm: 20_000,
  depthMm: 12_000,
  defaultFloorHeightMm: 4_000,
  floorCount: 1,
  totalHeightMm: 4_000,
  grossAreaSqMm: 240_000_000,
  reservedAreaSqMm: 0,
  usableAreaSqMm: 240_000_000,
  status: "DRAFT",
  version: 5,
};
const floor: StorageFloorRow = {
  floorId: "f1",
  floorNumber: 1,
  grossAreaSqMm: 240_000_000,
  reservedAreaSqMm: 0,
  usableAreaSqMm: 240_000_000,
  version: 3,
  storageZones: [],
  reservedBlocks: [],
};
const workspace = (nextFloor = floor, nextBuilding = building) => (
  <DraftGuardProvider>
    <BuildingModelWorkspace building={nextBuilding} floors={[nextFloor]} />
  </DraftGuardProvider>
);
let stop: (() => void) | undefined;
beforeEach(() => {
  mocks.save.mockReset();
  mocks.otherWrite.mockReset();
  window.history.replaceState({ appNavigationIndex: 0 }, "", origin);
  stop = trackAppHistory();
  window.history.pushState({}, "", buildingUrl);
});
afterEach(() => {
  cleanup();
  stop?.();
});
const mount = (ui: ReactElement) =>
  renderWithIntl(ui, {
    locale: "en",
    workspace: false,
    preserveProviders: true,
  });
async function openDimensions() {
  fireEvent.click(screen.getByRole("button", { name: "Edit floor 1" }));
  fireEvent.click(
    await screen.findByRole("button", { name: /Floor dimensions/ }),
  );
  return screen.getByRole("spinbutton", { name: "Width (m)" });
}
async function nativeBack() {
  await act(async () => {
    window.history.back();
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
  });
}

describe("floor draft caller reconciliation", () => {
  it("adopts a clean authoritative refresh without remounting the floor controls", async () => {
    const view = mount(workspace());
    const width = await openDimensions();
    view.rerender(
      workspace(
        { ...floor, widthMm: 18_125, version: 4 },
        { ...building, version: 6 },
      ),
    );
    expect(screen.getByRole("spinbutton", { name: "Width (m)" })).toBe(width);
    expect(width).toHaveValue(18.125);
    expect(screen.queryByTestId("floor-version-conflict")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Find and view" }));
    await waitFor(() => expect(href()).toBe(buildingUrl));
    await nativeBack();
    expect(href()).toBe(origin);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("protects a pending floor save through live refresh, then reconciles success before the next Back", async () => {
    let finish!: (value: unknown) => void;
    mocks.save.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const view = mount(workspace());
    const width = await openDimensions();
    fireEvent.change(width, { target: { value: "19.995" } });
    fireEvent.click(screen.getByRole("button", { name: "Save floor" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedBuildingVersion: 5,
        expectedFloorVersion: 3,
        floor: expect.objectContaining({ widthMm: 19_995 }),
      }),
    );
    view.rerender(
      workspace(
        { ...floor, widthMm: 19_995, version: 4 },
        { ...building, version: 6 },
      ),
    );
    expect(screen.getByRole("spinbutton", { name: "Width (m)" })).toBe(width);
    expect(width).toHaveValue(19.995);
    expect(width).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    const pendingHref = href();
    await nativeBack();
    expect(href()).toBe(pendingHref);
    expect(
      screen.queryByRole("dialog", { name: "Save changes before leaving?" }),
    ).toBeNull();
    await act(async () => {
      finish({ ok: true, value: { written: true } });
    });
    await waitFor(() => expect(width).toBeEnabled());
    await waitFor(() => expect(isGuardTraversal()).toBe(false));
    expect(screen.getByRole("spinbutton", { name: "Width (m)" })).toBe(width);
    expect(screen.queryByTestId("floor-version-conflict")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Find and view" }));
    await waitFor(() => expect(href()).toBe(buildingUrl));
    expect(
      screen.queryByRole("dialog", { name: "Save changes before leaving?" }),
    ).toBeNull();
    await nativeBack();
    expect(href()).toBe(origin);
  });
});
