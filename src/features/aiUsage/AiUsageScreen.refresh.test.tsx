import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { renderWithIntl } from "@tests/fixtures/intl-render";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import type * as ConvexReact from "convex/react";
import { getFunctionName } from "convex/server";
import { reportRange } from "../../../convex/model/aiUsage/metrics";

// Keep Convex's actual hooks, observer, and subscription implementation.
// Only the transport-facing watch/query methods below are controlled.
vi.mock("convex/react", async (importOriginal) =>
  importOriginal<typeof ConvexReact>(),
);
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
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

afterEach(() => vi.restoreAllMocks());

it("preserves pagination and expanded details through an unchanged-range clock refresh with real Convex hooks", async () => {
  vi.spyOn(Date, "now").mockReturnValue(LOADED);
  refresh.mockReset();
  const oldRange = reportRange("Asia/Bangkok", LOADED, { period: "month" });
  expect(oldRange.ok).toBe(true);
  if (!oldRange.ok) throw new Error("Invalid fixture range");
  const summary = {
    ok: true,
    requestId: "q",
    value: {
      ...report,
      range: oldRange.value,
      byFeature: {
        ...report.byFeature,
        JOB_TICKET_SCAN: {
          ...metrics(),
          operationCount: 26,
          attemptCount: 26,
          successCount: 26,
          completeOperationCount: 26,
          knownCostUsdNano: 5_200_000,
          completeCostUsdNano: 5_200_000,
          totalDurationMs: 26_000,
          finishedOperationCount: 26,
        },
      },
    },
  };
  const initialKey = Math.floor(LOADED / 1_800_000);
  const answers = new Map<number, unknown>([[initialKey, summary]]);
  const listeners = new Set<() => void>();
  const client = new ConvexReactClient("https://example.convex.cloud");
  vi.spyOn(client, "watchQuery").mockImplementation((...parameters) => {
    const [reference, args] = parameters;
    return {
      onUpdate: (callback) => {
        listeners.add(callback);
        return () => {
          listeners.delete(callback);
        };
      },
      localQueryResult: () =>
        getFunctionName(reference) === "aiUsage/reports:summary"
          ? answers.get(args?.refreshKey as number)
          : undefined,
      localQueryLogs: () => undefined,
      journal: () => undefined,
    };
  });
  const query = vi
    .spyOn(client, "query")
    .mockImplementation(async (reference, args = {}) => {
      expect(getFunctionName(reference)).toBe("aiUsage/reports:recent");
      return args?.cursor
        ? page([item("b")])
        : page(
            Array.from({ length: 25 }, (_, i) => item(`a${i}`)),
            "cursor-1",
          );
    });
  // Fresh successful sources avoid an unrelated Next.js server refresh.
  const estimate = Promise.resolve({
    version: 1 as const,
    loadedAt: LOADED,
    fx: {
      status: "READY" as const,
      value: { rate: 33.5, date: "2026-10-11", fetchedAt: LOADED },
    },
    funding: {
      status: "READY" as const,
      value: { percent: 5.5, minimumUsd: 0.8, fetchedAt: LOADED },
    },
  });
  const view = renderWithIntl(
    <ConvexProvider client={client}>
      <AiUsageScreen estimate={estimate} />
    </ConvexProvider>,
    { locale: "en" },
  );
  fireEvent.click(await screen.findByRole("button", { name: "Show more" }));
  expect(await screen.findByText("Actor b")).toBeVisible();
  fireEvent.click(
    screen.getAllByRole("button", { name: /Show call details/ })[0]!,
  );
  expect(screen.getAllByRole("button", { expanded: true })).toHaveLength(1);
  const callsBefore = query.mock.calls.length;
  // Negative control: refocusing within the same half-hour retains everything.
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(query).toHaveBeenCalledTimes(callsBefore);
  expect(screen.getByText("Actor b")).toBeVisible();
  expect(screen.getAllByRole("button", { expanded: true })).toHaveLength(1);

  vi.mocked(Date.now).mockReturnValue(LOADED + 1_800_000);
  expect(reportRange("Asia/Bangkok", Date.now(), { period: "month" })).toEqual(
    oldRange,
  );
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  const pendingReportDisappeared = screen.queryByText("Actor a0") === null;
  // Resolve the new summary subscription with exactly the original data.
  await act(async () => {
    answers.set(initialKey + 1, summary);
    for (const callback of listeners) callback();
  });
  await screen.findByText("Actor a0");
  expect(refresh).not.toHaveBeenCalled();
  const actual = {
    pendingReportDisappeared,
    recentRefetches: query.mock.calls.length - callsBefore,
    actorBRows: screen.queryAllByText("Actor b").length,
    expandedRows: screen.queryAllByRole("button", { expanded: true }).length,
  };
  view.unmount();
  await client.close();
  expect(actual).toEqual({
    pendingReportDisappeared: false,
    recentRefetches: 0,
    actorBRows: 1,
    expandedRows: 1,
  });
});
