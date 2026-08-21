/**
 * Shared operator work: the board, the lease, and the evidence stream
 * (`FF-P1-09`, `FF-P1-10`, plan §4 invariants 18 and 20).
 *
 * The state machine is `convex/model/platform/taskAssignment.ts` and the
 * quantity rules are `convex/model/platform/quantityEntry.ts`. What this module
 * owns is what only a transaction can:
 *
 * 1. **Resolving the race.** Two handhelds claim at once; the row is re-read
 *    inside the transaction, so the loser is told they lost.
 * 2. **Preserving partial evidence.** Every change of hands — release, takeover
 *    of a lapsed lease, supervisor reassignment — appends a `HANDOVER` row to
 *    the same stream as the work itself. Nothing is deleted, so an operator who
 *    inherits a task inherits what was already done and can see who did it.
 * 3. **Converting a quantity exactly**, server-side, from the operator's entry
 *    unit to the item's base minor units, and judging it against what the task
 *    expected.
 * 4. **Spending a supervisor approval**, once, inside the same transaction as
 *    the evidence it authorizes.
 *
 * ### Why evidence is a separate table and not a JSON column
 *
 * `putawayTasks.recommendationTrace` is a JSON string because it is written
 * once and read whole. Evidence is neither: it grows one row at a time across
 * a shift, it is appended by different people after a handover, and it is
 * ordered. A column would make every append a read-modify-write of a growing
 * document — the lost-update shape this schema avoids everywhere else.
 */
import { v } from "convex/values";

import {
  checkIdempotency,
  fingerprintArguments,
  sha256Hex,
  writeIdempotencyRecord,
} from "../lib/idempotency";
import { normalizeItemScan, resolveItemScan } from "../lib/itemScanResolution";
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

/** The operation an implausible quantity needs a supervisor to approve. */
export const IMPLAUSIBLE_QUANTITY_OPERATION =
  "work.evidence.implausibleQuantity";

/** How many alternate units one item may declare before the profile is trimmed. */
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

/**
 * Load a task and prove it belongs to the named site.
 *
 * The accessor proves the tenant, not the warehouse, so a task at another site
 * has to be refused here — exactly as `putaway/tasks.ts` does, and for the same
 * reason: a claim writes a patch, and no ledger posting downstream would catch
 * the site mismatch (`INV-0006-04`).
 */
async function loadTask(
  ctx: TenantFunctionContext,
  taskId: string,
  warehouseId: string,
): Promise<TaskDocument | null> {
  const task = await ctx.tenantDb.get<TaskDocument>("operatorTasks", taskId);
  if (task === null || task.warehouseId !== warehouseId) return null;
  return task;
}

/**
 * Append one evidence row and move the task's stored counter with it.
 *
 * The sequence comes from the counter rather than from a count of rows,
 * because the counter is read inside this transaction and a count would be an
 * unbounded read on the write path.
 */
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

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

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
  /** The base unit the expectation is counted in; absent when no item is named. */
  baseUom: v.optional(v.string()),
  locationId: v.optional(v.id("locations")),
  expectedBaseMinorUnits: v.optional(v.number()),
  dueAt: v.optional(v.number()),
  evidenceCount: v.number(),
  /**
   * The lease as it reads *now*, computed against the server clock.
   *
   * Sent rather than the three raw fields, so a screen cannot decide for itself
   * whether a lease has lapsed using a device clock that may be minutes out.
   */
  lease: leaseViewValidator,
});

/**
 * The site board, or one operator's own work.
 *
 * `scope: "MINE"` reads the holder-first index rather than filtering a site
 * page, because a filtered page is drawn before the filter runs: an operator
 * holding two tasks at a busy site would see an empty screen and read it as
 * "you have nothing to do" (`INV-0002-04`).
 */
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
      /** The server clock the leases above were judged against. */
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
  /** True when a supervisor approval was spent on this row (`FF-P1-11`). */
  supervisorApproved: v.boolean(),
});

/** One task's evidence, oldest first: what an operator inherits after a handover. */
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

    return {
      ok: true as const,
      items: page.page.map((row) => {
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
      nextCursor: page.isDone ? null : page.continueCursor,
      complete: page.isDone,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

const taskOutcomeValidator = v.union(
  v.object({
    written: v.literal(true),
    documentId: v.string(),
    replayed: v.boolean(),
  }),
  v.object({ written: v.literal(false), error: writeErrorValidator }),
);

/** Plan a unit of work and put it on the site board. */
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
    /** True when this actor already held the task and simply renewed it. */
    alreadyHeld: v.boolean(),
    leaseExpiresAt: v.number(),
    /** How much partial evidence came with the task. */
    retainedEvidenceCount: v.number(),
  }),
  v.object({ written: v.literal(false), error: writeErrorValidator }),
);

/**
 * Claim a task and start its lease.
 *
 * Taking over a lapsed lease writes a `HANDOVER` row naming the operator it was
 * taken from, in the same transaction. Without it, a task would silently change
 * hands and the evidence above the handover would read as this operator's work.
 */
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
    /** True when the lease had lapsed and this renewal recovered it. */
    recovered: v.boolean(),
  }),
  v.object({ written: v.literal(false), error: writeErrorValidator }),
);

/**
 * Renew a lease.
 *
 * Classified `BLOCKED_OFFLINE`: a heartbeat replayed from a queue would assert
 * a liveness the operator did not have while they were out of range, which is
 * the opposite of what a lease is for.
 */
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
    /** Evidence rows the task kept. A release never discards partial work. */
    retainedEvidenceCount: v.number(),
  }),
  v.object({ written: v.literal(false), error: writeErrorValidator }),
);

/** Hand a task back to the queue, with a reason and with its evidence intact. */
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

/**
 * Move a task to another operator.
 *
 * The only path that may take a *live* lease, which is why it carries its own
 * permission. The previous holder's partial evidence stays exactly where it
 * was, and the handover row records who lost the task, who gained it, and why.
 */
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

    /*
     * The recipient must be a member of *this* tenant, proved through the
     * tenant's own membership index rather than by the ID looking plausible.
     * `users` is a global table, so a valid-looking user ID from another
     * tenant would otherwise resolve.
     */
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

/** Finish a task the actor holds under a live lease. */
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

/* -------------------------------------------------------------------------- */
/* Evidence                                                                    */
/* -------------------------------------------------------------------------- */

const evidenceOutcomeValidator = v.union(
  v.object({
    written: v.literal(true),
    documentId: v.string(),
    replayed: v.boolean(),
    sequence: v.number(),
    /** The converted amount, in the item's base minor units. */
    baseMinorUnits: v.optional(v.number()),
    plausibility: v.optional(quantityPlausibility),
    resolvedItemId: v.optional(v.id("items")),
    resolvedSku: v.optional(v.string()),
    scanVia: v.optional(v.union(v.literal("BARCODE"), v.literal("SKU"))),
  }),
  v.object({ written: v.literal(false), error: writeErrorValidator }),
);

/**
 * Build the item's conversion profile from its own rows.
 *
 * Bounded: an item declares a handful of packaging units, and the read is
 * capped so a misconfigured tenant costs a worse profile rather than an
 * unbounded read on a handheld's critical path.
 */
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

/**
 * Append one piece of evidence to a task the actor holds.
 *
 * Idempotent through the shared helper: the same `requestId` with the same
 * arguments replays the evidence row it already wrote rather than appending a
 * second one, which is what makes a retry after a stalled network safe
 * (`INV-0003-01`).
 *
 * A quantity beyond the task's plausibility ceiling is **refused unless a
 * supervisor approval is spent on it**. The approval is consumed in this
 * transaction, so it cannot authorize a second entry, and the evidence row
 * records which approval let it through.
 */
export const recordTaskEvidence = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    operatorTaskId: v.id("operatorTasks"),
    kind: v.union(v.literal("QUANTITY"), v.literal("SCAN"), v.literal("NOTE")),
    /** What the operator typed, exactly, before any repair. */
    quantityText: v.optional(v.string()),
    /** The unit they say they counted in. */
    entryUom: v.optional(v.string()),
    scanValue: v.optional(v.string()),
    scanInputMethod: v.optional(v.union(v.literal("HID"), v.literal("MANUAL"))),
    manualEntryReason: v.optional(v.string()),
    note: v.optional(v.string()),
    installationId: v.optional(v.string()),
    /** A supervisor approval, when the entry needs one (`FF-P1-11`). */
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

/**
 * Spend one supervisor approval, in this transaction.
 *
 * Resolving the device from the installation ID rather than trusting a
 * client-supplied device ID is what makes "the approval was given on *this*
 * device" checkable: the installation resolves through the organization's own
 * index, so a value from another tenant resolves to nothing.
 */
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

/**
 * The maker-checker facts `work.stepUp.approve` needs.
 *
 * Exported here rather than in `stepUp.ts` because the maker is the *operator*
 * named in the request, and the evaluator's rule — a checker may not be the
 * maker — is exactly the "no self-approval" rule this slice needs. Handing the
 * operator as the maker means the shared evaluator denies a supervisor
 * approving their own entry, with the same `APPROVAL_REQUIRED` audit reason as
 * every other maker-checker refusal in the system.
 */
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

/** The page cap, re-exported so a client can size its own loop. */
export const maxOperatorTaskPageSize = MAX_JOB_PAGE_SIZE;
