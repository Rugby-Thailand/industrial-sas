import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { v } from "convex/values";
import { projectOperation } from "../model/aiUsage/metrics";
import { MAX_ATTEMPTS, UNKNOWN_USAGE } from "../model/aiUsage/usage";
import { providerCostToNano } from "../lib/providerUsage";
import { lookupGeneration } from "./generation";
import {
  applySummaryDelta,
  operationAttempts,
  refreshOperation,
  unwrap,
} from "./projection";
import { feature, finishFields } from "./validators";

export const begin = internalMutation({
  args: {
    orgId: v.id("organizations"),
    actorUserId: v.id("users"),
    warehouseId: v.optional(v.id("warehouses")),
    operationId: v.string(),
    feature,
    requestedModel: v.string(),
    attemptNo: v.number(),
  },
  handler: async (ctx, args) => {
    if (
      !Number.isSafeInteger(args.attemptNo) ||
      args.attemptNo < 1 ||
      args.attemptNo > MAX_ATTEMPTS ||
      args.operationId.length > 160 ||
      !/^[\w./:-]{1,160}$/.test(args.requestedModel)
    )
      throw new Error("AI_USAGE_INVALID");
    const existing = await ctx.db
      .query("aiUsageEvents")
      .withIndex("by_orgId_operationId_attemptNo", (q) =>
        q
          .eq("orgId", args.orgId)
          .eq("operationId", args.operationId)
          .eq("attemptNo", args.attemptNo),
      )
      .unique();
    if (existing) throw new Error("AI_ATTEMPT_ALREADY_STARTED");
    const before = await ctx.db
      .query("aiUsageOperations")
      .withIndex("by_orgId_operationId", (q) =>
        q.eq("orgId", args.orgId).eq("operationId", args.operationId),
      )
      .unique();
    if (
      before &&
      (before.actorUserId !== args.actorUserId ||
        before.warehouseId !== args.warehouseId ||
        before.feature !== args.feature ||
        before.requestedModel !== args.requestedModel ||
        before.attemptCount !== args.attemptNo - 1 ||
        before.status === "PENDING")
    )
      throw new Error("AI_USAGE_INVALID");
    if (!before && args.attemptNo !== 1) throw new Error("AI_USAGE_INVALID");
    if (args.warehouseId) {
      const warehouse = await ctx.db.get("warehouses", args.warehouseId);
      if (!warehouse || warehouse.orgId !== args.orgId)
        throw new Error("AI_USAGE_INVALID");
    }
    const startedAt = Date.now(),
      utcDay = Math.floor(startedAt / 86400000);
    const environment =
      process.env.AI_USAGE_ENVIRONMENT?.trim() ||
      (process.env.CONVEX_CLOUD_URL?.includes("127.0.0.1")
        ? "local"
        : "unspecified");
    if (!/^[\w-]{1,40}$/.test(environment))
      throw new Error("AI_USAGE_ENVIRONMENT_INVALID");
    const dimensions = {
      orgId: args.orgId,
      actorUserId: args.actorUserId,
      ...(args.warehouseId ? { warehouseId: args.warehouseId } : {}),
      operationId: args.operationId,
      feature: args.feature,
      requestedModel: args.requestedModel,
      environment: before?.environment ?? environment,
      utcDay: before?.utcDay ?? utcDay,
    };
    const eventId = await ctx.db.insert("aiUsageEvents", {
      ...dimensions,
      utcDay,
      attemptNo: args.attemptNo,
      provider: "OPENROUTER",
      billingAccountRef:
        process.env.AI_USAGE_BILLING_ACCOUNT_REF?.trim().slice(0, 80) ||
        "default",
      startedAt,
      durationMs: 0,
      status: "PENDING",
      ...UNKNOWN_USAGE,
    });
    if (before) await refreshOperation(ctx, before);
    else {
      const projection = unwrap(
        projectOperation(
          await operationAttempts(ctx, args.orgId, args.operationId),
        ),
      );
      const fields = { ...dimensions, ...projection };
      await ctx.db.insert("aiUsageOperations", fields);
      await applySummaryDelta(ctx, null, fields);
    }
    await ctx.scheduler.runAfter(
      15 * 60_000,
      internal.aiUsage.internal.expire,
      { eventId },
    );
    return eventId;
  },
});

export const finish = internalMutation({
  args: {
    orgId: v.id("organizations"),
    operationId: v.string(),
    attemptNo: v.number(),
    result: v.object(finishFields),
  },
  handler: async (ctx, args) => {
    const event = await ctx.db
      .query("aiUsageEvents")
      .withIndex("by_orgId_operationId_attemptNo", (q) =>
        q
          .eq("orgId", args.orgId)
          .eq("operationId", args.operationId)
          .eq("attemptNo", args.attemptNo),
      )
      .unique();
    if (!event || args.result.status === "PENDING")
      throw new Error("AI_USAGE_INVALID");
    const reconcile = args.result.usageSource === "GENERATION_LOOKUP";
    if (
      event.status !== "PENDING" &&
      (!reconcile || event.billingStatus === "REPORTED")
    )
      return;
    const r = args.result;
    if (
      (r.billingStatus === "REPORTED") !==
        (r.costUsd !== undefined && r.costUsdNano !== undefined) ||
      (r.costUsd !== undefined &&
        (providerCostToNano(r.costUsd) === undefined ||
          r.costUsdNano !== providerCostToNano(r.costUsd)))
    )
      throw new Error("AI_USAGE_INVALID");
    for (const n of [
      r.costUsdNano,
      r.inputUnitCount,
      r.outputUnitCount,
      r.totalUnitCount,
      r.reasoningUnitCount,
      r.cachedInputUnitCount,
      r.cacheWriteUnitCount,
    ])
      if (n !== undefined && (!Number.isSafeInteger(n) || n < 0))
        throw new Error("AI_USAGE_INVALID");
    if (r.providerGenerationId) {
      const duplicate = await ctx.db
        .query("aiUsageEvents")
        .withIndex("by_orgId_providerGenerationId", (q) =>
          q
            .eq("orgId", args.orgId)
            .eq("providerGenerationId", r.providerGenerationId),
        )
        .unique();
      if (duplicate && duplicate._id !== event._id)
        throw new Error("AI_USAGE_GENERATION_DUPLICATE");
      if (reconcile && event.providerGenerationId !== r.providerGenerationId)
        throw new Error("AI_USAGE_INVALID");
    }
    const finishedAt = event.finishedAt ?? Date.now();
    await ctx.db.patch("aiUsageEvents", event._id, {
      ...r,
      errorCode:
        (reconcile ? event.status : r.status) === "SUCCEEDED"
          ? undefined
          : reconcile
            ? event.status
            : r.status,
      status: reconcile ? event.status : r.status,
      finishedAt,
      durationMs: Math.max(0, finishedAt - event.startedAt),
    });
    const before = await ctx.db
      .query("aiUsageOperations")
      .withIndex("by_orgId_operationId", (q) =>
        q.eq("orgId", args.orgId).eq("operationId", args.operationId),
      )
      .unique();
    if (!before) throw new Error("AI_USAGE_INVALID");
    await refreshOperation(ctx, before);
    if (!reconcile && r.billingStatus === "UNKNOWN" && r.providerGenerationId)
      await ctx.scheduler.runAfter(
        60_000,
        internal.aiUsage.internal.reconcile,
        { eventId: event._id, retry: 0 },
      );
  },
});

export const eventById = internalQuery({
  args: { eventId: v.id("aiUsageEvents") },
  handler: (ctx, args) => ctx.db.get("aiUsageEvents", args.eventId),
});
export const expire = internalMutation({
  args: { eventId: v.id("aiUsageEvents") },
  handler: async (ctx, args) => {
    const e = await ctx.db.get("aiUsageEvents", args.eventId);
    if (!e || e.status !== "PENDING") return;
    // One transaction expires the event and replaces its summary contribution.
    const before = await ctx.db
      .query("aiUsageOperations")
      .withIndex("by_orgId_operationId", (q) =>
        q.eq("orgId", e.orgId).eq("operationId", e.operationId),
      )
      .unique();
    if (!before) return;
    const finishedAt = Date.now();
    await ctx.db.patch("aiUsageEvents", e._id, {
      status: "INTERRUPTED",
      errorCode: "INTERRUPTED",
      finishedAt,
      durationMs: Math.max(0, finishedAt - e.startedAt),
    });
    await refreshOperation(ctx, before);
  },
});

/**
 * Close an attempt that began but never sent a provider request (the total
 * deadline passed during the durable begin). No request means no provider
 * attempt: the pending row is removed and the projection re-derived. Only the
 * newest, still-pending attempt of an unlinked operation can be abandoned;
 * repeating the call is a no-op.
 */
export const abandon = internalMutation({
  args: {
    orgId: v.id("organizations"),
    operationId: v.string(),
    attemptNo: v.number(),
  },
  handler: async (ctx, args) => {
    const attempts = await operationAttempts(ctx, args.orgId, args.operationId);
    const event = attempts.find((e) => e.attemptNo === args.attemptNo);
    if (!event) return null;
    if (
      event.status !== "PENDING" ||
      attempts[attempts.length - 1]!._id !== event._id
    )
      throw new Error("AI_USAGE_INVALID");
    const before = await ctx.db
      .query("aiUsageOperations")
      .withIndex("by_orgId_operationId", (q) =>
        q.eq("orgId", args.orgId).eq("operationId", args.operationId),
      )
      .unique();
    if (!before || (attempts.length === 1 && before.jobScanId))
      throw new Error("AI_USAGE_INVALID");
    await ctx.db.delete("aiUsageEvents", event._id);
    await refreshOperation(ctx, before);
    return null;
  },
});

/** Retry metadata lookup only; never replay the billable inference request. */
export const reconcile = internalAction({
  args: { eventId: v.id("aiUsageEvents"), retry: v.number() },
  handler: async (ctx, args) => {
    const e: Doc<"aiUsageEvents"> | null = await ctx.runQuery(
      internal.aiUsage.internal.eventById,
      { eventId: args.eventId },
    );
    if (
      !e ||
      e.billingStatus === "REPORTED" ||
      !e.providerGenerationId ||
      args.retry > 2
    )
      return;
    const usage = await lookupGeneration(e.providerGenerationId);
    if (usage.kind === "UNCONFIGURED") return;
    if (usage.kind === "REPORTED") {
      await ctx.runMutation(internal.aiUsage.internal.finish, {
        orgId: e.orgId,
        operationId: e.operationId,
        attemptNo: e.attemptNo,
        result: { ...usage.usage, status: e.status },
      });
      return;
    }
    if (args.retry < 2)
      await ctx.scheduler.runAfter(
        5 * 60_000,
        internal.aiUsage.internal.reconcile,
        { ...args, retry: args.retry + 1 },
      );
  },
});
