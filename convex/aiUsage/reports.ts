import { v } from "convex/values";
import { grantedPermissionsAmong } from "../lib/navigationGrants";
import {
  mutationWithOrg,
  queryWithOrg,
  type TenantFunctionContext,
} from "../lib/tenantFunctions";
import type { Doc } from "../_generated/dataModel";
import { NAVIGATION_PERMISSION } from "../model/authorization/navigationPermissions";
import {
  addMetrics,
  contribution,
  EMPTY_METRICS,
  reportRange,
  type Metrics,
  type ReportRange,
} from "../model/aiUsage/metrics";
import { FEATURES, MAX_ATTEMPTS, type Feature } from "../model/aiUsage/usage";
import { feature } from "./validators";

const READ = NAVIGATION_PERMISSION.aiUsage;
const CONFIGURE = NAVIGATION_PERMISSION.aiUsageConfigure;
/** Report label lookups are bounded independently of the rows read. */
const MAX_ACTOR_LABELS = 200;
const MAX_WAREHOUSE_LABELS = 100;

const filters = {
  feature: v.optional(feature),
  actorUserId: v.optional(v.id("users")),
  warehouseId: v.optional(v.id("warehouses")),
  requestedModel: v.optional(v.string()),
  environment: v.optional(v.string()),
};
const rangeArgs = {
  period: v.optional(v.union(v.literal("month"), v.literal("today"))),
  from: v.optional(v.string()),
  to: v.optional(v.string()),
};
type Dimensions = Pick<
  Doc<"aiUsageOperations">,
  "feature" | "actorUserId" | "warehouseId" | "requestedModel" | "environment"
>;
type Filter = { [K in keyof Dimensions]?: Dimensions[K] | undefined };
function matches(row: Dimensions, filter: Filter) {
  return (Object.keys(filter) as (keyof Dimensions)[]).every(
    (key) => filter[key] === undefined || filter[key] === row[key],
  );
}
const filterOf = (args: Filter): Filter => ({
  feature: args.feature,
  actorUserId: args.actorUserId,
  warehouseId: args.warehouseId,
  requestedModel: args.requestedModel,
  environment: args.environment,
});
const rangeOf = (
  ctx: TenantFunctionContext,
  args: {
    readonly period?: "month" | "today" | undefined;
    readonly from?: string | undefined;
    readonly to?: string | undefined;
  },
) =>
  reportRange(ctx.tenant.organization.settings.timezone, Date.now(), {
    ...(args.period === undefined ? {} : { period: args.period }),
    ...(args.from === undefined ? {} : { from: args.from }),
    ...(args.to === undefined ? {} : { to: args.to }),
  });

/** Display names of the actors and warehouses that appear in usage rows only. */
async function dimensionLabels(
  ctx: TenantFunctionContext,
  actorIds: Iterable<string>,
  warehouseIds: Iterable<string>,
) {
  const users: { id: string; name: string }[] = [];
  for (const id of [...new Set(actorIds)].slice(0, MAX_ACTOR_LABELS)) {
    const member = await ctx.members.get(id);
    if (member) users.push({ id, name: member.displayName });
  }
  const warehouses: { id: string; name: string }[] = [];
  for (const id of [...new Set(warehouseIds)].slice(0, MAX_WAREHOUSE_LABELS)) {
    const warehouse = await ctx.tenantDb.get<Doc<"warehouses">>(
      "warehouses",
      id,
    );
    if (warehouse) warehouses.push({ id, name: warehouse.name });
  }
  return { users, warehouses };
}

/**
 * What the AI usage report may show this member. Organization-scoped and
 * independent of warehouse access, so a usage-only role can reach the page.
 * Display only: every report function authorizes itself.
 */
export const access = queryWithOrg({
  args: {},
  permissionCode: READ,
  target: { table: "aiCostSettings" },
  handler: async (ctx) => ({
    permissions: await grantedPermissionsAmong(ctx, [READ, CONFIGURE]),
    organizationName: ctx.tenant.organization.name,
    timezone: ctx.tenant.organization.settings.timezone,
  }),
});

export const summary = queryWithOrg({
  args: {
    refreshKey: v.optional(v.number()),
    ...rangeArgs,
    ...filters,
  },
  permissionCode: READ,
  target: { table: "aiUsageDailySummaries" },
  handler: async (ctx, args) => {
    const ranged = rangeOf(ctx, args);
    if (!ranged.ok) return { error: "DATE_RANGE_OR_TIMEZONE_INVALID" as const };
    const range = ranged.value;
    const filter = filterOf(args);
    let byFeature = Object.fromEntries(
      FEATURES.map((kind) => [kind, EMPTY_METRICS]),
    ) as Record<Feature, Metrics>;
    const breakdown = new Map<string, Dimensions & { metrics: Metrics }>();
    let complete = true,
      invalid = false,
      rowsRead = 0;
    const models = new Set<string>(),
      environments = new Set<string>(),
      actorIds = new Set<string>(),
      warehouseIds = new Set<string>();
    const accumulate = (row: Dimensions, metrics: unknown) => {
      models.add(row.requestedModel);
      environments.add(row.environment);
      actorIds.add(row.actorUserId);
      if (row.warehouseId) warehouseIds.add(row.warehouseId);
      if (!matches(row, filter)) return;
      const total = addMetrics(byFeature[row.feature], metrics);
      const key = JSON.stringify([
        row.feature,
        row.actorUserId,
        row.warehouseId ?? "",
        row.requestedModel,
        row.environment,
      ]);
      const existing = breakdown.get(key);
      const grouped = addMetrics(existing?.metrics ?? EMPTY_METRICS, metrics);
      if (!total.ok || !grouped.ok) {
        invalid = true;
        return;
      }
      byFeature = { ...byFeature, [row.feature]: total.value };
      breakdown.set(key, {
        feature: row.feature,
        actorUserId: row.actorUserId,
        ...(row.warehouseId ? { warehouseId: row.warehouseId } : {}),
        requestedModel: row.requestedModel,
        environment: row.environment,
        metrics: grouped.value,
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
            if (row.startedAt >= range.start && row.startedAt < range.end) {
              const metrics = contribution(row);
              if (metrics.ok) accumulate(row, metrics.value);
              else invalid = true;
            }
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
    // A malformed stored aggregate is refused, never shown as a smaller total.
    if (invalid) return { error: "AI_USAGE_AGGREGATE_INVALID" as const };
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
    const labels = await dimensionLabels(ctx, actorIds, warehouseIds);
    return {
      range,
      complete,
      byFeature,
      models: Array.from(models),
      environments: Array.from(environments),
      breakdown: Array.from(breakdown.values()),
      settings,
      trackingStartedAt: first?.startedAt ?? null,
      users: labels.users,
      warehouses: labels.warehouses,
    };
  },
});

/** Operations shown per request, and index rows one request may read. */
export const RECENT_PAGE_SIZE = 25;
export const RECENT_SCAN_LIMIT = 99;

type RecentCursor = { readonly day: number; readonly cursor: string | null };
function readRecentCursor(
  raw: string | undefined,
  range: ReportRange,
): RecentCursor | null | undefined {
  const lastDay = range.utcDays[range.utcDays.length - 1]!;
  if (raw === undefined) return { day: lastDay, cursor: null };
  if (raw.length > 4200) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !range.utcDays.includes(value[0]) ||
    (value[1] !== null && (typeof value[1] !== "string" || !value[1]))
  )
    return undefined;
  return { day: value[0] as number, cursor: value[1] as string | null };
}

/**
 * Recent operations of the selected range and filters, newest first. Each
 * request walks the UTC-day index backwards from its cursor and reads at most
 * RECENT_SCAN_LIMIT rows (plus one probe row), so a sparse filter may answer
 * a short page with a cursor to continue; it never scans the lifetime ledger.
 */
export const recent = queryWithOrg({
  args: {
    refreshKey: v.optional(v.number()),
    ...rangeArgs,
    ...filters,
    cursor: v.optional(v.string()),
  },
  permissionCode: READ,
  target: { table: "aiUsageOperations" },
  handler: async (ctx, args) => {
    const ranged = rangeOf(ctx, args);
    if (!ranged.ok) return { error: "DATE_RANGE_OR_TIMEZONE_INVALID" as const };
    const range = ranged.value;
    const position = readRecentCursor(args.cursor, range);
    if (!position) return { error: "CURSOR_INVALID" as const };
    const filter = filterOf(args);
    const rows: Doc<"aiUsageOperations">[] = [];
    const collect = (page: readonly Doc<"aiUsageOperations">[]) => {
      for (const row of page)
        if (
          row.startedAt >= range.start &&
          row.startedAt < range.end &&
          matches(row, filter)
        )
          rows.push(row);
    };
    const dayReader = (day: number) =>
      ctx.tenantDb.byIndex<Doc<"aiUsageOperations">>(
        "aiUsageOperations",
        "by_orgId_utcDay_startedAt",
        [{ field: "utcDay", value: day }],
      );
    const previous = (day: number): RecentCursor | null => {
      const index = range.utcDays.indexOf(day);
      return index > 0
        ? { day: range.utcDays[index - 1]!, cursor: null }
        : null;
    };
    // Convex allows one paginated read per query. The first day of a request
    // is paginated from its cursor; later days are read whole with a bounded
    // `take` only when they fit the remaining scan budget, else the next
    // request starts there.
    let next: RecentCursor | null = position,
      scanned = 0,
      paginated = false;
    // Unfiltered, every row matches: read only what the page still needs.
    const filtered = Object.values(filter).some((value) => value !== undefined);
    while (
      next &&
      rows.length < RECENT_PAGE_SIZE &&
      scanned < RECENT_SCAN_LIMIT
    ) {
      const room = Math.min(
        RECENT_SCAN_LIMIT - scanned,
        filtered ? RECENT_SCAN_LIMIT : RECENT_PAGE_SIZE - rows.length,
      );
      const { day, cursor }: RecentCursor = next;
      if (!paginated) {
        paginated = true;
        const page = await dayReader(day).page({
          limit: room,
          order: "desc",
          ...(cursor ? { cursor } : {}),
        });
        scanned += page.page.length;
        collect(page.page);
        if (!page.isDone && page.continueCursor) {
          next = { day, cursor: page.continueCursor };
          break;
        }
      } else {
        const whole = await dayReader(day).take(room + 1, "desc");
        if (whole.length > room) break;
        scanned += whole.length;
        collect(whole);
      }
      next = previous(day);
    }
    const labels = await dimensionLabels(
      ctx,
      rows.map((row) => row.actorUserId),
      rows.flatMap((row) => (row.warehouseId ? [row.warehouseId] : [])),
    );
    const items = [];
    for (const row of rows) {
      const attempts = await ctx.tenantDb
        .byIndex<Doc<"aiUsageEvents">>(
          "aiUsageEvents",
          "by_orgId_operationId_attemptNo",
          [{ field: "operationId", value: row.operationId }],
        )
        .all(MAX_ATTEMPTS);
      items.push({
        operationId: row.operationId,
        startedAt: row.startedAt,
        feature: row.feature,
        environment: row.environment,
        actorUserId: row.actorUserId,
        actorName:
          labels.users.find((user) => user.id === row.actorUserId)?.name ??
          null,
        warehouseId: row.warehouseId ?? null,
        warehouseName:
          labels.warehouses.find((w) => w.id === row.warehouseId)?.name ?? null,
        requestedModel: row.requestedModel,
        actualModels: [
          ...new Set(attempts.flatMap((a) => a.actualModel ?? [])),
        ],
        status: row.status,
        attemptCount: row.attemptCount,
        knownCostUsdNano: row.knownCostUsdNano,
        unknownAttemptCount: row.unknownAttemptCount,
        durationMs: row.durationMs,
      });
    }
    return {
      timezone: range.timezone,
      items,
      continueCursor: next ? JSON.stringify([next.day, next.cursor]) : null,
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
  permissionCode: READ,
  target: { table: "aiUsageOperations" },
  handler: async (ctx, args) => {
    const ranged = rangeOf(ctx, args);
    if (!ranged.ok || !ranged.value.utcDays.includes(args.utcDay))
      throw new Error("DATE_RANGE_INVALID");
    const range = ranged.value;
    const page = await ctx.tenantDb
      .byIndex<Doc<"aiUsageOperations">>(
        "aiUsageOperations",
        "by_orgId_utcDay_startedAt",
        [{ field: "utcDay", value: args.utcDay }],
      )
      .page({ limit: 100, ...(args.cursor ? { cursor: args.cursor } : {}) });
    const filter = filterOf(args);
    return {
      ...page,
      page: page.page.filter(
        (row) =>
          row.startedAt >= range.start &&
          row.startedAt < range.end &&
          matches(row, filter),
      ),
    };
  },
});
export const attempts = queryWithOrg({
  args: { operationId: v.string() },
  permissionCode: READ,
  target: { table: "aiUsageEvents" },
  handler: (ctx, args) =>
    ctx.tenantDb
      .byIndex<Doc<"aiUsageEvents">>(
        "aiUsageEvents",
        "by_orgId_operationId_attemptNo",
        [{ field: "operationId", value: args.operationId }],
      )
      .all(MAX_ATTEMPTS),
});
export const configure = mutationWithOrg({
  args: { usdThbRate: v.number(), feePercent: v.number(), source: v.string() },
  permissionCode: CONFIGURE,
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
