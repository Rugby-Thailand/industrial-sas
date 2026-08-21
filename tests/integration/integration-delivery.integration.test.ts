import type { GenericMutationCtx } from "convex/server";
import { describe, expect, it } from "vitest";

import {
  claimMessage,
  listIntegrationHealth,
  recordDeliveryOutcome,
  retryMessage,
} from "../../convex/integrations/delivery";
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
): Promise<Record<string, unknown>> {
  return (await world.t
    .withIdentity({ subject: "user_fixture_a", org_id: "org_fixture_a" })
    .run(async (ctx) =>
      (fn as RuntimeFunction)._handler(
        ctx as GenericMutationCtx<DataModel>,
        args,
      ),
    )) as Record<string, unknown>;
}

const value = (outcome: Record<string, unknown>) => {
  expect(outcome["ok"], JSON.stringify(outcome)).toBe(true);
  return outcome["value"] as Record<string, unknown>;
};

describe("provider-neutral outbox delivery", () => {
  it("replays claim/result IDs, records failures, and recovers without duplicating delivery", async () => {
    const world = await createConvexInventoryWorld({}, { roleA: "ORG_ADMIN" });
    const seeded = await world.t.run(async (ctx) => {
      const adapterId = await ctx.db.insert("integrationAdapters", {
        orgId: world.orgA,
        code: "ERP_PRIMARY",
        displayName: "ERP primary",
        kind: "ERP",
        status: "ENABLED",
        configurationKey: "ERP_PRIMARY_CONFIG",
        updatedByUserId: world.userA,
        updatedAt: 1,
      });
      const messageId = await ctx.db.insert("integrationOutboxMessages", {
        orgId: world.orgA,
        eventKey: "sales.order.released:so-001:r1",
        adapterId,
        eventType: "sales.order.released",
        schemaVersion: 1,
        sourceTable: "customerOrders",
        sourceId: "so-001",
        payloadJson: '{"orderNumber":"SO-001"}',
        payloadDigest: "fixture-digest",
        status: "PENDING",
        attemptCount: 0,
        availableAt: 0,
        createdAt: 1,
      });
      return { adapterId, messageId };
    });

    const claimArgs = {
      requestId: "integration-claim-1",
      messageId: seeded.messageId,
    };
    expect(value(await call(world, claimMessage, claimArgs))).toMatchObject({
      written: true,
      replayed: false,
    });
    expect(value(await call(world, claimMessage, claimArgs))).toMatchObject({
      written: true,
      replayed: true,
    });

    const failedArgs = {
      requestId: "integration-result-1",
      messageId: seeded.messageId,
      correlationId: "provider-correlation-1",
      outcome: "RETRYABLE_FAILURE",
      errorCode: "PROVIDER_TIMEOUT",
    };
    expect(
      value(await call(world, recordDeliveryOutcome, failedArgs)),
    ).toMatchObject({ written: true, replayed: false });
    expect(
      value(await call(world, recordDeliveryOutcome, failedArgs)),
    ).toMatchObject({ written: true, replayed: true });

    expect(
      value(
        await call(world, retryMessage, {
          requestId: "integration-retry-1",
          messageId: seeded.messageId,
        }),
      ),
    ).toMatchObject({ written: true });
    expect(
      value(
        await call(world, claimMessage, {
          requestId: "integration-claim-2",
          messageId: seeded.messageId,
        }),
      ),
    ).toMatchObject({ written: true });
    expect(
      value(
        await call(world, recordDeliveryOutcome, {
          requestId: "integration-result-2",
          messageId: seeded.messageId,
          correlationId: "provider-correlation-2",
          outcome: "DELIVERED",
          responseStatus: 202,
        }),
      ),
    ).toMatchObject({ written: true });

    const stored = await world.t.run(async (ctx) => ({
      message: await ctx.db.get(seeded.messageId),
      attempts: await ctx.db
        .query("integrationDeliveryAttempts")
        .withIndex("by_orgId_messageId_attemptNumber", (query) =>
          query.eq("orgId", world.orgA).eq("messageId", seeded.messageId),
        )
        .collect(),
    }));
    expect(stored.message).toMatchObject({
      status: "DELIVERED",
      attemptCount: 2,
    });
    expect(stored.attempts).toHaveLength(2);

    const health = value(await call(world, listIntegrationHealth, {}));
    expect(health["adapters"]).toEqual([
      expect.objectContaining({
        code: "ERP_PRIMARY",
        status: "ENABLED",
        pending: 0,
        retrying: 0,
        deadLetter: 0,
      }),
    ]);
  });
});
