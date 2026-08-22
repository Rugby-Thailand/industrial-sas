/**
 * Tenant and warehouse isolation over the Phase 1 shared operator surfaces.
 *
 * Three questions, each asked against a deliberately colliding world:
 *
 * 1. Does one tenant's board ever return another tenant's rows, when both use
 *    the same task number and the same device label?
 * 2. Is a foreign identifier — a task, a step-up approval — indistinguishable
 *    from one that does not exist? A different answer would confirm the row's
 *    existence to a caller who may not read it (`INV-0002-03`).
 * 3. Does warehouse scope hold *within* a tenant, so an operator scoped to one
 *    site cannot claim another site's backlog (`INV-0006-04`)?
 */
import type { GenericMutationCtx } from "convex/server";
import type { GenericId } from "convex/values";
import { describe, expect, it } from "vitest";

import { listDevices, registerDevice } from "../../convex/platform/devices";
import {
  listTaskExceptions,
  resolveTaskException,
} from "../../convex/platform/exceptions";
import {
  claimOperatorTask,
  listOperatorTaskEvidence,
  listOperatorTasks,
  recordTaskEvidence,
} from "../../convex/platform/tasks";
import {
  listTaskFiles,
  requestTaskFileAccess,
} from "../../convex/platform/taskFiles";
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

const call = async (
  world: ConvexInventoryWorld,
  fn: unknown,
  args: unknown,
  org: "a" | "b" = "a",
): Promise<Record<string, unknown>> =>
  (await world.t
    .withIdentity({ subject: "user_fixture_a", org_id: `org_fixture_${org}` })
    .run(async (ctx) =>
      (fn as RuntimeFunction)._handler(
        ctx as GenericMutationCtx<DataModel>,
        args,
      ),
    )) as Record<string, unknown>;

const value = (outcome: Record<string, unknown>) => {
  expect(outcome["ok"], JSON.stringify(outcome)).toBe(true);
  return outcome["value"] as Record<string, unknown>;
};

/**
 * Both tenants get a task under the same number, seeded directly so the test
 * is about the read rather than about the writer.
 */
async function seedCollidingTasks(world: ConvexInventoryWorld): Promise<{
  readonly a: GenericId<"operatorTasks">;
  readonly b: GenericId<"operatorTasks">;
}> {
  return await world.t.run(async (ctx) => {
    const insert = async (
      orgId: GenericId<"organizations">,
      warehouseId: GenericId<"warehouses">,
      createdByUserId: GenericId<"users">,
    ) =>
      await ctx.db.insert("operatorTasks", {
        orgId,
        warehouseId,
        taskNumber: "WT-COLLISION",
        kind: "SUPERVISOR_ASSIGNED" as const,
        instruction: "count aisle 1",
        status: "AVAILABLE" as const,
        evidenceCount: 0,
        createdByUserId,
      });
    return {
      a: await insert(world.orgA, world.warehouses.alphaA, world.userA),
      b: await insert(world.orgB, world.warehouses.alphaB, world.userA),
    };
  });
}

describe("operator work tenant isolation", () => {
  it("never returns another tenant's colliding task", async () => {
    const world = await createConvexInventoryWorld();
    const seeded = await seedCollidingTasks(world);

    const boardA = value(
      await call(
        world,
        listOperatorTasks,
        { warehouseId: world.warehouses.alphaA },
        "a",
      ),
    );
    const boardB = value(
      await call(
        world,
        listOperatorTasks,
        { warehouseId: world.warehouses.alphaB },
        "b",
      ),
    );

    const idsOf = (board: Record<string, unknown>) =>
      (board["items"] as Record<string, unknown>[]).map(
        (row) => row["operatorTaskId"],
      );
    expect(idsOf(boardA)).toEqual([seeded.a]);
    expect(idsOf(boardB)).toEqual([seeded.b]);
  });

  it("keeps identically described task exceptions inside their tenant", async () => {
    const world = await createConvexInventoryWorld();
    const tasks = await seedCollidingTasks(world);
    const exceptions = await world.t.run(async (ctx) => {
      const insert = async (
        orgId: GenericId<"organizations">,
        warehouseId: GenericId<"warehouses">,
        operatorTaskId: GenericId<"operatorTasks">,
        reasonCodeId: GenericId<"reasonCodes">,
      ) =>
        await ctx.db.insert("operatorTaskExceptions", {
          orgId,
          warehouseId,
          operatorTaskId,
          reasonCodeId,
          reasonCode: "ADJ-01",
          reasonName: "Adjustment",
          summary: "same visible summary",
          evidence: "same visible evidence",
          proposedDisposition: "ESCALATE" as const,
          proposedRecoveryAction: "ask supervisor",
          status: "OPEN" as const,
          reportedByUserId: world.userA,
          reportedAt: Date.now(),
        });
      return {
        a: await insert(
          world.orgA,
          world.warehouses.alphaA,
          tasks.a,
          world.a.adjustmentReason,
        ),
        b: await insert(
          world.orgB,
          world.warehouses.alphaB,
          tasks.b,
          world.b.adjustmentReason,
        ),
      };
    });

    const listedA = value(
      await call(
        world,
        listTaskExceptions,
        {
          warehouseId: world.warehouses.alphaA,
          operatorTaskId: tasks.a,
        },
        "a",
      ),
    );
    expect(
      (listedA["items"] as Record<string, unknown>[]).map(
        (row) => row["operatorTaskExceptionId"],
      ),
    ).toEqual([exceptions.a]);

    const foreignDecision = await call(
      world,
      resolveTaskException,
      {
        requestId: "req-foreign-exception",
        warehouseId: world.warehouses.alphaA,
        operatorTaskExceptionId: exceptions.b,
        finalDisposition: "STOP",
        recoveryAction: "must never write tenant B",
      },
      "a",
    );
    expect(foreignDecision["ok"]).toBe(false);
    const untouched = await world.t.run(
      async (ctx) => await ctx.db.get("operatorTaskExceptions", exceptions.b),
    );
    expect(untouched?.status).toBe("OPEN");
  });

  it("keeps private task attachment metadata and grants inside their tenant", async () => {
    const world = await createConvexInventoryWorld();
    const tasks = await seedCollidingTasks(world);
    const attachments = await world.t.run(async (ctx) => {
      const insert = async (
        orgId: GenericId<"organizations">,
        warehouseId: GenericId<"warehouses">,
        operatorTaskId: GenericId<"operatorTasks">,
      ) =>
        await ctx.db.insert("operatorTaskAttachments", {
          orgId,
          warehouseId,
          operatorTaskId,
          fileName: "same-name.jpg",
          kind: "PHOTO" as const,
          contentType: "image/jpeg",
          byteSize: 100,
          contentDigest: "b".repeat(64),
          uploadThingKey: `private-${orgId}`,
          verifiedAt: Date.now(),
          attachedByUserId: world.userA,
          attachedAt: Date.now(),
        });
      return {
        a: await insert(world.orgA, world.warehouses.alphaA, tasks.a),
        b: await insert(world.orgB, world.warehouses.alphaB, tasks.b),
      };
    });

    const listedA = value(
      await call(world, listTaskFiles, {
        warehouseId: world.warehouses.alphaA,
        operatorTaskId: tasks.a,
      }),
    );
    expect(
      (listedA["items"] as Record<string, unknown>[]).map(
        (row) => row["operatorTaskAttachmentId"],
      ),
    ).toEqual([attachments.a]);
    expect(JSON.stringify(listedA)).not.toContain("private-");

    const foreign = await call(world, requestTaskFileAccess, {
      warehouseId: world.warehouses.alphaA,
      operatorTaskAttachmentId: attachments.b,
    });
    expect(value(foreign)).toEqual({
      granted: false,
      error: { code: "NOT_FOUND" },
    });
  });

  it("makes a foreign task identifier indistinguishable from a missing one", async () => {
    const world = await createConvexInventoryWorld();
    const seeded = await seedCollidingTasks(world);

    const claim = value(
      await call(
        world,
        claimOperatorTask,
        {
          requestId: "req-claim",
          warehouseId: world.warehouses.alphaB,
          operatorTaskId: seeded.a,
        },
        "b",
      ),
    );
    expect(claim["written"]).toBe(false);
    expect((claim["error"] as Record<string, unknown>)["code"]).toBe(
      "NOT_FOUND",
    );

    const evidence = value(
      await call(
        world,
        listOperatorTaskEvidence,
        {
          warehouseId: world.warehouses.alphaB,
          operatorTaskId: seeded.a,
        },
        "b",
      ),
    );
    expect(evidence["ok"]).toBe(false);
  });

  it("refuses a task at another warehouse inside the same tenant", async () => {
    const world = await createConvexInventoryWorld();
    const taskId = await world.t.run(
      async (ctx) =>
        await ctx.db.insert("operatorTasks", {
          orgId: world.orgA,
          // BRAVO, which the fixture membership is not scoped to.
          warehouseId: world.warehouses.bravoA,
          taskNumber: "WT-BRAVO",
          kind: "SUPERVISOR_ASSIGNED" as const,
          instruction: "count aisle 2",
          status: "AVAILABLE" as const,
          evidenceCount: 0,
          createdByUserId: world.userA,
        }),
    );

    /*
     * Asking for BRAVO is refused while the tenant context is resolved, before
     * any authorization outcome exists to return — so it arrives as a thrown
     * `WAREHOUSE_OUT_OF_SCOPE`, not as an envelope. The distinction matters:
     * the request never reached a handler that could have read the row.
     */
    await expect(
      call(world, claimOperatorTask, {
        requestId: "req-claim",
        warehouseId: world.warehouses.bravoA,
        operatorTaskId: taskId,
      }),
    ).rejects.toThrow(/WAREHOUSE_OUT_OF_SCOPE/);

    // Naming ALPHA to get past the scope check does not reach the task either:
    // the handler proves the task's own site.
    const mislabelled = value(
      await call(world, claimOperatorTask, {
        requestId: "req-claim-2",
        warehouseId: world.warehouses.alphaA,
        operatorTaskId: taskId,
      }),
    );
    expect((mislabelled["error"] as Record<string, unknown>)["code"]).toBe(
      "NOT_FOUND",
    );
  });

  it("cannot spend another tenant's step-up approval", async () => {
    const world = await createConvexInventoryWorld();
    const seeded = await seedCollidingTasks(world);

    const foreignApproval = await world.t.run(async (ctx) => {
      const deviceId = await ctx.db.insert("devices", {
        orgId: world.orgA,
        label: "Handheld A",
        deviceType: "HANDHELD" as const,
        status: "ACTIVE" as const,
        installationId: "installation-a-0001",
      });
      return await ctx.db.insert("stepUpApprovals", {
        orgId: world.orgA,
        operation: "work.evidence.implausibleQuantity",
        targetRef: seeded.b,
        operatorUserId: world.userA,
        approverUserId: world.userA,
        deviceId,
        decision: "APPROVED" as const,
        reason: "seeded",
        grantedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      });
    });

    // Tenant B holds the task and a device of its own; the approval belongs to
    // tenant A, so the accessor cannot reach it at all.
    await world.t.run(async (ctx) => {
      await ctx.db.insert("devices", {
        orgId: world.orgB,
        label: "Handheld B",
        deviceType: "HANDHELD" as const,
        status: "ACTIVE" as const,
        installationId: "installation-b-0001",
      });
      await ctx.db.patch("operatorTasks", seeded.b, {
        status: "CLAIMED" as const,
        claimedByUserId: world.userA,
        claimedAt: Date.now(),
        leaseExpiresAt: Date.now() + 60_000,
        itemId: world.b.item,
        expectedBaseMinorUnits: 100_000,
      });
    });

    const spent = value(
      await call(
        world,
        recordTaskEvidence,
        {
          requestId: "req-evidence-1",
          warehouseId: world.warehouses.alphaB,
          operatorTaskId: seeded.b,
          kind: "QUANTITY",
          quantityText: "1000",
          entryUom: "PCS",
          installationId: "installation-b-0001",
          stepUpApprovalId: foreignApproval,
        },
        "b",
      ),
    );
    expect(spent["written"]).toBe(false);
    expect((spent["error"] as Record<string, unknown>)["code"]).toBe(
      "APPROVAL_NOT_FOUND",
    );
  });

  it("keeps two tenants' identically labelled devices apart", async () => {
    const world = await createConvexInventoryWorld();

    for (const org of ["a", "b"] as const) {
      const registered = value(
        await call(
          world,
          registerDevice,
          {
            requestId: `req-${org}`,
            label: "Dock 1 handheld",
            deviceType: "HANDHELD",
          },
          org,
        ),
      );
      expect(registered["written"], JSON.stringify(registered)).toBe(true);
    }

    const listedA = value(await call(world, listDevices, {}, "a"));
    const listedB = value(await call(world, listDevices, {}, "b"));
    const rowsA = listedA["items"] as Record<string, unknown>[];
    const rowsB = listedB["items"] as Record<string, unknown>[];

    expect(rowsA).toHaveLength(1);
    expect(rowsB).toHaveLength(1);
    expect(rowsA[0]!["label"]).toBe(rowsB[0]!["label"]);
    expect(rowsA[0]!["deviceId"]).not.toBe(rowsB[0]!["deviceId"]);
  });
});
