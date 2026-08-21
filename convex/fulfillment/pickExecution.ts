/** Pick, independent check, pack, stage, and inventory issue execution. */
import { v } from "convex/values";

import {
  CODE_FIELD,
  appendDomainAudit,
  createMasterDataRow,
  describeAuditValue,
  insertedFields,
  normalizeField,
  replayTenantWriteIfPresent,
  updateMasterDataRow,
} from "../lib/masterDataStore";
import {
  postLedgerTransaction,
  reverseLedgerTransaction,
  toPublicLedgerError,
} from "../lib/inventoryLedgerStore";
import {
  mutationWithOrg,
  queryWithOrg,
  type TenantPolicyContext,
} from "../lib/tenantFunctions";
import type { TenantOrgId } from "../lib/tenantDb";
import { pickEventKind, pickTaskStatus } from "../lib/validators";
import {
  refusal,
  writeContextOf,
  writeOutcomeValidator,
  written,
} from "../lib/writeEnvelope";
import {
  checkPickScan,
  checkPickedTask,
  makePickLine,
  packCheckedTask,
  recordPickException,
  recordPickedQuantity,
  stagePackedTask,
  startPickTask as startPickTaskState,
  submitPickedTask,
  type PickLineState,
} from "../model/fulfillment/pickingPolicy";
import {
  deriveFulfillmentLineStatus,
  moveFulfillmentQuantity,
  type FulfillmentQuantities,
} from "../model/fulfillment/reservationPolicy";
import { decodeBucketKey } from "../model/inventory/stockIdentity";
import type { LedgerTransactionDraft } from "../model/inventory/ledgerTransaction";

export const PICK_EXECUTION_OPERATIONS = Object.freeze({
  start: "fulfillment.pick.task.start",
  record: "fulfillment.pick.event.record",
  submit: "fulfillment.pick.task.submit",
  check: "fulfillment.pick.task.check",
  pack: "fulfillment.pick.task.pack",
  stage: "fulfillment.pick.task.stage",
  issue: "fulfillment.pick.issue",
  reverseIssue: "fulfillment.pick.issue.reverse",
});

const MAX_TASK_LINES = 50;

interface PickWaveRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly warehouseId: string;
  readonly status: string;
  readonly taskCount: number;
  readonly completedTaskCount: number;
}

interface PickTaskRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly pickWaveId: string;
  readonly taskNumber: number;
  readonly warehouseId: string;
  readonly fulfillmentOrderId: string;
  readonly fulfillmentLineId: string;
  readonly status:
    | "AVAILABLE"
    | "IN_PROGRESS"
    | "PICKED"
    | "CHECKED"
    | "PACKED"
    | "STAGED"
    | "ISSUED"
    | "CANCELLED";
  readonly lineCount: number;
  readonly eventCount: number;
  readonly pickerUserId?: string;
  readonly checkerUserId?: string;
  readonly packerUserId?: string;
  readonly stagingLocationId?: string;
}

interface PickTaskLineRow extends PickLineState {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly pickTaskId: string;
  readonly lineNumber: number;
  readonly inventoryReservationId: string;
  readonly warehouseId: string;
  readonly itemId: string;
  readonly locationId: string;
  readonly lotId?: string;
  readonly bucketKey: string;
  readonly baseUom: string;
  readonly status: "OPEN" | "COMPLETE";
}

interface ReservationRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly status: string;
  readonly baseMinorUnits: number;
  readonly consumedBaseMinorUnits: number;
  readonly releasedBaseMinorUnits: number;
}

interface FulfillmentLineRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly warehouseId: string;
  readonly orderedBaseMinorUnits: number;
  readonly status: string;
  readonly quantities: FulfillmentQuantities;
}

interface PackageRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly packageNumber: string;
  readonly pickTaskId: string;
  readonly fulfillmentOrderId: string;
  readonly warehouseId: string;
  readonly status: "PACKED" | "STAGED" | "ISSUED";
  readonly baseUom: string;
  readonly packedBaseMinorUnits: number;
  readonly stagingLocationId?: string;
  readonly issuedTransactionId?: string;
  readonly issueReversalTransactionId?: string;
}

interface InventoryTransactionRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly requestId: string;
  readonly operation: string;
}

const taskSummaryValidator = v.object({
  found: v.boolean(),
  pickTaskId: v.optional(v.id("pickTasks")),
  taskNumber: v.optional(v.number()),
  pickWaveId: v.optional(v.id("pickWaves")),
  fulfillmentOrderId: v.optional(v.id("fulfillmentOrders")),
  fulfillmentLineId: v.optional(v.id("fulfillmentLines")),
  warehouseId: v.optional(v.id("warehouses")),
  status: v.optional(pickTaskStatus),
  pickerUserId: v.optional(v.id("users")),
  checkerUserId: v.optional(v.id("users")),
  lineCount: v.optional(v.number()),
  eventCount: v.optional(v.number()),
  lines: v.optional(
    v.array(
      v.object({
        pickTaskLineId: v.id("pickTaskLines"),
        lineNumber: v.number(),
        itemId: v.id("items"),
        locationId: v.id("locations"),
        lotId: v.optional(v.id("lots")),
        baseUom: v.string(),
        plannedBaseMinorUnits: v.number(),
        pickedBaseMinorUnits: v.number(),
        shortBaseMinorUnits: v.number(),
        damagedBaseMinorUnits: v.number(),
        status: v.string(),
      }),
    ),
  ),
});

const pickQueueValidator = v.object({
  tasks: v.array(
    v.object({
      pickTaskId: v.id("pickTasks"),
      taskNumber: v.number(),
      pickWaveId: v.id("pickWaves"),
      fulfillmentOrderId: v.id("fulfillmentOrders"),
      fulfillmentLineId: v.id("fulfillmentLines"),
      warehouseId: v.id("warehouses"),
      status: pickTaskStatus,
      lineCount: v.number(),
    }),
  ),
});

async function loadTask(
  ctx: { readonly tenantDb: TenantPolicyContext["tenantDb"] },
  pickTaskId: string,
) {
  const task = await ctx.tenantDb.get<PickTaskRow>("pickTasks", pickTaskId);
  if (task === null) return null;
  const wave = await ctx.tenantDb.get<PickWaveRow>(
    "pickWaves",
    task.pickWaveId,
  );
  return wave === null || wave.warehouseId !== task.warehouseId
    ? null
    : { task, wave };
}

async function taskLines(
  ctx: { readonly tenantDb: TenantPolicyContext["tenantDb"] },
  task: PickTaskRow,
) {
  const page = await ctx.tenantDb
    .byIndex<PickTaskLineRow>(
      "pickTaskLines",
      "by_orgId_pickTaskId_lineNumber",
      [{ field: "pickTaskId", value: task._id }],
    )
    .page({ limit: MAX_TASK_LINES });
  return page.isDone && page.page.length === task.lineCount ? page.page : null;
}

export const startPickTask = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    pickTaskId: v.id("pickTasks"),
  },
  returns: writeOutcomeValidator,
  permissionCode: "fulfillment.pick.execute",
  target: { table: "pickTasks", id: ({ pickTaskId }) => pickTaskId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const bundle = await loadTask(ctx, args.pickTaskId);
    if (bundle === null || bundle.task.warehouseId !== args.warehouseId) {
      return refusal({ code: "NOT_FOUND", table: "pickTasks" });
    }
    const fingerprint = {
      operation: PICK_EXECUTION_OPERATIONS.start,
      requestId: args.requestId,
      warehouseId: args.warehouseId,
      pickTaskId: args.pickTaskId,
    };
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "pickTasks",
      operation: PICK_EXECUTION_OPERATIONS.start,
      requestId: args.requestId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);
    if (
      bundle.wave.status !== "RELEASED" &&
      bundle.wave.status !== "IN_PROGRESS"
    ) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "waveStatus",
        reason: "WAVE_NOT_RELEASED",
      });
    }
    const started = startPickTaskState(bundle.task.status);
    if (!started.ok) return refusal(started.error);
    const now = Date.now();
    const outcome = await updateMasterDataRow({
      ...writeContextOf(ctx, {
        table: "pickTasks",
        operation: PICK_EXECUTION_OPERATIONS.start,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      documentId: args.pickTaskId,
      fingerprint,
      uniqueness: [],
      patch: {
        status: started.value,
        pickerUserId: ctx.tenant.actor._id,
        startedAt: now,
      },
    });
    if (!outcome.ok) return refusal(outcome.error);
    if (bundle.wave.status === "RELEASED") {
      await ctx.tenantDb.patch("pickWaves", bundle.wave._id, {
        status: "IN_PROGRESS",
      });
    }
    return written(outcome.value);
  },
});

export const recordPickEvent = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    pickTaskId: v.id("pickTasks"),
    pickTaskLineId: v.id("pickTaskLines"),
    kind: pickEventKind,
    baseMinorUnits: v.number(),
    scannedLocationId: v.optional(v.id("locations")),
    scannedItemId: v.optional(v.id("items")),
    scannedLotId: v.optional(v.id("lots")),
    reason: v.optional(v.string()),
  },
  returns: writeOutcomeValidator,
  permissionCode: "fulfillment.pick.execute",
  target: { table: "pickTasks", id: ({ pickTaskId }) => pickTaskId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const bundle = await loadTask(ctx, args.pickTaskId);
    if (bundle === null || bundle.task.warehouseId !== args.warehouseId) {
      return refusal({ code: "NOT_FOUND", table: "pickTasks" });
    }
    const line = await ctx.tenantDb.get<PickTaskLineRow>(
      "pickTaskLines",
      args.pickTaskLineId,
    );
    if (line === null || line.pickTaskId !== args.pickTaskId) {
      return refusal({ code: "NOT_FOUND", table: "pickTaskLines" });
    }
    const fingerprint = {
      operation: PICK_EXECUTION_OPERATIONS.record,
      requestId: args.requestId,
      warehouseId: args.warehouseId,
      pickTaskId: args.pickTaskId,
      pickTaskLineId: args.pickTaskLineId,
      kind: args.kind,
      baseMinorUnits: args.baseMinorUnits,
      scannedLocationId: args.scannedLocationId,
      scannedItemId: args.scannedItemId,
      scannedLotId: args.scannedLotId,
      reason: args.reason,
    };
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "pickTaskLines",
      operation: PICK_EXECUTION_OPERATIONS.record,
      requestId: args.requestId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);
    if (
      bundle.task.status !== "IN_PROGRESS" ||
      bundle.task.pickerUserId !== ctx.tenant.actor._id
    ) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "status",
        reason: "TASK_NOT_OWNED_IN_PROGRESS",
      });
    }
    const initial = makePickLine(line.plannedBaseMinorUnits);
    if (!initial.ok) return refusal(initial.error);
    const current: PickLineState = {
      ...initial.value,
      pickedBaseMinorUnits: line.pickedBaseMinorUnits,
      shortBaseMinorUnits: line.shortBaseMinorUnits,
      damagedBaseMinorUnits: line.damagedBaseMinorUnits,
    };
    let next;
    if (args.kind === "PICK") {
      if (
        args.scannedLocationId === undefined ||
        args.scannedItemId === undefined
      ) {
        return refusal({
          code: "FIELD_INVALID",
          field: "scan",
          reason: "SCAN_REQUIRED",
        });
      }
      const scan = checkPickScan(
        {
          itemId: line.itemId,
          locationId: line.locationId,
          ...(line.lotId === undefined ? {} : { lotId: line.lotId }),
        },
        {
          itemId: args.scannedItemId,
          locationId: args.scannedLocationId,
          ...(args.scannedLotId === undefined
            ? {}
            : { lotId: args.scannedLotId }),
        },
      );
      if (!scan.ok) return refusal(scan.error);
      next = recordPickedQuantity(current, args.baseMinorUnits);
    } else {
      next = recordPickException(current, {
        kind: args.kind,
        baseMinorUnits: args.baseMinorUnits,
        reason: args.reason ?? "",
      });
    }
    if (!next.ok) return refusal(next.error);
    const accounted =
      next.value.pickedBaseMinorUnits +
      next.value.shortBaseMinorUnits +
      next.value.damagedBaseMinorUnits;
    const outcome = await updateMasterDataRow({
      ...writeContextOf(ctx, {
        table: "pickTaskLines",
        operation: PICK_EXECUTION_OPERATIONS.record,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      documentId: args.pickTaskLineId,
      fingerprint,
      uniqueness: [],
      patch: {
        pickedBaseMinorUnits: next.value.pickedBaseMinorUnits,
        shortBaseMinorUnits: next.value.shortBaseMinorUnits,
        damagedBaseMinorUnits: next.value.damagedBaseMinorUnits,
        status:
          accounted === next.value.plannedBaseMinorUnits ? "COMPLETE" : "OPEN",
      },
    });
    if (!outcome.ok) return refusal(outcome.error);
    const now = Date.now();
    const event = {
      pickTaskId: args.pickTaskId,
      pickTaskLineId: args.pickTaskLineId,
      sequence: bundle.task.eventCount + 1,
      kind: args.kind,
      baseUom: line.baseUom,
      baseMinorUnits: args.baseMinorUnits,
      ...(args.reason === undefined ? {} : { reason: args.reason.trim() }),
      actorUserId: ctx.tenant.actor._id,
      occurredAt: now,
    };
    const eventId = await ctx.tenantDb.insert("pickEvents", event);
    await ctx.tenantDb.patch("pickTasks", args.pickTaskId, {
      eventCount: event.sequence,
    });
    await appendDomainAudit(
      writeContextOf(ctx, {
        table: "pickTaskLines",
        operation: PICK_EXECUTION_OPERATIONS.record,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      {
        entityTable: "pickEvents",
        entityId: eventId,
        changes: insertedFields(event),
      },
    );
    return written(outcome.value);
  },
});

export const submitPickTask = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    pickTaskId: v.id("pickTasks"),
  },
  returns: writeOutcomeValidator,
  permissionCode: "fulfillment.pick.execute",
  target: { table: "pickTasks", id: ({ pickTaskId }) => pickTaskId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const bundle = await loadTask(ctx, args.pickTaskId);
    if (bundle === null || bundle.task.warehouseId !== args.warehouseId) {
      return refusal({ code: "NOT_FOUND", table: "pickTasks" });
    }
    const fingerprint = {
      operation: PICK_EXECUTION_OPERATIONS.submit,
      requestId: args.requestId,
      warehouseId: args.warehouseId,
      pickTaskId: args.pickTaskId,
    };
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "pickTasks",
      operation: PICK_EXECUTION_OPERATIONS.submit,
      requestId: args.requestId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);
    if (bundle.task.pickerUserId !== ctx.tenant.actor._id) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "pickerUserId",
        reason: "TASK_NOT_OWNED",
      });
    }
    const lines = await taskLines(ctx, bundle.task);
    if (lines === null)
      return refusal({ code: "STORED_ROW_INVALID", field: "lines" });
    const submitted = submitPickedTask(bundle.task.status, lines);
    if (!submitted.ok) return refusal(submitted.error);
    const fulfillmentLine = await ctx.tenantDb.get<FulfillmentLineRow>(
      "fulfillmentLines",
      bundle.task.fulfillmentLineId,
    );
    if (fulfillmentLine === null) {
      return refusal({ code: "STORED_ROW_INVALID", field: "fulfillmentLine" });
    }
    const picked = lines.reduce(
      (sum, line) => sum + line.pickedBaseMinorUnits,
      0,
    );
    const exception = lines.reduce(
      (sum, line) =>
        sum + line.shortBaseMinorUnits + line.damagedBaseMinorUnits,
      0,
    );
    let quantities = fulfillmentLine.quantities;
    if (picked > 0) {
      const moved = moveFulfillmentQuantity(quantities, {
        from: "PICKING",
        to: "STAGED",
        baseMinorUnits: picked,
      });
      if (!moved.ok) return refusal(moved.error);
      quantities = moved.value;
    }
    if (exception > 0) {
      const moved = moveFulfillmentQuantity(quantities, {
        from: "PICKING",
        to: "BACKORDERED",
        baseMinorUnits: exception,
      });
      if (!moved.ok) return refusal(moved.error);
      quantities = moved.value;
    }
    const lineStatus = deriveFulfillmentLineStatus(
      fulfillmentLine.orderedBaseMinorUnits,
      quantities,
    );
    if (!lineStatus.ok) return refusal(lineStatus.error);
    for (const line of lines) {
      const reservation = await ctx.tenantDb.get<ReservationRow>(
        "inventoryReservations",
        line.inventoryReservationId,
      );
      if (reservation === null || reservation.status !== "PICKING") {
        return refusal({ code: "STORED_ROW_INVALID", field: "reservation" });
      }
    }
    const now = Date.now();
    const outcome = await updateMasterDataRow({
      ...writeContextOf(ctx, {
        table: "pickTasks",
        operation: PICK_EXECUTION_OPERATIONS.submit,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      documentId: args.pickTaskId,
      fingerprint,
      uniqueness: [],
      patch: { status: submitted.value, pickedAt: now },
    });
    if (!outcome.ok) return refusal(outcome.error);
    await ctx.tenantDb.patch("fulfillmentLines", fulfillmentLine._id, {
      quantities: { ...quantities },
      status: lineStatus.value,
    });
    for (const line of lines) {
      const released = line.shortBaseMinorUnits + line.damagedBaseMinorUnits;
      await ctx.tenantDb.patch(
        "inventoryReservations",
        line.inventoryReservationId,
        {
          status: line.pickedBaseMinorUnits > 0 ? "PICKING" : "RELEASED",
          releasedBaseMinorUnits: released,
          ...(released === 0
            ? {}
            : { releasedAt: now, releaseReason: "PICK_EXCEPTION" }),
        },
      );
    }
    return written(outcome.value);
  },
});

async function checkerPolicy(
  ctx: TenantPolicyContext,
  args: { readonly pickTaskId: string },
) {
  const task = await ctx.tenantDb.get<PickTaskRow>(
    "pickTasks",
    args.pickTaskId,
  );
  return {
    thresholdExceeded: false,
    approvalSatisfied: task?.status === "PICKED",
    ...(task?.pickerUserId === undefined
      ? {}
      : { makerUserId: task.pickerUserId }),
  };
}

export const checkPickTask = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    pickTaskId: v.id("pickTasks"),
  },
  returns: writeOutcomeValidator,
  permissionCode: "fulfillment.pick.check",
  target: { table: "pickTasks", id: ({ pickTaskId }) => pickTaskId },
  warehouseId: ({ warehouseId }) => warehouseId,
  policy: checkerPolicy,
  handler: async (ctx, args) => {
    const bundle = await loadTask(ctx, args.pickTaskId);
    if (bundle === null || bundle.task.warehouseId !== args.warehouseId) {
      return refusal({ code: "NOT_FOUND", table: "pickTasks" });
    }
    const fingerprint = {
      operation: PICK_EXECUTION_OPERATIONS.check,
      requestId: args.requestId,
      warehouseId: args.warehouseId,
      pickTaskId: args.pickTaskId,
    };
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "pickTasks",
      operation: PICK_EXECUTION_OPERATIONS.check,
      requestId: args.requestId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);
    const checked = checkPickedTask({
      status: bundle.task.status,
      pickerUserId: bundle.task.pickerUserId ?? "",
      checkerUserId: ctx.tenant.actor._id,
    });
    if (!checked.ok) return refusal(checked.error);
    const outcome = await updateMasterDataRow({
      ...writeContextOf(ctx, {
        table: "pickTasks",
        operation: PICK_EXECUTION_OPERATIONS.check,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      documentId: args.pickTaskId,
      fingerprint,
      uniqueness: [],
      patch: {
        status: checked.value,
        checkerUserId: ctx.tenant.actor._id,
        checkedAt: Date.now(),
      },
    });
    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});

export const packPickTask = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    pickTaskId: v.id("pickTasks"),
    packageNumber: v.string(),
  },
  returns: writeOutcomeValidator,
  permissionCode: "fulfillment.pick.pack",
  target: { table: "pickTasks", id: ({ pickTaskId }) => pickTaskId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const bundle = await loadTask(ctx, args.pickTaskId);
    if (bundle === null || bundle.task.warehouseId !== args.warehouseId) {
      return refusal({ code: "NOT_FOUND", table: "pickTasks" });
    }
    const packageNumber = normalizeField(
      "packageNumber",
      args.packageNumber,
      CODE_FIELD,
    );
    if (!packageNumber.ok) return refusal(packageNumber.error);
    const fingerprint = {
      operation: PICK_EXECUTION_OPERATIONS.pack,
      requestId: args.requestId,
      warehouseId: args.warehouseId,
      pickTaskId: args.pickTaskId,
      packageNumber: packageNumber.value,
    };
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "fulfillmentPackages",
      operation: PICK_EXECUTION_OPERATIONS.pack,
      requestId: args.requestId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);
    const packed = packCheckedTask(bundle.task.status);
    if (!packed.ok) return refusal(packed.error);
    const lines = await taskLines(ctx, bundle.task);
    if (lines === null || lines.length === 0) {
      return refusal({ code: "STORED_ROW_INVALID", field: "lines" });
    }
    const uom = lines[0]!.baseUom;
    if (lines.some((line) => line.baseUom !== uom)) {
      return refusal({ code: "STORED_ROW_INVALID", field: "baseUom" });
    }
    const packedBaseMinorUnits = lines.reduce(
      (sum, line) => sum + line.pickedBaseMinorUnits,
      0,
    );
    if (packedBaseMinorUnits <= 0) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "pickedBaseMinorUnits",
        reason: "NOTHING_PICKED",
      });
    }
    const now = Date.now();
    const outcome = await createMasterDataRow({
      ...writeContextOf(ctx, {
        table: "fulfillmentPackages",
        operation: PICK_EXECUTION_OPERATIONS.pack,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      fingerprint,
      uniqueness: [
        {
          field: "packageNumber",
          index: "by_orgId_packageNumber",
          equality: [{ field: "packageNumber", value: packageNumber.value }],
        },
        {
          field: "pickTaskId",
          index: "by_orgId_pickTaskId",
          equality: [{ field: "pickTaskId", value: args.pickTaskId }],
        },
      ],
      document: {
        packageNumber: packageNumber.value,
        pickTaskId: args.pickTaskId,
        fulfillmentOrderId: bundle.task.fulfillmentOrderId,
        warehouseId: args.warehouseId,
        status: "PACKED",
        baseUom: uom,
        packedBaseMinorUnits,
        packedByUserId: ctx.tenant.actor._id,
        packedAt: now,
      },
    });
    if (!outcome.ok) return refusal(outcome.error);
    await ctx.tenantDb.patch("pickTasks", args.pickTaskId, {
      status: packed.value,
      packerUserId: ctx.tenant.actor._id,
      packedAt: now,
    });
    return written(outcome.value);
  },
});

export const stagePickTask = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    pickTaskId: v.id("pickTasks"),
    stagingLocationId: v.id("locations"),
  },
  returns: writeOutcomeValidator,
  permissionCode: "fulfillment.pick.stage",
  target: { table: "pickTasks", id: ({ pickTaskId }) => pickTaskId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const bundle = await loadTask(ctx, args.pickTaskId);
    if (bundle === null || bundle.task.warehouseId !== args.warehouseId) {
      return refusal({ code: "NOT_FOUND", table: "pickTasks" });
    }
    const fingerprint = {
      operation: PICK_EXECUTION_OPERATIONS.stage,
      requestId: args.requestId,
      warehouseId: args.warehouseId,
      pickTaskId: args.pickTaskId,
      stagingLocationId: args.stagingLocationId,
    };
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "pickTasks",
      operation: PICK_EXECUTION_OPERATIONS.stage,
      requestId: args.requestId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);
    const staged = stagePackedTask(bundle.task.status);
    if (!staged.ok) return refusal(staged.error);
    const location = await ctx.tenantDb.get<{
      readonly orgId: TenantOrgId;
      readonly warehouseId: string;
      readonly locationType: string;
      readonly status: string;
    }>("locations", args.stagingLocationId);
    if (
      location === null ||
      location.warehouseId !== args.warehouseId ||
      location.locationType !== "STAGING" ||
      location.status !== "ACTIVE"
    ) {
      return refusal({
        code: "REFERENCE_NOT_FOUND",
        field: "stagingLocationId",
      });
    }
    const packageRow = await ctx.tenantDb
      .byIndex<PackageRow>("fulfillmentPackages", "by_orgId_pickTaskId", [
        { field: "pickTaskId", value: args.pickTaskId },
      ])
      .unique();
    if (packageRow === null || packageRow.status !== "PACKED") {
      return refusal({ code: "STORED_ROW_INVALID", field: "package" });
    }
    const now = Date.now();
    const outcome = await updateMasterDataRow({
      ...writeContextOf(ctx, {
        table: "pickTasks",
        operation: PICK_EXECUTION_OPERATIONS.stage,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      documentId: args.pickTaskId,
      fingerprint,
      uniqueness: [],
      patch: {
        status: staged.value,
        stagingLocationId: args.stagingLocationId,
        stagedAt: now,
      },
    });
    if (!outcome.ok) return refusal(outcome.error);
    await ctx.tenantDb.patch("fulfillmentPackages", packageRow._id, {
      status: "STAGED",
      stagingLocationId: args.stagingLocationId,
      stagedAt: now,
    });
    return written(outcome.value);
  },
});

export const issuePickTask = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    pickTaskId: v.id("pickTasks"),
  },
  returns: writeOutcomeValidator,
  permissionCode: "fulfillment.pick.issue",
  target: { table: "pickTasks", id: ({ pickTaskId }) => pickTaskId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const bundle = await loadTask(ctx, args.pickTaskId);
    if (bundle === null || bundle.task.warehouseId !== args.warehouseId) {
      return refusal({ code: "NOT_FOUND", table: "pickTasks" });
    }
    if (bundle.task.status !== "STAGED" && bundle.task.status !== "ISSUED") {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "status",
        reason: "TASK_NOT_STAGED",
      });
    }
    const packageRow = await ctx.tenantDb
      .byIndex<PackageRow>("fulfillmentPackages", "by_orgId_pickTaskId", [
        { field: "pickTaskId", value: args.pickTaskId },
      ])
      .unique();
    if (packageRow === null) {
      return refusal({ code: "STORED_ROW_INVALID", field: "package" });
    }
    if (bundle.task.status === "ISSUED") {
      const transaction =
        packageRow.status === "ISSUED" &&
        packageRow.issuedTransactionId !== undefined
          ? await ctx.tenantDb.get<InventoryTransactionRow>(
              "inventoryTransactions",
              packageRow.issuedTransactionId,
            )
          : null;
      if (
        transaction !== null &&
        transaction.requestId === args.requestId &&
        transaction.operation === PICK_EXECUTION_OPERATIONS.issue
      ) {
        return written({ documentId: args.pickTaskId, replayed: true });
      }
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "status",
        reason: "TASK_ALREADY_ISSUED",
      });
    }
    if (packageRow.status !== "STAGED") {
      return refusal({ code: "STORED_ROW_INVALID", field: "package" });
    }
    const lines = await taskLines(ctx, bundle.task);
    if (lines === null)
      return refusal({ code: "STORED_ROW_INVALID", field: "lines" });
    const ledgerLines: LedgerTransactionDraft["lines"][number][] = [];
    for (const line of lines) {
      if (line.pickedBaseMinorUnits === 0) continue;
      const decoded = decodeBucketKey(line.bucketKey);
      if (!decoded.ok || decoded.value.location.kind !== "PHYSICAL") {
        return refusal({ code: "STORED_ROW_INVALID", field: "bucketKey" });
      }
      const physical = decoded.value;
      ledgerLines.push({
        bucket: physical,
        quantity: {
          uom: line.baseUom,
          minorUnits: -line.pickedBaseMinorUnits,
        },
      });
      ledgerLines.push({
        bucket: {
          ...physical,
          location: { kind: "VIRTUAL", boundary: "CUSTOMER_SHIPMENT" },
        },
        quantity: {
          uom: line.baseUom,
          minorUnits: line.pickedBaseMinorUnits,
        },
      });
    }
    if (ledgerLines.length === 0) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "pickedBaseMinorUnits",
        reason: "NOTHING_PICKED",
      });
    }
    const fulfillmentLine = await ctx.tenantDb.get<FulfillmentLineRow>(
      "fulfillmentLines",
      bundle.task.fulfillmentLineId,
    );
    if (fulfillmentLine === null) {
      return refusal({ code: "STORED_ROW_INVALID", field: "fulfillmentLine" });
    }
    const issuedBaseMinorUnits = lines.reduce(
      (sum, line) => sum + line.pickedBaseMinorUnits,
      0,
    );
    const moved = moveFulfillmentQuantity(fulfillmentLine.quantities, {
      from: "STAGED",
      to: "ISSUED",
      baseMinorUnits: issuedBaseMinorUnits,
    });
    if (!moved.ok) return refusal(moved.error);
    const lineStatus = deriveFulfillmentLineStatus(
      fulfillmentLine.orderedBaseMinorUnits,
      moved.value,
    );
    if (!lineStatus.ok) return refusal(lineStatus.error);
    const reservations: {
      readonly id: string;
      readonly pickedBaseMinorUnits: number;
    }[] = [];
    for (const line of lines) {
      if (line.pickedBaseMinorUnits === 0) continue;
      const reservation = await ctx.tenantDb.get<ReservationRow>(
        "inventoryReservations",
        line.inventoryReservationId,
      );
      if (
        reservation === null ||
        reservation.status !== "PICKING" ||
        line.pickedBaseMinorUnits >
          reservation.baseMinorUnits -
            reservation.consumedBaseMinorUnits -
            reservation.releasedBaseMinorUnits
      ) {
        return refusal({ code: "STORED_ROW_INVALID", field: "reservation" });
      }
      reservations.push({
        id: line.inventoryReservationId,
        pickedBaseMinorUnits: line.pickedBaseMinorUnits,
      });
    }
    const now = Date.now();
    const draft: LedgerTransactionDraft = {
      orgId: ctx.tenant.organization._id,
      warehouseId: args.warehouseId,
      type: "SHIPMENT",
      operation: PICK_EXECUTION_OPERATIONS.issue,
      requestId: args.requestId,
      actorUserId: ctx.tenant.actor._id,
      occurredAt: now,
      source: { type: "PICK_TASK", id: args.pickTaskId },
      lines: ledgerLines,
    };
    const posted = await postLedgerTransaction({
      tenantDb: ctx.tenantDb,
      tenant: ctx.tenant,
      permissionCode: ctx.permission.code,
      now,
      draft,
    });
    if (!posted.ok) return refusal(toPublicLedgerError(posted.error));
    await ctx.tenantDb.patch("fulfillmentLines", fulfillmentLine._id, {
      quantities: { ...moved.value },
      status: lineStatus.value,
    });
    for (const reservation of reservations) {
      await ctx.tenantDb.patch("inventoryReservations", reservation.id, {
        status: "CONSUMED",
        consumedBaseMinorUnits: reservation.pickedBaseMinorUnits,
      });
    }
    await ctx.tenantDb.patch("fulfillmentPackages", packageRow._id, {
      status: "ISSUED",
      issuedTransactionId: posted.value.result.transactionId,
      issueReversalTransactionId: undefined,
      issueReversedAt: undefined,
    });
    await ctx.tenantDb.patch("pickTasks", args.pickTaskId, {
      status: "ISSUED",
      issuedAt: now,
    });
    const completedTaskCount = bundle.wave.completedTaskCount + 1;
    await ctx.tenantDb.patch("pickWaves", bundle.wave._id, {
      completedTaskCount,
      ...(completedTaskCount === bundle.wave.taskCount
        ? { status: "COMPLETE", completedAt: now }
        : {}),
    });
    return written({
      documentId: args.pickTaskId,
      replayed: posted.value.replayed,
    });
  },
});

async function issueReversalPolicy(
  ctx: TenantPolicyContext,
  args: { readonly pickTaskId: string },
) {
  const task = await ctx.tenantDb.get<PickTaskRow>(
    "pickTasks",
    args.pickTaskId,
  );
  const packageRow =
    task === null
      ? null
      : await ctx.tenantDb
          .byIndex<PackageRow>("fulfillmentPackages", "by_orgId_pickTaskId", [
            { field: "pickTaskId", value: task._id },
          ])
          .unique();
  const original =
    packageRow?.issuedTransactionId === undefined
      ? null
      : await ctx.tenantDb.get<{
          readonly orgId: TenantOrgId;
          readonly actorUserId: string;
        }>("inventoryTransactions", packageRow.issuedTransactionId);
  return {
    thresholdExceeded: false,
    approvalSatisfied: original !== null,
    ...(original === null ? {} : { makerUserId: original.actorUserId }),
  };
}

/** Reverse an unshipped issue and restore its exact reservation/pick state. */
export const reverseIssuedPickTask = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    pickTaskId: v.id("pickTasks"),
    reasonCodeId: v.id("reasonCodes"),
    installationId: v.optional(v.string()),
  },
  returns: writeOutcomeValidator,
  permissionCode: "fulfillment.pick.reverse",
  target: { table: "pickTasks", id: ({ pickTaskId }) => pickTaskId },
  warehouseId: ({ warehouseId }) => warehouseId,
  installationId: ({ installationId }) => installationId,
  policy: issueReversalPolicy,
  handler: async (ctx, args) => {
    const bundle = await loadTask(ctx, args.pickTaskId);
    if (bundle === null || bundle.task.warehouseId !== args.warehouseId) {
      return refusal({ code: "NOT_FOUND", table: "pickTasks" });
    }
    const packageRow = await ctx.tenantDb
      .byIndex<PackageRow>("fulfillmentPackages", "by_orgId_pickTaskId", [
        { field: "pickTaskId", value: args.pickTaskId },
      ])
      .unique();
    if (packageRow === null || packageRow.issuedTransactionId === undefined) {
      return refusal({ code: "STORED_ROW_INVALID", field: "package" });
    }
    if (packageRow.issueReversalTransactionId !== undefined) {
      const reversal = await ctx.tenantDb.get<InventoryTransactionRow>(
        "inventoryTransactions",
        packageRow.issueReversalTransactionId,
      );
      if (
        reversal !== null &&
        reversal.requestId === args.requestId &&
        reversal.operation === PICK_EXECUTION_OPERATIONS.reverseIssue
      ) {
        return written({ documentId: args.pickTaskId, replayed: true });
      }
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "status",
        reason: "ISSUE_ALREADY_REVERSED",
      });
    }
    if (bundle.task.status !== "ISSUED" || packageRow.status !== "ISSUED") {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "status",
        reason: "TASK_NOT_ISSUED",
      });
    }
    const assigned = await ctx.tenantDb
      .byIndex<{ readonly _id: string; readonly orgId: TenantOrgId }>(
        "shipmentPackages",
        "by_orgId_fulfillmentPackageId",
        [{ field: "fulfillmentPackageId", value: packageRow._id }],
      )
      .unique();
    if (assigned !== null) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "shipment",
        reason: "PACKAGE_ALREADY_SHIPPED",
      });
    }
    const lines = await taskLines(ctx, bundle.task);
    if (lines === null) {
      return refusal({ code: "STORED_ROW_INVALID", field: "lines" });
    }
    const fulfillmentLine = await ctx.tenantDb.get<FulfillmentLineRow>(
      "fulfillmentLines",
      bundle.task.fulfillmentLineId,
    );
    if (fulfillmentLine === null) {
      return refusal({ code: "STORED_ROW_INVALID", field: "fulfillmentLine" });
    }
    const issuedBaseMinorUnits = lines.reduce(
      (sum, line) => sum + line.pickedBaseMinorUnits,
      0,
    );
    const moved = moveFulfillmentQuantity(fulfillmentLine.quantities, {
      from: "ISSUED",
      to: "STAGED",
      baseMinorUnits: issuedBaseMinorUnits,
    });
    if (!moved.ok) return refusal(moved.error);
    const status = deriveFulfillmentLineStatus(
      fulfillmentLine.orderedBaseMinorUnits,
      moved.value,
    );
    if (!status.ok) return refusal(status.error);
    const reservations: { readonly id: string }[] = [];
    for (const line of lines) {
      if (line.pickedBaseMinorUnits === 0) continue;
      const reservation = await ctx.tenantDb.get<ReservationRow>(
        "inventoryReservations",
        line.inventoryReservationId,
      );
      if (
        reservation === null ||
        reservation.status !== "CONSUMED" ||
        reservation.consumedBaseMinorUnits !== line.pickedBaseMinorUnits
      ) {
        return refusal({ code: "STORED_ROW_INVALID", field: "reservation" });
      }
      reservations.push({ id: line.inventoryReservationId });
    }
    if (bundle.wave.completedTaskCount <= 0) {
      return refusal({ code: "STORED_ROW_INVALID", field: "pickWave" });
    }
    const now = Date.now();
    const reversed = await reverseLedgerTransaction({
      tenantDb: ctx.tenantDb,
      tenant: ctx.tenant,
      permissionCode: ctx.permission.code,
      now,
      ...(args.installationId === undefined
        ? {}
        : { installationId: args.installationId }),
      warehouseId: args.warehouseId,
      originalTransactionId: packageRow.issuedTransactionId,
      requestId: args.requestId,
      operation: PICK_EXECUTION_OPERATIONS.reverseIssue,
      actorUserId: ctx.tenant.actor._id,
      reasonCodeId: args.reasonCodeId,
    });
    if (!reversed.ok) return refusal(toPublicLedgerError(reversed.error));
    await ctx.tenantDb.patch("fulfillmentLines", fulfillmentLine._id, {
      quantities: { ...moved.value },
      status: status.value,
    });
    for (const reservation of reservations) {
      await ctx.tenantDb.patch("inventoryReservations", reservation.id, {
        status: "PICKING",
        consumedBaseMinorUnits: 0,
      });
    }
    await ctx.tenantDb.patch("fulfillmentPackages", packageRow._id, {
      status: "STAGED",
      issueReversalTransactionId: reversed.value.result.transactionId,
      issueReversedAt: now,
    });
    await ctx.tenantDb.patch("pickTasks", bundle.task._id, {
      status: "STAGED",
    });
    await ctx.tenantDb.patch("pickWaves", bundle.wave._id, {
      status: "IN_PROGRESS",
      completedTaskCount: bundle.wave.completedTaskCount - 1,
    });
    const context = writeContextOf(ctx, {
      table: "pickTasks",
      operation: PICK_EXECUTION_OPERATIONS.reverseIssue,
      requestId: args.requestId,
      warehouseId: args.warehouseId,
    });
    await appendDomainAudit(context, {
      entityTable: "pickTasks",
      entityId: bundle.task._id,
      changes: [{ field: "status", from: "ISSUED", to: "STAGED" }],
    });
    await appendDomainAudit(context, {
      entityTable: "fulfillmentLines",
      entityId: fulfillmentLine._id,
      changes: [
        {
          field: "quantities",
          from: describeAuditValue(fulfillmentLine.quantities),
          to: describeAuditValue(moved.value),
        },
        { field: "status", from: fulfillmentLine.status, to: status.value },
      ],
    });
    return written({
      documentId: args.pickTaskId,
      replayed: reversed.value.replayed,
    });
  },
});

export const getPickTask = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    pickTaskId: v.id("pickTasks"),
  },
  returns: taskSummaryValidator,
  permissionCode: "fulfillment.pick.read",
  target: { table: "pickTasks", id: ({ pickTaskId }) => pickTaskId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const bundle = await loadTask(ctx, args.pickTaskId);
    if (bundle === null || bundle.task.warehouseId !== args.warehouseId) {
      return { found: false };
    }
    const lines = await taskLines(ctx, bundle.task);
    if (lines === null) return { found: false };
    return {
      found: true,
      pickTaskId: bundle.task._id as never,
      taskNumber: bundle.task.taskNumber,
      pickWaveId: bundle.task.pickWaveId as never,
      fulfillmentOrderId: bundle.task.fulfillmentOrderId as never,
      fulfillmentLineId: bundle.task.fulfillmentLineId as never,
      warehouseId: bundle.task.warehouseId as never,
      status: bundle.task.status,
      ...(bundle.task.pickerUserId === undefined
        ? {}
        : { pickerUserId: bundle.task.pickerUserId as never }),
      ...(bundle.task.checkerUserId === undefined
        ? {}
        : { checkerUserId: bundle.task.checkerUserId as never }),
      lineCount: bundle.task.lineCount,
      eventCount: bundle.task.eventCount,
      lines: lines.map((line) => ({
        pickTaskLineId: line._id as never,
        lineNumber: line.lineNumber,
        itemId: line.itemId as never,
        locationId: line.locationId as never,
        ...(line.lotId === undefined ? {} : { lotId: line.lotId as never }),
        baseUom: line.baseUom,
        plannedBaseMinorUnits: line.plannedBaseMinorUnits,
        pickedBaseMinorUnits: line.pickedBaseMinorUnits,
        shortBaseMinorUnits: line.shortBaseMinorUnits,
        damagedBaseMinorUnits: line.damagedBaseMinorUnits,
        status: line.status,
      })),
    };
  },
});

export const listAvailablePickTasks = queryWithOrg({
  args: { warehouseId: v.id("warehouses") },
  returns: pickQueueValidator,
  permissionCode: "fulfillment.pick.read",
  target: { table: "pickTasks" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const page = await ctx.tenantDb
      .byIndex<PickTaskRow>(
        "pickTasks",
        "by_orgId_warehouseId_status_taskNumber",
        [
          { field: "warehouseId", value: args.warehouseId },
          { field: "status", value: "AVAILABLE" },
        ],
      )
      .page({ limit: 50 });
    return {
      tasks: page.page.map((task) => ({
        pickTaskId: task._id as never,
        taskNumber: task.taskNumber,
        pickWaveId: task.pickWaveId as never,
        fulfillmentOrderId: task.fulfillmentOrderId as never,
        fulfillmentLineId: task.fulfillmentLineId as never,
        warehouseId: task.warehouseId as never,
        status: task.status,
        lineCount: task.lineCount,
      })),
    };
  },
});

export const listPickTasksByStatus = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    status: pickTaskStatus,
  },
  returns: pickQueueValidator,
  permissionCode: "fulfillment.pick.read",
  target: { table: "pickTasks" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const page = await ctx.tenantDb
      .byIndex<PickTaskRow>(
        "pickTasks",
        "by_orgId_warehouseId_status_taskNumber",
        [
          { field: "warehouseId", value: args.warehouseId },
          { field: "status", value: args.status },
        ],
      )
      .page({ limit: 50 });
    return {
      tasks: page.page.map((task) => ({
        pickTaskId: task._id as never,
        taskNumber: task.taskNumber,
        pickWaveId: task.pickWaveId as never,
        fulfillmentOrderId: task.fulfillmentOrderId as never,
        fulfillmentLineId: task.fulfillmentLineId as never,
        warehouseId: task.warehouseId as never,
        status: task.status,
        lineCount: task.lineCount,
      })),
    };
  },
});
