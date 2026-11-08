// Regression: the correction editor falls back to the click-time snapshot
// (`records.find(...) ?? editing`) once its record leaves the visible page.
// When the record left because another session changed it (here: mapped it,
// so it leaves the "Needs location" view), the editor keeps an old baseline,
// never shows its stale state, and every save is refused STALE_REVISION with
// no "Load current ticket" control: the correction cannot be saved.
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as ClerkModule from "@clerk/nextjs";
import { getFunctionName } from "convex/server";
import {
  useSyncExternalStore,
  type ComponentProps,
  type ReactNode,
} from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { clearCursorPositions } from "@/hooks/useCursorPagination";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import {
  querySuccess,
  writeFailure,
  writeSuccess,
} from "@tests/fixtures/finished-goods-ui";
import { NavigationGuardProvider } from "@/components/navigation/NavigationGuardProvider";
import { JobScanRecordsScreen } from "./JobScanRecords";

type Row = {
  id: string;
  factoryOrder: string;
  productBarcodeText: string;
  locationText: string;
  mapped: boolean;
  source: string;
  createdAt: number;
  version: number;
};
const store = vi.hoisted(() => {
  let version = 0;
  const listeners = new Set<() => void>();
  return {
    records: [] as Row[],
    update: vi.fn(),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot: () => version,
    changed() {
      version++;
      listeners.forEach((listener) => listener());
    },
  };
});

vi.mock("convex/react", () => ({
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref).endsWith(":updateJobScan") ? store.update : vi.fn(),
  useConvex: () => ({ query: vi.fn() }),
  useQuery: (
    ref: Parameters<typeof getFunctionName>[0],
    args: { filter: string },
  ) => {
    useSyncExternalStore(store.subscribe, store.snapshot);
    const name = getFunctionName(ref);
    // The fix reads the record's current version from this
    // per-record query, so the fake server answers it as the real one does.
    if (name.endsWith(":listJobScanCorrections"))
      return querySuccess({
        complete: true,
        items: [],
        current: store.records.find(
          (row) =>
            row.id === (args as unknown as { jobScanId: string }).jobScanId,
        ),
      });
    if (!name.endsWith(":listJobScans"))
      return querySuccess({ items: [], status: "ready", isDone: true });
    const items = store.records.filter(
      (row) =>
        args.filter === "ALL" || row.mapped === (args.filter === "MAPPED"),
    );
    return querySuccess({
      status: "ready",
      scanned: items.length,
      items,
      isDone: true,
      continueCursor: "",
    });
  },
}));
vi.mock("@clerk/nextjs", async (importOriginal) => ({
  ...(await importOriginal<typeof ClerkModule>()),
  useAuth: () => ({ isLoaded: true, userId: "user-a" }),
}));
vi.mock("@/hooks/useCanManage", () => ({ useCanManage: () => true }));
vi.mock("@/components/system/QueryGate", () => ({
  QueryGate: ({ children }: { children: (warehouseId: string) => ReactNode }) =>
    children("warehouse-a"),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...props }: ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
  useRouter: () => ({ back: vi.fn(), replace: vi.fn() }),
}));

beforeEach(() => {
  clearCursorPositions();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/en/finished-goods/scan/records");
  store.records = [
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
  ];
  // The server: a correction must name the record's current version.
  store.update
    .mockReset()
    .mockImplementation(
      async (args: { jobScanId: string; expectedVersion: number }) => {
        const row = store.records.find((item) => item.id === args.jobScanId)!;
        return args.expectedVersion === row.version
          ? writeSuccess(row.id)
          : writeFailure("STALE_REVISION");
      },
    );
});

it("a correction whose record was changed elsewhere can still be recovered and saved", async () => {
  const user = userEvent.setup();
  renderWithIntl(
    <NavigationGuardProvider>
      <JobScanRecordsScreen />
    </NavigationGuardProvider>,
    { locale: "en", workspace: false, preserveProviders: true },
  );
  await user.click(
    await screen.findByRole("button", { name: "Actions for record FO001" }),
  );
  await user.click(
    screen.getByRole("menuitem", { name: "Correct ticket details" }),
  );
  const job = await screen.findByRole("textbox", { name: "Job No." });
  await user.clear(job);
  await user.type(job, "FO0011");

  // Another supervisor maps this record (version 1 -> 2). It leaves the
  // "Needs location" list the editor was opened from.
  act(() => {
    store.records = store.records.map((row) => ({
      ...row,
      mapped: true,
      locationText: "ZONE-A",
      version: 2,
    }));
    store.changed();
  });

  const reload = screen.queryAllByRole("button", {
    name: "Load current ticket",
  }).length;
  // Without a conflict state the operator can only press Save, twice.
  for (let attempt = 0; reload === 0 && attempt < 2; attempt++) {
    await user.click(screen.getByRole("button", { name: "Save correction" }));
    await waitFor(() =>
      expect(store.update).toHaveBeenCalledTimes(attempt + 1),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Save correction" }),
      ).toBeEnabled(),
    );
  }
  const reloadAfterRefusals = screen.queryAllByRole("button", {
    name: "Load current ticket",
  }).length;
  const refused = (
    await Promise.all(store.update.mock.results.map((r) => r.value))
  ).filter((outcome) => !outcome.value.written).length;
  // Expected: the editor shows the conflict and offers "Load current ticket"
  // (1 control) instead of resubmitting the old baseline. Actual on 137c8d52:
  // 0 controls, and both saves are refused with expectedVersion 1.
  expect({ reload, reloadAfterRefusals, refused }).toEqual({
    reload: 1,
    reloadAfterRefusals: 1,
    refused: 0,
  });
}, 20000);
