/**
 * Illustrative sample data for the AI usage visual fixture. Synthetic names
 * and amounts only; nothing here is production or tenant data. Selected by
 * the `data` URL parameter: `empty` (default, matches the reference images)
 * or `usage`.
 */
import { HR_CODES } from "@/lib/navigation";

const params = new URLSearchParams(window.location.search);
export const FIXTURE = Object.freeze({
  data: params.get("data") === "usage" ? "usage" : "empty",
  estimate:
    (["ready", "stale", "unavailable", "loading"] as const).find(
      (value) => value === params.get("estimate"),
    ) ?? ("ready" as const),
  workspace: params.get("workspace") === "none" ? "none" : "ready",
  hr: params.get("hr") === "ready" ? "ready" : "none",
});

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

const usage = FIXTURE.data === "usage";
const users = [
  { id: "user-fixture-a", name: "Somchai P." },
  { id: "user-fixture-b", name: "Nicha K." },
];
const warehouses = [
  { id: "wh-fixture-1", code: "TG-OPT", name: "Top Gold Optimized Warehouse" },
  { id: "wh-fixture-2", code: "TG-B2", name: "Bangna Overflow Store" },
];

const summary = {
  range: {
    from: "2026-10-01",
    to: "2026-10-11",
    start: Date.parse("2026-09-30T17:00:00Z"),
    end: Date.parse("2026-10-11T17:00:00Z"),
    utcDays: [20361],
    timezone: "Asia/Bangkok",
  },
  complete: true,
  byFeature: usage
    ? {
        JOB_TICKET_SCAN: metrics({
          operationCount: 14,
          attemptCount: 16,
          successCount: 13,
          knownCostUsdNano: 10_781_400,
          completeOperationCount: 13,
          completeCostUsdNano: 10_011_300,
          totalDurationMs: 112_000,
          finishedOperationCount: 14,
        }),
        LOCATION_LABEL_SCAN: metrics({
          operationCount: 6,
          attemptCount: 6,
          successCount: 6,
          knownCostUsdNano: 3_120_000,
          completeOperationCount: 6,
          completeCostUsdNano: 3_120_000,
          totalDurationMs: 31_000,
          finishedOperationCount: 6,
        }),
        AI_SEARCH: metrics({
          operationCount: 23,
          attemptCount: 24,
          successCount: 22,
          knownCostUsdNano: 1_334_000,
          unknownAttemptCount: 1,
          incompleteOperationCount: 1,
          completeOperationCount: 22,
          completeCostUsdNano: 1_276_000,
          totalDurationMs: 46_000,
          finishedOperationCount: 23,
        }),
      }
    : {
        JOB_TICKET_SCAN: metrics(),
        LOCATION_LABEL_SCAN: metrics(),
        AI_SEARCH: metrics(),
      },
  models: usage ? ["openai/gpt-6-luna", "openai/gpt-6-luna-mini"] : [],
  environments: usage ? ["fixture"] : [],
  breakdown: usage
    ? [
        {
          feature: "JOB_TICKET_SCAN",
          actorUserId: users[0]!.id,
          warehouseId: warehouses[0]!.id,
          requestedModel: "openai/gpt-6-luna",
          environment: "fixture",
          metrics: metrics({
            operationCount: 14,
            attemptCount: 16,
            successCount: 13,
            knownCostUsdNano: 10_781_400,
            totalDurationMs: 112_000,
            finishedOperationCount: 14,
          }),
        },
        {
          feature: "LOCATION_LABEL_SCAN",
          actorUserId: users[1]!.id,
          warehouseId: warehouses[1]!.id,
          requestedModel: "openai/gpt-6-luna",
          environment: "fixture",
          metrics: metrics({
            operationCount: 6,
            attemptCount: 6,
            successCount: 6,
            knownCostUsdNano: 3_120_000,
            totalDurationMs: 31_000,
            finishedOperationCount: 6,
          }),
        },
        {
          feature: "AI_SEARCH",
          actorUserId: users[0]!.id,
          requestedModel: "openai/gpt-6-luna-mini",
          environment: "fixture",
          metrics: metrics({
            operationCount: 23,
            attemptCount: 24,
            successCount: 22,
            knownCostUsdNano: 1_334_000,
            unknownAttemptCount: 1,
            totalDurationMs: 46_000,
            finishedOperationCount: 23,
          }),
        },
      ]
    : [],
  trackingStartedAt: usage ? Date.parse("2026-10-01T02:00:00Z") : null,
  users: usage ? users : [],
  warehouses: usage ? warehouses : [],
};

const item = (
  index: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  operationId: `fixture-op-${index}`,
  startedAt: Date.parse("2026-10-11T06:40:00Z") - index * 47 * 60_000,
  feature: ["JOB_TICKET_SCAN", "AI_SEARCH", "LOCATION_LABEL_SCAN"][index % 3],
  environment: "fixture",
  actorUserId: users[index % 2]!.id,
  actorName: users[index % 2]!.name,
  warehouseId: index % 3 === 1 ? null : warehouses[index % 2]!.id,
  warehouseName: index % 3 === 1 ? null : warehouses[index % 2]!.name,
  requestedModel:
    index % 3 === 1 ? "openai/gpt-6-luna-mini" : "openai/gpt-6-luna",
  actualModels: ["openai/gpt-6-luna-2026-09"],
  status: "SUCCEEDED",
  attemptCount: 1,
  knownCostUsdNano: index % 3 === 1 ? 58_000 : 770_100,
  unknownAttemptCount: 0,
  durationMs: 4_200,
  ...overrides,
});
const recentItems = usage
  ? [
      item(0, {
        status: "PENDING",
        unknownAttemptCount: 1,
        knownCostUsdNano: 0,
      }),
      item(1),
      item(2, { attemptCount: 2, knownCostUsdNano: 1_540_200 }),
      item(3),
      item(4, {
        status: "UNREADABLE",
        unknownAttemptCount: 1,
        knownCostUsdNano: 0,
      }),
      item(5),
    ]
  : [];

const ok = <T>(value: T) => ({
  ok: true as const,
  requestId: "fixture",
  value,
});

const responses: Record<string, (args: unknown) => unknown> = {
  "workspace/current:readCurrent": () =>
    FIXTURE.workspace === "none"
      ? { ok: false, requestId: "fixture", denial: {} }
      : ok({
          organization: { id: "org-fixture", name: "Top Gold Industrial" },
          warehouses,
          navigationPermissions: [
            "masterData.storageLayout.read",
            "aiUsage.read",
          ],
          complete: true,
        }),
  "hr/access:current": () =>
    FIXTURE.hr === "ready"
      ? ok({
          organizationId: "org-fixture",
          actorUserId: "user-fixture-a",
          organizationName: "Top Gold Industrial",
          permissions: Object.values(HR_CODES),
          timezone: "Asia/Bangkok",
          timezoneSupported: true,
          today: "2026-10-13",
          employee: {
            id: "employee-fixture-a",
            code: "EMP-FIXTURE-1",
            displayName: "Fixture Employee",
          },
          sites: warehouses,
          sitesComplete: true,
        })
      : { ok: false, requestId: "fixture", denial: {} },
  "aiUsage/reports:access": () =>
    ok({
      permissions: ["aiUsage.read"],
      organizationName: "Top Gold Industrial",
      timezone: "Asia/Bangkok",
    }),
  "aiUsage/reports:summary": () => ok(summary),
  "aiUsage/reports:recent": () =>
    ok({ timezone: "Asia/Bangkok", items: recentItems, continueCursor: null }),
  "aiUsage/reports:operations": () =>
    ok({ page: [], isDone: true, continueCursor: "" }),
  "aiUsage/reports:attempts": () => ok([]),
};

/** The fixture's answer to one query; unknown queries are refused. */
export function answer(name: string, args: unknown) {
  const respond = responses[name];
  return respond
    ? respond(args)
    : { ok: false, requestId: "fixture", denial: {} };
}
