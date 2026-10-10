import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type * as BarcodeDecoder from "../barcodeDecoder";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { querySuccess } from "@tests/fixtures/finished-goods-ui";
import { LocationPicker } from "./LocationPicker";

const mocks = vi.hoisted(() => ({
  decode: vi.fn<() => Promise<string[]>>(),
  query: vi.fn(),
}));
vi.mock("../barcodeDecoder", async (original) => ({
  ...(await original<typeof BarcodeDecoder>()),
  decodeBarcodeImage: mocks.decode,
}));
vi.mock("../useBarcodeCamera", () => ({
  useBarcodeCamera: () => ({
    videoRef: { current: null },
    state: "OFF",
    error: null,
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
  mocks.decode.mockReset().mockResolvedValue(["F2-L28-1"]);
  mocks.query.mockReset().mockResolvedValue(
    querySuccess({
      ok: true,
      location: {
        code: "F2-L28-1",
        name: "Floor 2",
        zoneId: "zone-a",
        supportPositionId: "position-a",
      },
    }),
  );
  URL.createObjectURL = vi.fn(() => "blob:location-photo");
  URL.revokeObjectURL = vi.fn();
});
function upload() {
  fireEvent.click(
    screen.getByRole("button", { name: "Scan location barcode or QR" }),
  );
  fireEvent.change(screen.getByLabelText("Choose image"), {
    target: {
      files: [new File(["photo"], "location.webp", { type: "image/webp" })],
    },
  });
}
function setup() {
  const onPick = vi.fn();
  return {
    ...renderWithIntl(
      <LocationPicker warehouseId="warehouse-a" onPick={onPick} />,
      { locale: "en", preserveProviders: true },
    ),
    onPick,
  };
}

it("resolves an image code in the current warehouse and preserves the exact position", async () => {
  const { onPick } = setup();
  upload();
  await waitFor(() => expect(onPick).toHaveBeenCalledOnce());
  expect(mocks.query).toHaveBeenCalledWith(expect.anything(), {
    warehouseId: "warehouse-a",
    code: "F2-L28-1",
  });
  expect(onPick).toHaveBeenCalledWith({
    text: "F2-L28-1",
    code: "F2-L28-1",
    name: "Floor 2",
    zoneId: "zone-a",
    supportPositionId: "position-a",
  });
});

it.each(["typing", "warehouse change"])(
  "discards an image decode after %s",
  async (action) => {
    let finish!: (codes: string[]) => void;
    mocks.decode.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { onPick, rerender } = setup();
    upload();
    await waitFor(() => expect(mocks.decode).toHaveBeenCalledOnce());
    if (action === "typing")
      fireEvent.change(
        screen.getByRole("textbox", { name: "Search location" }),
        { target: { value: "NEW" } },
      );
    else rerender(<LocationPicker warehouseId="warehouse-b" onPick={onPick} />);
    await act(async () => finish(["F2-L28-1"]));
    expect(mocks.query).not.toHaveBeenCalled();
    expect(onPick).not.toHaveBeenCalled();
  },
);

it("does not turn denied image lookups into an unmapped location", async () => {
  mocks.query.mockResolvedValue({
    ok: false,
    denial: { kind: "AUTHORIZATION_DENIED" },
  });
  const { onPick } = setup();
  upload();
  await screen.findByText(/Cannot access locations/);
  expect(onPick).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("button", { name: /Save now, set location later/ }),
  ).not.toBeInTheDocument();
});
