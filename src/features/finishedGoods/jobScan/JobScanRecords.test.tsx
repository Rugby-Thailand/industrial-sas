import {
  getTestMutation,
  registerTestMutation,
} from "@tests/fixtures/convex-mutation";
import { fgRefs } from "@/lib/convex/finishedGoodsApi";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as ClerkModule from "@clerk/nextjs";
import type * as WorkspaceModule from "@/components/providers/WorkspaceProvider";
import { getFunctionName } from "convex/server";
import { axe } from "jest-axe";
import type { ComponentProps, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearCursorPositions } from "@/hooks/useCursorPagination";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import {
  finishedGoodsWorkspace,
  querySuccess,
  writeFailure,
  writeSuccess,
} from "@tests/fixtures/finished-goods-ui";
import { JobScanRecordsScreen } from "./JobScanRecords";
import { trackAppHistory } from "@/lib/browser/appHistory";
import { NavigationGuardProvider } from "@/components/navigation/NavigationGuardProvider";

const mocks = vi.hoisted(() => ({
  canManage: true,
  warehouseId: "warehouse-a",
  extraWarehouses: [] as { id: string; code: string; name: string }[],
  selectWarehouse: vi.fn(),
  paginated: false,
  denied: false,
  records: [
    {
      id: "scan-a",
      factoryOrder: "FO001",
      productBarcodeText: "PRODUCT-A",
      locationText: "Dock",
      mapped: false,
      source: "MANUAL",
      createdAt: 1000,
      version: 1,
    },
    {
      id: "scan-b",
      factoryOrder: "FO002",
      productBarcodeText: "PRODUCT-B",
      locationText: "F1-L1",
      mapped: true,
      source: "BARCODE",
      createdAt: 2000,
      version: 1,
    },
    {
      id: "scan-c",
      factoryOrder: "FO003",
      productBarcodeText: "PRODUCT-C",
      locationText: "Dock",
      mapped: false,
      source: "AI",
      createdAt: 3000,
      version: 1,
    },
  ],
  deleteScans:
    vi.fn<
      (args: { ids: string[] }) => Promise<ReturnType<typeof writeSuccess>>
    >(),
  assign: vi.fn(),
  createLocation: vi.fn(),
  resolveLocation: vi.fn(),
  extractLocation: vi.fn(),
  /** Overrides the saved-record query for search and scan tests. */
  listJobScans: null as null | ((args: Record<string, unknown>) => unknown),
  listCalls: [] as Record<string, unknown>[],
}));
const originalRecords = [...mocks.records];

vi.mock("convex/react", () => ({
  useMutation: getTestMutation,
  useConvex: () => ({
    query: mocks.resolveLocation,
    action: mocks.extractLocation,
  }),
  useQuery: (
    ref: Parameters<typeof getFunctionName>[0],
    args: { filter: string; cursor: string | null },
  ) => {
    const name = getFunctionName(ref);
    if (name.endsWith(":searchPage"))
      return querySuccess({
        items: [{ zoneId: "zone-a", code: "ZONE-A", name: "Warehouse A" }],
        page: 1,
        pages: 1,
        total: 1,
        status: "ready",
        isDone: true,
      });
    if (name.endsWith(":options"))
      return querySuccess({
        buildings: [
          { id: "building-a", code: "A", name: "Building A", floors: [] },
        ],
      });
    if (name.endsWith(":resolve"))
      return querySuccess({ ok: false, error: { code: "LOCATION_NOT_FOUND" } });
    if (mocks.denied) return { ok: false, requestId: "denied-query" };
    mocks.listCalls.push(args);
    if (mocks.listJobScans) return mocks.listJobScans(args);
    const items = mocks.records.filter(
      (record) =>
        args.filter === "ALL" || record.mapped === (args.filter === "MAPPED"),
    );
    const offset = Number(args.cursor ?? 0);
    return querySuccess({
      status: "ready",
      scanned: items.length,
      items: mocks.paginated ? items.slice(offset, offset + 1) : items,
      isDone: !mocks.paginated || offset + 1 >= items.length,
      continueCursor: String(offset + 1),
    });
  },
}));
vi.mock("@clerk/nextjs", async (importOriginal) => ({
  ...(await importOriginal<typeof ClerkModule>()),
  useAuth: () => ({ isLoaded: true, userId: "user-a" }),
}));
vi.mock("@/hooks/useCanManage", () => ({
  useCanManage: () => mocks.canManage,
}));
vi.mock("../BarcodeCameraBox", () => ({
  BarcodeCameraBox: ({
    onCode,
    onReadWithAi,
    presentation = "default",
  }: {
    onCode: (code: string) => void;
    onReadWithAi?: () => void;
    presentation?: string;
  }) => (
    <div>
      <button data-presentation={presentation} onClick={() => onCode("ZONE-A")}>
        Scan test location
      </button>
      {onReadWithAi && (
        <button type="button" onClick={() => onReadWithAi()}>
          Read barcode photo with AI
        </button>
      )}
    </div>
  ),
}));
vi.mock("@/components/providers/WorkspaceProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof WorkspaceModule>()),
  useWorkspace: () => ({
    ...finishedGoodsWorkspace,
    warehouses: [
      ...finishedGoodsWorkspace.warehouses,
      ...mocks.extraWarehouses,
    ],
    selectWarehouse: mocks.selectWarehouse,
  }),
}));
vi.mock("@/components/system/QueryGate", () => ({
  QueryGate: ({ children }: { children: (warehouseId: string) => ReactNode }) =>
    children(mocks.warehouseId),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...props }: ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
  useRouter: () => ({ back: vi.fn(), replace: vi.fn() }),
}));

beforeEach(() => {
  registerTestMutation(fgRefs.assignJobScanLocation, mocks.assign);
  registerTestMutation(fgRefs.deleteJobScans, mocks.deleteScans);
  registerTestMutation(fgRefs.createJobScanLocation, mocks.createLocation);

  vi.clearAllMocks();
  clearCursorPositions();
  mocks.canManage = true;
  mocks.warehouseId = "warehouse-a";
  mocks.extraWarehouses = [];
  mocks.selectWarehouse.mockReset();
  mocks.paginated = false;
  mocks.denied = false;
  mocks.listJobScans = null;
  mocks.listCalls = [];
  window.localStorage.clear();
  window.history.replaceState(null, "", "/en/finished-goods/scan/records");
  mocks.assign.mockResolvedValue(writeSuccess("scan-a"));
  mocks.createLocation.mockResolvedValue(writeSuccess("named-a"));
  mocks.resolveLocation.mockResolvedValue(
    querySuccess({ ok: false, error: { code: "LOCATION_NOT_FOUND" } }),
  );
  mocks.extractLocation.mockResolvedValue(
    querySuccess({
      ok: true,
      candidates: [{ code: "ZONE-A", labelText: null }],
    }),
  );
  mocks.records = [...originalRecords];
  mocks.deleteScans.mockImplementation(async ({ ids }) => {
    mocks.records = mocks.records.filter((record) => !ids.includes(record.id));
    return writeSuccess(ids[0]!);
  });
});

describe("scanned record deletion", () => {
  it("retains assignment targets and reuses the request after a lost response", async () => {
    const user = userEvent.setup();
    mocks.assign.mockRejectedValueOnce(new Error("NETWORK_ERROR"));
    renderWithIntl(<JobScanRecordsScreen />, {
      locale: "en",
      workspace: false,
    });
    await user.click(screen.getByRole("checkbox", { name: "Select FO001" }));
    await user.click(
      screen.getByRole("button", { name: "Set location for 1 record" }),
    );
    const location = screen.getByRole("button", { name: /ZONE-A/ });
    await user.click(location);
    expect(mocks.assign).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Change 1 ticket" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Retry location change" }),
      ).toBeEnabled(),
    );
    expect(
      screen.getByRole("checkbox", { name: "Select FO001", hidden: true }),
    ).toBeChecked();
    await user.click(
      screen.getByRole("button", { name: "Retry location change" }),
    );
    await waitFor(() => expect(mocks.assign).toHaveBeenCalledTimes(2));
    expect(mocks.assign.mock.calls[0]).toEqual(mocks.assign.mock.calls[1]);
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", { name: "Select FO001" }),
      ).not.toBeChecked(),
    );
  });

  it("selects and deselects every record on the current page", async () => {
    const user = userEvent.setup();
    const { container } = renderWithIntl(<JobScanRecordsScreen />, {
      locale: "en",
      workspace: false,
    });
    const selectAll = screen.getByRole("checkbox", {
      name: "Select all on this page",
    });
    await user.click(screen.getByRole("checkbox", { name: "Select FO001" }));
    expect(selectAll).toBePartiallyChecked();
    await user.click(selectAll);
    expect(selectAll).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Select FO003" }),
    ).toBeChecked();
    expect(screen.getByText("2 records selected")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await user.click(selectAll);
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", { name: "Select FO001" }),
      ).not.toBeChecked(),
    );
    expect(
      screen.queryByRole("button", { name: "Delete 2 selected records" }),
    ).not.toBeInTheDocument();
  });

  it("changes the location of only the record chosen from its actions menu", async () => {
    const user = userEvent.setup();
    renderWithIntl(<JobScanRecordsScreen />, {
      locale: "en",
      workspace: false,
    });
    await user.click(screen.getByRole("checkbox", { name: "Select FO003" }));
    const actionsTrigger = screen.getByRole("button", {
      name: "Actions for record FO001",
    });
    await user.click(actionsTrigger);
    await user.click(screen.getByRole("menuitem", { name: "Change location" }));
    const dialog = screen.getByRole("dialog", { name: "Set location" });
    expect(dialog).toHaveTextContent("FO001");
    expect(dialog).toHaveTextContent("Current · Dock");
    expect(
      within(dialog).getByRole("textbox", { name: "Search location" }),
    ).toHaveFocus();
    expect(
      screen.getByRole("checkbox", { name: "Select FO003", hidden: true }),
    ).toBeDisabled();
    expect(
      screen.getByRole("checkbox", { name: "Select FO003", hidden: true }),
    ).not.toBeChecked();
    await user.click(within(dialog).getByRole("button", { name: /ZONE-A/ }));
    expect(mocks.assign).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Change 1 ticket" }));
    await waitFor(() =>
      expect(mocks.assign).toHaveBeenCalledWith({
        warehouseId: "warehouse-a",
        requestId: expect.any(String),
        ids: ["scan-a"],
        location: { zoneId: "zone-a" },
        expectedVersions: [{ id: "scan-a", version: 1 }],
      }),
    );
  });

  it("clears selection when changing pages, returning, or changing page size", async () => {
    mocks.paginated = true;
    const user = userEvent.setup();
    renderWithIntl(<JobScanRecordsScreen />, {
      locale: "en",
      workspace: false,
    });
    await user.click(screen.getByRole("checkbox", { name: "Select FO001" }));
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(
      screen.getByRole("checkbox", { name: "Select FO003" }),
    ).not.toBeChecked();
    expect(
      screen.queryByRole("button", { name: /Delete.*selected record/ }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Previous page" }));
    const checkbox = screen.getByRole("checkbox", { name: "Select FO001" });
    expect(checkbox).not.toBeChecked();
    await user.click(checkbox);
    await user.click(
      screen.getByRole("combobox", { name: "Records per page" }),
    );
    await user.click(screen.getByRole("option", { name: "50" }));
    expect(checkbox).not.toBeChecked();
    await user.click(checkbox);
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await user.click(
      screen.getByRole("button", { name: "Delete record FO003" }),
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Delete",
      }),
    );
    await waitFor(() =>
      expect(mocks.deleteScans).toHaveBeenCalledWith({
        warehouseId: "warehouse-a",
        ids: ["scan-c"],
        requestId: expect.any(String),
      }),
    );
    expect(mocks.records.some((record) => record.id === "scan-a")).toBe(true);
  });

  it("drops a live removed record from the selected deletion targets", async () => {
    const user = userEvent.setup();
    const view = renderWithIntl(<JobScanRecordsScreen />, {
      locale: "en",
      workspace: false,
      preserveProviders: true,
    });
    await user.click(
      screen.getByRole("checkbox", { name: "Select all on this page" }),
    );
    mocks.records = mocks.records.filter((record) => record.id !== "scan-a");
    view.rerender(<JobScanRecordsScreen />);
    await user.click(
      screen.getByRole("button", { name: "Delete 1 selected record" }),
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Delete",
      }),
    );
    await waitFor(() =>
      expect(mocks.deleteScans).toHaveBeenCalledWith({
        warehouseId: "warehouse-a",
        ids: ["scan-c"],
        requestId: expect.any(String),
      }),
    );
  });

  it("locks the assignment workflow until saving completes", async () => {
    mocks.paginated = true;
    const user = userEvent.setup();
    let finish!: (outcome: ReturnType<typeof writeSuccess>) => void;
    mocks.assign.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    renderWithIntl(<JobScanRecordsScreen />, {
      locale: "en",
      workspace: false,
    });
    await user.click(screen.getByRole("checkbox", { name: "Select FO001" }));
    await user.click(
      screen.getByRole("button", {
        name: "Set location for 1 record",
      }),
    );
    const location = screen.getByRole("button", { name: /ZONE-A/ });
    await user.click(location);
    await user.click(screen.getByRole("button", { name: "Change 1 ticket" }));
    expect(location).toBeDisabled();
    for (const cancel of screen.getAllByRole("button", { name: "Cancel" }))
      expect(cancel).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "All", hidden: true }),
    ).toBeDisabled();
    // Records pager and the picker's always-visible pager are both locked.
    for (const next of document.querySelectorAll<HTMLButtonElement>(
      'button[aria-label="Next page"]',
    ))
      expect(next).toBeDisabled();
    expect(
      screen.getByRole("textbox", { name: /Search Job No/, hidden: true }),
    ).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Change 1 ticket" }));
    expect(mocks.assign).toHaveBeenCalledTimes(1);
    await user.keyboard("{Escape}");
    expect(
      screen.getByRole("dialog", {
        name: "Review location change for 1 ticket",
      }),
    ).toBeInTheDocument();
    finish(writeSuccess("scan-a"));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Set location" }),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", { name: "Select FO001" }),
      ).not.toBeChecked(),
    );
  });

  it("shows a denied query instead of loading indefinitely", () => {
    mocks.denied = true;
    renderWithIntl(<JobScanRecordsScreen />, {
      locale: "en",
      workspace: false,
    });
    expect(screen.getByRole("alert")).toHaveTextContent("denied-query");
    expect(screen.queryByTestId("panel-LOADING")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("does not assign a QR lookup that finishes after cancelling its picker", async () => {
    const user = userEvent.setup();
    const location = querySuccess({
      ok: true,
      location: { zoneId: "zone-a", code: "ZONE-A", name: "Warehouse A" },
    });
    let finish!: (result: typeof location) => void;
    mocks.resolveLocation.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    renderWithIntl(<JobScanRecordsScreen />, {
      locale: "en",
      workspace: false,
    });
    await user.click(screen.getByRole("checkbox", { name: "Select FO001" }));
    await user.click(
      screen.getByRole("button", { name: "Set location for 1 record" }),
    );
    await user.click(screen.getByRole("button", { name: "Scan code" }));
    expect(
      screen.getByRole("button", { name: "Scan test location" }),
    ).toHaveAttribute("data-presentation", "fullscreen");
    await user.click(
      screen.getByRole("button", { name: "Scan test location" }),
    );
    expect(mocks.resolveLocation).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Close camera" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    finish(location);
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Set location" }),
      ).not.toBeInTheDocument(),
    );
    expect(mocks.assign).not.toHaveBeenCalled();
    expect(
      screen.getByRole("checkbox", { name: "Select FO001" }),
    ).toBeChecked();
  });

  it("confirms individual deletion and lets the user cancel without deleting", async () => {
    const user = userEvent.setup();
    renderWithIntl(<JobScanRecordsScreen />, {
      locale: "en",
      workspace: false,
    });
    const trigger = screen.getByRole("button", { name: "Delete record FO001" });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", {
      name: "Delete 1 scanned record?",
    });
    expect(mocks.deleteScans).not.toHaveBeenCalled();
    expect(await axe(dialog)).toHaveNoViolations();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(mocks.deleteScans).not.toHaveBeenCalled();
    await waitFor(() => expect(trigger).toHaveFocus());

    await user.click(trigger);
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Delete",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByText("FO001")).not.toBeInTheDocument(),
    );
    expect(mocks.deleteScans).toHaveBeenCalledWith({
      warehouseId: "warehouse-a",
      ids: ["scan-a"],
      requestId: expect.any(String),
    });
    expect(screen.getByText("FO003")).toBeInTheDocument();
  });

  it("deletes selected mapped and unmapped records and clears the action bar", async () => {
    const user = userEvent.setup();
    renderWithIntl(<JobScanRecordsScreen />, {
      locale: "en",
      workspace: false,
    });
    await user.click(screen.getByRole("button", { name: "All" }));
    await user.click(screen.getByRole("checkbox", { name: "Select FO001" }));
    await user.click(screen.getByRole("checkbox", { name: "Select FO002" }));
    await user.click(
      screen.getByRole("button", { name: "Delete 2 selected records" }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Delete 2 scanned records?",
    });
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(mocks.deleteScans).toHaveBeenCalledWith({
      warehouseId: "warehouse-a",
      ids: ["scan-a", "scan-b"],
      requestId: expect.any(String),
    });
    expect(screen.queryByText("FO001")).not.toBeInTheDocument();
    expect(screen.queryByText("FO002")).not.toBeInTheDocument();
    expect(screen.getByText("FO003")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /selected record/ }),
    ).not.toBeInTheDocument();
    expect(mocks.assign).not.toHaveBeenCalled();
  });

  it("keeps the selection and confirmation after failure, reusing the request on retry", async () => {
    const user = userEvent.setup();
    mocks.deleteScans.mockResolvedValueOnce(writeFailure("NOT_FOUND"));
    renderWithIntl(<JobScanRecordsScreen />, {
      locale: "en",
      workspace: false,
    });
    await user.click(screen.getByRole("checkbox", { name: "Select FO001" }));
    await user.click(
      screen.getByRole("button", { name: "Delete 1 selected record" }),
    );
    const dialog = screen.getByRole("dialog");
    const confirm = within(dialog).getByRole("button", {
      name: "Delete",
    });
    await user.click(confirm);
    expect(await within(dialog).findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("FO001")).toBeInTheDocument();
    expect(screen.getByLabelText("Select FO001")).toBeChecked();
    await user.click(confirm);
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(mocks.deleteScans.mock.calls[0]).toEqual(
      mocks.deleteScans.mock.calls[1],
    );
  });

  it("prevents repeated confirmation and dismissal while deletion is pending", async () => {
    const user = userEvent.setup();
    let finish!: (outcome: ReturnType<typeof writeSuccess>) => void;
    mocks.deleteScans.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    renderWithIntl(<JobScanRecordsScreen />, {
      locale: "en",
      workspace: false,
    });
    await user.click(
      screen.getByRole("button", { name: "Delete record FO001" }),
    );
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(
      within(dialog).getByRole("button", { name: "Deleting…" }),
    ).toBeDisabled();
    expect(
      within(dialog).getByRole("button", { name: "Cancel" }),
    ).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(dialog).toBeInTheDocument();
    expect(mocks.deleteScans).toHaveBeenCalledTimes(1);
    finish(writeSuccess("scan-a"));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
  });

  it("shows Thai deletion labels and hides write controls for viewers", () => {
    const view = renderWithIntl(<JobScanRecordsScreen />, {
      locale: "th",
      workspace: false,
    });
    expect(
      screen.getByRole("button", { name: "ลบรายการ FO001" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "ระบุตำแหน่ง FO001" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("ไม่ระบุ")).toHaveLength(2);
    expect(screen.queryByText("ระบุ")).not.toBeInTheDocument();
    view.unmount();
    mocks.canManage = false;
    renderWithIntl(<JobScanRecordsScreen />, {
      locale: "th",
      workspace: false,
    });
    expect(
      screen.queryByRole("button", { name: /ลบรายการ/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: /^(?:ระบุตำแหน่ง|เปลี่ยนตำแหน่ง) /,
      }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});

describe("saved record search and paging", () => {
  const record = (id: string, factoryOrder: string) => ({
    ...originalRecords[0]!,
    id,
    factoryOrder,
  });

  it("shows rows found so far while a bounded search continues, then settles", async () => {
    const user = userEvent.setup();
    const pending = new Set<string>();
    mocks.listJobScans = (args) => {
      if (!args["search"])
        return querySuccess({
          status: "ready",
          items: [record("scan-a", "FO001")],
          isDone: true,
          continueCursor: "",
          scanned: 1,
        });
      if (!args["scanCursor"])
        return querySuccess({
          status: "scanning",
          items: [record("scan-x", "TRAY-1")],
          isDone: false,
          continueCursor: "",
          scanCursor: "scan-1",
          scanned: 100,
        });
      // The continuation is in flight until the test releases it.
      if (pending.has("hold")) return undefined;
      return querySuccess({
        status: "ready",
        items: [record("scan-x", "TRAY-1"), record("scan-y", "TRAY-2")],
        isDone: false,
        continueCursor: "page-2",
        scanned: 140,
      });
    };
    pending.add("hold");
    const view = renderWithIntl(<JobScanRecordsScreen />, {
      locale: "en",
      workspace: false,
      preserveProviders: true,
    });
    await user.type(
      screen.getByRole("textbox", { name: /Search Job No/, hidden: true }),
      "tray",
    );
    // No request for partial keystrokes; feedback starts immediately.
    expect(screen.getByRole("status")).toHaveTextContent(
      "Searching saved records…",
    );
    expect(mocks.listCalls.some((args) => args["search"] === "tr")).toBe(false);
    expect(await screen.findByText("TRAY-1")).toBeInTheDocument();
    expect(
      screen.getByText(/^Searching… 100 records checked so far/),
    ).toHaveTextContent("Actions are available once this page is up to date.");
    // Retained rows are read-only while their continuation is unresolved.
    expect(
      screen.getByRole("checkbox", { name: "Select TRAY-1" }),
    ).toBeDisabled();
    expect(screen.getByRole("list")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText("No records match “tray”.")).toBeNull();
    // Current clients opt into progressive scanning of one logical page.
    expect(mocks.listCalls.at(-1)).toMatchObject({
      search: "tray",
      scanCursor: "scan-1",
      cursor: null,
      progressive: true,
    });
    // A pager cannot advance from an unfinished page.
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    pending.clear();
    view.rerender(<JobScanRecordsScreen />);
    expect(await screen.findByText("TRAY-2")).toBeInTheDocument();
    expect(screen.queryByText(/checked so far/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Next page" }));
    // The new page starts fresh: an earlier page's continuation is not reused.
    const nextPage = mocks.listCalls.find(
      (args) => args["cursor"] === "page-2",
    );
    expect(nextPage).toMatchObject({ search: "tray" });
    expect(nextPage).not.toHaveProperty("scanCursor");
  });

  it("separates a settled no-match result from an unfinished search", async () => {
    const user = userEvent.setup();
    mocks.listJobScans = (args) =>
      querySuccess({
        status: "ready",
        items: args["search"] ? [] : [record("scan-a", "FO001")],
        isDone: true,
        continueCursor: "",
        scanned: 1000,
      });
    renderWithIntl(<JobScanRecordsScreen />, {
      locale: "en",
      workspace: false,
    });
    await user.type(
      screen.getByRole("textbox", { name: /Search Job No/, hidden: true }),
      "zzz",
    );
    expect(
      await screen.findByText("No records match “zzz”."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(await screen.findByText("FO001")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /Search Job No/ })).toHaveValue(
      "",
    );
  });

  it("restores status and search from the URL after Back or refresh", async () => {
    const user = userEvent.setup();
    const view = renderWithIntl(<JobScanRecordsScreen />, {
      locale: "en",
      workspace: false,
    });
    await user.click(screen.getByRole("button", { name: "All" }));
    await user.type(
      screen.getByRole("textbox", { name: /Search Job No/, hidden: true }),
      "FO00",
    );
    await waitFor(() =>
      expect(new URLSearchParams(window.location.search).get("scans")).toBe(
        JSON.stringify({ filter: "ALL", search: "FO00" }),
      ),
    );
    view.unmount();
    renderWithIntl(<JobScanRecordsScreen />, {
      locale: "en",
      workspace: false,
    });
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("textbox", { name: /Search Job No/ })).toHaveValue(
      "FO00",
    );
    await waitFor(() =>
      expect(mocks.listCalls.at(-1)).toMatchObject({
        filter: "ALL",
        search: "FO00",
      }),
    );
  });

  it("retries a refused first page with a new subscription identity", async () => {
    const user = userEvent.setup();
    // Answers depend on arguments only, as a Convex subscription does.
    mocks.listJobScans = (args) =>
      args["attempt"] === 1
        ? querySuccess({
            status: "ready",
            items: [record("scan-a", "FO001")],
            isDone: true,
            continueCursor: "",
            scanned: 1,
          })
        : querySuccess({
            status: "reset",
            items: [],
            isDone: true,
            continueCursor: "",
            scanned: 0,
          });
    renderWithIntl(<JobScanRecordsScreen />, {
      locale: "th",
      workspace: false,
    });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("โหลดรายการไม่สำเร็จ");
    const distinct = () =>
      new Set(mocks.listCalls.map((args) => JSON.stringify(args)));
    expect(distinct().size).toBe(1);
    await user.click(screen.getByRole("button", { name: "ลองอีกครั้ง" }));
    expect(distinct().size).toBe(2);
    expect(mocks.listCalls.at(-1)).toMatchObject({
      cursor: null,
      attempt: 1,
    });
    expect(await screen.findByText("FO001")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("retained rows and scan recovery", () => {
  const row = { ...originalRecords[0]! };
  const scanning = (scanCursor: string | undefined, scanned = 100) =>
    querySuccess({
      status: "scanning",
      items: [row],
      isDone: false,
      continueCursor: "",
      ...(scanCursor === undefined ? {} : { scanCursor }),
      scanned,
    });
  const ready = querySuccess({
    status: "ready",
    items: [row],
    isDone: true,
    continueCursor: "",
    scanned: 1,
  });
  const render = () =>
    renderWithIntl(<JobScanRecordsScreen />, {
      locale: "en",
      workspace: false,
      preserveProviders: true,
    });

  it("keeps retained rows readable but blocks every action while the continuation is pending", async () => {
    const user = userEvent.setup();
    // The audit's probe: the continuation answer never arrives.
    mocks.listJobScans = (args) =>
      args["scanCursor"] ? undefined : scanning("scan-in-flight");
    render();
    await waitFor(() =>
      expect(mocks.listCalls.at(-1)).toMatchObject({
        scanCursor: "scan-in-flight",
      }),
    );
    expect(screen.getByText("FO001")).toBeInTheDocument();
    expect(screen.getByRole("list")).toHaveAttribute("aria-busy", "true");
    const checkbox = screen.getByRole("checkbox", { name: "Select FO001" });
    expect(checkbox).toBeDisabled();
    expect(
      screen.getByRole("checkbox", { name: "Select all on this page" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Delete record FO001" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Actions for record FO001" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Set location for FO001" }),
    ).toBeDisabled();
    await user.click(checkbox);
    expect(checkbox).not.toBeChecked();
    expect(
      screen.queryByRole("button", { name: /selected record/ }),
    ).toBeNull();
    expect(mocks.deleteScans).not.toHaveBeenCalled();
  });

  it("holds an open deletion confirmation while its rows are being updated", async () => {
    const user = userEvent.setup();
    let phase: "ready" | "updating" = "ready";
    mocks.listJobScans = (args) =>
      phase === "ready"
        ? ready
        : args["scanCursor"]
          ? undefined
          : scanning("scan-next");
    const view = render();
    await user.click(screen.getByRole("checkbox", { name: "Select FO001" }));
    await user.click(
      screen.getByRole("button", { name: "Delete 1 selected record" }),
    );
    const dialog = screen.getByRole("dialog");
    // A live update makes this page continue scanning behind the dialog.
    phase = "updating";
    view.rerender(<JobScanRecordsScreen />);
    await waitFor(() =>
      expect(mocks.listCalls.at(-1)).toMatchObject({ scanCursor: "scan-next" }),
    );
    const confirm = within(dialog).getByRole("button", { name: "Delete" });
    expect(confirm).toBeDisabled();
    expect(dialog).toHaveTextContent(
      "Actions are available once this page is up to date.",
    );
    await user.click(confirm);
    expect(mocks.deleteScans).not.toHaveBeenCalled();
    // Cancelling is still possible.
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("dismisses deletion when a live result removes its target from the page", async () => {
    const user = userEvent.setup();
    const view = render();
    await user.click(
      screen.getByRole("button", { name: "Delete record FO001" }),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // The record now fails this page's filter; another fresh result arrives.
    mocks.records = originalRecords.filter((record) => record.id !== "scan-a");
    view.rerender(<JobScanRecordsScreen />);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByText("FO001")).toBeNull();
    expect(screen.getByText("FO003")).toBeInTheDocument();
    expect(mocks.deleteScans).not.toHaveBeenCalled();
  });

  it("holds an open location assignment while its rows are being updated", async () => {
    const user = userEvent.setup();
    let phase: "ready" | "updating" = "ready";
    mocks.listJobScans = (args) =>
      phase === "ready"
        ? ready
        : args["scanCursor"]
          ? undefined
          : scanning("scan-next");
    const view = render();
    await user.click(screen.getByRole("checkbox", { name: "Select FO001" }));
    await user.click(
      screen.getByRole("button", { name: "Set location for 1 record" }),
    );
    const location = screen.getByRole("button", { name: /ZONE-A/ });
    phase = "updating";
    view.rerender(<JobScanRecordsScreen />);
    await waitFor(() => expect(location).toBeDisabled());
    await user.click(location);
    expect(mocks.assign).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });

  it.each([
    [
      "repeats the cursor it was sent",
      (cursor: unknown) => scanning(String(cursor)),
    ],
    ["omits its continuation cursor", () => scanning(undefined)],
  ])(
    "stops automatic continuation when a scanning answer %s",
    async (_label, answer) => {
      const user = userEvent.setup();
      mocks.listJobScans = (args) =>
        args["attempt"] === 1
          ? ready
          : args["scanCursor"]
            ? answer(args["scanCursor"])
            : scanning("scan-1");
      render();
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("The search stopped making progress.");
      const distinct = new Set(
        mocks.listCalls.map((args) => JSON.stringify(args)),
      );
      expect(distinct.size).toBeLessThanOrEqual(2);
      // The fresh partial rows of the stalled answer stay actionable.
      expect(screen.getByText("FO001")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Try again" }));
      expect(mocks.listCalls.at(-1)).toMatchObject({ attempt: 1 });
      await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    },
  );

  it("pauses a long search after its automatic budget and resumes on request", async () => {
    const user = userEvent.setup();
    mocks.listJobScans = (args) => {
      const step = Number(String(args["scanCursor"] ?? "scan-0").slice(5));
      return scanning(`scan-${step + 1}`, (step + 1) * 100);
    };
    render();
    expect(
      await screen.findByText(
        "Still searching: 5,100 records checked for this page.",
      ),
    ).toBeInTheDocument();
    const requested = () =>
      new Set(mocks.listCalls.map((args) => args["scanCursor"])).size;
    expect(requested()).toBe(51);
    await user.click(screen.getByRole("button", { name: "Keep searching" }));
    await screen.findByText(
      "Still searching: 10,100 records checked for this page.",
    );
    expect(requested()).toBe(101);
  });
});

it("renders a saved provider URL in the record thumbnail and full photo dialog", async () => {
  const user = userEvent.setup();
  const imageUrl = "https://example.ufs.sh/f/saved-ticket.jpg";
  mocks.listJobScans = () =>
    querySuccess({
      status: "ready",
      scanned: 1,
      items: [{ ...originalRecords[0], imageUrl }],
      isDone: true,
      continueCursor: null,
    });
  const { container } = renderWithIntl(<JobScanRecordsScreen />, {
    locale: "en",
    workspace: false,
  });
  const trigger = await screen.findByRole("button", { name: "Open photo" });
  expect(container.querySelector("img")).toHaveAttribute("src", imageUrl);
  await user.click(trigger);
  expect(
    within(screen.getByRole("dialog", { name: "Open photo" })).getByRole(
      "img",
      { name: "Open photo" },
    ),
  ).toHaveAttribute("src", imageUrl);
});

it("native Back closes Location assignment and retains the selected records", async () => {
  window.history.replaceState(
    { appNavigationIndex: 0 },
    "",
    "/th/finished-goods/scan?origin=kept#scanner",
  );
  const stop = trackAppHistory();
  window.history.pushState(
    {},
    "",
    "/en/finished-goods/scan/records?filter=keep#rows",
  );
  const user = userEvent.setup();
  const view = renderWithIntl(<JobScanRecordsScreen />, {
    locale: "en",
    workspace: false,
  });
  try {
    await user.click(screen.getByRole("checkbox", { name: "Select FO001" }));
    await user.click(
      screen.getByRole("button", { name: "Set location for 1 record" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Set location" }),
    ).toBeInTheDocument();
    act(() => window.history.back());
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Set location" })).toBeNull(),
    );
    expect(
      screen.getByRole("checkbox", { name: "Select FO001" }),
    ).toBeChecked();
    expect(window.location.search + window.location.hash).toBe(
      "?filter=keep#rows",
    );
    act(() => window.history.back());
    await waitFor(() =>
      expect(
        window.location.pathname +
          window.location.search +
          window.location.hash,
      ).toBe("/th/finished-goods/scan?origin=kept#scanner"),
    );
  } finally {
    view.unmount();
    stop();
  }
});

it.each(["Cancel", "Close", "Escape"])(
  "explicit location %s retires the picker before Forward and the next Back",
  async (dismissal) => {
    window.history.replaceState(
      { appNavigationIndex: 0 },
      "",
      "/th/finished-goods/scan?origin=kept#scanner",
    );
    const stop = trackAppHistory();
    window.history.pushState(
      {},
      "",
      "/en/finished-goods/scan/records?filter=keep#rows",
    );
    const user = userEvent.setup();
    const view = renderWithIntl(<JobScanRecordsScreen />, {
      locale: "en",
      workspace: false,
    });
    try {
      await user.click(screen.getByRole("checkbox", { name: "Select FO001" }));
      const bulkButton = screen.getByRole("button", {
        name: "Set location for 1 record",
      });
      await user.click(bulkButton);
      const dialog = screen.getByRole("dialog", { name: "Set location" });
      expect(await axe(dialog)).toHaveNoViolations();
      if (dismissal === "Escape") await user.keyboard("{Escape}");
      else
        await user.click(
          within(dialog).getByRole("button", { name: dismissal }),
        );
      await waitFor(() =>
        expect(
          screen.queryByRole("dialog", { name: "Set location" }),
        ).toBeNull(),
      );
      await waitFor(() =>
        expect(window.location.search + window.location.hash).toBe(
          "?filter=keep#rows",
        ),
      );
      await waitFor(() => expect(bulkButton).toHaveFocus());
      expect(mocks.assign).not.toHaveBeenCalled();
      expect(
        screen.getByRole("checkbox", { name: "Select FO001" }),
      ).toBeChecked();
      await act(async () => {
        const visited = new Promise<void>((resolve) =>
          window.addEventListener("popstate", () => resolve(), { once: true }),
        );
        window.history.forward();
        await visited;
      });
      await waitFor(() =>
        expect(window.location.search + window.location.hash).toBe(
          "?filter=keep#rows",
        ),
      );
      expect(screen.queryByRole("dialog", { name: "Set location" })).toBeNull();
      act(() => window.history.back());
      await waitFor(() =>
        expect(
          window.location.pathname +
            window.location.search +
            window.location.hash,
        ).toBe("/th/finished-goods/scan?origin=kept#scanner"),
      );
    } finally {
      view.unmount();
      stop();
    }
  },
);

it("shows the verified destination details before confirming a location change", async () => {
  mocks.resolveLocation.mockResolvedValueOnce(
    querySuccess({
      ok: true,
      location: {
        locationId: "named-a",
        code: "DOCK NORTH",
        name: "Receiving bay",
        buildingId: "building-a",
        buildingName: "Building A",
        floorId: "floor-a",
        floorNumber: 0,
        layoutPending: true,
      },
    }),
  );
  const user = userEvent.setup();
  renderWithIntl(<JobScanRecordsScreen />, { locale: "en", workspace: false });
  await user.click(
    screen.getByRole("button", { name: "Set location for FO001" }),
  );
  const picker = within(screen.getByRole("dialog", { name: "Set location" }));
  await user.click(picker.getByRole("button", { name: "Scan code" }));
  const camera = within(
    await screen.findByRole("dialog", { name: "Scan code" }),
  );
  await user.click(camera.getByRole("button", { name: "Scan test location" }));
  const review = await screen.findByRole("dialog", {
    name: "Review location change for 1 ticket",
  });
  expect(review).toHaveTextContent("Dock → DOCK NORTH");
  expect(review).toHaveAccessibleDescription(
    expect.stringContaining(
      "Building A · Floor 0 · Receiving bay · Location recorded · Layout pending",
    ),
  );
  expect(mocks.assign).not.toHaveBeenCalled();
});

it("requires review and blocks a stale multi-ticket location snapshot without writing", async () => {
  const user = userEvent.setup();
  const view = renderWithIntl(<JobScanRecordsScreen />, {
    locale: "en",
    workspace: false,
    preserveProviders: true,
  });
  await user.click(
    screen.getByRole("checkbox", { name: "Select all on this page" }),
  );
  await user.click(
    screen.getByRole("button", { name: "Set location for 2 records" }),
  );
  const picker = screen.getByRole("dialog", {
    name: "Set location for selected",
  });
  expect(picker).toHaveTextContent("2 records selected");
  await user.click(within(picker).getByRole("button", { name: /ZONE-A/ }));
  expect(mocks.assign).not.toHaveBeenCalled();
  expect(
    screen.getByRole("dialog", {
      name: "Review location change for 2 tickets",
    }),
  ).toHaveTextContent("Dock → ZONE-A");
  mocks.records = mocks.records.map((record) =>
    record.id === "scan-a" ? { ...record, version: 2 } : record,
  );
  view.rerender(<JobScanRecordsScreen />);
  expect(
    screen.getByRole("button", { name: "Change 2 tickets" }),
  ).toBeDisabled();
  expect(mocks.assign).not.toHaveBeenCalled();
});

it("successful location remap consumes review and picker before the next native Back", async () => {
  window.history.replaceState(
    { appNavigationIndex: 0 },
    "",
    "/en/finished-goods/scan?origin=kept#scanner",
  );
  const stop = trackAppHistory();
  window.history.pushState(
    {},
    "",
    "/en/finished-goods/scan/records?filter=keep#rows",
  );
  const user = userEvent.setup();
  const view = renderWithIntl(<JobScanRecordsScreen />, {
    locale: "en",
    workspace: false,
  });
  try {
    await user.click(screen.getByRole("checkbox", { name: "Select FO001" }));
    await user.click(
      screen.getByRole("button", { name: "Set location for 1 record" }),
    );
    await user.click(screen.getByRole("button", { name: /ZONE-A/ }));
    await user.click(screen.getByRole("button", { name: "Change 1 ticket" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: /Review location change/ }),
      ).toBeNull(),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Set location" })).toBeNull(),
    );
    await waitFor(() => expect(window.location.search).toBe("?filter=keep"));
    expect(window.location.hash).toBe("#rows");
    act(() => window.history.back());
    await waitFor(() =>
      expect(window.location.pathname).toBe("/en/finished-goods/scan"),
    );
    expect(window.location.search + window.location.hash).toBe(
      "?origin=kept#scanner",
    );
  } finally {
    view.unmount();
    stop();
  }
});

it("successful deletion consumes confirmation before the next native Back without a stale pending prompt", async () => {
  window.history.replaceState(
    { appNavigationIndex: 0 },
    "",
    "/en/finished-goods/scan?origin=kept#scanner",
  );
  const stop = trackAppHistory();
  window.history.pushState(
    {},
    "",
    "/en/finished-goods/scan/records?filter=keep#rows",
  );
  const user = userEvent.setup();
  let finish!: (value: ReturnType<typeof writeSuccess>) => void;
  mocks.deleteScans.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = renderWithIntl(
    <NavigationGuardProvider>
      <JobScanRecordsScreen />
    </NavigationGuardProvider>,
    { locale: "en", workspace: false },
  );
  try {
    await user.click(screen.getByRole("checkbox", { name: "Select FO001" }));
    await user.click(
      screen.getByRole("button", { name: "Delete 1 selected record" }),
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Delete",
      }),
    );
    await waitFor(() => expect(mocks.deleteScans).toHaveBeenCalledOnce());
    await act(async () => {
      mocks.records = mocks.records.filter((record) => record.id !== "scan-a");
      finish(writeSuccess("scan-a"));
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() =>
      expect(window.location.search + window.location.hash).toBe(
        "?filter=keep#rows",
      ),
    );
    act(() => window.history.back());
    await waitFor(() =>
      expect(
        window.location.pathname +
          window.location.search +
          window.location.hash,
      ).toBe("/en/finished-goods/scan?origin=kept#scanner"),
    );
  } finally {
    view.unmount();
    stop();
  }
});

it("retries the immutable reviewed location command after response loss and advanced record versions", async () => {
  const user = userEvent.setup();
  mocks.assign.mockRejectedValueOnce(
    new Error("Response lost after location changes committed"),
  );
  const view = renderWithIntl(<JobScanRecordsScreen />, {
    locale: "en",
    workspace: false,
    preserveProviders: true,
  });
  await user.click(
    screen.getByRole("checkbox", { name: "Select all on this page" }),
  );
  await user.click(
    screen.getByRole("button", { name: "Set location for 2 records" }),
  );
  await user.click(screen.getByRole("button", { name: /ZONE-A/ }));
  await user.click(screen.getByRole("button", { name: "Change 2 tickets" }));
  await waitFor(() => expect(mocks.assign).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Retry location change" }),
    ).toBeEnabled(),
  );
  const original = mocks.assign.mock.calls[0]![0];
  mocks.records = mocks.records.map((record) => ({
    ...record,
    version: record.version + 1,
  }));
  view.rerender(<JobScanRecordsScreen />);
  await user.click(
    screen.getByRole("button", { name: "Retry location change" }),
  );
  await waitFor(() => expect(mocks.assign).toHaveBeenCalledTimes(2));
  expect(mocks.assign.mock.calls[1]![0]).toEqual(original);
  expect(original.expectedVersions).toEqual([
    { id: "scan-a", version: 1 },
    { id: "scan-c", version: 1 },
  ]);
  // The successful retry also completes two asynchronous native traversals.
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: /Set location/ })).toBeNull(),
  );
  await waitFor(() =>
    expect(
      [...new URLSearchParams(window.location.search).keys()].some((key) =>
        key.startsWith("overlay"),
      ),
    ).toBe(false),
  );
});

it("opens the location Dialog from a row pencil button, shows Thai/English context, and restores focus on Cancel", async () => {
  const user = userEvent.setup();
  const view = renderWithIntl(<JobScanRecordsScreen />, {
    locale: "en",
    workspace: false,
  });
  await user.click(screen.getByRole("button", { name: "All" }));
  const pencil = screen.getByRole("button", {
    name: "Change location for FO002",
  });
  await user.click(pencil);
  const dialog = screen.getByRole("dialog", { name: "Change location" });
  expect(dialog).toHaveTextContent("FO002");
  expect(dialog).toHaveTextContent("Current · F1-L1");
  expect(
    within(dialog).getByRole("textbox", { name: "Search location" }),
  ).toHaveFocus();
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(dialog).not.toBeInTheDocument());
  await waitFor(() => expect(pencil).toHaveFocus());

  // Closing via the actions menu restores focus to the menu trigger.
  const actionsTrigger = screen.getByRole("button", {
    name: "Actions for record FO001",
  });
  await user.click(actionsTrigger);
  await user.click(screen.getByRole("menuitem", { name: "Change location" }));
  const setDialog = screen.getByRole("dialog", { name: "Set location" });
  await user.click(within(setDialog).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(setDialog).not.toBeInTheDocument());
  await waitFor(() => expect(actionsTrigger).toHaveFocus());
  view.unmount();

  renderWithIntl(<JobScanRecordsScreen />, {
    locale: "th",
    workspace: false,
  });
  await user.click(screen.getByRole("button", { name: "ระบุตำแหน่ง FO001" }));
  const thDialog = screen.getByRole("dialog", { name: "ระบุตำแหน่ง" });
  expect(thDialog).toHaveTextContent("FO001");
  expect(thDialog).toHaveTextContent("ปัจจุบัน · Dock");
});

it("native Forward reopens Location assignment without duplicate entries after Back", async () => {
  window.history.replaceState(
    { appNavigationIndex: 0 },
    "",
    "/en/finished-goods/scan?origin=kept#scanner",
  );
  const stop = trackAppHistory();
  window.history.pushState(
    {},
    "",
    "/en/finished-goods/scan/records?filter=keep#rows",
  );
  const user = userEvent.setup();
  const view = renderWithIntl(<JobScanRecordsScreen />, {
    locale: "en",
    workspace: false,
  });
  try {
    await user.click(screen.getByRole("checkbox", { name: "Select FO001" }));
    await user.click(
      screen.getByRole("button", { name: "Set location for 1 record" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("dialog", { name: "Set location" }),
      ).toBeVisible(),
    );
    const openSearch = window.location.search;
    const openLength = window.history.length;
    act(() => window.history.back());
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Set location" })).toBeNull(),
    );
    act(() => window.history.forward());
    await waitFor(() =>
      expect(
        screen.getByRole("dialog", { name: "Set location" }),
      ).toBeVisible(),
    );
    expect(window.location.search).toBe(openSearch);
    expect(window.history.length).toBe(openLength);
  } finally {
    view.unmount();
    stop();
  }
});

it("restores location review on Forward and keeps Back ordered through the picker", async () => {
  window.history.replaceState(
    { appNavigationIndex: 0 },
    "",
    "/en/finished-goods/scan?origin=kept#scanner",
  );
  const stop = trackAppHistory();
  window.history.pushState(
    {},
    "",
    "/en/finished-goods/scan/records?filter=keep#rows",
  );
  const user = userEvent.setup();
  const view = renderWithIntl(<JobScanRecordsScreen />, {
    locale: "en",
    workspace: false,
  });
  try {
    await user.click(
      screen.getByRole("button", { name: "Set location for FO001" }),
    );
    const picker = screen.getByRole("dialog", { name: "Set location" });
    await user.click(within(picker).getByRole("button", { name: /ZONE-A/ }));
    const review = screen.getByRole("dialog", {
      name: "Review location change for 1 ticket",
    });
    expect(review).toHaveTextContent("Dock → ZONE-A");
    const reviewSearch = window.location.search;
    const historyLength = window.history.length;
    act(() => window.history.back());
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", {
          name: "Review location change for 1 ticket",
        }),
      ).toBeNull(),
    );
    expect(screen.getByRole("dialog", { name: "Set location" })).toBeVisible();
    act(() => window.history.forward());
    expect(
      await screen.findByRole("dialog", {
        name: "Review location change for 1 ticket",
      }),
    ).toHaveTextContent("Dock → ZONE-A");
    expect(window.location.search).toBe(reviewSearch);
    expect(window.history.length).toBe(historyLength);
    act(() => window.history.back());
    await waitFor(() =>
      expect(
        screen.getByRole("dialog", { name: "Set location" }),
      ).toBeVisible(),
    );
    act(() => window.history.back());
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Set location" })).toBeNull(),
    );
    act(() => window.history.back());
    await waitFor(() =>
      expect(
        window.location.pathname +
          window.location.search +
          window.location.hash,
      ).toBe("/en/finished-goods/scan?origin=kept#scanner"),
    );
  } finally {
    view.unmount();
    stop();
  }
});

it.each(["Cancel", "Close", "Escape"])(
  "explicit %s retires location review before Forward and the next Back",
  async (dismiss) => {
    window.history.replaceState(
      { appNavigationIndex: 0 },
      "",
      "/en/finished-goods/scan?origin=kept#scanner",
    );
    const stop = trackAppHistory();
    window.history.pushState(
      {},
      "",
      "/en/finished-goods/scan/records?filter=keep#rows",
    );
    const user = userEvent.setup();
    const view = renderWithIntl(<JobScanRecordsScreen />, {
      locale: "en",
      workspace: false,
    });
    try {
      await user.click(
        screen.getByRole("button", { name: "Set location for FO001" }),
      );
      const picker = screen.getByRole("dialog", { name: "Set location" });
      const pickerSearch = window.location.search;
      await user.click(within(picker).getByRole("button", { name: /ZONE-A/ }));
      const review = within(
        screen.getByRole("dialog", {
          name: "Review location change for 1 ticket",
        }),
      );
      if (dismiss === "Escape") await user.keyboard("{Escape}");
      else await user.click(review.getByRole("button", { name: dismiss }));
      await waitFor(() => expect(window.location.search).toBe(pickerSearch));
      await act(async () => {
        const visited = new Promise<void>((resolve) =>
          window.addEventListener("popstate", () => resolve(), { once: true }),
        );
        window.history.forward();
        await visited;
      });
      await waitFor(() => expect(window.location.search).toBe(pickerSearch));
      expect(
        screen.getByRole("dialog", { name: "Set location" }),
      ).toBeVisible();
      expect(mocks.assign).not.toHaveBeenCalled();
      act(() => window.history.back());
      await waitFor(() =>
        expect(
          screen.queryByRole("dialog", { name: "Set location" }),
        ).toBeNull(),
      );
      act(() => window.history.back());
      await waitFor(() =>
        expect(
          window.location.pathname +
            window.location.search +
            window.location.hash,
        ).toBe("/en/finished-goods/scan?origin=kept#scanner"),
      );
    } finally {
      view.unmount();
      stop();
    }
  },
);

it("nested QR and Photo AI Back flows dismiss in order inside the location picker Dialog", async () => {
  window.history.replaceState(
    { appNavigationIndex: 0 },
    "",
    "/en/finished-goods/scan?origin=kept#scanner",
  );
  const stop = trackAppHistory();
  window.history.pushState(
    {},
    "",
    "/en/finished-goods/scan/records?filter=keep#rows",
  );
  const user = userEvent.setup();
  const view = renderWithIntl(<JobScanRecordsScreen />, {
    locale: "en",
    workspace: false,
  });
  try {
    await user.click(
      screen.getByRole("button", { name: "Set location for FO001" }),
    );
    const picker = screen.getByRole("dialog", { name: "Set location" });
    await user.click(within(picker).getByRole("button", { name: "Scan code" }));
    const camera = await screen.findByRole("dialog", { name: "Scan code" });
    expect(camera).toHaveAttribute("data-camera-dialog", "true");
    await user.click(
      within(camera).getByRole("button", {
        name: "Read barcode photo with AI",
      }),
    );
    const ai = await screen.findByRole("dialog", {
      name: "Read a location label",
    });
    expect(ai).toHaveAttribute("data-camera-dialog", "true");
    act(() => window.history.back());
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Read a location label" }),
      ).toBeNull(),
    );
    expect(
      within(screen.getByRole("dialog", { name: "Scan code" })).getByRole(
        "button",
        { name: "Scan test location" },
      ),
    ).toBeVisible();
    act(() => window.history.back());
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Scan code" })).toBeNull(),
    );
    expect(picker).toBeVisible();
    act(() => window.history.back());
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Set location" })).toBeNull(),
    );
    act(() => window.history.back());
    await waitFor(() =>
      expect(
        window.location.pathname +
          window.location.search +
          window.location.hash,
      ).toBe("/en/finished-goods/scan?origin=kept#scanner"),
    );
  } finally {
    view.unmount();
    stop();
  }
});

it("closing the nested QR camera and cancelling the picker consumes both overlays before the next Back", async () => {
  window.history.replaceState(
    { appNavigationIndex: 0 },
    "",
    "/en/finished-goods/scan?origin=kept#scanner",
  );
  const stop = trackAppHistory();
  window.history.pushState(
    {},
    "",
    "/en/finished-goods/scan/records?filter=keep#rows",
  );
  const user = userEvent.setup();
  const view = renderWithIntl(<JobScanRecordsScreen />, {
    locale: "en",
    workspace: false,
  });
  try {
    await user.click(
      screen.getByRole("button", { name: "Set location for FO001" }),
    );
    const picker = screen.getByRole("dialog", { name: "Set location" });
    await user.click(within(picker).getByRole("button", { name: "Scan code" }));
    const camera = await screen.findByRole("dialog", { name: "Scan code" });
    await user.click(
      within(camera).getByRole("button", { name: "Close camera" }),
    );
    await waitFor(() => expect(camera).not.toBeInTheDocument());
    await user.click(within(picker).getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Set location" })).toBeNull(),
    );
    await waitFor(() =>
      expect(window.location.search + window.location.hash).toBe(
        "?filter=keep#rows",
      ),
    );
    act(() => window.history.back());
    await waitFor(() =>
      expect(
        window.location.pathname +
          window.location.search +
          window.location.hash,
      ).toBe("/en/finished-goods/scan?origin=kept#scanner"),
    );
  } finally {
    view.unmount();
    stop();
  }
});

it("dirty location registration inside the picker Dialog guards Cancel and Back before discarding", async () => {
  window.history.replaceState(
    { appNavigationIndex: 0 },
    "",
    "/en/finished-goods/scan?origin=kept#scanner",
  );
  const stop = trackAppHistory();
  window.history.pushState(
    {},
    "",
    "/en/finished-goods/scan/records?filter=keep#rows",
  );
  const user = userEvent.setup();
  const view = renderWithIntl(
    <NavigationGuardProvider>
      <JobScanRecordsScreen />
    </NavigationGuardProvider>,
    { locale: "en", workspace: false },
  );
  try {
    await user.click(
      screen.getByRole("button", { name: "Set location for FO001" }),
    );
    const picker = screen.getByRole("dialog", { name: "Set location" });
    await user.click(within(picker).getByRole("button", { name: "Scan code" }));
    const camera = await screen.findByRole("dialog", { name: "Scan code" });
    await user.click(
      within(camera).getByRole("button", { name: "Scan test location" }),
    );
    await user.click(
      await within(picker).findByRole("button", { name: "Add location" }),
    );
    const nameInput = await within(picker).findByRole("textbox", {
      name: "Display name (optional)",
    });
    await user.type(nameInput, "North dock");

    // Native Back guards the dirty registration form and Keep editing retains it.
    act(() => window.history.back());
    await screen.findByRole("dialog", { name: "Discard changes?" });
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(
      screen.getByRole("textbox", { name: "Display name (optional)" }),
    ).toHaveValue("North dock");

    // Clicking the outer Dialog's Close button also guards the dirty registration draft.
    await user.click(
      within(screen.getByRole("dialog", { name: "Set location" })).getByRole(
        "button",
        { name: "Close" },
      ),
    );
    await screen.findByRole("dialog", { name: "Discard changes?" });
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Set location" })).toBeNull(),
    );
    await waitFor(() =>
      expect(window.location.search + window.location.hash).toBe(
        "?filter=keep#rows",
      ),
    );
    act(() => window.history.back());
    await waitFor(() =>
      expect(
        window.location.pathname +
          window.location.search +
          window.location.hash,
      ).toBe("/en/finished-goods/scan?origin=kept#scanner"),
    );
  } finally {
    view.unmount();
    stop();
  }
});

it.each(["while open", "after Back"])(
  "retires the location picker when a live update removes its target %s",
  async (removal) => {
    window.history.replaceState(
      { appNavigationIndex: 0 },
      "",
      "/en/finished-goods/scan?origin=kept#scanner",
    );
    const stop = trackAppHistory();
    window.history.pushState(
      {},
      "",
      "/en/finished-goods/scan/records?filter=keep#rows",
    );
    const user = userEvent.setup();
    const view = renderWithIntl(<JobScanRecordsScreen />, {
      locale: "en",
      workspace: false,
      preserveProviders: true,
    });
    try {
      await user.click(
        screen.getByRole("button", { name: "Set location for FO001" }),
      );
      expect(
        screen.getByRole("dialog", { name: "Set location" }),
      ).toBeInTheDocument();
      if (removal === "after Back") {
        act(() => window.history.back());
        await waitFor(() =>
          expect(
            screen.queryByRole("dialog", { name: "Set location" }),
          ).toBeNull(),
        );
      }
      mocks.records = originalRecords.filter(
        (record) => record.id !== "scan-a",
      );
      view.rerender(<JobScanRecordsScreen />);
      await waitFor(() =>
        expect(
          screen.queryByRole("dialog", { name: "Set location" }),
        ).toBeNull(),
      );
      await waitFor(() =>
        expect(window.location.search + window.location.hash).toBe(
          "?filter=keep#rows",
        ),
      );
      await act(async () => {
        const visited = new Promise<void>((resolve) =>
          window.addEventListener("popstate", () => resolve(), { once: true }),
        );
        window.history.forward();
        await visited;
      });
      await waitFor(() =>
        expect(window.location.search + window.location.hash).toBe(
          "?filter=keep#rows",
        ),
      );
      expect(screen.queryByRole("dialog", { name: "Set location" })).toBeNull();
      act(() => window.history.back());
      await waitFor(() =>
        expect(
          window.location.pathname +
            window.location.search +
            window.location.hash,
        ).toBe("/en/finished-goods/scan?origin=kept#scanner"),
      );
    } finally {
      view.unmount();
      stop();
    }
  },
);

it("remounting the records screen retires an open location picker Dialog cleanly", async () => {
  window.history.replaceState(
    { appNavigationIndex: 0 },
    "",
    "/en/finished-goods/scan?origin=kept#scanner",
  );
  const stop = trackAppHistory();
  window.history.pushState(
    {},
    "",
    "/en/finished-goods/scan/records?filter=keep#rows",
  );
  const user = userEvent.setup();
  const first = renderWithIntl(<JobScanRecordsScreen />, {
    locale: "en",
    workspace: false,
  });
  let second: ReturnType<typeof renderWithIntl> | undefined;
  try {
    await user.click(
      screen.getByRole("button", { name: "Set location for FO001" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Set location" }),
    ).toBeInTheDocument();
    first.unmount();
    second = renderWithIntl(<JobScanRecordsScreen />, {
      locale: "en",
      workspace: false,
    });
    await waitFor(() =>
      expect(window.location.search + window.location.hash).toBe(
        "?filter=keep#rows",
      ),
    );
    expect(screen.queryByRole("dialog", { name: "Set location" })).toBeNull();
    act(() => window.history.back());
    await waitFor(() =>
      expect(
        window.location.pathname +
          window.location.search +
          window.location.hash,
      ).toBe("/en/finished-goods/scan?origin=kept#scanner"),
    );
  } finally {
    second?.unmount();
    stop();
  }
});

it("honors requestedWarehouseId on job scan records and yields when the user switches warehouse", async () => {
  window.history.replaceState(
    null,
    "",
    "/en/finished-goods/scan/records?warehouseId=warehouse-b",
  );
  mocks.extraWarehouses = [
    { id: "warehouse-b", code: "WH-B", name: "Warehouse B" },
  ];
  const view = renderWithIntl(
    <JobScanRecordsScreen requestedWarehouseId="warehouse-b" />,
    { locale: "en", workspace: false, preserveProviders: true },
  );
  await waitFor(() =>
    expect(mocks.selectWarehouse).toHaveBeenCalledWith("warehouse-b"),
  );
  expect(mocks.listCalls.at(-1)).toMatchObject({ warehouseId: "warehouse-b" });

  // Workspace syncs to warehouse-b, then user switches to warehouse-a.
  mocks.warehouseId = "warehouse-b";
  view.rerender(<JobScanRecordsScreen requestedWarehouseId="warehouse-b" />);
  mocks.listCalls = [];
  mocks.warehouseId = "warehouse-a";
  view.rerender(<JobScanRecordsScreen requestedWarehouseId="warehouse-b" />);

  await waitFor(() =>
    expect(
      new URLSearchParams(window.location.search).get("warehouseId"),
    ).toBeNull(),
  );
  expect(mocks.listCalls.at(-1)).toMatchObject({ warehouseId: "warehouse-a" });
});
