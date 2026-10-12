import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { boundedRecordPage } from "../lib/boundedRecordPage";
import {
  queryWithOrg,
  type TenantFunctionContext,
} from "../lib/tenantFunctions";
import { NAVIGATION_PERMISSION } from "../model/authorization/navigationPermissions";

const READ = NAVIGATION_PERMISSION.aiUsage;
/** IDs one label request may resolve: one displayed page of rows. */
export const MAX_LABEL_IDS = 100;

const optionArgs = {
  search: v.optional(v.string()),
  cursor: v.optional(v.union(v.string(), v.null())),
  scanCursor: v.optional(v.string()),
  /** Client retry identity: a new value opens a fresh subscription. Ignored. */
  attempt: v.optional(v.number()),
  pageSize: v.optional(v.number()),
};
const normalize = (value: string) =>
  value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
const pageSizeOf = (size: number | undefined) =>
  [20, 50, 100].includes(size ?? 20) ? (size ?? 20) : null;

/** Display names for one organization's members, read once per request. */
function memberNames(ctx: TenantFunctionContext) {
  const names = new Map<string, Promise<string | null>>();
  return (userId: string) => {
    if (!names.has(userId))
      names.set(
        userId,
        ctx.members.get(userId).then((member) => member?.displayName ?? null),
      );
    return names.get(userId)!;
  };
}

/**
 * Every member of the organization as a usage filter choice, current or
 * former, in cursor pages with case-insensitive name search. Independent of
 * the report's bounded label lookup, so any actor stays discoverable.
 */
export const actorOptions = queryWithOrg({
  args: optionArgs,
  permissionCode: READ,
  target: { table: "aiUsageOperations" },
  handler: async (ctx, args) => {
    const pageSize = pageSizeOf(args.pageSize);
    if (pageSize === null) return null;
    const needle = normalize(args.search ?? "");
    const name = memberNames(ctx);
    return boundedRecordPage(ctx, {
      scope: ["aiUsage.actorOptions", needle],
      pageSize,
      cursor: args.cursor,
      scanCursor: args.scanCursor,
      progressive: true,
      filtering: Boolean(needle),
      read: (range, limit) =>
        ctx.tenantDb
          .byIndex<Doc<"memberships">>("memberships", "by_orgId_userId")
          .page({
            limit,
            ...(range.raw ? { cursor: range.raw } : {}),
            ...(range.end ? { endCursor: range.end } : {}),
          }),
      get: (id) => ctx.tenantDb.get<Doc<"memberships">>("memberships", id),
      accept: async (membership) => {
        const label = await name(membership.userId);
        return label !== null && (!needle || normalize(label).includes(needle));
      },
      hydrate: (memberships) =>
        Promise.all(
          memberships.map(async (membership) => ({
            id: membership.userId,
            name: (await name(membership.userId)) ?? "",
          })),
        ),
    });
  },
});

/** Every warehouse of the organization, in code order, searchable by code or name. */
export const warehouseOptions = queryWithOrg({
  args: optionArgs,
  permissionCode: READ,
  target: { table: "aiUsageOperations" },
  handler: async (ctx, args) => {
    const pageSize = pageSizeOf(args.pageSize);
    if (pageSize === null) return null;
    const needle = normalize(args.search ?? "");
    return boundedRecordPage(ctx, {
      scope: ["aiUsage.warehouseOptions", needle],
      pageSize,
      cursor: args.cursor,
      scanCursor: args.scanCursor,
      progressive: true,
      filtering: Boolean(needle),
      read: (range, limit) =>
        ctx.tenantDb
          .byIndex<Doc<"warehouses">>("warehouses", "by_orgId_code")
          .page({
            limit,
            ...(range.raw ? { cursor: range.raw } : {}),
            ...(range.end ? { endCursor: range.end } : {}),
          }),
      get: (id) => ctx.tenantDb.get<Doc<"warehouses">>("warehouses", id),
      accept: (warehouse) =>
        !needle ||
        normalize(warehouse.code).includes(needle) ||
        normalize(warehouse.name).includes(needle),
      hydrate: async (warehouses) =>
        warehouses.map((warehouse) => ({
          id: warehouse._id,
          name: warehouse.name,
          code: warehouse.code,
        })),
    });
  },
});

/**
 * Names for the actor and warehouse IDs one displayed page needs: a selected
 * filter or a page of breakdown rows. Unknown or foreign IDs are omitted.
 */
export const labels = queryWithOrg({
  args: {
    actorIds: v.array(v.string()),
    warehouseIds: v.array(v.string()),
  },
  permissionCode: READ,
  target: { table: "aiUsageOperations" },
  handler: async (ctx, args) => {
    if (
      args.actorIds.length > MAX_LABEL_IDS ||
      args.warehouseIds.length > MAX_LABEL_IDS
    )
      return { error: "TOO_MANY_LABELS" as const };
    const name = memberNames(ctx);
    const users: { id: string; name: string }[] = [];
    for (const id of new Set(args.actorIds)) {
      const label = await name(id);
      if (label !== null) users.push({ id, name: label });
    }
    const warehouses: { id: string; name: string }[] = [];
    for (const id of new Set(args.warehouseIds)) {
      const warehouse = await ctx.tenantDb.get<Doc<"warehouses">>(
        "warehouses",
        id,
      );
      if (warehouse) warehouses.push({ id, name: warehouse.name });
    }
    return { users, warehouses };
  },
});
