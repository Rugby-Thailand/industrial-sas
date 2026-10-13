/** Resolve an ID-only uncertain write without replaying data or navigation. */
import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import { HR_PERMISSION } from "../lib/permissions";
import { mutationWithOrg } from "../lib/tenantFunctions";
import { holds, hrRequestFenceOperation, validHrRequestId } from "./shared";

const OPERATIONS = new Map([
  ["hr.attendance.clockIn", HR_PERMISSION.selfAccess],
  ["hr.attendance.clockOut", HR_PERMISSION.selfAccess],
  ["hr.correction.submit", HR_PERMISSION.selfAccess],
  ["hr.preferences.save", HR_PERMISSION.selfAccess],
  ["hr.employee.save", HR_PERMISSION.adminManage],
  ["hr.holiday.save", HR_PERMISSION.adminManage],
  ["hr.holiday.delete", HR_PERMISSION.adminManage],
  ["hr.access.set", HR_PERMISSION.adminManage],
  ["hr.correction.decide", HR_PERMISSION.teamReview],
  ["hr.attendance.dispose", HR_PERMISSION.teamReview],
  ["hr.period.create", HR_PERMISSION.periodClose],
  ["hr.period.closeVersion", HR_PERMISSION.periodClose],
  ["hr.period.revise", HR_PERMISSION.periodClose],
  ["hr.period.exportVersion", HR_PERMISSION.periodExport],
  ["hr.leave.submit", HR_PERMISSION.selfAccess],
  ["hr.leave.resubmit", HR_PERMISSION.selfAccess],
  ["hr.leave.cancel", HR_PERMISSION.selfAccess],
  ["hr.leave.renewEntitlements", HR_PERMISSION.selfAccess],
  ["hr.leave.decide", HR_PERMISSION.teamReview],
  ["hr.leave.adjust", HR_PERMISSION.adminManage],
  ["hr.leave.reconcileOpening", HR_PERMISSION.adminManage],
  ["hr.payslip.stage", HR_PERMISSION.adminManage],
  ["hr.payslip.publish", HR_PERMISSION.adminManage],
  ["hr.policy.saveDraft", HR_PERMISSION.adminManage],
  ["hr.policy.activate", HR_PERMISSION.adminManage],
  ["hr.announcements.saveDraft", HR_PERMISSION.adminManage],
  ["hr.announcements.publish", HR_PERMISSION.adminManage],
  ["hr.announcements.archive", HR_PERMISSION.adminManage],
  ["hr.announcements.setPinned", HR_PERMISSION.adminManage],
  ["hr.announcements.schedule", HR_PERMISSION.adminManage],
  ["hr.announcements.cancelSchedule", HR_PERMISSION.adminManage],
  ["hr.announcements.recordReceipt", HR_PERMISSION.selfAccess],
  ["hr.notifications.markOne", HR_PERMISSION.selfAccess],
  ["hr.notifications.markAll", HR_PERMISSION.selfAccess],
]);

export const reconcileRequest = mutationWithOrg({
  args: { operation: v.string(), requestId: v.string() },
  returns: v.any(),
  permissionCode: HR_PERMISSION.selfAccess,
  target: { table: "idempotencyRecords" },
  handler: async (ctx, args) => {
    const permission = OPERATIONS.get(args.operation);
    if (permission === undefined)
      return { resolved: false as const, code: "OPERATION_INVALID" };
    if (!(await holds(ctx, permission)))
      return { resolved: false as const, code: "PERMISSION_DENIED" };
    if (!validHrRequestId(args.requestId))
      return { resolved: false as const, code: "REQUEST_IDENTITY_INVALID" };
    const actorUserId = ctx.tenant.actor._id;
    const existing = await ctx.tenantDb
      .byIndex<Doc<"idempotencyRecords">>(
        "idempotencyRecords",
        "by_orgId_operation_requestId",
        [
          { field: "operation", value: args.operation },
          { field: "requestId", value: args.requestId },
        ],
      )
      .unique();
    // This is deliberately status-only. It cannot rebuild another actor's
    // receipt, bypass site/report access, or report a generic write success.
    if (existing !== null) {
      if (
        existing.actorUserId !== actorUserId ||
        existing.status !== "SUCCEEDED"
      )
        return { resolved: false as const, code: "NOT_FOUND" };
      return { resolved: true as const, status: "COMMITTED" as const };
    }
    const operation = hrRequestFenceOperation(args.operation, actorUserId);
    const fence = await ctx.tenantDb
      .byIndex<Doc<"idempotencyRecords">>(
        "idempotencyRecords",
        "by_orgId_operation_requestId",
        [
          { field: "operation", value: operation },
          { field: "requestId", value: args.requestId },
        ],
      )
      .unique();
    if (fence === null) {
      const now = Date.now();
      await ctx.tenantDb.insert("idempotencyRecords", {
        operation,
        requestId: args.requestId,
        actorUserId,
        status: "FAILED",
        requestHash: "HR_REQUEST_RETIRED",
        firstSeenAt: now,
        completedAt: now,
        // A late command must never outlive its cancellation fence.
        expiresAt: Number.MAX_SAFE_INTEGER,
      });
    }
    // Both this mutation and hrCommand read the command/fence indexes in one
    // transaction. Convex OCC serializes either commit-before-fence (above)
    // or fence-before-command; the latter can never apply the old command.
    return { resolved: true as const, status: "FENCED" as const };
  },
});
