import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import * as jobScans from "../../convex/finishedGoods/jobScans";
import * as backfill from "../../convex/finishedGoods/searchIndexBackfill";
import {
  JOB_TICKET_CODE_LIMITS,
  JOB_TICKET_SEARCH_PHOTO_JSON_SCHEMA,
  JOB_TICKET_SEARCH_PHOTO_PROMPT,
  type JobScanSearchField,
} from "../../convex/model/finishedGoods/jobScans";
import { MAX_LOCATION_IMAGE_DATA_URL } from "../../convex/model/finishedGoods/locationImage";
import { RECONCILE_MARGIN_MS } from "../../convex/lib/searchReadiness";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";
import {
  PUBLIC_API_ACTOR,
  createPublicApiWorld,
} from "../fixtures/public-api-examples";

const MODULES = Object.fromEntries(
  Object.entries(
    import.meta.glob([
      "../../convex/**/*.ts",
      "!../../convex/_generated/**",
      "!../../convex/model/**",
      "!../../convex/**/*.test.ts",
      "!../../convex/schema.ts",
      "!../../convex/auth.config.ts",
    ]),
  ).map(([path, load]) => [path.replace("../../convex/", "../convex/"), load]),
);

const IDENTITY = { subject: "user_fixture_a", org_id: "org_fixture_a" };
const VALID_JPEG = "data:image/jpeg;base64,YWJj";
const VALID_PNG = "data:image/png;base64,YQ==";
const VALID_WEBP = "data:image/webp;base64,YWJj";
const KEY_SENTINEL = "synthetic-photo-search-key-sentinel";

type Runtime = {
  _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
};

let generationSeq = 0;

const openRouterResponse = (content: unknown, cost?: number, status = 200) =>
  new Response(
    JSON.stringify({
      id: `gen-photo-search-${++generationSeq}-${status}-${cost ?? "none"}`,
      model: "openai/gpt-6-luna",
      ...(cost === undefined ? {} : { usage: { cost, prompt_tokens: 45 } }),
      choices: [
        {
          message: {
            content:
              typeof content === "string" ? content : JSON.stringify(content),
          },
        },
      ],
    }),
    { status, headers: { "content-type": "application/json" } },
  );

describe("readJobTicketForSearch registered action", () => {
  const transport = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubEnv("AI_IMAGE_PROVIDER", "openrouter");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENAI_IMAGE_MODEL", "");
    vi.stubEnv("OPENROUTER_API_KEY", KEY_SENTINEL);
    vi.stubEnv("OPENROUTER_MODEL", "openai/gpt-6-luna");
    vi.stubEnv("JOB_SCAN_DEMO_AI", "0");
    vi.stubGlobal("fetch", transport);
    transport.mockReset().mockImplementation(async () =>
      openRouterResponse({
        factory_order: "FO69070073",
        product_barcode_text: "FBN-BXVMI004-BOX-00F",
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  async function seedQuota(
    world: Awaited<ReturnType<typeof createPublicApiWorld>>,
    key: string,
    count: number,
  ) {
    return world.t.run(async (ctx) => {
      const actor = await ctx.db
        .query("users")
        .filter((q) => q.eq(q.field("clerkUserId"), PUBLIC_API_ACTOR.subject))
        .unique();
      if (!actor) throw new Error("actor missing");
      return ctx.db.insert("actionQuotas", {
        orgId: world.orgA,
        actorUserId: actor._id,
        key,
        count,
        windowStart: Date.now() - (Date.now() % 600_000),
      });
    });
  }

  it("enforces authentication, MANAGE permission, and warehouse scope before provider or usage writes", async () => {
    const adminWorld = await createPublicApiWorld(MODULES, "ORG_ADMIN");

    // Anonymous caller
    await expect(
      adminWorld.t.action(api.finishedGoods.jobScans.readJobTicketForSearch, {
        warehouseId: adminWorld.warehouses.alphaA,
        imageDataUrl: VALID_JPEG,
      }),
    ).rejects.toMatchObject({
      data: { kind: "TENANT_CONTEXT_DENIED", code: "ANONYMOUS" },
    });

    // Foreign, out-of-scope, and inactive warehouses
    for (const [warehouseId, code] of [
      [adminWorld.warehouses.alphaB, "WAREHOUSE_UNKNOWN"],
      [adminWorld.warehouses.bravoA, "WAREHOUSE_OUT_OF_SCOPE"],
      [adminWorld.warehouses.deltaA, "WAREHOUSE_INACTIVE"],
    ] as const) {
      await expect(
        adminWorld.t
          .withIdentity(PUBLIC_API_ACTOR)
          .action(api.finishedGoods.jobScans.readJobTicketForSearch, {
            warehouseId,
            imageDataUrl: VALID_JPEG,
          }),
      ).rejects.toMatchObject({
        data: { kind: "TENANT_CONTEXT_DENIED", code },
      });
    }

    // Read-only role (has storageLayout.read but not storageLayout.manage)
    const supervisorWorld = await createPublicApiWorld(MODULES, "SUPERVISOR");
    const denied = await supervisorWorld.t
      .withIdentity(PUBLIC_API_ACTOR)
      .action(api.finishedGoods.jobScans.readJobTicketForSearch, {
        warehouseId: supervisorWorld.warehouses.alphaA,
        imageDataUrl: VALID_JPEG,
      });
    expect(denied).toMatchObject({
      ok: false,
      denial: { kind: "AUTHORIZATION_DENIED", code: "AUTHORIZATION_DENIED" },
    });

    expect(transport).not.toHaveBeenCalled();
    for (const world of [adminWorld, supervisorWorld]) {
      const counts = await world.t.run(async (ctx) => ({
        events: (await ctx.db.query("aiUsageEvents").collect()).length,
        quotas: (await ctx.db.query("actionQuotas").collect()).length,
      }));
      expect(counts).toEqual({ events: 0, quotas: 0 });
    }
  });

  it("validates strict inline JPEG/PNG/WebP data URLs and never fetches remote URLs", async () => {
    const world = await createPublicApiWorld(MODULES);
    const client = world.t.withIdentity(PUBLIC_API_ACTOR);

    for (const bad of [
      "https://example.com/ticket.jpg",
      "http://127.0.0.1/ticket.png",
      "data:image/gif;base64,YWJj",
      "data:image/svg+xml;base64,YWJj",
      "data:image/JPEG;base64,YWJj",
      "data:image/jpeg;base64,",
      "data:image/png;base64,%%%%",
      "data:image/webp;base64,abc",
      "data:image/png;base64,a==a",
      "data:image/jpeg;base64," + "A".repeat(MAX_LOCATION_IMAGE_DATA_URL),
    ]) {
      const result = await client.action(
        api.finishedGoods.jobScans.readJobTicketForSearch,
        { warehouseId: world.warehouses.alphaA, imageDataUrl: bad },
      );
      expect(result).toMatchObject({
        ok: true,
        value: { ok: false, error: { code: "IMAGE_URL_INVALID" } },
      });
    }
    expect(transport).not.toHaveBeenCalled();
    expect(
      await world.t.run((ctx) => ctx.db.query("aiUsageEvents").collect()),
    ).toHaveLength(0);

    for (const valid of [VALID_JPEG, VALID_PNG, VALID_WEBP]) {
      const result = await client.action(
        api.finishedGoods.jobScans.readJobTicketForSearch,
        { warehouseId: world.warehouses.alphaA, imageDataUrl: valid },
      );
      expect(result).toMatchObject({
        ok: true,
        value: {
          ok: true,
          candidates: {
            factoryOrder: "FO69070073",
            productBarcodeText: "FBN-BXVMI004-BOX-00F",
          },
        },
      });
    }
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it("returns only validated lookup candidates, strips other fields, writes no assets/records, and bills AI_SEARCH", async () => {
    const world = await createPublicApiWorld(MODULES);
    const client = world.t.withIdentity(PUBLIC_API_ACTOR);
    transport.mockResolvedValueOnce(
      openRouterResponse(
        {
          factory_order: " FO69070073 ",
          product_barcode_text: " FBN-BXVMI004-BOX-00F ",
          part_name: "Should Never Return",
          customer: "Confidential Customer",
          delivery_date: "6/7/2569",
          quantity: 1000,
        },
        0.00015,
      ),
    );

    const before = await world.t.run(async (ctx) => ({
      scans: await ctx.db.query("finishedGoodsJobScans").collect(),
      assets: await ctx.db.query("jobTicketAssets").collect(),
      zones: await ctx.db.query("storageZones").collect(),
      positions: await ctx.db.query("storagePositions").collect(),
    }));

    const result = await client.action(
      api.finishedGoods.jobScans.readJobTicketForSearch,
      { warehouseId: world.warehouses.alphaA, imageDataUrl: VALID_JPEG },
    );

    expect(result.ok).toBe(true);
    if (!result.ok || !result.value.ok) throw new Error("Expected success");
    expect(result.value).toEqual({
      ok: true,
      candidates: {
        factoryOrder: "FO69070073",
        productBarcodeText: "FBN-BXVMI004-BOX-00F",
      },
    });
    expect(Object.keys(result.value).sort()).toEqual(["candidates", "ok"]);
    expect(Object.keys(result.value.candidates).sort()).toEqual([
      "factoryOrder",
      "productBarcodeText",
    ]);

    // No asset, job scan, or layout writes occurred.
    const after = await world.t.run(async (ctx) => ({
      scans: await ctx.db.query("finishedGoodsJobScans").collect(),
      assets: await ctx.db.query("jobTicketAssets").collect(),
      zones: await ctx.db.query("storageZones").collect(),
      positions: await ctx.db.query("storagePositions").collect(),
    }));
    expect(after).toEqual(before);

    // Usage is tracked strictly under AI_SEARCH (never JOB_TICKET_SCAN).
    const ledger = await world.t.run(async (ctx) => ({
      events: await ctx.db.query("aiUsageEvents").collect(),
      operations: await ctx.db.query("aiUsageOperations").collect(),
    }));
    expect(ledger.events).toHaveLength(1);
    expect(ledger.events[0]).toMatchObject({
      feature: "AI_SEARCH",
      warehouseId: world.warehouses.alphaA,
      status: "SUCCEEDED",
      billingStatus: "REPORTED",
      costUsdNano: 150_000,
    });
    expect(ledger.operations).toHaveLength(1);
    expect(ledger.operations[0]).toMatchObject({
      feature: "AI_SEARCH",
      warehouseId: world.warehouses.alphaA,
      attemptCount: 1,
      knownCostUsdNano: 150_000,
    });

    const summary = await client.query(api.aiUsage.reports.summary, {});
    if (!summary.ok || "error" in summary.value) throw new Error("summary");
    expect(summary.value.byFeature.AI_SEARCH).toMatchObject({
      operationCount: 1,
      knownCostUsdNano: 150_000,
    });
    expect(summary.value.byFeature.JOB_TICKET_SCAN.operationCount).toBe(0);
    expect(summary.value.byFeature.LOCATION_LABEL_SCAN.operationCount).toBe(0);

    // Search photo operation ID cannot be linked as an intake token in saveJobScans.
    const save = await client.mutation(
      api.finishedGoods.jobScans.saveJobScans,
      {
        warehouseId: world.warehouses.alphaA,
        requestId: "refuse-photo-search-token",
        locationText: "Dock A",
        items: [
          {
            source: "AI",
            factoryOrder: "FO69070073",
            productBarcodeText: "FBN-BXVMI004-BOX-00F",
            aiUsageOperationId: result.requestId,
          },
        ],
      },
    );
    expect(save).toMatchObject({
      ok: true,
      value: { written: false, error: { code: "AI_USAGE_LINK_INVALID" } },
    });
  });

  it("supports OpenAI Responses with strict minimal schema and empty candidates when nothing is readable", async () => {
    vi.stubEnv("AI_IMAGE_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "fixture-openai-key");
    vi.stubEnv("OPENAI_IMAGE_MODEL", "fixture-vision-model");
    transport.mockResolvedValueOnce(
      Response.json({
        status: "completed",
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  factory_order: null,
                  product_barcode_text: null,
                }),
              },
            ],
          },
        ],
      }),
    );

    const world = await createPublicApiWorld(MODULES);
    const result = await world.t
      .withIdentity(PUBLIC_API_ACTOR)
      .action(api.finishedGoods.jobScans.readJobTicketForSearch, {
        warehouseId: world.warehouses.alphaA,
        imageDataUrl: VALID_PNG,
      });
    expect(result).toMatchObject({
      ok: true,
      value: { ok: true, candidates: {} },
    });
    expect(transport).toHaveBeenCalledOnce();
    const [url, init] = transport.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "fixture-vision-model",
      store: false,
      service_tier: "default",
      reasoning: { effort: "none" },
      input: [
        { role: "developer", content: JOB_TICKET_SEARCH_PHOTO_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Read the JOB NO. and product barcode text printed on this job ticket.",
            },
            { type: "input_image", image_url: VALID_PNG },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "job_ticket_search_candidates",
          strict: true,
          schema: JOB_TICKET_SEARCH_PHOTO_JSON_SCHEMA,
        },
      },
    });
  });

  it("enforces its own per-actor rate limit atomically before calling the provider or billing usage", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-27T05:00:00Z"));
    const world = await createPublicApiWorld(MODULES);
    const quotaId = await seedQuota(
      world,
      jobScans.JOB_SCAN_PHOTO_SEARCH_AI_RATE_LIMIT.key,
      jobScans.JOB_SCAN_PHOTO_SEARCH_AI_RATE_LIMIT.limit - 1,
    );
    const invoke = () =>
      world.t
        .withIdentity(PUBLIC_API_ACTOR)
        .action(api.finishedGoods.jobScans.readJobTicketForSearch, {
          warehouseId: world.warehouses.alphaA,
          imageDataUrl: VALID_JPEG,
        });

    const results = await Promise.all(Array.from({ length: 4 }, invoke));
    const allowed = results.filter((r) => r.ok && r.value.ok);
    const limited = results.filter((r) => !(r.ok && r.value.ok));
    expect(allowed).toHaveLength(1);
    expect(limited).toHaveLength(3);
    for (const outcome of limited) {
      expect(outcome).toMatchObject({
        ok: true,
        value: {
          ok: false,
          error: { code: "RATE_LIMITED" },
          retryAfterMs: expect.any(Number),
        },
      });
      if (outcome.ok && !outcome.value.ok && "retryAfterMs" in outcome.value)
        expect(outcome.value.retryAfterMs).toBeGreaterThan(0);
    }
    expect(transport).toHaveBeenCalledTimes(1);
    expect(
      await world.t.run((ctx) => ctx.db.query("aiUsageEvents").collect()),
    ).toHaveLength(1);
    expect(
      (await world.t.run((ctx) => ctx.db.get("actionQuotas", quotaId)))?.count,
    ).toBe(jobScans.JOB_SCAN_PHOTO_SEARCH_AI_RATE_LIMIT.limit);
  });

  it("does not fabricate a demo result when unconfigured and handles provider failures without leaking sensitive data", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const world = await createPublicApiWorld(MODULES);
    const client = world.t.withIdentity(PUBLIC_API_ACTOR);

    // Missing API key with JOB_SCAN_DEMO_AI=1 still refuses cleanly
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("JOB_SCAN_DEMO_AI", "1");
    expect(
      await client.action(api.finishedGoods.jobScans.readJobTicketForSearch, {
        warehouseId: world.warehouses.alphaA,
        imageDataUrl: VALID_JPEG,
      }),
    ).toMatchObject({
      ok: true,
      value: { ok: false, error: { code: "AI_UNAVAILABLE" } },
    });
    expect(transport).not.toHaveBeenCalled();

    // Restore key and test 5xx retry -> AI_UNAVAILABLE
    vi.stubEnv("OPENROUTER_API_KEY", KEY_SENTINEL);
    transport.mockImplementation(
      async () =>
        new Response("upstream secret body sentinel", { status: 503 }),
    );
    expect(
      await client.action(api.finishedGoods.jobScans.readJobTicketForSearch, {
        warehouseId: world.warehouses.alphaA,
        imageDataUrl: VALID_JPEG,
      }),
    ).toMatchObject({
      ok: true,
      value: { ok: false, error: { code: "AI_UNAVAILABLE" } },
    });
    expect(transport).toHaveBeenCalledTimes(2);

    // Network error -> AI_UNAVAILABLE (no retry)
    transport.mockReset().mockRejectedValueOnce(new Error("socket sentinel"));
    expect(
      await client.action(api.finishedGoods.jobScans.readJobTicketForSearch, {
        warehouseId: world.warehouses.alphaA,
        imageDataUrl: VALID_JPEG,
      }),
    ).toMatchObject({
      ok: true,
      value: { ok: false, error: { code: "AI_UNAVAILABLE" } },
    });
    expect(transport).toHaveBeenCalledTimes(1);

    // Timeout -> AI_TIMEOUT (no retry)
    transport.mockReset().mockImplementationOnce(
      (_input, init) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    vi.useFakeTimers();
    try {
      const pending = client.action(
        api.finishedGoods.jobScans.readJobTicketForSearch,
        { warehouseId: world.warehouses.alphaA, imageDataUrl: VALID_JPEG },
      );
      await vi.advanceTimersByTimeAsync(
        jobScans.JOB_TICKET_PROVIDER_POLICY.attemptTimeoutMs + 1_000,
      );
      expect(await pending).toMatchObject({
        ok: true,
        value: { ok: false, error: { code: "AI_TIMEOUT" } },
      });
    } finally {
      vi.useRealTimers();
    }
    expect(transport).toHaveBeenCalledTimes(1);

    // Invalid candidate payloads -> AI_UNREADABLE (and billed as UNREADABLE)
    transport.mockReset();
    for (const badPayload of [
      {
        factory_order: "https://evil.test/sentinel",
        product_barcode_text: null,
      },
      { factory_order: "ISAS:LOCATION:1:abc", product_barcode_text: null },
      { factory_order: "FO\nSENTINEL", product_barcode_text: null },
      {
        factory_order: "X".repeat(JOB_TICKET_CODE_LIMITS.factoryOrder + 1),
        product_barcode_text: null,
      },
      { unexpected: "sentinel" },
      "not-json-sentinel",
    ]) {
      transport.mockResolvedValueOnce(openRouterResponse(badPayload, 0.0001));
      expect(
        await client.action(api.finishedGoods.jobScans.readJobTicketForSearch, {
          warehouseId: world.warehouses.alphaA,
          imageDataUrl: VALID_JPEG,
        }),
      ).toMatchObject({
        ok: true,
        value: { ok: false, error: { code: "AI_UNREADABLE" } },
      });
    }

    const events = await world.t.run((ctx) =>
      ctx.db.query("aiUsageEvents").collect(),
    );
    expect(events.filter((e) => e.status === "UNREADABLE")).toHaveLength(6);

    const logs = JSON.stringify(warn.mock.calls);
    expect(logs).not.toContain(KEY_SENTINEL);
    expect(logs).not.toContain(VALID_JPEG);
    expect(logs).not.toContain("sentinel");
    expect(logs).not.toContain("SENTINEL");
  });
});

describe("listJobScans exact field-specific lookup (factoryOrder / productBarcodeText + exactCode)", () => {
  type Fixture = Awaited<ReturnType<typeof seedCollisionFixture>>;
  type ListedPage = {
    status: "ready" | "scanning" | "reset";
    items: { id: string; factoryOrder: string; productBarcodeText: string }[];
    isDone: boolean;
    continueCursor: string;
    scanCursor?: string;
    scanned: number;
  };

  async function seedCollisionFixture() {
    const world = await createConvexTenantWorld({
      "../convex/finishedGoods/jobScanLocations.ts": () =>
        import("../../convex/finishedGoods/jobScanLocations"),
      "../convex/finishedGoods/jobScans.ts": () =>
        import("../../convex/finishedGoods/jobScans"),
      "../convex/finishedGoods/searchIndexBackfill.ts": () =>
        import("../../convex/finishedGoods/searchIndexBackfill"),
    });
    await seedConvexAuthorization(world, { roleA: "ORG_ADMIN" });
    const warehouseId = world.warehouses.alphaA;
    const baseStamps = {
      createdAt: 1,
      updatedAt: 1,
      createdByUserId: world.userA,
      updatedByUserId: world.userA,
    };

    const ids = await world.t.run(async (ctx) => {
      const buildingId = await ctx.db.insert("storageBuildings", {
        orgId: world.orgA,
        warehouseId,
        code: "FG1",
        name: "North Hall",
        widthMm: 10000,
        depthMm: 10000,
        defaultFloorHeightMm: 3000,
        floorCount: 1,
        totalHeightMm: 3000,
        grossAreaSqMm: 100000000,
        reservedAreaSqMm: 0,
        usableAreaSqMm: 100000000,
        status: "ACTIVE",
        version: 1,
        ...baseStamps,
      });
      const floorId = await ctx.db.insert("storageFloors", {
        orgId: world.orgA,
        warehouseId,
        buildingId,
        floorNumber: 1,
        widthMm: 10000,
        depthMm: 10000,
        heightMm: 3000,
        grossAreaSqMm: 100000000,
        reservedAreaSqMm: 0,
        usableAreaSqMm: 100000000,
        version: 1,
        updatedAt: 1,
        updatedByUserId: world.userA,
      });
      const scan = (
        createdAt: number,
        row: Partial<Doc<"finishedGoodsJobScans">> & {
          factoryOrder: string;
          productBarcodeText: string;
          locationText: string;
          mapped: boolean;
        },
      ) =>
        ctx.db.insert("finishedGoodsJobScans", {
          orgId: world.orgA,
          warehouseId,
          source: "MANUAL",
          createdAt,
          updatedAt: createdAt,
          createdByUserId: world.userA,
          updatedByUserId: world.userA,
          ...row,
        });

      const sharedCode = "CODE-999";
      const longBarcode = `LONG-${"X".repeat(260)}`;
      const sharedBarcode = "SHARED-BAR-01";
      const sharedBarcodeIds: Id<"finishedGoodsJobScans">[] = [];
      for (let i = 0; i < 10; i++) {
        sharedBarcodeIds.push(
          await scan(500 + i, {
            factoryOrder: `FO690000${String(i).padStart(2, "0")}`,
            productBarcodeText: sharedBarcode,
            locationText: "Dock S",
            mapped: i % 2 === 0,
          }),
        );
      }

      return {
        buildingId,
        floorId,
        sharedCode,
        longBarcode,
        sharedBarcode,
        sharedBarcodeIds,
        // Cross-field collision records for "CODE-999"
        foExact: await scan(1_010, {
          factoryOrder: sharedCode,
          productBarcodeText: "OTHER-BAR-1",
          locationText: "Dock 1",
          mapped: true,
          buildingId,
          floorId,
        }),
        foPrefix: await scan(1_020, {
          factoryOrder: `${sharedCode}0`,
          productBarcodeText: "OTHER-BAR-2",
          locationText: "Dock 2",
          mapped: true,
          buildingId,
          floorId,
        }),
        foSuffix: await scan(1_030, {
          factoryOrder: `PRE-${sharedCode}`,
          productBarcodeText: "OTHER-BAR-3",
          locationText: "Dock 3",
          mapped: true,
          buildingId,
          floorId,
        }),
        barcodeExact: await scan(1_040, {
          factoryOrder: "OTHER-FO-1",
          productBarcodeText: sharedCode,
          locationText: "Dock 4",
          mapped: true,
          buildingId,
          floorId,
        }),
        barcodePrefix: await scan(1_050, {
          factoryOrder: "OTHER-FO-2",
          productBarcodeText: `${sharedCode}0`,
          locationText: "Dock 5",
          mapped: true,
          buildingId,
          floorId,
        }),
        locationCollision: await scan(1_060, {
          factoryOrder: "OTHER-FO-3",
          productBarcodeText: "OTHER-BAR-4",
          locationText: sharedCode,
          locationCode: sharedCode,
          mapped: true,
          buildingId,
          floorId,
        }),
        partCustomerCollision: await scan(1_070, {
          factoryOrder: "OTHER-FO-4",
          productBarcodeText: "OTHER-BAR-5",
          partName: sharedCode,
          customer: sharedCode,
          locationText: "Dock 6",
          mapped: false,
        }),
        // Historical non-standard factoryOrder with padding/mixed-case/fullwidth
        historicalFo: await scan(1_080, {
          factoryOrder: "  FO-1  ",
          productBarcodeText: "FBN-BOX-01",
          locationText: "Dock H",
          mapped: false,
        }),
        historicalFoPrefix: await scan(1_090, {
          factoryOrder: "FO-10",
          productBarcodeText: "FBN-BOX-010",
          locationText: "Dock H2",
          mapped: false,
        }),
        // Short (< 3 code points) exact codes
        shortFo: await scan(1_100, {
          factoryOrder: "A1",
          productBarcodeText: "B10",
          locationText: "Dock S1",
          mapped: false,
        }),
        shortFoPrefixAndShortBarcode: await scan(1_110, {
          factoryOrder: "A10",
          productBarcodeText: "B1",
          locationText: "Dock S2",
          mapped: false,
        }),
        shortCrossCollision: await scan(1_120, {
          factoryOrder: "B1",
          productBarcodeText: "A1",
          locationText: "Dock S3",
          mapped: false,
        }),
        // Long (> 256 chars) historical barcode
        longBarcodeRow: await scan(1_130, {
          factoryOrder: "FO69990001",
          productBarcodeText: longBarcode,
          locationText: "Dock L",
          mapped: false,
        }),
        // Second exact match for CODE-999 in factoryOrder to test pagination
        foExactSecond: await scan(1_140, {
          factoryOrder: "  ｃｏｄｅ－９９９ ",
          productBarcodeText: "OTHER-BAR-6",
          locationText: "Dock 7",
          mapped: false,
        }),
      };
    });

    return { world, warehouseId, ids };
  }

  async function buildIndex(fixture: Fixture) {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + RECONCILE_MARGIN_MS + 1_000);
      let cursor: string | undefined;
      let runId: string | undefined;
      for (let i = 0; i < 50; i++) {
        const res = (await fixture.world.t.run((ctx) =>
          (backfill.run as unknown as Runtime)._handler(ctx, {
            warehouseId: fixture.warehouseId,
            kind: "jobScans",
            ...(cursor ? { cursor, runId } : { restart: true }),
            batchSize: 50,
          }),
        )) as {
          isDone: boolean;
          ready: boolean;
          continueCursor: string;
          runId: string;
        };
        if (res.isDone) {
          expect(res.ready).toBe(true);
          return;
        }
        cursor = res.continueCursor;
        runId = res.runId;
      }
      throw new Error("Backfill did not complete.");
    } finally {
      vi.useRealTimers();
    }
  }

  async function setIndexState(
    world: ConvexTenantWorld,
    state: "ready" | "unready" | "stale" | "missing",
  ) {
    await world.t.run(async (ctx) => {
      const row = await ctx.db
        .query("searchIndexReadiness")
        .withIndex("by_orgId_warehouseId_kind", (q) =>
          q
            .eq("orgId", world.orgA)
            .eq("warehouseId", world.warehouses.alphaA)
            .eq("kind", "jobScans"),
        )
        .unique();
      if (state === "missing") {
        if (row) await ctx.db.delete(row._id);
        return;
      }
      if (!row) throw new Error("readiness row missing");
      await ctx.db.patch(row._id, {
        ready: state === "ready",
        stale: state === "stale",
      });
    });
  }

  async function listAll(
    fixture: Fixture,
    args: {
      filter: "ALL" | "MAPPED" | "UNMAPPED";
      search?: string;
      searchField?: JobScanSearchField;
      exactCode?: boolean;
      facets?: {
        building?: string;
        floor?: number;
        storageFormat?: "PALLET" | "BOX" | "OTHER";
      };
      pageSize?: number;
    },
  ) {
    const client = fixture.world.t.withIdentity(IDENTITY);
    const items: string[] = [];
    let totalScanned = 0;
    let cursor: string | undefined;
    for (let pageNo = 0; pageNo < 50; pageNo++) {
      let scanCursor: string | undefined;
      let page: ListedPage;
      do {
        const outcome = (await client.query(
          api.finishedGoods.jobScans.listJobScans,
          {
            warehouseId: fixture.warehouseId,
            progressive: true,
            pageSize: args.pageSize ?? 2,
            ...args,
            ...(cursor ? { cursor } : {}),
            ...(scanCursor ? { scanCursor } : {}),
          },
        )) as { ok: true; value: ListedPage };
        expect(outcome.ok).toBe(true);
        page = outcome.value;
        totalScanned += page.scanned;
        scanCursor = page.scanCursor;
      } while (page.status === "scanning");
      expect(page.status).toBe("ready");
      items.push(...page.items.map((item) => item.id));
      if (page.isDone) return { items, totalScanned };
      cursor = page.continueCursor;
    }
    throw new Error("Pagination did not finish.");
  }

  it("isolates exact factoryOrder and productBarcodeText lookups from other fields, prefixes, and suffixes across indexed and fallback paths", async () => {
    const fixture = await seedCollisionFixture();
    await buildIndex(fixture);
    const { ids } = fixture;

    for (const mode of ["ready", "unready", "stale", "missing"] as const) {
      await setIndexState(fixture.world, mode);

      // Exact factoryOrder: matches only factoryOrder (case + width + trim normalized), never productBarcodeText/location/part/prefix/suffix
      const fo = await listAll(fixture, {
        filter: "ALL",
        search: " ｃｏｄｅ－９９９ ",
        searchField: "factoryOrder",
        exactCode: true,
        pageSize: 1,
      });
      expect(fo.items).toEqual([ids.foExactSecond, ids.foExact]);
      if (mode === "ready") {
        // Indexed exact field lookup streams only the 2 matching rows (page 1 looks ahead 1 row -> 2 + 1 = 3; single page scans exactly 2).
        const singlePage = await listAll(fixture, {
          filter: "ALL",
          search: " ｃｏｄｅ－９９９ ",
          searchField: "factoryOrder",
          exactCode: true,
          pageSize: 10,
        });
        expect(singlePage.items).toEqual([ids.foExactSecond, ids.foExact]);
        expect(singlePage.totalScanned).toBe(2);
      }

      // Exact productBarcodeText: matches only productBarcodeText, never factoryOrder/location/prefix
      const bar = await listAll(fixture, {
        filter: "ALL",
        search: "code-999",
        searchField: "productBarcodeText",
        exactCode: true,
        pageSize: 1,
      });
      expect(bar.items).toEqual([ids.barcodeExact]);
      if (mode === "ready") {
        expect(bar.totalScanned).toBe(1);
      }

      // Existing cross-field exactCode (no searchField) still matches factoryOrder, productBarcodeText, and location
      expect(
        (
          await listAll(fixture, {
            filter: "ALL",
            search: ids.sharedCode,
            exactCode: true,
          })
        ).items,
      ).toEqual([
        ids.foExactSecond,
        ids.locationCollision,
        ids.barcodeExact,
        ids.foExact,
      ]);

      // Existing non-exact searchField preserves substring matching (including prefix & suffix hits)
      expect(
        (
          await listAll(fixture, {
            filter: "ALL",
            search: "FO-1",
            searchField: "factoryOrder",
          })
        ).items,
      ).toEqual([ids.historicalFoPrefix, ids.historicalFo, ids.barcodeExact]);
      expect(
        (
          await listAll(fixture, {
            filter: "ALL",
            search: "FBN-BOX-01",
            searchField: "productBarcodeText",
          })
        ).items,
      ).toEqual([ids.historicalFoPrefix, ids.historicalFo]);

      // Exact field-specific lookup on historical non-FO factoryOrder & productBarcodeText excludes prefixes
      expect(
        (
          await listAll(fixture, {
            filter: "ALL",
            search: "ｆｏ－１",
            searchField: "factoryOrder",
            exactCode: true,
          })
        ).items,
      ).toEqual([ids.historicalFo]);
      expect(
        (
          await listAll(fixture, {
            filter: "ALL",
            search: " ｆｂｎ－ｂｏｘ－０１ ",
            searchField: "productBarcodeText",
            exactCode: true,
          })
        ).items,
      ).toEqual([ids.historicalFo]);

      // Short (< 3 code points) exact field-specific lookups use bounded fallback and exclude prefixes & cross-field collisions
      expect(
        (
          await listAll(fixture, {
            filter: "ALL",
            search: "a1",
            searchField: "factoryOrder",
            exactCode: true,
          })
        ).items,
      ).toEqual([ids.shortFo]);
      expect(
        (
          await listAll(fixture, {
            filter: "ALL",
            search: "b1",
            searchField: "productBarcodeText",
            exactCode: true,
          })
        ).items,
      ).toEqual([ids.shortFoPrefixAndShortBarcode]);

      // Long (> 256 chars) hashed term and shared (> 8 rows) term both work identically
      expect(
        (
          await listAll(fixture, {
            filter: "ALL",
            search: ids.longBarcode,
            searchField: "productBarcodeText",
            exactCode: true,
          })
        ).items,
      ).toEqual([ids.longBarcodeRow]);

      const expectedSharedMapped = [...ids.sharedBarcodeIds]
        .reverse()
        .filter((_, idx) => (9 - idx) % 2 === 0);
      expect(
        (
          await listAll(fixture, {
            filter: "MAPPED",
            search: ids.sharedBarcode,
            searchField: "productBarcodeText",
            exactCode: true,
            pageSize: 2,
          })
        ).items,
      ).toEqual(expectedSharedMapped);

      // Combined with facets (building) and filter (MAPPED)
      expect(
        (
          await listAll(fixture, {
            filter: "MAPPED",
            search: ids.sharedCode,
            searchField: "factoryOrder",
            exactCode: true,
            facets: { building: "North Hall" },
          })
        ).items,
      ).toEqual([ids.foExact]);
    }
  });

  it("ignores registered location aliases and keeps working after an unmaintained layout generation bump", async () => {
    const fixture = await seedCollisionFixture();
    const { world, warehouseId, ids } = fixture;
    const client = world.t.withIdentity(IDENTITY);

    // Register a location whose code aliases `maß` -> `MASS`
    const created = await client.mutation(
      api.finishedGoods.jobScanLocations.create,
      {
        warehouseId,
        buildingId: ids.buildingId,
        code: "maß",
        name: "Alias Bay",
        requestId: "alias-bay",
      },
    );
    expect(created).toMatchObject({ ok: true, value: { written: true } });

    await world.t.run(async (ctx) => {
      await ctx.db.patch(ids.barcodeExact, { productBarcodeText: "maß" });
      await ctx.db.patch(ids.barcodePrefix, { productBarcodeText: "MASS" });
    });
    await buildIndex(fixture);

    // Bump layout generation without updating readiness to simulate an unmaintained layout write
    await world.t.run(async (ctx) => {
      await ctx.db.insert("storageCatalogueSignals", {
        orgId: world.orgA,
        warehouseId,
        generation: 99,
      });
    });

    // Exact productBarcodeText search for `maß` is NOT hijacked by location alias `MASS`
    expect(
      (
        await listAll(fixture, {
          filter: "ALL",
          search: "maß",
          searchField: "productBarcodeText",
          exactCode: true,
        })
      ).items,
    ).toEqual([ids.barcodeExact]);
    expect(
      (
        await listAll(fixture, {
          filter: "ALL",
          search: "MASS",
          searchField: "productBarcodeText",
          exactCode: true,
        })
      ).items,
    ).toEqual([ids.barcodePrefix]);
  });

  it("isolates cursor scopes across exactCode and searchField combinations in both indexed and fallback paths", async () => {
    const fixture = await seedCollisionFixture();
    await buildIndex(fixture);
    const { ids } = fixture;
    const client = fixture.world.t.withIdentity(IDENTITY);

    const fetchPage = async (args: {
      search: string;
      searchField?: JobScanSearchField;
      exactCode?: boolean;
      cursor?: string;
    }) => {
      const outcome = (await client.query(
        api.finishedGoods.jobScans.listJobScans,
        {
          warehouseId: fixture.warehouseId,
          filter: "ALL",
          pageSize: 1,
          progressive: true,
          ...args,
        },
      )) as { ok: true; value: ListedPage };
      expect(outcome.ok).toBe(true);
      return outcome.value;
    };

    for (const mode of ["ready", "unready"] as const) {
      await setIndexState(fixture.world, mode);

      const first = await fetchPage({
        search: ids.sharedCode,
        searchField: "factoryOrder",
        exactCode: true,
      });
      expect(first.status).toBe("ready");
      expect(first.continueCursor).not.toBe("");

      // Switching exactCode off resets cursor
      expect(
        await fetchPage({
          search: ids.sharedCode,
          searchField: "factoryOrder",
          exactCode: false,
          cursor: first.continueCursor,
        }),
      ).toMatchObject({ status: "reset", items: [] });

      // Switching searchField to productBarcodeText resets cursor
      expect(
        await fetchPage({
          search: ids.sharedCode,
          searchField: "productBarcodeText",
          exactCode: true,
          cursor: first.continueCursor,
        }),
      ).toMatchObject({ status: "reset", items: [] });

      // Switching to cross-field exactCode (no searchField) resets cursor
      expect(
        await fetchPage({
          search: ids.sharedCode,
          exactCode: true,
          cursor: first.continueCursor,
        }),
      ).toMatchObject({ status: "reset", items: [] });

      // Switching to manual search resets cursor
      expect(
        await fetchPage({
          search: ids.sharedCode,
          cursor: first.continueCursor,
        }),
      ).toMatchObject({ status: "reset", items: [] });
    }
  });
});
