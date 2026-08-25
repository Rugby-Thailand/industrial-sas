import { v } from "convex/values";

import {
  createMasterDataRow,
  replayTenantWriteIfPresent,
  updateMasterDataRow,
} from "../lib/masterDataStore";
import {
  postLedgerTransaction,
  toPublicLedgerError,
} from "../lib/inventoryLedgerStore";
import type { TenantOrgId } from "../lib/tenantDb";
import {
  mutationWithOrg,
  queryWithOrg,
  type TenantFunctionContext,
  type TenantPolicyContext,
} from "../lib/tenantFunctions";
import { countEntrySource } from "../lib/validators";
import {
  refusal,
  writeContextOf,
  writeOutcomeValidator,
  written,
} from "../lib/writeEnvelope";
import {
  captureCountEntry,
  decideCountTaskReconciled,
  decideCountTaskRecount,
  decideCountTaskStart,
  decideCountTaskSubmission,
  projectCountTaskForViewer,
  type CountPlanState,
  type CountTaskState,
  type CountViewerRole,
} from "../model/counting/countLifecycle";
import {
  assessCountVariance,
  buildCountAdjustmentTransaction,
  decideReconciliation,
  verifyPaperCountReentry,
} from "../model/counting/reconciliationPolicy";
import type { StockStatus } from "../model/inventory/stockIdentity";
import { makeItemUomProfile, type ItemUomProfile } from "../model/uom/itemUom";
import { makeRatio } from "../model/uom/ratio";

export const COUNT_EXECUTION_OPERATIONS = Object.freeze({
  start: "inventory.count.startTask",
  capture: "inventory.count.captureEntry",
  submit: "inventory.count.submitTask",
  requestRecount: "inventory.count.requestRecount",
  prepareReconciliation: "inventory.count.prepareReconciliation",
  approveReconciliation: "inventory.count.approveReconciliation",
  recordPaperCapture: "inventory.count.recordPaperCapture",
});

const MAX_AVAILABLE_TASKS = 50;
const MAX_ITEM_UOMS = 16;

interface CountPlanDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly warehouseId: string;
  readonly status: CountPlanState["status"];
  readonly visibility: CountPlanState["visibility"];
  readonly movementPolicy: CountPlanState["movementPolicy"];
  readonly freezeExpiresAt?: number;
  readonly quantityThresholdBaseMinorUnits: number;
  readonly valueThresholdMinorUnits: number;
  readonly planNumber: string;
}

interface CountTaskDocument extends CountTaskState {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly warehouseId: string;
  readonly countPlanId: string;
  readonly taskNumber: number;
  readonly locationId: string;
}

interface CountSnapshotDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly warehouseId: string;
  readonly countPlanId: string;
  readonly countTaskId: string;
  readonly bucketKey: string;
  readonly itemId: string;
  readonly locationId: string;
  readonly lotId?: string;
  readonly stockStatus: StockStatus;
  readonly baseUom: string;
  readonly systemBaseMinorUnits: number;
  readonly itemClass: string;
  readonly unitValueMinorUnits: number;
}

interface CountEntryDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly countSnapshotId: string;
  readonly countOrdinal: number;
  readonly baseMinorUnits: number;
  readonly capturedByUserId: string;
}

interface CountReconciliationDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly warehouseId: string;
  readonly countPlanId: string;
  readonly countTaskId: string;
  readonly countSnapshotId: string;
  readonly status: string;
  readonly risk: "MATCH" | "STANDARD" | "HIGH";
  readonly systemSnapshotBaseMinorUnits: number;
  readonly inCountMovementBaseMinorUnits: number;
  readonly physicalBaseMinorUnits: number;
  readonly varianceBaseMinorUnits: number;
  readonly absoluteVarianceValueMinorUnits: number;
  readonly rootCauseCode?: string;
  readonly counterUserId: string;
  readonly approvedByUserId?: string;
  readonly approvedAt?: number;
  readonly postRequestId?: string;
  readonly transactionId?: string;
  readonly postedAt?: number;
}

interface BalanceDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly bucketKey: string;
  readonly quantity: { readonly uom: string; readonly minorUnits: number };
}

interface ItemDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly sku: string;
  readonly baseUom: string;
  readonly status: string;
}

interface ItemUomDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly uom: string;
  readonly toBaseNumerator: number;
  readonly toBaseDenominator: number;
  readonly status: string;
}

interface ReasonCodeDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly code: string;
  readonly scope: string;
  readonly status: string;
}

interface CountPaperCaptureDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly warehouseId: string;
  readonly countTaskId: string;
  readonly captureOrdinal: number;
  readonly sheetHash: string;
  readonly lineCount: number;
  readonly evidenceId: string;
  readonly enteredByUserId: string;
  readonly enteredAt: number;
}

const taskState = (task: CountTaskDocument): CountTaskState => ({
  status: task.status,
  ...(task.firstCounterUserId === undefined
    ? {}
    : { firstCounterUserId: task.firstCounterUserId }),
  ...(task.secondCounterUserId === undefined
    ? {}
    : { secondCounterUserId: task.secondCounterUserId }),
  ...(task.activeCounterUserId === undefined
    ? {}
    : { activeCounterUserId: task.activeCounterUserId }),
  ...(task.activeCountOrdinal === undefined
    ? {}
    : { activeCountOrdinal: task.activeCountOrdinal }),
  ...(task.submittedCountOrdinal === undefined
    ? {}
    : { submittedCountOrdinal: task.submittedCountOrdinal }),
  ...(task.firstSubmittedAt === undefined
    ? {}
    : { firstSubmittedAt: task.firstSubmittedAt }),
  ...(task.secondSubmittedAt === undefined
    ? {}
    : { secondSubmittedAt: task.secondSubmittedAt }),
  entryCount: task.entryCount,
  ...(task.recountRequestedByUserId === undefined
    ? {}
    : { recountRequestedByUserId: task.recountRequestedByUserId }),
  ...(task.recountRequestedAt === undefined
    ? {}
    : { recountRequestedAt: task.recountRequestedAt }),
  ...(task.recountReason === undefined
    ? {}
    : { recountReason: task.recountReason }),
  ...(task.lastDiscardedByUserId === undefined
    ? {}
    : { lastDiscardedByUserId: task.lastDiscardedByUserId }),
  ...(task.lastDiscardedAt === undefined
    ? {}
    : { lastDiscardedAt: task.lastDiscardedAt }),
  ...(task.lastDiscardReason === undefined
    ? {}
    : { lastDiscardReason: task.lastDiscardReason }),
  ...(task.reconciledByUserId === undefined
    ? {}
    : { reconciledByUserId: task.reconciledByUserId }),
  ...(task.reconciledAt === undefined
    ? {}
    : { reconciledAt: task.reconciledAt }),
});

const taskPatch = (state: CountTaskState) => ({
  status: state.status,
  ...(state.firstCounterUserId === undefined
    ? {}
    : { firstCounterUserId: state.firstCounterUserId }),
  ...(state.secondCounterUserId === undefined
    ? {}
    : { secondCounterUserId: state.secondCounterUserId }),

  activeCounterUserId: state.activeCounterUserId,
  activeCountOrdinal: state.activeCountOrdinal,
  ...(state.submittedCountOrdinal === undefined
    ? {}
    : { submittedCountOrdinal: state.submittedCountOrdinal }),
  ...(state.firstSubmittedAt === undefined
    ? {}
    : { firstSubmittedAt: state.firstSubmittedAt }),
  ...(state.secondSubmittedAt === undefined
    ? {}
    : { secondSubmittedAt: state.secondSubmittedAt }),
  entryCount: state.entryCount,
  ...(state.recountRequestedByUserId === undefined
    ? {}
    : { recountRequestedByUserId: state.recountRequestedByUserId }),
  ...(state.recountRequestedAt === undefined
    ? {}
    : { recountRequestedAt: state.recountRequestedAt }),
  ...(state.recountReason === undefined
    ? {}
    : { recountReason: state.recountReason }),
  ...(state.reconciledByUserId === undefined
    ? {}
    : { reconciledByUserId: state.reconciledByUserId }),
  ...(state.reconciledAt === undefined
    ? {}
    : { reconciledAt: state.reconciledAt }),
});

async function loadTaskBundle(ctx: TenantFunctionContext, taskId: string) {
  const task = await ctx.tenantDb.get<CountTaskDocument>("countTasks", taskId);
  if (task === null) return null;
  const plan = await ctx.tenantDb.get<CountPlanDocument>(
    "countPlans",
    task.countPlanId,
  );
  if (plan === null || plan.warehouseId !== task.warehouseId) return null;
  const snapshot = await ctx.tenantDb
    .byIndex<CountSnapshotDocument>(
      "countSnapshots",
      "by_orgId_countTaskId_bucketKey",
      [{ field: "countTaskId", value: task._id }],
    )
    .unique();
  return snapshot === null ? null : { task, plan, snapshot };
}

async function loadItemProfile(
  ctx: TenantFunctionContext,
  itemId: string,
): Promise<{
  readonly item: ItemDocument;
  readonly profile: ItemUomProfile;
} | null> {
  const item = await ctx.tenantDb.get<ItemDocument>("items", itemId);
  if (item === null || item.status !== "ACTIVE") return null;
  const rows = await ctx.tenantDb
    .byIndex<ItemUomDocument>("itemUoms", "by_orgId_itemId_status_uom", [
      { field: "itemId", value: item._id },
      { field: "status", value: "ACTIVE" },
    ])
    .take(MAX_ITEM_UOMS);
  const alternates = [];
  for (const row of rows) {
    const ratio = makeRatio(row.toBaseNumerator, row.toBaseDenominator);
    if (!ratio.ok) return null;
    alternates.push({ uom: row.uom, toBase: ratio.value });
  }
  const profile = makeItemUomProfile({
    itemKey: item.sku,
    baseUom: item.baseUom,
    alternates,
  });
  return profile.ok ? { item, profile: profile.value } : null;
}

async function currentMovement(
  ctx: TenantFunctionContext,
  snapshot: CountSnapshotDocument,
) {
  const balance = await ctx.tenantDb
    .byIndex<BalanceDocument>("inventoryBalances", "by_orgId_bucketKey", [
      { field: "bucketKey", value: snapshot.bucketKey },
    ])
    .unique();
  const current = balance?.quantity.minorUnits ?? 0;
  const movement = current - snapshot.systemBaseMinorUnits;
  return Number.isSafeInteger(movement) ? movement : null;
}

async function readEntry(
  ctx: TenantFunctionContext,
  snapshotId: string,
  ordinal: 1 | 2,
) {
  return await ctx.tenantDb
    .byIndex<CountEntryDocument>(
      "countEntries",
      "by_orgId_countSnapshotId_countOrdinal",
      [
        { field: "countSnapshotId", value: snapshotId },
        { field: "countOrdinal", value: ordinal },
      ],
    )
    .unique();
}

async function readPaperCapture(
  ctx: TenantFunctionContext,
  taskId: string,
  ordinal: 1 | 2,
) {
  return await ctx.tenantDb
    .byIndex<CountPaperCaptureDocument>(
      "countPaperCaptures",
      "by_orgId_countTaskId_captureOrdinal",
      [
        { field: "countTaskId", value: taskId },
        { field: "captureOrdinal", value: ordinal },
      ],
    )
    .unique();
}

export const recordCountPaperCapture = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    countTaskId: v.id("countTasks"),
    captureOrdinal: v.union(v.literal(1), v.literal(2)),
    sheetHash: v.string(),
    lineCount: v.number(),
    evidenceId: v.string(),
  },
  returns: writeOutcomeValidator,
  permissionCode: "inventory.count.execute",
  target: { table: "countTasks", id: ({ countTaskId }) => countTaskId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const bundle = await loadTaskBundle(ctx, args.countTaskId);
    if (bundle === null || bundle.task.warehouseId !== args.warehouseId) {
      return refusal({ code: "NOT_FOUND", table: "countTasks" });
    }
    if (!/^[0-9a-f]{64}$/i.test(args.sheetHash)) {
      return refusal({ code: "SHEET_HASH_INVALID", field: "sheetHash" });
    }
    if (!Number.isSafeInteger(args.lineCount) || args.lineCount <= 0) {
      return refusal({ code: "LINE_COUNT_INVALID", field: "lineCount" });
    }
    const fingerprint = {
      countTaskId: bundle.task._id,
      captureOrdinal: args.captureOrdinal,
      sheetHash: args.sheetHash.toLowerCase(),
      lineCount: args.lineCount,
      evidenceId: args.evidenceId,
    };
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "countPaperCaptures",
      operation: COUNT_EXECUTION_OPERATIONS.recordPaperCapture,
      requestId: args.requestId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) {
      return written(replay.value);
    }
    if (args.captureOrdinal === 2) {
      const first = await readPaperCapture(ctx, bundle.task._id, 1);
      if (first === null)
        return refusal({ code: "FIRST_PAPER_CAPTURE_REQUIRED" });
      const verified = verifyPaperCountReentry({
        first,
        second: {
          sheetHash: args.sheetHash.toLowerCase(),
          lineCount: args.lineCount,
          enteredByUserId: ctx.tenant.actor._id,
          evidenceId: args.evidenceId,
        },
        verifiedAt: Date.now(),
      });
      if (!verified.ok) return refusal(verified.error);
    }
    const outcome = await createMasterDataRow({
      ...writeContextOf(ctx, {
        table: "countPaperCaptures",
        operation: COUNT_EXECUTION_OPERATIONS.recordPaperCapture,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      fingerprint,
      uniqueness: [
        {
          field: "captureOrdinal",
          index: "by_orgId_countTaskId_captureOrdinal",
          equality: [
            { field: "countTaskId", value: bundle.task._id },
            { field: "captureOrdinal", value: args.captureOrdinal },
          ],
        },
      ],
      document: {
        warehouseId: args.warehouseId,
        countTaskId: bundle.task._id,
        captureOrdinal: args.captureOrdinal,
        sheetHash: args.sheetHash.toLowerCase(),
        lineCount: args.lineCount,
        evidenceId: args.evidenceId,
        enteredByUserId: ctx.tenant.actor._id,
        enteredAt: Date.now(),
      },
    });
    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});

export const listAvailableCountTasks = queryWithOrg({
  args: { warehouseId: v.id("warehouses") },
  returns: v.object({
    tasks: v.array(
      v.object({
        countTaskId: v.id("countTasks"),
        countPlanId: v.id("countPlans"),
        planNumber: v.string(),
        taskNumber: v.number(),
        locationId: v.id("locations"),
        visibility: v.string(),
      }),
    ),
  }),
  permissionCode: "inventory.count.execute",
  target: { table: "countTasks" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const available = await ctx.tenantDb
      .byIndex<CountTaskDocument>(
        "countTasks",
        "by_orgId_warehouseId_status_taskNumber",
        [
          { field: "warehouseId", value: args.warehouseId },
          { field: "status", value: "AVAILABLE" },
        ],
      )
      .take(MAX_AVAILABLE_TASKS);
    const recounts = await ctx.tenantDb
      .byIndex<CountTaskDocument>(
        "countTasks",
        "by_orgId_warehouseId_status_taskNumber",
        [
          { field: "warehouseId", value: args.warehouseId },
          { field: "status", value: "RECOUNT_REQUIRED" },
        ],
      )
      .take(MAX_AVAILABLE_TASKS);
    const tasks = [...available, ...recounts]
      .sort((left, right) => left.taskNumber - right.taskNumber)
      .slice(0, MAX_AVAILABLE_TASKS);
    const visible = [];
    for (const task of tasks) {
      const plan = await ctx.tenantDb.get<CountPlanDocument>(
        "countPlans",
        task.countPlanId,
      );
      if (plan === null || !["RELEASED", "IN_PROGRESS"].includes(plan.status))
        continue;
      visible.push({
        countTaskId: task._id as never,
        countPlanId: plan._id as never,
        planNumber: plan.planNumber,
        taskNumber: task.taskNumber,
        locationId: task.locationId as never,
        visibility: plan.visibility,
      });
    }
    return { tasks: visible };
  },
});

export const listCountReconciliationWork = queryWithOrg({
  args: { warehouseId: v.id("warehouses") },
  returns: v.object({
    submitted: v.array(
      v.object({
        countTaskId: v.id("countTasks"),
        countPlanId: v.id("countPlans"),
        planNumber: v.string(),
        taskNumber: v.number(),
        submittedCountOrdinal: v.number(),
      }),
    ),
    pendingApproval: v.array(
      v.object({
        countReconciliationId: v.id("countReconciliations"),
        countTaskId: v.id("countTasks"),
        risk: v.string(),
        systemSnapshotBaseMinorUnits: v.number(),
        inCountMovementBaseMinorUnits: v.number(),
        physicalBaseMinorUnits: v.number(),
        varianceBaseMinorUnits: v.number(),
        absoluteVarianceValueMinorUnits: v.number(),
        rootCauseCode: v.optional(v.string()),
      }),
    ),
  }),
  permissionCode: "inventory.count.reconcile",
  target: { table: "countReconciliations" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const tasks = await ctx.tenantDb
      .byIndex<CountTaskDocument>(
        "countTasks",
        "by_orgId_warehouseId_status_taskNumber",
        [
          { field: "warehouseId", value: args.warehouseId },
          { field: "status", value: "SUBMITTED" },
        ],
      )
      .take(MAX_AVAILABLE_TASKS);
    const submitted = [];
    for (const task of tasks) {
      const plan = await ctx.tenantDb.get<CountPlanDocument>(
        "countPlans",
        task.countPlanId,
      );
      if (plan === null || task.submittedCountOrdinal === undefined) continue;
      submitted.push({
        countTaskId: task._id as never,
        countPlanId: plan._id as never,
        planNumber: plan.planNumber,
        taskNumber: task.taskNumber,
        submittedCountOrdinal: task.submittedCountOrdinal,
      });
    }
    const reconciliations = await ctx.tenantDb
      .byIndex<CountReconciliationDocument>(
        "countReconciliations",
        "by_orgId_warehouseId_status",
        [
          { field: "warehouseId", value: args.warehouseId },
          { field: "status", value: "PENDING_APPROVAL" },
        ],
      )
      .take(MAX_AVAILABLE_TASKS);
    return {
      submitted,
      pendingApproval: reconciliations.map((row) => ({
        countReconciliationId: row._id as never,
        countTaskId: row.countTaskId as never,
        risk: row.risk,
        systemSnapshotBaseMinorUnits: row.systemSnapshotBaseMinorUnits,
        inCountMovementBaseMinorUnits: row.inCountMovementBaseMinorUnits,
        physicalBaseMinorUnits: row.physicalBaseMinorUnits,
        varianceBaseMinorUnits: row.varianceBaseMinorUnits,
        absoluteVarianceValueMinorUnits: row.absoluteVarianceValueMinorUnits,
        ...(row.rootCauseCode === undefined
          ? {}
          : { rootCauseCode: row.rootCauseCode }),
      })),
    };
  },
});

export const startCountTask = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    countTaskId: v.id("countTasks"),
  },
  returns: writeOutcomeValidator,
  permissionCode: "inventory.count.execute",
  target: { table: "countTasks", id: ({ countTaskId }) => countTaskId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const fingerprint = { countTaskId: args.countTaskId };
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "countTasks",
      operation: COUNT_EXECUTION_OPERATIONS.start,
      requestId: args.requestId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) {
      return written(replay.value);
    }
    const bundle = await loadTaskBundle(ctx, args.countTaskId);
    if (bundle === null || bundle.task.warehouseId !== args.warehouseId)
      return refusal({ code: "NOT_FOUND", table: "countTasks" });
    if (!["RELEASED", "IN_PROGRESS"].includes(bundle.plan.status))
      return refusal({
        code: "PLAN_NOT_ACTIONABLE",
        status: bundle.plan.status,
      });
    const decision = decideCountTaskStart({
      state: taskState(bundle.task),
      actorUserId: ctx.tenant.actor._id,
    });
    if (!decision.ok) return refusal(decision.error);
    const outcome = await updateMasterDataRow({
      ...writeContextOf(ctx, {
        table: "countTasks",
        operation: COUNT_EXECUTION_OPERATIONS.start,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      documentId: bundle.task._id,
      fingerprint,
      uniqueness: [],
      patch: taskPatch(decision.value),
    });
    if (!outcome.ok) return refusal(outcome.error);
    if (bundle.plan.status === "RELEASED")
      await ctx.tenantDb.patch("countPlans", bundle.plan._id, {
        status: "IN_PROGRESS",
      });
    return written(outcome.value);
  },
});

export const captureCountTaskEntry = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    countTaskId: v.id("countTasks"),
    source: countEntrySource,
    entryUom: v.string(),
    entryMinorUnits: v.number(),
    paperEvidenceId: v.optional(v.string()),
  },
  returns: writeOutcomeValidator,
  permissionCode: "inventory.count.execute",
  target: { table: "countTasks", id: ({ countTaskId }) => countTaskId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const bundle = await loadTaskBundle(ctx, args.countTaskId);
    if (bundle === null || bundle.task.warehouseId !== args.warehouseId)
      return refusal({ code: "NOT_FOUND", table: "countTasks" });
    const ordinal =
      bundle.task.activeCountOrdinal ?? bundle.task.submittedCountOrdinal;
    if (ordinal !== 1 && ordinal !== 2)
      return refusal({ code: "COUNT_ORDINAL_INVALID" });
    const fingerprint = {
      countTaskId: bundle.task._id,
      countOrdinal: ordinal,
      source: args.source,
      entryUom: args.entryUom,
      entryMinorUnits: args.entryMinorUnits,
      paperEvidenceId: args.paperEvidenceId,
    };
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "countEntries",
      operation: COUNT_EXECUTION_OPERATIONS.capture,
      requestId: args.requestId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) {
      return written(replay.value);
    }
    if (
      !["COUNTING", "RECOUNTING"].includes(bundle.task.status) ||
      bundle.task.activeCounterUserId !== ctx.tenant.actor._id
    ) {
      return refusal({
        code: "TASK_NOT_HELD_BY_ACTOR",
        status: bundle.task.status,
      });
    }
    if (args.source === "PAPER_REENTRY" && args.paperEvidenceId === undefined)
      return refusal({
        code: "PAPER_EVIDENCE_REQUIRED",
        field: "paperEvidenceId",
      });
    if (args.source === "PAPER_REENTRY") {
      const first = await readPaperCapture(ctx, bundle.task._id, 1);
      const second = await readPaperCapture(ctx, bundle.task._id, 2);
      if (first === null || second === null) {
        return refusal({ code: "PAPER_DUAL_KEY_REQUIRED" });
      }
      const verified = verifyPaperCountReentry({
        first,
        second,
        verifiedAt: Date.now(),
      });
      if (!verified.ok) return refusal(verified.error);
      if (!verified.value.evidenceIds.includes(args.paperEvidenceId!)) {
        return refusal({ code: "PAPER_EVIDENCE_MISMATCH" });
      }
    }
    const loaded = await loadItemProfile(ctx, bundle.snapshot.itemId);
    if (loaded === null)
      return refusal({ code: "UOM_PROFILE_INVALID", field: "itemId" });
    const captured = captureCountEntry({
      itemKey: loaded.item.sku,
      profile: loaded.profile,
      entryUom: args.entryUom,
      entryMinorUnits: args.entryMinorUnits,
    });
    if (!captured.ok)
      return refusal({ code: captured.error.code, field: "quantity" });
    const outcome = await createMasterDataRow({
      ...writeContextOf(ctx, {
        table: "countEntries",
        operation: COUNT_EXECUTION_OPERATIONS.capture,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      fingerprint,
      uniqueness: [
        {
          field: "countOrdinal",
          index: "by_orgId_countSnapshotId_countOrdinal",
          equality: [
            { field: "countSnapshotId", value: bundle.snapshot._id },
            { field: "countOrdinal", value: ordinal },
          ],
        },
      ],
      document: {
        warehouseId: args.warehouseId,
        countPlanId: bundle.plan._id,
        countTaskId: bundle.task._id,
        countSnapshotId: bundle.snapshot._id,
        countOrdinal: ordinal,
        source: args.source,
        entryUom: captured.value.entryUom,
        entryMinorUnits: captured.value.entryMinorUnits,
        baseUom: captured.value.baseQuantity.uom,
        baseMinorUnits: captured.value.baseQuantity.minorUnits,
        capturedByUserId: ctx.tenant.actor._id,
        capturedAt: Date.now(),
        ...(args.paperEvidenceId === undefined
          ? {}
          : { paperEvidenceId: args.paperEvidenceId }),
      },
    });
    if (!outcome.ok) return refusal(outcome.error);
    await ctx.tenantDb.patch("countTasks", bundle.task._id, { entryCount: 1 });
    return written(outcome.value);
  },
});

export const submitCountTask = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    countTaskId: v.id("countTasks"),
  },
  returns: writeOutcomeValidator,
  permissionCode: "inventory.count.execute",
  target: { table: "countTasks", id: ({ countTaskId }) => countTaskId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const bundle = await loadTaskBundle(ctx, args.countTaskId);
    if (bundle === null || bundle.task.warehouseId !== args.warehouseId)
      return refusal({ code: "NOT_FOUND", table: "countTasks" });
    const replayOrdinal =
      bundle.task.activeCountOrdinal ?? bundle.task.submittedCountOrdinal;
    const fingerprint = {
      countTaskId: bundle.task._id,
      countOrdinal: replayOrdinal,
    };
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "countTasks",
      operation: COUNT_EXECUTION_OPERATIONS.submit,
      requestId: args.requestId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) {
      return written(replay.value);
    }
    const decision = decideCountTaskSubmission({
      state: taskState(bundle.task),
      actorUserId: ctx.tenant.actor._id,
      entryCount: bundle.task.entryCount,
      now: Date.now(),
      ...(bundle.plan.movementPolicy === "FROZEN" &&
      bundle.plan.freezeExpiresAt !== undefined
        ? { freezeExpiresAt: bundle.plan.freezeExpiresAt }
        : {}),
    });
    if (!decision.ok) return refusal(decision.error);
    const outcome = await updateMasterDataRow({
      ...writeContextOf(ctx, {
        table: "countTasks",
        operation: COUNT_EXECUTION_OPERATIONS.submit,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      documentId: bundle.task._id,
      fingerprint,
      uniqueness: [],
      patch: taskPatch(decision.value),
    });
    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});

export const requestCountRecount = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    countTaskId: v.id("countTasks"),
    reason: v.string(),
  },
  returns: writeOutcomeValidator,
  permissionCode: "inventory.count.reconcile",
  target: { table: "countTasks", id: ({ countTaskId }) => countTaskId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const bundle = await loadTaskBundle(ctx, args.countTaskId);
    if (bundle === null || bundle.task.warehouseId !== args.warehouseId)
      return refusal({ code: "NOT_FOUND", table: "countTasks" });
    const fingerprint = {
      countTaskId: bundle.task._id,
      reason: args.reason.trim(),
    };
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "countTasks",
      operation: COUNT_EXECUTION_OPERATIONS.requestRecount,
      requestId: args.requestId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) {
      return written(replay.value);
    }
    const decision = decideCountTaskRecount({
      state: taskState(bundle.task),
      actorUserId: ctx.tenant.actor._id,
      reason: args.reason,
      now: Date.now(),
    });
    if (!decision.ok) return refusal(decision.error);
    const outcome = await updateMasterDataRow({
      ...writeContextOf(ctx, {
        table: "countTasks",
        operation: COUNT_EXECUTION_OPERATIONS.requestRecount,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      documentId: bundle.task._id,
      fingerprint,
      uniqueness: [],
      patch: taskPatch(decision.value),
    });
    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});

async function resolveAdjustmentReason(
  ctx: TenantFunctionContext,
  code: string,
) {
  const row = await ctx.tenantDb
    .byIndex<ReasonCodeDocument>("reasonCodes", "by_orgId_code", [
      { field: "code", value: code },
    ])
    .unique();
  return row !== null && row.scope === "ADJUSTMENT" && row.status === "ACTIVE"
    ? row
    : null;
}

async function reconcileTask(
  ctx: TenantFunctionContext,
  task: CountTaskDocument,
) {
  const decision = decideCountTaskReconciled({
    state: taskState(task),
    actorUserId: ctx.tenant.actor._id,
    now: Date.now(),
  });
  if (!decision.ok) return decision;
  await ctx.tenantDb.patch("countTasks", task._id, taskPatch(decision.value));
  return decision;
}

export const prepareCountReconciliation = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    countTaskId: v.id("countTasks"),
    rootCauseCode: v.optional(v.string()),
  },
  returns: writeOutcomeValidator,
  permissionCode: "inventory.count.reconcile",
  target: { table: "countTasks", id: ({ countTaskId }) => countTaskId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const replayFingerprint = {
      countTaskId: args.countTaskId,
      rootCauseCode: args.rootCauseCode,
    };
    let replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "countReconciliations",
      operation: COUNT_EXECUTION_OPERATIONS.prepareReconciliation,
      requestId: args.requestId,
      fingerprint: replayFingerprint,
    });
    if (!replay.ok && replay.error.code === "REPLAY_TARGET_MISSING") {
      replay = await replayTenantWriteIfPresent({
        tenantDb: ctx.tenantDb,
        table: "countTasks",
        operation: COUNT_EXECUTION_OPERATIONS.prepareReconciliation,
        requestId: args.requestId,
        fingerprint: replayFingerprint,
      });
    }
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);
    const bundle = await loadTaskBundle(ctx, args.countTaskId);
    if (bundle === null || bundle.task.warehouseId !== args.warehouseId)
      return refusal({ code: "NOT_FOUND", table: "countTasks" });
    if (bundle.task.status !== "SUBMITTED")
      return refusal({
        code: "TASK_NOT_ACTIONABLE",
        status: bundle.task.status,
      });
    const ordinal = bundle.task.submittedCountOrdinal;
    if (ordinal !== 1 && ordinal !== 2)
      return refusal({ code: "COUNT_ORDINAL_INVALID" });
    const entry = await readEntry(ctx, bundle.snapshot._id, ordinal);
    if (entry === null) return refusal({ code: "COUNT_ENTRY_NOT_FOUND" });
    const movement = await currentMovement(ctx, bundle.snapshot);
    if (movement === null)
      return refusal({ code: "ARITHMETIC_OVERFLOW", field: "movement" });
    if (bundle.plan.movementPolicy === "FROZEN") {
      if (
        bundle.plan.freezeExpiresAt === undefined ||
        bundle.plan.freezeExpiresAt <= Date.now()
      )
        return refusal({
          code: "FREEZE_EXPIRED",
          status: String(bundle.plan.freezeExpiresAt ?? 0),
        });
      if (movement !== 0)
        return refusal({ code: "FROZEN_LOCATION_MOVED", field: "bucketKey" });
    }
    const assessment = assessCountVariance({
      systemSnapshotBaseMinorUnits: bundle.snapshot.systemBaseMinorUnits,
      inCountMovementBaseMinorUnits:
        bundle.plan.movementPolicy === "MOVEMENT_AWARE" ? movement : 0,
      physicalBaseMinorUnits: entry.baseMinorUnits,
      unitValueMinorUnits: bundle.snapshot.unitValueMinorUnits,
      itemClass: bundle.snapshot.itemClass,
      policy: {
        quantityThresholdBaseMinorUnits:
          bundle.plan.quantityThresholdBaseMinorUnits,
        valueThresholdMinorUnits: bundle.plan.valueThresholdMinorUnits,
        highRiskItemClasses: [],
      },
    });
    if (!assessment.ok)
      return refusal({ code: assessment.error.code, field: "variance" });
    if (assessment.value.risk === "HIGH" && ordinal === 1) {
      const recount = decideCountTaskRecount({
        state: taskState(bundle.task),
        actorUserId: ctx.tenant.actor._id,
        reason: "HIGH_RISK_VARIANCE",
        now: Date.now(),
      });
      if (!recount.ok) return refusal(recount.error);
      const outcome = await updateMasterDataRow({
        ...writeContextOf(ctx, {
          table: "countTasks",
          operation: COUNT_EXECUTION_OPERATIONS.prepareReconciliation,
          requestId: args.requestId,
          warehouseId: args.warehouseId,
        }),
        documentId: bundle.task._id,
        fingerprint: {
          countTaskId: bundle.task._id,
          rootCauseCode: args.rootCauseCode,
        },
        uniqueness: [],
        patch: taskPatch(recount.value),
      });
      return outcome.ok ? written(outcome.value) : refusal(outcome.error);
    }
    if (
      assessment.value.varianceBaseMinorUnits !== 0 &&
      args.rootCauseCode === undefined
    )
      return refusal({ code: "ROOT_CAUSE_REQUIRED", field: "rootCauseCode" });
    const reason =
      assessment.value.varianceBaseMinorUnits === 0
        ? null
        : await resolveAdjustmentReason(ctx, args.rootCauseCode!);
    if (assessment.value.varianceBaseMinorUnits !== 0 && reason === null)
      return refusal({ code: "REASON_CODE_INVALID", field: "rootCauseCode" });
    const fingerprint = {
      countTaskId: bundle.task._id,
      rootCauseCode: args.rootCauseCode,
    };
    const pendingHigh = assessment.value.risk === "HIGH";
    const now = Date.now();
    const outcome = await createMasterDataRow({
      ...writeContextOf(ctx, {
        table: "countReconciliations",
        operation: COUNT_EXECUTION_OPERATIONS.prepareReconciliation,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      fingerprint,
      uniqueness: [
        {
          field: "countSnapshotId",
          index: "by_orgId_countSnapshotId",
          equality: [{ field: "countSnapshotId", value: bundle.snapshot._id }],
        },
      ],
      document: {
        warehouseId: args.warehouseId,
        countPlanId: bundle.plan._id,
        countTaskId: bundle.task._id,
        countSnapshotId: bundle.snapshot._id,
        status:
          assessment.value.risk === "MATCH"
            ? "MATCHED"
            : pendingHigh
              ? "PENDING_APPROVAL"
              : "APPROVED",
        risk: assessment.value.risk,
        systemSnapshotBaseMinorUnits:
          assessment.value.systemSnapshotBaseMinorUnits,
        inCountMovementBaseMinorUnits:
          assessment.value.inCountMovementBaseMinorUnits,
        physicalBaseMinorUnits: assessment.value.physicalBaseMinorUnits,
        varianceBaseMinorUnits: assessment.value.varianceBaseMinorUnits,
        absoluteVarianceValueMinorUnits:
          assessment.value.absoluteVarianceValueMinorUnits,
        ...(args.rootCauseCode === undefined
          ? {}
          : { rootCauseCode: args.rootCauseCode }),
        counterUserId: entry.capturedByUserId,
        ...(!pendingHigh && assessment.value.risk !== "MATCH"
          ? { approvedByUserId: ctx.tenant.actor._id, approvedAt: now }
          : {}),
      },
    });
    if (!outcome.ok) return refusal(outcome.error);
    if (assessment.value.risk === "MATCH") {
      const reconciled = await reconcileTask(ctx, bundle.task);
      return reconciled.ok
        ? {
            written: true as const,
            documentId: outcome.value.documentId,
            replayed: false,
          }
        : refusal(reconciled.error);
    }
    if (pendingHigh)
      return {
        written: true as const,
        documentId: outcome.value.documentId,
        replayed: false,
      };
    const approved = decideReconciliation({
      assessment: assessment.value,
      counterUserId: entry.capturedByUserId,
      approverUserId: ctx.tenant.actor._id,
      ...(args.rootCauseCode === undefined
        ? {}
        : { rootCauseCode: args.rootCauseCode }),
      now,
    });
    if (!approved.ok) return refusal(approved.error);
    const draft = buildCountAdjustmentTransaction({
      orgId: ctx.tenant.organization._id,
      warehouseId: args.warehouseId,
      reconciliationId: outcome.value.documentId,
      requestId: args.requestId,
      actorUserId: ctx.tenant.actor._id,
      occurredAt: now,
      bucket: {
        orgId: ctx.tenant.organization._id,
        warehouseId: args.warehouseId,
        itemId: bundle.snapshot.itemId,
        location: { kind: "PHYSICAL", locationId: bundle.snapshot.locationId },
        ...(bundle.snapshot.lotId === undefined
          ? {}
          : { lotId: bundle.snapshot.lotId }),
        stockStatus: bundle.snapshot.stockStatus,
      },
      baseUom: bundle.snapshot.baseUom,
      reasonCodeId: reason!._id,
      decision: approved.value,
    });
    if (!draft.ok)
      return refusal({ code: draft.error.code, field: "adjustment" });
    const posted = await postLedgerTransaction({
      tenantDb: ctx.tenantDb,
      tenant: ctx.tenant,
      permissionCode: ctx.permission.code,
      now,
      draft: draft.value,
    });
    if (!posted.ok) return refusal(toPublicLedgerError(posted.error));
    await ctx.tenantDb.patch("countReconciliations", outcome.value.documentId, {
      status: "POSTED",
      postRequestId: args.requestId,
      transactionId: posted.value.result.transactionId,
      postedAt: now,
    });
    const reconciled = await reconcileTask(ctx, bundle.task);
    return reconciled.ok
      ? {
          written: true as const,
          documentId: outcome.value.documentId,
          replayed: false,
        }
      : refusal(reconciled.error);
  },
});

export async function countApprovalPolicy(
  ctx: TenantPolicyContext,
  args: { readonly countReconciliationId: string },
) {
  const row = await ctx.tenantDb.get<CountReconciliationDocument>(
    "countReconciliations",
    args.countReconciliationId,
  );
  return row === null
    ? Object.freeze({ thresholdExceeded: false, approvalSatisfied: false })
    : Object.freeze({
        thresholdExceeded: row.risk === "HIGH",
        thresholdApproved: row.risk === "HIGH",

        approvalSatisfied: ["PENDING_APPROVAL", "POSTED"].includes(row.status),
        makerUserId: row.counterUserId,
      });
}

export const approveCountReconciliation = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    countReconciliationId: v.id("countReconciliations"),
  },
  returns: writeOutcomeValidator,
  permissionCode: "inventory.count.approve",
  target: {
    table: "countReconciliations",
    id: ({ countReconciliationId }) => countReconciliationId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  policy: countApprovalPolicy,
  handler: async (ctx, args) => {
    const fingerprint = { countReconciliationId: args.countReconciliationId };
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "countReconciliations",
      operation: COUNT_EXECUTION_OPERATIONS.approveReconciliation,
      requestId: args.requestId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);
    const row = await ctx.tenantDb.get<CountReconciliationDocument>(
      "countReconciliations",
      args.countReconciliationId,
    );
    if (row === null || row.warehouseId !== args.warehouseId)
      return refusal({ code: "NOT_FOUND", table: "countReconciliations" });
    if (
      row.status !== "PENDING_APPROVAL" ||
      row.risk !== "HIGH" ||
      row.rootCauseCode === undefined
    )
      return refusal({
        code: "RECONCILIATION_NOT_ACTIONABLE",
        status: row.status,
      });
    const bundle = await loadTaskBundle(ctx, row.countTaskId);
    if (bundle === null) return refusal({ code: "COUNT_EVIDENCE_NOT_FOUND" });
    if (
      ctx.tenant.actor._id === bundle.task.firstCounterUserId ||
      ctx.tenant.actor._id === bundle.task.secondCounterUserId
    )
      return refusal({ code: "MAKER_CHECKER_REQUIRED" });
    const reason = await resolveAdjustmentReason(ctx, row.rootCauseCode);
    if (reason === null)
      return refusal({ code: "REASON_CODE_INVALID", field: "rootCauseCode" });
    const assessment = assessCountVariance({
      systemSnapshotBaseMinorUnits: row.systemSnapshotBaseMinorUnits,
      inCountMovementBaseMinorUnits: row.inCountMovementBaseMinorUnits,
      physicalBaseMinorUnits: row.physicalBaseMinorUnits,
      unitValueMinorUnits: bundle.snapshot.unitValueMinorUnits,
      itemClass: bundle.snapshot.itemClass,
      policy: {
        quantityThresholdBaseMinorUnits:
          bundle.plan.quantityThresholdBaseMinorUnits,
        valueThresholdMinorUnits: bundle.plan.valueThresholdMinorUnits,
        highRiskItemClasses: [],
      },
    });
    if (!assessment.ok || assessment.value.risk !== "HIGH")
      return refusal({ code: "RECONCILIATION_POLICY_CHANGED" });
    const now = Date.now();
    const decision = decideReconciliation({
      assessment: assessment.value,
      counterUserId: row.counterUserId,
      approverUserId: ctx.tenant.actor._id,
      rootCauseCode: row.rootCauseCode,
      stepUpVerified: true,
      now,
    });
    if (!decision.ok) return refusal(decision.error);
    const draft = buildCountAdjustmentTransaction({
      orgId: ctx.tenant.organization._id,
      warehouseId: args.warehouseId,
      reconciliationId: row._id,
      requestId: args.requestId,
      actorUserId: ctx.tenant.actor._id,
      occurredAt: now,
      bucket: {
        orgId: ctx.tenant.organization._id,
        warehouseId: args.warehouseId,
        itemId: bundle.snapshot.itemId,
        location: { kind: "PHYSICAL", locationId: bundle.snapshot.locationId },
        ...(bundle.snapshot.lotId === undefined
          ? {}
          : { lotId: bundle.snapshot.lotId }),
        stockStatus: bundle.snapshot.stockStatus,
      },
      baseUom: bundle.snapshot.baseUom,
      reasonCodeId: reason._id,
      decision: decision.value,
    });
    if (!draft.ok)
      return refusal({ code: draft.error.code, field: "adjustment" });
    const posted = await postLedgerTransaction({
      tenantDb: ctx.tenantDb,
      tenant: ctx.tenant,
      permissionCode: ctx.permission.code,
      now,
      draft: draft.value,
    });
    if (!posted.ok) return refusal(toPublicLedgerError(posted.error));
    const outcome = await updateMasterDataRow({
      ...writeContextOf(ctx, {
        table: "countReconciliations",
        operation: COUNT_EXECUTION_OPERATIONS.approveReconciliation,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      documentId: row._id,
      fingerprint,
      uniqueness: [],
      patch: {
        status: "POSTED",
        approvedByUserId: ctx.tenant.actor._id,
        approvedAt: now,
        postRequestId: args.requestId,
        transactionId: posted.value.result.transactionId,
        postedAt: now,
      },
    });
    if (!outcome.ok) return refusal(outcome.error);
    const reconciled = await reconcileTask(ctx, bundle.task);
    return reconciled.ok ? written(outcome.value) : refusal(reconciled.error);
  },
});

const taskViewValidator = v.object({
  countTaskId: v.id("countTasks"),
  countPlanId: v.id("countPlans"),
  taskNumber: v.number(),
  status: v.string(),
  itemId: v.id("items"),
  locationId: v.id("locations"),
  lotId: v.optional(v.id("lots")),
  baseUom: v.string(),
  visibility: v.string(),
  systemSnapshotBaseMinorUnits: v.optional(v.number()),
  movementBaseMinorUnits: v.optional(v.number()),
  firstCountBaseMinorUnits: v.optional(v.number()),
  secondCountBaseMinorUnits: v.optional(v.number()),
});

async function projectedTask(
  ctx: TenantFunctionContext,
  taskId: string,
  privileged: boolean,
) {
  const bundle = await loadTaskBundle(ctx, taskId);
  if (bundle === null) return null;
  let role: CountViewerRole;
  if (privileged) role = "SUPERVISOR";
  else if (bundle.task.secondCounterUserId === ctx.tenant.actor._id)
    role = "RECOUNTER";
  else if (
    bundle.task.firstCounterUserId === ctx.tenant.actor._id ||
    bundle.task.activeCounterUserId === ctx.tenant.actor._id
  )
    role = "COUNTER";
  else return null;
  const movement = await currentMovement(ctx, bundle.snapshot);
  if (movement === null) return null;
  const first = await readEntry(ctx, bundle.snapshot._id, 1);
  const second = await readEntry(ctx, bundle.snapshot._id, 2);
  const projection = projectCountTaskForViewer({
    source: {
      taskId: bundle.task._id,
      locationId: bundle.task.locationId,
      visibility: bundle.plan.visibility,
      systemSnapshotBaseMinorUnits: bundle.snapshot.systemBaseMinorUnits,
      movementBaseMinorUnits: movement,
      ...(first === null
        ? {}
        : { firstCountBaseMinorUnits: first.baseMinorUnits }),
      ...(second === null
        ? {}
        : { secondCountBaseMinorUnits: second.baseMinorUnits }),
    },
    role,
  });
  if (!projection.ok) return null;
  return {
    countTaskId: bundle.task._id as never,
    countPlanId: bundle.plan._id as never,
    taskNumber: bundle.task.taskNumber,
    status: bundle.task.status,
    itemId: bundle.snapshot.itemId as never,
    locationId: bundle.task.locationId as never,
    ...(bundle.snapshot.lotId === undefined
      ? {}
      : { lotId: bundle.snapshot.lotId as never }),
    baseUom: bundle.snapshot.baseUom,
    visibility: bundle.plan.visibility,
    ...(projection.value["systemSnapshotBaseMinorUnits"] === undefined
      ? {}
      : {
          systemSnapshotBaseMinorUnits: projection.value[
            "systemSnapshotBaseMinorUnits"
          ] as number,
        }),
    ...(projection.value["movementBaseMinorUnits"] === undefined
      ? {}
      : {
          movementBaseMinorUnits: projection.value[
            "movementBaseMinorUnits"
          ] as number,
        }),
    ...(projection.value["firstCountBaseMinorUnits"] === undefined
      ? {}
      : {
          firstCountBaseMinorUnits: projection.value[
            "firstCountBaseMinorUnits"
          ] as number,
        }),
    ...(projection.value["secondCountBaseMinorUnits"] === undefined
      ? {}
      : {
          secondCountBaseMinorUnits: projection.value[
            "secondCountBaseMinorUnits"
          ] as number,
        }),
  };
}

export const getAssignedCountTask = queryWithOrg({
  args: { warehouseId: v.id("warehouses"), countTaskId: v.id("countTasks") },
  returns: v.union(
    v.object({ found: v.literal(true), task: taskViewValidator }),
    v.object({ found: v.literal(false) }),
  ),
  permissionCode: "inventory.count.execute",
  target: { table: "countTasks", id: ({ countTaskId }) => countTaskId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const task = await projectedTask(ctx, args.countTaskId, false);
    return task === null
      ? { found: false as const }
      : { found: true as const, task };
  },
});

export const getCountReconciliationEvidence = queryWithOrg({
  args: { warehouseId: v.id("warehouses"), countTaskId: v.id("countTasks") },
  returns: v.union(
    v.object({ found: v.literal(true), task: taskViewValidator }),
    v.object({ found: v.literal(false) }),
  ),
  permissionCode: "inventory.count.reconcile",
  target: { table: "countTasks", id: ({ countTaskId }) => countTaskId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const task = await projectedTask(ctx, args.countTaskId, true);
    return task === null
      ? { found: false as const }
      : { found: true as const, task };
  },
});
