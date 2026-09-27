import type { GenericMutationCtx } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import * as bootstrap from "../../convex/onboarding/bootstrapOrganization";
import schema, { type DataModel } from "../../convex/schema";
import { DEFAULT_ORGANIZATION_SETTINGS } from "../../convex/lib/organizationDefaults";

const modules = { "../convex/_generated/server.js": () => Promise.resolve({}) };
type Harness = ReturnType<typeof convexTest>;
type RuntimeFunction = {
  _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
};

async function call(world: Harness, args: unknown) {
  return world.run((ctx) =>
    (
      bootstrap.grantFirstAdminAndCreateWarehouse as unknown as RuntimeFunction
    )._handler(ctx as GenericMutationCtx<DataModel>, args),
  );
}

describe("organization bootstrap", () => {
  it("grants the mirrored first member admin access and creates its warehouse once", async () => {
    const world = convexTest(schema, modules);
    const identity = await world.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        clerkOrganizationId: "org_top_gold",
        name: "Top Gold",
        status: "ACTIVE",
        settings: DEFAULT_ORGANIZATION_SETTINGS,
      });
      const userId = await ctx.db.insert("users", {
        clerkUserId: "user_top_gold",
        displayName: "Top Gold administrator",
        status: "ACTIVE",
      });
      const membershipId = await ctx.db.insert("memberships", {
        orgId: organizationId,
        userId,
        clerkMembershipId: "orgmem_top_gold",
        status: "ACTIVE",
        scopeMode: "WAREHOUSE_SCOPED",
        effectiveFrom: 1,
      });
      return { organizationId, membershipId };
    });

    const args = {
      clerkOrganizationId: "org_top_gold",
      clerkMembershipId: "orgmem_top_gold",
      requestId: "top-gold-bootstrap-v1",
      warehouse: { code: "TG-DEMO", name: "Top Gold Demo Warehouse" },
    };
    const first = await call(world, args);
    const second = await call(world, args);

    expect(first).toMatchObject({
      organizationId: identity.organizationId,
      membershipId: identity.membershipId,
      adminGranted: true,
      warehouseCreated: true,
    });
    expect(second).toMatchObject({
      organizationId: identity.organizationId,
      membershipId: identity.membershipId,
      adminGranted: false,
      warehouseCreated: false,
    });
    const rows = await world.run(async (ctx) => ({
      warehouses: await ctx.db.query("warehouses").collect(),
      grants: await ctx.db.query("membershipRoles").collect(),
      scopes: await ctx.db.query("membershipWarehouses").collect(),
      audits: await ctx.db.query("auditEvents").collect(),
    }));
    expect(rows.warehouses).toHaveLength(1);
    expect(rows.grants).toHaveLength(1);
    expect(rows.scopes).toHaveLength(1);
    expect(rows.audits).toHaveLength(1);
  });
});
