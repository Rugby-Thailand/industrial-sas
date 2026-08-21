import type { GenericMutationCtx } from "convex/server";
import { describe, expect, it } from "vitest";

import { clock, readMyHr } from "../../convex/hr/attendance";
import type { DataModel } from "../../convex/schema";
import { createConvexInventoryWorld } from "../fixtures/convex-inventory-world";

interface RuntimeFunction {
  readonly _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
}

async function call(
  world: Awaited<ReturnType<typeof createConvexInventoryWorld>>,
  fn: unknown,
  args: unknown,
  identity: { readonly subject: string; readonly org_id: string },
): Promise<Record<string, unknown>> {
  return (await world.t
    .withIdentity(identity)
    .run(async (ctx) =>
      (fn as RuntimeFunction)._handler(
        ctx as GenericMutationCtx<DataModel>,
        args,
      ),
    )) as Record<string, unknown>;
}

describe("HR tenant and warehouse isolation", () => {
  it("does not expose an employee through another tenant or accept a foreign worksite", async () => {
    const world = await createConvexInventoryWorld(
      {},
      { roleA: "ORG_ADMIN", roleB: "ORG_ADMIN" },
    );
    await world.t.run(async (ctx) => {
      await ctx.db.insert("employees", {
        orgId: world.orgA,
        employeeNumber: "EMP-A-001",
        userId: world.userA,
        displayName: "Tenant A Employee",
        warehouseId: world.warehouses.alphaA,
        status: "ACTIVE",
        startedOn: "2026-01-01",
        createdByUserId: world.userA,
        createdAt: 1,
      });
    });

    await expect(
      call(
        world,
        clock,
        {
          requestId: "foreign-clock",
          warehouseId: world.warehouses.alphaB,
          kind: "CLOCK_IN",
        },
        { subject: "user_fixture_a", org_id: "org_fixture_a" },
      ),
    ).rejects.toThrow("WAREHOUSE_UNKNOWN");

    const tenantB = await call(
      world,
      readMyHr,
      {},
      { subject: "user_fixture_a", org_id: "org_fixture_b" },
    );
    expect(tenantB).toMatchObject({ ok: true, value: { found: false } });
    expect(JSON.stringify(tenantB)).not.toContain("Tenant A Employee");
  });
});
