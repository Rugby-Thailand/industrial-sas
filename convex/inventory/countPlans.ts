/** Count-plan authoring, snapshot capture, release, and completion (`FF-P2-04`). */
import { v } from "convex/values";

import {
  CODE_FIELD,
  createMasterDataRow,
  normalizeField,
  replayTenantWriteIfPresent,
  updateMasterDataRow,
} from "../lib/masterDataStore";
import type { TenantOrgId } from "../lib/tenantDb";
import { mutationWithOrg, queryWithOrg } from "../lib/tenantFunctions";
import {
  countMovementPolicy,
  countScope,
  countVisibility,
} from "../lib/validators";
import { writeContextOf } from "../lib/writeEnvelope";
import {
  decideCountPlanCompletion,
  decideCountPlanRelease,
  makeCountPlan,
  recordCountPlanProgress,
  type CountPlanState,
} from "../model/counting/countLifecycle";
import { decodeBucketKey } from "../model/inventory/stockIdentity";

export const COUNT_PLAN_OPERATIONS = Object.freeze({
  create: "inventory.count.createPlan",
  release: "inventory.count.releasePlan",
  complete: "inventory.count.completePlan",
});

export const MAX_COUNT_TARGETS_PER_PLAN = 50;

interface CountPlanDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly warehouseId: string;
  readonly planNumber: string;
  readonly status: CountPlanState["status"];
  readonly scope: CountPlanState["scope"];
  readonly visibility: CountPlanState["visibility"];
  readonly movementPolicy: CountPlanState["movementPolicy"];
  readonly freezeExpiresAt?: number;
  readonly quantityThresholdBaseMinorUnits: number;
  readonly valueThresholdMinorUnits: number;
  readonly taskCount: number;
  readonly completedTaskCount: number;
  readonly varianceTaskCount: number;
  readonly createdByUserId: string;
  readonly createdAt: number;
  readonly releasedByUserId?: string;
  readonly releasedAt?: number;
  readonly completedByUserId?: string;
  readonly completedAt?: number;
}

interface CountTaskDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly countPlanId: string;
  readonly taskNumber: number;
  readonly status: string;
}

interface BalanceDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly bucketKey: string;
  readonly warehouseId: string;
  readonly itemId: string;
  readonly locationKind: string;
  readonly locationId?: string;
  readonly lotId?: string;
  readonly stockStatus: string;
  readonly quantity: { readonly uom: string; readonly minorUnits: number };
  readonly lastTransactionId: string;
}

const errorValidator = v.object({
  code: v.string(),
  field: v.optional(v.string()),
  reason: v.optional(v.string()),
  table: v.optional(v.string()),
  status: v.optional(v.string()),
  requestId: v.optional(v.string()),
});

const writeResultValidator = v.union(
  v.object({
    written: v.literal(true),
    documentId: v.string(),
    replayed: v.boolean(),
  }),
  v.object({ written: v.literal(false), error: errorValidator }),
);

const refusal = (error: {
  readonly code: string;
  readonly field?: unknown;
  readonly reason?: unknown;
  readonly table?: unknown;
  readonly status?: unknown;
  readonly requestId?: unknown;
}) => ({
  written: false as const,
  error: {
    code: error.code,
    ...(error.field === undefined ? {} : { field: String(error.field) }),
    ...(error.reason === undefined ? {} : { reason: String(error.reason) }),
    ...(error.table === undefined ? {} : { table: String(error.table) }),
    ...(error.status === undefined ? {} : { status: String(error.status) }),
    ...(error.requestId === undefined
      ? {}
      : { requestId: String(error.requestId) }),
  },
});

const targetArgument = v.object({
  bucketKey: v.string(),
  /** Snapshot copied from the authoritative costing source by the planner. */
  itemClass: v.string(),
  /** Currency minor units per inventory base minor unit. */
  unitValueMinorUnits: v.number(),
});

export const createCountPlan = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    planNumber: v.string(),
    scope: countScope,
    visibility: countVisibility,
    movementPolicy: countMovementPolicy,
    freezeExpiresAt: v.optional(v.number()),
    quantityThresholdBaseMinorUnits: v.number(),
    valueThresholdMinorUnits: v.number(),
    targets: v.array(targetArgument),
  },
  returns: writeResultValidator,
  permissionCode: "inventory.count.plan",
  target: { table: "countPlans" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const planNumber = normalizeField(
      "planNumber",
      args.planNumber,
      CODE_FIELD,
    );
    if (!planNumber.ok) return refusal(planNumber.error);
    if (
      args.targets.length === 0 ||
      args.targets.length > MAX_COUNT_TARGETS_PER_PLAN
    ) {
      return refusal({ code: "TARGET_COUNT_INVALID", field: "targets" });
    }
    const state = makeCountPlan({
      scope: args.scope,
      visibility: args.visibility,
      movementPolicy: args.movementPolicy,
      createdByUserId: ctx.tenant.actor._id,
      taskCount: args.targets.length,
      ...(args.freezeExpiresAt === undefined
        ? {}
        : { freezeExpiresAt: args.freezeExpiresAt }),
    });
    if (!state.ok) return refusal(state.error);
    if (
      !Number.isSafeInteger(args.quantityThresholdBaseMinorUnits) ||
      args.quantityThresholdBaseMinorUnits < 0 ||
      !Number.isSafeInteger(args.valueThresholdMinorUnits) ||
      args.valueThresholdMinorUnits < 0
    ) {
      return refusal({ code: "THRESHOLD_INVALID", field: "threshold" });
    }
    const fingerprint = {
      planNumber: planNumber.value,
      warehouseId: args.warehouseId,
      scope: args.scope,
      visibility: args.visibility,
      movementPolicy: args.movementPolicy,
      freezeExpiresAt: args.freezeExpiresAt,
      quantityThresholdBaseMinorUnits: args.quantityThresholdBaseMinorUnits,
      valueThresholdMinorUnits: args.valueThresholdMinorUnits,
      targets: args.targets,
    };
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "countPlans",
      operation: COUNT_PLAN_OPERATIONS.create,
      requestId: args.requestId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) {
      return {
        written: true as const,
        documentId: replay.value.documentId,
        replayed: true,
      };
    }

    const seen = new Set<string>();
    const targets: {
      readonly balance: BalanceDocument;
      readonly itemClass: string;
      readonly unitValueMinorUnits: number;
    }[] = [];
    for (const target of args.targets) {
      if (seen.has(target.bucketKey)) {
        return refusal({ code: "DUPLICATE_TARGET", field: "bucketKey" });
      }
      seen.add(target.bucketKey);
      const decoded = decodeBucketKey(target.bucketKey);
      if (
        !decoded.ok ||
        decoded.value.orgId !== ctx.tenant.organization._id ||
        decoded.value.warehouseId !== args.warehouseId ||
        decoded.value.location.kind !== "PHYSICAL"
      ) {
        return refusal({ code: "TARGET_INVALID", field: "bucketKey" });
      }
      const balance = await ctx.tenantDb
        .byIndex<BalanceDocument>("inventoryBalances", "by_orgId_bucketKey", [
          { field: "bucketKey", value: target.bucketKey },
        ])
        .unique();
      if (
        balance === null ||
        balance.warehouseId !== args.warehouseId ||
        balance.locationKind !== "PHYSICAL" ||
        balance.locationId === undefined
      ) {
        return refusal({ code: "TARGET_NOT_FOUND", field: "bucketKey" });
      }
      if (
        !/^[A-Z][A-Z0-9_]{0,63}$/.test(target.itemClass) ||
        !Number.isSafeInteger(target.unitValueMinorUnits) ||
        target.unitValueMinorUnits < 0
      ) {
        return refusal({ code: "VALUATION_INVALID", field: "targets" });
      }
      targets.push({
        balance,
        itemClass: target.itemClass,
        unitValueMinorUnits: target.unitValueMinorUnits,
      });
    }

    const now = Date.now();
    const outcome = await createMasterDataRow({
      ...writeContextOf(ctx, {
        table: "countPlans",
        operation: COUNT_PLAN_OPERATIONS.create,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      fingerprint,
      uniqueness: [
        {
          field: "planNumber",
          index: "by_orgId_planNumber",
          equality: [{ field: "planNumber", value: planNumber.value }],
        },
      ],
      document: {
        warehouseId: args.warehouseId,
        planNumber: planNumber.value,
        status: state.value.status,
        scope: state.value.scope,
        visibility: state.value.visibility,
        movementPolicy: state.value.movementPolicy,
        ...(state.value.freezeExpiresAt === undefined
          ? {}
          : { freezeExpiresAt: state.value.freezeExpiresAt }),
        quantityThresholdBaseMinorUnits: args.quantityThresholdBaseMinorUnits,
        valueThresholdMinorUnits: args.valueThresholdMinorUnits,
        taskCount: targets.length,
        completedTaskCount: 0,
        varianceTaskCount: 0,
        createdByUserId: ctx.tenant.actor._id,
        createdAt: now,
      },
    });
    if (!outcome.ok) return refusal(outcome.error);

    for (const [index, target] of targets.entries()) {
      const taskId = await ctx.tenantDb.insert("countTasks", {
        warehouseId: args.warehouseId,
        countPlanId: outcome.value.documentId,
        taskNumber: index + 1,
        locationId: target.balance.locationId!,
        status: "AVAILABLE",
        entryCount: 0,
      });
      await ctx.tenantDb.insert("countSnapshots", {
        warehouseId: args.warehouseId,
        countPlanId: outcome.value.documentId,
        countTaskId: taskId,
        bucketKey: target.balance.bucketKey,
        itemId: target.balance.itemId,
        locationId: target.balance.locationId!,
        ...(target.balance.lotId === undefined
          ? {}
          : { lotId: target.balance.lotId }),
        stockStatus: target.balance.stockStatus,
        baseUom: target.balance.quantity.uom,
        systemBaseMinorUnits: target.balance.quantity.minorUnits,
        inCountMovementBaseMinorUnits: 0,
        itemClass: target.itemClass,
        unitValueMinorUnits: target.unitValueMinorUnits,
        lastLedgerTransactionId: target.balance.lastTransactionId,
        capturedAt: now,
      });
    }
    return {
      written: true as const,
      documentId: outcome.value.documentId,
      replayed: false,
    };
  },
});

function planState(plan: CountPlanDocument): CountPlanState {
  return {
    status: plan.status,
    scope: plan.scope,
    visibility: plan.visibility,
    movementPolicy: plan.movementPolicy,
    createdByUserId: plan.createdByUserId,
    taskCount: plan.taskCount,
    completedTaskCount: plan.completedTaskCount,
    varianceTaskCount: plan.varianceTaskCount,
    ...(plan.freezeExpiresAt === undefined
      ? {}
      : { freezeExpiresAt: plan.freezeExpiresAt }),
    ...(plan.releasedByUserId === undefined
      ? {}
      : { releasedByUserId: plan.releasedByUserId }),
    ...(plan.releasedAt === undefined ? {} : { releasedAt: plan.releasedAt }),
    ...(plan.completedByUserId === undefined
      ? {}
      : { completedByUserId: plan.completedByUserId }),
    ...(plan.completedAt === undefined
      ? {}
      : { completedAt: plan.completedAt }),
  };
}

export const releaseCountPlan = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    countPlanId: v.id("countPlans"),
  },
  returns: writeResultValidator,
  permissionCode: "inventory.count.plan",
  target: { table: "countPlans", id: ({ countPlanId }) => countPlanId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const fingerprint = { countPlanId: args.countPlanId };
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "countPlans",
      operation: COUNT_PLAN_OPERATIONS.release,
      requestId: args.requestId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null)
      return {
        written: true as const,
        documentId: replay.value.documentId,
        replayed: true,
      };
    const plan = await ctx.tenantDb.get<CountPlanDocument>(
      "countPlans",
      args.countPlanId,
    );
    if (plan === null || plan.warehouseId !== args.warehouseId)
      return refusal({ code: "NOT_FOUND", table: "countPlans" });
    const decision = decideCountPlanRelease({
      state: planState(plan),
      actorUserId: ctx.tenant.actor._id,
      now: Date.now(),
    });
    if (!decision.ok) return refusal(decision.error);
    const outcome = await updateMasterDataRow({
      ...writeContextOf(ctx, {
        table: "countPlans",
        operation: COUNT_PLAN_OPERATIONS.release,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      documentId: plan._id,
      fingerprint,
      uniqueness: [],
      patch: {
        status: decision.value.status,
        releasedByUserId: decision.value.releasedByUserId,
        releasedAt: decision.value.releasedAt,
      },
    });
    return outcome.ok
      ? {
          written: true as const,
          documentId: outcome.value.documentId,
          replayed: outcome.value.replayed,
        }
      : refusal(outcome.error);
  },
});

export const completeCountPlan = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    countPlanId: v.id("countPlans"),
  },
  returns: writeResultValidator,
  permissionCode: "inventory.count.plan",
  target: { table: "countPlans", id: ({ countPlanId }) => countPlanId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const fingerprint = { countPlanId: args.countPlanId };
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "countPlans",
      operation: COUNT_PLAN_OPERATIONS.complete,
      requestId: args.requestId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null)
      return {
        written: true as const,
        documentId: replay.value.documentId,
        replayed: true,
      };
    const plan = await ctx.tenantDb.get<CountPlanDocument>(
      "countPlans",
      args.countPlanId,
    );
    if (plan === null || plan.warehouseId !== args.warehouseId)
      return refusal({ code: "NOT_FOUND", table: "countPlans" });
    const tasks = await ctx.tenantDb
      .byIndex<CountTaskDocument>(
        "countTasks",
        "by_orgId_countPlanId_taskNumber",
        [{ field: "countPlanId", value: plan._id }],
      )
      .take(MAX_COUNT_TARGETS_PER_PLAN);
    const completed = tasks.filter(
      (task) => task.status === "RECONCILED",
    ).length;
    const variance = tasks.filter((task) => task.status === "SUBMITTED").length;
    const progress = recordCountPlanProgress({
      state: planState(plan),
      completedTaskCount: completed,
      varianceTaskCount: variance,
    });
    if (!progress.ok) return refusal(progress.error);
    const decision = decideCountPlanCompletion({
      state: progress.value,
      actorUserId: ctx.tenant.actor._id,
      now: Date.now(),
    });
    if (!decision.ok) return refusal(decision.error);
    const outcome = await updateMasterDataRow({
      ...writeContextOf(ctx, {
        table: "countPlans",
        operation: COUNT_PLAN_OPERATIONS.complete,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      documentId: plan._id,
      fingerprint,
      uniqueness: [],
      patch: {
        status: decision.value.status,
        completedTaskCount: decision.value.completedTaskCount,
        varianceTaskCount: decision.value.varianceTaskCount,
        completedByUserId: decision.value.completedByUserId,
        completedAt: decision.value.completedAt,
      },
    });
    return outcome.ok
      ? {
          written: true as const,
          documentId: outcome.value.documentId,
          replayed: outcome.value.replayed,
        }
      : refusal(outcome.error);
  },
});

const planWireValidator = v.object({
  countPlanId: v.id("countPlans"),
  planNumber: v.string(),
  status: v.string(),
  scope: v.string(),
  visibility: v.string(),
  movementPolicy: v.string(),
  freezeExpiresAt: v.optional(v.number()),
  taskCount: v.number(),
  completedTaskCount: v.number(),
  varianceTaskCount: v.number(),
});

export const getCountPlan = queryWithOrg({
  args: { warehouseId: v.id("warehouses"), countPlanId: v.id("countPlans") },
  returns: v.union(
    v.object({ found: v.literal(true), plan: planWireValidator }),
    v.object({ found: v.literal(false) }),
  ),
  permissionCode: "inventory.count.read",
  target: { table: "countPlans", id: ({ countPlanId }) => countPlanId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const plan = await ctx.tenantDb.get<CountPlanDocument>(
      "countPlans",
      args.countPlanId,
    );
    if (plan === null || plan.warehouseId !== args.warehouseId)
      return { found: false as const };
    return {
      found: true as const,
      plan: {
        countPlanId: plan._id as never,
        planNumber: plan.planNumber,
        status: plan.status,
        scope: plan.scope,
        visibility: plan.visibility,
        movementPolicy: plan.movementPolicy,
        ...(plan.freezeExpiresAt === undefined
          ? {}
          : { freezeExpiresAt: plan.freezeExpiresAt }),
        taskCount: plan.taskCount,
        completedTaskCount: plan.completedTaskCount,
        varianceTaskCount: plan.varianceTaskCount,
      },
    };
  },
});
