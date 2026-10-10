import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "@tests/fixtures/intl-render";
import { chooseOption } from "@tests/fixtures/select-control";

const state = vi.hoisted(() => ({
  access: { status: "READY", permissions: ["aiUsage.read"] } as {
    status: string;
    permissions: string[];
  },
  summary: undefined as unknown,
  summaryArgs: [] as unknown[],
  query: vi.fn(),
  client: null as unknown,
}));
// The real client is stable across renders.
state.client = { query: (...args: unknown[]) => state.query(...args) };

vi.mock("convex/react", async () => {
  const { getFunctionName: name } = await import("convex/server");
  return {
    useQuery: (reference: Parameters<typeof name>[0], args: unknown) => {
      if (args === "skip" || name(reference) !== "aiUsage/reports:summary")
        return undefined;
      state.summaryArgs.push(args);
      return state.summary;
    },
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
  state.summaryArgs = [];
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

describe("AiUsageScreen statement and feature cards", () => {
  const withReport = (value: Record<string, unknown>) => {
    state.summary = {
      ok: true,
      requestId: "q",
      value: { ...report, ...value },
    };
  };
  const statement = () => screen.getByRole("region", { name: "Period total" });
  const card = (name: string) => screen.getByRole("region", { name });
  const settings = {
    version: 2,
    usdThbRate: 40,
    feePercent: 5,
    source: "QA rate",
    effectiveAt: 0,
  };

  it("totals confirmed USD and estimates baht only from the saved rate and fee", () => {
    withReport({
      settings,
      byFeature: {
        JOB_TICKET_SCAN: metrics({
          operationCount: 2,
          attemptCount: 3,
          knownCostUsdNano: 1_000_000_000,
          completeOperationCount: 1,
          completeCostUsdNano: 400_000_000,
        }),
        LOCATION_LABEL_SCAN: metrics({
          operationCount: 1,
          attemptCount: 1,
          knownCostUsdNano: 500_000_000,
          completeOperationCount: 1,
          completeCostUsdNano: 500_000_000,
        }),
        AI_SEARCH: metrics(),
      },
    });
    renderWithIntl(<AiUsageScreen />, { locale: "en" });
    const total = within(statement());
    expect(total.getByText("US$1.500000")).toBeInTheDocument();
    expect(total.getByText("All features, users and warehouses")).toBeVisible();
    // 1.5 USD × 40 = ฿60 inference; a 5% fee adds ฿3.
    expect(total.getByText("≈ ฿63.0000")).toBeInTheDocument();
    expect(
      total.getByText("Inference ฿60.0000 + funding fee 5.00% ฿3.0000"),
    ).toBeInTheDocument();
    expect(
      total.getByText("Rate 40.0000 THB per USD · QA rate"),
    ).toBeInTheDocument();
    const photos = within(card("Job ticket photos"));
    // Retries add provider calls, never photos.
    expect(photos.getByText("2")).toBeInTheDocument();
    expect(photos.getByText("3 calls · 1 retry")).toBeInTheDocument();
    expect(photos.getByText("US$1.000000")).toBeInTheDocument();
    // The average uses only fully priced operations: 0.4 USD, not 1.0 / 2.
    expect(photos.getByText("US$0.400000")).toBeInTheDocument();
    expect(
      photos.getByText("Average per photo · 1 fully priced"),
    ).toBeInTheDocument();
    expect(
      within(card("AI Search")).getByText("No usage in this period."),
    ).toBeInTheDocument();
  });

  it.each([
    [false, "No USD to THB rate has been set, so baht is not estimated."],
    [true, "No USD to THB rate has been set. Add one in Baht estimate"],
  ])(
    "computes no baht without saved settings (configure %s)",
    (configure, text) => {
      state.access = {
        status: "READY",
        permissions: configure
          ? ["aiUsage.read", "aiUsage.configure"]
          : ["aiUsage.read"],
      };
      renderWithIntl(<AiUsageScreen />, { locale: "en" });
      expect(within(statement()).getByText("Not estimated")).toBeVisible();
      expect(
        within(statement()).getByText(new RegExp(`^${text}`)),
      ).toBeInTheDocument();
      expect(document.body.textContent).not.toContain("฿");
    },
  );

  it("keeps unknown cost distinct from a confirmed zero", () => {
    withReport({
      settings,
      byFeature: {
        JOB_TICKET_SCAN: metrics({
          operationCount: 1,
          attemptCount: 2,
          unknownAttemptCount: 2,
          pendingCount: 1,
        }),
        LOCATION_LABEL_SCAN: metrics(),
        AI_SEARCH: metrics({
          operationCount: 1,
          attemptCount: 1,
          completeOperationCount: 1,
        }),
      },
    });
    renderWithIntl(<AiUsageScreen />, { locale: "en" });
    const photos = within(card("Job ticket photos"));
    expect(photos.getByText("Not yet confirmed")).toBeInTheDocument();
    expect(photos.queryByText("US$0.000000")).toBeNull();
    expect(
      photos.getByText("2 calls without confirmed cost"),
    ).toBeInTheDocument();
    expect(photos.getByText("1 operation pending")).toBeInTheDocument();
    expect(photos.getByText(/no fully priced operations yet/)).toBeVisible();
    const search = within(card("AI Search"));
    expect(search.getAllByText("US$0.000000")).not.toHaveLength(0);
    expect(search.getByText("All costs confirmed")).toBeInTheDocument();
    expect(
      within(card("Location label photos")).getByText(
        "No usage in this period.",
      ),
    ).toBeInTheDocument();
    // The total is a lower bound and says so.
    const total = within(statement());
    expect(total.getByText("US$0.000000")).toBeInTheDocument();
    expect(
      total.getByText("2 calls without confirmed cost"),
    ).toBeInTheDocument();
    expect(total.getByText("1 operation pending")).toBeInTheDocument();
  });

  it("filters by feature and totals only the features shown", async () => {
    withReport({ settings });
    renderWithIntl(<AiUsageScreen />, { locale: "en" });
    expect(within(statement()).getByText("US$0.000120")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    chooseOption("Feature", "AI Search");
    fireEvent.click(
      await screen.findByRole("button", { name: "Show results" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(state.summaryArgs.at(-1)).toMatchObject({
      period: "month",
      feature: "AI_SEARCH",
    });
    expect(screen.getByRole("button", { name: "Filters (1)" })).toBeVisible();
    expect(screen.getByText("Filtered by AI Search")).toBeVisible();
    // Only the AI Search card remains, and the total follows it.
    expect(
      screen.queryByRole("region", { name: "Job ticket photos" }),
    ).toBeNull();
    expect(
      screen.queryByRole("region", { name: "Location label photos" }),
    ).toBeNull();
    const total = within(statement());
    expect(total.getByText("US$0.000000")).toBeInTheDocument();
    expect(total.getByText("Filtered total · 1 filter")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(card("Job ticket photos")).toBeInTheDocument();
    expect(state.summaryArgs.at(-1)).not.toHaveProperty("feature");
  });

  it("keeps the incomplete-summary warning and tracking start visible", () => {
    withReport({
      complete: false,
      trackingStartedAt: Date.parse("2026-10-02T03:00:00Z"),
    });
    renderWithIntl(<AiUsageScreen />, { locale: "en" });
    expect(screen.getByText(/These totals are incomplete/)).toBeInTheDocument();
    expect(screen.getByText(/^Tracking began Oct 2, 2026/)).toBeInTheDocument();
    expect(
      screen.getByText("2026-10-01 – 2026-10-15 · Asia/Bangkok"),
    ).toBeVisible();
  });

  it.each([
    [
      { ok: false, requestId: "q", denial: {} },
      "You need AI usage report permission to view this page.",
    ],
    [
      {
        ok: true,
        requestId: "q",
        value: { error: "DATE_RANGE_OR_TIMEZONE_INVALID" },
      },
      "Could not load this report. Check the dates and organization timezone, then try again.",
    ],
  ])("explains a refused or failed report", (outcome, text) => {
    state.summary = outcome;
    renderWithIntl(<AiUsageScreen />, { locale: "en" });
    expect(screen.getByRole("alert")).toHaveTextContent(text);
    expect(screen.queryByRole("region", { name: "Period total" })).toBeNull();
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeDisabled();
  });
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

describe("AiUsageScreen CSV export lifecycle", () => {
  const exportOp = (id: string) => ({
    operationId: id,
    feature: "JOB_TICKET_SCAN",
    environment: "local",
    actorUserId: "user-a",
    requestedModel: "openai/gpt-6-luna",
    startedAt: Date.parse("2026-10-15T05:00:00Z"),
    status: "SUCCEEDED",
    attemptCount: 1,
  });
  const exportAttempt = {
    attemptNo: 1,
    startedAt: Date.parse("2026-10-15T05:00:00Z"),
    status: "SUCCEEDED",
    provider: "OPENROUTER",
    billingAccountRef: "default",
    billingStatus: "REPORTED",
    usageSource: "RESPONSE",
    costUsdNano: 1_000_000_000,
    durationMs: 1,
  };
  const opsPage = (rows: unknown[], cursor: string | null = null) => ({
    ok: true,
    value: {
      page: rows,
      isDone: cursor === null,
      continueCursor: cursor ?? "",
    },
  });
  const objectUrls = {
    create: URL.createObjectURL,
    revoke: URL.revokeObjectURL,
  };
  let blobs: Blob[];
  let clicks: string[];
  beforeEach(() => {
    blobs = [];
    clicks = [];
    state.summary = {
      ok: true,
      requestId: "q",
      value: {
        ...report,
        settings: {
          version: 3,
          usdThbRate: 10,
          feePercent: 0,
          source: "A-rate",
          effectiveAt: 0,
        },
        users: [{ id: "user-a", name: "Name A" }],
      },
    };
    // jsdom has no object URLs; record the Blob instead.
    URL.createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return "blob:usage";
    });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push(this.download);
    });
  });
  afterEach(() => {
    URL.createObjectURL = objectUrls.create;
    URL.revokeObjectURL = objectUrls.revoke;
    vi.restoreAllMocks();
  });
  /** Route the stable client's queries by function name. */
  const route = (handlers: Record<string, (args: unknown) => unknown>) =>
    state.query.mockImplementation(
      (reference: Parameters<typeof getFunctionName>[0], args: unknown) =>
        (handlers[getFunctionName(reference)] ?? (async () => page([])))(args),
    );
  const exportCalls = () =>
    state.query.mock.calls
      .map(([reference]) =>
        getFunctionName(reference as Parameters<typeof getFunctionName>[0]),
      )
      .filter((name) => name !== "aiUsage/reports:recent");

  it("downloads one CSV for the organization and settings it started with", async () => {
    route({
      "aiUsage/reports:operations": async () => opsPage([exportOp("op-a")]),
      "aiUsage/reports:attempts": async () => ({
        ok: true,
        value: [exportAttempt],
      }),
    });
    renderWithIntl(<AiUsageScreen />, { locale: "en" });
    fireEvent.click(await screen.findByRole("button", { name: "Export CSV" }));
    await waitFor(() =>
      expect(clicks).toEqual(["ai-usage-2026-10-01-2026-10-15.csv"]),
    );
    const csv = await blobs[0]!.text();
    expect(csv).toContain('"op-a"');
    expect(csv).toContain('"Name A"');
    expect(csv).toContain('"A-rate"');
    expect(csv).toContain('"Asia/Bangkok"');
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeEnabled();
  });

  it.each([
    ["an operation page", "aiUsage/reports:operations"],
    ["an operation's attempts", "aiUsage/reports:attempts"],
  ])(
    "stops when an organization switch unmounts the report during %s",
    async (_label, paused) => {
      const reply = deferred<unknown>();
      route({
        "aiUsage/reports:operations": async () =>
          opsPage([exportOp("op-a")], "cursor-1"),
        "aiUsage/reports:attempts": async () => ({
          ok: true,
          value: [exportAttempt],
        }),
        [paused]: () => reply.promise,
      });
      const view = renderWithIntl(<AiUsageScreen />, { locale: "en" });
      fireEvent.click(
        await screen.findByRole("button", { name: "Export CSV" }),
      );
      await waitFor(() => expect(exportCalls()).toContain(paused));
      const before = exportCalls().length;
      // The real Convex/Clerk switch clears auth and unmounts UsageReport.
      view.unmount();
      await act(async () =>
        reply.resolve(
          paused === "aiUsage/reports:operations"
            ? opsPage([exportOp("op-b")])
            : { ok: true, value: [exportAttempt] },
        ),
      );
      await act(async () => new Promise((done) => setTimeout(done, 0)));
      expect(exportCalls()).toHaveLength(before);
      expect(blobs).toHaveLength(0);
      expect(clicks).toHaveLength(0);
    },
  );
});

// Keep the reference used by the mock in sync with the registered name.
it("queries the registered recent-history function", async () => {
  const { recentRef } = await import("./RecentActivity");
  expect(getFunctionName(recentRef)).toBe("aiUsage/reports:recent");
});
