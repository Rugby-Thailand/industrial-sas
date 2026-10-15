import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real WorkspaceProvider, warehouse store and QueryGate decide what the
// building and review routes render; only Convex, Clerk and the router are
// substituted.
const mocks = vi.hoisted(() => ({
  workspace: undefined as unknown,
  reads: [] as { name: string; args: unknown }[],
  read: (_name: string, _args: unknown): unknown => undefined,
  replace: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isLoading: false, isAuthenticated: true }),
  useQuery_experimental: () => mocks.workspace,
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
    if (args === "skip") return undefined;
    const name = getFunctionName(ref);
    mocks.reads.push({ name, args });
    return mocks.read(name, args);
  },
  useMutation: () => vi.fn(),
}));
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ userId: "user-a", orgId: "org-a" }),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...props }: ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
  useRouter: () => ({
    push: vi.fn(),
    back: () => window.history.back(),
    replace: mocks.replace,
  }),
}));

import {
  configuredEnvironment,
  renderWithIntl,
} from "@tests/fixtures/intl-render";
import { DraftGuardProvider } from "@/components/providers/DraftGuardProvider";
import { trackAppHistory } from "@/lib/browser/appHistory";
import { storageLayoutRefs } from "@/lib/convex/storageLayoutApi";
import { WAREHOUSE_STORAGE_KEY } from "@/lib/workspace/warehouseStore";
import {
  StorageBuildingEditor,
  StorageBuildingReview,
} from "./StorageLayoutScreens";

const LAYOUT = getFunctionName(storageLayoutRefs.layout);
const INVENTORY = getFunctionName(storageLayoutRefs.inventory);
const warehouses = [
  { id: "warehouse-a", code: "WH-A", name: "North" },
  { id: "warehouse-b", code: "WH-B", name: "South" },
];
const workspaceWith = (list = warehouses) => ({
  status: "success",
  data: {
    ok: true,
    requestId: "workspace",
    value: {
      organization: { id: "org-a", name: "Top Gold" },
      warehouses: list,
      navigationPermissions: ["masterData.storageLayout.read"],
      complete: true,
    },
  },
});
const notFound = { ok: true, requestId: "read", value: { found: false } };
const building = {
  buildingId: "pd",
  warehouseId: "warehouse-b",
  code: "PD",
  name: "Packing dock",
  widthMm: 20_000,
  depthMm: 12_000,
  defaultFloorHeightMm: 4_000,
  floorCount: 0,
  totalHeightMm: 0,
  grossAreaSqMm: 0,
  reservedAreaSqMm: 0,
  usableAreaSqMm: 0,
  status: "DRAFT",
  version: 1,
};
/** The building exists only in warehouse B, as the backend scopes it. */
function buildingInWarehouseB(name: string, args: unknown) {
  const inB = (args as { warehouseId?: string }).warehouseId === "warehouse-b";
  if (name === LAYOUT)
    return inB
      ? {
          ok: true,
          requestId: "layout",
          value: { found: true, building, floors: [] },
        }
      : notFound;
  if (name === INVENTORY)
    return inB
      ? { ok: true, requestId: "inventory", value: { found: true, zones: [] } }
      : notFound;
  return undefined;
}

const href = () =>
  window.location.pathname + window.location.search + window.location.hash;
let stop: (() => void) | undefined;
beforeEach(() => {
  window.localStorage.clear();
  mocks.reads = [];
  mocks.replace.mockReset();
  mocks.workspace = workspaceWith();
  mocks.read = (name) =>
    name === LAYOUT || name === INVENTORY ? notFound : undefined;
});
afterEach(() => {
  cleanup();
  stop?.();
  stop = undefined;
});

function open(url: string, origin?: string) {
  window.history.replaceState({ appNavigationIndex: 0 }, "", origin ?? url);
  stop = trackAppHistory();
  if (origin) window.history.pushState({}, "", url);
}
const render = (ui: React.ReactElement, locale: "en" | "th" = "en") =>
  renderWithIntl(<DraftGuardProvider>{ui}</DraftGuardProvider>, {
    locale,
    environment: configuredEnvironment,
    preserveProviders: true,
  });

describe("building and review recovery states", () => {
  it.each([
    [
      "building",
      "/en/master-data/storage-layouts/missing?floor=2#map",
      <StorageBuildingEditor key="b" buildingId="missing" />,
      "/master-data/storage-layouts",
    ],
    [
      "review",
      "/en/master-data/storage-layouts/missing/review#issues",
      <StorageBuildingReview key="r" buildingId="missing" />,
      "/master-data/storage-layouts/missing",
    ],
  ] as const)(
    "a direct %s link to a missing building keeps its heading, trail and header Back to the declared parent",
    async (_page, url, ui, parent) => {
      window.localStorage.setItem(WAREHOUSE_STORAGE_KEY, "warehouse-a");
      open(url);
      render(ui);
      expect(
        screen.getByRole("heading", { level: 1, name: "Building not found" }),
      ).toBeVisible();
      expect(
        screen.getByRole("link", { name: "Buildings & spots" }),
      ).toHaveAttribute("href", "/master-data/storage-layouts");
      expect(screen.getByTestId("building-not-found")).toHaveTextContent(
        "This link has no building in WH-A · North.",
      );
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
      await waitFor(() =>
        expect(mocks.replace).toHaveBeenCalledExactlyOnceWith(parent),
      );
      // A direct link adds no synthetic history entry of its own.
      expect(href()).toBe(url);
    },
  );

  it("header Back from a missing building restores the actual catalogue origin with its query and hash", async () => {
    window.localStorage.setItem(WAREHOUSE_STORAGE_KEY, "warehouse-a");
    const origin = "/th/master-data/storage-layouts?locations=x#catalogue";
    open("/th/master-data/storage-layouts/missing", origin);
    render(<StorageBuildingEditor buildingId="missing" />, "th");
    expect(
      screen.getByRole("heading", { level: 1, name: "ไม่พบอาคาร" }),
    ).toBeVisible();
    expect(screen.getByTestId("building-not-found")).toHaveTextContent(
      "WH-A · North",
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "ย้อนกลับ" }));
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(href()).toBe(origin);
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("a refused building read keeps the page frame and shows its technical reference", () => {
    window.localStorage.setItem(WAREHOUSE_STORAGE_KEY, "warehouse-a");
    mocks.read = (name) =>
      name === LAYOUT
        ? {
            ok: false,
            requestId: "req-denied-7",
            denial: {
              kind: "AUTHORIZATION_DENIED",
              code: "AUTHORIZATION_DENIED",
            },
          }
        : undefined;
    open("/en/master-data/storage-layouts/pd/review");
    render(<StorageBuildingReview buildingId="pd" />);
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Building could not be loaded",
      }),
    ).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("req-denied-7");
    expect(screen.getByRole("link", { name: "Building" })).toHaveAttribute(
      "href",
      "/master-data/storage-layouts/pd",
    );
    expect(screen.getByRole("button", { name: "Back" })).toBeEnabled();
  });
});

describe("building link without a stored warehouse", () => {
  it("chooses a warehouse in place and then renders that building on the same URL", async () => {
    mocks.read = buildingInWarehouseB;
    const url = "/en/master-data/storage-layouts/pd?floor=1&view=storage#map";
    open(url);
    render(<StorageBuildingEditor buildingId="pd" />);
    expect(screen.getByTestId("panel-WAREHOUSE_MISSING")).toHaveTextContent(
      "Choose a warehouse to see its work and records.",
    );
    // No building read starts until a warehouse is chosen.
    expect(mocks.reads).toEqual([]);
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Warehouse" }));
    await user.click(screen.getByRole("option", { name: "WH-B · South" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Packing dock" }),
    ).toBeVisible();
    expect(href()).toBe(url);
    expect(mocks.reads).toContainEqual({
      name: LAYOUT,
      args: { warehouseId: "warehouse-b", buildingId: "pd" },
    });
    expect(screen.queryByTestId("panel-WAREHOUSE_MISSING")).toBeNull();
    expect(screen.queryByTestId("warehouse-gate-select")).toBeNull();
  });

  it("names the selected warehouse when a stored one does not hold the linked building", () => {
    mocks.read = buildingInWarehouseB;
    window.localStorage.setItem(WAREHOUSE_STORAGE_KEY, "warehouse-a");
    open("/en/master-data/storage-layouts/pd");
    render(<StorageBuildingEditor buildingId="pd" />);
    expect(screen.getByTestId("building-not-found")).toHaveTextContent(
      "WH-A · North",
    );
    // A chosen warehouse is never switched from a detail page.
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("tells a member without an active warehouse to ask for access instead of choosing one", () => {
    mocks.workspace = workspaceWith([]);
    open("/en/master-data/storage-layouts/pd");
    render(<StorageBuildingEditor buildingId="pd" />);
    expect(screen.getByTestId("panel-WAREHOUSE_UNAVAILABLE")).toHaveTextContent(
      "No warehouse available",
    );
    expect(screen.queryByTestId("panel-WAREHOUSE_MISSING")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(mocks.reads).toEqual([]);
  });
});
