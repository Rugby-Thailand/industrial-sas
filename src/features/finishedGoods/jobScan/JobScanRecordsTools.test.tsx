import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as WorkspaceModule from "@/components/providers/WorkspaceProvider";
import { getFunctionName } from "convex/server";
import type { ComponentProps, ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import {
  finishedGoodsWorkspace,
  querySuccess,
} from "@tests/fixtures/finished-goods-ui";
import { JobScanRecordsScreen } from "./JobScanRecords";

const mocks = vi.hoisted(() => ({
  manage: true,
  list: vi.fn(),
  action: vi.fn(),
  resolve: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
  useConvex: () => ({ action: mocks.action, query: mocks.resolve }),
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
    if (args === "skip") return;
    const name = getFunctionName(ref);
    if (name.endsWith(":listJobScans")) mocks.list(args);
    if (name.endsWith(":listJobScanCorrections"))
      return querySuccess({ complete: true, items: [], current: row });
    return querySuccess({
      items: [row],
      status: "ready",
      isDone: true,
      continueCursor: "",
    });
  },
}));
vi.mock("@/hooks/useCanManage", () => ({ useCanManage: () => mocks.manage }));
vi.mock("@/hooks/useDraftKey", () => ({
  useDraftKey: (scope: string) => scope,
}));
vi.mock("@/components/system/QueryGate", () => ({
  QueryGate: ({ children }: { children: (warehouseId: string) => ReactNode }) =>
    children("warehouse-a"),
}));
vi.mock("@/components/providers/WorkspaceProvider", async (load) => ({
  ...(await load<typeof WorkspaceModule>()),
  useWorkspace: () => finishedGoodsWorkspace,
}));
vi.mock("@/i18n/navigation", () => ({
  Link: (props: ComponentProps<"a">) => <a {...props} />,
  useRouter: () => ({ back: vi.fn() }),
}));
vi.mock("../BarcodeCameraBox", () => ({
  BarcodeCameraBox: ({ onCode }: { onCode: (code: string) => void }) => (
    <>
      <button onClick={() => onCode("FO12345")}>Read a job code</button>
      <button onClick={() => onCode("ISAS:LOCATION:1:locationa")}>
        Read a location QR
      </button>
    </>
  ),
}));

const row = {
  id: "scan-a",
  factoryOrder: "FO12345",
  productBarcodeText: "SKU-A",
  locationText: "Dock",
  source: "MANUAL",
  mapped: false,
  version: 2,
  createdAt: 1000,
  updatedAt: 1000,
};
beforeEach(() => {
  mocks.list.mockClear();
  mocks.action.mockReset();
  mocks.resolve.mockReset();
  mocks.resolve.mockResolvedValue(
    querySuccess({ ok: false, error: { code: "LOCATION_NOT_FOUND" } }),
  );
  mocks.manage = true;
  window.localStorage.clear();
  window.history.replaceState(
    { __NA: true },
    "",
    "/en/finished-goods/scan/records?warehouse=one#records",
  );
});

it("restores warehouse QR identity in the records query and clears it on manual search", async () => {
  const user = userEvent.setup();
  mocks.resolve.mockResolvedValue(
    querySuccess({
      ok: true,
      location: { code: "F2-L12-3", locationId: "locationa" },
    }),
  );
  const renderScreen = () =>
    renderWithIntl(<JobScanRecordsScreen />, {
      locale: "en",
      workspace: false,
      preserveProviders: true,
    });
  const view = renderScreen();
  await user.click(screen.getByRole("button", { name: "Scan to search" }));
  await user.click(screen.getByRole("button", { name: "Read a location QR" }));
  const expected = expect.objectContaining({
    locationId: "locationa",
    filter: "ALL",
    search: "F2-L12-3",
  });
  await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expected));
  expect(mocks.list.mock.lastCall?.[0]).not.toHaveProperty("exactCode");
  view.unmount();
  renderScreen();
  await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expected));
  const search = screen.getByRole("textbox", { name: /search/i });
  await user.clear(search);
  await user.type(search, "F2");
  await waitFor(() =>
    expect(mocks.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: "F2" }),
    ),
  );
  expect(mocks.list.mock.lastCall?.[0]).not.toHaveProperty("locationId");
});

it("applies scanned codes and AI filters to the actual records query and restores filters after remount", async () => {
  const user = userEvent.setup();
  mocks.action.mockResolvedValue({
    ok: true,
    value: {
      ok: true,
      value: {
        filter: "MAPPED",
        search: "",
        facets: { floor: 2, storageFormat: "PALLET" },
      },
    },
  });
  const view = renderWithIntl(<JobScanRecordsScreen />, {
    locale: "en",
    workspace: false,
    preserveProviders: true,
  });
  await user.click(screen.getByRole("button", { name: "Scan to search" }));
  await user.click(screen.getByRole("button", { name: "Read a job code" }));
  await waitFor(() =>
    expect(mocks.list).toHaveBeenLastCalledWith(
      expect.objectContaining({
        warehouseId: "warehouse-a",
        filter: "ALL",
        exactCode: true,
        search: "FO12345",
      }),
    ),
  );
  await user.click(screen.getByRole("button", { name: "AI search" }));
  const dialog = within(screen.getByRole("dialog", { name: "AI search" }));
  await user.type(
    dialog.getByRole("textbox", { name: "Find tickets" }),
    "pallets on floor 2",
  );
  await user.click(dialog.getByRole("button", { name: "Search tickets" }));
  const apply = await dialog.findByRole("button", { name: "Apply search" });
  expect(mocks.list.mock.lastCall?.[0]).toHaveProperty("exactCode", true);
  await user.click(apply);
  await waitFor(() =>
    expect(mocks.list).toHaveBeenLastCalledWith(
      expect.objectContaining({
        warehouseId: "warehouse-a",
        filter: "MAPPED",
        facets: { floor: 2, storageFormat: "PALLET" },
      }),
    ),
  );
  expect(mocks.list.mock.lastCall?.[0]).not.toHaveProperty("exactCode");
  expect(mocks.action).toHaveBeenCalledWith(expect.anything(), {
    warehouseId: "warehouse-a",
    prompt: "pallets on floor 2",
  });
  expect(window.location.hash).toBe("#records");
  view.unmount();
  renderWithIntl(<JobScanRecordsScreen />, { locale: "en", workspace: false });
  expect(await screen.findByText(/floor 2.*pallet/i)).toBeVisible();
});

it("reviews an explicit location search, restores its query scope, and clears the scope when typing", async () => {
  const user = userEvent.setup();
  mocks.action.mockResolvedValue(
    querySuccess({
      ok: true,
      value: { filter: "ALL", search: "F2-L12-1", searchField: "location" },
    }),
  );
  const renderScreen = () =>
    renderWithIntl(<JobScanRecordsScreen />, {
      locale: "en",
      workspace: false,
      preserveProviders: true,
    });
  const view = renderScreen();
  await user.click(screen.getByRole("button", { name: "AI search" }));
  const dialog = within(screen.getByRole("dialog", { name: "AI search" }));
  await user.type(
    dialog.getByRole("textbox", { name: "Find tickets" }),
    "หาใบงานที่อยู่ F2-L12-1",
  );
  await user.click(dialog.getByRole("button", { name: "Search tickets" }));
  expect(await dialog.findByRole("status")).toHaveTextContent(
    "All · Location · F2-L12-1",
  );
  expect(mocks.list.mock.lastCall?.[0]).not.toHaveProperty("search");
  await user.click(dialog.getByRole("button", { name: "Apply search" }));
  const scoped = expect.objectContaining({
    search: "F2-L12-1",
    searchField: "location",
  });
  await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(scoped));
  view.unmount();
  renderScreen();
  expect(mocks.list).toHaveBeenLastCalledWith(scoped);
  await user.type(screen.getByRole("textbox", { name: /search/i }), "X");
  await waitFor(() =>
    expect(mocks.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: "F2-L12-1X" }),
    ),
  );
  expect(mocks.list.mock.lastCall?.[0]).not.toHaveProperty("searchField");
});

it("keeps the existing record actions beside AI edit and limits writes to managers", async () => {
  const user = userEvent.setup();
  const view = renderWithIntl(<JobScanRecordsScreen />, {
    locale: "en",
    workspace: false,
    preserveProviders: true,
  });
  expect(
    screen.getByRole("button", { name: "Actions for record FO12345" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Delete record FO12345" }),
  ).toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "Edit FO12345 with AI" }),
  );
  expect(
    screen.getByRole("dialog", { name: "Edit with AI" }),
  ).toHaveTextContent("FO12345");
  await user.click(
    screen.getByRole("button", { name: "Correct ticket details" }),
  );
  const editor = within(
    await screen.findByRole("dialog", { name: "Correct saved job ticket" }),
  );
  expect(editor.getByRole("textbox", { name: "Job No." })).toHaveValue(
    "FO12345",
  );
  await user.click(editor.getAllByRole("button", { name: /^Cancel$/ })[0]!);
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  mocks.manage = false;
  view.rerender(<JobScanRecordsScreen />);
  expect(
    screen.queryByRole("button", { name: "Edit FO12345 with AI" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "AI search" })).toBeInTheDocument();
});
