import { screen, within } from "@testing-library/react";
import type * as ClerkModule from "@clerk/nextjs";
import type { ComponentProps } from "react";
import type * as WorkspaceModule from "@/components/providers/WorkspaceProvider";
import { beforeEach, expect, it, vi } from "vitest";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { finishedGoodsWorkspace } from "@tests/fixtures/finished-goods-ui";
import { FinishedGoodsCatalogue } from "./FinishedGoodsCatalogue";
import { JobScanRecordsScreen } from "./jobScan/JobScanRecords";
import { StorageBuildingCatalogue } from "@/features/storageLayouts/StorageLayoutScreens";

const mocks = vi.hoisted(() => ({
  authLoaded: true,
  router: { back: vi.fn(), push: vi.fn(), replace: vi.fn() },
}));
vi.mock("@clerk/nextjs", async (importOriginal) => ({
  ...(await importOriginal<typeof ClerkModule>()),
  useAuth: () =>
    mocks.authLoaded
      ? { isLoaded: true, userId: "user-a", orgId: "org-a" }
      : { isLoaded: false },
}));
// The workspace never resolves, as when the backend cannot be reached.
vi.mock("@/components/providers/WorkspaceProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof WorkspaceModule>()),
  useWorkspace: () => ({
    ...finishedGoodsWorkspace,
    readiness: { kind: "LOADING" },
    selectedWarehouseId: undefined,
    loading: true,
    permissionsReady: false,
    navigationPermissions: [],
  }),
}));
vi.mock("convex/react", () => ({
  useQuery: () => undefined,
  useMutation: () => vi.fn(),
  useConvex: () => ({ query: vi.fn() }),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: (props: ComponentProps<"a">) => <a {...props} />,
  useRouter: () => mocks.router,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authLoaded = true;
  window.history.replaceState(
    { appNavigationIndex: 0 },
    "",
    "/en/finished-goods",
  );
});

it.each([
  ["the workspace", true],
  ["the session", false],
])(
  "the finished-goods hub keeps its header without Back while %s loads",
  (_label, authLoaded) => {
    mocks.authLoaded = authLoaded;
    renderWithIntl(<FinishedGoodsCatalogue />, {
      locale: "en",
      workspace: false,
    });
    expect(
      screen.getByRole("heading", { name: "Finished goods", level: 1 }),
    ).toBeVisible();
    expect(screen.getByTestId("panel-LOADING")).toHaveTextContent(
      "Loading finished goods…",
    );
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    // Management actions wait for permissions instead of guessing.
    expect(
      screen.queryByRole("link", { name: "Add finished good" }),
    ).toBeNull();
  },
);

it("names finished goods in Thai while the workspace loads", () => {
  renderWithIntl(<FinishedGoodsCatalogue />, {
    locale: "th",
    workspace: false,
  });
  expect(
    screen.getByRole("heading", { name: "สินค้าสำเร็จรูป", level: 1 }),
  ).toBeVisible();
  expect(screen.getByTestId("panel-LOADING")).toHaveTextContent(
    "กำลังโหลดสินค้าสำเร็จรูป…",
  );
});

it.each([
  ["the workspace", true],
  ["the session", false],
])(
  "scanned records keep their header and parent Back while %s loads",
  (_label, authLoaded) => {
    mocks.authLoaded = authLoaded;
    window.history.replaceState(
      { appNavigationIndex: 0 },
      "",
      "/en/finished-goods/scan/records",
    );
    renderWithIntl(<JobScanRecordsScreen />, {
      locale: "en",
      workspace: false,
    });
    const header = screen
      .getByRole("heading", { name: "Scanned records", level: 1 })
      .closest("header");
    expect(header).not.toBeNull();
    expect(
      within(header as HTMLElement).getByRole("button", { name: "Back" }),
    ).toBeEnabled();
    expect(screen.getByTestId("panel-LOADING")).toHaveTextContent(
      "Loading scanned records…",
    );
  },
);

it("the storage catalogue names its buildings while the workspace loads", () => {
  renderWithIntl(<StorageBuildingCatalogue />, {
    locale: "th",
    workspace: false,
  });
  expect(screen.getByTestId("panel-LOADING")).toHaveTextContent(
    "กำลังโหลดรายการอาคาร…",
  );
});
