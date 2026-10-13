import {
  cleanup,
  act,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import type { ComponentProps, ReactNode } from "react";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import {
  querySuccess,
  writeFailure,
  writeSuccess,
  measuredPalletDetail,
} from "@tests/fixtures/finished-goods-ui";
import { trackAppHistory } from "@/lib/browser/appHistory";
import { NavigationGuardProvider } from "@/components/navigation/NavigationGuardProvider";
import { guardedNavigate } from "@/lib/navigationGuard";
import { PackageScanScreen } from "./PackageScanScreen";
import { PackingCompletion } from "./PackingCompletion";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  assign: vi.fn(),
  replace: vi.fn(),
  decode: undefined as ((code: string) => void) | undefined,
}));
vi.mock("@/hooks/useDraftKey", () => ({ useDraftKey: () => "actor-a" }));
vi.mock("@/hooks/useCanManage", () => ({ useCanManage: () => true }));
vi.mock("@/components/system/QueryGate", () => ({
  QueryGate: ({ children }: { children: (id: string) => ReactNode }) =>
    children("warehouse-a"),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...props }: ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
  useRouter: () => ({ replace: mocks.replace, push: mocks.replace }),
}));
vi.mock("convex/react", () => ({
  useConvex: () => ({
    query: (ref: Parameters<typeof getFunctionName>[0], args: unknown) =>
      mocks.query(getFunctionName(ref), args),
  }),
  useMutation: () => mocks.assign,
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) =>
    args === "skip"
      ? undefined
      : getFunctionName(ref).endsWith(":getPallet")
        ? querySuccess(measuredPalletDetail)
        : querySuccess({
            locationCode: "ZONE-A",
            orderedUnitIds: ["pallet-a"],
          }),
}));
vi.mock("./BarcodeCameraBox", () => ({
  BarcodeCameraBox: ({
    onCode,
    onClose,
  }: {
    onCode: (code: string) => void;
    onClose: () => void;
  }) => {
    mocks.decode = onCode;
    return <button onClick={onClose}>Stop package camera</button>;
  },
}));
const unit = {
  id: "pallet-a",
  code: "P-A",
  productId: "product-a",
  productName: "Boxes",
  batchId: "batch-a",
  storageFormat: "PALLET",
  status: "AWAITING_MEASUREMENT",
  version: 20,
};
const location = {
  zoneId: "zone-a",
  locationId: "location-a",
  buildingId: "building-a",
  floorId: "floor-a",
  code: "ZONE-A",
  name: "Storage A",
  version: "location-version",
};
let stopHistory: (() => void) | undefined;
afterEach(async () => {
  cleanup();
  stopHistory?.();
  vi.restoreAllMocks();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(
    { __NA: true, appNavigationIndex: 0 },
    "",
    "/en/finished-goods/packages/scan?batchId=batch-a#queue",
  );
  stopHistory = trackAppHistory();
  mocks.assign.mockReset().mockResolvedValue(writeSuccess("assignment-a"));
  mocks.query
    .mockReset()
    .mockImplementation(async (name: string) =>
      querySuccess(
        name.endsWith(":resolvePackageCode")
          ? { ok: true, unit }
          : { ok: true, location },
      ),
    );
});
function show() {
  return renderWithIntl(
    <NavigationGuardProvider>
      <PackageScanScreen batchId="batch-a" />
    </NavigationGuardProvider>,
    { locale: "en", workspace: false, preserveProviders: true },
  );
}
async function add() {
  fireEvent.change(screen.getByRole("textbox", { name: "Package code" }), {
    target: { value: "P-A" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add package" }));
  await waitFor(() =>
    expect(
      screen.getByRole("spinbutton", { name: "Fullness (%)" }),
    ).toHaveValue(100),
  );
}
async function verify() {
  fireEvent.change(
    screen.getByRole("textbox", { name: "Storage location code" }),
    { target: { value: "ZONE-A" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Verify location" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Review storage assignment" }),
    ).toBeEnabled(),
  );
}
async function review() {
  await add();
  await verify();
  fireEvent.click(
    screen.getByRole("button", { name: "Review storage assignment" }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("dialog", { name: "Confirm package storage" }),
    ).toBeVisible(),
  );
}
it("continues the real simple-packing Scan Packages action into inventory assignment", async () => {
  const view = renderWithIntl(
    <PackingCompletion
      summary="1 package"
      units={[]}
      simplePacking
      batchId="batch-a"
      productHref="/finished-goods/products/product-a"
      onReviewBatch={() => {}}
      onPrepareAnother={() => {}}
    />,
    { locale: "en", workspace: false, preserveProviders: true },
  );
  const href = screen
    .getByRole("link", { name: "Scan Packages" })
    .getAttribute("href")!;
  expect(href).toBe("/finished-goods/packages/scan?batchId=batch-a");
  const batchId = new URL(href, "https://example.test").searchParams.get(
    "batchId",
  )!;
  view.rerender(
    <NavigationGuardProvider>
      <PackageScanScreen batchId={batchId} />
    </NavigationGuardProvider>,
  );
  await review();
  expect(mocks.assign).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("checkbox", { name: /I placed these packages/ }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirm stored" }));
  await waitFor(() =>
    expect(
      screen.getByRole("heading", { name: "Packages stored" }),
    ).toBeVisible(),
  );
  expect(mocks.assign).toHaveBeenCalledWith(
    expect.objectContaining({
      warehouseId: "warehouse-a",
      units: [{ unitId: "pallet-a", version: 20, fillPercent: 100 }],
      location: {
        zoneId: "zone-a",
        version: "location-version",
        code: "ZONE-A",
        method: "MANUAL",
      },
      physicalConfirmed: true,
    }),
  );
  expect(mocks.query.mock.calls.map((call) => call[0])).toEqual([
    "finishedGoods/scanning:resolvePackageCode",
    "finishedGoods/scanning:resolveLocationCode",
  ]);
});
it("rejects a package from another batch without losing the selected group", async () => {
  show();
  await add();
  mocks.query.mockResolvedValueOnce(
    querySuccess({
      ok: true,
      unit: { ...unit, id: "other", batchId: "other-batch" },
    }),
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Package code" }), {
    target: { value: "OTHER" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add package" }));
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This label cannot be assigned",
    ),
  );
  expect(screen.getAllByRole("spinbutton")).toHaveLength(1);
  expect(mocks.assign).not.toHaveBeenCalled();
});
it("retains review on conflict and retries the same uncertain assignment request", async () => {
  mocks.assign.mockResolvedValueOnce(writeFailure("UNIT_CHANGED"));
  show();
  await review();
  fireEvent.click(
    screen.getByRole("checkbox", { name: /I placed these packages/ }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirm stored" }));
  await waitFor(() => expect(mocks.assign).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Confirm stored" }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirm stored" }));
  await waitFor(() => expect(mocks.assign).toHaveBeenCalledTimes(2));
  expect(mocks.assign.mock.calls[0]).toEqual(mocks.assign.mock.calls[1]);
});
it("native Back closes the package scanner and retains the group and query hash", async () => {
  show();
  await add();
  fireEvent.click(screen.getByRole("button", { name: "Scan location" }));
  await waitFor(() =>
    expect(screen.getByRole("dialog", { name: "Scan location" })).toBeVisible(),
  );
  act(() => window.history.back());
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Scan location" })).toBeNull(),
  );
  expect(screen.getByRole("spinbutton", { name: "Fullness (%)" })).toHaveValue(
    100,
  );
  expect(window.location.search).toContain("batchId=batch-a");
  expect(window.location.hash).toBe("#queue");
});
it("explicit scanner Close consumes its entry before the next Back and rejects late delivery", async () => {
  show();
  fireEvent.click(screen.getByRole("button", { name: "Scan packages" }));
  await waitFor(() => expect(screen.getByRole("dialog")).toBeVisible());
  const late = mocks.decode!;
  fireEvent.click(screen.getByRole("button", { name: "Stop package camera" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await act(async () => late("P-A"));
  expect(mocks.query).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(
      [...new URLSearchParams(window.location.search).keys()].filter((key) =>
        key.startsWith("overlay"),
      ),
    ).toEqual([]),
  );
});
it("protects a pending package write and retains the draft when leaving is canceled", async () => {
  let finish!: (value: ReturnType<typeof writeSuccess>) => void;
  mocks.assign.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  show();
  await review();
  fireEvent.click(
    screen.getByRole("checkbox", { name: /I placed these packages/ }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirm stored" }));
  const leave = vi.fn();
  act(() => guardedNavigate(leave));
  expect(screen.getByTestId("navigation-guard-pending")).toBeVisible();
  expect(leave).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  await act(async () => finish(writeSuccess("assignment-a")));
  await waitFor(() =>
    expect(
      screen.getByRole("heading", { name: "Packages stored" }),
    ).toBeVisible(),
  );
});

it("ignores a location verification that resolves after the typed destination changes", async () => {
  show();
  await add();
  let finish!: (
    value: ReturnType<
      typeof querySuccess<{ ok: true; location: typeof location }>
    >,
  ) => void;
  mocks.query.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.change(
    screen.getByRole("textbox", { name: "Storage location code" }),
    { target: { value: "OLD" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Verify location" }));
  fireEvent.change(
    screen.getByRole("textbox", { name: "Storage location code" }),
    { target: { value: "NEW" } },
  );
  await act(async () => finish(querySuccess({ ok: true, location })));
  expect(
    screen.getByRole("textbox", { name: "Storage location code" }),
  ).toHaveValue("NEW");
  expect(
    screen.getByRole("button", { name: "Review storage assignment" }),
  ).toBeDisabled();
});
it("recovers the same uncertain package assignment after remount without resolving stored units again", async () => {
  mocks.assign.mockRejectedValueOnce(new Error("NETWORK_ERROR"));
  const view = show();
  await review();
  fireEvent.click(
    screen.getByRole("checkbox", { name: /I placed these packages/ }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirm stored" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Confirm stored" }),
    ).toBeEnabled(),
  );
  const first = mocks.assign.mock.calls[0]![0];
  view.unmount();
  mocks.query.mockClear();
  show();
  await waitFor(() =>
    expect(
      screen.getByRole("dialog", { name: "Confirm package storage" }),
    ).toBeVisible(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirm stored" }));
  await waitFor(() => expect(mocks.assign).toHaveBeenCalledTimes(2));
  expect(mocks.assign.mock.calls[1]![0]).toEqual(first);
  expect(mocks.query).not.toHaveBeenCalled();
});

it("ignores a manual package lookup after the assignment page unmounts", async () => {
  const view = show();
  let finish!: (
    value: ReturnType<typeof querySuccess<{ ok: true; unit: typeof unit }>>,
  ) => void;
  mocks.query.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Package code" }), {
    target: { value: "P-A" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add package" }));
  view.unmount();
  await act(async () => finish(querySuccess({ ok: true, unit })));
  show();
  expect(screen.queryByRole("spinbutton", { name: "Fullness (%)" })).toBeNull();
  expect(mocks.assign).not.toHaveBeenCalled();
});
it("Forward restores the selected scanner without losing the package group", async () => {
  show();
  await add();
  fireEvent.click(screen.getByRole("button", { name: "Scan location" }));
  await waitFor(() =>
    expect(screen.getByRole("dialog", { name: "Scan location" })).toBeVisible(),
  );
  act(() => window.history.back());
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  act(() => window.history.forward());
  await waitFor(() =>
    expect(screen.getByRole("dialog", { name: "Scan location" })).toBeVisible(),
  );
  expect(
    screen.getByRole("spinbutton", { name: "Fullness (%)", hidden: true }),
  ).toHaveValue(100);
});

it("a pending scanner Close cannot rewrite a new same-path owner after unmount", async () => {
  const view = show();
  fireEvent.click(screen.getByRole("button", { name: "Scan packages" }));
  await waitFor(() => expect(screen.getByRole("dialog")).toBeVisible());
  const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
  fireEvent.click(screen.getByRole("button", { name: "Stop package camera" }));
  expect(back).toHaveBeenCalled();
  view.unmount();
  window.history.replaceState(
    { appNavigationIndex: 0 },
    "",
    "/en/finished-goods/packages/scan?batchId=batch-a&fresh=1#new-owner",
  );
  show();
  act(() =>
    window.dispatchEvent(
      new PopStateEvent("popstate", { state: window.history.state }),
    ),
  );
  expect(window.location.search).toBe("?batchId=batch-a&fresh=1");
  expect(window.location.hash).toBe("#new-owner");
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("direct unit package scanning rejects a different first package identity", async () => {
  renderWithIntl(
    <NavigationGuardProvider>
      <PackageScanScreen unitId="pallet-a" />
    </NavigationGuardProvider>,
    { locale: "en", workspace: false },
  );
  mocks.query.mockResolvedValueOnce(
    querySuccess({ ok: true, unit: { ...unit, id: "other-unit" } }),
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Package code" }), {
    target: { value: "OTHER" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add package" }));
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This label cannot be assigned",
    ),
  );
  expect(screen.queryByRole("spinbutton", { name: "Fullness (%)" })).toBeNull();
  expect(mocks.assign).not.toHaveBeenCalled();
});
it("direct batch package scan Header Back uses its safe batch parent", async () => {
  show();
  mocks.replace.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(mocks.replace).toHaveBeenCalledWith("/finished-goods/batches/batch-a");
});
