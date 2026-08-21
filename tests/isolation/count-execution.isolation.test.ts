/** Count targets are tenant-bound before any blind or reconciliation evidence is read. */
import type { GenericMutationCtx } from "convex/server";
import { describe, expect, it } from "vitest";

import {
  approveCountReconciliation,
  getAssignedCountTask,
} from "../../convex/inventory/countExecution";
import type { DataModel } from "../../convex/schema";
import {
  createConvexInventoryWorld,
  type ConvexInventoryWorld,
} from "../fixtures/convex-inventory-world";

interface RuntimeFunction {
  readonly _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
}

async function callAsTenantB(
  world: ConvexInventoryWorld,
  fn: unknown,
  args: unknown,
): Promise<Record<string, unknown>> {
  return (await world.t
    .withIdentity({ subject: "user_fixture_a", org_id: "org_fixture_b" })
    .run(async (ctx) =>
      (fn as RuntimeFunction)._handler(
        ctx as GenericMutationCtx<DataModel>,
        args,
      ),
    )) as Record<string, unknown>;
}

describe("count execution tenant isolation", () => {
  it("gives tenant B the same generic denial for tenant A's task and approval target", async () => {
    const world = await createConvexInventoryWorld();
    const foreign = await world.t.run(async (ctx) => {
      const planId = await ctx.db.insert("countPlans", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        planNumber: "PRIVATE-COUNT-A",
        status: "IN_PROGRESS",
        scope: "SPOT",
        visibility: "BLIND",
        movementPolicy: "MOVEMENT_AWARE",
        quantityThresholdBaseMinorUnits: 1,
        valueThresholdMinorUnits: 1,
        taskCount: 1,
        completedTaskCount: 0,
        varianceTaskCount: 1,
        createdByUserId: world.userA,
        createdAt: 1,
      });
      const taskId = await ctx.db.insert("countTasks", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        countPlanId: planId,
        taskNumber: 1,
        locationId: world.a.rack,
        status: "SUBMITTED",
        firstCounterUserId: world.userA,
        submittedCountOrdinal: 1,
        firstSubmittedAt: 2,
        entryCount: 1,
      });
      const snapshotId = await ctx.db.insert("countSnapshots", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        countPlanId: planId,
        countTaskId: taskId,
        bucketKey: "private-bucket-key-a",
        itemId: world.a.item,
        locationId: world.a.rack,
        lotId: world.a.lot,
        stockStatus: "AVAILABLE",
        baseUom: "PCS",
        systemBaseMinorUnits: 99_000,
        inCountMovementBaseMinorUnits: 0,
        itemClass: "HIGH_VALUE",
        unitValueMinorUnits: 9_999,
        capturedAt: 1,
      });
      const reconciliationId = await ctx.db.insert("countReconciliations", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        countPlanId: planId,
        countTaskId: taskId,
        countSnapshotId: snapshotId,
        status: "PENDING_APPROVAL",
        risk: "HIGH",
        systemSnapshotBaseMinorUnits: 99_000,
        inCountMovementBaseMinorUnits: 0,
        physicalBaseMinorUnits: 1,
        varianceBaseMinorUnits: -98_999,
        absoluteVarianceValueMinorUnits: 989_891_001,
        rootCauseCode: "ADJ-01",
        counterUserId: world.userA,
      });
      return { taskId, reconciliationId };
    });

    const taskRead = await callAsTenantB(world, getAssignedCountTask, {
      warehouseId: world.warehouses.alphaB,
      countTaskId: foreign.taskId,
    });
    const approval = await callAsTenantB(world, approveCountReconciliation, {
      requestId: "0193f2c1-2000-7000-8000-000000000001",
      warehouseId: world.warehouses.alphaB,
      countReconciliationId: foreign.reconciliationId,
    });

    expect(taskRead).toMatchObject({ ok: true, value: { found: false } });
    expect(approval).toMatchObject({
      ok: false,
      denial: { code: "AUTHORIZATION_DENIED" },
    });
    for (const outcome of [taskRead, approval]) {
      expect(JSON.stringify(outcome)).not.toContain("99,000");
      expect(JSON.stringify(outcome)).not.toContain("HIGH_VALUE");
    }
  });
});
