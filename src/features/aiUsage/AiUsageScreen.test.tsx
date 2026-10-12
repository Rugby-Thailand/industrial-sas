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
  refresh: vi.fn(),
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
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: state.refresh }),
}));
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

import { AiUsageScreen as Screen } from "./AiUsageScreen";
import { RecentActivity } from "./RecentActivity";
import type { UsageEstimate } from "@/lib/aiUsage/estimateSources";

const LOADED = Date.parse("2026-10-11T07:00:00Z");
const estimateOf = (
  rate: number | null,
  percent: number | null,
): UsageEstimate => ({
  version: 1,
  loadedAt: LOADED,
  fx:
    rate === null
      ? { status: "UNAVAILABLE" }
      : {
          status: "READY",
          value: { rate, date: "2026-10-11", fetchedAt: LOADED },
        },
  funding:
    percent === null
      ? { status: "UNAVAILABLE" }
      : {
          status: "READY",
          value: { percent, minimumUsd: 0.8, fetchedAt: LOADED },
        },
});
const NO_ESTIMATE = estimateOf(null, null);
/** The export trigger names the CSV's real scope: range and timezone. */
const EXPORT_NAME = "Export CSV, 2026-10-01 – 2026-10-15 (Asia/Bangkok)";
/** The report with an already-resolved server snapshot. */
function AiUsageScreen({
  estimate = NO_ESTIMATE,
}: {
  readonly estimate?: UsageEstimate | Promise<UsageEstimate>;
}) {
  return <Screen estimate={Promise.resolve(estimate)} />;
}

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

async function openEstimate() {
  const section = within(screen.getByTestId("usage-estimate"));
  fireEvent.click(section.getByText("Baht estimate"));
  await section.findByRole("link", { name: /Frankfurter/ });
  return section;
}

beforeEach(() => {
  // Keep the READY source fixtures fresh regardless of when CI runs. Individual
  // stale-source cases still supply their older timestamp and STALE status.
  vi.spyOn(Date, "now").mockReturnValue(LOADED);
  state.access = { status: "READY", permissions: ["aiUsage.read"] };
  state.summary = { ok: true, requestId: "q", value: report };
  state.summaryArgs = [];
  state.query.mockReset().mockResolvedValue(page([]));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AiUsageScreen access", () => {
  it("opens the report for a usage-only reader with the automatic estimate and no settings form", async () => {
    renderWithIntl(<AiUsageScreen estimate={estimateOf(33.5, 5.5)} />, {
      locale: "en",
    });
    expect(
      await screen.findByRole("button", { name: /Location label photos/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Recent activity" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Baht estimate" }),
    ).toBeInTheDocument();
    const details = screen
      .getByTestId("usage-estimate")
      .querySelector("details")!;
    const toggle = details.querySelector("summary")!;
    expect(details).not.toHaveAttribute("open");
    expect(
      within(details).queryByRole("link", { name: /Frankfurter/ }),
    ).toBeNull();
    fireEvent.click(toggle);
    const sourceLink = await within(details).findByRole("link", {
      name: /Frankfurter/,
    });
    expect(details).toHaveAttribute("open");
    expect(sourceLink).toBeVisible();
    fireEvent.click(toggle);
    await waitFor(() => expect(sourceLink).not.toBeInTheDocument());
    expect(details).not.toHaveAttribute("open");
    expect(screen.queryByText("Baht estimate settings")).toBeNull();
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(screen.queryByRole("button", { name: /Save/ })).toBeNull();
    await waitFor(() => expect(state.query).toHaveBeenCalled());
  });

  it("loads expanded details from the latest snapshot and skips closed content", async () => {
    const pending = deferred<UsageEstimate>();
    const view = renderWithIntl(<AiUsageScreen estimate={pending.promise} />, {
      locale: "en",
      preserveProviders: true,
    });
    await screen.findByText("Baht estimate");
    const section = await openEstimate();
    expect(section.getAllByText("Loading today's rate…")).toHaveLength(3);
    await act(async () => pending.resolve(estimateOf(33.5, 5.5)));
    expect(await section.findByText("33.5000")).toBeVisible();
    fireEvent.click(section.getByText("Baht estimate"));
    await waitFor(() => expect(section.queryByText("33.5000")).toBeNull());
    view.rerender(<AiUsageScreen estimate={estimateOf(40, 5)} />);
    await openEstimate();
    expect(await section.findByText("40.0000")).toBeVisible();
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

describe("AiUsageScreen statement and feature strip", () => {
  const withReport = (value: Record<string, unknown>) => {
    state.summary = {
      ok: true,
      requestId: "q",
      value: { ...report, ...value },
    };
  };
  const statement = () => screen.getByRole("region", { name: "Period total" });
  const entry = (kind: string) => screen.getByTestId(`usage-feature-${kind}`);
  const breakdown = () =>
    within(
      screen.getByRole("region", {
        name: "Usage breakdown (scrollable table)",
      }),
    );

  it("totals confirmed USD and estimates baht only from the automatic rate and published fee", async () => {
    withReport({
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
    renderWithIntl(<AiUsageScreen estimate={estimateOf(40, 5)} />, {
      locale: "en",
    });
    const total = within(statement());
    expect(total.getByText("US$1.50")).toBeInTheDocument();
    expect(total.getByText("All features, users and warehouses")).toBeVisible();
    // 1.5 USD × 40 = ฿60 inference; a 5% funding fee estimate adds ฿3.
    expect(await total.findByText("≈ ฿63.0000")).toBeInTheDocument();
    expect(total.getByText("≈ ฿60.0000")).toBeInTheDocument();
    expect(
      total.getByText(
        "Inference ฿60.0000 + funding fee estimate 5.00% ฿3.0000",
      ),
    ).toBeInTheDocument();
    const photos = within(entry("JOB_TICKET_SCAN"));
    // Retries add provider calls, never photos.
    expect(photos.getByText("2")).toBeInTheDocument();
    expect(photos.getByText(/3 calls · 1 retry · US\$1\.00/)).toBeVisible();
    // The average uses only fully priced operations: 0.4 USD, not 1.0 / 2.
    expect(
      photos.getByText(/Average per photo US\$0\.40 · 1 fully priced/),
    ).toBeVisible();
    expect(
      within(entry("AI_SEARCH")).getByText("No usage in this period."),
    ).toBeInTheDocument();
    const settings = await openEstimate();
    expect(settings.getByText("40.0000")).toBeInTheDocument();
    expect(settings.getByText("5.0%")).toBeInTheDocument();
    expect(
      settings.getByText(/Minimum US\$0\.80 per purchase/),
    ).toBeInTheDocument();
    expect(
      settings.getByText(/Reference rate for 2026-10-11/),
    ).toBeInTheDocument();
  });

  it("shows unavailable sources honestly and never substitutes a rate or zero fee", async () => {
    withReport({
      byFeature: {
        ...report.byFeature,
        JOB_TICKET_SCAN: metrics({
          operationCount: 1,
          attemptCount: 1,
          knownCostUsdNano: 1_000_000_000,
        }),
      },
    });
    const view = renderWithIntl(<AiUsageScreen />, { locale: "en" });
    const total = within(statement());
    expect(await total.findByText("THB rate unavailable")).toBeVisible();
    expect(total.getByText("Not estimated")).toBeVisible();
    expect(total.getByText("US$1.00012")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("฿");
    const sources = await openEstimate();
    expect(
      sources.getAllByText("Unavailable · not used in estimates"),
    ).toHaveLength(2);
    view.unmount();
    // A rate without a published fee estimates inference only.
    renderWithIntl(<AiUsageScreen estimate={estimateOf(30, null)} />, {
      locale: "en",
    });
    const partial = within(statement());
    // The baht equivalent stays; no total is claimed without the fee policy.
    expect(await partial.findAllByText("≈ ฿30.0036")).toHaveLength(1);
    expect(partial.getByText("Not estimated")).toBeVisible();
    expect(partial.getByText("Funding fee policy unavailable")).toBeVisible();
    expect(partial.queryByText(/funding fee estimate 0/)).toBeNull();
  });

  it("labels a source stale when its refresh window passed", async () => {
    const old = LOADED - 3 * 86_400_000;
    renderWithIntl(
      <AiUsageScreen
        estimate={{
          ...estimateOf(33.5, 5.5),
          fx: {
            status: "STALE",
            value: { rate: 33.5, date: "2026-10-08", fetchedAt: old },
          },
        }}
      />,
      { locale: "en" },
    );
    expect(
      await within(statement()).findByText("Rate or fee is out of date"),
    ).toBeVisible();
    expect(
      screen.getByTestId("usage-estimate").querySelector("details"),
    ).not.toHaveAttribute("open");
    await openEstimate();
    expect(await screen.findByText(/^Stale · checked/)).toBeInTheDocument();
    expect(screen.getByText(/Reference rate for 2026-10-08/)).toBeVisible();
  });

  it("keeps unknown cost distinct from a confirmed zero", async () => {
    withReport({
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
    renderWithIntl(<AiUsageScreen estimate={estimateOf(40, 5)} />, {
      locale: "en",
    });
    const photos = within(entry("JOB_TICKET_SCAN"));
    expect(photos.getByText("Not yet confirmed")).toBeInTheDocument();
    expect(photos.queryByText(/US\$0\.00/)).toBeNull();
    expect(
      photos.getByText("2 calls without confirmed cost"),
    ).toBeInTheDocument();
    expect(photos.getByText("1 operation pending")).toBeInTheDocument();
    expect(photos.getByText(/no fully priced operations yet/)).toBeVisible();
    expect(
      within(entry("AI_SEARCH")).getByText(/1 call · 0 retries · US\$0\.00/),
    ).toBeVisible();
    // The total is a lower bound and says so.
    const total = within(statement());
    expect(total.getByText("US$0.00")).toBeInTheDocument();
    expect(
      total.getByText("2 calls without confirmed cost"),
    ).toBeInTheDocument();
    expect(total.getByText("1 operation pending")).toBeInTheDocument();
    expect(await total.findAllByText("≈ ฿0.0000")).toHaveLength(2);
  });

  it.each([[null], [estimateOf(40, 5)]])(
    "shows an unknown-only breakdown without a numeric cost or baht estimate (%#)",
    async (estimate) => {
      withReport({
        breakdown: [
          {
            feature: "JOB_TICKET_SCAN",
            actorUserId: "user-a",
            requestedModel: "fixture-model",
            environment: "local",
            metrics: metrics({
              operationCount: 1,
              attemptCount: 1,
              unknownAttemptCount: 1,
              incompleteOperationCount: 1,
            }),
          },
        ],
      });
      renderWithIntl(<AiUsageScreen estimate={estimate ?? NO_ESTIMATE} />, {
        locale: "en",
      });
      await screen.findByTestId("usage-estimate");
      expect(breakdown().getByText("Not yet confirmed")).toBeInTheDocument();
      expect(
        breakdown().getByText("1 call without confirmed cost"),
      ).toBeInTheDocument();
      expect(breakdown().queryByText(/^US\$/)).toBeNull();
      expect(breakdown().queryByText(/฿/)).toBeNull();
    },
  );

  it.each([
    [1, 0, 0, "US$0.00", "≈ ฿0.0000"],
    [2, 1, 0, "US$0.00", "≈ ฿0.0000"],
    [2, 1, 200_000, "US$0.0002", "≈ ฿0.0080"],
  ])(
    "keeps reported zero and confirmed partial cost in the breakdown (%s calls, %s unknown)",
    async (attemptCount, unknownAttemptCount, knownCostUsdNano, usd, baht) => {
      withReport({
        breakdown: [
          {
            feature: "JOB_TICKET_SCAN",
            actorUserId: "user-a",
            requestedModel: "fixture-model",
            environment: "local",
            metrics: metrics({
              operationCount: 1,
              attemptCount,
              unknownAttemptCount,
              knownCostUsdNano,
            }),
          },
        ],
      });
      renderWithIntl(<AiUsageScreen estimate={estimateOf(40, 5)} />, {
        locale: "en",
      });
      expect(await breakdown().findByText(baht)).toBeInTheDocument();
      expect(breakdown().getByText(usd)).toBeInTheDocument();
      expect(breakdown().queryByText("Not yet confirmed")).toBeNull();
      const unknown = breakdown().queryByText("1 call without confirmed cost");
      if (unknownAttemptCount) expect(unknown).toBeInTheDocument();
      else expect(unknown).toBeNull();
    },
  );

  it("keeps column headers and an empty message in empty tables", async () => {
    renderWithIntl(<AiUsageScreen />, { locale: "en" });
    for (const name of ["User", "Warehouse", "Model", "Calls", "Cost (US$)"])
      expect(
        breakdown().getByRole("columnheader", { name }),
      ).toBeInTheDocument();
    expect(breakdown().getByText("No usage in this period.")).toBeVisible();
    const recent = within(
      screen.getByRole("region", {
        name: "Recent activity (scrollable table)",
      }),
    );
    expect(recent.getByRole("columnheader", { name: /Time/ })).toBeVisible();
    expect(recent.getByRole("columnheader", { name: "Action" })).toBeVisible();
    expect(
      await recent.findByText("No activity in this period."),
    ).toBeVisible();
  });

  it("filters by feature from the strip and the filter sheet", async () => {
    renderWithIntl(<AiUsageScreen />, { locale: "en" });
    expect(within(statement()).getByText("US$0.00012")).toBeInTheDocument();
    fireEvent.click(entry("AI_SEARCH"));
    expect(state.summaryArgs.at(-1)).toMatchObject({ feature: "AI_SEARCH" });
    expect(entry("AI_SEARCH")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("usage-feature-JOB_TICKET_SCAN")).toBeNull();
    expect(within(statement()).getByText("US$0.00")).toBeInTheDocument();
    expect(
      within(statement()).getByText("Filtered total · 1 filter"),
    ).toBeVisible();
    // Pressing the selected entry shows every feature again.
    fireEvent.click(entry("AI_SEARCH"));
    expect(state.summaryArgs.at(-1)).not.toHaveProperty("feature");
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    chooseOption("Feature", "Location label photos");
    fireEvent.click(
      await screen.findByRole("button", { name: "Show results" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: "Filters (1)" })).toBeVisible();
    expect(screen.getByText("Filtered by Location label photos")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(entry("JOB_TICKET_SCAN")).toBeInTheDocument();
  });

  it("places one export beside the breakdown heading and names its filtered scope", async () => {
    renderWithIntl(<AiUsageScreen estimate={estimateOf(10, 5.5)} />, {
      locale: "en",
    });
    const breakdown = screen.getByRole("region", { name: "Usage breakdown" });
    const button = within(breakdown).getByRole("button", {
      name: EXPORT_NAME,
    });
    expect(button).toHaveTextContent("Export");
    expect(screen.getAllByRole("button", { name: /^Export/ })).toEqual([
      button,
    ]);
    // The filter row keeps only period and filters.
    const filters = screen.getByRole("button", { name: "Filters" });
    expect(filters.parentElement).not.toContainElement(button);
    fireEvent.click(entry("AI_SEARCH"));
    expect(
      within(screen.getByRole("region", { name: "Usage breakdown" })).getByRole(
        "button",
        {
          name: "Export filtered CSV, 2026-10-01 – 2026-10-15 (Asia/Bangkok)",
        },
      ),
    ).toBeVisible();
  });

  it("keeps the incomplete-summary warning, tracking start, range and timezone visible", () => {
    withReport({
      complete: false,
      trackingStartedAt: Date.parse("2026-10-02T03:00:00Z"),
    });
    renderWithIntl(<AiUsageScreen />, { locale: "en" });
    expect(screen.getByText(/These totals are incomplete/)).toBeInTheDocument();
    expect(screen.getByText(/^Tracking began Oct 2, 2026/)).toBeInTheDocument();
    expect(screen.getByTestId("usage-range")).toHaveTextContent(
      "2026-10-01 – 2026-10-15·Asia/Bangkok",
    );
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
    // Export sits with the breakdown, so an unanswered report offers none.
    expect(screen.queryByRole("button", { name: /^Export/ })).toBeNull();
  });
});

const props = {
  signature: "s1",
  timezone: "Asia/Bangkok",
  featureLabel: (feature: string) => `label:${feature}`,
  usd: (nano: number) => `usd:${nano}`,
  thb: (nano: number) => `thb:${nano}`,
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
    expect(screen.getAllByText("usd:200000")).not.toHaveLength(0);
    expect(screen.getAllByText("thb:200000")).not.toHaveLength(0);
    // Attempt details expand per row.
    expect(screen.queryByText(/openai\/gpt-6-luna-2026/)).toBeNull();
    const [first] = screen.getAllByRole("button", {
      name: /Show call details/,
    });
    fireEvent.click(first!);
    expect(first).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("openai/gpt-6-luna-2026")).toBeVisible();
    expect(screen.getByText("Retries", { exact: false })).toBeVisible();
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
    // One table on every width: no duplicate row.
    expect(screen.getAllByText(/^Actor a/)).toHaveLength(1);
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
      await screen.findByText("ไม่มีกิจกรรมในช่วงนี้"),
    ).toBeInTheDocument();
  });
});

describe("AiUsageScreen CSV export lifecycle", () => {
  it("waits for the estimate snapshot before allowing export", async () => {
    let resolve!: (value: UsageEstimate) => void;
    const pending = new Promise<UsageEstimate>((done) => {
      resolve = done;
    });
    renderWithIntl(<AiUsageScreen estimate={pending} />, { locale: "en" });
    expect(screen.getByRole("button", { name: EXPORT_NAME })).toBeDisabled();
    expect(
      within(screen.getByRole("region", { name: "Period total" })).getByText(
        "Loading today's rate…",
      ),
    ).toBeVisible();
    await act(async () => resolve(estimateOf(33.5, 5.5)));
    expect(screen.getByRole("button", { name: EXPORT_NAME })).toBeEnabled();
  });

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

  it("downloads one CSV for the organization and estimate snapshot it started with", async () => {
    route({
      "aiUsage/reports:operations": async () => opsPage([exportOp("op-a")]),
      "aiUsage/reports:attempts": async () => ({
        ok: true,
        value: [exportAttempt],
      }),
    });
    renderWithIntl(<AiUsageScreen estimate={estimateOf(10, 5.5)} />, {
      locale: "en",
    });
    const button = await screen.findByRole("button", { name: EXPORT_NAME });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() =>
      expect(clicks).toEqual(["ai-usage-2026-10-01-2026-10-15.csv"]),
    );
    const csv = await blobs[0]!.text();
    expect(csv).toContain('"op-a"');
    expect(csv).toContain('"Name A"');
    expect(csv).toContain('"https://api.frankfurter.dev/v2/rate/usd/thb"');
    expect(csv).toContain('"2026-10-11"');
    expect(csv).toContain('"5.5"');
    expect(csv).toContain('"Asia/Bangkok"');
    expect(screen.getByRole("button", { name: EXPORT_NAME })).toBeEnabled();
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
      const button = await screen.findByRole("button", { name: EXPORT_NAME });
      await waitFor(() => expect(button).toBeEnabled());
      fireEvent.click(button);
      await waitFor(() => expect(exportCalls()).toContain(paused));
      // While busy the one trigger reports progress and cannot start again.
      const busy = screen.getByRole("button", { name: "Exporting…" });
      expect(busy).toBeDisabled();
      fireEvent.click(busy);
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
