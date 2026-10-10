import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
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
const transport = vi.fn<typeof fetch>();
const image = "data:image/jpeg;base64,YWJj";
const provider = (content: unknown) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(content) } }],
    }),
    { status: 200 },
  );
beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_KEY", "synthetic-secret-sentinel");
  vi.stubEnv("OPENROUTER_MODEL", "fixture-model");
  vi.stubGlobal("fetch", transport);
  transport
    .mockReset()
    .mockResolvedValue(
      provider({ candidates: [{ code: "F1-L3-11", labelText: null }] }),
    );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it("uses the authorized registered action, sends the location schema and returns only reviewed candidates without writing", async () => {
  const w = await createPublicApiWorld(MODULES);
  const before = await w.t.run(async (ctx) => ({
    scans: await ctx.db.query("finishedGoodsJobScans").collect(),
    zones: await ctx.db.query("storageZones").collect(),
    positions: await ctx.db.query("storagePositions").collect(),
  }));
  const result = await w.t
    .withIdentity(PUBLIC_API_ACTOR)
    .action(api.finishedGoods.locationImage.extractLocationLabel, {
      warehouseId: w.warehouses.alphaA,
      imageDataUrl: image,
    });
  expect(result).toMatchObject({
    ok: true,
    value: { ok: true, candidates: [{ code: "F1-L3-11", labelText: null }] },
  });
  expect(transport).toHaveBeenCalledOnce();
  const request = JSON.parse(String(transport.mock.calls[0]![1]?.body));
  expect(request).toMatchObject({
    model: "fixture-model",
    response_format: {
      type: "json_schema",
      json_schema: { name: "location_label", strict: true },
    },
  });
  expect(request.messages[1].content[1].image_url.url).toBe(image);
  expect(request.messages[0].content).toMatch(/Do not invent/);
  const after = await w.t.run(async (ctx) => ({
    scans: await ctx.db.query("finishedGoodsJobScans").collect(),
    zones: await ctx.db.query("storageZones").collect(),
    positions: await ctx.db.query("storagePositions").collect(),
  }));
  expect(after).toEqual(before);
});

it.each(["foreign", "inactive"])(
  "denies the %s warehouse before paid extraction",
  async (kind) => {
    const w = await createPublicApiWorld(MODULES);
    const request = w.t
      .withIdentity(PUBLIC_API_ACTOR)
      .action(api.finishedGoods.locationImage.extractLocationLabel, {
        warehouseId:
          kind === "foreign" ? w.warehouses.alphaB : w.warehouses.deltaA,
        imageDataUrl: image,
      });
    await expect(request).rejects.toMatchObject({
      data: {
        kind: "TENANT_CONTEXT_DENIED",
        code: kind === "foreign" ? "WAREHOUSE_UNKNOWN" : "WAREHOUSE_INACTIVE",
      },
    });
    expect(transport).not.toHaveBeenCalled();
  },
);

it("refuses remote URLs and oversized input before calling the provider", async () => {
  const w = await createPublicApiWorld(MODULES);
  for (const imageDataUrl of [
    "https://example.com/photo.png",
    "data:image/png;base64,%%%%",
    "a".repeat(4_000_001),
  ]) {
    const result = await w.t
      .withIdentity(PUBLIC_API_ACTOR)
      .action(api.finishedGoods.locationImage.extractLocationLabel, {
        warehouseId: w.warehouses.alphaA,
        imageDataUrl,
      });
    expect(result).toMatchObject({
      value: { ok: false, error: { code: "IMAGE_URL_INVALID" } },
    });
  }
  expect(transport).not.toHaveBeenCalled();
});

it("does not fabricate a demo result when the provider is unconfigured", async () => {
  vi.stubEnv("OPENROUTER_API_KEY", "");
  vi.stubEnv("JOB_SCAN_DEMO_AI", "1");
  const w = await createPublicApiWorld(MODULES);
  expect(
    await w.t
      .withIdentity(PUBLIC_API_ACTOR)
      .action(api.finishedGoods.locationImage.extractLocationLabel, {
        warehouseId: w.warehouses.alphaA,
        imageDataUrl: image,
      }),
  ).toMatchObject({ value: { ok: false, error: { code: "AI_UNAVAILABLE" } } });
  expect(transport).not.toHaveBeenCalled();
});

it("rejects malformed model data without logging extracted text, the photo or credentials", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  transport.mockResolvedValue(
    provider({
      candidates: [
        { code: "sensitive-sentinel", labelText: null, extra: true },
      ],
    }),
  );
  const w = await createPublicApiWorld(MODULES);
  expect(
    await w.t
      .withIdentity(PUBLIC_API_ACTOR)
      .action(api.finishedGoods.locationImage.extractLocationLabel, {
        warehouseId: w.warehouses.alphaA,
        imageDataUrl: image,
      }),
  ).toMatchObject({ value: { ok: false, error: { code: "AI_UNREADABLE" } } });
  const logs = JSON.stringify(warn.mock.calls);
  expect(logs).not.toContain("sentinel");
  expect(logs).not.toContain(image);
});
