import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { normalizeUsage } from "../../convex/model/aiUsage/usage";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";

const modules = {
  "../convex/lib/tenantFunctions.ts": () =>
    import("../../convex/lib/tenantFunctions"),
  "../convex/aiUsage/reports.ts": () => import("../../convex/aiUsage/reports"),
  "../convex/workspace/current.ts": () =>
    import("../../convex/workspace/current"),
  "../convex/hr/access.ts": () => import("../../convex/hr/access"),
};
const NOW = Date.parse("2026-10-15T05:00:00Z");
const DAY = 86_400_000;
const identity = { subject: "user_fixture_a", org_id: "org_fixture_a" };

async function worldWith(roleA: string) {
  const world = await createConvexTenantWorld(modules);
  await seedConvexAuthorization(world, {
    roleA,
    extraRoles: [
      { key: "USAGE_READER", permissionCodes: ["aiUsage.read"] },
      {
        key: "USAGE_ADMIN",
        permissionCodes: ["aiUsage.read", "aiUsage.configure"],
      },
      { key: "USAGE_CONFIGURE_ONLY", permissionCodes: ["aiUsage.configure"] },
    ],
  });
  return world;
}

type Overrides = Record<string, unknown>;
function operation(world: ConvexTenantWorld, i: number, extra: Overrides = {}) {
  const startedAt = (extra.startedAt as number | undefined) ?? NOW - i * 60_000;
  return {
    orgId: world.orgA,
    actorUserId: world.userA,
    warehouseId: world.warehouses.alphaA,
    feature: "JOB_TICKET_SCAN" as const,
    environment: "fixture",
    operationId: `op-${String(i).padStart(4, "0")}`,
    requestedModel: "fixture-model",
    utcDay: Math.floor(startedAt / DAY),
    startedAt,
    durationMs: 1,
    status: "SUCCEEDED" as const,
    attemptCount: 1,
    knownCostUsdNano: 1,
    unknownAttemptCount: 0,
    ...extra,
  };
}
async function insertOperations(
  world: ConvexTenantWorld,
  rows: readonly ReturnType<typeof operation>[],
) {
  await world.t.run(async (ctx) => {
    for (const row of rows) await ctx.db.insert("aiUsageOperations", row);
  });
}
const value = <T>(outcome: { ok: boolean; value?: T }) => {
  if (!outcome.ok) throw new Error("DENIED");
  return outcome.value as T;
};

afterEach(() => {
  vi.useRealTimers();
});

describe("organization-scoped AI usage access", () => {
  it("lets a usage-only reader discover and read the report without warehouse or HR access", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const world = await worldWith("USAGE_READER");
    await insertOperations(world, [operation(world, 1)]);
    const actor = world.t.withIdentity(identity);
    expect(await actor.query(api.aiUsage.reports.access, {})).toMatchObject({
      ok: true,
      value: { permissions: ["aiUsage.read"], organizationName: "Tenant A" },
    });
    const report = value(await actor.query(api.aiUsage.reports.summary, {}));
    if ("error" in report) throw new Error("REPORT");
    expect(report.byFeature.JOB_TICKET_SCAN.operationCount).toBe(1);
    // Labels only for dimensions present in usage rows.
    expect(report.warehouses).toEqual([
      { id: world.warehouses.alphaA, name: "Warehouse ALPHA" },
    ]);
    expect(report.users).toEqual([{ id: world.userA, name: "Fixture A" }]);
    const recent = value(await actor.query(api.aiUsage.reports.recent, {}));
    expect("error" in recent ? recent : recent.items).toHaveLength(1);
    // No warehouse, HR or configuration capability came with it.
    expect((await actor.query(api.workspace.current.readCurrent, {})).ok).toBe(
      false,
    );
    expect((await actor.query(api.hr.access.current, {})).ok).toBe(false);
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

  it("reports configure capability independently of read", async () => {
    const settings = { usdThbRate: 33.53, feePercent: 5.5, source: "fixture" };
    const admin = (await worldWith("USAGE_ADMIN")).t.withIdentity(identity);
    expect(await admin.query(api.aiUsage.reports.access, {})).toMatchObject({
      value: { permissions: ["aiUsage.read", "aiUsage.configure"] },
    });
    expect(
      await admin.mutation(api.aiUsage.reports.configure, settings),
    ).toMatchObject({ ok: true, value: { ok: true } });
    const configureOnly = (
      await worldWith("USAGE_CONFIGURE_ONLY")
    ).t.withIdentity(identity);
    expect((await configureOnly.query(api.aiUsage.reports.access, {})).ok).toBe(
      false,
    );
    expect(
      (await configureOnly.mutation(api.aiUsage.reports.configure, settings))
        .ok,
    ).toBe(true);
  });

  it.each(["HR_EMPLOYEE", "WAREHOUSE_MANAGER"])(
    "denies the report and its access to %s",
    async (role) => {
      const actor = (await worldWith(role)).t.withIdentity(identity);
      for (const outcome of [
        await actor.query(api.aiUsage.reports.access, {}),
        await actor.query(api.aiUsage.reports.summary, {}),
        await actor.query(api.aiUsage.reports.recent, {}),
      ])
        expect(outcome.ok).toBe(false);
    },
  );

  it("never shows another organization's usage", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const world = await worldWith("USAGE_READER");
    await insertOperations(world, [
      operation(world, 1, {
        orgId: world.orgB,
        warehouseId: world.warehouses.alphaB,
        operationId: "other-org",
      }),
    ]);
    const actor = world.t.withIdentity(identity);
    const report = value(await actor.query(api.aiUsage.reports.summary, {}));
    if ("error" in report) throw new Error("REPORT");
    expect(report.byFeature.JOB_TICKET_SCAN.operationCount).toBe(0);
    expect(report.warehouses).toEqual([]);
    const recent = value(await actor.query(api.aiUsage.reports.recent, {}));
    expect("items" in recent && recent.items).toEqual([]);
  });
});

describe("recent operation history", () => {
  it("pages newest first through the selected period with bounded cursors", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const world = await worldWith("USAGE_READER");
    // 30 in range across two UTC days, one last month (out of range).
    const rows = Array.from({ length: 30 }, (_, i) =>
      operation(world, i, { startedAt: NOW - i * 3 * 60 * 60_000 }),
    );
    await insertOperations(world, [
      ...rows,
      operation(world, 99, { startedAt: Date.parse("2026-09-20T05:00:00Z") }),
    ]);
    const actor = world.t.withIdentity(identity);
    const pages = [];
    let cursor: string | null | undefined;
    do {
      const page = value(
        await actor.query(api.aiUsage.reports.recent, cursor ? { cursor } : {}),
      );
      if ("error" in page) throw new Error(page.error);
      expect(page.timezone).toBe("Asia/Bangkok");
      expect(page.items.length).toBeLessThanOrEqual(25);
      pages.push(page.items);
      cursor = page.continueCursor;
    } while (cursor && pages.length < 10);
    expect(cursor).toBeNull();
    expect(pages.length).toBeGreaterThan(1);
    const items = pages.flat();
    const ids = items.map((i) => i.operationId);
    expect(ids).toEqual(rows.map((row) => row.operationId));
    expect(ids).not.toContain("op-0099");
    const times = items.map((i) => i.startedAt);
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("respects period, filters, and refuses a cursor from another range", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const world = await worldWith("USAGE_READER");
    await insertOperations(world, [
      operation(world, 1),
      operation(world, 2, { feature: "AI_SEARCH", warehouseId: undefined }),
      operation(world, 3, { feature: "LOCATION_LABEL_SCAN" }),
      operation(world, 4, { startedAt: Date.parse("2026-10-10T05:00:00Z") }),
    ]);
    const actor = world.t.withIdentity(identity);
    const ids = async (args: Record<string, unknown>) => {
      const page = value(await actor.query(api.aiUsage.reports.recent, args));
      if ("error" in page) throw new Error(page.error);
      return page.items.map((item) => item.operationId);
    };
    expect(await ids({})).toEqual(["op-0001", "op-0002", "op-0003", "op-0004"]);
    expect(await ids({ period: "today" })).toEqual([
      "op-0001",
      "op-0002",
      "op-0003",
    ]);
    expect(await ids({ feature: "AI_SEARCH" })).toEqual(["op-0002"]);
    expect(await ids({ feature: "LOCATION_LABEL_SCAN" })).toEqual(["op-0003"]);
    expect(
      await ids({
        warehouseId: world.warehouses.alphaA,
        from: "2026-10-10",
        to: "2026-10-10",
      }),
    ).toEqual(["op-0004"]);
    for (const cursor of [
      "not json",
      JSON.stringify([Math.floor(Date.parse("2026-01-01") / DAY), null]),
      JSON.stringify(["x", null]),
    ])
      expect(
        value(await actor.query(api.aiUsage.reports.recent, { cursor })),
      ).toEqual({ error: "CURSOR_INVALID" });
  });

  it("stops each request at the scan bound and continues a sparse filter", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const world = await worldWith("USAGE_READER");
    await insertOperations(world, [
      ...Array.from({ length: 210 }, (_, i) =>
        operation(world, i, { startedAt: NOW - i * 1_000 }),
      ),
      operation(world, 500, {
        startedAt: NOW - 300_000,
        feature: "AI_SEARCH",
      }),
    ]);
    const actor = world.t.withIdentity(identity);
    const answers: string[][] = [];
    let cursor: string | null = null;
    do {
      const args: { feature: "AI_SEARCH"; cursor?: string } = cursor
        ? { feature: "AI_SEARCH", cursor }
        : { feature: "AI_SEARCH" };
      const page = value(await actor.query(api.aiUsage.reports.recent, args));
      if ("error" in page) throw new Error(page.error);
      answers.push(page.items.map((item) => item.operationId));
      cursor = page.continueCursor;
    } while (cursor && answers.length < 10);
    // 211 rows at most 99 per request: two empty answers with a cursor, then the match.
    expect(answers).toEqual([[], [], ["op-0500"]]);
  });

  it("describes each operation with labels, models, attempts and cost coverage", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const world = await worldWith("USAGE_READER");
    const scope = {
      orgId: world.orgA,
      actorUserId: world.userA,
      warehouseId: world.warehouses.alphaA,
      operationId: "op-detail",
      feature: "JOB_TICKET_SCAN" as const,
      requestedModel: "openai/gpt-6-luna",
    };
    await world.t.mutation(internal.aiUsage.internal.begin, {
      ...scope,
      attemptNo: 1,
    });
    await world.t.mutation(internal.aiUsage.internal.finish, {
      orgId: world.orgA,
      operationId: "op-detail",
      attemptNo: 1,
      result: {
        ...normalizeUsage(null),
        status: "PROVIDER_ERROR",
        httpStatus: 503,
      },
    });
    await world.t.mutation(internal.aiUsage.internal.begin, {
      ...scope,
      attemptNo: 2,
    });
    await world.t.mutation(internal.aiUsage.internal.finish, {
      orgId: world.orgA,
      operationId: "op-detail",
      attemptNo: 2,
      result: {
        ...normalizeUsage({
          id: "gen-detail",
          model: "openai/gpt-6-luna-2026",
          usage: { cost: 0.0002 },
        }),
        status: "SUCCEEDED",
      },
    });
    const page = value(
      await world.t
        .withIdentity(identity)
        .query(api.aiUsage.reports.recent, {}),
    );
    if ("error" in page) throw new Error("RECENT");
    expect(page.items).toEqual([
      expect.objectContaining({
        operationId: "op-detail",
        feature: "JOB_TICKET_SCAN",
        actorName: "Fixture A",
        warehouseName: "Warehouse ALPHA",
        requestedModel: "openai/gpt-6-luna",
        actualModels: ["openai/gpt-6-luna-2026"],
        status: "SUCCEEDED",
        attemptCount: 2,
        knownCostUsdNano: 200_000,
        unknownAttemptCount: 1,
      }),
    ]);
  });
});
