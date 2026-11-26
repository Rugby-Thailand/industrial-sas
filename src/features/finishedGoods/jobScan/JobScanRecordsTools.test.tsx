import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NavigationGuardProvider } from "@/components/navigation/NavigationGuardProvider";
import type * as WorkspaceModule from "@/components/providers/WorkspaceProvider";
import { trackAppHistory } from "@/lib/browser/appHistory";
import { getFunctionName } from "convex/server";
import type { ComponentProps, ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import {
  finishedGoodsWorkspace,
  querySuccess,
  writeSuccess,
} from "@tests/fixtures/finished-goods-ui";
import { JobScanRecordsScreen } from "./JobScanRecords";

const mocks = vi.hoisted(() => ({
  manage: true,
  list: vi.fn(),
  action: vi.fn(),
  resolve: vi.fn(),
  save: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useMutation: () => mocks.save,
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
  mocks.save.mockReset().mockResolvedValue(writeSuccess("scan-a"));
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

it("consumes a repeated warehouse QR scan without reopening it on Forward", async () => {
  trackAppHistory();
  const beforeScan = window.location.href;
  const user = userEvent.setup();
  mocks.resolve.mockResolvedValue(
    querySuccess({
      ok: true,
      location: { code: "F2-L12-3", locationId: "locationa" },
    }),
  );
  renderWithIntl(<JobScanRecordsScreen />, { locale: "en", workspace: false });
  const trigger = screen.getByRole("button", { name: "Scan to search" });
  const expectedQuery = expect.objectContaining({
    locationId: "locationa",
    search: "F2-L12-3",
  });
  for (let count = 1; count <= 2; count++) {
    await user.click(trigger);
    await user.click(
      screen.getByRole("button", { name: "Read a location QR" }),
    );
    await waitFor(() => expect(mocks.resolve).toHaveBeenCalledTimes(count));
    await waitFor(() => expect(trigger).toHaveFocus());
    await waitFor(() =>
      expect(mocks.list).toHaveBeenLastCalledWith(expectedQuery),
    );
  }
  const filtered = window.location.href;
  expect(filtered).not.toBe(beforeScan);
  await act(async () => {
    const visited = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    window.history.forward();
    await visited;
  });
  await waitFor(() => expect(window.location.href).toBe(filtered));
  expect(screen.queryByRole("dialog")).toBeNull();
  await waitFor(() =>
    expect(mocks.list).toHaveBeenLastCalledWith(expectedQuery),
  );
  act(() => window.history.back());
  await waitFor(() => expect(window.location.href).toBe(beforeScan));
  await waitFor(() =>
    expect(mocks.list.mock.lastCall?.[0]).not.toHaveProperty("locationId"),
  );
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
  const assist = within(
    await screen.findByRole("dialog", { name: "Edit with AI" }),
  );
  await user.click(assist.getByRole("button", { name: "Cancel" }));
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

const origin = "/th/finished-goods/scan?warehouse=one#camera";
const recordsPath = "/en/finished-goods/scan/records?warehouse=one#records";
const editPrompt = "Set part name to Widget";

async function openManualEditorFromAi() {
  window.history.replaceState({ __NA: true }, "", origin);
  const stop = trackAppHistory();
  window.history.pushState({ __NA: true }, "", recordsPath);
  const view = renderWithIntl(
    <NavigationGuardProvider>
      <JobScanRecordsScreen />
    </NavigationGuardProvider>,
    { locale: "en", workspace: false },
  );
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "Edit FO12345 with AI" }),
  );
  await user.type(
    screen.getByRole("textbox", { name: "What should change?" }),
    editPrompt,
  );
  await user.click(
    screen.getByRole("button", { name: "Correct ticket details" }),
  );
  const editor = within(
    await screen.findByRole("dialog", { name: "Correct saved job ticket" }),
  );
  return {
    editor,
    user,
    cleanup: () => {
      view.unmount();
      stop();
    },
  };
}

it.each(["Cancel", "native Back"])(
  "manual correction %s restores the retained AI prompt without discarding it",
  async (dismissal) => {
    const { editor, user, cleanup } = await openManualEditorFromAi();
    try {
      if (dismissal === "Cancel") {
        await user.click(editor.getAllByRole("button", { name: "Cancel" })[0]!);
      } else {
        act(() => window.history.back());
      }
      expect(
        await screen.findByRole("textbox", { name: "What should change?" }),
      ).toHaveValue(editPrompt);
      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "Correct ticket details" }),
        ).toHaveFocus();
      });
      expect(
        screen.queryByRole("dialog", { name: "Discard changes?" }),
      ).not.toBeInTheDocument();
      expect(mocks.save).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  },
);

it("discarding a dirty manual correction retains the earlier AI draft", async () => {
  const { editor, user, cleanup } = await openManualEditorFromAi();
  try {
    await user.type(editor.getByRole("textbox", { name: "Job No." }), "X");
    await user.click(editor.getAllByRole("button", { name: "Cancel" })[0]!);
    const confirmation = within(
      await screen.findByRole("dialog", { name: "Discard changes?" }),
    );
    await user.click(
      confirmation.getByRole("button", { name: "Keep editing" }),
    );
    expect(editor.getByRole("textbox", { name: "Job No." })).toHaveValue(
      "FO12345X",
    );
    act(() => window.history.back());
    const dismiss = within(
      await screen.findByRole("dialog", { name: "Discard changes?" }),
    );
    await user.click(dismiss.getByRole("button", { name: "Discard changes" }));
    expect(
      await screen.findByRole("textbox", { name: "What should change?" }),
    ).toHaveValue(editPrompt);
    expect(mocks.save).not.toHaveBeenCalled();
  } finally {
    cleanup();
  }
});

it("saving a manual correction from AI consumes both dialogs before the next Back", async () => {
  const { editor, user, cleanup } = await openManualEditorFromAi();
  try {
    const job = editor.getByRole("textbox", { name: "Job No." });
    await user.clear(job);
    await user.type(job, "FO99999");
    await user.click(editor.getByRole("button", { name: "Save correction" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(
      window.location.pathname + window.location.search + window.location.hash,
    ).toBe(recordsPath);
    act(() => window.history.back());
    await waitFor(() =>
      expect(
        window.location.pathname +
          window.location.search +
          window.location.hash,
      ).toBe(origin),
    );
  } finally {
    cleanup();
  }
});
