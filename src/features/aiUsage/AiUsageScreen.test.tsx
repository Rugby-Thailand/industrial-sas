import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "@tests/fixtures/intl-render";

const state = vi.hoisted(() => ({
  access: { status: "READY", permissions: ["aiUsage.read"] } as {
    status: string;
    permissions: string[];
  },
  summary: undefined as unknown,
  query: vi.fn(),
  client: null as unknown,
}));
// The real client is stable across renders.
state.client = { query: (...args: unknown[]) => state.query(...args) };

vi.mock("convex/react", async () => {
  const { getFunctionName: name } = await import("convex/server");
  return {
    useQuery: (reference: Parameters<typeof name>[0], args: unknown) =>
      args === "skip" || name(reference) !== "aiUsage/reports:summary"
        ? undefined
        : state.summary,
    useMutation: () => vi.fn(),
    useConvex: () => state.client,
  };
});
vi.mock("@/components/providers/AiUsageAccessProvider", () => ({
  useAiUsageAccess: () => state.access,
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: unknown }) => (
    <a href={href}>{children as never}</a>
  ),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/ai-usage",
}));
// The report must not depend on storage access: a denied workspace is irrelevant.
vi.mock("@/components/providers/WorkspaceProvider", () => ({
  useWorkspace: () => ({
    denied: true,
    permissionsReady: false,
    navigationPermissions: [],
  }),
}));

import { AiUsageScreen } from "./AiUsageScreen";
import { RecentActivity } from "./RecentActivity";

const metrics = (overrides: Record<string, number> = {}) => ({
  operationCount: 0,
  attemptCount: 0,
  successCount: 0,
  pendingCount: 0,
  knownCostUsdNano: 0,
  unknownAttemptCount: 0,
  incompleteOperationCount: 0,
  completeOperationCount: 0,
  completeCostUsdNano: 0,
  totalDurationMs: 0,
  finishedOperationCount: 0,
  ...overrides,
});
const report = {
  range: {
    from: "2026-10-01",
    to: "2026-10-15",
    start: Date.parse("2026-09-30T17:00:00Z"),
    end: Date.parse("2026-10-15T17:00:00Z"),
    utcDays: [20361],
    timezone: "Asia/Bangkok",
  },
  complete: true,
  byFeature: {
    JOB_TICKET_SCAN: metrics({ operationCount: 2, attemptCount: 3 }),
    LOCATION_LABEL_SCAN: metrics({
      operationCount: 1,
      attemptCount: 1,
      knownCostUsdNano: 120_000,
      completeOperationCount: 1,
      completeCostUsdNano: 120_000,
    }),
    AI_SEARCH: metrics(),
  },
  models: [],
  environments: [],
  breakdown: [],
  settings: null,
  trackingStartedAt: null,
  users: [],
  warehouses: [],
};
const item = (id: string, overrides: Record<string, unknown> = {}) => ({
  operationId: id,
  startedAt: Date.parse("2026-10-15T05:00:00Z"),
  feature: "JOB_TICKET_SCAN",
  environment: "local",
  actorUserId: "user-a",
  actorName: `Actor ${id}`,
  warehouseId: "wh-a",
  warehouseName: "Warehouse ALPHA",
  requestedModel: "openai/gpt-6-luna",
  actualModels: ["openai/gpt-6-luna"],
  status: "SUCCEEDED",
  attemptCount: 1,
  knownCostUsdNano: 200_000,
  unknownAttemptCount: 0,
  durationMs: 1_000,
  ...overrides,
});
const page = (items: unknown[], continueCursor: string | null = null) => ({
  ok: true,
  requestId: "q",
  value: { timezone: "Asia/Bangkok", items, continueCursor },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  state.access = { status: "READY", permissions: ["aiUsage.read"] };
  state.summary = { ok: true, requestId: "q", value: report };
  state.query.mockReset().mockResolvedValue(page([]));
});

describe("AiUsageScreen access", () => {
  it("opens the report for a usage-only reader without the settings form", async () => {
    renderWithIntl(<AiUsageScreen />, { locale: "en" });
    expect(
      await screen.findAllByText("Location label photos"),
    ).not.toHaveLength(0);
    expect(screen.getAllByText("Job ticket photos")).not.toHaveLength(0);
    expect(screen.getAllByText("AI Search")).not.toHaveLength(0);
    expect(
      screen.getByRole("heading", { name: "Recent activity" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Baht estimate settings")).toBeNull();
    await waitFor(() => expect(state.query).toHaveBeenCalled());
  });

  it("shows the settings form only with the configure permission", () => {
    state.access = {
      status: "READY",
      permissions: ["aiUsage.read", "aiUsage.configure"],
    };
    renderWithIntl(<AiUsageScreen />, { locale: "en" });
    expect(screen.getByText("Baht estimate settings")).toBeInTheDocument();
  });

  it.each([
    ["NONE", [], "You need AI usage report permission to view this page."],
    [
      "READY",
      ["aiUsage.configure"],
      "You need AI usage report permission to view this page.",
    ],
    ["LOADING", [], "Loading AI usage…"],
  ])(
    "answers %s %j without reading the report",
    (status, permissions, text) => {
      state.access = { status, permissions };
      renderWithIntl(<AiUsageScreen />, { locale: "en" });
      expect(screen.getByText(text)).toBeInTheDocument();
      expect(screen.queryByText("Job ticket photos")).toBeNull();
    },
  );
});

const props = {
  signature: "s1",
  timezone: "Asia/Bangkok",
  featureLabel: (feature: string) => `label:${feature}`,
  money: (nano: number) => <span>{`usd:${nano}`}</span>,
};

describe("RecentActivity", () => {
  it("shows operation details in the organization timezone", async () => {
    state.query.mockResolvedValueOnce(
      page([
        item("a", {
          attemptCount: 2,
          unknownAttemptCount: 1,
          status: "UNREADABLE",
          actualModels: ["openai/gpt-6-luna-2026"],
        }),
        item("b", {
          status: "PENDING",
          unknownAttemptCount: 1,
          knownCostUsdNano: 0,
          warehouseId: null,
          warehouseName: null,
          feature: "LOCATION_LABEL_SCAN",
        }),
      ]),
    );
    renderWithIntl(<RecentActivity {...props} args={{ period: "month" }} />, {
      locale: "en",
    });
    expect(await screen.findAllByText("Actor a")).not.toHaveLength(0);
    // 05:00 UTC is 12:00 in Bangkok, whatever the browser zone.
    expect(screen.getAllByText(/12:00/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("label:LOCATION_LABEL_SCAN")).not.toHaveLength(
      0,
    );
    expect(screen.getAllByText("Unreadable result")).not.toHaveLength(0);
    expect(screen.getAllByText("2 calls")).not.toHaveLength(0);
    expect(screen.getAllByText(/openai\/gpt-6-luna-2026/)).not.toHaveLength(0);
    expect(screen.getAllByText("usd:200000")).not.toHaveLength(0);
    expect(
      screen.getAllByText("1 call without confirmed cost"),
    ).not.toHaveLength(0);
    expect(screen.getAllByText("In progress")).not.toHaveLength(0);
    expect(screen.getAllByText("Organization")).not.toHaveLength(0);
    expect(state.query).toHaveBeenCalledWith(expect.anything(), {
      period: "month",
    });
  });

  it("loads more with the server cursor and appends without duplicates", async () => {
    state.query
      .mockResolvedValueOnce(page([item("a")], "cursor-1"))
      .mockResolvedValueOnce(page([item("a"), item("b")], null));
    renderWithIntl(<RecentActivity {...props} args={{ period: "month" }} />, {
      locale: "en",
    });
    fireEvent.click(await screen.findByRole("button", { name: "Show more" }));
    expect(await screen.findAllByText("Actor b")).not.toHaveLength(0);
    expect(state.query).toHaveBeenLastCalledWith(expect.anything(), {
      period: "month",
      cursor: "cursor-1",
    });
    // Once in the desktop table and once in the phone card: no duplicate row.
    expect(screen.getAllByText(/^Actor a/)).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("discards a late answer for a previous period or filter", async () => {
    const old = deferred<unknown>();
    state.query
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(page([item("new")]));
    const view = renderWithIntl(
      <RecentActivity {...props} args={{ period: "month" }} />,
      { locale: "en", preserveProviders: true },
    );
    view.rerender(
      <RecentActivity
        {...props}
        args={{ period: "today", feature: "AI_SEARCH" }}
      />,
    );
    expect(await screen.findAllByText("Actor new")).not.toHaveLength(0);
    await act(async () => old.resolve(page([item("old")])));
    expect(screen.queryByText("Actor old")).toBeNull();
    expect(state.query).toHaveBeenLastCalledWith(expect.anything(), {
      period: "today",
      feature: "AI_SEARCH",
    });
  });

  it("ignores a load-more answer that arrives after the filters changed", async () => {
    const more = deferred<unknown>();
    state.query
      .mockResolvedValueOnce(page([item("a")], "cursor-1"))
      .mockReturnValueOnce(more.promise)
      .mockResolvedValueOnce(page([item("filtered")]));
    const view = renderWithIntl(
      <RecentActivity {...props} args={{ period: "month" }} />,
      { locale: "en", preserveProviders: true },
    );
    fireEvent.click(await screen.findByRole("button", { name: "Show more" }));
    view.rerender(
      <RecentActivity
        {...props}
        args={{ period: "month", feature: "AI_SEARCH" }}
      />,
    );
    expect(await screen.findAllByText("Actor filtered")).not.toHaveLength(0);
    await act(async () => more.resolve(page([item("stale")])));
    expect(screen.queryByText("Actor stale")).toBeNull();
    expect(screen.queryByText("Actor a")).toBeNull();
  });

  it("announces newer activity instead of reshuffling, and reloads on request", async () => {
    state.query
      .mockResolvedValueOnce(page([item("a")]))
      .mockResolvedValueOnce(page([item("newer"), item("a")]));
    const view = renderWithIntl(
      <RecentActivity {...props} args={{ period: "month" }} />,
      { locale: "en", preserveProviders: true },
    );
    await screen.findAllByText("Actor a");
    view.rerender(
      <RecentActivity {...props} signature="s2" args={{ period: "month" }} />,
    );
    const notice = await screen.findByText(
      "There is newer activity since this list loaded.",
    );
    expect(notice).toBeInTheDocument();
    expect(screen.queryByText("Actor newer")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show latest" }));
    expect(await screen.findAllByText("Actor newer")).not.toHaveLength(0);
    expect(
      screen.queryByText("There is newer activity since this list loaded."),
    ).toBeNull();
    expect(state.query).toHaveBeenCalledTimes(2);
  });

  it("shows an empty period, and a retry after a failure", async () => {
    state.query
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(page([]));
    renderWithIntl(<RecentActivity {...props} args={{ period: "today" }} />, {
      locale: "th",
    });
    fireEvent.click(await screen.findByRole("button", { name: "ลองอีกครั้ง" }));
    expect(
      await screen.findByText("ไม่มีการเรียก AI ตามช่วงเวลาและตัวกรองนี้"),
    ).toBeInTheDocument();
  });
});

// Keep the reference used by the mock in sync with the registered name.
it("queries the registered recent-history function", async () => {
  const { recentRef } = await import("./RecentActivity");
  expect(getFunctionName(recentRef)).toBe("aiUsage/reports:recent");
});
