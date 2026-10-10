import type * as BarcodeImageModule from "./barcodeImage";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { BarcodeCameraBox } from "./BarcodeCameraBox";
import { TicketFieldScanner } from "./jobScan/TicketFieldScanner";
import type { BarcodeImageResult } from "./barcodeImage";

const mocks = vi.hoisted(() => ({ read: vi.fn(), stop: vi.fn() }));
vi.mock("./barcodeImage", async (importOriginal) => ({
  ...(await importOriginal<typeof BarcodeImageModule>()),
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
    stop: mocks.stop,
  }),
}));
const result = (
  codes = ["DEMO-PRODUCT"],
  reviewRequired = false,
): BarcodeImageResult => ({ codes, reviewRequired, attempts: 1, elapsedMs: 1 });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockResolvedValue(result());
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:label");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
function choose(type = "image/jpeg") {
  fireEvent.change(screen.getByLabelText("Choose image"), {
    target: { files: [new File(["pixels"], "label.jpg", { type })] },
  });
}
it("keeps image acquisition usable after camera denial and switches sources without cancelling the owner", async () => {
  const onCode = vi.fn(),
    onClose = vi.fn();
  renderWithIntl(
    <BarcodeCameraBox mode="PACKAGES" onCode={onCode} onClose={onClose} />,
    { locale: "en" },
  );
  expect(screen.getByRole("button", { name: "Choose image" })).toBeEnabled();
  choose();
  await screen.findByRole("button", { name: "Use scanned code(s)" });
  expect(mocks.stop).toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(onCode).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Use scanned code(s)" }));
  expect(onCode).toHaveBeenCalledWith("DEMO-PRODUCT");
});
it("requires explicit label review before delivering a curved result", async () => {
  mocks.read.mockResolvedValue(result(["DEMO-PRODUCT"], true));
  const onCode = vi.fn();
  renderWithIntl(<BarcodeCameraBox mode="PACKAGES" onCode={onCode} />, {
    locale: "en",
  });
  choose();
  await screen.findByText("Check the label before using this code");
  expect(onCode).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Checked — use this code" }),
  );
  expect(onCode).toHaveBeenCalledOnce();
});
it("delivers a JOB/product pair together only after image acceptance", async () => {
  mocks.read.mockResolvedValue(result(["FO12345678", "DEMO-PRODUCT"]));
  const batch = vi.fn(),
    single = vi.fn();
  renderWithIntl(
    <BarcodeCameraBox
      mode="PACKAGES"
      imageTarget="TICKET"
      onCode={single}
      onImageCodes={batch}
    />,
    { locale: "en" },
  );
  choose();
  await screen.findByRole("button", { name: "Use scanned code(s)" });
  fireEvent.click(screen.getByRole("button", { name: "Use scanned code(s)" }));
  expect(batch).toHaveBeenCalledWith(["FO12345678", "DEMO-PRODUCT"]);
  expect(single).not.toHaveBeenCalled();
});
it("requires a choice for several distinct location codes", async () => {
  mocks.read.mockResolvedValue(result(["ZONE-A", "ZONE-B"]));
  const onCode = vi.fn();
  renderWithIntl(<BarcodeCameraBox mode="LOCATION" onCode={onCode} />, {
    locale: "en",
  });
  choose();
  await screen.findByText("Several codes found. Choose the one you want.");
  expect(onCode).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "ZONE-B" }));
  expect(onCode).toHaveBeenCalledWith("ZONE-B");
});
it("cancels pending reads and ignores a decoder that resolves after cancellation", async () => {
  let finish!: (value: BarcodeImageResult) => void;
  mocks.read.mockImplementation(
    () => new Promise((resolve) => (finish = resolve)),
  );
  const onCode = vi.fn();
  renderWithIntl(<BarcodeCameraBox mode="PACKAGES" onCode={onCode} />, {
    locale: "en",
  });
  choose();
  const signal = mocks.read.mock.calls[0]![2] as AbortSignal;
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(signal.aborted).toBe(true);
  await act(async () => finish(result()));
  expect(onCode).not.toHaveBeenCalled();
  expect(screen.queryByText("DEMO-PRODUCT")).not.toBeInTheDocument();
});
it("switching back to camera aborts an image without invoking scanner close", async () => {
  mocks.read.mockReturnValue(new Promise(() => {}));
  const onClose = vi.fn();
  renderWithIntl(
    <BarcodeCameraBox
      mode="PACKAGES"
      startOnMount={false}
      onCode={vi.fn()}
      onClose={onClose}
    />,
    { locale: "en" },
  );
  choose();
  const signal = mocks.read.mock.calls[0]![2] as AbortSignal;
  fireEvent.click(screen.getByRole("button", { name: "Start camera" }));
  expect(signal.aborted).toBe(true);
  expect(onClose).not.toHaveBeenCalled();
});
it("unmount aborts pending work and releases preview URLs", () => {
  mocks.read.mockReturnValue(new Promise(() => {}));
  const onCode = vi.fn();
  const view = renderWithIntl(
    <BarcodeCameraBox mode="PACKAGES" onCode={onCode} />,
    { locale: "en" },
  );
  choose();
  const signal = mocks.read.mock.calls[0]![2] as AbortSignal;
  view.unmount();
  expect(signal.aborted).toBe(true);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:label");
});
it("manual crop retries the selected file and still requires acceptance", async () => {
  const onCode = vi.fn();
  renderWithIntl(<BarcodeCameraBox mode="LOCATION" onCode={onCode} />, {
    locale: "en",
  });
  choose();
  await screen.findByRole("button", { name: "Use scanned code(s)" });
  fireEvent.click(screen.getByRole("button", { name: "Crop barcode" }));
  expect(
    screen.queryByRole("button", { name: "Use scanned code(s)" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Read image" }));
  await screen.findByRole("button", { name: "Use scanned code(s)" });
  expect(mocks.read.mock.calls[1]![3]).toEqual({
    x: 0.1,
    y: 0.25,
    width: 0.8,
    height: 0.5,
  });
  expect(onCode).not.toHaveBeenCalled();
});

it("only transfers a selected image to AI after the explicit AI action", async () => {
  const handoff = vi.fn();
  renderWithIntl(
    <BarcodeCameraBox
      mode="LOCATION"
      onCode={vi.fn()}
      onReadWithAi={handoff}
    />,
    { locale: "en" },
  );
  choose();
  await screen.findByRole("button", { name: "Use scanned code(s)" });
  expect(handoff).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Read location with AI" }),
  );
  expect(handoff).toHaveBeenCalledWith(expect.any(File), undefined);
  expect(URL.revokeObjectURL).toHaveBeenCalled();
});

it("reports unsupported files without starting the decoder", () => {
  renderWithIntl(<BarcodeCameraBox mode="PACKAGES" onCode={vi.fn()} />, {
    locale: "en",
  });
  choose("text/plain");
  expect(screen.getByText("Choose a JPEG, PNG or WebP image")).toBeVisible();
  expect(mocks.read).not.toHaveBeenCalled();
});
it("selecting the same file again starts a new read", async () => {
  renderWithIntl(<BarcodeCameraBox mode="PACKAGES" onCode={vi.fn()} />, {
    locale: "en",
  });
  choose();
  await screen.findByRole("button", { name: "Use scanned code(s)" });
  fireEvent.click(screen.getByRole("button", { name: "Scan again" }));
  choose();
  await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2));
});
it("a JOB-only image cannot populate a product field", async () => {
  mocks.read.mockResolvedValue(result(["FO12345678"]));
  const apply = vi.fn();
  renderWithIntl(
    <TicketFieldScanner
      field="productBarcodeText"
      index={0}
      value=""
      onApply={apply}
      onClose={vi.fn()}
    />,
    { locale: "en" },
  );
  choose();
  await screen.findByRole("button", { name: "Use scanned code(s)" });
  fireEvent.click(screen.getByRole("button", { name: "Use scanned code(s)" }));
  expect(apply).not.toHaveBeenCalled();
  expect(
    screen.getByText(
      "This barcode belongs to a different field. Scan the label for this field.",
    ),
  ).toBeVisible();
});
it("image scans retain explicit field replacement confirmation", async () => {
  const apply = vi.fn();
  renderWithIntl(
    <TicketFieldScanner
      field="productBarcodeText"
      index={0}
      value="OLD-CODE"
      onApply={apply}
      onClose={vi.fn()}
    />,
    { locale: "en" },
  );
  choose();
  await screen.findByRole("button", { name: "Use scanned code(s)" });
  fireEvent.click(screen.getByRole("button", { name: "Use scanned code(s)" }));
  expect(apply).not.toHaveBeenCalled();
  expect(screen.getByText("OLD-CODE")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Replace value" }));
  expect(apply).toHaveBeenCalledWith("DEMO-PRODUCT");
});

it("disabling acquisition aborts pending work and prevents a late result", async () => {
  let finish!: (value: BarcodeImageResult) => void;
  mocks.read.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const onCode = vi.fn();
  const view = renderWithIntl(
    <BarcodeCameraBox mode="PACKAGES" onCode={onCode} />,
    { locale: "en", preserveProviders: true },
  );
  choose();
  const signal = mocks.read.mock.calls[0]![2] as AbortSignal;
  view.rerender(<BarcodeCameraBox mode="PACKAGES" onCode={onCode} disabled />);
  expect(signal.aborted).toBe(true);
  await act(async () => finish(result()));
  expect(onCode).not.toHaveBeenCalled();
  expect(screen.queryByText("DEMO-PRODUCT")).not.toBeInTheDocument();
});

it("reviews the full label as an image without navigating to file contents", async () => {
  const onCode = vi.fn();
  renderWithIntl(<BarcodeCameraBox mode="PACKAGES" onCode={onCode} />, {
    locale: "en",
  });
  choose();
  await screen.findByRole("button", { name: "Use scanned code(s)" });
  fireEvent.click(
    screen.getByRole("button", { name: "View full label image" }),
  );
  expect(
    screen.getByRole("dialog", { name: "View full label image" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("link", { name: "View full label image" }),
  ).not.toBeInTheDocument();
  expect(onCode).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Use scanned code(s)" }),
  ).toBeVisible();
});
