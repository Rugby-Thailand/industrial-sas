import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";

const modules = {
  "../convex/lib/tenantFunctions.ts": () =>
    import("../../convex/lib/tenantFunctions"),
  "../convex/finishedGoods/jobScans.ts": () =>
    import("../../convex/finishedGoods/jobScans"),
  "../convex/finishedGoods/locationImage.ts": () =>
    import("../../convex/finishedGoods/locationImage"),
  "../convex/aiUsage/reports.ts": () => import("../../convex/aiUsage/reports"),
};
const image = "data:image/jpeg;base64,YWJj";
const labels = (content: unknown, cost?: number, status = 200) =>
  new Response(
    JSON.stringify({
      id: `gen-location-${status}-${cost ?? "none"}`,
      model: "openai/gpt-6-luna",
      ...(cost === undefined ? {} : { usage: { cost, prompt_tokens: 50 } }),
      choices: [{ message: { content: JSON.stringify(content) } }],
    }),
    { status },
  );
const READABLE = { candidates: [{ code: "F1-L3-11", labelText: null }] };

let world: ConvexTenantWorld;
const actor = () =>
  world.t.withIdentity({ subject: "user_fixture_a", org_id: "org_fixture_a" });
const read = (warehouseId = world.warehouses.alphaA) =>
  actor().action(api.finishedGoods.locationImage.extractLocationLabel, {
    warehouseId,
    imageDataUrl: image,
  });
const ledger = () =>
  world.t.run(async (ctx) => ({
    events: await ctx.db.query("aiUsageEvents").collect(),
    operations: await ctx.db.query("aiUsageOperations").collect(),
    summaries: await ctx.db.query("aiUsageDailySummaries").collect(),
    scans: await ctx.db.query("finishedGoodsJobScans").collect(),
  }));

beforeEach(async () => {
  vi.stubEnv("OPENROUTER_API_KEY", "fixture-key");
  vi.stubEnv("OPENROUTER_MODEL", "openai/gpt-6-luna");
  world = await createConvexTenantWorld(modules);
  await seedConvexAuthorization(world, { roleA: "ORG_ADMIN" });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("location label photos in the AI usage ledger", () => {
  it("records a successful read as LOCATION_LABEL_SCAN without any save, and reports it separately", async () => {
    const fetcher = vi.fn().mockResolvedValue(labels(READABLE, 0.00012));
    vi.stubGlobal("fetch", fetcher);
    expect(await read()).toMatchObject({
      ok: true,
      value: { ok: true, candidates: READABLE.candidates },
    });
    expect(fetcher).toHaveBeenCalledOnce();
    const l = await ledger();
    expect(l.scans).toHaveLength(0);
    expect(l.events).toHaveLength(1);
    expect(l.events[0]).toMatchObject({
      feature: "LOCATION_LABEL_SCAN",
      warehouseId: world.warehouses.alphaA,
      status: "SUCCEEDED",
      billingStatus: "REPORTED",
      costUsdNano: 120_000,
    });
    expect(l.operations[0]).toMatchObject({
      feature: "LOCATION_LABEL_SCAN",
      attemptCount: 1,
      knownCostUsdNano: 120_000,
    });
    const report = await actor().query(api.aiUsage.reports.summary, {});
    if (!report.ok || "error" in report.value) throw new Error("REPORT");
    expect(report.value.byFeature.LOCATION_LABEL_SCAN).toMatchObject({
      operationCount: 1,
      knownCostUsdNano: 120_000,
    });
    expect(report.value.byFeature.JOB_TICKET_SCAN.operationCount).toBe(0);
    expect(report.value.byFeature.AI_SEARCH.operationCount).toBe(0);
    const filtered = await actor().query(api.aiUsage.reports.summary, {
      feature: "JOB_TICKET_SCAN",
    });
    if (!filtered.ok || "error" in filtered.value) throw new Error("REPORT");
    expect(filtered.value.breakdown).toHaveLength(0);
  });

  it("bills malformed model output as unreadable and still answers AI_UNREADABLE", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          labels(
            { candidates: [{ code: "F1", labelText: null, extra: true }] },
            0.0002,
          ),
        ),
    );
    expect(await read()).toMatchObject({
      value: { ok: false, error: { code: "AI_UNREADABLE" } },
    });
    expect((await ledger()).events[0]).toMatchObject({
      feature: "LOCATION_LABEL_SCAN",
      status: "UNREADABLE",
      billingStatus: "REPORTED",
      costUsdNano: 200_000,
    });
  });

  it("counts one photo with two provider calls after a 5xx retry", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(labels(READABLE, 0.0001));
    vi.stubGlobal("fetch", fetcher);
    expect(await read()).toMatchObject({ value: { ok: true } });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const l = await ledger();
    expect(l.events.map((e) => [e.attemptNo, e.status])).toEqual([
      [1, "PROVIDER_ERROR"],
      [2, "SUCCEEDED"],
    ]);
    expect(l.operations).toHaveLength(1);
    expect(l.summaries[0]).toMatchObject({
      feature: "LOCATION_LABEL_SCAN",
      operationCount: 1,
      attemptCount: 2,
      unknownAttemptCount: 1,
    });
  });

  it("records nothing and calls no provider when access is denied or no key is configured", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(read(world.warehouses.alphaB)).rejects.toThrow(
      "WAREHOUSE_UNKNOWN",
    );
    await expect(read(world.warehouses.bravoA)).rejects.toThrow(
      "WAREHOUSE_OUT_OF_SCOPE",
    );
    vi.stubEnv("OPENROUTER_API_KEY", "");
    expect(await read()).toMatchObject({
      value: { ok: false, error: { code: "AI_UNAVAILABLE" } },
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect((await ledger()).events).toHaveLength(0);
  });

  it("denies a role without storage manage permission before any usage or provider call", async () => {
    const other = await createConvexTenantWorld(modules);
    await seedConvexAuthorization(other, { roleA: "SUPERVISOR" });
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const outcome = await other.t
      .withIdentity({ subject: "user_fixture_a", org_id: "org_fixture_a" })
      .action(api.finishedGoods.locationImage.extractLocationLabel, {
        warehouseId: other.warehouses.alphaA,
        imageDataUrl: image,
      });
    expect(outcome.ok).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    expect(
      await other.t.run((ctx) => ctx.db.query("aiUsageEvents").collect()),
    ).toHaveLength(0);
  });

  it("refuses to link a location operation to a saved job ticket", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(labels(READABLE, 0.0001)));
    const result = await read();
    expect(result.ok).toBe(true);
    const save = await actor().mutation(
      api.finishedGoods.jobScans.saveJobScans,
      {
        warehouseId: world.warehouses.alphaA,
        requestId: "link-location",
        locationText: "F1-L3-11",
        items: [
          {
            source: "AI",
            factoryOrder: "FO1",
            productBarcodeText: "BOX1",
            aiUsageOperationId: result.requestId,
          },
        ],
      },
    );
    expect(JSON.stringify(save)).toContain("AI_USAGE_LINK_INVALID");
    const l = await ledger();
    expect(l.scans).toHaveLength(0);
    expect(l.operations[0]?.jobScanId).toBeUndefined();
  });
});
