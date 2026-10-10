import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { BarcodeCameraBox } from "./BarcodeCameraBox";
import type * as BarcodeDecoder from "./barcodeDecoder";

const mocks = vi.hoisted(() => ({
  decode: vi.fn<() => Promise<string[]>>(),
  stop: vi.fn(),
}));
vi.mock("./barcodeDecoder", async (original) => ({
  ...(await original<typeof BarcodeDecoder>()),
  decodeBarcodeImage: mocks.decode,
}));

vi.mock("./useBarcodeCamera", () => ({
  useBarcodeCamera: () => ({
    videoRef: { current: null },
    state: "UNAVAILABLE",
    error: "UNAVAILABLE",
    torchAvailable: false,
    torchOn: false,
    toggleTorch: vi.fn(),
    start: vi.fn(),
    stop: mocks.stop,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.decode.mockReset().mockResolvedValue(["F2-L28-1"]);
  URL.createObjectURL = vi.fn(() => "blob:barcode-fixture");
  URL.revokeObjectURL = vi.fn();
});

function setup(props: Partial<Parameters<typeof BarcodeCameraBox>[0]> = {}) {
  const onCode = vi.fn(),
    onClose = vi.fn();
  const view = renderWithIntl(
    <BarcodeCameraBox
      mode="LOCATION"
      onCode={onCode}
      onClose={onClose}
      {...props}
    />,
    { locale: "en", preserveProviders: true },
  );
  return { ...view, onCode, onClose };
}
function select(name = "location.webp", type = "image/webp") {
  const file = new File(["photo"], name, { type });
  fireEvent.change(screen.getByLabelText("Choose image"), {
    target: { files: [file] },
  });
  return file;
}

it("offers image selection when the camera is unavailable", () => {
  renderWithIntl(<BarcodeCameraBox mode="LOCATION" onCode={vi.fn()} />, {
    locale: "en",
  });
  expect(screen.getByRole("button", { name: "Choose image" })).toBeEnabled();
});

it("pauses the camera without closing the location session and applies the image result", async () => {
  const { onCode, onClose } = setup();
  select();
  await waitFor(() => expect(onCode).toHaveBeenCalledWith("F2-L28-1"));
  expect(onCode).toHaveBeenCalledOnce();
  expect(mocks.stop).toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

it("cancels a pending image before switching back to the camera", async () => {
  let finish!: (codes: string[]) => void;
  mocks.decode.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { onCode } = setup();
  select();
  await waitFor(() => expect(mocks.decode).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "Start camera" }));
  await act(async () => finish(["LATE"]));
  expect(onCode).not.toHaveBeenCalled();
});

it("discards the earlier image when another file is selected", async () => {
  let finish!: (codes: string[]) => void;
  mocks.decode.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { onCode } = setup();
  select();
  await waitFor(() => expect(mocks.decode).toHaveBeenCalledOnce());
  select("another.png", "image/png");
  await waitFor(() => expect(onCode).toHaveBeenCalledWith("F2-L28-1"));
  await act(async () => finish(["OLD"]));
  expect(onCode).toHaveBeenCalledOnce();
  expect(URL.revokeObjectURL).toHaveBeenCalled();
});

it.each(["cancel", "unmount", "disable"])(
  "ignores an image result after %s",
  async (action) => {
    let finish!: (codes: string[]) => void;
    mocks.decode.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { onCode, unmount, rerender } = setup();
    select();
    await waitFor(() => expect(mocks.decode).toHaveBeenCalledOnce());
    if (action === "cancel")
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    else if (action === "unmount") unmount();
    else
      rerender(<BarcodeCameraBox mode="LOCATION" onCode={onCode} disabled />);
    await act(async () => finish(["LATE"]));
    expect(onCode).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
    if (action === "disable") {
      rerender(<BarcodeCameraBox mode="LOCATION" onCode={onCode} />);
      expect(mocks.decode).toHaveBeenCalledOnce();
    }
  },
);

it("requires a choice when a photo contains distinct codes", async () => {
  mocks.decode.mockResolvedValue(["F2-L28-1", "F2-L28-18"]);
  const { onCode } = setup();
  select();
  await screen.findByText(/Several codes were found/);
  expect(onCode).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "F2-L28-18" }));
  expect(onCode).toHaveBeenCalledWith("F2-L28-18");
});

it("reports invalid files and unreadable barcodes without applying a value", async () => {
  const { onCode } = setup();
  select("image.gif", "image/gif");
  expect(screen.getByRole("alert")).toHaveTextContent("JPEG, PNG, or WebP");
  expect(mocks.decode).not.toHaveBeenCalled();
  mocks.decode.mockResolvedValue([]);
  select();
  await screen.findByText(/No barcode found/);
  expect(onCode).not.toHaveBeenCalled();
});

it("allows selecting the same file again and preserves single-result shutdown", async () => {
  const { onCode, onClose } = setup({ stopAfterScan: true });
  select();
  await waitFor(() => expect(onCode).toHaveBeenCalledOnce());
  expect(onClose).toHaveBeenCalledOnce();
  select();
  await waitFor(() => expect(onCode).toHaveBeenCalledTimes(2));
  expect(onClose).toHaveBeenCalledTimes(2);
});
