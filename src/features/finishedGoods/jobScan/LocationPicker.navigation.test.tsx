import {
  getTestMutation,
  registerTestMutation,
} from "@tests/fixtures/convex-mutation";
import { fgRefs } from "@/lib/convex/finishedGoodsApi";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { getFunctionName } from "convex/server";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { querySuccess, writeSuccess } from "@tests/fixtures/finished-goods-ui";
import { NavigationGuardProvider } from "@/components/navigation/NavigationGuardProvider";
import { PageBackButton } from "@/components/ui/PageBackButton";
import { trackAppHistory } from "@/lib/browser/appHistory";
import type * as LocationImagePreparation from "./prepareLocationImage";
import { LocationPicker } from "./LocationPicker";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  action: vi.fn(),
  prepare: vi.fn<typeof LocationImagePreparation.prepareLocationImage>(),
  create: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("@/hooks/useDraftKey", () => ({
  useDraftKey: (scope: string) => `${scope}:user-a`,
}));
vi.mock("@/i18n/navigation", () => ({
  Link: (props: ComponentProps<"a">) => <a {...props} />,
  useRouter: () => ({
    replace: mocks.replace,
    push: vi.fn(),
    back: () => window.history.back(),
  }),
}));
vi.mock("./prepareLocationImage", () => ({
  prepareLocationImage: mocks.prepare,
}));
vi.mock("../BarcodeCameraBox", () => ({
  BarcodeCameraBox: ({
    onCode,
    onReadWithAi,
    actions,
  }: {
    onCode: (code: string) => void;
    onReadWithAi?: (file?: File) => void;
    actions?: React.ReactNode;
  }) => (
    <div>
      <p>Location camera active</p>
      {actions}
      <button onClick={() => onCode("NEW-LOCATION")}>Decode location</button>
      <button onClick={() => onReadWithAi?.()}>
        Read barcode photo with AI
      </button>
      <button
        onClick={() =>
          onReadWithAi?.(
            new File(["selected barcode photo"], "location.jpg", {
              type: "image/jpeg",
            }),
          )
        }
      >
        Read selected barcode photo with AI
      </button>
    </div>
  ),
}));
vi.mock("convex/react", () => ({
  useMutation: getTestMutation,
  useConvex: () => ({ query: mocks.query, action: mocks.action }),
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
    if (args === "skip") return undefined;
    const name = getFunctionName(ref);
    if (name.endsWith(":options"))
      return querySuccess({
        buildings: [
          { id: "building-a", code: "A", name: "Building A", floors: [] },
        ],
      });
    if (name.endsWith(":resolve"))
      return querySuccess({ ok: false, error: { code: "LOCATION_NOT_FOUND" } });
    return querySuccess({
      status: "ready",
      items: [],
      page: [],
      isDone: true,
      continueCursor: "",
      canCreate: true,
    });
  },
}));
const origin = "/th/finished-goods?search=box&tag=a&tag=b#catalogue";
const page = "/en/finished-goods/scan?source=warehouse#location";
let stop: (() => void) | undefined;
beforeEach(() => {
  registerTestMutation(fgRefs.createJobScanLocation, mocks.create);

  vi.clearAllMocks();
  mocks.prepare.mockReset().mockResolvedValue("data:image/jpeg;base64,YWJj");
  window.localStorage.clear();
  window.history.replaceState({ appNavigationIndex: 0 }, "", origin);
  stop = trackAppHistory();
  window.history.pushState({}, "", page);
  mocks.query.mockResolvedValue(
    querySuccess({ ok: false, error: { code: "LOCATION_NOT_FOUND" } }),
  );
  mocks.create.mockResolvedValue(writeSuccess("named-a"));
  mocks.action.mockResolvedValue(
    querySuccess({
      ok: true,
      candidates: [{ code: "DOCK-A", labelText: null }],
    }),
  );
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:location-navigation");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  stop?.();
  vi.restoreAllMocks();
});
function show(presentation: "default" | "jobScan" = "default") {
  const onPick = vi.fn();
  const view = renderWithIntl(
    <NavigationGuardProvider>
      <PageBackButton fallbackHref="/finished-goods" />
      <LocationPicker
        warehouseId="warehouse-a"
        onPick={onPick}
        canReadImage
        presentation={presentation}
      />
    </NavigationGuardProvider>,
    { locale: "en" },
  );
  return { ...view, onPick };
}
const href = () =>
  window.location.pathname + window.location.search + window.location.hash;
const cameraActive = () => screen.queryByText("Location camera active");
function closeCamera() {
  const camera = screen.getByRole("dialog", { name: "Scan code" });
  const [close] = within(camera).getAllByRole("button", {
    name: "Close camera",
  });
  expect(
    within(camera).getAllByRole("button", { name: "Close camera" }),
  ).toHaveLength(1);
  fireEvent.click(close!);
}
const aiDialog = () =>
  screen.getByRole("dialog", { name: "Read a location label" });
function closeAi() {
  fireEvent.click(
    within(aiDialog()).getByRole("button", { name: "Close Photo AI" }),
  );
}
async function openCamera() {
  const opener = screen.getByRole("button", { name: "Scan code" });
  fireEvent.click(opener);
  const camera = await screen.findByRole("dialog", { name: "Scan code" });
  expect(within(camera).getByText("Location camera active")).toBeVisible();
  await waitFor(() => expect(window.location.search).toContain("overlay"));
  return opener;
}
async function registration() {
  await openCamera();
  fireEvent.click(screen.getByRole("button", { name: "Decode location" }));
  const addLocation = await screen.findByRole(
    "button",
    { name: "Add location" },
    { timeout: 3000 },
  );
  fireEvent.click(addLocation);
  await screen.findByRole("textbox", { name: "Location code" });
  await waitFor(() => expect(window.location.search).toContain("overlay"));
}

it("Location camera Close consumes its entry and the next native Back restores the actual locale query and hash", async () => {
  show();
  fireEvent.change(screen.getByRole("textbox", { name: "Search location" }), {
    target: { value: "DOCK" },
  });
  const opener = await openCamera();
  closeCamera();
  await waitFor(() => expect(href()).toBe(page));
  expect(cameraActive()).toBeNull();
  await waitFor(() => expect(opener).toHaveFocus());
  expect(screen.getByRole("textbox", { name: "Search location" })).toHaveValue(
    "DOCK",
  );
  act(() => window.history.back());
  await waitFor(() => expect(href()).toBe(origin));
});

it("native Back closes Photo AI acquisition and retains the typed location; Forward restores the same mode", async () => {
  show();
  fireEvent.change(screen.getByRole("textbox", { name: "Search location" }), {
    target: { value: "DOCK" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Photo AI" }));
  await screen.findByRole("dialog", { name: "Read a location label" });
  act(() => window.history.back());
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Read a location label" }),
    ).toBeNull(),
  );
  expect(screen.getByRole("textbox", { name: "Search location" })).toHaveValue(
    "DOCK",
  );
  expect(href()).toBe(page);
  act(() => window.history.forward());
  await screen.findByRole("dialog", { name: "Read a location label" });
});

it("header Back closes nested Photo AI before the camera and ignores its late AI answer", async () => {
  let finish!: (value: unknown) => void;
  mocks.action.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { onPick } = show();
  const headerBack = screen.getByRole("button", { name: "Back" });
  await openCamera();
  fireEvent.click(
    screen.getByRole("button", { name: "Read barcode photo with AI" }),
  );
  fireEvent.change(
    screen.getByLabelText("Choose photo", { selector: "input" }),
    {
      target: {
        files: [new File(["photo"], "label.jpg", { type: "image/jpeg" })],
      },
    },
  );
  await waitFor(() => expect(mocks.action).toHaveBeenCalledOnce());
  fireEvent.click(headerBack);
  await screen.findByText("Location camera active");
  await act(async () =>
    finish(
      querySuccess({
        ok: true,
        candidates: [{ code: "STALE", labelText: null }],
      }),
    ),
  );
  expect(onPick).not.toHaveBeenCalled();
  expect(mocks.query).not.toHaveBeenCalled();
  closeCamera();
  await waitFor(() => expect(href()).toBe(page));
});

it.each(["default", "jobScan"] as const)(
  "nested Photo AI in %s closes to QR, then camera Close leaves the draft and next Back restores the origin",
  async (presentation) => {
    const { onPick } = show(presentation);
    fireEvent.change(screen.getByRole("textbox", { name: "Search location" }), {
      target: { value: "DOCK" },
    });
    await openCamera();
    const qrUrl = href();
    fireEvent.click(screen.getByRole("button", { name: "Photo AI" }));
    await screen.findByRole("dialog", { name: "Read a location label" });
    await waitFor(() => expect(href()).not.toBe(qrUrl));
    closeAi();
    await waitFor(() => expect(href()).toBe(qrUrl));
    await screen.findByText("Location camera active");
    closeCamera();
    await waitFor(() => expect(href()).toBe(page));
    expect(cameraActive()).toBeNull();
    expect(
      screen.queryByRole("dialog", { name: "Read a location label" }),
    ).toBeNull();
    expect(
      screen.getByRole("textbox", { name: "Search location" }),
    ).toHaveValue("DOCK");
    expect(onPick).not.toHaveBeenCalled();
    act(() => window.history.back());
    await waitFor(() => expect(href()).toBe(origin));
  },
);

it("closing nested Photo AI cancels the lookup and rearms the QR scanner", async () => {
  let finish!: (value: unknown) => void;
  mocks.query.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { onPick } = show();
  await openCamera();
  const qrUrl = href();
  fireEvent.click(
    screen.getByRole("button", { name: "Read selected barcode photo with AI" }),
  );
  await screen.findByRole("textbox", { name: "Review location code" });
  fireEvent.click(
    within(aiDialog()).getByRole("button", { name: "Use this code" }),
  );
  await waitFor(() => expect(mocks.query).toHaveBeenCalledOnce());
  expect(within(aiDialog()).getByText(/Checking location/)).toBeVisible();
  closeAi();
  await waitFor(() => expect(href()).toBe(qrUrl));
  await waitFor(() =>
    expect(screen.getByRole("heading", { name: "Scan code" })).toHaveFocus(),
  );
  await act(async () =>
    finish(
      querySuccess({
        ok: true,
        location: { locationId: "stale", code: "DOCK-A", name: "Stale dock" },
      }),
    ),
  );
  expect(onPick).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Decode location" }));
  await waitFor(() => expect(href()).toBe(page));
  await waitFor(() =>
    expect(
      screen.getByRole("textbox", { name: "Search location" }),
    ).toHaveValue("NEW-LOCATION"),
  );
  expect(mocks.query).toHaveBeenCalledTimes(2);
});

it("Back guards an unsent Location registration draft and Keep editing retains the label", async () => {
  show();
  await registration();
  fireEvent.change(
    screen.getByRole("textbox", { name: "Display name (optional)" }),
    { target: { value: "North dock" } },
  );
  act(() => window.history.back());
  fireEvent.click(await screen.findByRole("button", { name: "Keep editing" }));
  expect(
    screen.getByRole("textbox", { name: "Display name (optional)" }),
  ).toHaveValue("North dock");
  expect(screen.getByRole("textbox", { name: "Location code" })).toHaveValue(
    "NEW-LOCATION",
  );
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Discard changes" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("textbox", { name: "Location code" })).toBeNull(),
  );
  await waitFor(() => expect(href()).toBe(page));
  act(() => window.history.back());
  await waitFor(() => expect(href()).toBe(origin));
});

it("pending Location registration protects Back and completion consumes its registration entry", async () => {
  let finish!: (value: ReturnType<typeof writeSuccess>) => void;
  mocks.create.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { onPick } = show();
  await registration();
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: "Building" }));
  await user.click(screen.getByRole("option", { name: "A · Building A" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Create and use location" }),
  );
  await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
  act(() => window.history.back());
  await screen.findByTestId("navigation-guard-pending");
  expect(
    screen.getByRole("button", { name: "Discard changes" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  mocks.query.mockResolvedValue(
    querySuccess({
      ok: true,
      location: {
        locationId: "named-a",
        code: "NEW-LOCATION",
        name: "North dock",
        buildingId: "building-a",
      },
    }),
  );
  await act(async () => finish(writeSuccess("named-a")));
  await waitFor(() => expect(onPick).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(screen.queryByRole("textbox", { name: "Location code" })).toBeNull(),
  );
  await waitFor(() => expect(href()).toBe(page));
  act(() => window.history.back());
  await waitFor(() => expect(href()).toBe(origin));
});

it("native Back returns Location retake camera to its retained AI photo and corrected code", async () => {
  mocks.action.mockResolvedValue(
    querySuccess({
      ok: true,
      candidates: [
        { code: "DOCK-A", labelText: null },
        { code: "DOCK-B", labelText: null },
      ],
    }),
  );
  show();
  fireEvent.click(screen.getByRole("button", { name: "Photo AI" }));
  fireEvent.change(
    screen.getByLabelText("Choose photo", { selector: "input" }),
    {
      target: {
        files: [new File(["photo"], "label.jpg", { type: "image/jpeg" })],
      },
    },
  );
  const code = await screen.findByRole("textbox", {
    name: "Review location code",
  });
  fireEvent.change(code, { target: { value: "CORRECTED-DOCK" } });
  fireEvent.click(screen.getByRole("button", { name: "Take another photo" }));
  const retake = await screen.findByRole("dialog", {
    name: "Take another photo",
  });
  const retakeHref = href();
  const choosePhoto = within(retake).getByRole("button", {
    name: "Choose photo",
  });
  const invalid = new File(["text"], "not-a-photo.txt", { type: "text/plain" });
  const upload = screen.getByLabelText("Choose photo", { selector: "input" });
  fireEvent.change(upload, { target: { files: [invalid] } });
  expect(
    within(retake).getByText("Choose a JPEG, PNG, or WebP image."),
  ).toBeVisible();
  expect(choosePhoto).toBeEnabled();
  expect(
    within(retake).getByRole("button", { name: "Back to photo" }),
  ).toBeVisible();
  expect(href()).toBe(retakeHref);
  fireEvent.click(choosePhoto);
  expect(
    within(retake).queryByText("Choose a JPEG, PNG, or WebP image."),
  ).toBeNull();
  fireEvent.change(upload, { target: { files: [invalid] } });
  act(() => window.history.back());
  await waitFor(() =>
    expect(
      screen.getByRole("img", { name: "Location label photo" }),
    ).toBeVisible(),
  );
  expect(
    screen.getByRole("textbox", { name: "Review location code" }),
  ).toHaveValue("CORRECTED-DOCK");
  expect(screen.getByRole("button", { name: "DOCK-A" })).toBeVisible();
  expect(screen.getByRole("button", { name: "DOCK-B" })).toBeVisible();
  expect(screen.queryByText("Choose a JPEG, PNG, or WebP image.")).toBeNull();
  expect(mocks.action).toHaveBeenCalledOnce();
  closeAi();
  await waitFor(() => expect(href()).toBe(page));
  act(() => window.history.back());
  await waitFor(() => expect(href()).toBe(origin));
});

it("native Back cancels pending retake preparation and keeps the corrected photo review", async () => {
  show();
  fireEvent.click(screen.getByRole("button", { name: "Photo AI" }));
  const upload = screen.getByLabelText("Choose photo", { selector: "input" });
  fireEvent.change(upload, {
    target: {
      files: [new File(["original"], "label.jpg", { type: "image/jpeg" })],
    },
  });
  const code = await screen.findByRole("textbox", {
    name: "Review location code",
  });
  fireEvent.change(code, { target: { value: "CORRECTED-DOCK" } });
  const reviewHref = href();
  fireEvent.click(screen.getByRole("button", { name: "Take another photo" }));
  const camera = await screen.findByRole("dialog", {
    name: "Take another photo",
  });
  await waitFor(() => expect(href()).not.toBe(reviewHref));

  let finish!: (value: string) => void;
  mocks.prepare.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  fireEvent.change(upload, {
    target: {
      files: [new File(["pending"], "replacement.jpg", { type: "image/jpeg" })],
    },
  });
  expect(mocks.prepare).toHaveBeenCalledTimes(2);
  const signal = mocks.prepare.mock.calls[1]![1].signal;
  expect(signal?.aborted).toBe(false);
  expect(camera).toBeVisible();

  act(() => window.history.back());
  await waitFor(() => expect(href()).toBe(reviewHref));
  await waitFor(() => expect(camera).not.toBeInTheDocument());
  expect(signal?.aborted).toBe(true);
  await act(async () => finish("data:image/jpeg;base64,bGF0ZQ=="));
  expect(
    screen.getByRole("textbox", { name: "Review location code" }),
  ).toHaveValue("CORRECTED-DOCK");
  expect(
    screen.getByRole("img", { name: "Location label photo" }),
  ).toBeVisible();
  expect(mocks.action).toHaveBeenCalledOnce();
});

it("explicit retake Back to photo and outer Close consume their entries before the next Back", async () => {
  show();
  fireEvent.change(screen.getByRole("textbox", { name: "Search location" }), {
    target: { value: "DOCK" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Photo AI" }));
  fireEvent.change(
    screen.getByLabelText("Choose photo", { selector: "input" }),
    {
      target: {
        files: [new File(["photo"], "label.jpg", { type: "image/jpeg" })],
      },
    },
  );
  const reviewedCode = await screen.findByRole("textbox", {
    name: "Review location code",
  });
  reviewedCode.focus();
  const retake = screen.getByRole("button", { name: "Take another photo" });
  fireEvent.click(retake);
  fireEvent.click(await screen.findByRole("button", { name: "Back to photo" }));
  await waitFor(() => expect(retake).toHaveFocus());
  closeAi();
  await waitFor(() => expect(href()).toBe(page));
  expect(
    screen.queryByRole("dialog", { name: "Read a location label" }),
  ).toBeNull();
  expect(screen.getByRole("textbox", { name: "Search location" })).toHaveValue(
    "DOCK",
  );
  act(() => window.history.back());
  await waitFor(() => expect(href()).toBe(origin));
});

it("a remounted Location picker retires its old camera entry without recreating unsent acquisition", async () => {
  const view = show();
  await openCamera();
  view.unmount();
  show();
  await waitFor(() => expect(href()).toBe(page));
  expect(cameraActive()).toBeNull();
  act(() => window.history.back());
  await waitFor(() => expect(href()).toBe(origin));
});

it.each(["default", "jobScan"] as const)(
  "one-shot Forward restores nested %s Photo AI with its return and completion ownership",
  async (presentation) => {
    const { onPick } = show(presentation);
    fireEvent.change(screen.getByRole("textbox", { name: "Search location" }), {
      target: { value: "DOCK" },
    });
    await openCamera();
    const qrUrl = href();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Read selected barcode photo with AI",
      }),
    );
    await screen.findByRole("textbox", { name: "Review location code" });
    await waitFor(() => expect(href()).not.toBe(qrUrl));
    const aiUrl = href();
    const acquiredHistoryLength = window.history.length;

    // A browser history-menu jump can traverse both owned entries at once.
    act(() => window.history.go(-2));
    await waitFor(() => expect(href()).toBe(page));
    act(() => window.history.go(2));
    await waitFor(() => expect(href()).toBe(aiUrl));
    await screen.findByRole("img", { name: "Location label photo" });
    expect(cameraActive()).toBeNull();
    expect(window.history.length).toBe(acquiredHistoryLength);

    // Explicit confirmation consumes both restored entries before showing the result.
    fireEvent.click(
      within(aiDialog()).getByRole("button", { name: "Use this code" }),
    );
    await waitFor(() => expect(href()).toBe(page));
    expect(
      screen.queryByRole("dialog", { name: "Read a location label" }),
    ).toBeNull();
    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: "Search location" }),
      ).toHaveValue("DOCK-A"),
    );

    // Restoring the completed entries still returns to QR first.
    act(() => window.history.go(2));
    await waitFor(() => expect(href()).toBe(aiUrl));
    await screen.findByRole("dialog", { name: "Read a location label" });
    closeAi();
    await waitFor(() => expect(href()).toBe(qrUrl));
    expect(cameraActive()).toBeVisible();
    closeCamera();
    await waitFor(() => expect(href()).toBe(page));
    expect(
      screen.getByRole("textbox", { name: "Search location" }),
    ).toHaveValue("DOCK-A");
    expect(onPick).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    act(() => window.history.back());
    await waitFor(() => expect(href()).toBe(origin));
  },
);

it("a remounted nested Photo AI picker retires both entries before Forward or a stale direct link", async () => {
  const view = show();
  await openCamera();
  fireEvent.click(
    screen.getByRole("button", { name: "Read selected barcode photo with AI" }),
  );
  await screen.findByRole("textbox", { name: "Review location code" });
  const aiUrl = href();
  view.unmount();
  const remounted = show();
  await waitFor(() => expect(href()).toBe(page));
  act(() => window.history.back());
  await waitFor(() => expect(href()).toBe(origin));
  act(() => window.history.forward());
  await waitFor(() => expect(href()).toBe(page));
  expect(screen.getByRole("button", { name: "Photo AI" })).toBeEnabled();
  expect(
    screen.queryByRole("dialog", { name: "Read a location label" }),
  ).toBeNull();

  remounted.unmount();
  window.history.replaceState({}, "", aiUrl);
  show();
  await waitFor(() => expect(href()).toBe(page));
  expect(screen.getByRole("button", { name: "Photo AI" })).toBeEnabled();
  expect(
    screen.queryByRole("dialog", { name: "Read a location label" }),
  ).toBeNull();
  expect(mocks.action).toHaveBeenCalledOnce();
});
