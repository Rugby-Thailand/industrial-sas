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
  recordStepUp,
  seedConvexAuthorization,
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

function allowedValue(outcome: unknown): unknown {
  const envelope = outcome as {
    readonly ok: boolean;
    readonly value?: unknown;
  };
  if (!envelope.ok) {
    throw new Error(
      `Expected an allowed outcome, got ${JSON.stringify(outcome)}`,
    );
  }
  return envelope.value;
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
    await seedConvexAuthorization(world);
    const wrapped = queryWithOrg({
      args: { warehouseId: v.id("warehouses") },
      returns: v.object({
        orgId: v.id("organizations"),
        requestId: v.string(),
        permissionCode: v.string(),
      }),
      permissionCode: "receiving.receipt.post",
      target: { table: "warehouses", id: ({ warehouseId }) => warehouseId },
      warehouseId: ({ warehouseId }) => warehouseId,
      handler: (ctx) => {
        expect(Object.isFrozen(ctx)).toBe(true);
        expect(Object.isFrozen(ctx.tenant)).toBe(true);
        expect("db" in ctx).toBe(false);
        return {
          orgId: ctx.tenant.organization._id,
          requestId: ctx.requestId,
          permissionCode: ctx.permission.code,
        };
      },
    });

    const outcome = await world.t.withIdentity(identity("a")).run(async (ctx) =>
      runtimeFunction(wrapped)._handler(ctx, {
        warehouseId: world.warehouses.alphaA,
      }),
    );
    const value = allowedValue(outcome) as {
      readonly orgId: string;
      readonly requestId: string;
      readonly permissionCode: string;
    };

    expect(value.orgId).toBe(world.orgA);
    expect(value.permissionCode).toBe("receiving.receipt.post");
    expect(value.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect((outcome as { readonly requestId: string }).requestId).toBe(
      value.requestId,
    );
  });

  it("ignores spoofed organization and request identifiers", async () => {
    const world = await createConvexTenantWorld();
    await seedConvexAuthorization(world);
    const wrapped = queryWithOrg({
      args: { orgId: v.string(), requestId: v.string() },
      returns: v.object({
        orgId: v.id("organizations"),
        requestId: v.string(),
      }),
      permissionCode: "admin.audit.read",
      target: { table: "auditEvents" },
      handler: (ctx) => ({
        orgId: ctx.tenant.organization._id,
        requestId: ctx.requestId,
      }),
    });

    const outcome = await world.t.withIdentity(identity("a")).run(async (ctx) =>
      runtimeFunction(wrapped)._handler(ctx, {
        orgId: world.orgB,
        requestId: "client-controlled",
      }),
    );
    const value = allowedValue(outcome) as {
      readonly orgId: string;
      readonly requestId: string;
    };

    expect(value.orgId).toBe(world.orgA);
    expect(value.requestId).not.toBe("client-controlled");
  });

  it("binds mutation writes to the resolved organization", async () => {
    const world = await createConvexTenantWorld();
    await seedConvexAuthorization(world);

    await recordStepUp(world, {
      orgId: world.orgB,
      userId: world.userA,
      occurredAt: Date.now(),
      reverifiedAt: Date.now(),
    });
    const wrapped = mutationWithOrg({
      args: { code: v.string() },
      returns: v.string(),
      permissionCode: "masterData.warehouse.manage",
      target: { table: "warehouses" },
      handler: async ({ tenantDb }, { code }) =>
        await tenantDb.insert("warehouses", {
          code,
          name: `Warehouse ${code}`,
          status: "ACTIVE",
        }),
    });

    const outcome = await world.t
      .withIdentity(identity("b"))
      .run(async (ctx) =>
        runtimeFunction(wrapped)._handler(ctx, { code: "BOUND" }),
      );
    const insertedId = allowedValue(outcome);
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
      permissionCode: "admin.audit.read",
      target: { table: "auditEvents" },
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
    await seedConvexAuthorization(world);
    const wrapped = queryWithOrg({
      args: {},
      returns: v.null(),
      permissionCode: "admin.audit.read",
      target: { table: "auditEvents" },
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

  it("declares the outcome envelope, not the bare value, as its return type", () => {
    const wrapped = queryWithOrg({
      args: { value: v.string() },
      returns: v.number(),
      permissionCode: "admin.audit.read",
      target: { table: "auditEvents" },
      handler: (_ctx, { value }) => value.length,
    });
    const runtime = runtimeFunction(wrapped);
    const returns = JSON.parse(runtime.exportReturns()) as {
      readonly type: string;
      readonly value: readonly { readonly value: Record<string, unknown> }[];
    };

    expect(JSON.parse(runtime.exportArgs())).toMatchObject({ type: "object" });

    expect(returns.type).toBe("union");
    expect(returns.value).toHaveLength(2);
    expect(JSON.stringify(returns)).toContain("AUTHORIZATION_DENIED");
    expect(JSON.stringify(returns)).toContain('"number"');
  });

  it("refuses to register a function whose declaration cannot be enforced", async () => {
    const world = await createConvexTenantWorld();
    await seedConvexTenantIdentities(world);

    expect(() =>
      queryWithOrg({
        args: {},
        permissionCode: "invented.permission.use",
        target: { table: "auditEvents" },
        handler: () => null,
      }),
    ).toThrow(/does not define it/);
    expect(() =>
      queryWithOrg({
        args: {},
        permissionCode: "platform.tenant.read",
        target: { table: "auditEvents" },
        handler: () => null,
      }),
    ).toThrow(/PLATFORM/);
    expect(() =>
      queryWithOrg({
        args: {},
        permissionCode: "receiving.receipt.post",
        target: { table: "auditEvents" },
        handler: () => null,
      }),
    ).toThrow(/warehouseId selector/);
    expect(() =>
      queryWithOrg({
        args: {},
        permissionCode: "admin.audit.read",
        target: { table: "auditEvents" },
        policy: () => ({ thresholdExceeded: false }),
        handler: () => null,
      }),
    ).toThrow(/policy callback would never be read/);
    expect(() =>
      queryWithOrg({
        args: {},
        permissionCode: "admin.audit.read",
        target: { table: "organizations" as "auditEvents" },
        handler: () => null,
      }),
    ).toThrow(/not a tenant table/);
  });
});
