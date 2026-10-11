import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { axe } from "jest-axe";
import type { ComponentProps, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearCursorPositions } from "@/hooks/useCursorPagination";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import {
  querySuccess,
  writeFailure,
  writeSuccess,
} from "@tests/fixtures/finished-goods-ui";
import { JobScanRecordsScreen } from "./JobScanRecords";

const mocks = vi.hoisted(() => ({
  canManage: true,
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
    },
    {
      id: "scan-b",
      factoryOrder: "FO002",
      productBarcodeText: "PRODUCT-B",
      locationText: "F1-L1",
      mapped: true,
      source: "BARCODE",
      createdAt: 2000,
    },
    {
      id: "scan-c",
      factoryOrder: "FO003",
      productBarcodeText: "PRODUCT-C",
      locationText: "Dock",
      mapped: false,
      source: "AI",
      createdAt: 3000,
    },
  ],
  deleteScans:
    vi.fn<
      (args: { ids: string[] }) => Promise<ReturnType<typeof writeSuccess>>
    >(),
  assign: vi.fn(),
  resolveLocation: vi.fn(),
}));
const originalRecords = [...mocks.records];

vi.mock("convex/react", () => ({
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref).endsWith(":deleteJobScans")
      ? mocks.deleteScans
      : mocks.assign,
  useConvex: () => ({ query: mocks.resolveLocation }),
  useQuery: (
    ref: Parameters<typeof getFunctionName>[0],
    args: { filter: string; cursor: string | null },
  ) => {
    if (getFunctionName(ref).endsWith(":searchPage"))
      return querySuccess({
        items: [{ zoneId: "zone-a", code: "ZONE-A", name: "Warehouse A" }],
        page: 1,
        pages: 1,
        total: 1,
        status: "ready",
        isDone: true,
      });
    if (mocks.denied) return { ok: false, requestId: "denied-query" };
    const items = mocks.records.filter(
      (record) =>
        args.filter === "ALL" || record.mapped === (args.filter === "MAPPED"),
    );
    const offset = Number(args.cursor ?? 0);
    return querySuccess({
      items: mocks.paginated ? items.slice(offset, offset + 1) : items,
      isDone: !mocks.paginated || offset + 1 >= items.length,
      continueCursor: String(offset + 1),
    });
  },
}));
vi.mock("@/hooks/useCanManage", () => ({
  useCanManage: () => mocks.canManage,
}));
vi.mock("../BarcodeCameraBox", () => ({
  BarcodeCameraBox: ({ onCode }: { onCode: (code: string) => void }) => (
    <button onClick={() => onCode("ZONE-A")}>Scan test location</button>
  ),
}));
vi.mock("@/components/system/QueryGate", () => ({
  QueryGate: ({ children }: { children: (warehouseId: string) => ReactNode }) =>
    children("warehouse-a"),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...props }: ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
  useRouter: () => ({ back: vi.fn() }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  clearCursorPositions();
  mocks.canManage = true;
  mocks.paginated = false;
  mocks.denied = false;
  mocks.assign.mockResolvedValue(writeSuccess("scan-a"));
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
    await waitFor(() => expect(location).toBeEnabled());
    expect(
      screen.getByRole("checkbox", { name: "Select FO001" }),
    ).toBeChecked();
    await user.click(location);
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
    expect(
      screen.getByRole("checkbox", { name: "Select FO001" }),
    ).not.toBeChecked();
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
    await user.click(
      screen.getByRole("button", { name: "Actions for record FO001" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Change location" }));
    expect(
      screen.getByRole("heading", { name: "Choose a location" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: "Choose a location" }),
      ).toHaveFocus(),
    );
    expect(
      screen.getByRole("checkbox", { name: "Select FO003" }),
    ).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "Select FO003" }));
    expect(
      screen.getByRole("checkbox", { name: "Select FO003" }),
    ).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: /ZONE-A/ }));
    await waitFor(() =>
      expect(mocks.assign).toHaveBeenCalledWith({
        warehouseId: "warehouse-a",
        requestId: expect.any(String),
        ids: ["scan-a"],
        location: { zoneId: "zone-a" },
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
    expect(location).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "All" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    expect(
      screen.getByRole("textbox", { name: /Search Job No/ }),
    ).toBeDisabled();
    await user.click(location);
    expect(mocks.assign).toHaveBeenCalledTimes(1);
    finish(writeSuccess("scan-a"));
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Choose a location" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("checkbox", { name: "Select FO001" }),
    ).not.toBeChecked();
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
    await user.click(
      screen.getByRole("button", { name: "Scan location barcode or QR" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Scan test location" }),
    );
    expect(mocks.resolveLocation).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    finish(location);
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Choose a location" }),
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
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});
