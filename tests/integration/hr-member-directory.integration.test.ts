import { afterEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../convex/_generated/dataModel";
import { createMemberDirectory } from "../../convex/lib/memberDirectory";
import {
  createConvexTenantWorld,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";

type Status = "ACTIVE" | "SUSPENDED" | "REVOKED";

async function member(
  world: ConvexTenantWorld,
  name: string,
  memberships: readonly {
    readonly status: Status;
    readonly orgId?: Id<"organizations">;
    readonly effectiveFrom?: number;
    readonly effectiveTo?: number;
  }[],
) {
  return world.t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      clerkUserId: `user_${name}`,
      displayName: name,
      status: "ACTIVE",
    });
    const ids: Id<"memberships">[] = [];
    for (const [index, row] of memberships.entries())
      ids.push(
        await ctx.db.insert("memberships", {
          orgId: row.orgId ?? world.orgA,
          userId,
          clerkMembershipId: `orgmem_${name}_${index}`,
          status: row.status,
          scopeMode: "ORG_WIDE",
          effectiveFrom: row.effectiveFrom ?? 0,
          ...(row.effectiveTo === undefined
            ? {}
            : { effectiveTo: row.effectiveTo }),
        }),
      );
    return { userId, ids };
  });
}

const directory = <T>(
  world: ConvexTenantWorld,
  read: (members: ReturnType<typeof createMemberDirectory>) => Promise<T>,
  orgId: Id<"organizations"> = world.orgA,
) => world.t.run((ctx) => read(createMemberDirectory(ctx.db, orgId)));

describe("member directory", () => {
  afterEach(() => vi.restoreAllMocks());

  it("resolves the current membership after a re-add instead of failing on the tombstone", async () => {
    const world = await createConvexTenantWorld();
    const readded = await member(world, "Readded", [
      { status: "REVOKED" },
      { status: "ACTIVE" },
    ]);
    expect(await directory(world, (m) => m.get(readded.userId))).toEqual({
      userId: readded.userId,
      membershipId: readded.ids[1],
      displayName: "Readded",
      active: true,
    });
    expect(await directory(world, (m) => m.displayName(readded.userId))).toBe(
      "Readded",
    );
  });

  it("keeps a former member's name on records while reporting them inactive", async () => {
    const world = await createConvexTenantWorld();
    const former = await member(world, "Former", [
      { status: "REVOKED" },
      { status: "REVOKED" },
    ]);
    expect(await directory(world, (m) => m.get(former.userId))).toMatchObject({
      membershipId: former.ids[1],
      active: false,
    });
    expect(await directory(world, (m) => m.displayName(former.userId))).toBe(
      "Former",
    );
    const suspended = await member(world, "Suspended", [
      { status: "REVOKED" },
      { status: "SUSPENDED" },
    ]);
    expect(
      await directory(world, (m) => m.get(suspended.userId)),
    ).toMatchObject({ membershipId: suspended.ids[1], active: false });
  });

  it("refuses ambiguous current memberships for get but still labels them", async () => {
    const world = await createConvexTenantWorld();
    const doubled = await member(world, "Doubled", [
      { status: "ACTIVE" },
      { status: "SUSPENDED" },
    ]);
    expect(await directory(world, (m) => m.get(doubled.userId))).toBeNull();
    expect(await directory(world, (m) => m.displayName(doubled.userId))).toBe(
      "Doubled",
    );
  });

  it("answers another tenant's or an unknown user exactly as absent", async () => {
    const world = await createConvexTenantWorld();
    const outsider = await member(world, "Outsider", [{ status: "ACTIVE" }]);
    const tenantB = await member(world, "TenantB", []);
    await world.t.run((ctx) =>
      ctx.db.insert("memberships", {
        orgId: world.orgB,
        userId: tenantB.userId,
        clerkMembershipId: "orgmem_b_only",
        status: "ACTIVE",
        scopeMode: "ORG_WIDE",
        effectiveFrom: 0,
      }),
    );
    expect(await directory(world, (m) => m.get(tenantB.userId))).toBeNull();
    expect(
      await directory(world, (m) => m.displayName(tenantB.userId)),
    ).toBeNull();
    expect(
      await directory(world, (m) => m.displayName("not-an-id")),
    ).toBeNull();
    // The same user resolves in its own organization only.
    expect(
      await directory(world, (m) => m.displayName(outsider.userId), world.orgB),
    ).toBeNull();
    expect(
      await directory(world, (m) => m.displayName(tenantB.userId), world.orgB),
    ).toBe("TenantB");
  });

  it("reads no clock for a name while get still evaluates the effective window", async () => {
    const world = await createConvexTenantWorld();
    const future = await member(world, "Future", [
      { status: "ACTIVE", effectiveFrom: 4_000_000_000_000 },
    ]);
    const expired = await member(world, "Expired", [
      { status: "ACTIVE", effectiveTo: 1 },
    ]);
    const clock = vi.spyOn(Date, "now");
    const names = await directory(world, async (m) => {
      const before = clock.mock.calls.length;
      const values = [
        await m.displayName(future.userId),
        await m.displayName(expired.userId),
      ];
      return { values, clockCalls: clock.mock.calls.length - before };
    });
    expect(names).toEqual({ values: ["Future", "Expired"], clockCalls: 0 });
    expect(
      await directory(world, async (m) => [
        (await m.get(future.userId))?.active,
        (await m.get(expired.userId))?.active,
      ]),
    ).toEqual([false, false]);
  });
});
