import { defineTable } from "convex/server";
import { v } from "convex/values";
import { byOrg, tenantFields } from "../../lib/tenantTable";

export const announcementAudienceValidator = v.object({
  mode: v.union(v.literal("ORGANIZATION"), v.literal("SITES")),
  warehouseIds: v.array(v.id("warehouses")),
});
export const hrAnnouncementTables = {
  hrAnnouncements: defineTable(
    tenantFields({
      title: v.string(),
      pinned: v.boolean(),
      replacesId: v.optional(v.id("hrAnnouncements")),
      body: v.string(),
      audience: announcementAudienceValidator,
      acknowledgmentRequired: v.boolean(),
      status: v.union(
        v.literal("DRAFT"),
        v.literal("SCHEDULED"),
        v.literal("PUBLISHED"),
        v.literal("ARCHIVED"),
      ),
      version: v.number(),
      createdAt: v.number(),
      updatedAt: v.number(),
      createdByUserId: v.id("users"),
      updatedByUserId: v.id("users"),
      publishAt: v.optional(v.number()),
      scheduledByUserId: v.optional(v.id("users")),
      scheduledAt: v.optional(v.number()),
      scheduledFunctionId: v.optional(v.id("_scheduled_functions")),
      scheduleError: v.optional(v.string()),
      scheduleFailedAt: v.optional(v.number()),
      publishedAt: v.optional(v.number()),
      publishedByUserId: v.optional(v.id("users")),
      publishedAuthorName: v.optional(v.string()),
      publishedVersion: v.optional(v.number()),
      policyVersionId: v.optional(v.id("hrPolicyVersions")),
      recipientCount: v.optional(v.number()),
      archivedAt: v.optional(v.number()),
    }),
  ).index("by_orgId_createdAt", byOrg("createdAt")),
  hrAnnouncementRecipients: defineTable(
    tenantFields({
      announcementId: v.id("hrAnnouncements"),
      employeeId: v.id("hrEmployees"),
      employeeName: v.string(),
      employeeCode: v.string(),
      contentVersion: v.number(),
      pinned: v.boolean(),
      publishedAt: v.number(),
      warehouseId: v.id("warehouses"),
      readAt: v.optional(v.number()),
      acknowledgedAt: v.optional(v.number()),
    }),
  )
    .index(
      "by_orgId_announcementId_employeeId",
      byOrg("announcementId", "employeeId"),
    )
    .index(
      "by_orgId_employeeId_publishedAt",
      byOrg("employeeId", "publishedAt"),
    )
    .index("by_orgId_announcementId", byOrg("announcementId"))
    .index(
      "by_orgId_employeeId_pinned_publishedAt",
      byOrg("employeeId", "pinned", "publishedAt"),
    ),
  hrNotifications: defineTable(
    tenantFields({
      employeeId: v.id("hrEmployees"),
      announcementId: v.optional(v.id("hrAnnouncements")),
      resourceId: v.optional(v.string()),
      event: v.union(
        v.literal("ANNOUNCEMENT_PUBLISHED"),
        v.literal("LEAVE_DECIDED"),
        v.literal("CORRECTION_DECIDED"),
        v.literal("PAYSLIP_PUBLISHED"),
      ),
      title: v.string(),
      eventKey: v.string(),
      unread: v.boolean(),
      createdAt: v.number(),
      readAt: v.optional(v.number()),
    }),
  )
    .index("by_orgId_employeeId_createdAt", byOrg("employeeId", "createdAt"))
    .index(
      "by_orgId_employeeId_unread_createdAt",
      byOrg("employeeId", "unread", "createdAt"),
    )
    .index(
      "by_orgId_employeeId_announcementId",
      byOrg("employeeId", "announcementId"),
    )
    .index("by_orgId_employeeId_eventKey", byOrg("employeeId", "eventKey")),
  hrNotificationBatches: defineTable(
    tenantFields({
      employeeId: v.id("hrEmployees"),
      at: v.number(),
      markedCount: v.number(),
      moreUnread: v.boolean(),
    }),
  ).index("by_orgId_employeeId", byOrg("employeeId")),
};
