import type { GenericMutationCtx } from "convex/server";
import { describe, expect, it } from "vitest";
import * as dimensions from "../../convex/aiUsage/dimensions";
import type { DataModel } from "../../convex/schema";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";

type Runtime = {
  _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
};
type OptionPage = {
  status: string;
  items: { id: string; name: string; code?: string }[];
  isDone: boolean;
  continueCursor: string;
  scanCursor?: string;
};
const identity = { subject: "user_fixture_a", org_id: "org_fixture_a" };

async function setup() {
  const world = await createConvexTenantWorld();
  await seedConvexAuthorization(world, {
    roleA: "USAGE_READER",
    extraRoles: [{ key: "USAGE_READER", permissionCodes: ["aiUsage.read"] }],
  });
  // 250 more members (beyond the report's 200 labels), some former, and
  // 120 more warehouses (beyond its 100), plus one foreign-tenant member.
  await world.t.run(async (ctx) => {
    for (let n = 0; n < 250; n++) {
      const userId = await ctx.db.insert("users", {
        clerkUserId: `user_option_${n}`,
        displayName: n === 237 ? "ช่างสมชาย Late Operator" : `Operator ${n}`,
        status: "ACTIVE",
      });
      await ctx.db.insert("memberships", {
        orgId: world.orgA,
        userId,
        clerkMembershipId: `orgmem_option_${n}`,
        status: n % 10 === 9 ? "REVOKED" : "ACTIVE",
        scopeMode: "ORG_WIDE",
        effectiveFrom: 0,
      });
    }
    const foreign = await ctx.db.insert("users", {
      clerkUserId: "user_option_foreign",
      displayName: "Foreign Operator",
      status: "ACTIVE",
    });
    await ctx.db.insert("memberships", {
      orgId: world.orgB,
      userId: foreign,
      clerkMembershipId: "orgmem_option_foreign",
      status: "ACTIVE",
      scopeMode: "ORG_WIDE",
      effectiveFrom: 0,
    });
    for (let n = 0; n < 120; n++)
      await ctx.db.insert("warehouses", {
        orgId: world.orgA,
        code: `W${String(n).padStart(3, "0")}`,
        name: n === 117 ? "คลังสินค้า Far North" : `Warehouse ${n}`,
        status: "ACTIVE",
      });
  });
  return world;
}

async function call<T>(world: ConvexTenantWorld, fn: unknown, args: unknown) {
  const outcome = (await world.t
    .withIdentity(identity)
    .run((ctx) =>
      (fn as Runtime)._handler(ctx as GenericMutationCtx<DataModel>, args),
    )) as { ok: boolean; value: T };
  expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
  return outcome.value;
}

async function traverse(
  world: ConvexTenantWorld,
  fn: unknown,
  args: Record<string, unknown>,
) {
  const seen: OptionPage["items"] = [];
  let cursor: string | null = null;
  let requests = 0;
  for (let page = 0; page < 100; page++) {
    let scanCursor: string | undefined;
    let body: OptionPage;
    do {
      body = await call<OptionPage>(world, fn, {
        ...args,
        cursor,
        ...(scanCursor ? { scanCursor } : {}),
      });
      requests++;
      scanCursor = body.status === "scanning" ? body.scanCursor : undefined;
    } while (scanCursor);
    seen.push(...body.items);
    if (body.isDone) return { seen, requests };
    cursor = body.continueCursor;
  }
  throw new Error("options did not finish");
}

describe("AI usage filter options beyond the report label caps", () => {
  it("pages every organization member, including former ones, and searches names", async () => {
    const world = await setup();
    const members = await world.t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_orgId_userId", (q) => q.eq("orgId", world.orgA))
        .collect(),
    );
    for (const pageSize of [20, 50, 100]) {
      const { seen, requests } = await traverse(
        world,
        dimensions.actorOptions,
        { pageSize },
      );
      expect(seen.map((option) => option.id)).toEqual(
        members.map((m) => m.userId),
      );
      expect(seen.length).toBeGreaterThan(250);
      expect(requests).toBe(Math.ceil(seen.length / pageSize));
    }
    expect(
      (
        await traverse(world, dimensions.actorOptions, {
          search: " late OPERATOR ",
        })
      ).seen.map((option) => option.name),
    ).toEqual(["ช่างสมชาย Late Operator"]);
    expect(
      (await traverse(world, dimensions.actorOptions, { search: "ช่างสม" }))
        .seen,
    ).toHaveLength(1);
    // Members of another organization are never offered.
    expect(
      (await traverse(world, dimensions.actorOptions, { search: "foreign" }))
        .seen,
    ).toEqual([]);
  });

  it("pages every warehouse in code order and searches code or name", async () => {
    const world = await setup();
    const { seen } = await traverse(world, dimensions.warehouseOptions, {
      pageSize: 50,
    });
    const codes = seen.map((option) => option.code!);
    expect(codes).toEqual([...codes].sort());
    expect(seen.length).toBeGreaterThan(120);
    expect(
      (
        await traverse(world, dimensions.warehouseOptions, {
          search: "far north",
        })
      ).seen.map((option) => option.code),
    ).toEqual(["W117"]);
    expect(
      (await traverse(world, dimensions.warehouseOptions, { search: "w11" }))
        .seen,
    ).toHaveLength(10);
    expect(
      await call(world, dimensions.warehouseOptions, { pageSize: 25 }),
    ).toBeNull();
  });

  it("labels only one displayed page of IDs, omitting foreign ones", async () => {
    const world = await setup();
    const { seen } = await traverse(world, dimensions.actorOptions, {
      pageSize: 100,
    });
    const late = seen.find((option) => option.name.includes("Late"))!;
    const foreign = await world.t.run(async (ctx) =>
      (await ctx.db.query("users").collect()).find(
        (user) => user.clerkUserId === "user_option_foreign",
      ),
    );
    const resolved = await call<{
      users: { id: string; name: string }[];
      warehouses: { id: string; name: string }[];
    }>(world, dimensions.labels, {
      actorIds: [late.id, foreign!._id, "not-an-id"],
      warehouseIds: [world.warehouses.alphaA, world.warehouses.alphaB],
    });
    expect(resolved.users).toEqual([
      { id: late.id, name: "ช่างสมชาย Late Operator" },
    ]);
    expect(resolved.warehouses.map((w) => w.id)).toEqual([
      world.warehouses.alphaA,
    ]);
    expect(
      await call(world, dimensions.labels, {
        actorIds: seen.slice(0, 101).map((option) => option.id),
        warehouseIds: [],
      }),
    ).toEqual({ error: "TOO_MANY_LABELS" });
  });
});
