/** Published content and audience are frozen; a read never creates a receipt. */
import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { fromLocal, isIsoDate, parseLocalTime } from "../model/hr/calendar";
import type { Doc } from "../_generated/dataModel";
import { HR_PERMISSION } from "../lib/permissions";
import {
  mutationWithOrg,
  queryWithOrg,
  type TenantFunctionContext,
} from "../lib/tenantFunctions";
import { announcementAudienceValidator } from "../model/hr/announcementsSchema";
import { activePolicy } from "./policies";
import { deliverNotification, completeRows500 } from "./notifications";
import {
  fail,
  hrCommand,
  siteAllowed,
  linkedEmployee,
  memberName,
  orgClock,
  siteScope,
  type Employee,
} from "./shared";

type Announcement = Doc<"hrAnnouncements">;
type Recipient = Doc<"hrAnnouncementRecipients">;
const ADMIN = HR_PERMISSION.adminManage,
  SELF = HR_PERMISSION.selfAccess;
const pageArgs = {
  cursor: v.optional(v.string()),
  limit: v.optional(v.number()),
};
const limitOf = (limit?: number) =>
  Number.isFinite(limit) ? Math.max(1, Math.min(30, Math.floor(limit!))) : 20;
export async function canManageAnnouncement(
  ctx: TenantFunctionContext,
  announcement: Announcement,
) {
  const scope = await siteScope(ctx);
  if (announcement.audience.mode === "ORGANIZATION") return scope.all;
  for (const id of announcement.audience.warehouseIds)
    if (!(await siteAllowed(ctx, scope, id))) return false;
  return true;
}
async function recipientOf(
  ctx: TenantFunctionContext,
  announcementId: string,
  employeeId: string,
) {
  return await ctx.tenantDb
    .byIndex<Recipient>(
      "hrAnnouncementRecipients",
      "by_orgId_announcementId_employeeId",
      [
        { field: "announcementId", value: announcementId },
        { field: "employeeId", value: employeeId },
      ],
    )
    .unique();
}
export const manage = queryWithOrg({
  args: pageArgs,
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrAnnouncements" },
  handler: async (ctx, args) => {
    const clock = orgClock(ctx);
    if (!clock) return { ok: false as const, code: "TIMEZONE_UNSUPPORTED" };
    const page = await ctx.tenantDb
      .byIndex<Announcement>("hrAnnouncements", "by_orgId_createdAt")
      .page({
        limit: limitOf(args.limit),
        order: "desc",
        ...(args.cursor ? { cursor: args.cursor } : {}),
      });
    const accessible = [];
    for (const row of page.page)
      if (await canManageAnnouncement(ctx, row)) accessible.push(row);
    return {
      ok: true as const,
      items: accessible,
      nextCursor: page.isDone ? null : page.continueCursor,
      policy: await activePolicy(ctx, "ANNOUNCEMENTS", clock.today),
    };
  },
});
export const self = queryWithOrg({
  args: { ...pageArgs, pinnedOnly: v.optional(v.boolean()) },
  returns: v.any(),
  permissionCode: SELF,
  target: { table: "hrAnnouncementRecipients" },
  handler: async (ctx, args) => {
    const employee = await linkedEmployee(ctx);
    if (!employee) return { ok: false as const, code: "HR_NOT_LINKED" };
    const clock = orgClock(ctx);
    if (!clock) return { ok: false as const, code: "TIMEZONE_UNSUPPORTED" };
    const page = await ctx.tenantDb
      .byIndex<Recipient>(
        "hrAnnouncementRecipients",
        args.pinnedOnly
          ? "by_orgId_employeeId_pinned_publishedAt"
          : "by_orgId_employeeId_publishedAt",
        [
          { field: "employeeId", value: employee._id },
          ...(args.pinnedOnly ? [{ field: "pinned", value: true }] : []),
        ],
      )
      .page({
        limit: limitOf(args.limit),
        order: "desc",
        ...(args.cursor ? { cursor: args.cursor } : {}),
      });
    const items = [];
    for (const receipt of page.page) {
      const announcement = await ctx.tenantDb.get<Announcement>(
        "hrAnnouncements",
        receipt.announcementId,
      );
      if (
        announcement &&
        (announcement.status === "PUBLISHED" ||
          announcement.status === "ARCHIVED") &&
        announcement.publishedVersion === receipt.contentVersion
      )
        items.push({
          announcement,
          receipt,
          authorName:
            announcement.publishedAuthorName ??
            (await memberName(
              ctx,
              announcement.publishedByUserId ?? announcement.createdByUserId,
            )),
        });
    }
    return {
      ok: true as const,
      items,
      nextCursor: page.isDone ? null : page.continueCursor,
      gate: (await activePolicy(ctx, "ANNOUNCEMENTS", clock.today))
        ? null
        : "POLICY_NOT_ACTIVE",
    };
  },
});
export const detail = queryWithOrg({
  args: { announcementId: v.string() },
  returns: v.any(),
  permissionCode: SELF,
  target: { table: "hrAnnouncementRecipients" },
  handler: async (ctx, args) => {
    const employee = await linkedEmployee(ctx);
    if (!employee) return { ok: false as const, code: "HR_NOT_LINKED" };
    const receipt = await recipientOf(ctx, args.announcementId, employee._id);
    const announcement = receipt
      ? await ctx.tenantDb.get<Announcement>(
          "hrAnnouncements",
          receipt.announcementId,
        )
      : null;
    if (
      !receipt ||
      !announcement ||
      (announcement.status !== "PUBLISHED" &&
        announcement.status !== "ARCHIVED") ||
      announcement.publishedVersion !== receipt.contentVersion
    )
      return { ok: false as const, code: "NOT_FOUND" };
    return {
      ok: true as const,
      announcement,
      receipt,
      authorName:
        announcement.publishedAuthorName ??
        (await memberName(
          ctx,
          announcement.publishedByUserId ?? announcement.createdByUserId,
        )),
    };
  },
});
export const saveDraft = mutationWithOrg({
  args: {
    requestId: v.string(),
    announcementId: v.optional(v.string()),
    expectedVersion: v.number(),
    title: v.string(),
    body: v.string(),
    audience: announcementAudienceValidator,
    acknowledgmentRequired: v.boolean(),
    pinned: v.optional(v.boolean()),
    replacesId: v.optional(v.string()),
  },
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrAnnouncements" },
  handler: async (ctx, args) =>
    hrCommand(ctx, {
      operation: "hr.announcements.saveDraft",
      requestId: args.requestId,
      payload: args,
      table: "hrAnnouncements",
      replay: async (id) => {
        const row = await ctx.tenantDb.get<Announcement>("hrAnnouncements", id);
        return row && (await canManageAnnouncement(ctx, row))
          ? { version: row.version }
          : null;
      },
      run: async () => {
        const title = args.title.trim(),
          body = args.body.trim();
        if (!title || title.length > 200 || !body || body.length > 12000)
          return fail("ANNOUNCEMENT_CONTENT_INVALID");
        if (
          !Number.isSafeInteger(args.expectedVersion) ||
          args.expectedVersion < 0
        )
          return fail("ANNOUNCEMENT_STALE");
        const scope = await siteScope(ctx),
          audience = args.audience;
        if (
          (audience.mode === "ORGANIZATION" &&
            (!scope.all || audience.warehouseIds.length !== 0)) ||
          (audience.mode === "SITES" &&
            (audience.warehouseIds.length === 0 ||
              audience.warehouseIds.length > 50 ||
              new Set(audience.warehouseIds).size !==
                audience.warehouseIds.length))
        )
          return fail("ANNOUNCEMENT_AUDIENCE_INVALID");
        for (const id of audience.warehouseIds) {
          const warehouse = await ctx.tenantDb.get<Doc<"warehouses">>(
            "warehouses",
            id,
          );
          if (
            !warehouse ||
            warehouse.status !== "ACTIVE" ||
            !(await siteAllowed(ctx, scope, id))
          )
            return fail("ANNOUNCEMENT_AUDIENCE_INVALID");
        }
        const row = args.announcementId
          ? await ctx.tenantDb.get<Announcement>(
              "hrAnnouncements",
              args.announcementId,
            )
          : null;
        if (
          args.announcementId &&
          (!row || !(await canManageAnnouncement(ctx, row)))
        )
          return fail("NOT_FOUND");
        if ((row?.version ?? 0) !== args.expectedVersion)
          return fail("ANNOUNCEMENT_STALE");
        if (row && row.status !== "DRAFT")
          return fail("ANNOUNCEMENT_PUBLISHED_IMMUTABLE");
        const previous = args.replacesId
          ? await ctx.tenantDb.get<Announcement>(
              "hrAnnouncements",
              args.replacesId,
            )
          : null;
        if (
          args.replacesId &&
          (!previous ||
            previous.status === "DRAFT" ||
            !(await canManageAnnouncement(ctx, previous)))
        )
          return fail("NOT_FOUND");
        if (row && row.replacesId !== previous?._id)
          return fail("ANNOUNCEMENT_REVISION_INVALID");
        const now = Date.now(),
          fields = {
            title,
            body,
            pinned: args.pinned ?? false,
            ...(previous ? { replacesId: previous._id } : {}),
            audience,
            acknowledgmentRequired: args.acknowledgmentRequired,
            version: args.expectedVersion + 1,
            updatedAt: now,
            updatedByUserId: ctx.tenant.actor._id,
          };
        const documentId = row
          ? row._id
          : await ctx.tenantDb.insert("hrAnnouncements", {
              ...fields,
              status: "DRAFT",
              createdAt: now,
              createdByUserId: ctx.tenant.actor._id,
            });
        if (row) await ctx.tenantDb.patch("hrAnnouncements", row._id, fields);
        return {
          documentId,
          extra: { version: fields.version },
          changes: [{ field: "version", to: String(fields.version) }],
        };
      },
    }),
});
export const publish = mutationWithOrg({
  args: {
    requestId: v.string(),
    announcementId: v.string(),
    expectedVersion: v.number(),
  },
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrAnnouncements" },
  handler: async (ctx, args) =>
    hrCommand(ctx, {
      operation: "hr.announcements.publish",
      requestId: args.requestId,
      payload: args,
      table: "hrAnnouncements",
      replay: async (id) => {
        const row = await ctx.tenantDb.get<Announcement>("hrAnnouncements", id);
        return row && (await canManageAnnouncement(ctx, row))
          ? { version: row.version, recipientCount: row.recipientCount ?? 0 }
          : null;
      },
      run: async () => {
        const row = await ctx.tenantDb.get<Announcement>(
          "hrAnnouncements",
          args.announcementId,
        );
        if (!row || !(await canManageAnnouncement(ctx, row)))
          return fail("NOT_FOUND");
        if (row.version !== args.expectedVersion)
          return fail("ANNOUNCEMENT_STALE");
        if (row.status !== "DRAFT")
          return fail("ANNOUNCEMENT_PUBLISHED_IMMUTABLE");
        return await publishAnnouncement(ctx, row);
      },
    }),
});

/** Shared atomic fanout for explicit and scheduled publication. */
export async function publishAnnouncement(
  ctx: TenantFunctionContext,
  row: Announcement,
) {
  const clock = orgClock(ctx);
  if (!clock) return fail("TIMEZONE_UNSUPPORTED");
  const policy = await activePolicy(ctx, "ANNOUNCEMENTS", clock.today);
  if (!policy) return fail("POLICY_NOT_ACTIVE");
  // SITE defaults cannot be overridden with an organization-wide publication.
  if (
    policy.config.announcementAudience === "SITE" &&
    row.audience.mode !== "SITES"
  )
    return fail("ANNOUNCEMENT_AUDIENCE_INVALID");
  const employees: Employee[] = [];
  if (row.audience.mode === "ORGANIZATION") {
    const rows = await completeRows500(
      ctx.tenantDb.byIndex<Employee>("hrEmployees", "by_orgId_code"),
    );
    if (!rows) return fail("ANNOUNCEMENT_AUDIENCE_LIMIT");
    employees.push(...rows);
  } else {
    for (const warehouseId of row.audience.warehouseIds) {
      const warehouse = await ctx.tenantDb.get<Doc<"warehouses">>(
        "warehouses",
        warehouseId,
      );
      if (!warehouse || warehouse.status !== "ACTIVE")
        return fail("ANNOUNCEMENT_AUDIENCE_INVALID");
      const rows = await completeRows500(
        ctx.tenantDb.byIndex<Employee>(
          "hrEmployees",
          "by_orgId_warehouseId_code",
          [{ field: "warehouseId", value: warehouseId }],
        ),
      );
      if (!rows || employees.length + rows.length > 500)
        return fail("ANNOUNCEMENT_AUDIENCE_LIMIT");
      employees.push(...rows);
    }
  }
  const recipients = employees.filter(
    (employee) =>
      employee.status === "ACTIVE" &&
      employee.employmentStartDate <= clock.today &&
      (!employee.employmentEndDate ||
        employee.employmentEndDate >= clock.today),
  );
  if (!recipients.length) return fail("ANNOUNCEMENT_AUDIENCE_EMPTY");
  const version = row.version + 1;
  const acknowledgmentRequired =
    row.acknowledgmentRequired || policy.config.announcementAcknowledgment;
  for (const employee of recipients) {
    await ctx.tenantDb.insert("hrAnnouncementRecipients", {
      announcementId: row._id,
      employeeId: employee._id,
      employeeName: employee.displayName,
      employeeCode: employee.code,
      warehouseId: employee.warehouseId,
      contentVersion: version,
      pinned: row.pinned,
      publishedAt: clock.now,
    });
    await deliverNotification(ctx, {
      employeeId: employee._id,
      announcementId: row._id,
      event: "ANNOUNCEMENT_PUBLISHED",
      title: row.title,
      eventKey: `announcement:${row._id}:${version}`,
    });
  }
  await ctx.tenantDb.patch("hrAnnouncements", row._id, {
    status: "PUBLISHED",
    scheduleError: undefined,
    scheduleFailedAt: undefined,
    version,
    publishedVersion: version,
    publishedAt: clock.now,
    publishedByUserId: ctx.tenant.actor._id,
    publishedAuthorName: ctx.tenant.actor.displayName,
    updatedAt: clock.now,
    updatedByUserId: ctx.tenant.actor._id,
    policyVersionId: policy._id,
    recipientCount: recipients.length,
    acknowledgmentRequired,
  });
  return {
    documentId: row._id,
    extra: { version, recipientCount: recipients.length },
    changes: [
      { field: "status", from: row.status, to: "PUBLISHED" },
      { field: "recipientCount", to: String(recipients.length) },
    ],
  };
}

export const archive = mutationWithOrg({
  args: {
    requestId: v.string(),
    announcementId: v.string(),
    expectedVersion: v.number(),
  },
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrAnnouncements" },
  handler: async (ctx, args) =>
    hrCommand(ctx, {
      operation: "hr.announcements.archive",
      requestId: args.requestId,
      payload: args,
      table: "hrAnnouncements",
      replay: async (id) => {
        const row = await ctx.tenantDb.get<Announcement>("hrAnnouncements", id);
        return row && (await canManageAnnouncement(ctx, row))
          ? { version: row.version }
          : null;
      },
      run: async () => {
        const row = await ctx.tenantDb.get<Announcement>(
          "hrAnnouncements",
          args.announcementId,
        );
        if (!row || !(await canManageAnnouncement(ctx, row)))
          return fail("NOT_FOUND");
        if (row.version !== args.expectedVersion || row.status !== "PUBLISHED")
          return fail("ANNOUNCEMENT_STALE");
        const version = row.version + 1;
        await ctx.tenantDb.patch("hrAnnouncements", row._id, {
          status: "ARCHIVED",
          version,
          archivedAt: Date.now(),
          updatedAt: Date.now(),
          updatedByUserId: ctx.tenant.actor._id,
        });
        return {
          documentId: row._id,
          extra: { version },
          changes: [{ field: "status", from: "PUBLISHED", to: "ARCHIVED" }],
        };
      },
    }),
});
export const recordReceipt = mutationWithOrg({
  args: {
    requestId: v.string(),
    announcementId: v.string(),
    contentVersion: v.number(),
    action: v.union(v.literal("READ"), v.literal("ACKNOWLEDGE")),
  },
  returns: v.any(),
  permissionCode: SELF,
  target: { table: "hrAnnouncementRecipients" },
  handler: async (ctx, args) => {
    const employee = await linkedEmployee(ctx);
    if (!employee) return fail("HR_NOT_LINKED");
    return await hrCommand(ctx, {
      operation: "hr.announcements.recordReceipt",
      requestId: args.requestId,
      payload: args,
      table: "hrAnnouncementRecipients",
      replay: async (id) => {
        const row = await ctx.tenantDb.get<Recipient>(
          "hrAnnouncementRecipients",
          id,
        );
        return row?.employeeId === employee._id
          ? {
              readAt: row.readAt ?? null,
              acknowledgedAt: row.acknowledgedAt ?? null,
            }
          : null;
      },
      run: async () => {
        const row = await recipientOf(ctx, args.announcementId, employee._id);
        const announcement = row
          ? await ctx.tenantDb.get<Announcement>(
              "hrAnnouncements",
              row.announcementId,
            )
          : null;
        if (!row || !announcement || announcement.status === "DRAFT")
          return fail("NOT_FOUND");
        if (
          row.contentVersion !== args.contentVersion ||
          announcement.publishedVersion !== args.contentVersion
        )
          return fail("ANNOUNCEMENT_STALE");
        if (
          args.action === "ACKNOWLEDGE" &&
          (!announcement.acknowledgmentRequired ||
            announcement.status === "ARCHIVED")
        )
          return fail("ANNOUNCEMENT_ACKNOWLEDGMENT_UNAVAILABLE");
        const readAt = row.readAt ?? Date.now(),
          acknowledgedAt =
            args.action === "ACKNOWLEDGE"
              ? (row.acknowledgedAt ?? Date.now())
              : row.acknowledgedAt;
        await ctx.tenantDb.patch("hrAnnouncementRecipients", row._id, {
          readAt,
          ...(acknowledgedAt === undefined ? {} : { acknowledgedAt }),
        });
        return {
          documentId: row._id,
          extra: { readAt, acknowledgedAt: acknowledgedAt ?? null },
          changes: [
            { field: "action", to: args.action },
            { field: "contentVersion", to: String(args.contentVersion) },
          ],
        };
      },
    });
  },
});
export const receipts = queryWithOrg({
  args: { announcementId: v.string(), ...pageArgs },
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrAnnouncementRecipients" },
  handler: async (ctx, args) => {
    const announcement = await ctx.tenantDb.get<Announcement>(
      "hrAnnouncements",
      args.announcementId,
    );
    if (!announcement || !(await canManageAnnouncement(ctx, announcement)))
      return { ok: false as const, code: "NOT_FOUND" };
    const page = await ctx.tenantDb
      .byIndex<Recipient>(
        "hrAnnouncementRecipients",
        "by_orgId_announcementId",
        [{ field: "announcementId", value: announcement._id }],
      )
      .page({
        limit: limitOf(args.limit),
        ...(args.cursor ? { cursor: args.cursor } : {}),
      });
    return {
      ok: true as const,
      items: page.page,
      recipientCount: announcement.recipientCount ?? 0,
      nextCursor: page.isDone ? null : page.continueCursor,
    };
  },
});
/** Pinning changes presentation only; signed receipts keep the frozen content version. */
export const setPinned = mutationWithOrg({
  args: {
    requestId: v.string(),
    announcementId: v.string(),
    expectedVersion: v.number(),
    pinned: v.boolean(),
  },
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrAnnouncements" },
  handler: async (ctx, args) =>
    hrCommand(ctx, {
      operation: "hr.announcements.setPinned",
      requestId: args.requestId,
      payload: args,
      table: "hrAnnouncements",
      replay: async (id) => {
        const row = await ctx.tenantDb.get<Announcement>("hrAnnouncements", id);
        return row && (await canManageAnnouncement(ctx, row))
          ? { version: row.version, pinned: row.pinned }
          : null;
      },
      run: async () => {
        const row = await ctx.tenantDb.get<Announcement>(
          "hrAnnouncements",
          args.announcementId,
        );
        if (!row || !(await canManageAnnouncement(ctx, row)))
          return fail("NOT_FOUND");
        if (row.status !== "PUBLISHED" || row.version !== args.expectedVersion)
          return fail("ANNOUNCEMENT_STALE");
        const recipients = await completeRows500(
          ctx.tenantDb.byIndex<Recipient>(
            "hrAnnouncementRecipients",
            "by_orgId_announcementId",
            [{ field: "announcementId", value: row._id }],
          ),
        );
        if (!recipients) return fail("ANNOUNCEMENT_AUDIENCE_LIMIT");
        for (const receipt of recipients)
          await ctx.tenantDb.patch("hrAnnouncementRecipients", receipt._id, {
            pinned: args.pinned,
          });
        const version = row.version + 1;
        await ctx.tenantDb.patch("hrAnnouncements", row._id, {
          pinned: args.pinned,
          version,
          updatedAt: Date.now(),
          updatedByUserId: ctx.tenant.actor._id,
        });
        return {
          documentId: row._id,
          extra: { version, pinned: args.pinned },
          changes: [{ field: "pinned", to: String(args.pinned) }],
        };
      },
    }),
});

/** Bangkok wall-clock intent is resolved by the server, never the browser timezone. */
export const schedule = mutationWithOrg({
  args: {
    requestId: v.string(),
    announcementId: v.string(),
    expectedVersion: v.number(),
    publishDate: v.string(),
    publishTime: v.string(),
  },
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrAnnouncements" },
  handler: async (ctx, args) =>
    hrCommand(ctx, {
      operation: "hr.announcements.schedule",
      requestId: args.requestId,
      payload: args,
      table: "hrAnnouncements",
      replay: async (id) => {
        const row = await ctx.tenantDb.get<Announcement>("hrAnnouncements", id);
        return row && (await canManageAnnouncement(ctx, row))
          ? { version: row.version, publishAt: row.publishAt }
          : null;
      },
      run: async () => {
        const row = await ctx.tenantDb.get<Announcement>(
          "hrAnnouncements",
          args.announcementId,
        );
        if (!row || !(await canManageAnnouncement(ctx, row)))
          return fail("NOT_FOUND");
        if (row.status !== "DRAFT" || row.version !== args.expectedVersion)
          return fail("ANNOUNCEMENT_STALE");
        const minutes = parseLocalTime(args.publishTime);
        if (!isIsoDate(args.publishDate) || minutes === null)
          return fail("ANNOUNCEMENT_SCHEDULE_INVALID");
        const publishAt = fromLocal(args.publishDate, minutes, 420);
        if (
          !Number.isSafeInteger(publishAt) ||
          publishAt <= Date.now() ||
          publishAt > Date.now() + 366 * 86400000
        )
          return fail("ANNOUNCEMENT_SCHEDULE_INVALID");
        const clock = orgClock(ctx);
        if (!clock) return fail("TIMEZONE_UNSUPPORTED");
        const policy = await activePolicy(ctx, "ANNOUNCEMENTS", clock.today);
        if (!policy) return fail("POLICY_NOT_ACTIVE");
        if (
          policy.config.announcementAudience === "SITE" &&
          row.audience.mode !== "SITES"
        )
          return fail("ANNOUNCEMENT_AUDIENCE_INVALID");
        if (!ctx.scheduler)
          throw new Error("Mutation scheduler is unavailable.");
        const version = row.version + 1;
        const scheduledFunctionId = await ctx.scheduler.runAt(
          publishAt,
          makeFunctionReference<"mutation">(
            "hr/announcementSchedule:publishDue",
          ),
          { announcementId: row._id, expectedVersion: version },
        );
        await ctx.tenantDb.patch("hrAnnouncements", row._id, {
          status: "SCHEDULED",
          version,
          publishAt,
          scheduledFunctionId,
          scheduledByUserId: ctx.tenant.actor._id,
          scheduledAt: clock.now,
          updatedAt: clock.now,
          updatedByUserId: ctx.tenant.actor._id,
          scheduleError: undefined,
          scheduleFailedAt: undefined,
        });
        return {
          documentId: row._id,
          extra: { version, publishAt },
          changes: [
            { field: "status", from: "DRAFT", to: "SCHEDULED" },
            { field: "publishAt", to: String(publishAt) },
          ],
        };
      },
    }),
});
export const cancelSchedule = mutationWithOrg({
  args: {
    requestId: v.string(),
    announcementId: v.string(),
    expectedVersion: v.number(),
  },
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrAnnouncements" },
  handler: async (ctx, args) =>
    hrCommand(ctx, {
      operation: "hr.announcements.cancelSchedule",
      requestId: args.requestId,
      payload: args,
      table: "hrAnnouncements",
      replay: async (id) => {
        const row = await ctx.tenantDb.get<Announcement>("hrAnnouncements", id);
        return row && (await canManageAnnouncement(ctx, row))
          ? { version: row.version }
          : null;
      },
      run: async () => {
        const row = await ctx.tenantDb.get<Announcement>(
          "hrAnnouncements",
          args.announcementId,
        );
        if (!row || !(await canManageAnnouncement(ctx, row)))
          return fail("NOT_FOUND");
        if (row.status !== "SCHEDULED" || row.version !== args.expectedVersion)
          return fail("ANNOUNCEMENT_STALE");
        if (
          row.scheduledFunctionId &&
          row.publishAt &&
          row.publishAt > Date.now() &&
          !row.scheduleError
        ) {
          if (!ctx.scheduler)
            throw new Error("Mutation scheduler is unavailable.");
          await ctx.scheduler.cancel(row.scheduledFunctionId);
        }
        const version = row.version + 1;
        await ctx.tenantDb.patch("hrAnnouncements", row._id, {
          status: "DRAFT",
          version,
          updatedAt: Date.now(),
          updatedByUserId: ctx.tenant.actor._id,
          publishAt: undefined,
          scheduledFunctionId: undefined,
          scheduledByUserId: undefined,
          scheduledAt: undefined,
          scheduleError: undefined,
          scheduleFailedAt: undefined,
        });
        return {
          documentId: row._id,
          extra: { version },
          changes: [{ field: "status", from: "SCHEDULED", to: "DRAFT" }],
        };
      },
    }),
});
