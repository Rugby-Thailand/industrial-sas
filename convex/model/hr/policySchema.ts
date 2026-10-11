import { defineTable } from "convex/server";
import { v } from "convex/values";
import { byOrg, tenantFields } from "../../lib/tenantTable";
import {
  capabilityValidator,
  leaveTypeValidator,
  policyConfigValidator,
} from "./policy";
const history = v.object({
  action: v.string(),
  at: v.number(),
  actorUserId: v.id("users"),
  reason: v.optional(v.string()),
});
const requestFields = {
  employeeId: v.id("hrEmployees"),
  warehouseId: v.id("warehouses"),
  type: leaveTypeValidator,
  from: v.string(),
  to: v.string(),
  dates: v.array(v.string()),
  days: v.number(),
  paidDays: v.number(),
  payPercent: v.number(),
  reason: v.string(),
  evidence: v.optional(v.string()),
  eventDate: v.optional(v.string()),
  policyVersionId: v.id("hrPolicyVersions"),
  policyConfig: policyConfigValidator,
  accountId: v.optional(v.id("hrLeaveAccounts")),
  daySnapshots: v.array(
    v.object({
      date: v.string(),
      dayId: v.optional(v.id("hrAttendanceDays")),
      revision: v.number(),
      scheduled: v.boolean(),
      plan: v.object({
        kind: v.union(v.literal("SCHEDULED"), v.literal("NONWORKING")),
        breakMinutes: v.number(),
        startAt: v.optional(v.number()),
        endAt: v.optional(v.number()),
        startTime: v.optional(v.string()),
        endTime: v.optional(v.string()),
        endsNextDay: v.optional(v.boolean()),
        reason: v.optional(v.string()),
        holidayName: v.optional(v.string()),
      }),
      holidayName: v.optional(v.string()),
    }),
  ),
  status: v.union(
    v.literal("PENDING"),
    v.literal("APPROVED"),
    v.literal("RETURNED"),
    v.literal("WITHDRAWN"),
    v.literal("CANCELLATION_REQUESTED"),
    v.literal("CANCELLED"),
  ),
  version: v.number(),
  history: v.array(history),
  submittedAt: v.number(),
  updatedAt: v.number(),
  attendanceRevisions: v.optional(
    v.array(v.object({ date: v.string(), revision: v.number() })),
  ),
};
export const hrPolicyTables = {
  hrLeaveRequestRevisions: defineTable(
    tenantFields({
      leaveRequestId: v.id("hrLeaveRequests"),
      version: v.number(),
      snapshot: v.object(requestFields),
      archivedAt: v.number(),
      archivedByUserId: v.id("users"),
    }),
  ).index(
    "by_orgId_leaveRequestId_version",
    byOrg("leaveRequestId", "version"),
  ),
  hrLeaveDayClaims: defineTable(
    tenantFields({
      employeeId: v.id("hrEmployees"),
      businessDate: v.string(),
      leaveRequestId: v.id("hrLeaveRequests"),
    }),
  ).index(
    "by_orgId_employeeId_businessDate",
    byOrg("employeeId", "businessDate"),
  ),
  hrPolicyDrafts: defineTable(
    tenantFields({
      capability: capabilityValidator,
      config: policyConfigValidator,
      effectiveDate: v.string(),
      version: v.number(),
      preset: v.string(),
      updatedAt: v.number(),
      updatedByUserId: v.id("users"),
    }),
  ).index("by_orgId_capability", byOrg("capability")),
  hrPolicyVersions: defineTable(
    tenantFields({
      capability: capabilityValidator,
      config: policyConfigValidator,
      effectiveDate: v.string(),
      version: v.number(),
      draftVersion: v.number(),
      preset: v.string(),
      coverageConfirmed: v.boolean(),
      existingBenefitsReviewed: v.boolean(),
      activatedAt: v.number(),
      activatedByUserId: v.id("users"),
    }),
  ).index(
    "by_orgId_capability_effectiveDate",
    byOrg("capability", "effectiveDate"),
  ),
  hrLeaveAccounts: defineTable(
    tenantFields({
      employeeId: v.id("hrEmployees"),
      warehouseId: v.id("warehouses"),
      type: leaveTypeValidator,
      periodStart: v.string(),
      periodEnd: v.string(),
      granted: v.number(),
      baseGrant: v.optional(v.number()),
      used: v.number(),
      reserved: v.number(),
      paidUsed: v.number(),
      paidReserved: v.number(),
      asOf: v.string(),
      sourceReference: v.string(),
      version: v.number(),
      reconciledByUserId: v.id("users"),
      reconciledAt: v.number(),
    }),
  )
    .index(
      "by_orgId_employeeId_type_periodStart",
      byOrg("employeeId", "type", "periodStart"),
    )
    .index("by_orgId_employeeId", byOrg("employeeId")),
  hrLeaveLedger: defineTable(
    tenantFields({
      accountId: v.id("hrLeaveAccounts"),
      employeeId: v.id("hrEmployees"),
      leaveRequestId: v.optional(v.id("hrLeaveRequests")),
      leaveRequestVersion: v.optional(v.number()),
      kind: v.union(
        v.literal("OPENING"),
        v.literal("RESERVE"),
        v.literal("RELEASE"),
        v.literal("CONSUME"),
        v.literal("RESTORE"),
        v.literal("CARRYOVER"),
        v.literal("POLICY_GRANT"),
      ),
      grantedDelta: v.number(),
      usedDelta: v.number(),
      reservedDelta: v.number(),
      paidUsedDelta: v.number(),
      paidReservedDelta: v.number(),
      at: v.number(),
      actorUserId: v.id("users"),
      reason: v.string(),
    }),
  ).index("by_orgId_accountId", byOrg("accountId")),
  hrLeaveRequests: defineTable(tenantFields(requestFields))
    .index(
      "by_orgId_employeeId_submittedAt",
      byOrg("employeeId", "submittedAt"),
    )
    .index("by_orgId_status_submittedAt", byOrg("status", "submittedAt"))
    .index(
      "by_orgId_employeeId_type_eventDate",
      byOrg("employeeId", "type", "eventDate"),
    ),
};
