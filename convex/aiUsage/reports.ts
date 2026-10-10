import { v } from "convex/values";
import { mutationWithOrg, queryWithOrg } from "../lib/tenantFunctions";
import type { Doc } from "../_generated/dataModel";
import {
  addMetrics,
  contribution,
  emptyMetrics,
  feature,
  reportRange,
  type Metrics,
} from "../model/aiUsage/usage";

const filters = {
  feature: v.optional(feature),
  actorUserId: v.optional(v.id("users")),
  warehouseId: v.optional(v.id("warehouses")),
  requestedModel: v.optional(v.string()),
  environment: v.optional(v.string()),
};
type Dimensions = Pick<
  Doc<"aiUsageOperations">,
  "feature" | "actorUserId" | "warehouseId" | "requestedModel" | "environment"
>;
function matches(
  row: Dimensions,
  filter: { [K in keyof Dimensions]?: Dimensions[K] | undefined },
) {
  return (Object.keys(filter) as (keyof Dimensions)[]).every(
    (key) => filter[key] === undefined || filter[key] === row[key],
  );
}
export const summary = queryWithOrg({
  args: {
    refreshKey: v.optional(v.number()),
    period: v.optional(v.union(v.literal("month"), v.literal("today"))),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    ...filters,
  },
  permissionCode: "aiUsage.read",
  target: { table: "aiUsageDailySummaries" },
  handler: async (ctx, args) => {
    let range;
    try {
      range = reportRange(
        ctx.tenant.organization.settings.timezone,
        Date.now(),
        args,
      );
    } catch {
      return { error: "DATE_RANGE_OR_TIMEZONE_INVALID" as const };
    }
    const {
      feature: f,
      actorUserId,
      warehouseId,
      requestedModel,
      environment,
    } = args;
    const filter = {
      feature: f,
      actorUserId,
      warehouseId,
      requestedModel,
      environment,
    };
    const byFeature = {
      JOB_TICKET_SCAN: emptyMetrics(),
      AI_SEARCH: emptyMetrics(),
    };
    const breakdown = new Map<string, Dimensions & { metrics: Metrics }>();
    let complete = true,
      rowsRead = 0;
    const models = new Set<string>(),
      environments = new Set<string>();
    const accumulate = (row: Dimensions, metrics: Metrics) => {
      models.add(row.requestedModel);
      environments.add(row.environment);
      if (!matches(row, filter)) return;
      addMetrics(byFeature[row.feature], metrics);
      const key = JSON.stringify([
        row.feature,
        row.actorUserId,
        row.warehouseId ?? "",
        row.requestedModel,
        row.environment,
      ]);
      const existing = breakdown.get(key);
      if (existing) addMetrics(existing.metrics, metrics);
      else
        breakdown.set(key, {
          feature: row.feature,
          actorUserId: row.actorUserId,
          ...(row.warehouseId ? { warehouseId: row.warehouseId } : {}),
          requestedModel: row.requestedModel,
          environment: row.environment,
          metrics: { ...metrics },
        });
    };
    for (const utcDay of range.utcDays) {
      if (rowsRead >= 3000) {
        complete = false;
        break;
      }
      const fullDay =
        utcDay * 86400000 >= range.start &&
        (utcDay + 1) * 86400000 <= range.end;
      try {
        if (fullDay) {
          const rows = await ctx.tenantDb
            .byIndex<Doc<"aiUsageDailySummaries">>(
              "aiUsageDailySummaries",
              "by_orgId_utcDay",
              [{ field: "utcDay", value: utcDay }],
            )
            .all(Math.min(1000, 3000 - rowsRead));
          rowsRead += rows.length;
          for (const row of rows) accumulate(row, row);
        } else {
          const rows = await ctx.tenantDb
            .byIndex<Doc<"aiUsageOperations">>(
              "aiUsageOperations",
              "by_orgId_utcDay_startedAt",
              [{ field: "utcDay", value: utcDay }],
            )
            .all(Math.min(1000, 3000 - rowsRead));
          rowsRead += rows.length;
          for (const row of rows)
            if (row.startedAt >= range.start && row.startedAt < range.end)
              accumulate(row, contribution(row));
        }
      } catch (error) {
        // An explicit partial report is preferable to a silently truncated total.
        if (
          !(error instanceof Error) ||
          !("code" in error) ||
          error.code !== "CAPACITY_DATA_LIMIT"
        )
          throw error;
        complete = false;
      }
    }
    const settings =
      (
        await ctx.tenantDb
          .byIndex<Doc<"aiCostSettings">>("aiCostSettings", "by_orgId_version")
          .take(1, "desc")
      )[0] ?? null;
    const first = (
      await ctx.tenantDb
        .byIndex<Doc<"aiUsageOperations">>(
          "aiUsageOperations",
          "by_orgId_utcDay_startedAt",
        )
        .take(1)
    )[0];
    const users = new Map<string, string>();
    // Member directory exposes only this organization's members; cap UI labels independently.
    for (const entry of (await ctx.members.listActive(200)) ?? [])
      users.set(entry.userId, entry.displayName);
    const warehouses = await ctx.tenantDb
      .byIndex<Doc<"warehouses">>("warehouses", "by_orgId_code")
      .take(100);
    return {
      range,
      complete,
      byFeature,
      models: Array.from(models),
      environments: Array.from(environments),
      breakdown: Array.from(breakdown.values()),
      settings,
      trackingStartedAt: first?.startedAt ?? null,
      users: Array.from(users, ([id, name]) => ({ id, name })),
      warehouses: warehouses.map((w) => ({ id: w._id, name: w.name })),
    };
  },
});

/** One indexed UTC day per cursor: the export never scans the lifetime ledger. */
export const operations = queryWithOrg({
  args: {
    utcDay: v.number(),
    from: v.string(),
    to: v.string(),
    cursor: v.optional(v.string()),
    ...filters,
  },
  permissionCode: "aiUsage.read",
  target: { table: "aiUsageOperations" },
  handler: async (ctx, args) => {
    const range = reportRange(
      ctx.tenant.organization.settings.timezone,
      Date.now(),
      args,
    );
    if (!range.utcDays.includes(args.utcDay))
      throw new Error("DATE_RANGE_INVALID");
    const page = await ctx.tenantDb
      .byIndex<Doc<"aiUsageOperations">>(
        "aiUsageOperations",
        "by_orgId_utcDay_startedAt",
        [{ field: "utcDay", value: args.utcDay }],
      )
      .page({ limit: 100, ...(args.cursor ? { cursor: args.cursor } : {}) });
    const {
      feature: f,
      actorUserId,
      warehouseId,
      requestedModel,
      environment,
    } = args;
    return {
      ...page,
      page: page.page.filter(
        (row) =>
          row.startedAt >= range.start &&
          row.startedAt < range.end &&
          matches(row, {
            feature: f,
            actorUserId,
            warehouseId,
            requestedModel,
            environment,
          }),
      ),
    };
  },
});
export const attempts = queryWithOrg({
  args: { operationId: v.string() },
  permissionCode: "aiUsage.read",
  target: { table: "aiUsageEvents" },
  handler: (ctx, args) =>
    ctx.tenantDb
      .byIndex<Doc<"aiUsageEvents">>(
        "aiUsageEvents",
        "by_orgId_operationId_attemptNo",
        [{ field: "operationId", value: args.operationId }],
      )
      .all(2),
});
export const configure = mutationWithOrg({
  args: { usdThbRate: v.number(), feePercent: v.number(), source: v.string() },
  permissionCode: "aiUsage.configure",
  target: { table: "aiCostSettings" },
  handler: async (ctx, args) => {
    if (
      !Number.isFinite(args.usdThbRate) ||
      args.usdThbRate <= 0 ||
      args.usdThbRate > 1000 ||
      !Number.isFinite(args.feePercent) ||
      args.feePercent < 0 ||
      args.feePercent > 100 ||
      !args.source.trim() ||
      args.source.length > 160
    )
      return { ok: false as const, code: "SETTINGS_INVALID" };
    const last = (
      await ctx.tenantDb
        .byIndex<Doc<"aiCostSettings">>("aiCostSettings", "by_orgId_version")
        .take(1, "desc")
    )[0];
    await ctx.tenantDb.insert("aiCostSettings", {
      ...args,
      source: args.source.trim(),
      version: (last?.version ?? 0) + 1,
      effectiveAt: Date.now(),
      createdByUserId: ctx.tenant.actor._id,
    });
    return { ok: true as const };
  },
});
