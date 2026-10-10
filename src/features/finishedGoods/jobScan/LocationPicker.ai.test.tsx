import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { querySuccess } from "@tests/fixtures/finished-goods-ui";
import { LocationPicker } from "./LocationPicker";
import type * as BarcodeImage from "../barcodeImage";
import { getFunctionName } from "convex/server";

vi.mock("@/i18n/navigation", () => ({
  Link: (props: React.ComponentProps<"a">) => <a {...props} />,
}));

const mocks = vi.hoisted(() => ({
  action: vi.fn(),
  query: vi.fn(),
  prepare: vi.fn(),
  decode: vi.fn(),
}));
vi.mock("./prepareLocationImage", () => ({
  prepareLocationImage: mocks.prepare,
}));
vi.mock("../barcodeImage", async (original) => ({
  ...(await original<typeof BarcodeImage>()),
  readBarcodeImage: () =>
    mocks.decode().then((codes: string[]) => ({
      codes,
      reviewRequired: false,
      attempts: 1,
      elapsedMs: 1,
    })),
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
  useConvex: () => ({ query: mocks.query, action: mocks.action }),
  useQuery: () =>
    querySuccess({
      items: [],
      status: "ready",
      isDone: true,
      continueCursor: "",
      canCreate: true,
    }),
}));

const extracted = (codes = ["F1-L3-11"]) =>
  querySuccess({
    ok: true,
    candidates: codes.map((code) => ({ code, labelText: null })),
  });
const mapped = (code = "F1-L3-11") =>
  querySuccess({
    ok: true,
    location: {
      code,
      name: "Zone 3",
      zoneId: "zone-a",
      supportPositionId: "position-11",
    },
  });
const file = () => new File(["photo"], "location.webp", { type: "image/webp" });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.action.mockReset().mockResolvedValue(extracted());
  mocks.query.mockReset().mockResolvedValue(mapped());
  mocks.prepare.mockReset().mockResolvedValue("data:image/jpeg;base64,YWJj");
  mocks.decode.mockReset().mockResolvedValue([]);
  URL.createObjectURL = vi.fn(() => "blob:ai-location");
  URL.revokeObjectURL = vi.fn();
});
function setup(canReadImage = true, allowUnmapped = true) {
  const onPick = vi.fn();
  const view = renderWithIntl(
    <LocationPicker
      warehouseId="warehouse-a"
      onPick={onPick}
      canReadImage={canReadImage}
      allowUnmapped={allowUnmapped}
    />,
    { locale: "en", preserveProviders: true },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Scan location barcode or QR" }),
  );
  return { onPick, ...view };
}
function select() {
  fireEvent.change(screen.getByLabelText("Choose location image"), {
    target: { files: [file()] },
  });
}
function read() {
  fireEvent.click(
    screen.getByRole("button", { name: "Read location with AI" }),
  );
}
function startReading() {
  read();
  select();
}

it("reviews AI text before lookup, allows correction, and preserves the canonical exact position", async () => {
  const { onPick } = setup();
  startReading();
  const input = await screen.findByRole("textbox", {
    name: "Review location code",
  });
  expect(input).toHaveValue("F1-L3-11");
  expect(mocks.query).not.toHaveBeenCalled();
  expect(onPick).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("button", { name: "Read location with AI" }),
  ).not.toBeInTheDocument();
  expect(mocks.action).toHaveBeenCalledWith(expect.anything(), {
    warehouseId: "warehouse-a",
    imageDataUrl: "data:image/jpeg;base64,YWJj",
  });
  fireEvent.change(input, { target: { value: "F1-L3-12" } });
  mocks.query.mockResolvedValue(mapped("F1-L3-12"));
  fireEvent.click(screen.getByRole("button", { name: "Use this code" }));
  await waitFor(() => expect(onPick).toHaveBeenCalledOnce());
  expect(mocks.query).toHaveBeenCalledWith(expect.anything(), {
    warehouseId: "warehouse-a",
    code: "F1-L3-12",
  });
  expect(getFunctionName(mocks.query.mock.calls[0]![0])).toBe(
    "finishedGoods/jobScanLocations:resolve",
  );
  expect(onPick).toHaveBeenCalledWith({
    text: "F1-L3-12",
    code: "F1-L3-12",
    name: "Zone 3",
    zoneId: "zone-a",
    supportPositionId: "position-11",
  });
});

it("requires an explicit choice between distinct AI codes", async () => {
  mocks.action.mockResolvedValue(extracted(["F1-L3-11", "F1-L4-2"]));
  setup();
  startReading();
  await screen.findByRole("button", { name: "F1-L4-2" });
  expect(screen.getByRole("button", { name: "Use this code" })).toBeDisabled();
  expect(mocks.query).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "F1-L4-2" }));
  expect(
    screen.getByRole("textbox", { name: "Review location code" }),
  ).toHaveValue("F1-L4-2");
});

it("preserves a registered building location when the confirmed AI code resolves", async () => {
  const location = {
    code: "F1-L3-11",
    name: "Location 11",
    locationId: "registered-11",
    buildingId: "building-a",
    buildingName: "Building A",
    floorId: "floor-3",
    floorNumber: 3,
  };
  mocks.query.mockResolvedValue(querySuccess({ ok: true, location }));
  const { onPick } = setup();
  startReading();
  await screen.findByRole("textbox", { name: "Review location code" });
  expect(onPick).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Use this code" }));
  await waitFor(() =>
    expect(onPick).toHaveBeenCalledWith({ ...location, text: location.code }),
  );
});

it.each(["typing", "warehouse", "replacement", "cancel", "back", "unmount"])(
  "discards a late AI response after %s",
  async (change) => {
    let finish!: (value: ReturnType<typeof extracted>) => void;
    mocks.action.mockReturnValue(new Promise(() => {})).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { onPick, rerender, unmount } = setup();
    startReading();
    await waitFor(() => expect(mocks.action).toHaveBeenCalledOnce());
    if (change === "typing")
      fireEvent.change(
        screen.getByRole("textbox", { name: "Search location" }),
        { target: { value: "Dock" } },
      );
    else if (change === "warehouse")
      rerender(
        <LocationPicker
          warehouseId="warehouse-b"
          onPick={onPick}
          canReadImage
        />,
      );
    else if (change === "replacement") select();
    else if (change === "cancel")
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    else if (change === "back")
      fireEvent.click(
        screen.getByRole("button", { name: "Back to location scanner" }),
      );
    else unmount();
    await act(async () => finish(extracted()));
    expect(mocks.query).not.toHaveBeenCalled();
    expect(onPick).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("textbox", { name: "Review location code" }),
    ).not.toBeInTheDocument();
  },
);

it("discards a pending confirmed-code lookup after typing", async () => {
  let finish!: (value: ReturnType<typeof mapped>) => void;
  mocks.query.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { onPick } = setup();
  startReading();
  await screen.findByRole("textbox", { name: "Review location code" });
  fireEvent.click(screen.getByRole("button", { name: "Use this code" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Search location" }), {
    target: { value: "Dock" },
  });
  await act(async () => finish(mapped()));
  expect(onPick).not.toHaveBeenCalled();
});

it("reuses the selected barcode photo and invalidates its pending decode when switching to AI", async () => {
  let finish!: (codes: string[]) => void;
  mocks.decode.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { onPick } = setup();
  fireEvent.change(screen.getByLabelText("Choose image"), {
    target: { files: [file()] },
  });
  await waitFor(() => expect(mocks.decode).toHaveBeenCalledOnce());
  read();
  expect(
    screen.getByRole("img", { name: "Location label photo" }),
  ).toBeVisible();
  await act(async () => finish(["OLD-CODE"]));
  expect(onPick).not.toHaveBeenCalled();
  expect(mocks.query).not.toHaveBeenCalled();
  await screen.findByRole("textbox", { name: "Review location code" });
  expect(mocks.prepare).toHaveBeenCalledWith(
    expect.any(File),
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
});

it.each(["denied", "unreadable", "empty", "unavailable"])(
  "keeps an actionable %s extraction state and permits retry",
  async (kind) => {
    mocks.action.mockResolvedValue(
      kind === "denied"
        ? { ok: false, denial: { kind: "AUTHORIZATION_DENIED" } }
        : kind === "empty"
          ? extracted([])
          : querySuccess({
              ok: false,
              error: {
                code:
                  kind === "unreadable" ? "AI_UNREADABLE" : "AI_UNAVAILABLE",
              },
            }),
    );
    const { onPick } = setup();
    startReading();
    await screen.findByRole("alert");
    expect(onPick).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Use this code" }),
    ).not.toBeInTheDocument();
    mocks.action.mockResolvedValue(extracted());
    fireEvent.click(screen.getByRole("button", { name: "Retry reading" }));
    await screen.findByRole("textbox", { name: "Review location code" });
  },
);

it("offers existing registration and explicit unmapped entry after confirming a missing code", async () => {
  mocks.query.mockResolvedValue(
    querySuccess({ ok: false, error: { code: "LOCATION_NOT_FOUND" } }),
  );
  const { onPick } = setup();
  startReading();
  await screen.findByRole("textbox", { name: "Review location code" });
  fireEvent.click(screen.getByRole("button", { name: "Use this code" }));
  await screen.findByRole("button", { name: /Save now, set location later/ });
  expect(screen.getByRole("button", { name: "Add location" })).toBeVisible();
  expect(onPick).not.toHaveBeenCalled();
});

it("does not offer AI without the management affordance", () => {
  setup(false);
  expect(
    screen.queryByRole("button", { name: "Read location with AI" }),
  ).not.toBeInTheDocument();
});

it("offers separate barcode and AI icons and switches camera modes without submitting an AI request", async () => {
  setup();
  const ai = screen.getByRole("button", {
    name: "Read location with AI camera",
  });
  fireEvent.click(ai);
  expect(ai).toHaveAttribute("aria-pressed", "true");
  expect(
    screen.getByRole("button", { name: "Scan location barcode or QR" }),
  ).toHaveAttribute("aria-pressed", "false");
  expect(
    screen.getByRole("region", { name: "Read a location label" }),
  ).toBeInTheDocument();
  expect(mocks.action).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Scan location barcode or QR" }),
  );
  expect(ai).toHaveAttribute("aria-pressed", "false");
  expect(
    screen.queryByRole("region", { name: "Read a location label" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByLabelText("Stop camera", { selector: "button" }),
  ).toHaveAttribute("aria-pressed", "true");
});
