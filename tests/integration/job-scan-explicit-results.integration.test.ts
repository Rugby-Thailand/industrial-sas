import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import * as commands from "../../convex/finishedGoods/commands";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
} from "../fixtures/convex-tenant-world";

const identity = { subject: "user_fixture_a", org_id: "org_fixture_a" };
const scans = api.finishedGoods.jobScans;
const fields = { factoryOrder: "FO-1", productBarcodeText: "PRODUCT-1" };

async function world(roleA: "ORG_ADMIN" | "SUPERVISOR" = "ORG_ADMIN") {
  const w = await createConvexTenantWorld({
    "../convex/finishedGoods/jobScans.ts": () =>
      import("../../convex/finishedGoods/jobScans"),
    "../convex/lib/tenantFunctions.ts": () =>
      import("../../convex/lib/tenantFunctions"),
  });
  await seedConvexAuthorization(w, { roleA });
  return {
    w,
    client: w.t.withIdentity(identity),
    warehouseId: w.warehouses.alphaA,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("registered job-scan result contracts", () => {
  it("validates save/correction successes, replays and domain refusals", async () => {
    const { w, client, warehouseId } = await world();
    const save = {
      warehouseId,
      requestId: "explicit-save",
      locationText: "Dock A",
      items: [{ ...fields, source: "MANUAL" as const }],
    };
    const first = await client.mutation(scans.saveJobScans, save);
    expect(first).toMatchObject({
      ok: true,
      requestId: expect.any(String),
      value: { written: true, documentId: expect.any(String), replayed: false },
    });
    if (!first.ok || !first.value.written) throw new Error("setup");
    const documentId = first.value.documentId;
    // The write envelope intentionally returns a string; normalize it for the
    // correction's branded argument rather than changing the wire contract.
    const jobScanId = await w.t.run(async (ctx) =>
      ctx.db.normalizeId("finishedGoodsJobScans", documentId),
    );
    if (jobScanId === null) throw new Error("Expected a job-scan ID");
    expect(await client.mutation(scans.saveJobScans, save)).toMatchObject({
      ok: true,
      value: { written: true, documentId, replayed: true },
    });
    expect(
      await client.mutation(scans.saveJobScans, {
        ...save,
        requestId: "explicit-empty",
        items: [],
      }),
    ).toMatchObject({
      ok: true,
      value: { written: false, error: { code: "SCAN_GROUP_SIZE_INVALID" } },
    });
    expect(
      await client.mutation(scans.saveJobScans, {
        ...save,
        requestId: "explicit-field",
        items: [{ ...save.items[0]!, quantity: -1 }],
      }),
    ).toMatchObject({
      ok: true,
      value: {
        written: false,
        error: { code: "FIELD_INVALID", field: "quantity" },
      },
    });
    const correction = {
      warehouseId,
      jobScanId,
      requestId: "explicit-correct",
      expectedVersion: 1,
      fields: { ...fields, quantity: 12 },
    };
    for (const replayed of [false, true]) {
      expect(
        await client.mutation(scans.updateJobScan, correction),
      ).toMatchObject({
        ok: true,
        requestId: expect.any(String),
        value: { written: true, documentId, replayed },
      });
    }
    expect(
      await client.mutation(scans.updateJobScan, {
        ...correction,
        requestId: "explicit-stale",
      }),
    ).toMatchObject({
      ok: true,
      value: { written: false, error: { code: "STALE_REVISION" } },
    });
    expect(
      await w.t.run((ctx) => ctx.db.query("finishedGoodsJobScans").collect()),
    ).toHaveLength(1);
    expect(await w.t.run((ctx) => ctx.db.get(jobScanId))).toMatchObject({
      quantity: 12,
      version: 2,
    });
  });

  it("validates tenant-wrapper authorization denials for all three endpoints", async () => {
    const { w, client, warehouseId } = await world("SUPERVISOR");
    const jobScanId = await w.t.run(async (ctx) => {
      const id = await ctx.db.insert("finishedGoodsJobScans", {
        ...fields,
        source: "MANUAL",
        orgId: w.orgA,
        warehouseId,
        locationText: "Dock A",
        mapped: false,
        createdAt: 1,
        updatedAt: 1,
        createdByUserId: w.userA,
        updatedByUserId: w.userA,
      });
      return id;
    });
    const results = [
      await client.action(scans.extractJobTicket, {
        warehouseId,
        imageUrl: "https://example.test/ticket.jpg",
      }),
      await client.mutation(scans.saveJobScans, {
        warehouseId,
        requestId: "denied-save",
        locationText: "Dock A",
        items: [],
      }),
      await client.mutation(scans.updateJobScan, {
        warehouseId,
        jobScanId,
        requestId: "denied-correct",
        expectedVersion: 1,
        fields,
      }),
    ];
    for (const result of results) {
      expect(result).toMatchObject({
        ok: false,
        requestId: expect.any(String),
        denial: {
          kind: "AUTHORIZATION_DENIED",
          code: "AUTHORIZATION_DENIED",
          requestId: result.requestId,
        },
      });
    }
  });

  it("validates extraction success with partial fields and optional AI provenance", async () => {
    const { client, warehouseId } = await world();
    const args = { warehouseId, imageUrl: "https://example.test/ticket.jpg" };
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("JOB_SCAN_DEMO_AI", "1");
    expect(await client.action(scans.extractJobTicket, args)).toMatchObject({
      ok: true,
      value: {
        ok: true,
        mock: true,
        fields: { factoryOrder: "FO69070073" },
        raw: expect.any(String),
      },
    });
    vi.stubEnv("OPENROUTER_API_KEY", "fixture-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: '{"factory_order":"FO-2","quantity":"1,000"}',
                  },
                },
              ],
            }),
            { status: 200 },
          ),
      ),
    );
    const result = await client.action(scans.extractJobTicket, args);
    expect(result).toMatchObject({
      ok: true,
      value: {
        ok: true,
        mock: false,
        aiUsageOperationId: result.requestId,
        fields: { factoryOrder: "FO-2", quantity: 1000 },
        raw: expect.any(String),
      },
    });
    // Each extraction gets its own request ID, even for an identical image.
    const next = await client.action(scans.extractJobTicket, args);
    expect(next.requestId).not.toBe(result.requestId);
  });

  it("validates invalid images and unavailable extraction", async () => {
    const { client, warehouseId } = await world();
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("JOB_SCAN_DEMO_AI", "0");
    expect(
      await client.action(scans.extractJobTicket, {
        warehouseId,
        imageUrl: "invalid",
      }),
    ).toMatchObject({
      ok: true,
      value: { ok: false, error: { code: "IMAGE_URL_INVALID" } },
    });
    expect(
      await client.action(scans.extractJobTicket, {
        warehouseId,
        imageUrl: "https://example.test/ticket.jpg",
      }),
    ).toMatchObject({
      ok: true,
      value: { ok: false, error: { code: "AI_UNAVAILABLE" } },
    });
  });

  it("rejects an extra result field through the registered return validator", async () => {
    const { client, warehouseId } = await world();
    const malformed = {
      written: true as const,
      documentId: "synthetic",
      replayed: false,
      unexpected: true,
    };
    vi.spyOn(commands, "command").mockResolvedValueOnce(malformed);
    await expect(
      client.mutation(scans.saveJobScans, {
        warehouseId,
        requestId: "malformed-result",
        locationText: "Dock A",
        items: [],
      }),
    ).rejects.toThrow("Return value validation failed");
  });
});
