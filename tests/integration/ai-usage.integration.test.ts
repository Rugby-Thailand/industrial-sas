import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";
import { normalizeUsage } from "../../convex/model/aiUsage/usage";
import { requestJobTicketProvider } from "../../convex/finishedGoods/jobScans";

const modules = {
  "../convex/lib/tenantFunctions.ts": () =>
    import("../../convex/lib/tenantFunctions"),
  "../convex/finishedGoods/jobScans.ts": () =>
    import("../../convex/finishedGoods/jobScans"),
  "../convex/aiUsage/reports.ts": () => import("../../convex/aiUsage/reports"),
  "../convex/aiUsage/provision.ts": () =>
    import("../../convex/aiUsage/provision"),
  "../convex/aiUsage/rebuild.ts": () => import("../../convex/aiUsage/rebuild"),
  "../convex/hr/navigationIntent.ts": () =>
    import("../../convex/hr/navigationIntent"),
};
let world: ConvexTenantWorld;
const auth = () =>
  world.t.withIdentity({ subject: "user_fixture_a", org_id: "org_fixture_a" });
const image = "data:image/jpeg;base64,YQ==";
const envelope = (
  cost: number | undefined,
  content = '{"factory_order":"FO1","product_barcode_text":"BOX1"}',
  id = "gen-fixture",
  status = 200,
) =>
  new Response(
    JSON.stringify({
      id,
      model: "openai/gpt-6-luna",
      usage:
        cost === undefined
          ? {}
          : { cost, prompt_tokens: 100, completion_tokens: 20 },
      choices: [{ message: { content } }],
    }),
    { status },
  );
const extract = () =>
  auth().action(api.finishedGoods.jobScans.extractJobTicket, {
    warehouseId: world.warehouses.alphaA,
    imageUrl: image,
  });
const ledger = () =>
  world.t.run(async (ctx) => ({
    events: await ctx.db.query("aiUsageEvents").collect(),
    operations: await ctx.db.query("aiUsageOperations").collect(),
    summaries: await ctx.db.query("aiUsageDailySummaries").collect(),
  }));
beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubEnv("OPENROUTER_API_KEY", "fixture-key");
  vi.stubEnv("OPENROUTER_MODEL", "openai/gpt-6-luna");
  world = await createConvexTenantWorld(modules);
  await seedConvexAuthorization(world, { roleA: "ORG_ADMIN" });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("AI usage ledger through authorized actions", () => {
  it("records a scan before Save, preserves nano cost and links the saved ticket once", async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(0.000588675));
    vi.stubGlobal("fetch", fetcher);
    const result = await extract();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("DENIED");
    expect(result.value.ok).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const before = await ledger();
    expect(before.operations).toHaveLength(1);
    expect(before.events[0]).toMatchObject({
      status: "SUCCEEDED",
      costUsdNano: 588675,
    });
    const saveArgs = {
      warehouseId: world.warehouses.alphaA,
      requestId: "save-fixture",
      locationText: "Shelf A",
      items: [
        {
          factoryOrder: "FO1",
          productBarcodeText: "BOX1",
          source: "AI" as const,
          aiUsageOperationId: result.requestId,
        },
      ],
    };
    await auth().mutation(api.finishedGoods.jobScans.saveJobScans, saveArgs);
    await auth().mutation(api.finishedGoods.jobScans.saveJobScans, saveArgs);
    const after = await ledger();
    expect(after.operations[0]?.jobScanId).toBeDefined();
    expect(after.summaries[0]?.operationCount).toBe(1);
    expect(after.summaries[0]?.knownCostUsdNano).toBe(588675);
    const reuse = await auth().mutation(
      api.finishedGoods.jobScans.saveJobScans,
      { ...saveArgs, requestId: "reuse" },
    );
    expect(JSON.stringify(reuse)).toContain("AI_USAGE_LINK_INVALID");
    await world.t.mutation(internal.aiUsage.rebuild.day, {
      orgId: world.orgA,
      utcDate: new Date(before.operations[0]!.startedAt)
        .toISOString()
        .slice(0, 10),
      apply: true,
    });
    expect((await ledger()).operations[0]?.jobScanId).toBe(
      after.operations[0]?.jobScanId,
    );
  });
  it("bills unreadable output and counts one image with two HTTP attempts on a 5xx retry", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(envelope(0.0001, "", "gen-first", 503))
      .mockResolvedValueOnce(envelope(0.0002, "invalid JSON", "gen-second"));
    vi.stubGlobal("fetch", fetcher);
    const result = await extract();
    expect(result.ok && result.value.ok).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const l = await ledger();
    expect(l.events.map((e) => e.status)).toEqual([
      "PROVIDER_ERROR",
      "UNREADABLE",
    ]);
    expect(l.operations[0]).toMatchObject({
      attemptCount: 2,
      knownCostUsdNano: 300000,
      unknownAttemptCount: 0,
      status: "UNREADABLE",
    });
    expect(l.summaries[0]).toMatchObject({
      operationCount: 1,
      attemptCount: 2,
      completeCostUsdNano: 300000,
    });
  });
  it("distinguishes missing price from free, finalizes idempotently and reconciles only metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(envelope(undefined))
        .mockResolvedValueOnce(envelope(0, undefined, "gen-free")),
    );
    const unknown = await extract();
    await extract();
    const l = await ledger();
    expect(l.events.map((e) => e.billingStatus)).toEqual([
      "UNKNOWN",
      "REPORTED",
    ]);
    const result = {
      ...normalizeUsage(
        { data: { id: "gen-fixture", total_cost: 0.000123 } },
        "GENERATION_LOOKUP",
      ),
      status: "SUCCEEDED" as const,
    };
    const finish = {
      orgId: world.orgA,
      operationId: unknown.requestId,
      attemptNo: 1,
      result,
    };
    await world.t.mutation(internal.aiUsage.internal.finish, finish);
    await world.t.mutation(internal.aiUsage.internal.finish, finish);
    const after = await ledger();
    expect(after.summaries[0]).toMatchObject({
      knownCostUsdNano: 123000,
      unknownAttemptCount: 0,
      completeOperationCount: 2,
    });
  });
  it("makes no HTTP request when the durable begin fails, or authorization is denied", async () => {
    vi.stubEnv("OPENROUTER_MODEL", "invalid model");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await extract();
    expect(fetcher).not.toHaveBeenCalled();
    expect((await ledger()).events).toHaveLength(0);
    await expect(
      auth().action(api.finishedGoods.jobScans.extractJobTicket, {
        warehouseId: world.warehouses.alphaB,
        imageUrl: image,
      }),
    ).rejects.toThrow("WAREHOUSE_UNKNOWN");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("expires a durable pending call without replaying inference", async () => {
    const id = await world.t.mutation(internal.aiUsage.internal.begin, {
      orgId: world.orgA,
      actorUserId: world.userA,
      warehouseId: world.warehouses.alphaA,
      operationId: "crashed",
      feature: "JOB_TICKET_SCAN",
      requestedModel: "openai/gpt-6-luna",
      attemptNo: 1,
    });
    await world.t.mutation(internal.aiUsage.internal.expire, { eventId: id });
    await world.t.mutation(internal.aiUsage.internal.expire, { eventId: id });
    const l = await ledger();
    expect(l.events[0]).toMatchObject({
      status: "INTERRUPTED",
      billingStatus: "UNKNOWN",
    });
    expect(l.summaries[0]).toMatchObject({
      operationCount: 1,
      pendingCount: 0,
      incompleteOperationCount: 1,
    });
  });
  it("reports only this tenant and refuses cross-tenant ticket linkage", async () => {
    const id = await world.t.mutation(internal.aiUsage.internal.begin, {
      orgId: world.orgB,
      actorUserId: world.userA,
      warehouseId: world.warehouses.alphaB,
      operationId: "other-org",
      feature: "JOB_TICKET_SCAN",
      requestedModel: "openai/gpt-6-luna",
      attemptNo: 1,
    });
    expect(id).toBeDefined();
    const report = await auth().query(api.aiUsage.reports.summary, {});
    expect(report.ok).toBe(true);
    if (!report.ok || "error" in report.value) throw new Error("REPORT");
    expect(report.value.byFeature.JOB_TICKET_SCAN.operationCount).toBe(0);
    expect(report.value.range.from.endsWith("-01")).toBe(true);
    const save = await auth().mutation(
      api.finishedGoods.jobScans.saveJobScans,
      {
        warehouseId: world.warehouses.alphaA,
        requestId: "forged",
        locationText: "A",
        items: [
          {
            source: "AI",
            factoryOrder: "FO1",
            productBarcodeText: "B1",
            aiUsageOperationId: "other-org",
          },
        ],
      },
    );
    expect(JSON.stringify(save)).toContain("AI_USAGE_LINK_INVALID");
    const attempts = await auth().query(api.aiUsage.reports.attempts, {
      operationId: "other-org",
    });
    expect(attempts.ok && attempts.value).toEqual([]);
  });
  it("does not give reports or FX configuration to warehouse managers", async () => {
    const other = await createConvexTenantWorld(modules);
    await seedConvexAuthorization(other, { roleA: "WAREHOUSE_MANAGER" });
    const actor = other.t.withIdentity({
      subject: "user_fixture_a",
      org_id: "org_fixture_a",
    });
    expect((await actor.query(api.aiUsage.reports.summary, {})).ok).toBe(false);
    expect(
      (
        await actor.mutation(api.aiUsage.reports.configure, {
          usdThbRate: 33.53,
          feePercent: 5.5,
          source: "fixture",
        })
      ).ok,
    ).toBe(false);
  });
  it("tracks AI Search separately even when classification is unreadable", async () => {
    vi.stubEnv("OPENROUTER_SEARCH_MODEL", "openai/gpt-6-luna");
    const fetcher = vi.fn().mockResolvedValue(envelope(0.0003, "invalid JSON"));
    vi.stubGlobal("fetch", fetcher);
    await auth().action(api.hr.navigationIntent.interpret, {
      query: "open attendance",
      context: { page: null, employee: false, date: false, period: false },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await ledger()).operations[0]).toMatchObject({
      feature: "AI_SEARCH",
      status: "UNREADABLE",
      knownCostUsdNano: 300000,
    });
  });
  it("tracks timeout as unknown and awaits finalization without a second request", async () => {
    const begin = vi.fn().mockResolvedValue(undefined),
      finish = vi.fn().mockResolvedValue(undefined),
      send = vi.fn((_signal: AbortSignal) => new Promise<Response>(() => {}));
    const promise = requestJobTicketProvider(send, {
      usage: { begin, finish },
      policy: {
        attemptTimeoutMs: 10,
        totalDeadlineMs: 20,
        maxRetries: 1,
        minRetryBudgetMs: 5,
        maxResponseBytes: 1024,
      },
    });
    await vi.advanceTimersByTimeAsync(11);
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ status: "TIMEOUT", billingStatus: "UNKNOWN" }),
    );
  });

  it("reconciles unknown price with a generation lookup without replaying the photo", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(envelope(undefined))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: "gen-fixture",
              total_cost: 0.00025,
              native_tokens_prompt: 100,
              native_tokens_completion: 20,
            },
          }),
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    await extract();
    const eventId = (await ledger()).events[0]!._id;
    await world.t.action(internal.aiUsage.internal.reconcile, {
      eventId,
      retry: 0,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]?.[0]).toBe(
      "https://openrouter.ai/api/v1/generation?id=gen-fixture",
    );
    expect((await ledger()).summaries[0]).toMatchObject({
      knownCostUsdNano: 250000,
      unknownAttemptCount: 0,
      completeOperationCount: 1,
    });
  });

  it("counts Bangkok date boundaries precisely instead of charging a whole UTC day", async () => {
    const instants = [
      "2026-09-30T16:59:59Z",
      "2026-09-30T17:00:00Z",
      "2026-10-01T16:59:59Z",
      "2026-10-01T17:00:00Z",
    ];
    for (let i = 0; i < instants.length; i++) {
      vi.setSystemTime(new Date(instants[i]!));
      const operationId = `boundary-${i}`;
      await world.t.mutation(internal.aiUsage.internal.begin, {
        orgId: world.orgA,
        actorUserId: world.userA,
        warehouseId: world.warehouses.alphaA,
        operationId,
        feature: "JOB_TICKET_SCAN",
        requestedModel: "openai/gpt-6-luna",
        attemptNo: 1,
      });
      await world.t.mutation(internal.aiUsage.internal.finish, {
        orgId: world.orgA,
        operationId,
        attemptNo: 1,
        result: {
          ...normalizeUsage({
            id: `gen-boundary-${i}`,
            usage: { cost: (i + 1) / 10000 },
          }),
          status: "SUCCEEDED",
        },
      });
    }
    vi.setSystemTime(new Date("2026-10-02T01:00:00Z"));
    const report = await auth().query(api.aiUsage.reports.summary, {
      from: "2026-10-01",
      to: "2026-10-01",
    });
    if (!report.ok || "error" in report.value) throw new Error("REPORT");
    expect(report.value.complete).toBe(true);
    expect(report.value.byFeature.JOB_TICKET_SCAN).toMatchObject({
      operationCount: 2,
      attemptCount: 2,
      knownCostUsdNano: 500000,
      completeOperationCount: 2,
    });
  });

  it("upgrades only an unchanged seeded organization administrator, idempotently", async () => {
    await world.t.run(async (ctx) => {
      const grants = await ctx.db
        .query("rolePermissions")
        .withIndex("by_orgId_permissionCode", (q) => q.eq("orgId", world.orgA))
        .collect();
      for (const grant of grants)
        if (grant.permissionCode.startsWith("aiUsage."))
          await ctx.db.delete("rolePermissions", grant._id);
    });
    expect(
      await world.t.mutation(internal.aiUsage.provision.organization, {
        orgId: world.orgA,
      }),
    ).toBe("UPGRADED");
    expect(
      await world.t.mutation(internal.aiUsage.provision.organization, {
        orgId: world.orgA,
      }),
    ).toBe("CURRENT");
    await world.t.run(async (ctx) => {
      const role = await ctx.db
        .query("roles")
        .withIndex("by_orgId_key", (q) =>
          q.eq("orgId", world.orgB).eq("key", "ORG_ADMIN"),
        )
        .unique();
      const grants = await ctx.db
        .query("rolePermissions")
        .withIndex("by_orgId_roleId_permissionCode", (q) =>
          q.eq("orgId", world.orgB).eq("roleId", role!._id),
        )
        .collect();
      for (const grant of grants)
        if (
          grant.permissionCode.startsWith("aiUsage.") ||
          grant.permissionCode === "masterData.storageLayout.manage"
        )
          await ctx.db.delete("rolePermissions", grant._id);
    });
    expect(
      await world.t.mutation(internal.aiUsage.provision.organization, {
        orgId: world.orgB,
      }),
    ).toBe("CUSTOMIZED");
    const codes = await world.t.run(async (ctx) =>
      (
        await ctx.db
          .query("rolePermissions")
          .withIndex("by_orgId_permissionCode", (q) =>
            q.eq("orgId", world.orgB),
          )
          .collect()
      ).map((g) => g.permissionCode),
    );
    expect(codes).not.toContain("aiUsage.read");
  });

  it("keeps FX versions immutable and flags an over-capacity report as incomplete", async () => {
    await auth().mutation(api.aiUsage.reports.configure, {
      usdThbRate: 33.53,
      feePercent: 5.5,
      source: "First rate",
    });
    await auth().mutation(api.aiUsage.reports.configure, {
      usdThbRate: 34,
      feePercent: 0,
      source: "Second rate",
    });
    const versions = await world.t.run((ctx) =>
      ctx.db.query("aiCostSettings").collect(),
    );
    expect(
      versions.map((s) => [s.version, s.usdThbRate, s.feePercent]),
    ).toEqual([
      [1, 33.53, 5.5],
      [2, 34, 0],
    ]);
    const startedAt = Date.parse("2026-10-01T00:00:00Z"),
      utcDay = Math.floor(startedAt / 86400000);
    await world.t.run(async (ctx) => {
      for (let i = 0; i < 1001; i++)
        await ctx.db.insert("aiUsageOperations", {
          orgId: world.orgA,
          actorUserId: world.userA,
          feature: "JOB_TICKET_SCAN",
          environment: "fixture",
          operationId: `capacity-${i}`,
          requestedModel: "fixture-model",
          utcDay,
          startedAt,
          durationMs: 1,
          status: "SUCCEEDED",
          attemptCount: 1,
          knownCostUsdNano: 1,
          unknownAttemptCount: 0,
        });
    });
    const report = await auth().query(api.aiUsage.reports.summary, {
      from: "2026-10-01",
      to: "2026-10-01",
    });
    expect(
      report.ok && !("error" in report.value) && report.value.complete,
    ).toBe(false);
    await expect(
      world.t.mutation(internal.aiUsage.rebuild.day, {
        orgId: world.orgA,
        utcDate: "2026-10-01",
        apply: true,
      }),
    ).rejects.toThrow("AI_USAGE_REBUILD_CAPACITY");
    expect((await ledger()).operations).toHaveLength(1001);
  });

  it("rebuilds projections from the ledger atomically, including retries crossing UTC midnight", async () => {
    const scope = {
      orgId: world.orgA,
      actorUserId: world.userA,
      warehouseId: world.warehouses.alphaA,
      operationId: "midnight-retry",
      feature: "JOB_TICKET_SCAN" as const,
      requestedModel: "openai/gpt-6-luna",
    };
    vi.setSystemTime(new Date("2026-10-10T23:59:00Z"));
    await world.t.mutation(internal.aiUsage.internal.begin, {
      ...scope,
      attemptNo: 1,
    });
    await world.t.mutation(internal.aiUsage.internal.finish, {
      orgId: world.orgA,
      operationId: scope.operationId,
      attemptNo: 1,
      result: {
        ...normalizeUsage({
          id: "gen-before-midnight",
          usage: { cost: 0.0001 },
        }),
        status: "PROVIDER_ERROR",
      },
    });
    vi.setSystemTime(new Date("2026-10-11T00:01:00Z"));
    await world.t.mutation(internal.aiUsage.internal.begin, {
      ...scope,
      attemptNo: 2,
    });
    await world.t.mutation(internal.aiUsage.internal.finish, {
      orgId: world.orgA,
      operationId: scope.operationId,
      attemptNo: 2,
      result: {
        ...normalizeUsage({
          id: "gen-after-midnight",
          usage: { cost: 0.0002 },
        }),
        status: "SUCCEEDED",
      },
    });
    await world.t.run(async (ctx) => {
      const operation = (await ctx.db.query("aiUsageOperations").collect())[0]!;
      const summary = (
        await ctx.db.query("aiUsageDailySummaries").collect()
      )[0]!;
      await ctx.db.patch("aiUsageOperations", operation._id, {
        knownCostUsdNano: 7,
        status: "TIMEOUT",
      });
      await ctx.db.patch("aiUsageDailySummaries", summary._id, {
        knownCostUsdNano: 999,
      });
    });
    const args = { orgId: world.orgA, utcDate: "2026-10-10" };
    expect(
      await world.t.mutation(internal.aiUsage.rebuild.day, args),
    ).toMatchObject({
      operationCount: 1,
      operationDriftCount: 1,
      summaryDriftCount: 1,
      applied: false,
    });
    expect((await ledger()).operations[0]?.knownCostUsdNano).toBe(7);
    await world.t.mutation(internal.aiUsage.rebuild.day, {
      ...args,
      apply: true,
    });
    expect((await ledger()).operations[0]).toMatchObject({
      attemptCount: 2,
      knownCostUsdNano: 300000,
      status: "SUCCEEDED",
    });
    expect((await ledger()).summaries[0]).toMatchObject({
      operationCount: 1,
      attemptCount: 2,
      knownCostUsdNano: 300000,
    });
    expect(
      await world.t.mutation(internal.aiUsage.rebuild.day, args),
    ).toMatchObject({
      operationDriftCount: 0,
      summaryDriftCount: 0,
    });
    const nextDay = await world.t.mutation(internal.aiUsage.rebuild.day, {
      ...args,
      utcDate: "2026-10-11",
    });
    expect(nextDay.operationCount).toBe(0);
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await world.t.run(async (ctx) => {
      const operation = (await ctx.db.query("aiUsageOperations").collect())[0]!;
      await ctx.db.delete("aiUsageOperations", operation._id);
    });
    await world.t.mutation(internal.aiUsage.rebuild.day, {
      ...args,
      apply: true,
    });
    expect((await ledger()).operations).toHaveLength(1);
    expect((await ledger()).summaries).toHaveLength(1);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
