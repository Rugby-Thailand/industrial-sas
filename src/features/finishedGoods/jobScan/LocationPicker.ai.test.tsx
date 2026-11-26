import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
  return { onPick, ...view };
}
function select() {
  fireEvent.change(
    screen.getByLabelText("Choose photo", { selector: "input" }),
    {
      target: { files: [file()] },
    },
  );
}
function read() {
  fireEvent.click(
    screen.getByRole("button", { name: "Read location with AI" }),
  );
}
function startReading() {
  fireEvent.click(screen.getByRole("button", { name: "Photo AI" }));
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

it.each([
  [
    "en",
    "Photo AI",
    "Choose photo",
    "Review location code",
    "Take another photo",
    "Back to photo",
    "Close Photo AI",
    "Location label photo",
  ],
  [
    "th",
    "ถ่ายรูป AI",
    "เลือกรูป",
    "ตรวจสอบรหัสตำแหน่ง",
    "ถ่ายรูปใหม่",
    "กลับไปที่รูป",
    "ปิดถ่ายรูป AI",
    "รูปป้ายตำแหน่ง",
  ],
] as const)(
  "names the retake return accurately and keeps the corrected %s photo review",
  async (
    locale,
    aiLabel,
    chooseLabel,
    reviewLabel,
    retakeLabel,
    returnLabel,
    closeLabel,
    photoLabel,
  ) => {
    renderWithIntl(
      <LocationPicker
        warehouseId="warehouse-a"
        onPick={vi.fn()}
        canReadImage
      />,
      { locale, preserveProviders: true },
    );
    const ai = screen.getByRole("button", { name: aiLabel });
    fireEvent.click(ai);
    fireEvent.change(
      screen.getByLabelText(chooseLabel, { selector: "input" }),
      {
        target: { files: [file()] },
      },
    );
    fireEvent.change(
      await screen.findByRole("textbox", { name: reviewLabel }),
      {
        target: { value: "CORRECTED-DOCK" },
      },
    );
    const photoHref = window.location.href;
    fireEvent.click(screen.getByRole("button", { name: retakeLabel }));
    expect(screen.queryByRole("button", { name: closeLabel })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: returnLabel }));
    expect(await screen.findByRole("img", { name: photoLabel })).toBeVisible();
    expect(screen.getByRole("textbox", { name: reviewLabel })).toHaveValue(
      "CORRECTED-DOCK",
    );
    expect(mocks.action).toHaveBeenCalledOnce();
    // Explicit return renders the retained photo before native entry consumption finishes.
    await waitFor(() => expect(window.location.href).toBe(photoHref));
    fireEvent.click(screen.getByRole("button", { name: closeLabel }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  },
);

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
    if (change === "typing") {
      fireEvent.click(screen.getByRole("button", { name: "Close Photo AI" }));
      fireEvent.change(
        screen.getByRole("textbox", { name: "Search location" }),
        { target: { value: "Dock" } },
      );
    } else if (change === "warehouse")
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
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
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
  fireEvent.click(screen.getByRole("button", { name: "Close Photo AI" }));
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
  fireEvent.click(screen.getByRole("button", { name: "Scan code" }));
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
    screen.queryByRole("button", { name: "Photo AI" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Scan code" }));
  expect(
    screen.queryByRole("button", { name: "Photo AI" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Read location with AI" }),
  ).not.toBeInTheDocument();
});

it("switches between one scan mode and one Photo AI mode without submitting an AI request", async () => {
  setup();
  fireEvent.click(screen.getByRole("button", { name: "Scan code" }));
  const qr = screen.getByRole("dialog", { name: "Scan code" });
  expect(
    within(qr).queryByRole("button", { name: "Read location with AI" }),
  ).not.toBeInTheDocument();
  fireEvent.click(within(qr).getByRole("button", { name: "Photo AI" }));
  expect(qr).not.toBeInTheDocument();
  const photo = screen.getByRole("dialog", { name: "Read a location label" });
  expect(
    within(photo).getAllByRole("button", { name: "Choose photo" }),
  ).toHaveLength(1);
  expect(
    within(photo).queryByRole("button", { name: /Read .*with AI/ }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    within(photo).getByRole("button", { name: "Close Photo AI" }),
  );
  expect(photo).not.toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: "Scan code" })).toBeVisible();
  expect(mocks.action).not.toHaveBeenCalled();
});

it.each(["default", "jobScan"] as const)(
  "the %s Photo AI dialog has only one close before and after reading a photo",
  async (presentation) => {
    renderWithIntl(
      <LocationPicker
        warehouseId="warehouse-a"
        onPick={vi.fn()}
        canReadImage
        presentation={presentation}
      />,
      { locale: "en", preserveProviders: true },
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Search location" }), {
      target: { value: "DOCK" },
    });
    const ai = screen.getByRole("button", { name: "Photo AI" });
    fireEvent.click(ai);
    const dialog = screen.getByRole("dialog", {
      name: "Read a location label",
    });
    expect(
      within(dialog).getByLabelText("Camera preview", { selector: "video" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getAllByRole("button", { name: "Close Photo AI" }),
    ).toHaveLength(1);
    select();
    await within(dialog).findByRole("textbox", {
      name: "Review location code",
    });
    const [close] = within(dialog).getAllByRole("button", {
      name: "Close Photo AI",
    });
    expect(
      within(dialog).getAllByRole("button", { name: "Close Photo AI" }),
    ).toHaveLength(1);
    fireEvent.click(close!);
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(
      screen.getByRole("textbox", { name: "Search location" }),
    ).toHaveValue("DOCK");
  },
);

it.each(["default", "jobScan"] as const)(
  "the %s QR dialog has one close and keeps image and manual channels available",
  (presentation) => {
    renderWithIntl(
      <LocationPicker
        warehouseId="warehouse-a"
        onPick={vi.fn()}
        canReadImage
        presentation={presentation}
      />,
      { locale: "en", preserveProviders: true },
    );
    const scan = screen.getByRole("button", { name: "Scan code" });
    fireEvent.click(scan);
    const dialog = screen.getByRole("dialog", { name: "Scan code" });
    expect(
      within(dialog).getByLabelText("Barcode and QR camera preview", {
        selector: "video",
      }),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Stop camera" }),
    ).toBeNull();
    expect(
      within(dialog).getByRole("button", { name: "Choose image" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("textbox", { name: "Search location" }),
    ).toBeNull();
    const [close] = within(dialog).getAllByRole("button", {
      name: "Close camera",
    });
    expect(
      within(dialog).getAllByRole("button", { name: "Close camera" }),
    ).toHaveLength(1);
    fireEvent.click(close!);
    expect(dialog).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Photo AI" })).toBeEnabled();
    expect(
      screen.getByRole("textbox", { name: "Search location" }),
    ).toBeEnabled();
  },
);

describe("Scan job ticket location step presentation", () => {
  function setupJobScan(presentation?: "jobScan") {
    const onPick = vi.fn();
    renderWithIntl(
      <LocationPicker
        warehouseId="warehouse-a"
        onPick={onPick}
        canReadImage
        {...(presentation ? { presentation } : {})}
      />,
      { locale: "en", preserveProviders: true },
    );
    return { onPick };
  }
  it.each(["default", "jobScan"] as const)(
    "uses a full-screen whole-frame preview and image picker in %s",
    (presentation) => {
      setupJobScan(presentation === "jobScan" ? presentation : undefined);
      fireEvent.click(screen.getByRole("button", { name: "Scan code" }));
      const dialog = screen.getByRole("dialog", { name: "Scan code" });
      expect(dialog).toHaveAttribute("data-camera-dialog", "true");
      expect(
        within(dialog).getByLabelText("Barcode and QR camera preview", {
          selector: "video",
        }),
      ).toHaveClass("object-contain");
      expect(
        within(dialog).getByRole("button", { name: "Choose image" }),
      ).toBeEnabled();
    },
  );

  it("rereads the same photo once from the centre of the photo", async () => {
    mocks.action.mockResolvedValue(
      querySuccess({ ok: false, error: { code: "AI_UNREADABLE" } }),
    );
    setupJobScan("jobScan");
    startReading();
    await screen.findByRole("alert");
    expect(mocks.action).toHaveBeenCalledOnce();
    const [photo] = mocks.prepare.mock.calls[0]!;
    // The full-width retry and the take-another-photo icon are gone; image
    // choice and the warning remain.
    expect(
      screen.queryByRole("button", { name: "Retry reading" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Take another photo" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose photo" })).toBeVisible();
    // Tapping the picture itself never asks the AI.
    fireEvent.click(screen.getByRole("img", { name: "Location label photo" }));
    expect(mocks.action).toHaveBeenCalledOnce();

    const retry = screen.getByRole("button", {
      name: "Read this photo again with AI",
    });
    expect(
      screen.getByRole("img", { name: "Location label photo" }).parentElement,
    ).toContainElement(retry);
    let finish!: (value: ReturnType<typeof extracted>) => void;
    mocks.action.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    fireEvent.click(retry);
    await waitFor(() => expect(mocks.action).toHaveBeenCalledTimes(2));
    // The same file is prepared again, and the busy state offers only Cancel.
    expect(mocks.prepare).toHaveBeenCalledTimes(2);
    expect(mocks.prepare.mock.calls[1]![0]).toBe(photo);
    expect(
      screen.queryByRole("button", { name: "Read this photo again with AI" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeVisible();
    await act(async () => finish(extracted()));
    expect(
      await screen.findByRole("textbox", { name: "Review location code" }),
    ).toHaveValue("F1-L3-11");
    expect(mocks.action).toHaveBeenCalledTimes(2);
  });

  it("keeps the default reader's retry and camera controls", async () => {
    mocks.action.mockResolvedValue(
      querySuccess({ ok: false, error: { code: "AI_UNREADABLE" } }),
    );
    setupJobScan();
    startReading();
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Retry reading" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Take another photo" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Read this photo again with AI" }),
    ).not.toBeInTheDocument();
  });
});

it("shows translated quota refusal inside the retained location photo", async () => {
  mocks.action.mockResolvedValue(
    querySuccess({
      ok: false,
      error: { code: "RATE_LIMITED" },
      retryAfterMs: 1000,
    }),
  );
  const { onPick } = setup();
  startReading();
  select();
  await screen.findByText(
    "Too many AI photo requests. Wait up to 10 minutes, then try again. You can enter the details manually.",
  );
  expect(screen.getByRole("button", { name: "Retry reading" })).toBeEnabled();
  expect(onPick).not.toHaveBeenCalled();
});
