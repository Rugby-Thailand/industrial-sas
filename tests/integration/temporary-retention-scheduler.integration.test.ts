import { describe, expect, it, vi } from "vitest";
import { internal } from "../../convex/_generated/api";
import { DEFAULT_ORGANIZATION_SETTINGS } from "../../convex/lib/organizationDefaults";
import { createConvexTenantWorld } from "../fixtures/convex-tenant-world";

const modules = {
  "../convex/operations/temporaryRetention.ts": () =>
    import("../../convex/operations/temporaryRetention"),
};
const refs = internal.operations.temporaryRetention;

describe("scheduled temporary retention", () => {
  it("traverses organization and expiry pages while retaining live requests and permanent cancellation fences", async () => {
    vi.useFakeTimers();
    try {
      const world = await createConvexTenantWorld(modules);
      const cutoff = Date.now();
      const expiry = cutoff - 1;
      const orgs = await world.t.run(async (ctx) => {
        const ids = [world.orgA, world.orgB];
        for (let i = 0; i < 25; i++)
          ids.push(
            await ctx.db.insert("organizations", {
              clerkOrganizationId: `retention-${i}`,
              name: "Retention test",
              status: "ACTIVE",
              settings: DEFAULT_ORGANIZATION_SETTINGS,
            }),
          );
        for (const orgId of ids)
          for (let i = 0; i < (orgId === world.orgA ? 205 : 1); i++)
            await ctx.db.insert("idempotencyRecords", {
              orgId,
              operation: "test",
              requestId: `expired-${i}`,
              status: "SUCCEEDED",
              requestHash: "h",
              firstSeenAt: 0,
              expiresAt: expiry,
            });
        for (const expiresAt of [cutoff + 1, Number.MAX_SAFE_INTEGER])
          await ctx.db.insert("idempotencyRecords", {
            orgId: world.orgA,
            operation: "test",
            requestId: `retained-${expiresAt}`,
            status: "FAILED",
            requestHash: "h",
            firstSeenAt: 0,
            expiresAt,
          });
        return ids;
      });
      expect(orgs).toHaveLength(27);
      expect(await world.t.mutation(refs.dispatch, { cutoff })).toEqual({
        organizations: 25,
        isDone: false,
      });
      await world.t.finishAllScheduledFunctions(() => vi.runAllTimers());
      const rows = await world.t.run((ctx) =>
        ctx.db.query("idempotencyRecords").collect(),
      );
      expect(rows.map((row) => row.expiresAt).sort()).toEqual(
        [cutoff + 1, Number.MAX_SAFE_INTEGER].sort(),
      );
      // A fixed cutoff protects requests that expire while the chain is running.
      expect(rows.every((row) => row.orgId === world.orgA)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops at the page budget and a later pass resumes from surviving expired records", async () => {
    vi.useFakeTimers();
    try {
      const world = await createConvexTenantWorld(modules);
      const cutoff = Date.now() - 1;
      await world.t.run(async (ctx) => {
        for (let i = 0; i < 201; i++)
          await ctx.db.insert("idempotencyRecords", {
            orgId: world.orgA,
            operation: "test",
            requestId: `key-${i}`,
            status: "SUCCEEDED",
            requestHash: "h",
            firstSeenAt: 0,
            expiresAt: cutoff,
          });
      });
      const args = {
        orgId: world.orgA,
        table: "idempotencyRecords" as const,
        cutoff,
        remainingPages: 1,
      };
      expect(await world.t.mutation(refs.runPage, args)).toMatchObject({
        deleted: 100,
        backlog: true,
        isDone: false,
      });
      await world.t.finishAllScheduledFunctions(() => vi.runAllTimers());
      expect(
        await world.t.run((ctx) =>
          ctx.db.query("idempotencyRecords").collect(),
        ),
      ).toHaveLength(101);
      await world.t.mutation(refs.runPage, { ...args, remainingPages: 20 });
      await world.t.finishAllScheduledFunctions(() => vi.runAllTimers());
      expect(
        await world.t.run((ctx) =>
          ctx.db.query("idempotencyRecords").collect(),
        ),
      ).toHaveLength(0);
      expect(await world.t.mutation(refs.runPage, args)).toMatchObject({
        deleted: 0,
        isDone: true,
        backlog: false,
      });
      await expect(
        world.t.mutation(refs.runPage, { ...args, remainingPages: 21 }),
      ).rejects.toThrow("Page budget");
    } finally {
      vi.useRealTimers();
    }
  });
});
