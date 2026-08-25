import { makeFunctionReference } from "convex/server";
import { ConvexError, v, type GenericId, type Value } from "convex/values";
import { describe, expect, it } from "vitest";

import {
  actionWithOrg,
  type TenantFunctionOutcome,
} from "../../convex/lib/tenantFunctions";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  storedAuditEvents,
  type ConvexTestModuleMap,
} from "../fixtures/convex-tenant-world";

const inspectAction = actionWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    orgId: v.string(),
    requestId: v.string(),
  },
  returns: v.object({
    orgId: v.id("organizations"),
    requestId: v.string(),
    capabilities: v.array(v.string()),
  }),
  permissionCode: "label.print.execute",
  target: { table: "warehouses", id: ({ warehouseId }) => warehouseId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: (ctx) => ({
    orgId: ctx.tenant.organization._id,
    requestId: ctx.requestId,
    capabilities: Object.keys(ctx).sort(),
  }),
});

const throwingAction = actionWithOrg({
  args: { warehouseId: v.id("warehouses") },
  returns: v.null(),
  permissionCode: "label.print.execute",
  target: { table: "warehouses" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: () => {
    throw new ConvexError("action-handler-secret");
  },
});

const ACTION_MODULES: ConvexTestModuleMap = {
  "../convex/lib/tenantFunctions.ts": () =>
    import("../../convex/lib/tenantFunctions"),
  "../convex/testing/actionFixture.ts": () =>
    Promise.resolve({ inspectAction, throwingAction }),
};

type InspectionResult = {
  readonly orgId: GenericId<"organizations">;
  readonly requestId: string;
  readonly capabilities: readonly string[];
};

const inspectReference = makeFunctionReference<
  "action",
  {
    warehouseId: GenericId<"warehouses">;
    orgId: string;
    requestId: string;
  },
  TenantFunctionOutcome<InspectionResult>
>("testing/actionFixture:inspectAction");

const throwingReference = makeFunctionReference<
  "action",
  { warehouseId: GenericId<"warehouses"> },
  TenantFunctionOutcome<null>
>("testing/actionFixture:throwingAction");

function identity(org: "a" | "b") {
  return { subject: "user_fixture_a", org_id: `org_fixture_${org}` };
}

async function failureData(operation: Promise<unknown>): Promise<Value> {
  try {
    await operation;
    throw new Error("Expected tenant action failure.");
  } catch (error) {
    expect(error).toBeInstanceOf(ConvexError);
    return (error as ConvexError<Value>).data;
  }
}

async function actionWorld() {
  const world = await createConvexTenantWorld(ACTION_MODULES);
  await seedConvexAuthorization(world);
  return world;
}

describe("tenant-bound Convex actions", () => {
  it("runs a registered action after an audited warehouse preflight", async () => {
    const world = await actionWorld();

    const outcome = await world.t
      .withIdentity(identity("a"))
      .action(inspectReference, {
        warehouseId: world.warehouses.alphaA,
        orgId: world.orgB,
        requestId: "client-controlled",
      });

    if (!outcome.ok) throw new Error("expected an allowed action outcome");
    expect(outcome.value.orgId).toBe(world.orgA);
    expect(outcome.value.requestId).not.toBe("client-controlled");
    expect(outcome.value.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(outcome.value.capabilities).toEqual([
      "identity",
      "permission",
      "requestId",
      "tenant",
    ]);

    const audit = await storedAuditEvents(world, world.orgA);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      orgId: world.orgA,
      outcome: "ALLOWED",
      permissionCode: "label.print.execute",
      action: "label.print.execute",
      entityTable: "warehouses",
      entityId: world.warehouses.alphaA,
      warehouseId: world.warehouses.alphaA,
      requestId: outcome.requestId,
    });
    expect(audit[0]).not.toHaveProperty("denialReason");
  });

  it("returns the resolver's safe anonymous denial", async () => {
    const world = await actionWorld();

    const data = await failureData(
      world.t.action(inspectReference, {
        warehouseId: world.warehouses.alphaA,
        orgId: world.orgA,
        requestId: "spoof",
      }),
    );

    expect(data).toMatchObject({
      kind: "TENANT_CONTEXT_DENIED",
      code: "ANONYMOUS",
    });
    expect(JSON.stringify(data)).not.toContain("user_fixture");
  });

  it.each([
    ["foreign", "WAREHOUSE_UNKNOWN"],
    ["out-of-scope", "WAREHOUSE_OUT_OF_SCOPE"],
  ] as const)("denies a %s warehouse", async (kind, code) => {
    const world = await actionWorld();
    const warehouseId =
      kind === "foreign" ? world.warehouses.alphaB : world.warehouses.bravoA;

    const data = await failureData(
      world.t.withIdentity(identity("a")).action(inspectReference, {
        warehouseId,
        orgId: world.orgA,
        requestId: "spoof",
      }),
    );

    expect(data).toMatchObject({ kind: "TENANT_CONTEXT_DENIED", code });
    expect(JSON.stringify(data)).not.toContain(String(warehouseId));

    expect(await storedAuditEvents(world, world.orgA)).toHaveLength(0);
  });

  it("redacts a handler-thrown Convex error", async () => {
    const world = await actionWorld();

    const data = await failureData(
      world.t
        .withIdentity(identity("a"))
        .action(throwingReference, { warehouseId: world.warehouses.alphaA }),
    );

    expect(data).toMatchObject({ code: "INTERNAL_ERROR" });
    expect(JSON.stringify(data)).not.toContain("action-handler-secret");

    const audit = await storedAuditEvents(world, world.orgA);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ outcome: "ALLOWED" });
  });

  it("declares the outcome envelope on the registered action", () => {
    const runtime = inspectAction as unknown as {
      readonly exportArgs: () => string;
      readonly exportReturns: () => string;
    };
    const returns = JSON.parse(runtime.exportReturns()) as {
      readonly type: string;
    };

    expect(JSON.parse(runtime.exportArgs())).toMatchObject({ type: "object" });
    expect(returns.type).toBe("union");
    expect(JSON.stringify(returns)).toContain("AUTHORIZATION_DENIED");
  });
});
