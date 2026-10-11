/** Durable employee notifications. Read status is distinct from formal acknowledgment. */
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import {
  TenantDbError,
  type TenantIndexReader,
  type TenantOwnedDocument,
} from "../lib/tenantDb";
import { HR_PERMISSION } from "../lib/permissions";
import {
  mutationWithOrg,
  queryWithOrg,
  type TenantFunctionContext,
} from "../lib/tenantFunctions";
import { fail, hrCommand, linkedEmployee } from "./shared";

type Notification = Doc<"hrNotifications">;
/** Complete bounded reads use take internally, avoiding a second reactive paginate call. */
export async function completeRows500<T extends TenantOwnedDocument>(
  reader: TenantIndexReader<T>,
): Promise<readonly T[] | null> {
  try {
    return await reader.all(500);
  } catch (error) {
    if (error instanceof TenantDbError && error.code === "CAPACITY_DATA_LIMIT")
      return null;
    throw error;
  }
}
export async function deliverNotification(
  ctx: TenantFunctionContext,
  input: {
    employeeId: Id<"hrEmployees">;
    event: Notification["event"];
    title: string;
    eventKey: string;
    resourceId?: string;
    announcementId?: Id<"hrAnnouncements">;
  },
) {
  const existing = await ctx.tenantDb
    .byIndex<Notification>("hrNotifications", "by_orgId_employeeId_eventKey", [
      { field: "employeeId", value: input.employeeId },
      { field: "eventKey", value: input.eventKey },
    ])
    .unique();
  if (existing) return existing._id;
  return await ctx.tenantDb.insert("hrNotifications", {
    ...input,
    unread: true,
    createdAt: Date.now(),
  });
}
export const list = queryWithOrg({
  args: {
    cursor: v.optional(v.string()),
    limit: v.optional(v.number()),
    unreadOnly: v.optional(v.boolean()),
  },
  returns: v.any(),
  permissionCode: HR_PERMISSION.selfAccess,
  target: { table: "hrNotifications" },
  handler: async (ctx, args) => {
    const employee = await linkedEmployee(ctx);
    if (!employee) return { ok: false as const, code: "HR_NOT_LINKED" };
    const index = args.unreadOnly
      ? "by_orgId_employeeId_unread_createdAt"
      : "by_orgId_employeeId_createdAt";
    const prefix = [
      { field: "employeeId", value: employee._id },
      ...(args.unreadOnly ? [{ field: "unread", value: true }] : []),
    ];
    const limit = Number.isFinite(args.limit)
      ? Math.max(1, Math.min(30, Math.floor(args.limit!)))
      : 20;
    const page = await ctx.tenantDb
      .byIndex<Notification>("hrNotifications", index, prefix)
      .page({
        limit,
        order: "desc",
        ...(args.cursor ? { cursor: args.cursor } : {}),
      });
    const unread = await completeRows500(
      ctx.tenantDb.byIndex<Notification>(
        "hrNotifications",
        "by_orgId_employeeId_unread_createdAt",
        [
          { field: "employeeId", value: employee._id },
          { field: "unread", value: true },
        ],
      ),
    );
    return {
      ok: true as const,
      items: page.page,
      nextCursor: page.isDone ? null : page.continueCursor,
      unreadCount: unread?.length ?? 500,
      unreadCountComplete: unread !== null,
    };
  },
});
export const markOne = mutationWithOrg({
  args: { requestId: v.string(), notificationId: v.string() },
  returns: v.any(),
  permissionCode: HR_PERMISSION.selfAccess,
  target: { table: "hrNotifications" },
  handler: async (ctx, args) => {
    const employee = await linkedEmployee(ctx);
    if (!employee) return fail("HR_NOT_LINKED");
    return await hrCommand(ctx, {
      operation: "hr.notifications.markOne",
      requestId: args.requestId,
      payload: args,
      table: "hrNotifications",
      replay: async (id) => {
        const row = await ctx.tenantDb.get<Notification>("hrNotifications", id);
        return row?.employeeId === employee._id
          ? { readAt: row.readAt ?? null }
          : null;
      },
      run: async () => {
        const row = await ctx.tenantDb.get<Notification>(
          "hrNotifications",
          args.notificationId,
        );
        if (!row || row.employeeId !== employee._id) return fail("NOT_FOUND");
        const readAt = row.readAt ?? Date.now();
        await ctx.tenantDb.patch("hrNotifications", row._id, {
          unread: false,
          readAt,
        });
        return {
          documentId: row._id,
          extra: { readAt },
          changes: [{ field: "unread", to: "false" }],
        };
      },
    });
  },
});
export const markAll = mutationWithOrg({
  args: { requestId: v.string() },
  returns: v.any(),
  permissionCode: HR_PERMISSION.selfAccess,
  target: { table: "hrNotificationBatches" },
  handler: async (ctx, args) => {
    const employee = await linkedEmployee(ctx);
    if (!employee) return fail("HR_NOT_LINKED");
    return await hrCommand(ctx, {
      operation: "hr.notifications.markAll",
      requestId: args.requestId,
      payload: args,
      table: "hrNotificationBatches",
      replay: async (id) => {
        const row = await ctx.tenantDb.get<Doc<"hrNotificationBatches">>(
          "hrNotificationBatches",
          id,
        );
        return row?.employeeId === employee._id
          ? { markedCount: row.markedCount, moreUnread: row.moreUnread }
          : null;
      },
      run: async () => {
        const reader = ctx.tenantDb.byIndex<Notification>(
          "hrNotifications",
          "by_orgId_employeeId_unread_createdAt",
          [
            { field: "employeeId", value: employee._id },
            { field: "unread", value: true },
          ],
        );
        const at = Date.now();
        let markedCount = 0;
        for (let batch = 0; batch < 5; batch++) {
          const rows = await reader.take(100);
          for (const row of rows)
            await ctx.tenantDb.patch("hrNotifications", row._id, {
              unread: false,
              readAt: at,
            });
          markedCount += rows.length;
          if (rows.length < 100) break;
        }
        const moreUnread = (await reader.first()) !== null;
        const documentId = await ctx.tenantDb.insert("hrNotificationBatches", {
          employeeId: employee._id,
          at,
          markedCount,
          moreUnread,
        });
        return {
          documentId,
          extra: { markedCount, moreUnread },
          changes: [
            { field: "markedCount", to: String(markedCount) },
            { field: "moreUnread", to: String(moreUnread) },
          ],
        };
      },
    });
  },
});
