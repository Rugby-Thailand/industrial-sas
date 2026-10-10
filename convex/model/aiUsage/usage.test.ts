import { describe, expect, it } from "vitest";
import {
  addMetrics,
  contribution,
  EMPTY_METRICS,
  projectOperation,
  readMetrics,
  replaceContribution,
  reportRange,
  summaryKey,
} from "./metrics";
import { readProviderUsage, UNKNOWN_USAGE } from "./usage";

const operation = {
  attemptCount: 2,
  knownCostUsdNano: 300_000,
  unknownAttemptCount: 0,
  status: "SUCCEEDED" as const,
  durationMs: 1_500,
};
const attempt = (overrides: Record<string, unknown> = {}) => ({
  attemptNo: 1,
  startedAt: 1_000,
  finishedAt: 2_000,
  status: "PROVIDER_ERROR",
  billingStatus: "REPORTED",
  costUsdNano: 100_000,
  ...overrides,
});

describe("validated provider usage record", () => {
  const reported = {
    providerGenerationId: "gen-a",
    actualModel: "openai/gpt-6-luna",
    unitKind: "MODEL_TOKEN",
    currency: "USD",
    inputUnitCount: 3886,
    costUsd: 0.000588675,
    costUsdNano: 588_675,
    billingStatus: "REPORTED",
    usageSource: "RESPONSE",
  };

  it("returns a frozen copy without touching its input", () => {
    const input = { ...reported, totalUnitCount: undefined };
    const result = readProviderUsage(input);
    expect(result).toEqual({
      ok: true,
      value: { ...reported },
    });
    expect(Object.isFrozen(result)).toBe(true);
    if (!result.ok) return;
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(result.value).not.toBe(input);
    expect("totalUnitCount" in input).toBe(true);
    expect("totalUnitCount" in result.value).toBe(false);
    // Explicit zero is a reported free call; no cost at all is UNKNOWN.
    expect(
      readProviderUsage({ ...reported, costUsd: 0, costUsdNano: 0 }).ok,
    ).toBe(true);
    expect(readProviderUsage(UNKNOWN_USAGE)).toEqual({
      ok: true,
      value: UNKNOWN_USAGE,
    });
    expect(Object.isFrozen(UNKNOWN_USAGE)).toBe(true);
  });

  it.each([
    ["a fractional nano amount", { costUsdNano: 0.5 }, "costUsdNano"],
    ["a negative nano amount", { costUsdNano: -1 }, "costUsdNano"],
    ["an unsafe nano amount", { costUsdNano: 2 ** 53 }, "costUsdNano"],
    ["a string nano amount", { costUsdNano: "588675" }, "costUsdNano"],
    ["a non-finite decimal", { costUsd: Infinity }, "costUsd"],
    ["a cost without nano", { costUsdNano: undefined }, "costUsdNano"],
    [
      "nano without a cost",
      { costUsd: undefined, billingStatus: "UNKNOWN" },
      "costUsdNano",
    ],
    ["a cost marked unknown", { billingStatus: "UNKNOWN" }, "billingStatus"],
    [
      "reported without a cost",
      { costUsd: undefined, costUsdNano: undefined },
      "billingStatus",
    ],
    ["a forged source", { usageSource: "BOGUS" }, "usageSource"],
    ["another currency", { currency: "THB" }, "currency"],
    ["another unit", { unitKind: "IMAGE" }, "unitKind"],
    ["a negative count", { inputUnitCount: -1 }, "inputUnitCount"],
    [
      "free text as an ID",
      { providerGenerationId: "a b" },
      "providerGenerationId",
    ],
    ["a non-boolean BYOK flag", { isByok: "no" }, "isByok"],
    ["a field outside the whitelist", { content: "secret" }, "content"],
  ])("refuses %s as a named field", (_label, change, field) => {
    expect(readProviderUsage({ ...reported, ...change })).toEqual({
      ok: false,
      error: { code: "AI_USAGE_VALUE_INVALID", field },
    });
  });

  it.each([null, 7, "usage", [], undefined])(
    "refuses a non-record %j",
    (value) => {
      expect(readProviderUsage(value)).toMatchObject({
        ok: false,
        error: { field: "usage" },
      });
    },
  );

  it("exposes no floating conversion from the domain", async () => {
    const domain = await import("./usage");
    expect(Object.keys(domain)).not.toContain("costToNano");
    expect(Object.keys(domain)).not.toContain("normalizeUsage");
  });
});

describe("metrics arithmetic", () => {
  it("adds exact nano-USD into a new frozen record without touching either operand", () => {
    const left = { ...EMPTY_METRICS, knownCostUsdNano: 1, operationCount: 1 };
    const right = contribution(operation);
    expect(right.ok).toBe(true);
    if (!right.ok) return;
    const sum = addMetrics(left, right.value);
    expect(sum).toMatchObject({
      ok: true,
      value: { knownCostUsdNano: 300_001, operationCount: 2 },
    });
    expect(left.knownCostUsdNano).toBe(1);
    expect(Object.isFrozen(sum)).toBe(true);
    if (sum.ok) expect(Object.isFrozen(sum.value)).toBe(true);
    expect(Object.isFrozen(EMPTY_METRICS)).toBe(true);
    // Integer accounting: many sub-cent costs add up exactly.
    let total = readMetrics(EMPTY_METRICS);
    for (let i = 0; i < 1_000 && total.ok; i++)
      total = addMetrics(total.value, {
        ...EMPTY_METRICS,
        knownCostUsdNano: 588_675,
      });
    expect(total.ok && total.value.knownCostUsdNano).toBe(588_675_000);
  });

  it.each([
    ["a missing field", { ...EMPTY_METRICS, attemptCount: undefined }],
    ["a negative count", { ...EMPTY_METRICS, operationCount: -1 }],
    ["a fractional cost", { ...EMPTY_METRICS, knownCostUsdNano: 0.5 }],
    ["NaN", { ...EMPTY_METRICS, totalDurationMs: NaN }],
    ["a string", { ...EMPTY_METRICS, successCount: "1" }],
    ["a non-object", 42],
  ])("refuses %s as a value instead of throwing", (_label, invalid) => {
    expect(addMetrics(EMPTY_METRICS, invalid)).toMatchObject({
      ok: false,
      error: { code: "AI_USAGE_AGGREGATE_INVALID" },
    });
    expect(readMetrics(invalid).ok).toBe(false);
  });

  it("refuses an overflowing total", () => {
    const huge = {
      ...EMPTY_METRICS,
      knownCostUsdNano: Number.MAX_SAFE_INTEGER,
    };
    expect(addMetrics(huge, huge)).toMatchObject({
      ok: false,
      error: { field: "knownCostUsdNano" },
    });
  });

  it("separates complete, pending and unknown-cost operations", () => {
    expect(contribution({ ...operation, status: "PENDING" })).toMatchObject({
      value: { pendingCount: 1, finishedOperationCount: 0, totalDurationMs: 0 },
    });
    expect(
      contribution({ ...operation, unknownAttemptCount: 1 }),
    ).toMatchObject({
      value: {
        completeOperationCount: 0,
        incompleteOperationCount: 1,
        completeCostUsdNano: 0,
        knownCostUsdNano: 300_000,
      },
    });
    for (const invalid of [
      { ...operation, status: "DONE" },
      { ...operation, attemptCount: 3 },
      { ...operation, unknownAttemptCount: 3 },
      { ...operation, knownCostUsdNano: -1 },
      null,
    ])
      expect(contribution(invalid).ok).toBe(false);
  });

  it("replaces an operation's contribution, allowing a lowered unknown count", () => {
    const pending = {
      ...operation,
      status: "PENDING" as const,
      unknownAttemptCount: 1,
    };
    const start = replaceContribution(null, null, pending);
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const done = replaceContribution(start.value, pending, operation);
    expect(done).toMatchObject({
      ok: true,
      value: {
        operationCount: 1,
        pendingCount: 0,
        unknownAttemptCount: 0,
        completeOperationCount: 1,
      },
    });
    const removed = done.ok
      ? replaceContribution(done.value, operation, null)
      : done;
    expect(removed).toMatchObject({ ok: true, value: EMPTY_METRICS });
    // Removing what was never added would go negative: refused.
    expect(replaceContribution(EMPTY_METRICS, operation, null).ok).toBe(false);
  });
});

describe("operation projection shared by live finalization and rebuild", () => {
  it("sums reported attempts and takes status and end from the last attempt", () => {
    const attempts = [
      attempt(),
      attempt({
        attemptNo: 2,
        startedAt: 2_100,
        finishedAt: 2_500,
        status: "SUCCEEDED",
        costUsdNano: 200_000,
      }),
    ];
    const before = JSON.stringify(attempts);
    expect(projectOperation(attempts)).toEqual({
      ok: true,
      value: {
        startedAt: 1_000,
        attemptCount: 2,
        status: "SUCCEEDED",
        knownCostUsdNano: 300_000,
        unknownAttemptCount: 0,
        durationMs: 1_500,
      },
    });
    expect(JSON.stringify(attempts)).toBe(before);
    const result = projectOperation(attempts);
    expect(Object.isFrozen(result.ok && result.value)).toBe(true);
  });

  it("counts unknown cost and gives a pending operation no duration", () => {
    expect(
      projectOperation([
        attempt({
          status: "PENDING",
          billingStatus: "UNKNOWN",
          costUsdNano: undefined,
          finishedAt: undefined,
        }),
      ]),
    ).toMatchObject({
      ok: true,
      value: { status: "PENDING", unknownAttemptCount: 1, durationMs: 0 },
    });
  });

  it.each([
    ["no attempts", []],
    [
      "three attempts",
      [attempt(), attempt({ attemptNo: 2 }), attempt({ attemptNo: 3 })],
    ],
    ["a gap in attempt numbers", [attempt({ attemptNo: 2 })]],
    ["a reported attempt without cost", [attempt({ costUsdNano: undefined })]],
    ["an unknown attempt with a cost", [attempt({ billingStatus: "UNKNOWN" })]],
    ["an unknown status", [attempt({ status: "OK" })]],
    ["a non-array", { length: 1 }],
  ])("refuses %s as a ledger error", (_label, attempts) => {
    expect(projectOperation(attempts)).toMatchObject({
      ok: false,
      error: { code: "AI_USAGE_LEDGER_INVALID" },
    });
  });

  it("keeps the stored summary key format and validates its dimensions", () => {
    const dimensions = {
      utcDay: 20_000,
      feature: "LOCATION_LABEL_SCAN",
      environment: "local",
      actorUserId: "user1",
      requestedModel: "openai/gpt-6-luna",
    };
    expect(summaryKey(dimensions)).toEqual({
      ok: true,
      value:
        '[20000,"LOCATION_LABEL_SCAN","local","user1","","openai/gpt-6-luna"]',
    });
    expect(summaryKey({ ...dimensions, warehouseId: "w1" })).toMatchObject({
      value:
        '[20000,"LOCATION_LABEL_SCAN","local","user1","w1","openai/gpt-6-luna"]',
    });
    for (const invalid of [
      { ...dimensions, feature: "OCR" },
      { ...dimensions, utcDay: 1.5 },
      { ...dimensions, actorUserId: "" },
      { ...dimensions, warehouseId: 7 },
      undefined,
    ])
      expect(summaryKey(invalid).ok).toBe(false);
  });
});

describe("report range", () => {
  it("starts this month in Bangkok, independent of the browser timezone", () => {
    const r = reportRange(
      "Asia/Bangkok",
      Date.parse("2026-09-30T17:01:00Z"),
      {},
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.from).toBe("2026-10-01");
    expect(r.value.to).toBe("2026-10-01");
    expect(new Date(r.value.start).toISOString()).toBe(
      "2026-09-30T17:00:00.000Z",
    );
    expect(new Date(r.value.end).toISOString()).toBe(
      "2026-10-01T17:00:00.000Z",
    );
    expect(r.value.utcDays).toHaveLength(2);
    expect(Object.isFrozen(r.value)).toBe(true);
    expect(Object.isFrozen(r.value.utcDays)).toBe(true);
  });

  it.each([
    [
      "an impossible date",
      "Asia/Bangkok",
      0,
      { from: "2026-02-30", to: "2026-03-01" },
      "DATE_RANGE_INVALID",
    ],
    [
      "a reversed range",
      "Asia/Bangkok",
      0,
      { from: "2026-03-02", to: "2026-03-01" },
      "DATE_RANGE_INVALID",
    ],
    [
      "more than 93 days",
      "Asia/Bangkok",
      0,
      { from: "2026-01-01", to: "2026-04-04" },
      "DATE_RANGE_INVALID",
    ],
    [
      "an unknown period",
      "Asia/Bangkok",
      0,
      { period: "year" },
      "DATE_RANGE_INVALID",
    ],
    [
      "a non-string date",
      "Asia/Bangkok",
      0,
      { from: 20260101 },
      "DATE_RANGE_INVALID",
    ],
    ["a non-integer clock", "Asia/Bangkok", NaN, {}, "DATE_RANGE_INVALID"],
    ["a missing input", "Asia/Bangkok", 0, null, "DATE_RANGE_INVALID"],
    [
      "a daylight-saving zone",
      "America/New_York",
      0,
      {},
      "TIMEZONE_UNSUPPORTED",
    ],
    ["a non-string zone", 7, 0, {}, "TIMEZONE_UNSUPPORTED"],
  ])("refuses %s as a value", (_label, timezone, now, input, code) => {
    expect(reportRange(timezone, now, input)).toMatchObject({
      ok: false,
      error: { code },
    });
  });
});
