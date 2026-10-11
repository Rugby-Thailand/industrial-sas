import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { requestImageProvider } from "../../convex/lib/imageProvider";
import {
  ACCOUNTING_WRITE_BUDGET_MS,
  createAiUsagePort,
} from "../../convex/lib/aiUsage";
import { responseUsage } from "../../convex/lib/providerUsage";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";

const modules = {
  "../convex/aiUsage/recovery.ts": () =>
    import("../../convex/aiUsage/recovery"),
};
const SECRET = "synthetic-secret-sentinel";
let world: ConvexTenantWorld;
const ledger = () =>
  world.t.run(async (ctx) => ({
    events: await ctx.db.query("aiUsageEvents").collect(),
    operations: await ctx.db.query("aiUsageOperations").collect(),
    summaries: await ctx.db.query("aiUsageDailySummaries").collect(),
  }));
const begin = (operationId: string, attemptNo = 1) =>
  world.t.mutation(internal.aiUsage.internal.begin, {
    orgId: world.orgA,
    actorUserId: world.userA,
    warehouseId: world.warehouses.alphaA,
    operationId,
    feature: "JOB_TICKET_SCAN",
    requestedModel: "openai/gpt-6-luna",
    attemptNo,
  });
const generation = (id: string, cost: number) =>
  new Response(
    JSON.stringify({
      data: { id, total_cost: cost, native_tokens_prompt: 120 },
    }),
  );

beforeEach(async () => {
  vi.stubEnv("OPENROUTER_API_KEY", SECRET);
  world = await createConvexTenantWorld(modules);
  await seedConvexAuthorization(world, { roleA: "ORG_ADMIN" });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("failed finalization log", () => {
  it("retries only the database write, then logs whitelisted recovery metadata including the generation ID", async () => {
    vi.useFakeTimers();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const runMutation = vi.fn(async (reference: unknown) => {
      if (getFunctionName(reference as never) === "aiUsage/internal:finish")
        throw new Error("database unavailable");
      return null;
    });
    const port = createAiUsagePort({ runMutation } as never, {
      orgId: "org-fixture" as Id<"organizations">,
      actorUserId: "user-fixture" as Id<"users">,
      operationId: "op-lost",
    });
    const send = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: "gen-lost",
            model: "openai/gpt-6-luna",
            usage: { cost: 0.000591675, prompt_tokens: 3886 },
            choices: [{ message: { content: `{"customer":"${SECRET}"}` } }],
          }),
        ),
    );
    const pending = requestImageProvider(send, {
      tracking: {
        port,
        feature: "JOB_TICKET_SCAN",
        model: "openai/gpt-6-luna",
      },
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await pending).toMatchObject({ ok: true, attempts: 1 });
    // One request; three finalization writes; no replayed inference.
    expect(send).toHaveBeenCalledOnce();
    expect(
      runMutation.mock.calls.map(([ref]) => getFunctionName(ref as never)),
    ).toEqual([
      "aiUsage/internal:begin",
      "aiUsage/internal:finish",
      "aiUsage/internal:finish",
      "aiUsage/internal:finish",
    ]);
    expect(errors).toHaveBeenCalledOnce();
    const line = String(errors.mock.calls[0]![0]);
    expect(JSON.parse(line)).toEqual({
      event: "aiUsage.finalizeFailed",
      orgId: "org-fixture",
      operationId: "op-lost",
      attemptNo: 1,
      feature: "JOB_TICKET_SCAN",
      writeOutcome: "REJECTED",
      status: "SUCCEEDED",
      httpStatus: 200,
      billingStatus: "REPORTED",
      usageSource: "RESPONSE",
      providerGenerationId: "gen-lost",
      actualModel: "openai/gpt-6-luna",
      costUsdNano: 591_675,
      inputUnitCount: 3886,
      outputUnitCount: null,
      totalUnitCount: null,
    });
    expect(line).not.toContain(SECRET);
    expect(line).not.toContain("customer");
  });
});

describe("finite accounting writes", () => {
  const scope = {
    orgId: "org-fixture" as Id<"organizations">,
    actorUserId: "user-fixture" as Id<"users">,
    operationId: "op-slow",
  };
  const paidAnswer = () =>
    new Response(
      JSON.stringify({
        id: "gen-slow",
        model: "openai/gpt-6-luna",
        usage: { cost: 0.000591675, prompt_tokens: 3886 },
        choices: [{ message: { content: `{"customer":"${SECRET}"}` } }],
      }),
    );
  const names = (runMutation: ReturnType<typeof vi.fn>) =>
    runMutation.mock.calls.map(([ref]) => getFunctionName(ref as never));

  it("ends a finish whose database write never settles at the budget and logs it as unconfirmed", async () => {
    vi.useFakeTimers();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const runMutation = vi.fn((reference: unknown) =>
      getFunctionName(reference as never) === "aiUsage/internal:finish"
        ? new Promise<null>(() => undefined)
        : Promise.resolve(null),
    );
    const port = createAiUsagePort({ runMutation } as never, scope);
    const send = vi.fn(async () => paidAnswer());
    let settledAt: number | undefined;
    const started = Date.now();
    const pending = requestImageProvider(send, {
      tracking: {
        port,
        feature: "JOB_TICKET_SCAN",
        model: "openai/gpt-6-luna",
      },
    }).then((outcome) => {
      settledAt = Date.now() - started;
      return outcome;
    });
    await vi.advanceTimersByTimeAsync(ACCOUNTING_WRITE_BUDGET_MS - 1);
    expect(settledAt).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    // The paid answer is still returned when its accounting times out.
    expect(await pending).toMatchObject({ ok: true, attempts: 1 });
    expect(settledAt).toBe(ACCOUNTING_WRITE_BUDGET_MS);
    expect(send).toHaveBeenCalledOnce();
    expect(names(runMutation)).toEqual([
      "aiUsage/internal:begin",
      "aiUsage/internal:finish",
    ]);
    expect(errors).toHaveBeenCalledOnce();
    const line = String(errors.mock.calls[0]![0]);
    expect(JSON.parse(line)).toMatchObject({
      event: "aiUsage.finalizeFailed",
      operationId: "op-slow",
      writeOutcome: "UNCONFIRMED",
      status: "SUCCEEDED",
      providerGenerationId: "gen-slow",
      costUsdNano: 591_675,
    });
    expect(line).not.toContain(SECRET);
    expect(line).not.toContain("customer");
    // Nothing further happens later: no billable call, no extra write.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(send).toHaveBeenCalledOnce();
    expect(runMutation).toHaveBeenCalledTimes(2);
  });

  it("bounds slow failing retries by the same budget, retrying only the database write", async () => {
    vi.useFakeTimers();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const runMutation = vi.fn((reference: unknown) =>
      getFunctionName(reference as never) === "aiUsage/internal:finish"
        ? new Promise<null>((_resolve, reject) =>
            setTimeout(() => reject(new Error("slow failure")), 2_000),
          )
        : Promise.resolve(null),
    );
    const port = createAiUsagePort({ runMutation } as never, scope);
    let settled = false;
    const pending = port
      .finish(1, { ...responseUsage(null), status: "TIMEOUT" })
      .then(() => {
        settled = true;
      });
    // Writes fail at 2,000 and 4,100 ms; the third is cut off at the budget.
    await vi.advanceTimersByTimeAsync(ACCOUNTING_WRITE_BUDGET_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(names(runMutation)).toEqual([
      "aiUsage/internal:finish",
      "aiUsage/internal:finish",
      "aiUsage/internal:finish",
    ]);
    expect(JSON.parse(String(errors.mock.calls[0]![0]))).toMatchObject({
      writeOutcome: "UNCONFIRMED",
      status: "TIMEOUT",
      billingStatus: "UNKNOWN",
    });
  });

  it("ends an abandon whose write never settles at the budget without sending anything", async () => {
    vi.useFakeTimers();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const runMutation = vi.fn(() => new Promise<null>(() => undefined));
    const port = createAiUsagePort({ runMutation } as never, scope, 50);
    let settled = false;
    const pending = port.abandon(1).then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(49);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(names(runMutation)).toEqual(["aiUsage/internal:abandon"]);
    expect(errors).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("operator recovery of a lost finalization", () => {
  it("is a tenant-scoped, idempotent dry-run-first metadata lookup that never replays inference", async () => {
    await begin("op-lost");
    const fetcher = vi
      .fn()
      .mockImplementation(async () => generation("gen-lost", 0.000591675));
    vi.stubGlobal("fetch", fetcher);
    const args = {
      orgId: world.orgA,
      operationId: "op-lost",
      attemptNo: 1,
      providerGenerationId: "gen-lost",
      status: "SUCCEEDED" as const,
    };
    expect(
      await world.t.action(internal.aiUsage.recovery.attempt, args),
    ).toEqual({ state: "READY", applied: false, costUsdNano: 591_675 });
    expect((await ledger()).events[0]).toMatchObject({
      status: "PENDING",
      billingStatus: "UNKNOWN",
    });
    expect(
      await world.t.action(internal.aiUsage.recovery.attempt, {
        ...args,
        orgId: world.orgB,
        apply: true,
      }),
    ).toMatchObject({ state: "NOT_FOUND", applied: false });
    expect(
      await world.t.action(internal.aiUsage.recovery.attempt, {
        ...args,
        apply: true,
      }),
    ).toEqual({ state: "RECOVERED", applied: true, costUsdNano: 591_675 });
    const after = await ledger();
    expect(after.events[0]).toMatchObject({
      status: "SUCCEEDED",
      billingStatus: "REPORTED",
      usageSource: "GENERATION_LOOKUP",
      providerGenerationId: "gen-lost",
      costUsdNano: 591_675,
    });
    expect(after.operations[0]).toMatchObject({
      status: "SUCCEEDED",
      knownCostUsdNano: 591_675,
      unknownAttemptCount: 0,
    });
    expect(after.summaries[0]).toMatchObject({
      operationCount: 1,
      pendingCount: 0,
      successCount: 1,
      knownCostUsdNano: 591_675,
      completeOperationCount: 1,
    });
    expect(
      await world.t.action(internal.aiUsage.recovery.attempt, {
        ...args,
        apply: true,
      }),
    ).toMatchObject({ state: "CURRENT", applied: false });
    expect(await ledger()).toEqual(after);
    for (const [url, init] of fetcher.mock.calls) {
      expect(url).toBe("https://openrouter.ai/api/v1/generation?id=gen-lost");
      expect(init?.method).toBeUndefined();
      expect(init?.body).toBeUndefined();
    }
  });

  it("recovers an expired attempt with the logged outcome and refuses a generation claimed elsewhere", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(async (url: string) =>
          generation(new URL(url).searchParams.get("id")!, 0.0001),
        ),
    );
    const eventId = await begin("op-expired");
    await world.t.mutation(internal.aiUsage.internal.expire, { eventId });
    expect(
      await world.t.action(internal.aiUsage.recovery.attempt, {
        orgId: world.orgA,
        operationId: "op-expired",
        attemptNo: 1,
        providerGenerationId: "gen-expired",
        status: "UNREADABLE",
        apply: true,
      }),
    ).toMatchObject({ state: "RECOVERED" });
    expect((await ledger()).operations[0]).toMatchObject({
      status: "UNREADABLE",
      knownCostUsdNano: 100_000,
      unknownAttemptCount: 0,
    });
    await begin("op-other");
    expect(
      await world.t.action(internal.aiUsage.recovery.attempt, {
        orgId: world.orgA,
        operationId: "op-other",
        attemptNo: 1,
        providerGenerationId: "gen-expired",
        apply: true,
      }),
    ).toMatchObject({ state: "CONFLICT", applied: false });
  });

  it("changes nothing when the provider has no reported cost or no key", async () => {
    await begin("op-unknown");
    const before = await ledger();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 404 })),
    );
    const args = {
      orgId: world.orgA,
      operationId: "op-unknown",
      attemptNo: 1,
      providerGenerationId: "gen-missing",
      apply: true,
    };
    expect(
      await world.t.action(internal.aiUsage.recovery.attempt, args),
    ).toMatchObject({ state: "COST_UNAVAILABLE" });
    vi.stubEnv("OPENROUTER_API_KEY", "");
    expect(
      await world.t.action(internal.aiUsage.recovery.attempt, args),
    ).toMatchObject({ state: "PROVIDER_UNCONFIGURED" });
    expect(
      await world.t.action(internal.aiUsage.recovery.attempt, {
        ...args,
        providerGenerationId: "bad id with spaces",
      }),
    ).toMatchObject({ state: "INVALID" });
    expect(await ledger()).toEqual(before);
  });
});

describe("abandoning an attempt that never sent a request", () => {
  it("removes only the unsent pending attempt and its projection contribution, idempotently", async () => {
    await begin("op-first");
    await world.t.mutation(internal.aiUsage.internal.abandon, {
      orgId: world.orgA,
      operationId: "op-first",
      attemptNo: 1,
    });
    await world.t.mutation(internal.aiUsage.internal.abandon, {
      orgId: world.orgA,
      operationId: "op-first",
      attemptNo: 1,
    });
    let l = await ledger();
    expect(l.events).toHaveLength(0);
    expect(l.operations).toHaveLength(0);
    expect(l.summaries).toHaveLength(0);

    await begin("op-retry");
    await world.t.mutation(internal.aiUsage.internal.finish, {
      orgId: world.orgA,
      operationId: "op-retry",
      attemptNo: 1,
      result: {
        ...responseUsage({ id: "gen-retry-1", usage: { cost: 0.0001 } }),
        status: "PROVIDER_ERROR",
        httpStatus: 503,
      },
    });
    await begin("op-retry", 2);
    await world.t.mutation(internal.aiUsage.internal.abandon, {
      orgId: world.orgA,
      operationId: "op-retry",
      attemptNo: 2,
    });
    l = await ledger();
    expect(l.events.map((e) => e.attemptNo)).toEqual([1]);
    expect(l.operations[0]).toMatchObject({
      attemptCount: 1,
      status: "PROVIDER_ERROR",
      knownCostUsdNano: 100_000,
      unknownAttemptCount: 0,
    });
    expect(l.summaries[0]).toMatchObject({
      operationCount: 1,
      attemptCount: 1,
      pendingCount: 0,
      knownCostUsdNano: 100_000,
    });
    await expect(
      world.t.mutation(internal.aiUsage.internal.abandon, {
        orgId: world.orgA,
        operationId: "op-retry",
        attemptNo: 1,
      }),
    ).rejects.toThrow("AI_USAGE_INVALID");
  });
});
