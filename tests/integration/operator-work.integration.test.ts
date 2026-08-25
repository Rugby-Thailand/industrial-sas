import type { GenericMutationCtx } from "convex/server";
import type { GenericId } from "convex/values";
import { describe, expect, it } from "vitest";

import {
  bindDeviceInstallation,
  listDevices,
  recordDeviceSeen,
  registerDevice,
  renameDevice,
  retireDevice,
} from "../../convex/platform/devices";
import {
  listTaskExceptions,
  reportTaskException,
  resolveTaskException,
} from "../../convex/platform/exceptions";
import { approveOnDevice } from "../../convex/platform/stepUp";
import {
  attachTaskFile,
  authorizeTaskFileUpload,
  listTaskFiles,
  redeemUploadThingTaskFileAccessGrant,
  requestTaskFileAccess,
} from "../../convex/platform/taskFiles";
import { completeUploadThingTaskUploadGrant } from "../../convex/lib/taskFileComplete";
import {
  claimOperatorTask,
  completeOperatorTask,
  createOperatorTask,
  heartbeatOperatorTask,
  listOperatorTaskEvidence,
  listOperatorTasks,
  reassignOperatorTask,
  recordTaskEvidence,
  releaseOperatorTask,
} from "../../convex/platform/tasks";
import { TASK_LEASE_MS } from "../../convex/model/platform/taskAssignment";
import type { DataModel } from "../../convex/schema";
import {
  createConvexInventoryWorld,
  type ConvexInventoryWorld,
} from "../fixtures/convex-inventory-world";
import {
  recordStepUp,
  seedSecondActorForOrgA,
  type ConvexSecondActor,
} from "../fixtures/convex-tenant-world";

interface RuntimeFunction {
  readonly _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
}

const operator = { subject: "user_fixture_a", org_id: "org_fixture_a" };

const call = async (
  world: ConvexInventoryWorld,
  fn: unknown,
  args: unknown,
  actor: { readonly subject: string; readonly org_id: string } = operator,
): Promise<Record<string, unknown>> =>
  (await world.t
    .withIdentity(actor)
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

const errorCode = (outcome: Record<string, unknown>): string => {
  const written = value(outcome);
  expect(written["written"], JSON.stringify(written)).toBe(false);
  return (written["error"] as Record<string, unknown>)["code"] as string;
};

const documentId = (outcome: Record<string, unknown>): string => {
  const written = value(outcome);
  expect(written["written"], JSON.stringify(written)).toBe(true);
  return written["documentId"] as string;
};

const seedDevice = async (
  world: ConvexInventoryWorld,
  installationId = "installation-a-0001",
): Promise<GenericId<"devices">> =>
  await world.t.run(
    async (ctx) =>
      await ctx.db.insert("devices", {
        orgId: world.orgA,
        label: `Handheld ${installationId}`,
        deviceType: "HANDHELD",
        status: "ACTIVE",
        installationId,
      }),
  );

const seedTask = async (
  world: ConvexInventoryWorld,
  overrides: Record<string, unknown> = {},
): Promise<GenericId<"operatorTasks">> => {
  const created = await call(world, createOperatorTask, {
    requestId: "req-create-1",
    warehouseId: world.warehouses.alphaA,
    taskNumber: "WT-0001",
    kind: "SUPERVISOR_ASSIGNED",
    instruction: "นับกล่องที่ชั้น A1",
    itemId: world.a.item,
    expectedBaseMinorUnits: 100_000,
    ...overrides,
  });
  return documentId(created) as GenericId<"operatorTasks">;
};

describe("device registry", () => {
  it("registers a device, refuses a duplicate label, and lists it", async () => {
    const world = await createConvexInventoryWorld();

    const first = await call(world, registerDevice, {
      requestId: "req-1",
      label: " Dock 1 handheld ",
      deviceType: "HANDHELD",
      warehouseId: world.warehouses.alphaA,
      installationId: "installation-a-0001",
    });
    expect(documentId(first)).toBeTruthy();

    const duplicate = await call(world, registerDevice, {
      requestId: "req-2",
      label: "Dock 1 handheld",
      deviceType: "HANDHELD",
    });
    expect(errorCode(duplicate)).toBe("DUPLICATE_KEY");

    const listed = value(await call(world, listDevices, {}));
    const rows = listed["items"] as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!["label"]).toBe("Dock 1 handheld");

    expect(rows[0]!["installationBound"]).toBe(true);
    expect(Object.keys(rows[0]!)).not.toContain("installationId");
  });

  it("refuses an installation already bound to another device", async () => {
    const world = await createConvexInventoryWorld();
    await seedDevice(world, "installation-a-0001");
    const second = documentId(
      await call(world, registerDevice, {
        requestId: "req-1",
        label: "Dock 2 handheld",
        deviceType: "HANDHELD",
      }),
    );

    const rebind = await call(world, bindDeviceInstallation, {
      requestId: "req-2",
      deviceId: second,
      installationId: "installation-a-0001",
    });
    expect(errorCode(rebind)).toBe("INSTALLATION_ALREADY_BOUND");
  });

  it("re-binding the same installation replays rather than failing", async () => {
    const world = await createConvexInventoryWorld();
    const deviceId = await seedDevice(world);
    const again = value(
      await call(world, bindDeviceInstallation, {
        requestId: "req-2",
        deviceId,
        installationId: "installation-a-0001",
      }),
    );
    expect(again["replayed"]).toBe(true);
  });

  it("retires a device, releases its installation, and refuses a second retirement", async () => {
    const world = await createConvexInventoryWorld();
    const deviceId = await seedDevice(world);

    expect(
      documentId(
        await call(world, retireDevice, { requestId: "req-1", deviceId }),
      ),
    ).toBe(deviceId);

    const stored = await world.t.run(
      async (ctx) => await ctx.db.get("devices", deviceId),
    );
    expect(stored?.status).toBe("RETIRED");
    expect(stored?.installationId).toBeUndefined();
    expect(stored?.retiredAt).toBeGreaterThan(0);

    const twice = await call(world, retireDevice, {
      requestId: "req-2",
      deviceId,
    });
    expect(errorCode(twice)).toBe("DEVICE_ALREADY_RETIRED");

    const rename = await call(world, renameDevice, {
      requestId: "req-3",
      deviceId,
      label: "Dock 9",
    });
    expect(errorCode(rename)).toBe("DEVICE_RETIRED");
  });

  it("records that a device is still in service, and refuses a retired one", async () => {
    const world = await createConvexInventoryWorld();
    const deviceId = await seedDevice(world);

    const seen = value(
      await call(world, recordDeviceSeen, {
        requestId: "req-1",
        warehouseId: world.warehouses.alphaA,
        installationId: "installation-a-0001",
      }),
    );
    expect(seen["documentId"]).toBe(deviceId);

    await call(world, retireDevice, { requestId: "req-2", deviceId });
    const afterRetirement = await call(world, recordDeviceSeen, {
      requestId: "req-3",
      warehouseId: world.warehouses.alphaA,
      installationId: "installation-a-0001",
    });

    expect(errorCode(afterRetirement)).toBe("NOT_FOUND");
  });
});

describe("task lease", () => {
  it("claims, heartbeats, and completes a task", async () => {
    const world = await createConvexInventoryWorld();
    const taskId = await seedTask(world);

    const claim = value(
      await call(world, claimOperatorTask, {
        requestId: "req-claim",
        warehouseId: world.warehouses.alphaA,
        operatorTaskId: taskId,
      }),
    );
    expect(claim["alreadyHeld"]).toBe(false);
    expect(claim["leaseExpiresAt"]).toBeGreaterThan(Date.now());

    const beat = value(
      await call(world, heartbeatOperatorTask, {
        requestId: "req-beat",
        warehouseId: world.warehouses.alphaA,
        operatorTaskId: taskId,
      }),
    );
    expect(beat["recovered"]).toBe(false);

    expect(
      documentId(
        await call(world, completeOperatorTask, {
          requestId: "req-complete",
          warehouseId: world.warehouses.alphaA,
          operatorTaskId: taskId,
        }),
      ),
    ).toBe(taskId);

    const stored = await world.t.run(
      async (ctx) => await ctx.db.get("operatorTasks", taskId),
    );
    expect(stored?.status).toBe("COMPLETED");
    expect(stored?.leaseExpiresAt).toBeUndefined();
  });

  it("refuses a second operator while the lease is live", async () => {
    const world = await createConvexInventoryWorld();
    const second = await seedSecondActorForOrgA(world, "WAREHOUSE_MANAGER");
    const taskId = await seedTask(world);

    await call(world, claimOperatorTask, {
      requestId: "req-claim",
      warehouseId: world.warehouses.alphaA,
      operatorTaskId: taskId,
    });

    const stolen = await call(
      world,
      claimOperatorTask,
      {
        requestId: "req-claim-2",
        warehouseId: world.warehouses.alphaA,
        operatorTaskId: taskId,
      },
      { subject: second.clerkUserId, org_id: "org_fixture_a" },
    );
    expect(errorCode(stolen)).toBe("TASK_HELD_BY_ANOTHER_OPERATOR");
  });

  it("refuses new evidence after the holder's lease has expired", async () => {
    const world = await createConvexInventoryWorld();
    const taskId = await seedTask(world);
    await call(world, claimOperatorTask, {
      requestId: "req-claim",
      warehouseId: world.warehouses.alphaA,
      operatorTaskId: taskId,
    });
    await world.t.run(async (ctx) => {
      await ctx.db.patch("operatorTasks", taskId, {
        leaseExpiresAt: Date.now() - 1,
      });
    });

    const evidence = await call(world, recordTaskEvidence, {
      requestId: "req-evidence-expired",
      warehouseId: world.warehouses.alphaA,
      operatorTaskId: taskId,
      kind: "SCAN",
      scanValue: "WIDGET-001",
    });
    expect(errorCode(evidence)).toBe("TASK_LEASE_EXPIRED");
  });

  it("returns a lapsed lease to the next operator, with partial evidence and a handover row", async () => {
    const world = await createConvexInventoryWorld();
    const second = await seedSecondActorForOrgA(world, "WAREHOUSE_MANAGER");
    const taskId = await seedTask(world);

    await call(world, claimOperatorTask, {
      requestId: "req-claim",
      warehouseId: world.warehouses.alphaA,
      operatorTaskId: taskId,
    });
    await call(world, recordTaskEvidence, {
      requestId: "req-evidence-1",
      warehouseId: world.warehouses.alphaA,
      operatorTaskId: taskId,
      kind: "SCAN",
      scanValue: "WIDGET-001",
    });

    await world.t.run(async (ctx) => {
      await ctx.db.patch("operatorTasks", taskId, {
        leaseExpiresAt: Date.now() - TASK_LEASE_MS,
      });
    });

    const takeover = value(
      await call(
        world,
        claimOperatorTask,
        {
          requestId: "req-claim-2",
          warehouseId: world.warehouses.alphaA,
          operatorTaskId: taskId,
        },
        { subject: second.clerkUserId, org_id: "org_fixture_a" },
      ),
    );
    expect(takeover["alreadyHeld"]).toBe(false);

    expect(takeover["retainedEvidenceCount"]).toBe(1);

    const evidence = value(
      await call(world, listOperatorTaskEvidence, {
        warehouseId: world.warehouses.alphaA,
        operatorTaskId: taskId,
      }),
    );
    const rows = evidence["items"] as Record<string, unknown>[];
    expect(rows.map((row) => row["kind"])).toEqual(["SCAN", "HANDOVER"]);
    expect(rows[1]!["previousHolderUserId"]).toBe(world.userA);
    expect(rows[1]!["note"]).toBe("LEASE_EXPIRED");
  });

  it("releases a task with a reason and keeps every scan", async () => {
    const world = await createConvexInventoryWorld();
    const taskId = await seedTask(world);

    await call(world, claimOperatorTask, {
      requestId: "req-claim",
      warehouseId: world.warehouses.alphaA,
      operatorTaskId: taskId,
    });
    await call(world, recordTaskEvidence, {
      requestId: "req-evidence-1",
      warehouseId: world.warehouses.alphaA,
      operatorTaskId: taskId,
      kind: "SCAN",
      scanValue: "WIDGET-001",
    });

    const released = value(
      await call(world, releaseOperatorTask, {
        requestId: "req-release",
        warehouseId: world.warehouses.alphaA,
        operatorTaskId: taskId,
        reason: "หมดกะ",
      }),
    );
    expect(released["retainedEvidenceCount"]).toBe(1);

    const stored = await world.t.run(
      async (ctx) => await ctx.db.get("operatorTasks", taskId),
    );
    expect(stored?.status).toBe("AVAILABLE");
    expect(stored?.claimedByUserId).toBeUndefined();

    expect(stored?.evidenceCount).toBe(2);
  });

  it("refuses a reassignment that would move nothing or elevate the supervisor", async () => {
    const world = await createConvexInventoryWorld();
    const supervisor = await seedSecondActorForOrgA(world, "WAREHOUSE_MANAGER");
    const taskId = await seedTask(world);

    await call(world, claimOperatorTask, {
      requestId: "req-claim",
      warehouseId: world.warehouses.alphaA,
      operatorTaskId: taskId,
    });

    const toHolder = await call(
      world,
      reassignOperatorTask,
      {
        requestId: "req-reassign",
        warehouseId: world.warehouses.alphaA,
        operatorTaskId: taskId,
        toUserId: world.userA,
        reason: "priority job",
      },
      { subject: supervisor.clerkUserId, org_id: "org_fixture_a" },
    );
    expect(errorCode(toHolder)).toBe("REASSIGN_TO_CURRENT_HOLDER");

    const toSupervisor = await call(
      world,
      reassignOperatorTask,
      {
        requestId: "req-reassign-2",
        warehouseId: world.warehouses.alphaA,
        operatorTaskId: taskId,
        toUserId: supervisor.userId,
        reason: "I will do it",
      },
      { subject: supervisor.clerkUserId, org_id: "org_fixture_a" },
    );
    expect(errorCode(toSupervisor)).toBe("REASSIGN_TO_SELF");
  });

  it("moves a task to a third operator and preserves the evidence", async () => {
    const world = await createConvexInventoryWorld();
    const supervisor = await seedSecondActorForOrgA(world, "WAREHOUSE_MANAGER");
    const recipient = await world.t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        clerkUserId: "user_fixture_a3",
        displayName: "Fixture A3",
        status: "ACTIVE",
      });
      await ctx.db.insert("memberships", {
        orgId: world.orgA,
        userId,
        clerkMembershipId: "orgmem_fixture_a3",
        status: "ACTIVE",
        scopeMode: "ORG_WIDE",
        effectiveFrom: 0,
      });
      return userId;
    });
    const taskId = await seedTask(world);

    await call(world, claimOperatorTask, {
      requestId: "req-claim",
      warehouseId: world.warehouses.alphaA,
      operatorTaskId: taskId,
    });
    await call(world, recordTaskEvidence, {
      requestId: "req-evidence-1",
      warehouseId: world.warehouses.alphaA,
      operatorTaskId: taskId,
      kind: "NOTE",
      note: "สแกนได้ 3 แถว",
    });

    const moved = value(
      await call(
        world,
        reassignOperatorTask,
        {
          requestId: "req-reassign",
          warehouseId: world.warehouses.alphaA,
          operatorTaskId: taskId,
          toUserId: recipient,
          reason: "priority job",
        },
        { subject: supervisor.clerkUserId, org_id: "org_fixture_a" },
      ),
    );
    expect(moved["retainedEvidenceCount"]).toBe(1);

    const stored = await world.t.run(
      async (ctx) => await ctx.db.get("operatorTasks", taskId),
    );
    expect(stored?.claimedByUserId).toBe(recipient);
    expect(stored?.status).toBe("CLAIMED");
  });

  it("reads My work through the holder index and the site board through the site index", async () => {
    const world = await createConvexInventoryWorld();
    const taskId = await seedTask(world);
    await seedTask(world, { requestId: "req-create-2", taskNumber: "WT-0002" });

    await call(world, claimOperatorTask, {
      requestId: "req-claim",
      warehouseId: world.warehouses.alphaA,
      operatorTaskId: taskId,
    });

    const mine = value(
      await call(world, listOperatorTasks, {
        warehouseId: world.warehouses.alphaA,
        scope: "MINE",
      }),
    );
    const mineRows = mine["items"] as Record<string, unknown>[];
    expect(mineRows).toHaveLength(1);
    expect(mineRows[0]!["taskNumber"]).toBe("WT-0001");

    expect((mineRows[0]!["lease"] as Record<string, unknown>)["kind"]).toBe(
      "HELD",
    );
    expect(mineRows[0]!["baseUom"]).toBe("PCS");

    const site = value(
      await call(world, listOperatorTasks, {
        warehouseId: world.warehouses.alphaA,
        scope: "SITE",
      }),
    );
    expect((site["items"] as unknown[]).length).toBe(2);
  });
});

describe("shared item scan evidence", () => {
  const claim = async (world: ConvexInventoryWorld, taskId: string) => {
    await call(world, claimOperatorTask, {
      requestId: "req-scan-claim",
      warehouseId: world.warehouses.alphaA,
      operatorTaskId: taskId,
    });
  };

  it("resolves and stores the active tenant item, normalized input, and manual reason", async () => {
    const world = await createConvexInventoryWorld();
    const taskId = await seedTask(world);
    await claim(world, taskId);

    const recorded = value(
      await call(world, recordTaskEvidence, {
        requestId: "req-scan-evidence",
        warehouseId: world.warehouses.alphaA,
        operatorTaskId: taskId,
        kind: "SCAN",
        scanValue: " widget-001 ",
        scanInputMethod: "MANUAL",
        manualEntryReason: "ฉลากอ่านไม่ออก",
      }),
    );

    expect(recorded).toMatchObject({
      replayed: false,
      resolvedItemId: world.a.item,
      resolvedSku: "WIDGET-001",
      scanVia: "SKU",
    });
    const stored = await world.t.run(async (ctx) => {
      const rows = await ctx.db.query("operatorTaskEvidence").collect();
      return rows[0];
    });
    expect(stored).toMatchObject({
      scanValue: "WIDGET-001",
      resolvedItemId: world.a.item,
      resolvedSku: "WIDGET-001",
      scanInputMethod: "MANUAL",
      manualEntryReason: "ฉลากอ่านไม่ออก",
    });
  });

  it("refuses an unknown item, the wrong task item, and manual entry without a reason", async () => {
    const world = await createConvexInventoryWorld();
    const taskId = await seedTask(world);
    await claim(world, taskId);

    expect(
      errorCode(
        await call(world, recordTaskEvidence, {
          requestId: "req-scan-unknown",
          warehouseId: world.warehouses.alphaA,
          operatorTaskId: taskId,
          kind: "SCAN",
          scanValue: "NOT-IN-CATALOGUE",
        }),
      ),
    ).toBe("UNKNOWN_SCAN");
    expect(
      errorCode(
        await call(world, recordTaskEvidence, {
          requestId: "req-scan-mismatch",
          warehouseId: world.warehouses.alphaA,
          operatorTaskId: taskId,
          kind: "SCAN",
          scanValue: "BULK-001",
        }),
      ),
    ).toBe("SCAN_ITEM_MISMATCH");
    expect(
      errorCode(
        await call(world, recordTaskEvidence, {
          requestId: "req-scan-manual",
          warehouseId: world.warehouses.alphaA,
          operatorTaskId: taskId,
          kind: "SCAN",
          scanValue: "WIDGET-001",
          scanInputMethod: "MANUAL",
        }),
      ),
    ).toBe("REQUIRED");
  });

  it("replays an acknowledged scan after the task lease later expires", async () => {
    const world = await createConvexInventoryWorld();
    const taskId = await seedTask(world);
    await claim(world, taskId);
    const args = {
      requestId: "req-scan-replay",
      warehouseId: world.warehouses.alphaA,
      operatorTaskId: taskId,
      kind: "SCAN" as const,
      scanValue: "WIDGET-001",
      scanInputMethod: "HID" as const,
    };
    const first = value(await call(world, recordTaskEvidence, args));
    await world.t.run(async (ctx) => {
      await ctx.db.patch("operatorTasks", taskId, {
        leaseExpiresAt: Date.now() - 1,
      });
    });

    const replay = value(await call(world, recordTaskEvidence, args));
    expect(replay).toMatchObject({
      documentId: first["documentId"],
      replayed: true,
      resolvedItemId: world.a.item,
    });
  });
});

describe("shared task exceptions", () => {
  const report = async (
    world: ConvexInventoryWorld,
    taskId: GenericId<"operatorTasks">,
    requestId = "req-exception-report",
  ) =>
    await call(world, reportTaskException, {
      requestId,
      warehouseId: world.warehouses.alphaA,
      operatorTaskId: taskId,
      reasonCodeId: world.a.adjustmentReason,
      summary: "ฉลากสินค้าเสียหาย",
      evidence: "สแกนสองครั้งแล้วเครื่องอ่านไม่ได้",
      proposedDisposition: "ESCALATE",
      proposedRecoveryAction: "ตรวจสอบฉลากกับหัวหน้ากะ",
    });

  const claimed = async (world: ConvexInventoryWorld) => {
    const taskId = await seedTask(world);
    await call(world, claimOperatorTask, {
      requestId: "req-exception-claim",
      warehouseId: world.warehouses.alphaA,
      operatorTaskId: taskId,
    });
    return taskId;
  };

  it("reports and lists the reason, evidence, proposal, and recovery action", async () => {
    const world = await createConvexInventoryWorld();
    const taskId = await claimed(world);
    const created = value(await report(world, taskId));
    expect(created["replayed"]).toBe(false);

    const listed = value(
      await call(world, listTaskExceptions, {
        warehouseId: world.warehouses.alphaA,
        operatorTaskId: taskId,
      }),
    );
    expect(listed["items"]).toEqual([
      expect.objectContaining({
        operatorTaskExceptionId: created["documentId"],
        reasonCode: "ADJ-01",
        summary: "ฉลากสินค้าเสียหาย",
        evidence: "สแกนสองครั้งแล้วเครื่องอ่านไม่ได้",
        proposedDisposition: "ESCALATE",
        proposedRecoveryAction: "ตรวจสอบฉลากกับหัวหน้ากะ",
        status: "OPEN",
        reportedByUserId: world.userA,
      }),
    ]);
  });

  it("requires a live held lease for a new report but replays one already written", async () => {
    const world = await createConvexInventoryWorld();
    const taskId = await claimed(world);
    const first = value(await report(world, taskId));
    await world.t.run(async (ctx) => {
      await ctx.db.patch("operatorTasks", taskId, {
        leaseExpiresAt: Date.now() - 1,
      });
    });

    const replay = value(await report(world, taskId));
    expect(replay).toMatchObject({
      documentId: first["documentId"],
      replayed: true,
    });
    expect(errorCode(await report(world, taskId, "req-exception-new"))).toBe(
      "TASK_LEASE_EXPIRED",
    );
  });

  it("enforces maker-checker resolution and preserves both proposal and final decision", async () => {
    const world = await createConvexInventoryWorld();
    const supervisor = await seedSecondActorForOrgA(world, "WAREHOUSE_MANAGER");
    const taskId = await claimed(world);
    const exceptionId = documentId(await report(world, taskId));
    const resolutionArgs = {
      requestId: "req-exception-resolve",
      warehouseId: world.warehouses.alphaA,
      operatorTaskExceptionId: exceptionId,
      finalDisposition: "RESUME" as const,
      recoveryAction: "พิมพ์ฉลากใหม่และสแกนอีกครั้ง",
      approverNote: "ตรวจสอบ SKU กับสินค้าแล้ว",
    };

    const ownDecision = await call(world, resolveTaskException, resolutionArgs);
    expect(ownDecision["ok"]).toBe(false);

    const approved = value(
      await call(world, resolveTaskException, resolutionArgs, {
        subject: supervisor.clerkUserId,
        org_id: "org_fixture_a",
      }),
    );
    expect(approved["replayed"]).toBe(false);

    const stored = await world.t.run(
      async (ctx) =>
        await ctx.db.get(
          "operatorTaskExceptions",
          exceptionId as GenericId<"operatorTaskExceptions">,
        ),
    );
    expect(stored).toMatchObject({
      proposedDisposition: "ESCALATE",
      finalDisposition: "RESUME",
      status: "RESOLVED",
      resolvedByUserId: supervisor.userId,
      recoveryAction: "พิมพ์ฉลากใหม่และสแกนอีกครั้ง",
    });

    const replay = value(
      await call(world, resolveTaskException, resolutionArgs, {
        subject: supervisor.clerkUserId,
        org_id: "org_fixture_a",
      }),
    );
    expect(replay["replayed"]).toBe(true);

    const otherSupervisor = await world.t.run(async (ctx) => {
      const clerkUserId = "user_fixture_a3";
      const userId = await ctx.db.insert("users", {
        clerkUserId,
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
      if (role === null) throw new Error("missing warehouse-manager role");
      await ctx.db.insert("membershipRoles", {
        orgId: world.orgA,
        membershipId,
        roleId: role._id,
        grantedAt: 0,
      });
      return { clerkUserId };
    });
    expect(
      errorCode(
        await call(world, resolveTaskException, resolutionArgs, {
          subject: otherSupervisor.clerkUserId,
          org_id: "org_fixture_a",
        }),
      ),
    ).toBe("REPLAY_UNRESOLVABLE");
  });

  it("does not accept another tenant's reason code", async () => {
    const world = await createConvexInventoryWorld();
    const taskId = await claimed(world);
    const refused = await call(world, reportTaskException, {
      requestId: "req-exception-foreign-reason",
      warehouseId: world.warehouses.alphaA,
      operatorTaskId: taskId,
      reasonCodeId: world.b.adjustmentReason,
      summary: "foreign reason",
      evidence: "must not cross tenant boundary",
      proposedDisposition: "STOP",
      proposedRecoveryAction: "wait",
    });
    expect(errorCode(refused)).toBe("REFERENCE_NOT_FOUND");
  });
});

describe("private task attachments", () => {
  it("binds verified bytes to a held task and redeems a one-use actor grant", async () => {
    const world = await createConvexInventoryWorld();
    const taskId = await seedTask(world);
    await call(world, claimOperatorTask, {
      requestId: "req-file-claim",
      warehouseId: world.warehouses.alphaA,
      operatorTaskId: taskId,
    });
    const authorization = value(
      await call(world, authorizeTaskFileUpload, {
        warehouseId: world.warehouses.alphaA,
        operatorTaskId: taskId,
      }),
    );
    const digest = "a".repeat(64);
    const complete = (uploaderClerkUserId: string) =>
      world.t.run(async (ctx) =>
        (
          completeUploadThingTaskUploadGrant as unknown as RuntimeFunction
        )._handler(ctx as GenericMutationCtx<DataModel>, {
          grantId: authorization["uploadGrantId"],
          providerKey: "task_private_photo_1",
          uploaderClerkUserId,
          contentDigest: digest,
          contentType: "image/jpeg",
          byteSize: 128,
        }),
      );
    expect(await complete("another_clerk_user")).toBe(false);
    expect(await complete(operator.subject)).toBe(true);

    const attachArgs = {
      requestId: "req-task-file-attach",
      warehouseId: world.warehouses.alphaA,
      operatorTaskId: taskId,
      uploadGrantId: authorization["uploadGrantId"] as string,
      fileName: "damage.jpg",
      kind: "PHOTO" as const,
      contentType: "image/jpeg",
      byteSize: 128,
      contentDigest: digest,
      uploadThingKey: "task_private_photo_1",
      note: "ฉลากเสียหายก่อนย้ายเข้ากักกัน",
    };
    const attachmentId = documentId(
      await call(world, attachTaskFile, attachArgs),
    );
    await world.t.run(async (ctx) => {
      await ctx.db.patch("operatorTasks", taskId, {
        leaseExpiresAt: Date.now() - 1,
      });
    });
    expect(
      value(await call(world, attachTaskFile, attachArgs))["replayed"],
    ).toBe(true);

    const listed = value(
      await call(world, listTaskFiles, {
        warehouseId: world.warehouses.alphaA,
        operatorTaskId: taskId,
      }),
    );
    expect(listed["items"]).toEqual([
      expect.objectContaining({
        operatorTaskAttachmentId: attachmentId,
        fileName: "damage.jpg",
        kind: "PHOTO",
        note: "ฉลากเสียหายก่อนย้ายเข้ากักกัน",
      }),
    ]);
    expect(JSON.stringify(listed)).not.toContain("task_private_photo_1");

    const access = value(
      await call(world, requestTaskFileAccess, {
        warehouseId: world.warehouses.alphaA,
        operatorTaskAttachmentId: attachmentId,
      }),
    );
    expect(access["granted"]).toBe(true);
    const grantId = new URL(
      `https://local.invalid${access["url"] as string}`,
    ).searchParams.get("grantId")!;
    const redeemed = value(
      await call(world, redeemUploadThingTaskFileAccessGrant, {
        warehouseId: world.warehouses.alphaA,
        grantId,
      }),
    );
    expect(redeemed).toEqual({
      providerKey: "task_private_photo_1",
      fileName: "damage.jpg",
    });
    expect(
      value(
        await call(world, redeemUploadThingTaskFileAccessGrant, {
          warehouseId: world.warehouses.alphaA,
          grantId,
        }),
      ),
    ).toBeNull();
  });
});

describe("shared quantity entry", () => {
  it("converts an entry unit to base minor units and records both", async () => {
    const world = await createConvexInventoryWorld();
    await world.t.run(async (ctx) => {
      await ctx.db.insert("itemUoms", {
        orgId: world.orgA,
        itemId: world.a.item,
        uom: "CASE",
        toBaseNumerator: 12,
        toBaseDenominator: 1,
        status: "ACTIVE",
      });
    });
    const taskId = await seedTask(world);
    await call(world, claimOperatorTask, {
      requestId: "req-claim",
      warehouseId: world.warehouses.alphaA,
      operatorTaskId: taskId,
    });

    const recorded = value(
      await call(world, recordTaskEvidence, {
        requestId: "req-evidence-1",
        warehouseId: world.warehouses.alphaA,
        operatorTaskId: taskId,
        kind: "QUANTITY",
        quantityText: "๓",
        entryUom: "CASE",
      }),
    );
    expect(recorded["baseMinorUnits"]).toBe(36_000);
    expect(recorded["plausibility"]).toBe("PLAUSIBLE");

    const evidence = value(
      await call(world, listOperatorTaskEvidence, {
        warehouseId: world.warehouses.alphaA,
        operatorTaskId: taskId,
      }),
    );
    const row = (evidence["items"] as Record<string, unknown>[])[0]!;
    expect(row["enteredQuantity"]).toEqual({ uom: "CASE", minorUnits: 3_000 });
    expect(row["baseMinorUnits"]).toBe(36_000);
  });

  it("refuses a malformed entry rather than guessing what it meant", async () => {
    const world = await createConvexInventoryWorld();
    const taskId = await seedTask(world);
    await call(world, claimOperatorTask, {
      requestId: "req-claim",
      warehouseId: world.warehouses.alphaA,
      operatorTaskId: taskId,
    });

    const outcome = await call(world, recordTaskEvidence, {
      requestId: "req-evidence-1",
      warehouseId: world.warehouses.alphaA,
      operatorTaskId: taskId,
      kind: "QUANTITY",
      quantityText: "1,5",
      entryUom: "PCS",
    });
    expect(errorCode(outcome)).toBe("MALFORMED_GROUPING");
  });

  it("replays an identical evidence request instead of appending twice", async () => {
    const world = await createConvexInventoryWorld();
    const taskId = await seedTask(world);
    await call(world, claimOperatorTask, {
      requestId: "req-claim",
      warehouseId: world.warehouses.alphaA,
      operatorTaskId: taskId,
    });

    const args = {
      requestId: "req-evidence-1",
      warehouseId: world.warehouses.alphaA,
      operatorTaskId: taskId,
      kind: "QUANTITY" as const,
      quantityText: "100",
      entryUom: "PCS",
    };
    const first = value(await call(world, recordTaskEvidence, args));
    const second = value(await call(world, recordTaskEvidence, args));

    expect(second["documentId"]).toBe(first["documentId"]);
    expect(second["replayed"]).toBe(true);

    const stored = await world.t.run(
      async (ctx) => await ctx.db.get("operatorTasks", taskId),
    );
    expect(stored?.evidenceCount).toBe(1);
  });

  it("refuses the same request id carrying different arguments", async () => {
    const world = await createConvexInventoryWorld();
    const taskId = await seedTask(world);
    await call(world, claimOperatorTask, {
      requestId: "req-claim",
      warehouseId: world.warehouses.alphaA,
      operatorTaskId: taskId,
    });

    await call(world, recordTaskEvidence, {
      requestId: "req-evidence-1",
      warehouseId: world.warehouses.alphaA,
      operatorTaskId: taskId,
      kind: "QUANTITY",
      quantityText: "100",
      entryUom: "PCS",
    });
    const conflicting = await call(world, recordTaskEvidence, {
      requestId: "req-evidence-1",
      warehouseId: world.warehouses.alphaA,
      operatorTaskId: taskId,
      kind: "QUANTITY",
      quantityText: "101",
      entryUom: "PCS",
    });
    expect(errorCode(conflicting)).toBe("REQUEST_ARGUMENT_CONFLICT");
  });

  it("refuses evidence from an operator who does not hold the task", async () => {
    const world = await createConvexInventoryWorld();
    const second = await seedSecondActorForOrgA(world, "WAREHOUSE_MANAGER");
    const taskId = await seedTask(world);
    await call(world, claimOperatorTask, {
      requestId: "req-claim",
      warehouseId: world.warehouses.alphaA,
      operatorTaskId: taskId,
    });

    const outcome = await call(
      world,
      recordTaskEvidence,
      {
        requestId: "req-evidence-1",
        warehouseId: world.warehouses.alphaA,
        operatorTaskId: taskId,
        kind: "SCAN",
        scanValue: "WIDGET-001",
      },
      { subject: second.clerkUserId, org_id: "org_fixture_a" },
    );
    expect(errorCode(outcome)).toBe("TASK_NOT_HELD_BY_ACTOR");
  });
});

describe("supervisor step-up on the operator device", () => {
  const approveArgs = (
    world: ConvexInventoryWorld,
    taskId: string,
    overrides: Record<string, unknown> = {},
  ) => ({
    requestId: "req-approve",
    warehouseId: world.warehouses.alphaA,
    operatorUserId: world.userA,
    operatorTaskId: taskId,
    installationId: "installation-a-0001",
    decision: "APPROVED",
    reason: "counted twice with me watching",
    ...overrides,
  });

  const freshSupervisor = async (
    world: ConvexInventoryWorld,
  ): Promise<ConvexSecondActor> => {
    const supervisor = await seedSecondActorForOrgA(world, "WAREHOUSE_MANAGER");
    const now = Date.now();
    await recordStepUp(world, {
      orgId: world.orgA,
      userId: supervisor.userId,
      occurredAt: now,
      reverifiedAt: now,
    });
    return supervisor;
  };

  const claimedTask = async (
    world: ConvexInventoryWorld,
  ): Promise<GenericId<"operatorTasks">> => {
    const taskId = await seedTask(world);
    await call(world, claimOperatorTask, {
      requestId: "req-claim",
      warehouseId: world.warehouses.alphaA,
      operatorTaskId: taskId,
    });
    return taskId;
  };

  it("replays one approval for a retried request instead of minting another credential", async () => {
    const world = await createConvexInventoryWorld();
    await seedDevice(world);
    const supervisor = await freshSupervisor(world);
    const taskId = await claimedTask(world);
    const args = approveArgs(world, taskId);
    const identity = {
      subject: supervisor.clerkUserId,
      org_id: "org_fixture_a",
    };

    const first = value(await call(world, approveOnDevice, args, identity));
    const replay = value(await call(world, approveOnDevice, args, identity));
    expect(replay).toMatchObject({
      documentId: first["documentId"],
      replayed: true,
      expiresAt: first["expiresAt"],
      decision: "APPROVED",
    });

    const approvals = await world.t.run(
      async (ctx) => await ctx.db.query("stepUpApprovals").collect(),
    );
    expect(approvals).toHaveLength(1);
  });

  it("refuses reuse of an approval request id with different arguments", async () => {
    const world = await createConvexInventoryWorld();
    await seedDevice(world);
    const supervisor = await freshSupervisor(world);
    const taskId = await claimedTask(world);
    const identity = {
      subject: supervisor.clerkUserId,
      org_id: "org_fixture_a",
    };
    await call(world, approveOnDevice, approveArgs(world, taskId), identity);

    const conflict = await call(
      world,
      approveOnDevice,
      approveArgs(world, taskId, { reason: "different decision evidence" }),
      identity,
    );
    expect(errorCode(conflict)).toBe("REQUEST_ARGUMENT_CONFLICT");

    const approvals = await world.t.run(
      async (ctx) => await ctx.db.query("stepUpApprovals").collect(),
    );
    expect(approvals).toHaveLength(1);
  });

  it("refuses an implausible quantity with no approval, then accepts it with one", async () => {
    const world = await createConvexInventoryWorld();
    await seedDevice(world);
    const supervisor = await freshSupervisor(world);
    const taskId = await claimedTask(world);

    const entryArgs = {
      requestId: "req-evidence-1",
      warehouseId: world.warehouses.alphaA,
      operatorTaskId: taskId,
      kind: "QUANTITY" as const,
      quantityText: "1000",
      entryUom: "PCS",
      installationId: "installation-a-0001",
    };

    const refused = await call(world, recordTaskEvidence, entryArgs);
    expect(errorCode(refused)).toBe("PLAUSIBILITY_APPROVAL_REQUIRED");

    const approval = value(
      await call(world, approveOnDevice, approveArgs(world, taskId), {
        subject: supervisor.clerkUserId,
        org_id: "org_fixture_a",
      }),
    );
    expect(approval["decision"]).toBe("APPROVED");

    const accepted = value(
      await call(world, recordTaskEvidence, {
        ...entryArgs,
        requestId: "req-evidence-2",
        stepUpApprovalId: approval["documentId"],
      }),
    );
    expect(accepted["plausibility"]).toBe("IMPLAUSIBLE");

    const evidence = value(
      await call(world, listOperatorTaskEvidence, {
        warehouseId: world.warehouses.alphaA,
        operatorTaskId: taskId,
      }),
    );
    expect(
      (evidence["items"] as Record<string, unknown>[])[0]![
        "supervisorApproved"
      ],
    ).toBe(true);
  });

  it("spends an approval exactly once", async () => {
    const world = await createConvexInventoryWorld();
    await seedDevice(world);
    const supervisor = await freshSupervisor(world);
    const taskId = await claimedTask(world);

    const approval = value(
      await call(world, approveOnDevice, approveArgs(world, taskId), {
        subject: supervisor.clerkUserId,
        org_id: "org_fixture_a",
      }),
    );

    const entryArgs = {
      warehouseId: world.warehouses.alphaA,
      operatorTaskId: taskId,
      kind: "QUANTITY" as const,
      entryUom: "PCS",
      installationId: "installation-a-0001",
      stepUpApprovalId: approval["documentId"],
    };
    await call(world, recordTaskEvidence, {
      ...entryArgs,
      requestId: "req-evidence-1",
      quantityText: "1000",
    });
    const reuse = await call(world, recordTaskEvidence, {
      ...entryArgs,
      requestId: "req-evidence-2",
      quantityText: "2000",
    });
    expect(errorCode(reuse)).toBe("APPROVAL_ALREADY_CONSUMED");
  });

  it("refuses an approval spent on a different device", async () => {
    const world = await createConvexInventoryWorld();
    await seedDevice(world, "installation-a-0001");
    await seedDevice(world, "installation-a-0002");
    const supervisor = await freshSupervisor(world);
    const taskId = await claimedTask(world);

    const approval = value(
      await call(world, approveOnDevice, approveArgs(world, taskId), {
        subject: supervisor.clerkUserId,
        org_id: "org_fixture_a",
      }),
    );

    const elsewhere = await call(world, recordTaskEvidence, {
      requestId: "req-evidence-1",
      warehouseId: world.warehouses.alphaA,
      operatorTaskId: taskId,
      kind: "QUANTITY",
      quantityText: "1000",
      entryUom: "PCS",
      installationId: "installation-a-0002",
      stepUpApprovalId: approval["documentId"],
    });
    expect(errorCode(elsewhere)).toBe("APPROVAL_DEVICE_MISMATCH");
  });

  it("denies a supervisor approving their own entry", async () => {
    const world = await createConvexInventoryWorld();
    await seedDevice(world);
    const supervisor = await freshSupervisor(world);
    const taskId = await claimedTask(world);

    const selfApproval = await call(
      world,
      approveOnDevice,
      approveArgs(world, taskId, { operatorUserId: supervisor.userId }),
      { subject: supervisor.clerkUserId, org_id: "org_fixture_a" },
    );

    expect(selfApproval["ok"]).toBe(false);
  });

  it("denies an approver whose reverification is stale", async () => {
    const world = await createConvexInventoryWorld();
    await seedDevice(world);
    const supervisor = await seedSecondActorForOrgA(world, "WAREHOUSE_MANAGER");
    await recordStepUp(world, {
      orgId: world.orgA,
      userId: supervisor.userId,
      occurredAt: Date.now() - 60 * 60 * 1000,
      reverifiedAt: Date.now() - 60 * 60 * 1000,
    });
    const taskId = await claimedTask(world);

    const stale = await call(
      world,
      approveOnDevice,
      approveArgs(world, taskId),
      { subject: supervisor.clerkUserId, org_id: "org_fixture_a" },
    );
    expect(stale["ok"]).toBe(false);
  });

  it("records a refusal as evidence rather than discarding it", async () => {
    const world = await createConvexInventoryWorld();
    await seedDevice(world);
    const supervisor = await freshSupervisor(world);
    const taskId = await claimedTask(world);

    const refusalDecision = value(
      await call(
        world,
        approveOnDevice,
        approveArgs(world, taskId, {
          decision: "REJECTED",
          reason: "recount first",
        }),
        { subject: supervisor.clerkUserId, org_id: "org_fixture_a" },
      ),
    );
    expect(refusalDecision["decision"]).toBe("REJECTED");

    const spent = await call(world, recordTaskEvidence, {
      requestId: "req-evidence-1",
      warehouseId: world.warehouses.alphaA,
      operatorTaskId: taskId,
      kind: "QUANTITY",
      quantityText: "1000",
      entryUom: "PCS",
      installationId: "installation-a-0001",
      stepUpApprovalId: refusalDecision["documentId"],
    });
    expect(errorCode(spent)).toBe("APPROVAL_REJECTED");
  });
});
