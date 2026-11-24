import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import {
  PUBLIC_API_ACTOR,
  createPublicApiWorld,
} from "../fixtures/public-api-examples";

const modules = Object.fromEntries(
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
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-24T04:27:00Z"));
  vi.stubEnv("AI_IMAGE_PROVIDER", "openrouter");
  vi.stubEnv("OPENROUTER_API_KEY", "synthetic");
  vi.stubGlobal("fetch", transport);
  transport.mockReset().mockImplementation(async () =>
    Response.json({
      choices: [{ message: { content: JSON.stringify({ candidates: [] }) } }],
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function seedQuota(
  w: Awaited<ReturnType<typeof createPublicApiWorld>>,
  key: string,
  count: number,
) {
  return w.t.run(async (ctx) => {
    const actor = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("clerkUserId"), PUBLIC_API_ACTOR.subject))
      .unique();
    if (!actor) throw new Error("actor missing");
    return ctx.db.insert("actionQuotas", {
      orgId: w.orgA,
      actorUserId: actor._id,
      key,
      count,
      windowStart: Date.now() - (Date.now() % 600_000),
    });
  });
}

it("reads 51 Job Ticket photos in one window despite an exhausted legacy quota", async () => {
  const w = await createPublicApiWorld(modules);
  const quotaId = await seedQuota(w, "finishedGoods.jobTicket.ai", 20);
  transport.mockImplementation(async () =>
    Response.json({
      choices: [{ message: { content: '{"factory_order":"FO-1"}' } }],
    }),
  );
  const client = w.t.withIdentity(PUBLIC_API_ACTOR);

  for (let index = 0; index < 51; index++) {
    const result = await client.action(
      api.finishedGoods.jobScans.extractJobTicket,
      {
        warehouseId: w.warehouses.alphaA,
        imageUrl: "data:image/jpeg;base64,YWJj",
      },
    );
    expect(result).toMatchObject({
      ok: true,
      value: { ok: true, mock: false, fields: { factoryOrder: "FO-1" } },
    });
  }
  expect(transport).toHaveBeenCalledTimes(51);
  const quotas = await w.t.run((ctx) => ctx.db.query("actionQuotas").collect());
  expect(quotas).toMatchObject([{ _id: quotaId, count: 20 }]);
});

it.each([20, 19])(
  "location photos with %i used units admit only remaining concurrent work before provider or billable attempts",
  async (count) => {
    const w = await createPublicApiWorld(modules);
    const quotaId = await seedQuota(w, "finishedGoods.locationLabel.ai", count);
    const invoke = () =>
      w.t
        .withIdentity(PUBLIC_API_ACTOR)
        .action(api.finishedGoods.locationImage.extractLocationLabel, {
          warehouseId: w.warehouses.alphaA,
          imageDataUrl: "data:image/jpeg;base64,YWJj",
        });
    const results = await Promise.all(Array.from({ length: 4 }, invoke));
    const allowed = results.filter((result) => result.ok && result.value.ok);
    expect(allowed).toHaveLength(20 - count);
    for (const result of results.filter(
      (result) => !(result.ok && result.value.ok),
    )) {
      expect(result).toMatchObject({
        value: { ok: false, error: { code: "RATE_LIMITED" } },
      });
      if (result.ok && !result.value.ok)
        expect(
          "retryAfterMs" in result.value
            ? result.value.retryAfterMs
            : undefined,
        ).toBeGreaterThan(0);
    }
    expect(transport).toHaveBeenCalledTimes(20 - count);
    const attempts = await w.t.run((ctx) =>
      ctx.db.query("aiUsageEvents").collect(),
    );
    expect(attempts).toHaveLength(20 - count);
    const operations = await w.t.run((ctx) =>
      ctx.db.query("aiUsageOperations").collect(),
    );
    expect(operations).toHaveLength(20 - count);
    // The synthetic provider gives no usage/cost metadata. Admitted unknown cost remains unknown.
    for (const attempt of attempts) expect(attempt.costUsdNano).toBeUndefined();
    for (const operation of operations)
      expect(operation.unknownAttemptCount).toBe(1);
    const quota = await w.t.run((ctx) => ctx.db.get("actionQuotas", quotaId));
    expect(quota?.count).toBe(20);
  },
);
