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
  vi.stubEnv("OPENROUTER_API_KEY", "synthetic");
  vi.stubGlobal("fetch", transport);
  transport.mockReset().mockImplementation(async () =>
    Response.json({
      choices: [{ message: { content: JSON.stringify({ candidates: [] }) } }],
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it.each([
  ["ticket", 20],
  ["location", 20],
  ["ticket", 19],
  ["location", 19],
] as const)(
  "%s with %i used units admits only remaining concurrent work before provider or billable attempts",
  async (kind, count) => {
    const w = await createPublicApiWorld(modules);
    await w.t.run(async (ctx) => {
      const actor = await ctx.db
        .query("users")
        .filter((q) => q.eq(q.field("clerkUserId"), PUBLIC_API_ACTOR.subject))
        .unique();
      if (!actor) throw new Error("actor missing");
      await ctx.db.insert("actionQuotas", {
        orgId: w.orgA,
        actorUserId: actor._id,
        key:
          kind === "ticket"
            ? "finishedGoods.jobTicket.ai"
            : "finishedGoods.locationLabel.ai",
        count,
        windowStart: Date.now() - (Date.now() % 600_000),
      });
    });
    const invoke = () =>
      kind === "ticket"
        ? w.t
            .withIdentity(PUBLIC_API_ACTOR)
            .action(api.finishedGoods.jobScans.extractJobTicket, {
              warehouseId: w.warehouses.alphaA,
              imageUrl: "data:image/jpeg;base64,YWJj",
            })
        : w.t
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
        expect(result.value.retryAfterMs).toBeGreaterThan(0);
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
    const quotas = await w.t.run((ctx) =>
      ctx.db.query("actionQuotas").collect(),
    );
    expect(
      quotas.find((row) => row.key.startsWith("finishedGoods."))?.count,
    ).toBe(20);
  },
);
