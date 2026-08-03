import { makeFunctionReference } from "convex/server";
import { ConvexError, v, type GenericId, type Value } from "convex/values";
import { describe, expect, it } from "vitest";

import { actionWithOrg } from "../../convex/lib/tenantFunctions";
import {
  createConvexTenantWorld,
  seedConvexTenantIdentities,
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
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: (ctx) => ({
    orgId: ctx.tenant.organization._id,
    requestId: ctx.requestId,
    capabilities: Object.keys(ctx).sort(),
  }),
});

const throwingAction = actionWithOrg({
  args: {},
  returns: v.null(),
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
  InspectionResult
>("testing/actionFixture:inspectAction");

const throwingReference = makeFunctionReference<
  "action",
  Record<string, never>,
  null
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
  await seedConvexTenantIdentities(world);
  return world;
}

describe("tenant-bound Convex actions", () => {
  it("runs a registered action after an authenticated warehouse preflight", async () => {
    const world = await actionWorld();

    const result = await world.t
      .withIdentity(identity("a"))
      .action(inspectReference, {
        warehouseId: world.warehouses.alphaA,
        orgId: world.orgB,
        requestId: "client-controlled",
      });

    expect(result.orgId).toBe(world.orgA);
    expect(result.requestId).not.toBe("client-controlled");
    expect(result.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.capabilities).toEqual(["identity", "requestId", "tenant"]);
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
  });

  it("redacts a handler-thrown Convex error", async () => {
    const world = await actionWorld();

    const data = await failureData(
      world.t.withIdentity(identity("b")).action(throwingReference, {}),
    );

    expect(data).toMatchObject({ code: "INTERNAL_ERROR" });
    expect(JSON.stringify(data)).not.toContain("action-handler-secret");
  });

  it("preserves action argument and return validators", () => {
    const runtime = inspectAction as unknown as {
      readonly exportArgs: () => string;
      readonly exportReturns: () => string;
    };

    expect(JSON.parse(runtime.exportArgs())).toMatchObject({ type: "object" });
    expect(JSON.parse(runtime.exportReturns())).toMatchObject({
      type: "object",
    });
  });
});
