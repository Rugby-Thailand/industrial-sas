import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSyncExternalStore, type ComponentProps } from "react";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { DraftGuardProvider } from "@/components/providers/DraftGuardProvider";
import {
  WAREHOUSE_STORAGE_KEY,
  readStoredWarehouse,
  serverWarehouseSnapshot,
  subscribeWarehouse,
  writeStoredWarehouse,
} from "@/lib/workspace/warehouseStore";
import { JobScanScreen } from "@/features/finishedGoods/jobScan/JobScanScreen";

// Known item re-check (storage-actions-2026-10-13 F05, source-only there):
// the real warehouse store + real QueryGate remount Job tickets with no guard.
// Only the provider's server snapshot is replaced by the real local store.

vi.mock("@/components/providers/WorkspaceProvider", () => ({
  useWorkspace: () => {
    const selected = useSyncExternalStore(
      subscribeWarehouse,
      readStoredWarehouse,
      serverWarehouseSnapshot,
    );
    return {
      readiness: { kind: "READY_TO_QUERY" },
      selectedWarehouseId: selected ?? undefined,
    };
  },
}));
vi.mock("@/features/finishedGoods/BarcodeCameraBox", () => ({
  BarcodeCameraBox: () => null,
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...props }: ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));
vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
  useAction: () => vi.fn(),
}));
vi.mock("@/hooks/useDraftKey", () => ({ useDraftKey: () => "actor-a" }));
vi.mock("@/hooks/useCanManage", () => ({ useCanManage: () => true }));
vi.mock("@/lib/uploadthing", () => ({
  useUploadThing: () => ({ startUpload: () => Promise.resolve(undefined) }),
}));
vi.mock("@/features/finishedGoods/jobScan/LocationPicker", () => ({
  LocationPicker: ({
    onPick,
  }: {
    onPick: (location: { text: string }) => void;
  }) => <button onClick={() => onPick({ text: "DOCK-01" })}>Pick Dock</button>,
}));

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(WAREHOUSE_STORAGE_KEY, "warehouse-a");
  window.history.replaceState(
    { appNavigationIndex: 1 },
    "",
    "/en/finished-goods/scan",
  );
});
afterEach(() => vi.restoreAllMocks());

function typedTicket() {
  renderWithIntl(
    <DraftGuardProvider>
      <JobScanScreen />
    </DraftGuardProvider>,
    { locale: "en" },
  );
  fireEvent.click(screen.getByRole("button", { name: "Pick Dock" }));
  fireEvent.click(screen.getByRole("button", { name: "Type manually" }));
  fireEvent.change(screen.getByRole("textbox", { name: /Job No\./ }), {
    target: { value: "FO69070073" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: /Product barcode/ }), {
    target: { value: "DEMO-BOX" },
  });
  expect(screen.getByDisplayValue("FO69070073")).toBeVisible();
}
const ticketOrPrompt = () =>
  screen.queryByDisplayValue("FO69070073") ??
  screen.queryByRole("button", { name: "Keep editing" });

it("DESIRED: switching warehouse in this tab keeps or asks about an unsent ticket", () => {
  typedTicket();
  act(() => writeStoredWarehouse("warehouse-b"));
  expect(ticketOrPrompt()).not.toBeNull();
});

it("DESIRED: a warehouse change made in another tab keeps or asks about an unsent ticket", () => {
  typedTicket();
  act(() => {
    localStorage.setItem(WAREHOUSE_STORAGE_KEY, "warehouse-b");
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: WAREHOUSE_STORAGE_KEY,
        newValue: "warehouse-b",
      }),
    );
  });
  expect(ticketOrPrompt()).not.toBeNull();
});
