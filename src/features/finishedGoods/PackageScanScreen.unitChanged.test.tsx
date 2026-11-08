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
import { PackageScanScreen } from "./PackageScanScreen";

// Regression: confirmScanAssignment refuses a unit whose version
// (pallet.updatedAt) changed since it was scanned (UNIT_CHANGED). The screen
// keeps the queued unit with its old version, re-scanning that label is ignored
// as a duplicate (`current.some(item => item.id === unit.id) ? current`), and
// the retry re-sends the identical stale command. FG_UNIT_CHANGED has no
// message, so the user is told to "check your input and connection, then
// retry", which can never succeed.

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  assign: vi.fn(),
  serverVersion: 20,
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
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock("convex/react", () => ({
  useConvex: () => ({
    query: (ref: Parameters<typeof getFunctionName>[0], args: unknown) =>
      mocks.query(getFunctionName(ref), args),
  }),
  useMutation: getTestMutation,
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
  BarcodeCameraBox: ({ onClose }: { onClose: () => void }) => (
    <button onClick={onClose}>Stop package camera</button>
  ),
}));
const unit = () => ({
  id: "pallet-a",
  code: "P-A",
  productId: "product-a",
  productName: "Boxes",
  batchId: "batch-a",
  storageFormat: "PALLET",
  status: "AWAITING_MEASUREMENT",
  version: mocks.serverVersion,
});
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
  registerTestMutation(fgRefs.confirmScanAssignment, mocks.assign);
  localStorage.clear();
  mocks.serverVersion = 20;
  window.history.replaceState(
    { __NA: true, appNavigationIndex: 0 },
    "",
    "/en/finished-goods/packages/scan?batchId=batch-a#queue",
  );
  stopHistory = trackAppHistory();
  mocks.query
    .mockReset()
    .mockImplementation(async (name: string) =>
      querySuccess(
        name.endsWith(":resolvePackageCode")
          ? { ok: true, unit: unit() }
          : { ok: true, location },
      ),
    );
  // Server semantics: confirmScanAssignment compares pallet.updatedAt.
  mocks.assign
    .mockReset()
    .mockImplementation(
      async (args: { units: { unitId: string; version: number }[] }) =>
        args.units.every((row) => row.version === mocks.serverVersion)
          ? writeSuccess("assignment-a")
          : writeFailure("UNIT_CHANGED"),
    );
});

async function addPackage() {
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

it("a re-scanned package recovers from UNIT_CHANGED instead of resending the stale version", async () => {
  renderWithIntl(
    <NavigationGuardProvider>
      <PackageScanScreen batchId="batch-a" />
    </NavigationGuardProvider>,
    { locale: "en", workspace: false, preserveProviders: true },
  );
  await addPackage();
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
  // Another operator changes the unit after it was queued.
  mocks.serverVersion = 21;
  fireEvent.click(
    screen.getByRole("button", { name: "Review storage assignment" }),
  );
  fireEvent.click(
    await screen.findByRole("checkbox", { name: /I placed these packages/ }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirm stored" }));
  await waitFor(() => expect(mocks.assign).toHaveBeenCalledTimes(1));
  const message = (await screen.findByRole("alert")).textContent;

  // The operator follows the advice: close review, re-scan the label, retry.
  fireEvent.click(
    screen
      .getAllByRole("button", { name: "Back to edit" })
      .find((button) => !button.querySelector(".sr-only"))!,
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Confirm package storage" }),
    ).toBeNull(),
  );
  await addPackage();
  fireEvent.click(
    screen.getByRole("button", { name: "Review storage assignment" }),
  );
  const physical = await screen.findByRole("checkbox", {
    name: /I placed these packages/,
  });
  if (!(physical as HTMLInputElement).checked) fireEvent.click(physical);
  fireEvent.click(screen.getByRole("button", { name: "Confirm stored" }));
  await waitFor(() => expect(mocks.assign).toHaveBeenCalledTimes(2));
  const sentVersion = (
    mocks.assign.mock.calls[1]![0] as { units: { version: number }[] }
  ).units[0]!.version;
  const outcomes = await Promise.all(
    mocks.assign.mock.results.map((result) => result.value),
  );
  console.info(
    JSON.stringify({
      message,
      sentVersion,
      refused: outcomes.filter((outcome) => !outcome.value.written).length,
    }),
  );
  expect(sentVersion).toBe(21);
}, 20000);
