import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { getTestMutation } from "@tests/fixtures/convex-mutation";
import { renderWithIntl } from "@tests/fixtures/intl-render";

// This summary mock answers every argument set at once. The real-hook refresh
// regression also covers Convex returning undefined while new arguments load.
const state = vi.hoisted(() => ({
  summary: undefined as unknown,
  query: vi.fn(),
  client: null as unknown,
}));
state.client = { query: (...args: unknown[]) => state.query(...args) };

vi.mock("convex/react", async () => {
  const { getFunctionName: name } = await import("convex/server");
  return {
    useQuery: (reference: Parameters<typeof name>[0], args: unknown) => {
      if (args === "skip") return undefined;
      if (name(reference) !== "aiUsage/reports:summary") return undefined;
      return state.summary;
    },
    useMutation: getTestMutation,
    useConvex: () => state.client,
  };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/components/providers/AiUsageAccessProvider", () => ({
  useAiUsageAccess: () => ({ status: "READY", permissions: ["aiUsage.read"] }),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: unknown }) => (
    <a href={href}>{children as never}</a>
  ),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/ai-usage",
}));

import { AiUsageScreen } from "./AiUsageScreen";

const LOADED = Date.parse("2026-10-11T07:00:00Z");
const metrics = () => ({
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
    JOB_TICKET_SCAN: { ...metrics(), operationCount: 2, attemptCount: 2 },
    LOCATION_LABEL_SCAN: metrics(),
    AI_SEARCH: metrics(),
  },
  breakdown: [],
  models: [],
  environments: [],
  users: [],
  warehouses: [],
  trackingStartedAt: null,
};
const item = (id: string) => ({
  operationId: id,
  startedAt: Date.parse("2026-10-11T05:00:00Z"),
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
});
const page = (items: unknown[], continueCursor: string | null = null) => ({
  ok: true,
  requestId: "q",
  value: { timezone: "Asia/Bangkok", items, continueCursor },
});

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(LOADED);
  state.summary = { ok: true, requestId: "q", value: report };
  state.query
    .mockReset()
    .mockImplementation(async (_ref: unknown, args: { cursor?: string }) =>
      args.cursor ? page([item("b")]) : page([item("a")], "cursor-1"),
    );
});
afterEach(() => vi.restoreAllMocks());

it("keeps recent pages already read when only the half-hour clock ticks (no new activity)", async () => {
  const estimate = Promise.resolve({
    version: 1 as const,
    loadedAt: LOADED,
    fx: { status: "UNAVAILABLE" as const },
    funding: { status: "UNAVAILABLE" as const },
  });
  renderWithIntl(<AiUsageScreen estimate={estimate} />, { locale: "en" });
  fireEvent.click(await screen.findByRole("button", { name: "Show more" }));
  expect(await screen.findAllByText("Actor b")).not.toHaveLength(0);
  const callsBefore = state.query.mock.calls.length;

  // 30 minutes later, same summary (identical byFeature => no newer activity).
  vi.mocked(Date.now).mockReturnValue(LOADED + 30 * 60 * 1000);
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  await act(async () => {});

  // The rows already read must not be silently replaced by a refetch.
  expect({
    refetches: state.query.mock.calls.length - callsBefore,
    actorBRows: screen.queryAllByText("Actor b").length > 0 ? 1 : 0,
  }).toEqual({ refetches: 0, actorBRows: 1 });
});
