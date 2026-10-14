import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
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
import { LocationPicker } from "./LocationPicker";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  action: vi.fn(),
  create: vi.fn(),
  replace: vi.fn(),
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
  prepareLocationImage: async () => "data:image/jpeg;base64,YWJj",
}));
vi.mock("../BarcodeCameraBox", () => ({
  BarcodeCameraBox: ({
    onCode,
    onReadWithAi,
  }: {
    onCode: (code: string) => void;
    onReadWithAi?: () => void;
  }) => (
    <div>
      <p>Location camera active</p>
      <button onClick={() => onCode("NEW-LOCATION")}>Decode location</button>
      <button onClick={() => onReadWithAi?.()}>
        Read barcode photo with AI
      </button>
    </div>
  ),
}));
vi.mock("convex/react", () => ({
  useMutation: () => mocks.create,
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
  vi.clearAllMocks();
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
/** The pressed scan action is the camera's only close control. */
function closeCamera() {
  const scan = screen.getByRole("button", { name: "Scan code" });
  expect(scan).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(scan);
}
async function openCamera() {
  fireEvent.click(screen.getByRole("button", { name: "Scan code" }));
  await screen.findByText("Location camera active");
  await waitFor(() => expect(window.location.search).toContain("overlay"));
}
async function registration() {
  await openCamera();
  fireEvent.click(screen.getByRole("button", { name: "Decode location" }));
  fireEvent.click(await screen.findByRole("button", { name: "Add location" }));
  await screen.findByRole("textbox", { name: "Location code" });
  await waitFor(() => expect(window.location.search).toContain("overlay"));
}

it("Location camera Close consumes its entry and the next native Back restores the actual locale query and hash", async () => {
  show();
  fireEvent.change(screen.getByRole("textbox", { name: "Search location" }), {
    target: { value: "DOCK" },
  });
  await openCamera();
  closeCamera();
  await waitFor(() => expect(href()).toBe(page));
  expect(cameraActive()).toBeNull();
  expect(screen.getByRole("button", { name: "Scan code" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
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
  await screen.findByRole("region", { name: "Read a location label" });
  act(() => window.history.back());
  await waitFor(() =>
    expect(
      screen.queryByRole("region", { name: "Read a location label" }),
    ).toBeNull(),
  );
  expect(screen.getByRole("textbox", { name: "Search location" })).toHaveValue(
    "DOCK",
  );
  expect(href()).toBe(page);
  act(() => window.history.forward());
  await screen.findByRole("region", { name: "Read a location label" });
});

it("header Back closes nested Photo AI before the camera and ignores its late AI answer", async () => {
  let finish!: (value: unknown) => void;
  mocks.action.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { onPick } = show();
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
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
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
  "nested Photo AI in %s keeps distinct return-to-QR and close-acquisition controls, then next Back restores the origin",
  async (presentation) => {
    const { onPick } = show(presentation);
    fireEvent.change(screen.getByRole("textbox", { name: "Search location" }), {
      target: { value: "DOCK" },
    });
    await openCamera();
    fireEvent.click(
      screen.getByRole("button", { name: "Read barcode photo with AI" }),
    );
    await screen.findByRole("region", { name: "Read a location label" });
    const ai = screen.getByRole("button", { name: "Photo AI" });
    expect(ai).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Close Photo AI" }));
    await screen.findByText("Location camera active");
    expect(screen.getByRole("button", { name: "Scan code" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Read barcode photo with AI" }),
    );
    await screen.findByRole("button", { name: "Close Photo AI" });
    fireEvent.click(ai);
    await waitFor(() => expect(href()).toBe(page));
    expect(cameraActive()).toBeNull();
    expect(
      screen.queryByRole("region", { name: "Read a location label" }),
    ).toBeNull();
    expect(
      screen.getByRole("textbox", { name: "Search location" }),
    ).toHaveValue("DOCK");
    expect(onPick).not.toHaveBeenCalled();
    act(() => window.history.back());
    await waitFor(() => expect(href()).toBe(origin));
  },
);

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
  expect(screen.getByRole("button", { name: "Close Photo AI" })).toBeVisible();
  act(() => window.history.back());
  await waitFor(() =>
    expect(
      screen.getByRole("img", { name: "Location label photo" }),
    ).toBeVisible(),
  );
  expect(
    screen.getByRole("textbox", { name: "Review location code" }),
  ).toHaveValue("CORRECTED-DOCK");
  expect(mocks.action).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Photo AI" }));
  await waitFor(() => expect(href()).toBe(page));
  act(() => window.history.back());
  await waitFor(() => expect(href()).toBe(origin));
});

it("the Photo AI mode closes a retake before outer acquisition and the next Back restores the origin", async () => {
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
  await screen.findByRole("textbox", { name: "Review location code" });
  fireEvent.click(screen.getByRole("button", { name: "Take another photo" }));
  await screen.findByRole("button", { name: "Close Photo AI" });
  fireEvent.click(screen.getByRole("button", { name: "Photo AI" }));
  await waitFor(() => expect(href()).toBe(page));
  expect(
    screen.queryByRole("region", { name: "Read a location label" }),
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
