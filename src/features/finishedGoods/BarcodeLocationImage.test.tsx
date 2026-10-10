import type * as BarcodeImageModule from "./barcodeImage";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { LocationPicker } from "./jobScan/LocationPicker";
import { querySuccess } from "@tests/fixtures/finished-goods-ui";
const mocks = vi.hoisted(() => ({ read: vi.fn(), query: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({ Link: "a" }));
vi.mock("./barcodeImage", async (original) => ({
  ...(await original<typeof BarcodeImageModule>()),
  readBarcodeImage: mocks.read,
}));
vi.mock("./useBarcodeCamera", () => ({
  useBarcodeCamera: () => ({
    videoRef: { current: null },
    state: "ERROR",
    error: "PERMISSION",
    torchAvailable: false,
    torchOn: false,
    toggleTorch: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  }),
}));
vi.mock("convex/react", () => ({
  useConvex: () => ({ query: mocks.query }),
  useQuery: () => querySuccess({ items: [], page: 1, pages: 1, total: 0 }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockResolvedValue({ codes: ["F2-L28-18"], reviewRequired: false });
  mocks.query.mockResolvedValue(
    querySuccess({
      ok: true,
      location: {
        code: "F2-L28-18",
        zoneId: "zone-a",
        supportPositionId: "position-a",
        name: "Position A",
      },
    }),
  );
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:label");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
function upload() {
  fireEvent.click(
    screen.getByRole("button", { name: "Scan location barcode or QR" }),
  );
  fireEvent.change(screen.getByLabelText("Choose image"), {
    target: {
      files: [new File(["pixels"], "label.jpg", { type: "image/jpeg" })],
    },
  });
}
it("real shared image controls resolve and select a position even with camera permission denied", async () => {
  const pick = vi.fn();
  renderWithIntl(<LocationPicker warehouseId="warehouse-a" onPick={pick} />, {
    locale: "en",
    preserveProviders: true,
  });
  upload();
  await screen.findByRole("button", { name: "Use scanned code(s)" });
  expect(pick).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Use scanned code(s)" }));
  await waitFor(() =>
    expect(pick).toHaveBeenCalledWith({
      text: "F2-L28-18",
      code: "F2-L28-18",
      zoneId: "zone-a",
      supportPositionId: "position-a",
      name: "Position A",
    }),
  );
  expect(mocks.query.mock.calls[0]![1]).toEqual({
    warehouseId: "warehouse-a",
    code: "F2-L28-18",
  });
});
it("typing while an image is reading cancels it and prevents stale location lookup", async () => {
  let finish!: (value: unknown) => void;
  mocks.read.mockReturnValue(new Promise((resolve) => (finish = resolve)));
  const pick = vi.fn();
  renderWithIntl(<LocationPicker warehouseId="warehouse-a" onPick={pick} />, {
    locale: "en",
    preserveProviders: true,
  });
  upload();
  const signal = mocks.read.mock.calls[0]![2] as AbortSignal;
  fireEvent.change(screen.getByRole("textbox", { name: "Search location" }), {
    target: { value: "Dock" },
  });
  expect(signal.aborted).toBe(true);
  await act(async () =>
    finish({ codes: ["F2-L28-18"], reviewRequired: false }),
  );
  expect(mocks.query).not.toHaveBeenCalled();
  expect(pick).not.toHaveBeenCalled();
});
it("changing warehouses cancels the image and resets the location acquisition session", async () => {
  mocks.read.mockReturnValue(new Promise(() => {}));
  const pick = vi.fn();
  const view = renderWithIntl(
    <LocationPicker warehouseId="warehouse-a" onPick={pick} />,
    { locale: "en", preserveProviders: true },
  );
  upload();
  const signal = mocks.read.mock.calls[0]![2] as AbortSignal;
  view.rerender(<LocationPicker warehouseId="warehouse-b" onPick={pick} />);
  expect(signal.aborted).toBe(true);
  expect(screen.queryByLabelText("Choose image")).not.toBeInTheDocument();
});
