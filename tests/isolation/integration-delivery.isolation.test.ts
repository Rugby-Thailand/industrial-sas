import type { GenericMutationCtx } from "convex/server";
import { describe, expect, it } from "vitest";

import { listIntegrationHealth } from "../../convex/integrations/delivery";
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
  identity: { readonly subject: string; readonly org_id: string },
): Promise<Record<string, unknown>> {
  return (await world.t
    .withIdentity(identity)
    .run(async (ctx) =>
      (listIntegrationHealth as unknown as RuntimeFunction)._handler(
        ctx as GenericMutationCtx<DataModel>,
        {},
      ),
    )) as Record<string, unknown>;
}

describe("integration health tenant isolation", () => {
  it("does not disclose another tenant's adapter names, failures, or backlog", async () => {
    const world = await createConvexInventoryWorld(
      {},
      { roleA: "ORG_ADMIN", roleB: "ORG_ADMIN" },
    );
    await world.t.run(async (ctx) => {
      const adapterId = await ctx.db.insert("integrationAdapters", {
        orgId: world.orgA,
        code: "TENANT_A_SECRET_ADAPTER",
        displayName: "Tenant A payroll bridge",
        kind: "ERP",
        status: "DEGRADED",
        configurationKey: "TENANT_A_PRIVATE_CONFIG",
        lastFailureCode: "PRIVATE_PROVIDER_FAILURE",
        updatedByUserId: world.userA,
        updatedAt: 1,
      });
      await ctx.db.insert("integrationOutboxMessages", {
        orgId: world.orgA,
        eventKey: "private:event:1",
        adapterId,
        eventType: "private.event",
        schemaVersion: 1,
        sourceTable: "privateRecords",
        sourceId: "private-1",
        payloadJson: '{"private":"content"}',
        payloadDigest: "private-digest",
        status: "DEAD_LETTER",
        attemptCount: 5,
        availableAt: 0,
        createdAt: 1,
      });
    });

    const tenantB = await call(world, {
      subject: "user_fixture_a",
      org_id: "org_fixture_b",
    });
    expect(tenantB).toMatchObject({
      ok: true,
      value: { adapters: [], complete: true },
    });
    expect(JSON.stringify(tenantB)).not.toContain("TENANT_A");
    expect(JSON.stringify(tenantB)).not.toContain("PRIVATE");
  });
});
