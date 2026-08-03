import type { GenericMutationCtx } from "convex/server";
import { ConvexError, v, type Value } from "convex/values";
import { describe, expect, it } from "vitest";

import {
  mintRequestId,
  mutationWithOrg,
  queryWithOrg,
} from "../../convex/lib/tenantFunctions";
import type { DataModel } from "../../convex/schema";
import {
  createConvexTenantWorld,
  seedConvexTenantIdentities,
} from "../fixtures/convex-tenant-world";

interface RuntimeFunction {
  readonly _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
  readonly exportArgs: () => string;
  readonly exportReturns: () => string;
}

function runtimeFunction(value: unknown): RuntimeFunction {
  return value as RuntimeFunction;
}

function identity(org: "a" | "b") {
  return {
    subject: "user_fixture_a",
    org_id: `org_fixture_${org}`,
  };
}

async function failureData(operation: Promise<unknown>) {
  try {
    await operation;
    throw new Error("Expected the tenant function to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(ConvexError);
    return (error as ConvexError<Value>).data;
  }
}

describe("tenant-bound Convex function wrappers", () => {
  it("mints UUIDv7 correlation IDs from the server clock", () => {
    const now = 1_725_000_000_123;
    const requestId = mintRequestId(now);

    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(
      Number.parseInt(requestId.replaceAll("-", "").slice(0, 12), 16),
    ).toBe(now);
  });

  it("resolves a scoped tenant and exposes no raw database capability", async () => {
    const world = await createConvexTenantWorld();
    await seedConvexTenantIdentities(world);
    const wrapped = queryWithOrg({
      args: { warehouseId: v.id("warehouses") },
      returns: v.object({
        orgId: v.id("organizations"),
        requestId: v.string(),
      }),
      warehouseId: ({ warehouseId }) => warehouseId,
      handler: (ctx) => {
        expect(Object.isFrozen(ctx)).toBe(true);
        expect(Object.isFrozen(ctx.tenant)).toBe(true);
        expect("db" in ctx).toBe(false);
        return {
          orgId: ctx.tenant.organization._id,
          requestId: ctx.requestId,
        };
      },
    });

    const result = await world.t.withIdentity(identity("a")).run(async (ctx) =>
      runtimeFunction(wrapped)._handler(ctx, {
        warehouseId: world.warehouses.alphaA,
      }),
    );

    expect(result).toMatchObject({ orgId: world.orgA });
    expect((result as { requestId: string }).requestId).toMatch(
      /^[0-9a-f-]{36}$/,
    );
  });

  it("ignores spoofed organization and request identifiers", async () => {
    const world = await createConvexTenantWorld();
    await seedConvexTenantIdentities(world);
    const wrapped = queryWithOrg({
      args: { orgId: v.string(), requestId: v.string() },
      returns: v.object({
        orgId: v.id("organizations"),
        requestId: v.string(),
      }),
      handler: (ctx) => ({
        orgId: ctx.tenant.organization._id,
        requestId: ctx.requestId,
      }),
    });

    const result = await world.t.withIdentity(identity("a")).run(async (ctx) =>
      runtimeFunction(wrapped)._handler(ctx, {
        orgId: world.orgB,
        requestId: "client-controlled",
      }),
    );

    expect(result).toMatchObject({ orgId: world.orgA });
    expect((result as { requestId: string }).requestId).not.toBe(
      "client-controlled",
    );
  });

  it("binds mutation writes to the resolved organization", async () => {
    const world = await createConvexTenantWorld();
    await seedConvexTenantIdentities(world);
    const wrapped = mutationWithOrg({
      args: { code: v.string() },
      returns: v.string(),
      handler: async ({ tenantDb }, { code }) =>
        await tenantDb.insert("warehouses", {
          code,
          name: `Warehouse ${code}`,
          status: "ACTIVE",
        }),
    });

    const insertedId = await world.t
      .withIdentity(identity("b"))
      .run(async (ctx) =>
        runtimeFunction(wrapped)._handler(ctx, { code: "BOUND" }),
      );
    const inserted = await world.t.run(async (ctx) => {
      const normalized = ctx.db.normalizeId("warehouses", String(insertedId));
      return normalized === null
        ? null
        : await ctx.db.get("warehouses", normalized);
    });

    expect(inserted).toMatchObject({ orgId: world.orgB, code: "BOUND" });
  });

  it("returns a correlated generic denial to an anonymous caller", async () => {
    const world = await createConvexTenantWorld();
    const wrapped = queryWithOrg({
      args: {},
      returns: v.null(),
      handler: () => null,
    });

    const data = await failureData(
      world.t.run(async (ctx) => runtimeFunction(wrapped)._handler(ctx, {})),
    );

    expect(data).toMatchObject({
      kind: "TENANT_CONTEXT_DENIED",
      code: "ANONYMOUS",
    });
    expect(JSON.stringify(data)).not.toContain("user_fixture");
  });

  it("redacts handler failures, including handler-thrown Convex errors", async () => {
    const world = await createConvexTenantWorld();
    await seedConvexTenantIdentities(world);
    const wrapped = queryWithOrg({
      args: {},
      returns: v.null(),
      handler: () => {
        throw new ConvexError("secret-handler-detail");
      },
    });

    const data = await failureData(
      world.t
        .withIdentity(identity("a"))
        .run(async (ctx) => runtimeFunction(wrapped)._handler(ctx, {})),
    );

    expect(data).toMatchObject({ code: "INTERNAL_ERROR" });
    expect(JSON.stringify(data)).not.toContain("secret-handler-detail");
  });

  it("preserves Convex validators on the registered function", () => {
    const wrapped = queryWithOrg({
      args: { value: v.string() },
      returns: v.number(),
      handler: (_ctx, { value }) => value.length,
    });
    const runtime = runtimeFunction(wrapped);

    expect(JSON.parse(runtime.exportArgs())).toMatchObject({ type: "object" });
    expect(JSON.parse(runtime.exportReturns())).toMatchObject({
      type: "number",
    });
  });
});
