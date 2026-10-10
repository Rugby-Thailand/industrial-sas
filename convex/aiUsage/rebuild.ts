import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import {
  addMetrics,
  contribution,
  EMPTY_METRICS,
  projectOperation,
  summaryKey,
} from "../model/aiUsage/metrics";
import { MAX_ATTEMPTS } from "../model/aiUsage/usage";
import { unwrap } from "./projection";

const MAX_OPERATIONS = 1000;
type Summary = Omit<Doc<"aiUsageDailySummaries">, "_id" | "_creationTime">;

/** Trusted operator command. A dry run is the default; applying is one atomic transaction. */
export const day = internalMutation({
  args: {
    orgId: v.id("organizations"),
    utcDate: v.string(),
    apply: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const timestamp = Date.parse(`${args.utcDate}T00:00:00Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(args.utcDate) ||
      !Number.isFinite(timestamp) ||
      new Date(timestamp).toISOString().slice(0, 10) !== args.utcDate
    )
      throw new Error("AI_USAGE_INVALID_DATE");
    if (!(await ctx.db.get("organizations", args.orgId)))
      throw new Error("NOT_FOUND");
    const utcDay = Math.floor(timestamp / 86400000);
    const [dayEvents, projections, storedSummaries] = await Promise.all([
      ctx.db
        .query("aiUsageEvents")
        .withIndex("by_orgId_utcDay_startedAt", (q) =>
          q.eq("orgId", args.orgId).eq("utcDay", utcDay),
        )
        .take(MAX_OPERATIONS * 2 + 1),
      ctx.db
        .query("aiUsageOperations")
        .withIndex("by_orgId_utcDay_startedAt", (q) =>
          q.eq("orgId", args.orgId).eq("utcDay", utcDay),
        )
        .take(MAX_OPERATIONS + 1),
      ctx.db
        .query("aiUsageDailySummaries")
        .withIndex("by_orgId_utcDay", (q) =>
          q.eq("orgId", args.orgId).eq("utcDay", utcDay),
        )
        .take(MAX_OPERATIONS + 1),
    ]);
    const starts = dayEvents.filter((event) => event.attemptNo === 1);
    if (
      dayEvents.length > MAX_OPERATIONS * 2 ||
      starts.length > MAX_OPERATIONS ||
      projections.length > MAX_OPERATIONS ||
      storedSummaries.length > MAX_OPERATIONS
    )
      throw new Error("AI_USAGE_REBUILD_CAPACITY");
    const byOperation = new Map(starts.map((e) => [e.operationId, e]));
    if (
      byOperation.size !== starts.length ||
      projections.some((op) => !byOperation.has(op.operationId))
    )
      throw new Error("AI_USAGE_LEDGER_INVALID");
    const storedOps = new Map(projections.map((op) => [op.operationId, op]));
    const summaries = new Map<string, Summary>();
    const projected: {
      before: Doc<"aiUsageOperations"> | undefined;
      fields: Omit<
        Doc<"aiUsageOperations">,
        "_id" | "_creationTime" | "jobScanId"
      >;
    }[] = [];
    let operationDriftCount = 0;
    for (const first of starts) {
      // Fetch by operation, so a retry crossing UTC midnight remains in its original day.
      const events = await ctx.db
        .query("aiUsageEvents")
        .withIndex("by_orgId_operationId_attemptNo", (q) =>
          q.eq("orgId", args.orgId).eq("operationId", first.operationId),
        )
        .take(MAX_ATTEMPTS + 1);
      if (
        events.some(
          (event) =>
            event.actorUserId !== first.actorUserId ||
            event.warehouseId !== first.warehouseId ||
            event.feature !== first.feature ||
            event.environment !== first.environment ||
            event.requestedModel !== first.requestedModel,
        )
      )
        throw new Error("AI_USAGE_LEDGER_INVALID");
      // The live lifecycle derives projections through the same function.
      const projection = unwrap(projectOperation(events));
      const fields = {
        orgId: args.orgId,
        operationId: first.operationId,
        actorUserId: first.actorUserId,
        ...(first.warehouseId ? { warehouseId: first.warehouseId } : {}),
        feature: first.feature,
        environment: first.environment,
        requestedModel: first.requestedModel,
        utcDay,
        ...projection,
      };
      const before = storedOps.get(first.operationId);
      if (
        !before ||
        Object.entries(fields).some(
          ([key, value]) => before[key as keyof typeof fields] !== value,
        ) ||
        before.warehouseId !== first.warehouseId
      )
        operationDriftCount += 1;
      projected.push({ before, fields });
      const key = unwrap(summaryKey(fields));
      const summary: Summary = summaries.get(key) ?? {
        orgId: args.orgId,
        utcDay,
        feature: fields.feature,
        environment: fields.environment,
        actorUserId: fields.actorUserId,
        ...(fields.warehouseId ? { warehouseId: fields.warehouseId } : {}),
        requestedModel: fields.requestedModel,
        summaryKey: key,
        ...EMPTY_METRICS,
      };
      const metrics = unwrap(
        addMetrics(summary, unwrap(contribution(projection))),
      );
      summaries.set(key, { ...summary, ...metrics });
    }
    const storedByKey = new Map(storedSummaries.map((s) => [s.summaryKey, s]));
    let summaryDriftCount = storedSummaries.filter(
      (s) => !summaries.has(s.summaryKey),
    ).length;
    for (const [key, summary] of summaries) {
      const stored = storedByKey.get(key);
      if (
        !stored ||
        Object.entries(summary).some(
          ([field, value]) => stored[field as keyof Summary] !== value,
        ) ||
        stored.warehouseId !== summary.warehouseId
      )
        summaryDriftCount += 1;
    }
    if (args.apply) {
      for (const { before, fields } of projected) {
        if (before)
          await ctx.db.patch("aiUsageOperations", before._id, {
            ...fields,
            warehouseId: fields.warehouseId,
          });
        else await ctx.db.insert("aiUsageOperations", fields);
      }
      for (const summary of storedSummaries)
        await ctx.db.delete("aiUsageDailySummaries", summary._id);
      for (const summary of summaries.values())
        await ctx.db.insert("aiUsageDailySummaries", summary);
    }
    return {
      utcDate: args.utcDate,
      operationCount: projected.length,
      summaryCount: summaries.size,
      operationDriftCount,
      summaryDriftCount,
      applied: args.apply === true,
    };
  },
});
