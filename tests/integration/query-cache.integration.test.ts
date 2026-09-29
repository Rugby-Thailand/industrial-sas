import { afterEach, describe, expect, it, vi } from "vitest";
import type { GenericMutationCtx } from "convex/server";
import type { DataModel } from "../../convex/schema";
import { readCurrent } from "../../convex/workspace/current";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
} from "../fixtures/convex-tenant-world";

afterEach(() => vi.restoreAllMocks());

async function setup() {
  const world = await createConvexTenantWorld();
  await seedConvexAuthorization(world, { roleA: "ORG_ADMIN" });
  const read = () =>
    world.t
      .withIdentity({ subject: "user_fixture_a", org_id: "org_fixture_a" })
      .run((ctx) =>
        (
          readCurrent as unknown as {
            _handler: (
              ctx: GenericMutationCtx<DataModel>,
              args: object,
            ) => Promise<{ ok: boolean; requestId: string }>;
          }
        )._handler(ctx, {}),
      );
  return { world, read };
}

describe("query cache authorization", () => {
  it("does not read the wall clock for an already-effective, non-expiring membership", async () => {
    const { read } = await setup();
    const now = vi.spyOn(Date, "now");
    const result = await read();
    expect(result.ok).toBe(true);
    expect(now).not.toHaveBeenCalled();
    expect(result.requestId).toMatch(
      /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/,
    );
  });

  it("still denies future and expired memberships, and revocation takes effect", async () => {
    const { world, read } = await setup();
    const membership = await world.t.run(async (ctx) =>
      (await ctx.db.query("memberships").collect()).find(
        (m) => m.orgId === world.orgA,
      )!,
    );
    await world.t.run((ctx) =>
      ctx.db.patch(membership._id, { effectiveFrom: Date.now() + 60_000 }),
    );
    expect((await read()).ok).toBe(false);
    await world.t.run((ctx) =>
      ctx.db.patch(membership._id, {
        effectiveFrom: 0,
        effectiveTo: Date.now() - 1,
      }),
    );
    expect((await read()).ok).toBe(false);
    await world.t.run((ctx) =>
      ctx.db.patch(membership._id, { effectiveTo: undefined }),
    );
    expect((await read()).ok).toBe(true);
    await world.t.run((ctx) =>
      ctx.db.patch(membership._id, { status: "REVOKED" }),
    );
    await expect(read()).rejects.toThrow("MEMBERSHIP_INACTIVE");
  });
});
