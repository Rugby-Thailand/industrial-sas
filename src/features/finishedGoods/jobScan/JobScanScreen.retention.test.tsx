import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { NavigationGuardProvider } from "@/components/navigation/NavigationGuardProvider";
import { WorkspaceProvider } from "@/components/providers/WorkspaceProvider";
import { guardedNavigate } from "@/lib/navigationGuard";
import { trackAppHistory } from "@/lib/browser/appHistory";
import {
  WAREHOUSE_STORAGE_KEY,
  readStoredWarehouse,
} from "@/lib/workspace/warehouseStore";
import type * as BarcodeImage from "../barcodeImage";
import { JobScanScreen } from "./JobScanScreen";

// Caller regressions for unsent Job ticket work (FG-UX-02, FG-UX-03, FG-UX-05).
// The real JobScanScreen, PhotoCapture, BarcodeCameraBox, BarcodeImagePicker,
// QueryGate, WorkspaceProvider, warehouse store and navigation guard run here.
// Only camera hardware, the image decoder and Convex transport are substituted.

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  decode: vi.fn<(...args: unknown[]) => Promise<string[]>>(),
  camera: undefined as ((code: string) => void) | undefined,
  locations: [] as string[],
}));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useQuery_experimental: () => ({
    status: "success",
    data: {
      ok: true,
      value: {
        organization: { id: "org", name: "Company" },
        warehouses: [
          { id: "warehouse-a", code: "A", name: "Warehouse A" },
          { id: "warehouse-b", code: "B", name: "Warehouse B" },
        ],
        navigationPermissions: [],
        complete: true,
      },
    },
  }),
  useMutation: () => mocks.save,
  useAction: () => vi.fn(),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...props }: ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
  useRouter: () => ({
    push: (href: string) => window.history.pushState({}, "", href),
    replace: (href: string) => window.history.replaceState({}, "", href),
    back: () => window.history.back(),
  }),
}));
vi.mock("@/hooks/useDraftKey", () => ({ useDraftKey: () => "actor-a" }));
vi.mock("@/hooks/useCanManage", () => ({ useCanManage: () => true }));
vi.mock("@/lib/uploadthing", () => ({
  useUploadThing: () => ({ startUpload: vi.fn() }),
}));
vi.mock("./playShutterSound", () => ({
  createShutterSound: () => ({
    prime: vi.fn(),
    play: vi.fn(),
    dispose: vi.fn(),
  }),
}));
vi.mock("./LocationPicker", () => ({
  LocationPicker: ({
    warehouseId,
    onPick,
  }: {
    warehouseId: string;
    onPick: (location: { text: string }) => void;
  }) => (
    mocks.locations.push(warehouseId),
    (
      <button onClick={() => onPick({ text: "DOCK-01" })}>
        Choose dock in {warehouseId}
      </button>
    )
  ),
}));
vi.mock("../useBarcodeCamera", () => ({
  useBarcodeCamera: ({ onCode }: { onCode: (code: string) => void }) => {
    mocks.camera = onCode;
    return {
      videoRef: { current: null },
      state: "ACTIVE",
      error: undefined,
      torchAvailable: false,
      torchOn: false,
      toggleTorch: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
  },
}));
vi.mock("../barcodeImage", async (original) => ({
  ...(await original<typeof BarcodeImage>()),
  readBarcodeImage: (...args: unknown[]) =>
    mocks.decode(...args).then((codes) => ({
      codes,
      reviewRequired: false,
      attempts: 1,
      elapsedMs: 1,
    })),
}));

let release: () => void;
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem(WAREHOUSE_STORAGE_KEY, "warehouse-a");
  mocks.save.mockReset();
  mocks.decode.mockReset();
  mocks.camera = undefined;
  mocks.locations.length = 0;
  window.history.replaceState(
    { appNavigationIndex: 0 },
    "",
    "/th/finished-goods?view=list#units",
  );
  release = trackAppHistory();
  window.history.pushState({}, "", "/th/finished-goods/scan?source=qa#tickets");
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: vi
        .fn()
        .mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }),
    },
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  let url = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:qa-${url++}`);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => {
  release();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function start() {
  renderWithIntl(
    <WorkspaceProvider>
      <NavigationGuardProvider>
        <JobScanScreen />
      </NavigationGuardProvider>
    </WorkspaceProvider>,
    { locale: "en", workspace: false },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Choose dock in warehouse-a" }),
  );
}
function collectPhotos(count: number) {
  fireEvent.click(screen.getByRole("button", { name: "Photo AI" }));
  fireEvent.change(
    screen.getByLabelText("Choose photos", { selector: "input" }),
    {
      target: {
        files: Array.from(
          { length: count },
          (_, index) =>
            new File([`ticket-${index}`], `ticket-${index}.jpg`, {
              type: "image/jpeg",
            }),
        ),
      },
    },
  );
  expect(screen.getByText(`${count} / 20 photos`)).toBeVisible();
}
function typeTicket() {
  fireEvent.click(screen.getByRole("button", { name: "Manual" }));
  fireEvent.change(screen.getByRole("textbox", { name: /Job No\./ }), {
    target: { value: "FO69070073" },
  });
}
function otherTab(warehouseId: string) {
  act(() => {
    localStorage.setItem(WAREHOUSE_STORAGE_KEY, warehouseId);
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: WAREHOUSE_STORAGE_KEY,
        newValue: warehouseId,
        storageArea: localStorage,
      }),
    );
  });
}
async function chooseImageCodes(codes: string[]) {
  mocks.decode.mockResolvedValueOnce(codes);
  fireEvent.change(screen.getByLabelText("Choose image"), {
    target: {
      files: [new File(["photo"], "ticket.webp", { type: "image/webp" })],
    },
  });
  fireEvent.click(
    await screen.findByRole("button", { name: "Use scanned code(s)" }),
  );
}

it("asks before leaving with collected photos that were not sent to AI, and Keep editing retains them", () => {
  start();
  collectPhotos(2);
  // No ticket exists yet: the photo collection is the only unsent work.
  expect(screen.queryByRole("textbox", { name: /Job No\./ })).toBeNull();
  const leave = vi.fn();
  act(() => guardedNavigate(leave));
  expect(
    screen.getByRole("dialog", { name: "Save changes before leaving?" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(leave).not.toHaveBeenCalled();
  expect(screen.getByText("2 / 20 photos")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Read 2 photos with AI" }),
  ).toBeEnabled();
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
});

it("retains unsent photos when switching to Scan code and back to Photo AI", () => {
  start();
  collectPhotos(2);
  fireEvent.click(screen.getByRole("button", { name: "Scan code" }));
  expect(screen.queryByText("2 / 20 photos")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Photo AI" }));
  expect(screen.getByText("2 / 20 photos")).toBeVisible();
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
});

it("native Back closes Photo AI and then the ticket step without discarding unsent photos for the same location choice", async () => {
  start();
  await waitFor(() => expect(window.location.search).toContain("jobScanStep"));
  collectPhotos(1);
  await waitFor(() => expect(window.location.search).toContain("overlay"));
  act(() => window.history.back());
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Photo AI" })).toHaveAttribute(
      "aria-pressed",
      "false",
    ),
  );
  act(() => window.history.back());
  await screen.findByRole("button", { name: "Choose dock in warehouse-a" });
  expect(window.location.pathname).toBe("/th/finished-goods/scan");
  expect(window.location.search).toBe("?source=qa");
  expect(window.location.hash).toBe("#tickets");
  // Returning to the location question is an earlier step, not a departure.
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Choose dock in warehouse-a" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Photo AI" }));
  expect(screen.getByText("1 / 20 photos")).toBeVisible();
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
});

it("announces the 50-ticket refusal and a successful read on the barcode image path", async () => {
  start();
  fireEvent.click(screen.getByRole("button", { name: "Scan code" }));
  await chooseImageCodes(["FO00001", "PRODUCT-1"]);
  expect(await screen.findByText("Barcode read")).toBeVisible();
  // Fill the group through the live camera, then return to an image.
  fireEvent.click(screen.getByRole("button", { name: "Start camera" }));
  act(() => {
    for (let index = 2; index <= 50; index++) {
      mocks.camera!(`FO${String(index).padStart(5, "0")}`);
      mocks.camera!(`PRODUCT-${index}`);
    }
  });
  expect(screen.getAllByRole("textbox", { name: /Job No\./ })).toHaveLength(50);
  await chooseImageCodes(["FO99999", "PRODUCT-LAST"]);
  expect(
    await screen.findByText(/This group holds up to 50 tickets/),
  ).toBeVisible();
  expect(screen.getAllByRole("textbox", { name: /Job No\./ })).toHaveLength(50);
  expect(screen.queryByDisplayValue("FO99999")).not.toBeInTheDocument();
}, 30000);

it("keeps unsent tickets in their warehouse when another tab switches warehouse until discarding is approved", async () => {
  start();
  typeTicket();
  otherTab("warehouse-b");
  expect(
    screen.getByRole("dialog", { name: "Save changes before leaving?" }),
  ).toBeVisible();
  expect(readStoredWarehouse()).toBe("warehouse-a");
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.getByRole("textbox", { name: /Job No\./ })).toHaveValue(
    "FO69070073",
  );
  expect(mocks.locations).not.toContain("warehouse-b");

  otherTab("warehouse-b");
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  await screen.findByRole("button", { name: "Choose dock in warehouse-b" });
  expect(readStoredWarehouse()).toBe("warehouse-b");
  expect(screen.queryByDisplayValue("FO69070073")).not.toBeInTheDocument();
  expect(mocks.save).not.toHaveBeenCalled();
});

it("protects a photo-only collection from a cross-tab warehouse switch", () => {
  start();
  collectPhotos(1);
  otherTab("warehouse-b");
  expect(
    screen.getByRole("dialog", { name: "Save changes before leaving?" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(readStoredWarehouse()).toBe("warehouse-a");
  expect(screen.getByText("1 / 20 photos")).toBeVisible();
});

it("shows above the camera which ticket each scan filled, even an older one, and keeps its result visible while the camera is paused", async () => {
  start();
  // Ticket #1 lacks its Job No.; ticket #2 is complete and newer.
  fireEvent.click(screen.getByRole("button", { name: "Manual" }));
  fireEvent.change(screen.getByRole("textbox", { name: /Product barcode/ }), {
    target: { value: "OLD-SKU" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Manual" }));
  fireEvent.change(screen.getAllByRole("textbox", { name: /Job No\./ })[1]!, {
    target: { value: "FO11111111" },
  });
  fireEvent.change(
    screen.getAllByRole("textbox", { name: /Product barcode/ })[1]!,
    { target: { value: "NEW-SKU" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Scan code" }));
  const progress = screen.getByText("Waiting for a code").closest("div")!;
  expect(progress).toHaveAttribute("role", "status");
  expect(progress).toHaveAttribute("aria-live", "polite");
  expect(progress).toHaveTextContent("1 ticket incomplete");

  act(() => mocks.camera!("FOM6909081"));
  expect(progress).toHaveTextContent("Latest → ticket #1 · Job No. FOM6909081");
  expect(progress).toHaveTextContent("Job No.done");
  expect(progress).toHaveTextContent("Product barcodedone");
  expect(progress).toHaveTextContent("All tickets complete");
  expect(screen.getAllByRole("textbox", { name: /Job No\./ })[0]).toHaveValue(
    "FOM6909081",
  );

  act(() => mocks.camera!("PRODUCT-3"));
  expect(progress).toHaveTextContent(
    "Latest → ticket #3 · Product barcode PRODUCT-3",
  );
  expect(progress).toHaveTextContent("Job No.missing");
  expect(progress).toHaveTextContent("1 ticket incomplete");

  // An image pair stops the camera; its result and progress stay visible.
  await chooseImageCodes(["PRODUCT-3", "FO22222222"]);
  expect(await screen.findByText("Barcode read")).toBeVisible();
  expect(screen.getByRole("button", { name: "Start camera" })).toBeVisible();
  expect(progress).toHaveTextContent("Latest → ticket #3 · Job No. FO22222222");
  expect(progress).toHaveTextContent("All tickets complete");
  expect(screen.getAllByRole("textbox", { name: /Job No\./ })).toHaveLength(3);

  // The pair confirms an existing Job No. and fills only its product code.
  fireEvent.click(screen.getByRole("button", { name: "Manual" }));
  fireEvent.change(screen.getAllByRole("textbox", { name: /Job No\./ })[3]!, {
    target: { value: "FO33333333" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Scan code" }));
  await chooseImageCodes(["PRODUCT-4", "FO33333333"]);
  expect(
    screen.getByText("Latest → ticket #4 · Product barcode PRODUCT-4"),
  ).toBeVisible();
  expect(screen.getByText("All tickets complete")).toBeVisible();
});
