import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ComponentProps, ReactNode } from "react";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { JobScanScreen } from "@/features/finishedGoods/jobScan/JobScanScreen";

// FG-UX-03: the REAL BarcodeCameraBox renders Job-ticket feedback only while its
// camera is on. Choosing an image turns the camera off, and JobScanScreen
// suppresses its own feedback while the barcode panel is open.
// Only the hardware hook and the image decoder UI are substituted.

const mocks = vi.hoisted(() => ({
  onCode: undefined as ((code: string) => void) | undefined,
  imageCodes: [] as string[],
}));
vi.mock("@/features/finishedGoods/useBarcodeCamera", () => ({
  useBarcodeCamera: ({ onCode }: { onCode: (code: string) => void }) => {
    mocks.onCode = onCode;
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
// Mirrors BarcodeImagePicker's contract: selecting a file calls onSelect,
// pressing "Use" calls onCodes with the decoded codes.
vi.mock("@/features/finishedGoods/BarcodeImagePicker", () => ({
  BarcodeImagePicker: ({
    onSelect,
    onCodes,
  }: {
    onSelect: () => void;
    onCodes: (codes: string[]) => void;
  }) => (
    <button
      type="button"
      onClick={() => {
        onSelect();
        onCodes(mocks.imageCodes);
      }}
    >
      Use decoded image
    </button>
  ),
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
vi.mock("@/components/system/QueryGate", () => ({
  QueryGate: ({ children }: { children: (id: string) => ReactNode }) =>
    children("warehouse-a"),
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
  window.history.replaceState(
    { appNavigationIndex: 1 },
    "",
    "/en/finished-goods/scan",
  );
});
afterEach(() => vi.restoreAllMocks());

function fiftyTicketsFromImages() {
  renderWithIntl(<JobScanScreen />, { locale: "en" });
  fireEvent.click(screen.getByRole("button", { name: "Pick Dock" }));
  fireEvent.click(screen.getByRole("button", { name: "Scan barcode" }));
  for (let i = 0; i < 50; i++) {
    mocks.imageCodes = [`FO${String(i).padStart(5, "0")}`, `PRODUCT-${i}`];
    fireEvent.click(screen.getByRole("button", { name: "Use decoded image" }));
  }
  expect(screen.getAllByRole("textbox", { name: /Job No\./ })).toHaveLength(50);
}

it("DESIRED: a rejected 51st ticket from an image explains the group limit", () => {
  fiftyTicketsFromImages();
  mocks.imageCodes = ["FO99999", "PRODUCT-LAST"];
  fireEvent.click(screen.getByRole("button", { name: "Use decoded image" }));
  // Nothing was added...
  expect(screen.getAllByRole("textbox", { name: /Job No\./ })).toHaveLength(50);
  // ...so the operator needs the reason.
  expect(
    screen.queryByText(/This group holds up to 50 tickets/),
  ).toBeInTheDocument();
}, 90000);

it("CONTROL: the same refusal from the live camera is announced", () => {
  fiftyTicketsFromImages();
  fireEvent.click(screen.getByRole("button", { name: "Start camera" }));
  act(() => mocks.onCode?.("FO99999"));
  expect(screen.getAllByRole("textbox", { name: /Job No\./ })).toHaveLength(50);
  expect(screen.getByText(/This group holds up to 50 tickets/)).toBeVisible();
}, 90000);
