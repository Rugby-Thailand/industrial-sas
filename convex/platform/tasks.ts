import { v } from "convex/values";

import {
  checkIdempotency,
  fingerprintArguments,
  sha256Hex,
  writeIdempotencyRecord,
} from "../lib/idempotency";
import { normalizeItemScan, resolveItemScan } from "../lib/itemScanResolution";
import { pageResult } from "../lib/listEnvelope";
import type { TenantOrgId } from "../lib/tenantDb";
import { refusal, writeErrorValidator, written } from "../lib/writeEnvelope";
import {
  mutationWithOrg,
  queryWithOrg,
  type TenantFunctionContext,
  type TenantPolicyContext,
} from "../lib/tenantFunctions";
import {
  operatorTaskEvidenceKind,
  operatorTaskKind,
  operatorTaskStatus,
  quantityPlausibility,
  signedQuantity,
} from "../lib/validators";
import {
  MAX_JOB_PAGE_SIZE,
  makeJobPageRequest,
} from "../model/inventory/jobPage";
import { makeItemUomProfile, type UomConversion } from "../model/uom/itemUom";
import {
  captureQuantity,
  judgePlausibility,
} from "../model/platform/quantityEntry";
import {
  decideClaim,
  decideCompletion,
  decideHeartbeat,
  decideReassign,
  decideRelease,
  describeLease,
  normalizeTaskReason,
  type OperatorTaskState,
} from "../model/platform/taskAssignment";
import { decideStepUpConsumption } from "../model/platform/stepUp";

export const WORK_OPERATIONS = Object.freeze({
  create: "work.task.create",
  claim: "work.task.claim",
  heartbeat: "work.task.heartbeat",
  release: "work.task.release",
  reassign: "work.task.reassign",
  complete: "work.task.complete",
  evidence: "work.evidence.record",
});

export const IMPLAUSIBLE_QUANTITY_OPERATION =
  "work.evidence.implausibleQuantity";

const MAX_ITEM_UOMS = 20;

interface TaskDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly warehouseId: string;
  readonly taskNumber: string;
  readonly kind: string;
  readonly instruction: string;
  readonly status: string;
  readonly itemId?: string;
  readonly locationId?: string;
  readonly expectedBaseMinorUnits?: number;
  readonly dueAt?: number;
  readonly claimedByUserId?: string;
  readonly claimedAt?: number;
  readonly leaseExpiresAt?: number;
  readonly heartbeatAt?: number;
  readonly evidenceCount: number;
}

interface ItemDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly baseUom: string;
}

interface ItemUomDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly uom: string;
  readonly toBaseNumerator: number;
  readonly toBaseDenominator: number;
}

interface LocationDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly warehouseId: string;
}

interface MembershipDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly status: string;
}

interface DeviceDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly status: string;
}

interface EvidenceDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly operatorTaskId: string;
  readonly capturedByUserId: string;
  readonly sequence: number;
  readonly resolvedItemId?: string;
  readonly resolvedSku?: string;
  readonly scanVia?: string;
}

interface StepUpApprovalDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly operation: string;
  readonly targetRef: string;
  readonly operatorUserId: string;
  readonly approverUserId: string;
  readonly deviceId: string;
  readonly decision: string;
  readonly expiresAt: number;
  readonly consumedAt?: number;
}

const taskStateOf = (task: TaskDocument): OperatorTaskState => ({
  status: task.status as OperatorTaskState["status"],
  ...(task.claimedByUserId === undefined
    ? {}
    : { claimedByUserId: task.claimedByUserId }),
  ...(task.claimedAt === undefined ? {} : { claimedAt: task.claimedAt }),
  ...(task.leaseExpiresAt === undefined
    ? {}
    : { leaseExpiresAt: task.leaseExpiresAt }),
  ...(task.heartbeatAt === undefined ? {} : { heartbeatAt: task.heartbeatAt }),
  evidenceCount: task.evidenceCount,
});

async function loadTask(
  ctx: TenantFunctionContext,
  taskId: string,
  warehouseId: string,
): Promise<TaskDocument | null> {
  const task = await ctx.tenantDb.get<TaskDocument>("operatorTasks", taskId);
  if (task === null || task.warehouseId !== warehouseId) return null;
  return task;
}

async function appendEvidence(
  ctx: TenantFunctionContext,
  task: TaskDocument,
  row: {
    readonly kind: "QUANTITY" | "SCAN" | "NOTE" | "HANDOVER";
    readonly capturedAt: number;
    readonly deviceId?: string;
    readonly enteredQuantity?: {
      readonly uom: string;
      readonly minorUnits: number;
    };
    readonly baseMinorUnits?: number;
    readonly plausibility?: "PLAUSIBLE" | "UNCHECKED" | "IMPLAUSIBLE";
    readonly stepUpApprovalId?: string;
    readonly scanValue?: string;
    readonly resolvedItemId?: string;
    readonly resolvedSku?: string;
    readonly scanVia?: "BARCODE" | "SKU";
    readonly scanInputMethod?: "HID" | "MANUAL";
    readonly manualEntryReason?: string;
    readonly note?: string;
    readonly previousHolderUserId?: string;
  },
): Promise<{ readonly evidenceId: string; readonly sequence: number }> {
  const sequence = task.evidenceCount + 1;
  const evidenceId = await ctx.tenantDb.insert("operatorTaskEvidence", {
    operatorTaskId: task._id,
    sequence,
    kind: row.kind,
    capturedByUserId: ctx.tenant.actor._id,
    capturedAt: row.capturedAt,
    ...(row.deviceId === undefined ? {} : { deviceId: row.deviceId }),
    ...(row.enteredQuantity === undefined
      ? {}
      : { enteredQuantity: row.enteredQuantity }),
    ...(row.baseMinorUnits === undefined
      ? {}
      : { baseMinorUnits: row.baseMinorUnits }),
    ...(row.plausibility === undefined
      ? {}
      : { plausibility: row.plausibility }),
    ...(row.stepUpApprovalId === undefined
      ? {}
      : { stepUpApprovalId: row.stepUpApprovalId }),
    ...(row.scanValue === undefined ? {} : { scanValue: row.scanValue }),
    ...(row.resolvedItemId === undefined
      ? {}
      : { resolvedItemId: row.resolvedItemId }),
    ...(row.resolvedSku === undefined ? {} : { resolvedSku: row.resolvedSku }),
    ...(row.scanVia === undefined ? {} : { scanVia: row.scanVia }),
    ...(row.scanInputMethod === undefined
      ? {}
      : { scanInputMethod: row.scanInputMethod }),
    ...(row.manualEntryReason === undefined
      ? {}
      : { manualEntryReason: row.manualEntryReason }),
    ...(row.note === undefined ? {} : { note: row.note }),
    ...(row.previousHolderUserId === undefined
      ? {}
      : { previousHolderUserId: row.previousHolderUserId }),
  });
  await ctx.tenantDb.patch("operatorTasks", task._id, {
    evidenceCount: sequence,
  });
  return { evidenceId, sequence };
}

const leaseViewValidator = v.union(
  v.object({ kind: v.literal("UNCLAIMED") }),
  v.object({
    kind: v.literal("HELD"),
    holderUserId: v.id("users"),
    expiresAt: v.number(),
    remainingMs: v.number(),
  }),
  v.object({
    kind: v.literal("EXPIRED"),
    holderUserId: v.id("users"),
    expiredAt: v.number(),
  }),
  v.object({ kind: v.literal("CLOSED"), status: operatorTaskStatus }),
);

const taskRowValidator = v.object({
  operatorTaskId: v.id("operatorTasks"),
  warehouseId: v.id("warehouses"),
  taskNumber: v.string(),
  kind: operatorTaskKind,
  instruction: v.string(),
  status: operatorTaskStatus,
  itemId: v.optional(v.id("items")),

  baseUom: v.optional(v.string()),
  locationId: v.optional(v.id("locations")),
  expectedBaseMinorUnits: v.optional(v.number()),
  dueAt: v.optional(v.number()),
  evidenceCount: v.number(),

  lease: leaseViewValidator,
});

export const listOperatorTasks = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    scope: v.optional(v.union(v.literal("SITE"), v.literal("MINE"))),
    status: v.optional(operatorTaskStatus),
    maxPageSize: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      items: v.array(taskRowValidator),
      nextCursor: v.union(v.string(), v.null()),
      complete: v.boolean(),

      asOf: v.number(),
    }),
    v.object({ ok: v.literal(false), error: v.object({ code: v.string() }) }),
  ),
  permissionCode: "work.task.read",
  target: { table: "operatorTasks" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const request = makeJobPageRequest({
      ...(args.maxPageSize === undefined
        ? {}
        : { maxPageSize: args.maxPageSize }),
      ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
    });
    if (!request.ok) {
      return { ok: false as const, error: { code: request.error.code } };
    }

    const mine = args.scope === "MINE";
    const page = await ctx.tenantDb
      .byIndex<TaskDocument & Record<string, never>>(
        "operatorTasks",
        mine
          ? "by_orgId_claimedByUserId_status"
          : "by_orgId_warehouseId_status",
        [
          mine
            ? { field: "claimedByUserId", value: ctx.tenant.actor._id }
            : { field: "warehouseId", value: args.warehouseId },
          ...(args.status === undefined
            ? []
            : [{ field: "status", value: args.status }]),
        ],
      )
      .page({
        limit: request.value.maxPageSize,
        ...(request.value.cursor === null
          ? {}
          : { cursor: request.value.cursor }),
      });

    const now = Date.now();
    const baseUomByItemId = new Map<string, string | undefined>();
    for (const row of page.page) {
      const itemId = (row as unknown as Record<string, unknown>)["itemId"] as
        string | undefined;
      if (itemId === undefined || baseUomByItemId.has(itemId)) continue;
      const item = await ctx.tenantDb.get<ItemDocument>("items", itemId);
      baseUomByItemId.set(itemId, item?.baseUom);
    }

    return {
      ok: true as const,
      asOf: now,
      items: page.page
        // `MINE` reads a holder-first index, which is not warehouse-scoped, so
        // the site the permission was decided for is proved here.
        .filter(
          (row) =>
            (row as unknown as Record<string, unknown>)["warehouseId"] ===
            args.warehouseId,
        )
        .map((row) => {
          const record = row as unknown as Record<string, unknown>;
          const optional = (name: string) =>
            record[name] === undefined ? {} : { [name]: record[name] as never };
          const itemId = record["itemId"] as string | undefined;
          const baseUom =
            itemId === undefined ? undefined : baseUomByItemId.get(itemId);
          return {
            operatorTaskId: row._id as never,
            warehouseId: record["warehouseId"] as never,
            taskNumber: record["taskNumber"] as string,
            kind: record["kind"] as never,
            instruction: record["instruction"] as string,
            status: record["status"] as never,
            evidenceCount: record["evidenceCount"] as number,
            lease: describeLease(
              taskStateOf(row as unknown as TaskDocument),
              now,
            ) as never,
            ...(baseUom === undefined ? {} : { baseUom }),
            ...optional("itemId"),
            ...optional("locationId"),
            ...optional("expectedBaseMinorUnits"),
            ...optional("dueAt"),
          };
        }),
      nextCursor: page.isDone ? null : page.continueCursor,
      complete: page.isDone,
    };
  },
});

const evidenceRowValidator = v.object({
  evidenceId: v.id("operatorTaskEvidence"),
  operatorTaskId: v.id("operatorTasks"),
  sequence: v.number(),
  kind: operatorTaskEvidenceKind,
  capturedByUserId: v.id("users"),
  capturedAt: v.number(),
  enteredQuantity: v.optional(signedQuantity),
  baseMinorUnits: v.optional(v.number()),
  plausibility: v.optional(quantityPlausibility),
  scanValue: v.optional(v.string()),
  resolvedItemId: v.optional(v.id("items")),
  resolvedSku: v.optional(v.string()),
  scanVia: v.optional(v.union(v.literal("BARCODE"), v.literal("SKU"))),
  scanInputMethod: v.optional(v.union(v.literal("HID"), v.literal("MANUAL"))),
  manualEntryReason: v.optional(v.string()),
  note: v.optional(v.string()),
  previousHolderUserId: v.optional(v.id("users")),

  supervisorApproved: v.boolean(),
});

export const listOperatorTaskEvidence = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    operatorTaskId: v.id("operatorTasks"),
    maxPageSize: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      items: v.array(evidenceRowValidator),
      nextCursor: v.union(v.string(), v.null()),
      complete: v.boolean(),
    }),
    v.object({ ok: v.literal(false), error: v.object({ code: v.string() }) }),
  ),
  permissionCode: "work.task.read",
  target: {
    table: "operatorTasks",
    id: ({ operatorTaskId }) => operatorTaskId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const task = await loadTask(ctx, args.operatorTaskId, args.warehouseId);
    if (task === null) {
      return { ok: false as const, error: { code: "NOT_FOUND" } };
    }
    const request = makeJobPageRequest({
      ...(args.maxPageSize === undefined
        ? {}
        : { maxPageSize: args.maxPageSize }),
      ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
    });
    if (!request.ok) {
      return { ok: false as const, error: { code: request.error.code } };
    }

    const page = await ctx.tenantDb
      .byIndex<EvidenceDocument & Record<string, never>>(
        "operatorTaskEvidence",
        "by_orgId_operatorTaskId_sequence",
        [{ field: "operatorTaskId", value: args.operatorTaskId }],
      )
      .page({
        limit: request.value.maxPageSize,
        ...(request.value.cursor === null
          ? {}
          : { cursor: request.value.cursor }),
      });

    return pageResult(
      page.page.map((row) => {
        const record = row as unknown as Record<string, unknown>;
        const optional = (name: string) =>
          record[name] === undefined ? {} : { [name]: record[name] as never };
        return {
          evidenceId: row._id as never,
          operatorTaskId: record["operatorTaskId"] as never,
          sequence: record["sequence"] as number,
          kind: record["kind"] as never,
          capturedByUserId: record["capturedByUserId"] as never,
          capturedAt: record["capturedAt"] as number,
          supervisorApproved: record["stepUpApprovalId"] !== undefined,
          ...optional("enteredQuantity"),
          ...optional("baseMinorUnits"),
          ...optional("plausibility"),
          ...optional("scanValue"),
          ...optional("resolvedItemId"),
          ...optional("resolvedSku"),
          ...optional("scanVia"),
          ...optional("scanInputMethod"),
          ...optional("manualEntryReason"),
          ...optional("note"),
          ...optional("previousHolderUserId"),
        };
      }),
      page,
    );
  },
});

const taskOutcomeValidator = v.union(
  v.object({
    written: v.literal(true),
    documentId: v.string(),
    replayed: v.boolean(),
  }),
  v.object({ written: v.literal(false), error: writeErrorValidator }),
);

export const createOperatorTask = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    taskNumber: v.string(),
    kind: operatorTaskKind,
    instruction: v.string(),
    itemId: v.optional(v.id("items")),
    locationId: v.optional(v.id("locations")),
    expectedBaseMinorUnits: v.optional(v.number()),
    dueAt: v.optional(v.number()),
  },
  returns: taskOutcomeValidator,
  permissionCode: "work.task.manage",
  target: { table: "operatorTasks" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const taskNumber = args.taskNumber.trim().normalize("NFC");
    if (taskNumber.length === 0) {
      return refusal({ code: "REQUIRED", field: "taskNumber" });
    }
    const instruction = args.instruction.trim().normalize("NFC");
    if (instruction.length === 0) {
      return refusal({ code: "REQUIRED", field: "instruction" });
    }
    if (
      args.expectedBaseMinorUnits !== undefined &&
      (!Number.isSafeInteger(args.expectedBaseMinorUnits) ||
        args.expectedBaseMinorUnits <= 0)
    ) {
      return refusal({ code: "INVALID", field: "expectedBaseMinorUnits" });
    }

    const existing = await ctx.tenantDb
      .byIndex<TaskDocument & Record<string, never>>(
        "operatorTasks",
        "by_orgId_taskNumber",
        [{ field: "taskNumber", value: taskNumber }],
      )
      .first();
    if (existing !== null) {
      return refusal({
        code: "DUPLICATE_KEY",
        field: "taskNumber",
        table: "operatorTasks",
      });
    }

    if (args.itemId !== undefined) {
      const item = await ctx.tenantDb.get("items", args.itemId);
      if (item === null) {
        return refusal({ code: "REFERENCE_NOT_FOUND", field: "itemId" });
      }
    }
    if (args.locationId !== undefined) {
      const location = await ctx.tenantDb.get<LocationDocument>(
        "locations",
        args.locationId,
      );
      if (location === null || location.warehouseId !== args.warehouseId) {
        return refusal({ code: "REFERENCE_NOT_FOUND", field: "locationId" });
      }
    }

    const operatorTaskId = await ctx.tenantDb.insert("operatorTasks", {
      warehouseId: args.warehouseId,
      taskNumber,
      kind: args.kind,
      instruction,
      status: "AVAILABLE" as const,
      ...(args.itemId === undefined ? {} : { itemId: args.itemId }),
      ...(args.locationId === undefined ? {} : { locationId: args.locationId }),
      ...(args.expectedBaseMinorUnits === undefined
        ? {}
        : { expectedBaseMinorUnits: args.expectedBaseMinorUnits }),
      ...(args.dueAt === undefined ? {} : { dueAt: args.dueAt }),
      evidenceCount: 0,
      createdByUserId: ctx.tenant.actor._id,
    });

    return written({ documentId: operatorTaskId, replayed: false });
  },
});

const claimOutcomeValidator = v.union(
  v.object({
    written: v.literal(true),
    documentId: v.string(),
    replayed: v.boolean(),

    alreadyHeld: v.boolean(),
    leaseExpiresAt: v.number(),

    retainedEvidenceCount: v.number(),
  }),
  v.object({ written: v.literal(false), error: writeErrorValidator }),
);

export const claimOperatorTask = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    operatorTaskId: v.id("operatorTasks"),
  },
  returns: claimOutcomeValidator,
  permissionCode: "work.task.claim",
  target: {
    table: "operatorTasks",
    id: ({ operatorTaskId }) => operatorTaskId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const task = await loadTask(ctx, args.operatorTaskId, args.warehouseId);
    if (task === null) {
      return refusal({ code: "NOT_FOUND", table: "operatorTasks" });
    }

    const now = Date.now();
    const decision = decideClaim({
      task: taskStateOf(task),
      actorUserId: ctx.tenant.actor._id,
      now,
    });
    if (!decision.ok) {
      return refusal({ ...decision.error, table: "operatorTasks" });
    }

    await ctx.tenantDb.patch("operatorTasks", args.operatorTaskId, {
      status: "CLAIMED" as const,
      claimedByUserId: decision.value.claimedByUserId,
      claimedAt: decision.value.claimedAt,
      leaseExpiresAt: decision.value.leaseExpiresAt,
      heartbeatAt: decision.value.heartbeatAt,
    });

    if (decision.value.takenOverFromUserId !== undefined) {
      await appendEvidence(ctx, task, {
        kind: "HANDOVER",
        capturedAt: now,
        note: "LEASE_EXPIRED",
        previousHolderUserId: decision.value.takenOverFromUserId,
      });
    }

    return {
      written: true as const,
      documentId: args.operatorTaskId,
      replayed: decision.value.alreadyHeld,
      alreadyHeld: decision.value.alreadyHeld,
      leaseExpiresAt: decision.value.leaseExpiresAt,
      retainedEvidenceCount: task.evidenceCount,
    };
  },
});

const heartbeatOutcomeValidator = v.union(
  v.object({
    written: v.literal(true),
    documentId: v.string(),
    replayed: v.boolean(),
    leaseExpiresAt: v.number(),

    recovered: v.boolean(),
  }),
  v.object({ written: v.literal(false), error: writeErrorValidator }),
);

export const heartbeatOperatorTask = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    operatorTaskId: v.id("operatorTasks"),
    installationId: v.optional(v.string()),
  },
  returns: heartbeatOutcomeValidator,
  permissionCode: "work.task.claim",
  target: {
    table: "operatorTasks",
    id: ({ operatorTaskId }) => operatorTaskId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  installationId: ({ installationId }) => installationId,
  handler: async (ctx, args) => {
    const task = await loadTask(ctx, args.operatorTaskId, args.warehouseId);
    if (task === null) {
      return refusal({ code: "NOT_FOUND", table: "operatorTasks" });
    }

    const decision = decideHeartbeat({
      task: taskStateOf(task),
      actorUserId: ctx.tenant.actor._id,
      now: Date.now(),
    });
    if (!decision.ok) {
      return refusal({ ...decision.error, table: "operatorTasks" });
    }

    await ctx.tenantDb.patch("operatorTasks", args.operatorTaskId, {
      leaseExpiresAt: decision.value.leaseExpiresAt,
      heartbeatAt: decision.value.heartbeatAt,
    });

    return {
      written: true as const,
      documentId: args.operatorTaskId,
      replayed: false,
      leaseExpiresAt: decision.value.leaseExpiresAt,
      recovered: decision.value.recovered,
    };
  },
});

const releaseOutcomeValidator = v.union(
  v.object({
    written: v.literal(true),
    documentId: v.string(),
    replayed: v.boolean(),

    retainedEvidenceCount: v.number(),
  }),
  v.object({ written: v.literal(false), error: writeErrorValidator }),
);

export const releaseOperatorTask = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    operatorTaskId: v.id("operatorTasks"),
    reason: v.string(),
  },
  returns: releaseOutcomeValidator,
  permissionCode: "work.task.claim",
  target: {
    table: "operatorTasks",
    id: ({ operatorTaskId }) => operatorTaskId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const task = await loadTask(ctx, args.operatorTaskId, args.warehouseId);
    if (task === null) {
      return refusal({ code: "NOT_FOUND", table: "operatorTasks" });
    }

    const now = Date.now();
    const decision = decideRelease({
      task: taskStateOf(task),
      actorUserId: ctx.tenant.actor._id,
      reason: args.reason,
      now,
    });
    if (!decision.ok) {
      return refusal({ ...decision.error, table: "operatorTasks" });
    }

    await appendEvidence(ctx, task, {
      kind: "HANDOVER",
      capturedAt: now,
      note: decision.value.reason,
      previousHolderUserId: decision.value.previousHolderUserId,
    });
    await ctx.tenantDb.patch("operatorTasks", args.operatorTaskId, {
      status: decision.value.status,
      claimedByUserId: undefined,
      claimedAt: undefined,
      leaseExpiresAt: undefined,
      heartbeatAt: undefined,
    });

    return {
      written: true as const,
      documentId: args.operatorTaskId,
      replayed: false,
      retainedEvidenceCount: decision.value.retainedEvidenceCount,
    };
  },
});

export const reassignOperatorTask = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    operatorTaskId: v.id("operatorTasks"),
    toUserId: v.id("users"),
    reason: v.string(),
  },
  returns: releaseOutcomeValidator,
  permissionCode: "work.task.reassign",
  target: {
    table: "operatorTasks",
    id: ({ operatorTaskId }) => operatorTaskId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const task = await loadTask(ctx, args.operatorTaskId, args.warehouseId);
    if (task === null) {
      return refusal({ code: "NOT_FOUND", table: "operatorTasks" });
    }

    const membership = await ctx.tenantDb
      .byIndex<MembershipDocument & Record<string, never>>(
        "memberships",
        "by_orgId_userId",
        [{ field: "userId", value: args.toUserId }],
      )
      .first();
    if (membership === null || membership.status !== "ACTIVE") {
      return refusal({ code: "REFERENCE_NOT_FOUND", field: "toUserId" });
    }

    const now = Date.now();
    const decision = decideReassign({
      task: taskStateOf(task),
      actorUserId: ctx.tenant.actor._id,
      toUserId: args.toUserId,
      reason: args.reason,
      now,
    });
    if (!decision.ok) {
      return refusal({ ...decision.error, table: "operatorTasks" });
    }

    await appendEvidence(ctx, task, {
      kind: "HANDOVER",
      capturedAt: now,
      note: decision.value.reason,
      ...(decision.value.previousHolderUserId === undefined
        ? {}
        : { previousHolderUserId: decision.value.previousHolderUserId }),
    });
    await ctx.tenantDb.patch("operatorTasks", args.operatorTaskId, {
      status: decision.value.status,
      claimedByUserId: decision.value.claimedByUserId,
      claimedAt: decision.value.claimedAt,
      leaseExpiresAt: decision.value.leaseExpiresAt,
      heartbeatAt: decision.value.heartbeatAt,
    });

    return {
      written: true as const,
      documentId: args.operatorTaskId,
      replayed: false,
      retainedEvidenceCount: decision.value.retainedEvidenceCount,
    };
  },
});

export const completeOperatorTask = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    operatorTaskId: v.id("operatorTasks"),
  },
  returns: taskOutcomeValidator,
  permissionCode: "work.task.complete",
  target: {
    table: "operatorTasks",
    id: ({ operatorTaskId }) => operatorTaskId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const task = await loadTask(ctx, args.operatorTaskId, args.warehouseId);
    if (task === null) {
      return refusal({ code: "NOT_FOUND", table: "operatorTasks" });
    }

    const decision = decideCompletion({
      task: taskStateOf(task),
      actorUserId: ctx.tenant.actor._id,
      now: Date.now(),
    });
    if (!decision.ok) {
      return refusal({ ...decision.error, table: "operatorTasks" });
    }

    await ctx.tenantDb.patch("operatorTasks", args.operatorTaskId, {
      status: decision.value.status,
      completedByUserId: decision.value.completedByUserId,
      completedAt: decision.value.completedAt,
      leaseExpiresAt: undefined,
    });
    return written({ documentId: args.operatorTaskId, replayed: false });
  },
});

const evidenceOutcomeValidator = v.union(
  v.object({
    written: v.literal(true),
    documentId: v.string(),
    replayed: v.boolean(),
    sequence: v.number(),

    baseMinorUnits: v.optional(v.number()),
    plausibility: v.optional(quantityPlausibility),
    resolvedItemId: v.optional(v.id("items")),
    resolvedSku: v.optional(v.string()),
    scanVia: v.optional(v.union(v.literal("BARCODE"), v.literal("SKU"))),
  }),
  v.object({ written: v.literal(false), error: writeErrorValidator }),
);

async function itemProfile(
  ctx: TenantFunctionContext,
  item: ItemDocument,
): Promise<ReturnType<typeof makeItemUomProfile>> {
  const rows = await ctx.tenantDb
    .byIndex<ItemUomDocument & Record<string, never>>(
      "itemUoms",
      "by_orgId_itemId_status_uom",
      [
        { field: "itemId", value: item._id },
        { field: "status", value: "ACTIVE" },
      ],
    )
    .take(MAX_ITEM_UOMS);

  const alternates: UomConversion[] = rows.map((row) => ({
    uom: row.uom,
    toBase: {
      numerator: row.toBaseNumerator,
      denominator: row.toBaseDenominator,
    },
  }));
  return makeItemUomProfile({
    itemKey: item._id,
    baseUom: item.baseUom,
    alternates,
  });
}

export const recordTaskEvidence = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    operatorTaskId: v.id("operatorTasks"),
    kind: v.union(v.literal("QUANTITY"), v.literal("SCAN"), v.literal("NOTE")),

    quantityText: v.optional(v.string()),

    entryUom: v.optional(v.string()),
    scanValue: v.optional(v.string()),
    scanInputMethod: v.optional(v.union(v.literal("HID"), v.literal("MANUAL"))),
    manualEntryReason: v.optional(v.string()),
    note: v.optional(v.string()),
    installationId: v.optional(v.string()),

    stepUpApprovalId: v.optional(v.id("stepUpApprovals")),
  },
  returns: evidenceOutcomeValidator,
  permissionCode: "work.evidence.record",
  target: {
    table: "operatorTasks",
    id: ({ operatorTaskId }) => operatorTaskId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  installationId: ({ installationId }) => installationId,
  handler: async (ctx, args) => {
    const normalizedScan =
      args.kind === "SCAN" ? normalizeItemScan(args.scanValue ?? "") : null;
    const fingerprint = await fingerprintArguments({
      operatorTaskId: args.operatorTaskId,
      kind: args.kind,
      quantityText: args.quantityText ?? null,
      entryUom: args.entryUom ?? null,
      scanValue: normalizedScan,
      scanInputMethod: args.scanInputMethod ?? null,
      manualEntryReason:
        args.manualEntryReason?.trim().normalize("NFC") ?? null,
      note: args.note ?? null,
      installationId: args.installationId?.trim() ?? null,
      stepUpApprovalId: args.stepUpApprovalId ?? null,
    });
    if (!fingerprint.ok) {
      return refusal({ code: fingerprint.error.code, field: "requestId" });
    }
    const replay = await checkIdempotency({
      tenantDb: ctx.tenantDb,
      operation: WORK_OPERATIONS.evidence,
      requestId: args.requestId,
      requestHash: fingerprint.value,
    });
    if (!replay.ok) {
      return refusal({ code: replay.error.code, field: "requestId" });
    }
    if (replay.value.kind === "REPLAY") {
      const original = replay.value.record.resultRef;
      if (original === undefined) {
        return refusal({ code: "REPLAY_UNRESOLVABLE", field: "requestId" });
      }
      const row = await ctx.tenantDb.get<EvidenceDocument>(
        "operatorTaskEvidence",
        original,
      );
      if (
        row === null ||
        row.operatorTaskId !== args.operatorTaskId ||
        row.capturedByUserId !== ctx.tenant.actor._id
      ) {
        return refusal({ code: "REPLAY_UNRESOLVABLE", field: "requestId" });
      }
      return {
        written: true as const,
        documentId: original,
        replayed: true,
        sequence: row.sequence,
        ...(row.resolvedItemId === undefined
          ? {}
          : { resolvedItemId: row.resolvedItemId as never }),
        ...(row.resolvedSku === undefined
          ? {}
          : { resolvedSku: row.resolvedSku }),
        ...(row.scanVia === "BARCODE" || row.scanVia === "SKU"
          ? { scanVia: row.scanVia as "BARCODE" | "SKU" }
          : {}),
      };
    }

    const task = await loadTask(ctx, args.operatorTaskId, args.warehouseId);
    if (task === null) {
      return refusal({ code: "NOT_FOUND", table: "operatorTasks" });
    }

    if (task.status !== "CLAIMED") {
      return refusal({
        code: "TASK_NOT_CLAIMED",
        table: "operatorTasks",
        status: task.status,
      });
    }
    if (task.claimedByUserId !== ctx.tenant.actor._id) {
      return refusal({
        code: "TASK_NOT_HELD_BY_ACTOR",
        table: "operatorTasks",
      });
    }
    const now = Date.now();
    if (task.leaseExpiresAt === undefined || task.leaseExpiresAt <= now) {
      return refusal({ code: "TASK_LEASE_EXPIRED", table: "operatorTasks" });
    }

    let captured:
      | {
          readonly enteredQuantity: {
            readonly uom: string;
            readonly minorUnits: number;
          };
          readonly baseMinorUnits: number;
          readonly plausibility: "PLAUSIBLE" | "UNCHECKED" | "IMPLAUSIBLE";
        }
      | undefined;
    let approvalId: string | undefined;
    let resolvedScan:
      | {
          readonly normalizedScan: string;
          readonly itemId: string;
          readonly sku: string;
          readonly via: "BARCODE" | "SKU";
        }
      | undefined;

    if (args.kind === "QUANTITY") {
      if (args.quantityText === undefined || args.entryUom === undefined) {
        return refusal({ code: "REQUIRED", field: "quantityText" });
      }
      if (task.itemId === undefined) {
        return refusal({ code: "TASK_HAS_NO_ITEM", field: "operatorTaskId" });
      }
      const item = await ctx.tenantDb.get<ItemDocument>("items", task.itemId);
      if (item === null) {
        return refusal({ code: "REFERENCE_NOT_FOUND", field: "itemId" });
      }
      const profile = await itemProfile(ctx, item);
      if (!profile.ok) {
        return refusal({ code: profile.error.code, field: "entryUom" });
      }

      const entry = captureQuantity({
        text: args.quantityText,
        entryUom: args.entryUom,
        profile: profile.value,
      });
      if (!entry.ok) {
        return refusal({ code: entry.error.code, field: "quantityText" });
      }

      const verdict = judgePlausibility({
        enteredBaseMinorUnits: entry.value.base.minorUnits,
        ...(task.expectedBaseMinorUnits === undefined
          ? {}
          : { expectedBaseMinorUnits: task.expectedBaseMinorUnits }),
      });

      if (verdict.kind === "IMPLAUSIBLE") {
        const spent = await spendApproval(ctx, {
          approvalId: args.stepUpApprovalId,
          targetRef: args.operatorTaskId,
          installationId: args.installationId,
          requestId: args.requestId,
          now,
        });
        if (!spent.ok) {
          return refusal({
            code: spent.code,
            field: "stepUpApprovalId",
            reason: String(verdict.factor),
          });
        }
        approvalId = spent.approvalId;
      }

      captured = {
        enteredQuantity: {
          uom: entry.value.entered.uom,
          minorUnits: entry.value.entered.minorUnits,
        },
        baseMinorUnits: entry.value.base.minorUnits,
        plausibility: verdict.kind,
      };
    }

    if (args.kind === "SCAN") {
      if (normalizedScan === "") {
        return refusal({ code: "REQUIRED", field: "scanValue" });
      }
      const resolution = await resolveItemScan(ctx.tenantDb, normalizedScan!);
      if (!resolution.found) {
        return refusal({ code: resolution.reason, field: "scanValue" });
      }
      if (task.itemId !== undefined && resolution.itemId !== task.itemId) {
        return refusal({
          code: "SCAN_ITEM_MISMATCH",
          field: "scanValue",
          reason: resolution.sku,
        });
      }
      const inputMethod = args.scanInputMethod ?? "HID";
      if (
        inputMethod === "MANUAL" &&
        (args.manualEntryReason ?? "").trim().length === 0
      ) {
        return refusal({ code: "REQUIRED", field: "manualEntryReason" });
      }
      resolvedScan = {
        normalizedScan: resolution.normalizedScan,
        itemId: resolution.itemId,
        sku: resolution.sku,
        via: resolution.via,
      };
    }
    if (args.kind === "NOTE") {
      const note = normalizeTaskReason(args.note ?? "");
      if (!note.ok) return refusal({ ...note.error, field: "note" });
    }

    const appended = await appendEvidence(ctx, task, {
      kind: args.kind,
      capturedAt: now,
      ...(captured === undefined
        ? {}
        : {
            enteredQuantity: captured.enteredQuantity,
            baseMinorUnits: captured.baseMinorUnits,
            plausibility: captured.plausibility,
          }),
      ...(approvalId === undefined ? {} : { stepUpApprovalId: approvalId }),
      ...(resolvedScan === undefined
        ? {}
        : {
            scanValue: resolvedScan.normalizedScan,
            resolvedItemId: resolvedScan.itemId,
            resolvedSku: resolvedScan.sku,
            scanVia: resolvedScan.via,
            scanInputMethod: args.scanInputMethod ?? "HID",
            ...(args.scanInputMethod === "MANUAL"
              ? {
                  manualEntryReason: args
                    .manualEntryReason!.trim()
                    .normalize("NFC"),
                }
              : {}),
          }),
      ...(args.note === undefined
        ? {}
        : { note: args.note.trim().normalize("NFC") }),
    });

    await writeIdempotencyRecord({
      tenantDb: ctx.tenantDb,
      operation: WORK_OPERATIONS.evidence,
      requestId: args.requestId,
      requestHash: fingerprint.value,
      resultRef: appended.evidenceId,
      resultHash: await sha256Hex(
        `${appended.evidenceId}:${appended.sequence}`,
      ),
      actorUserId: ctx.tenant.actor._id,
      now,
    });

    return {
      written: true as const,
      documentId: appended.evidenceId,
      replayed: false,
      sequence: appended.sequence,
      ...(captured === undefined
        ? {}
        : {
            baseMinorUnits: captured.baseMinorUnits,
            plausibility: captured.plausibility,
          }),
      ...(resolvedScan === undefined
        ? {}
        : {
            resolvedItemId: resolvedScan.itemId as never,
            resolvedSku: resolvedScan.sku,
            scanVia: resolvedScan.via,
          }),
    };
  },
});

async function spendApproval(
  ctx: TenantFunctionContext,
  input: {
    readonly approvalId: string | undefined;
    readonly targetRef: string;
    readonly installationId: string | undefined;
    readonly requestId: string;
    readonly now: number;
  },
): Promise<
  | { readonly ok: true; readonly approvalId: string }
  | {
      readonly ok: false;
      readonly code: string;
    }
> {
  if (input.approvalId === undefined) {
    return { ok: false, code: "PLAUSIBILITY_APPROVAL_REQUIRED" };
  }
  const device =
    input.installationId === undefined
      ? null
      : await ctx.tenantDb
          .byIndex<DeviceDocument & Record<string, never>>(
            "devices",
            "by_orgId_installationId",
            [{ field: "installationId", value: input.installationId.trim() }],
          )
          .first();
  if (device === null) {
    return { ok: false, code: "APPROVAL_DEVICE_MISMATCH" };
  }

  const stored = await ctx.tenantDb.get<StepUpApprovalDocument>(
    "stepUpApprovals",
    input.approvalId,
  );
  const decision = decideStepUpConsumption({
    approval:
      stored === null
        ? null
        : {
            approvalId: stored._id,
            operation: stored.operation,
            targetRef: stored.targetRef,
            operatorUserId: stored.operatorUserId,
            approverUserId: stored.approverUserId,
            deviceId: stored.deviceId,
            decision: stored.decision as "APPROVED" | "REJECTED",
            expiresAt: stored.expiresAt,
            ...(stored.consumedAt === undefined
              ? {}
              : { consumedAt: stored.consumedAt }),
          },
    operation: IMPLAUSIBLE_QUANTITY_OPERATION,
    targetRef: input.targetRef,
    operatorUserId: ctx.tenant.actor._id,
    deviceId: device._id,
    now: input.now,
  });
  if (!decision.ok) return { ok: false, code: decision.error.code };

  await ctx.tenantDb.patch("stepUpApprovals", decision.value.approvalId, {
    consumedAt: decision.value.consumedAt,
    consumedRequestId: input.requestId,
  });
  return { ok: true, approvalId: decision.value.approvalId };
}

export async function stepUpApprovalPolicy(
  _ctx: TenantPolicyContext,
  args: { readonly operatorUserId: string },
): Promise<{
  readonly approvalSatisfied: boolean;
  readonly makerUserId?: string;
}> {
  if (typeof args.operatorUserId !== "string" || args.operatorUserId === "") {
    return Object.freeze({ approvalSatisfied: false });
  }
  return Object.freeze({
    approvalSatisfied: true,
    makerUserId: args.operatorUserId,
  });
}

export const maxOperatorTaskPageSize = MAX_JOB_PAGE_SIZE;
