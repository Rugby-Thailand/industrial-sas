import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type * as BarcodeImage from "../barcodeImage";
import type { ComponentProps } from "react";
import { getFunctionName } from "convex/server";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { querySuccess } from "@tests/fixtures/finished-goods-ui";
import { trackAppHistory } from "@/lib/browser/appHistory";
import { LocationPicker } from "./LocationPicker";

const mocks = vi.hoisted(() => ({
  decode: vi.fn<() => Promise<string[]>>(),
  query: vi.fn(),
  missing: false,
}));
vi.mock("@/i18n/navigation", () => ({
  Link: (props: ComponentProps<"a">) => <a {...props} />,
}));
vi.mock("../barcodeImage", async (original) => ({
  ...(await original<typeof BarcodeImage>()),
  readBarcodeImage: () =>
    mocks.decode().then((codes) => ({
      codes,
      reviewRequired: false,
      attempts: 1,
      elapsedMs: 1,
    })),
}));
vi.mock("@zxing/browser", () => ({
  BrowserMultiFormatReader: class {
    async decodeFromStream() {
      return { stop() {} };
    }
  },
}));
vi.mock("convex/react", () => ({
  useConvex: () => ({ query: mocks.query }),
  useQuery: (_ref: unknown, args: { text?: string }) =>
    querySuccess({
      items: [],
      isDone: true,
      continueCursor: "",
      canCreate: mocks.missing && args.text === "F2-L28-1",
    }),
}));

const activeTracks = new Set<unknown>();
const getUserMedia = vi.fn(async () => {
  const track = {
    getCapabilities: () => ({}),
    stop: () => activeTracks.delete(track),
  };
  activeTracks.add(track);
  return { getTracks: () => [track], getVideoTracks: () => [track] };
});
let stopHistory: (() => void) | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  activeTracks.clear();
  window.history.replaceState(
    { __NA: true },
    "",
    "/th/finished-goods/scan?source=qr#photo",
  );
  stopHistory = trackAppHistory();
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  mocks.missing = false;
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
afterEach(() => {
  stopHistory?.();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function upload() {
  fireEvent.click(screen.getByRole("button", { name: "Scan code" }));
  selectImage();
}
function selectImage() {
  fireEvent.change(screen.getByLabelText("Choose image"), {
    target: {
      files: [new File(["photo"], "location.webp", { type: "image/webp" })],
    },
  });
}
function setup(canReadImage = false) {
  const onPick = vi.fn();
  return {
    ...renderWithIntl(
      <LocationPicker
        warehouseId="warehouse-a"
        onPick={onPick}
        canReadImage={canReadImage}
      />,
      { locale: "en", preserveProviders: true },
    ),
    onPick,
  };
}

it("resolves an image code in the current warehouse and preserves the exact position", async () => {
  const { onPick } = setup();
  upload();
  fireEvent.click(
    await screen.findByRole("button", { name: "Use scanned code(s)" }),
  );
  await waitFor(() => expect(onPick).toHaveBeenCalledOnce());
  expect(mocks.query).toHaveBeenCalledWith(expect.anything(), {
    warehouseId: "warehouse-a",
    code: "F2-L28-1",
  });
  expect(getFunctionName(mocks.query.mock.calls[0]![0])).toBe(
    "finishedGoods/jobScanLocations:resolve",
  );
  expect(onPick).toHaveBeenCalledWith({
    text: "F2-L28-1",
    code: "F2-L28-1",
    name: "Floor 2",
    zoneId: "zone-a",
    supportPositionId: "position-a",
  });
});

it("offers inline registration for a confirmed missing image location", async () => {
  mocks.missing = true;
  mocks.query.mockResolvedValue(
    querySuccess({ ok: false, error: { code: "LOCATION_NOT_FOUND" } }),
  );
  const { onPick } = setup();
  upload();
  fireEvent.click(
    await screen.findByRole("button", { name: "Use scanned code(s)" }),
  );
  await screen.findByRole("button", { name: "Add location" });
  expect(screen.getByRole("textbox", { name: "Search location" })).toHaveValue(
    "F2-L28-1",
  );
  expect(onPick).not.toHaveBeenCalled();
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
    if (action === "typing") {
      fireEvent.click(screen.getByRole("button", { name: "Close camera" }));
      fireEvent.change(
        screen.getByRole("textbox", { name: "Search location" }),
        { target: { value: "NEW" } },
      );
    } else
      rerender(<LocationPicker warehouseId="warehouse-b" onPick={onPick} />);
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
  fireEvent.click(
    await screen.findByRole("button", { name: "Use scanned code(s)" }),
  );
  await screen.findByText(/Cannot access locations/);
  expect(onPick).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("button", { name: /Save now, set location later/ }),
  ).not.toBeInTheDocument();
});

it.each([
  ["Photo AI", true],
  ["Read location with AI", false],
])(
  "restores a cropped QR image and its decoded result after %s closes or returns through Back and Forward",
  async (action, cameraActive) => {
    setup(true);
    fireEvent.click(screen.getByRole("button", { name: "Scan code" }));
    await waitFor(() => expect(activeTracks.size).toBe(1));
    selectImage();
    expect(activeTracks.size).toBe(0);
    await screen.findByRole("button", { name: "Use scanned code(s)" });
    fireEvent.click(screen.getByRole("button", { name: "Crop barcode" }));
    fireEvent.change(screen.getAllByRole("slider")[0]!, {
      target: { value: 30 },
    });
    fireEvent.click(screen.getByRole("button", { name: "Read image" }));
    await screen.findByRole("button", { name: "Use scanned code(s)" });
    const qrReview = async () => {
      const qr = await screen.findByRole("dialog", { name: "Scan code" });
      expect(
        within(qr).getByRole("img", { name: "Selected barcode label" }),
      ).toBeVisible();
      expect(within(qr).getAllByRole("slider")[0]).toHaveValue("30");
      expect(
        within(qr).getByRole("button", { name: "Use scanned code(s)" }),
      ).toBeVisible();
      expect(within(qr).getByText("F2-L28-1")).toBeVisible();
      expect(activeTracks.size).toBe(0);
    };
    fireEvent.click(screen.getByRole("button", { name: action }));
    const close = await screen.findByRole("button", { name: "Close Photo AI" });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    await waitFor(() => expect(activeTracks.size).toBe(cameraActive ? 1 : 0));
    expect(getUserMedia).toHaveBeenCalledTimes(cameraActive ? 2 : 1);
    fireEvent.click(close);
    await qrReview();

    act(() => window.history.forward());
    await screen.findByRole("button", { name: "Close Photo AI" });
    await waitFor(() => expect(activeTracks.size).toBe(cameraActive ? 1 : 0));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    act(() => window.history.back());
    await qrReview();

    expect(getUserMedia).toHaveBeenCalledTimes(cameraActive ? 3 : 1);
    expect(mocks.decode).toHaveBeenCalledTimes(2);
    expect(window.location.hash).toBe("#photo");
  },
);
