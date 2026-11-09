import { describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTestModuleMap,
} from "../fixtures/convex-tenant-world";

const MODULES: ConvexTestModuleMap = Object.fromEntries(
  Object.entries(
    import.meta.glob([
      "../../convex/**/*.ts",
      "!../../convex/_generated/**",
      "!../../convex/**/*.test.ts",
    ]) as Record<string, () => Promise<unknown>>,
  ).map(([path, load]) => [path.replace("../../convex/", "../convex/"), load]),
);

describe("member re-add and bounded actor options", () => {
  it("offers each user once after a normal remove and re-add lifecycle", async () => {
    const world = await createConvexTenantWorld(MODULES);
    await seedConvexAuthorization(world, { roleA: "ORG_ADMIN" });
    const at = Date.now() - 10_000;
    for (const [index, type, membershipId] of [
      [0, "membership.upsert", "mem_returning_old"],
      [1, "membership.delete", "mem_returning_old"],
      [2, "membership.upsert", "mem_returning_new"],
    ] as const) {
      await world.t.mutation(
        internal.lib.identityMirrorConvex.applyClerkIdentityEvent,
        {
          event: {
            eventId: `evt_returning_${index}`,
            eventAt: at + index * 1_000,
            eventTimestamp: at + index * 1_000,
            type,
            data: {
              clerkOrganizationId: "org_fixture_a",
              name: "Tenant A",
              clerkUserId: "user_returning_operator",
              displayName: "Returning Operator",
              clerkMembershipId: membershipId,
            },
          },
        },
      );
    }
    const membershipStatuses = await world.t.run(async (ctx) =>
      (await ctx.db.query("memberships").collect())
        .filter((row) => row.clerkMembershipId.startsWith("mem_returning_"))
        .map((row) => row.status),
    );
    expect(membershipStatuses).toEqual(["REVOKED", "ACTIVE"]);
    const result = await world.t
      .withIdentity({ subject: "user_fixture_a", org_id: "org_fixture_a" })
      .query(api.aiUsage.dimensions.actorOptions, {
        search: "Returning Operator",
        pageSize: 20,
      });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.value) throw new Error("missing page");
    expect(result.value.status).toBe("ready");
    const rows = result.value.items.filter(
      (row) => row.name === "Returning Operator",
    );
    expect(new Set(rows.map((row) => row.id)).size).toBe(1);
    expect(rows.length, "actor filter entries for one returning user").toBe(1);
  });
});
