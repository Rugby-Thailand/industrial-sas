/** Count plan → blind count → independent recount → approved ledger adjustment. */
import type { GenericMutationCtx } from "convex/server";
import type { GenericId } from "convex/values";
import { describe, expect, it } from "vitest";

import {
  approveCountReconciliation,
  captureCountTaskEntry,
  getAssignedCountTask,
  listAvailableCountTasks,
  listCountReconciliationWork,
  prepareCountReconciliation,
  recordCountPaperCapture,
  startCountTask,
  submitCountTask,
} from "../../convex/inventory/countExecution";
import {
  completeCountPlan,
  createCountPlan,
  releaseCountPlan,
} from "../../convex/inventory/countPlans";
import { postTransaction } from "../../convex/inventory/ledger";
import type { DataModel } from "../../convex/schema";
import {
  createConvexInventoryWorld,
  FIXTURE_UOM,
  type ConvexInventoryWorld,
} from "../fixtures/convex-inventory-world";
import {
  recordStepUp,
  seedSecondActorForOrgA,
} from "../fixtures/convex-tenant-world";

interface RuntimeFunction {
  readonly _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
}

const actorA = { subject: "user_fixture_a", org_id: "org_fixture_a" };

const requestId = (sequence: number) =>
  `0193f2c1-1000-7000-8000-${sequence.toString().padStart(12, "0")}`;

async function call(
  world: ConvexInventoryWorld,
  fn: unknown,
  args: unknown,
  identity: { readonly subject: string; readonly org_id: string } = actorA,
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

const value = (outcome: Record<string, unknown>) => {
  expect(outcome["ok"], JSON.stringify(outcome)).toBe(true);
  return outcome["value"] as Record<string, unknown>;
};

const written = (outcome: Record<string, unknown>) => {
  const result = value(outcome);
  expect(result["written"], JSON.stringify(result)).toBe(true);
  return result;
};

const refusalCode = (outcome: Record<string, unknown>) => {
  const result = value(outcome);
  expect(result["written"], JSON.stringify(result)).toBe(false);
  return (result["error"] as Record<string, unknown>)["code"];
};

async function seedThirdManager(world: ConvexInventoryWorld) {
  return await world.t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      clerkUserId: "user_fixture_a3",
      displayName: "Fixture A3",
      status: "ACTIVE",
    });
    const membershipId = await ctx.db.insert("memberships", {
      orgId: world.orgA,
      userId,
      clerkMembershipId: "orgmem_fixture_a3",
      status: "ACTIVE",
      scopeMode: "ORG_WIDE",
      effectiveFrom: 0,
    });
    const role = await ctx.db
      .query("roles")
      .withIndex("by_orgId_key", (query) =>
        query.eq("orgId", world.orgA).eq("key", "WAREHOUSE_MANAGER"),
      )
      .unique();
    if (role === null) throw new Error("missing manager role");
    await ctx.db.insert("membershipRoles", {
      orgId: world.orgA,
      membershipId,
      roleId: role._id,
      grantedAt: 0,
    });
    return { userId, clerkUserId: "user_fixture_a3" };
  });
}

async function seedStockAndPlan(world: ConvexInventoryWorld) {
  value(
    await call(world, postTransaction, {
      warehouseId: world.warehouses.alphaA,
      requestId: requestId(1),
      type: "RECEIPT",
      source: { type: "TEST", id: "count-baseline" },
      lines: [
        {
          itemId: world.a.item,
          locationKind: "PHYSICAL",
          locationId: world.a.rack,
          lotId: world.a.lot,
          stockStatus: "AVAILABLE",
          quantity: { uom: FIXTURE_UOM, minorUnits: 5_000 },
        },
        {
          itemId: world.a.item,
          locationKind: "VIRTUAL",
          virtualBoundary: "SUPPLIER_RECEIPT",
          lotId: world.a.lot,
          stockStatus: "AVAILABLE",
          quantity: { uom: FIXTURE_UOM, minorUnits: -5_000 },
        },
      ],
    }),
  );
  const bucketKey = await world.t.run(async (ctx) => {
    const balance = await ctx.db
      .query("inventoryBalances")
      .withIndex("by_orgId_warehouseId_itemId_stockStatus", (query) =>
        query
          .eq("orgId", world.orgA)
          .eq("warehouseId", world.warehouses.alphaA)
          .eq("itemId", world.a.item)
          .eq("stockStatus", "AVAILABLE"),
      )
      .filter((query) => query.eq(query.field("locationId"), world.a.rack))
      .unique();
    if (balance === null) throw new Error("missing physical balance");
    return balance.bucketKey;
  });
  const planId = written(
    await call(world, createCountPlan, {
      requestId: requestId(2),
      warehouseId: world.warehouses.alphaA,
      planNumber: "COUNT-001",
      scope: "CYCLE",
      visibility: "BLIND",
      movementPolicy: "MOVEMENT_AWARE",
      quantityThresholdBaseMinorUnits: 1_000,
      valueThresholdMinorUnits: 1_000_000,
      targets: [{ bucketKey, itemClass: "C", unitValueMinorUnits: 1 }],
    }),
  )["documentId"] as GenericId<"countPlans">;
  written(
    await call(world, releaseCountPlan, {
      requestId: requestId(3),
      warehouseId: world.warehouses.alphaA,
      countPlanId: planId,
    }),
  );
  const taskId = await world.t.run(async (ctx) => {
    const task = await ctx.db
      .query("countTasks")
      .withIndex("by_orgId_countPlanId_taskNumber", (query) =>
        query.eq("orgId", world.orgA).eq("countPlanId", planId),
      )
      .unique();
    if (task === null) throw new Error("missing count task");
    return task._id;
  });
  return { planId, taskId, bucketKey };
}

describe("physical count execution", () => {
  it("accepts a paper fallback only after matching re-entry by two people", async () => {
    const world = await createConvexInventoryWorld();
    const secondKeyer = await seedSecondActorForOrgA(
      world,
      "WAREHOUSE_MANAGER",
    );
    const { taskId } = await seedStockAndPlan(world);
    written(
      await call(world, startCountTask, {
        requestId: requestId(30),
        warehouseId: world.warehouses.alphaA,
        countTaskId: taskId,
      }),
    );
    const sheetHash = "a".repeat(64);
    written(
      await call(world, recordCountPaperCapture, {
        requestId: requestId(31),
        warehouseId: world.warehouses.alphaA,
        countTaskId: taskId,
        captureOrdinal: 1,
        sheetHash,
        lineCount: 1,
        evidenceId: "paper_scan_1",
      }),
    );
    const secondIdentity = {
      subject: secondKeyer.clerkUserId,
      org_id: "org_fixture_a",
    };
    expect(
      refusalCode(
        await call(
          world,
          recordCountPaperCapture,
          {
            requestId: requestId(32),
            warehouseId: world.warehouses.alphaA,
            countTaskId: taskId,
            captureOrdinal: 2,
            sheetHash: "b".repeat(64),
            lineCount: 1,
            evidenceId: "paper_scan_2",
          },
          secondIdentity,
        ),
      ),
    ).toBe("PAPER_CAPTURES_DIFFER");
    written(
      await call(
        world,
        recordCountPaperCapture,
        {
          requestId: requestId(33),
          warehouseId: world.warehouses.alphaA,
          countTaskId: taskId,
          captureOrdinal: 2,
          sheetHash,
          lineCount: 1,
          evidenceId: "paper_scan_2",
        },
        secondIdentity,
      ),
    );
    written(
      await call(world, captureCountTaskEntry, {
        requestId: requestId(34),
        warehouseId: world.warehouses.alphaA,
        countTaskId: taskId,
        source: "PAPER_REENTRY",
        entryUom: "PCS",
        entryMinorUnits: 5_000,
        paperEvidenceId: "paper_scan_1",
      }),
    );
  });

  it("never exposes the snapshot or first count to a blind recounter", async () => {
    const world = await createConvexInventoryWorld();
    const recounter = await seedSecondActorForOrgA(world, "WAREHOUSE_MANAGER");
    const { taskId } = await seedStockAndPlan(world);

    const startArgs = {
      requestId: requestId(4),
      warehouseId: world.warehouses.alphaA,
      countTaskId: taskId,
    };
    written(await call(world, startCountTask, startArgs));
    expect(
      written(await call(world, startCountTask, startArgs))["replayed"],
    ).toBe(true);
    const captureArgs = {
      requestId: requestId(5),
      warehouseId: world.warehouses.alphaA,
      countTaskId: taskId,
      source: "HANDHELD",
      entryUom: "PCS",
      entryMinorUnits: 3_000,
    } as const;
    written(await call(world, captureCountTaskEntry, captureArgs));
    const submitArgs = {
      requestId: requestId(6),
      warehouseId: world.warehouses.alphaA,
      countTaskId: taskId,
    };
    written(await call(world, submitCountTask, submitArgs));
    expect(
      written(await call(world, captureCountTaskEntry, captureArgs))[
        "replayed"
      ],
    ).toBe(true);
    const prepareArgs = {
      requestId: requestId(7),
      warehouseId: world.warehouses.alphaA,
      countTaskId: taskId,
      rootCauseCode: "ADJ-01",
    };
    const recounterIdentity = {
      subject: recounter.clerkUserId,
      org_id: "org_fixture_a",
    };
    written(
      await call(
        world,
        prepareCountReconciliation,
        prepareArgs,
        recounterIdentity,
      ),
    );
    expect(
      written(await call(world, submitCountTask, submitArgs))["replayed"],
    ).toBe(true);
    expect(
      written(
        await call(
          world,
          prepareCountReconciliation,
          prepareArgs,
          recounterIdentity,
        ),
      )["replayed"],
    ).toBe(true);

    written(
      await call(
        world,
        startCountTask,
        {
          requestId: requestId(8),
          warehouseId: world.warehouses.alphaA,
          countTaskId: taskId,
        },
        recounterIdentity,
      ),
    );
    const view = value(
      await call(
        world,
        getAssignedCountTask,
        { warehouseId: world.warehouses.alphaA, countTaskId: taskId },
        recounterIdentity,
      ),
    )["task"] as Record<string, unknown>;
    expect(view).not.toHaveProperty("systemSnapshotBaseMinorUnits");
    expect(view).not.toHaveProperty("movementBaseMinorUnits");
    expect(view).not.toHaveProperty("firstCountBaseMinorUnits");
  });

  it("requires an independent stepped-up approver and posts one balanced adjustment", async () => {
    const world = await createConvexInventoryWorld();
    const recounter = await seedSecondActorForOrgA(world, "WAREHOUSE_MANAGER");
    const approver = await seedThirdManager(world);
    const { planId, taskId, bucketKey } = await seedStockAndPlan(world);
    const recounterIdentity = {
      subject: recounter.clerkUserId,
      org_id: "org_fixture_a",
    };

    written(
      await call(world, startCountTask, {
        requestId: requestId(14),
        warehouseId: world.warehouses.alphaA,
        countTaskId: taskId,
      }),
    );
    written(
      await call(world, captureCountTaskEntry, {
        requestId: requestId(15),
        warehouseId: world.warehouses.alphaA,
        countTaskId: taskId,
        source: "HANDHELD",
        entryUom: "PCS",
        entryMinorUnits: 3_000,
      }),
    );
    written(
      await call(world, submitCountTask, {
        requestId: requestId(16),
        warehouseId: world.warehouses.alphaA,
        countTaskId: taskId,
      }),
    );
    written(
      await call(
        world,
        prepareCountReconciliation,
        {
          requestId: requestId(17),
          warehouseId: world.warehouses.alphaA,
          countTaskId: taskId,
          rootCauseCode: "ADJ-01",
        },
        recounterIdentity,
      ),
    );
    const recountQueue = value(
      await call(
        world,
        listAvailableCountTasks,
        { warehouseId: world.warehouses.alphaA },
        recounterIdentity,
      ),
    );
    expect(recountQueue["tasks"]).toEqual([
      expect.objectContaining({ countTaskId: taskId }),
    ]);
    written(
      await call(
        world,
        startCountTask,
        {
          requestId: requestId(18),
          warehouseId: world.warehouses.alphaA,
          countTaskId: taskId,
        },
        recounterIdentity,
      ),
    );
    written(
      await call(
        world,
        captureCountTaskEntry,
        {
          requestId: requestId(19),
          warehouseId: world.warehouses.alphaA,
          countTaskId: taskId,
          source: "HANDHELD",
          entryUom: "PCS",
          entryMinorUnits: 3_000,
        },
        recounterIdentity,
      ),
    );
    written(
      await call(
        world,
        submitCountTask,
        {
          requestId: requestId(20),
          warehouseId: world.warehouses.alphaA,
          countTaskId: taskId,
        },
        recounterIdentity,
      ),
    );
    const reconciliationId = written(
      await call(
        world,
        prepareCountReconciliation,
        {
          requestId: requestId(21),
          warehouseId: world.warehouses.alphaA,
          countTaskId: taskId,
          rootCauseCode: "ADJ-01",
        },
        recounterIdentity,
      ),
    )["documentId"] as GenericId<"countReconciliations">;
    const approvalQueue = value(
      await call(world, listCountReconciliationWork, {
        warehouseId: world.warehouses.alphaA,
      }),
    );
    expect(approvalQueue["pendingApproval"]).toEqual([
      expect.objectContaining({
        countReconciliationId: reconciliationId,
        varianceBaseMinorUnits: -2_000,
      }),
    ]);

    const now = Date.now();
    await recordStepUp(world, {
      orgId: world.orgA,
      userId: approver.userId,
      occurredAt: now,
      reverifiedAt: now,
    });
    const approverIdentity = {
      subject: approver.clerkUserId,
      org_id: "org_fixture_a",
    };
    const approvalArgs = {
      requestId: requestId(22),
      warehouseId: world.warehouses.alphaA,
      countReconciliationId: reconciliationId,
    };
    const first = written(
      await call(
        world,
        approveCountReconciliation,
        approvalArgs,
        approverIdentity,
      ),
    );
    const replay = written(
      await call(
        world,
        approveCountReconciliation,
        approvalArgs,
        approverIdentity,
      ),
    );
    expect(replay).toMatchObject({
      replayed: true,
      documentId: first["documentId"],
    });
    written(
      await call(world, completeCountPlan, {
        requestId: requestId(23),
        warehouseId: world.warehouses.alphaA,
        countPlanId: planId,
      }),
    );

    const evidence = await world.t.run(async (ctx) => {
      const reconciliation = await ctx.db.get(reconciliationId);
      const task = await ctx.db.get(taskId);
      const plan = await ctx.db.get(planId);
      const balance = await ctx.db
        .query("inventoryBalances")
        .withIndex("by_orgId_bucketKey", (query) =>
          query.eq("orgId", world.orgA).eq("bucketKey", bucketKey),
        )
        .unique();
      const lines = reconciliation?.transactionId
        ? await ctx.db
            .query("inventoryLedgerLines")
            .withIndex("by_orgId_transactionId_lineIndex", (query) =>
              query
                .eq("orgId", world.orgA)
                .eq("transactionId", reconciliation.transactionId!),
            )
            .collect()
        : [];
      return { reconciliation, task, plan, balance, lines };
    });
    expect(evidence.reconciliation).toMatchObject({
      status: "POSTED",
      risk: "HIGH",
      varianceBaseMinorUnits: -2_000,
    });
    expect(evidence.task?.status).toBe("RECONCILED");
    expect(evidence.plan?.status).toBe("COMPLETED");
    expect(evidence.balance?.quantity.minorUnits).toBe(3_000);
    expect(evidence.lines).toHaveLength(2);
    expect(
      evidence.lines.reduce((sum, line) => sum + line.quantity.minorUnits, 0),
    ).toBe(0);
  });
});
