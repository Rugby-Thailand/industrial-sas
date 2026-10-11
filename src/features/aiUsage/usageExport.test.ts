import { describe, expect, it, vi } from "vitest";

import {
  exportUsage,
  usageExportScope,
  type UsageExportSource,
} from "./usageExport";

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const NOW = Date.parse("2026-10-11T07:00:00Z");
const estimateOf = (rate: number, percent: number | null = 0) => ({
  version: 1 as const,
  loadedAt: NOW,
  fx: {
    status: "READY" as const,
    value: { rate, date: "2026-10-11", fetchedAt: NOW },
  },
  funding:
    percent === null
      ? { status: "UNAVAILABLE" as const }
      : {
          status: "READY" as const,
          value: { percent, minimumUsd: 0.8, fetchedAt: NOW },
        },
});
const reportOf = (org: string, utcDays: number[]) => ({
  range: {
    from: "2026-10-01",
    to: "2026-10-02",
    start: 0,
    end: 0,
    utcDays,
    timezone: "Asia/Bangkok",
  },
  users: [{ id: `user-${org}`, name: `Name ${org}` }],
});
const op = (id: string, org: string) => ({
  operationId: id,
  feature: "JOB_TICKET_SCAN",
  environment: "local",
  actorUserId: `user-${org}`,
  requestedModel: "openai/gpt-6-luna",
  startedAt: Date.parse("2026-10-01T05:00:00Z"),
  status: "SUCCEEDED",
  attemptCount: 1,
});
const attemptOf = (nano: number) => ({
  attemptNo: 1,
  startedAt: Date.parse("2026-10-01T05:00:00Z"),
  status: "SUCCEEDED",
  provider: "OPENROUTER",
  billingAccountRef: "default",
  billingStatus: "REPORTED",
  usageSource: "RESPONSE",
  costUsdNano: nano,
  durationMs: 1,
});
const pageOf = (rows: unknown[], continueCursor: string | null = null) => ({
  ok: true,
  value: {
    page: rows,
    isDone: continueCursor === null,
    continueCursor: continueCursor ?? "",
  },
});

type Reply = () => Promise<unknown>;
/** A source answering queued replies in order; the test controls each one. */
function scripted(operations: Reply[], attempts: Reply[]) {
  const calls: { kind: string; args: unknown }[] = [];
  const source = {
    operations: vi.fn((args: unknown) => {
      calls.push({ kind: "operations", args });
      const next = operations.shift();
      return next ? next() : Promise.reject(new Error("unexpected"));
    }),
    attempts: vi.fn((args: unknown) => {
      calls.push({ kind: "attempts", args });
      const next = attempts.shift();
      return next ? next() : Promise.reject(new Error("unexpected"));
    }),
  };
  return { source: source as unknown as UsageExportSource, calls };
}

describe("usage CSV export", () => {
  it("builds one single-scope CSV across pages and days with the frozen settings", async () => {
    const report = reportOf("A", [20362, 20363]);
    const filter = { feature: "JOB_TICKET_SCAN" as const };
    const estimate = estimateOf(10);
    const scope = usageExportScope(report, filter, estimate);
    // A later render cannot change the running export.
    report.users[0]!.name = "Renamed";
    estimate.fx.value.rate = 99;
    filter.feature = "AI_SEARCH" as never;
    expect(Object.isFrozen(scope)).toBe(true);
    expect(Object.isFrozen(scope.filter)).toBe(true);
    expect(Object.isFrozen(scope.estimate)).toBe(true);
    expect(
      scope.estimate?.fx.status !== "UNAVAILABLE" && scope.estimate?.fx.value,
    ).toMatchObject({ rate: 10 });
    expect(Object.isFrozen(scope.users[0])).toBe(true);
    const { source, calls } = scripted(
      [
        async () => pageOf([op("a1", "A")], "cursor-1"),
        async () => pageOf([op("a2", "A")]),
        async () => pageOf([op("a3", "A")]),
      ],
      [
        async () => ({ ok: true, value: [attemptOf(1_000_000_000)] }),
        async () => ({ ok: true, value: [attemptOf(2_000_000_000)] }),
        async () => ({ ok: true, value: [attemptOf(500_000_000)] }),
      ],
    );
    const result = await exportUsage(source, scope, () => true);
    expect(result.kind).toBe("READY");
    if (result.kind !== "READY") return;
    expect(result.fileName).toBe("ai-usage-2026-10-01-2026-10-02.csv");
    const lines = result.csv.replace(/^\ufeff/, "").split("\r\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/^"operation_id","feature"/);
    for (const [line, id, thb] of [
      [lines[1], "a1", "10"],
      [lines[2], "a2", "20"],
      [lines[3], "a3", "5"],
    ] as const) {
      expect(line).toContain(`"${id}"`);
      expect(line).toContain('"Name A"');
      expect(line).toContain('"https://api.frankfurter.dev/v2/rate/usd/thb"');
      expect(line).toContain('"2026-10-11"');
      expect(line).toContain(`"${thb}"`);
      expect(line).not.toContain("Renamed");
    }
    expect(
      calls.filter((c) => c.kind === "operations").map((c) => c.args),
    ).toEqual([
      {
        utcDay: 20362,
        from: "2026-10-01",
        to: "2026-10-02",
        feature: "JOB_TICKET_SCAN",
      },
      {
        utcDay: 20362,
        from: "2026-10-01",
        to: "2026-10-02",
        feature: "JOB_TICKET_SCAN",
        cursor: "cursor-1",
      },
      {
        utcDay: 20363,
        from: "2026-10-01",
        to: "2026-10-02",
        feature: "JOB_TICKET_SCAN",
      },
    ]);
  });

  it("records the snapshot's sources, dates and statuses, never a zero fee", async () => {
    const header = (csv: string) =>
      csv
        .replace(/^\ufeff/, "")
        .split("\r\n")[0]!
        .split(",");
    const row = async (estimate: ReturnType<typeof estimateOf> | null) => {
      const { source } = scripted(
        [async () => pageOf([op("a1", "A")])],
        [async () => ({ ok: true, value: [attemptOf(1_000_000_000)] })],
      );
      const result = await exportUsage(
        source,
        usageExportScope(reportOf("A", [20362]), {}, estimate),
        () => true,
      );
      if (result.kind !== "READY") throw new Error(result.kind);
      const names = header(result.csv);
      const values = result.csv.split("\r\n")[1]!.split(",");
      return (name: string) =>
        JSON.parse(values[names.indexOf(`"${name}"`)]!) as string;
    };
    const ready = await row(estimateOf(33.5, 5.5));
    expect(ready("usd_thb_rate")).toBe("33.5");
    expect(ready("usd_thb_status")).toBe("READY");
    expect(ready("usd_thb_rate_date")).toBe("2026-10-11");
    expect(ready("funding_fee_percent_estimate")).toBe("5.5");
    expect(ready("funding_fee_minimum_usd")).toBe("0.8");
    expect(ready("funding_fee_source")).toBe(
      "https://openrouter.ai/docs/faq.md",
    );
    expect(ready("estimate_loaded_at")).toBe("2026-10-11T07:00:00.000Z");
    expect(Number(ready("estimated_thb"))).toBeCloseTo(33.5, 9);
    expect(Number(ready("estimated_total_thb"))).toBeCloseTo(35.3425, 9);
    const noFee = await row(estimateOf(33.5, null));
    expect(noFee("funding_fee_status")).toBe("UNAVAILABLE");
    expect(noFee("funding_fee_percent_estimate")).toBe("");
    expect(noFee("estimated_funding_fee_thb")).toBe("");
    expect(noFee("estimated_total_thb")).toBe("");
    expect(Number(noFee("estimated_thb"))).toBeCloseTo(33.5, 9);
    const none = await row(null);
    expect(none("usd_thb_status")).toBe("UNAVAILABLE");
    expect(none("usd_thb_rate")).toBe("");
    expect(none("estimated_thb")).toBe("");
    expect(none("cost_usd_nano")).toBe("1000000000");
  });

  it.each([false, true])(
    "preserves the snapshot when no attempts exist (operations: %s)",
    async (hasOperation) => {
      const estimate = estimateOf(33.5, null);
      const scope = usageExportScope(reportOf("A", [20362]), {}, estimate);
      estimate.fx.value.rate = 99;
      const { source } = scripted(
        [async () => pageOf(hasOperation ? [op("a1", "A")] : [])],
        hasOperation ? [async () => ({ ok: true, value: [] })] : [],
      );
      const result = await exportUsage(source, scope, () => true);
      if (result.kind !== "READY") throw new Error(result.kind);
      const lines = result.csv.replace(/^\ufeff/, "").split("\r\n");
      expect(lines).toHaveLength(2);
      const headers = lines[0]!
        .split(",")
        .map((cell) => JSON.parse(cell) as string);
      const values = lines[1]!
        .split(",")
        .map((cell) => JSON.parse(cell) as string);
      expect(values).toHaveLength(headers.length);
      const value = (key: string) => values[headers.indexOf(key)];
      expect(value("record_type")).toBe("ESTIMATE_SNAPSHOT");
      expect(value("timezone")).toBe("Asia/Bangkok");
      expect(value("estimate_cache_version")).toBe("1");
      expect(value("estimate_loaded_at")).toBe("2026-10-11T07:00:00.000Z");
      expect(value("usd_thb_rate")).toBe("33.5");
      expect(value("usd_thb_status")).toBe("READY");
      expect(value("funding_fee_status")).toBe("UNAVAILABLE");
      for (const key of [
        "operation_id",
        "attempt_count",
        "cost_usd_nano",
        "estimated_thb",
        "estimated_total_thb",
        "funding_fee_percent_estimate",
      ]) {
        expect(value(key)).toBe("");
      }
    },
  );

  it.each([
    ["between pages of one day", [20362], "cursor-1"],
    ["between days", [20362, 20363], null],
  ] as const)(
    "stops %s when the report unmounts, without another query or file",
    async (_label, utcDays, cursor) => {
      let current = true;
      const firstAttempts = deferred<unknown>();
      const { source, calls } = scripted(
        [
          async () => pageOf([op("a1", "A")], cursor),
          // Organization B would answer this one; it must never be asked.
          async () => pageOf([op("b1", "B")]),
        ],
        [
          () => firstAttempts.promise,
          async () => ({ ok: true, value: [attemptOf(1)] }),
        ],
      );
      const running = exportUsage(
        source,
        usageExportScope(reportOf("A", [...utcDays]), {}, estimateOf(10)),
        () => current,
      );
      await vi.waitFor(() => expect(calls).toHaveLength(2));
      current = false; // organization switch unmounts the report
      firstAttempts.resolve({ ok: true, value: [attemptOf(1)] });
      expect(await running).toEqual({ kind: "CANCELLED" });
      expect(calls.map((c) => c.kind)).toEqual(["operations", "attempts"]);
    },
  );

  it("stops between an operation page and its attempts", async () => {
    let current = true;
    const firstPage = deferred<unknown>();
    const { source, calls } = scripted(
      [() => firstPage.promise],
      [async () => ({ ok: true, value: [] })],
    );
    const running = exportUsage(
      source,
      usageExportScope(reportOf("A", [20362]), {}, estimateOf(10)),
      () => current,
    );
    current = false;
    firstPage.resolve(pageOf([op("a1", "A"), op("a2", "A")]));
    expect(await running).toEqual({ kind: "CANCELLED" });
    // No attempts query as the new organization, so no silently empty rows.
    expect(calls.map((c) => c.kind)).toEqual(["operations"]);
  });

  it("stops between two operation rows' attempts", async () => {
    let current = true;
    const { source, calls } = scripted(
      [async () => pageOf([op("a1", "A"), op("a2", "A")])],
      [
        async () => {
          current = false;
          return { ok: true, value: [attemptOf(1)] };
        },
        async () => ({ ok: true, value: [] }),
      ],
    );
    const result = await exportUsage(
      source,
      usageExportScope(reportOf("A", [20362]), {}, estimateOf(10)),
      () => current,
    );
    expect(result).toEqual({ kind: "CANCELLED" });
    expect(calls.map((c) => c.kind)).toEqual(["operations", "attempts"]);
  });

  it("treats a rejection after unmount as cancelled and before it as failed", async () => {
    let current = true;
    const late = deferred<unknown>();
    const cancelled = exportUsage(
      scripted([() => late.promise], []).source,
      usageExportScope(reportOf("A", [20362]), {}, estimateOf(10)),
      () => current,
    );
    current = false;
    late.reject(new Error("unauthenticated"));
    expect(await cancelled).toEqual({ kind: "CANCELLED" });
    expect(
      await exportUsage(
        scripted([async () => Promise.reject(new Error("offline"))], []).source,
        usageExportScope(reportOf("A", [20362]), {}, estimateOf(10)),
        () => true,
      ),
    ).toEqual({ kind: "FAILED", reason: "ERROR" });
    expect(
      await exportUsage(
        scripted([async () => ({ ok: false })], []).source,
        usageExportScope(reportOf("A", [20362]), {}, estimateOf(10)),
        () => true,
      ),
    ).toEqual({ kind: "FAILED", reason: "DENIED" });
  });

  it("never starts when the lifecycle is already gone", async () => {
    const { source, calls } = scripted([], []);
    expect(
      await exportUsage(
        source,
        usageExportScope(reportOf("A", [20362]), {}, estimateOf(10)),
        () => false,
      ),
    ).toEqual({ kind: "CANCELLED" });
    expect(calls).toHaveLength(0);
  });
});
