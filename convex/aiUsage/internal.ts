import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { v } from "convex/values";
import {
  addMetrics,
  contribution,
  emptyMetrics,
  feature,
  finishFields,
  normalizeUsage,
  type Metrics,
} from "../model/aiUsage/usage";

async function updateSummary(
  ctx: MutationCtx,
  before: Doc<"aiUsageOperations"> | null,
  after: Doc<"aiUsageOperations">,
) {
  const {
    orgId,
    utcDay,
    feature,
    environment,
    actorUserId,
    warehouseId,
    requestedModel,
  } = after;
  const summaryKey = JSON.stringify([
    utcDay,
    feature,
    environment,
    actorUserId,
    warehouseId ?? "",
    requestedModel,
  ]);
  const existing = await ctx.db
    .query("aiUsageDailySummaries")
    .withIndex("by_orgId_summaryKey", (q) =>
      q.eq("orgId", orgId).eq("summaryKey", summaryKey),
    )
    .unique();
  const metrics = emptyMetrics();
  if (existing)
    for (const key of Object.keys(metrics) as (keyof Metrics)[])
      metrics[key] = existing[key];
  // Apply the net delta before validating: a reconciliation can subtract an unknown count.
  const old = before ? contribution(before) : emptyMetrics(),
    next = contribution(after);
  const delta = emptyMetrics();
  for (const key of Object.keys(delta) as (keyof Metrics)[])
    delta[key] = next[key] - old[key];
  addMetrics(metrics, delta);
  if (existing)
    await ctx.db.patch("aiUsageDailySummaries", existing._id, metrics);
  else
    await ctx.db.insert("aiUsageDailySummaries", {
      orgId,
      utcDay,
      feature,
      environment,
      actorUserId,
      ...(warehouseId ? { warehouseId } : {}),
      requestedModel,
      summaryKey,
      ...metrics,
    });
}

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
      args.attemptNo > 2 ||
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
      ...normalizeUsage(null),
    });
    let opId = before?._id;
    const fields = {
      ...dimensions,
      startedAt: before?.startedAt ?? startedAt,
      durationMs: 0,
      status: "PENDING" as const,
      attemptCount: args.attemptNo,
      knownCostUsdNano: before?.knownCostUsdNano ?? 0,
      unknownAttemptCount: (before?.unknownAttemptCount ?? 0) + 1,
    };
    if (opId) await ctx.db.patch("aiUsageOperations", opId, fields);
    else opId = await ctx.db.insert("aiUsageOperations", fields);
    const after = (await ctx.db.get("aiUsageOperations", opId))!;
    await updateSummary(ctx, before, after);
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
        (!Number.isFinite(r.costUsd) ||
          r.costUsd < 0 ||
          r.costUsdNano !== Math.round(r.costUsd * 1e9)))
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
    const events = await ctx.db
      .query("aiUsageEvents")
      .withIndex("by_orgId_operationId_attemptNo", (q) =>
        q.eq("orgId", args.orgId).eq("operationId", args.operationId),
      )
      .take(3);
    const last = events[events.length - 1]!;
    const fields = {
      knownCostUsdNano: events.reduce(
        (sum, e) => sum + (e.costUsdNano ?? 0),
        0,
      ),
      unknownAttemptCount: events.filter((e) => e.billingStatus === "UNKNOWN")
        .length,
      status: last.status,
      durationMs: Math.max(
        0,
        (last.finishedAt ?? Date.now()) - before.startedAt,
      ),
    };
    const after = { ...before, ...fields };
    await ctx.db.patch("aiUsageOperations", before._id, fields);
    await updateSummary(ctx, before, after);
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
      durationMs: finishedAt - e.startedAt,
    });
    if (before.attemptCount === e.attemptNo) {
      const after = {
        ...before,
        status: "INTERRUPTED" as const,
        durationMs: finishedAt - before.startedAt,
      };
      await ctx.db.patch("aiUsageOperations", before._id, {
        status: after.status,
        durationMs: after.durationMs,
      });
      await updateSummary(ctx, before, after);
    }
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
    const key = process.env.OPENROUTER_API_KEY?.trim();
    if (!key) return;
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(
        `https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(e.providerGenerationId)}`,
        {
          headers: { Authorization: `Bearer ${key}` },
          signal: controller.signal,
        },
      );
      if (response.ok) {
        const usage = normalizeUsage(
          await response.json(),
          "GENERATION_LOOKUP",
        );
        if (
          usage.billingStatus === "REPORTED" &&
          usage.providerGenerationId === e.providerGenerationId
        ) {
          await ctx.runMutation(internal.aiUsage.internal.finish, {
            orgId: e.orgId,
            operationId: e.operationId,
            attemptNo: e.attemptNo,
            result: { ...usage, status: e.status },
          });
          return;
        }
      }
    } catch {
      /* Coverage remains UNKNOWN, with no sensitive response logging. */
    } finally {
      clearTimeout(timer);
    }
    if (args.retry < 2)
      await ctx.scheduler.runAfter(
        5 * 60_000,
        internal.aiUsage.internal.reconcile,
        { ...args, retry: args.retry + 1 },
      );
  },
});
