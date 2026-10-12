/** Real leave requests; atomic reservations, decisions and attendance snapshots. */
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { sha256Hex } from "../lib/idempotency";
import { HR_PERMISSION } from "../lib/permissions";
import {
  mutationWithOrg,
  queryWithOrg,
  type TenantFunctionContext,
} from "../lib/tenantFunctions";
import {
  addDays,
  datesInRange,
  inclusiveDayCount,
  isIsoDate,
} from "../model/hr/calendar";
import {
  ACCOUNT_TYPES,
  accountPeriod,
  grantFor,
  leaveTypeValidator,
  type AccountType,
  type LeaveType,
} from "../model/hr/policy";
import { isEmployedOn } from "../model/hr/schedule";
import { activePolicy, leaveAccount } from "./policies";
import { deliverNotification } from "./notifications";
import { hrListInput, hrPageArgs, hrScanPage } from "./pagination";
import {
  closedPeriodCovering,
  dayOf,
  employmentOf,
  ensureDay,
  fail,
  hrCommand,
  linkedEmployee,
  livePlan,
  orgClock,
  storedPlan,
  holds,
  reviewAccess,
  reviewBlocker,
  reviewScope,
  type Employee,
} from "./shared";
const SELF = HR_PERMISSION.selfAccess,
  REVIEW = HR_PERMISSION.teamReview;
type Request = Doc<"hrLeaveRequests">;
export const LEAVE_TYPES: LeaveType[] = [
  "ANNUAL",
  "SICK",
  "PERSONAL",
  "MATERNITY",
  "SPOUSE",
  "NEWBORN_CARE",
  "STERILIZATION",
  "MILITARY",
  "TRAINING",
];
const activeStatus = (status: Request["status"]) =>
  status === "PENDING" ||
  status === "APPROVED" ||
  status === "CANCELLATION_REQUESTED";
function cleanReason(reason: string) {
  const value = reason.trim();
  return value.length >= 3 && value.length <= 1000 ? value : null;
}
async function claimOf(
  ctx: TenantFunctionContext,
  employeeId: string,
  businessDate: string,
) {
  return await ctx.tenantDb
    .byIndex<Doc<"hrLeaveDayClaims">>(
      "hrLeaveDayClaims",
      "by_orgId_employeeId_businessDate",
      [
        { field: "employeeId", value: employeeId },
        { field: "businessDate", value: businessDate },
      ],
    )
    .unique();
}
async function releaseClaims(
  ctx: TenantFunctionContext,
  row: Request,
  dates: readonly string[] = row.dates,
) {
  for (const date of dates) {
    const claim = await claimOf(ctx, row.employeeId, date);
    if (claim?.leaveRequestId === row._id)
      await ctx.tenantDb.delete("hrLeaveDayClaims", claim._id);
  }
}
async function eventRequests(
  ctx: TenantFunctionContext,
  employeeId: string,
  type: LeaveType,
  eventDate: string,
) {
  return await ctx.tenantDb
    .byIndex<Request>("hrLeaveRequests", "by_orgId_employeeId_type_eventDate", [
      { field: "employeeId", value: employeeId },
      { field: "type", value: type },
      { field: "eventDate", value: eventDate },
    ])
    .all(1000);
}
export const self = queryWithOrg({
  args: {},
  returns: v.any(),
  permissionCode: SELF,
  target: { table: "hrLeaveRequests" },
  handler: async (ctx) => {
    const employee = await linkedEmployee(ctx);
    if (!employee) return { ok: false as const, code: "HR_NOT_LINKED" };
    const clock = orgClock(ctx);
    if (!clock) return { ok: false as const, code: "TIMEZONE_UNSUPPORTED" };
    const active = await activePolicy(ctx, "LEAVE", clock.today);
    const accounts = await Promise.all(
      ACCOUNT_TYPES.map((type) =>
        leaveAccount(ctx, employee, type, clock.today),
      ),
    );
    const requests = await ctx.tenantDb
      .byIndex<Request>("hrLeaveRequests", "by_orgId_employeeId_submittedAt", [
        { field: "employeeId", value: employee._id },
      ])
      .page({ limit: 50, order: "desc" });
    return {
      ok: true as const,
      employeeId: employee._id,
      today: clock.today,
      active,
      accounts: accounts
        .filter((account) => account !== null)
        .map((account) => ({
          ...account,
          available: Math.max(
            0,
            account.granted - account.used - account.reserved,
          ),
          paidAvailable: Math.max(
            0,
            account.granted - account.paidUsed - account.paidReserved,
          ),
        })),
      requests: requests.page,
      requestsComplete: requests.isDone,
      gate: !active
        ? "POLICY_NOT_ACTIVE"
        : accounts.some(
              (account) =>
                !account ||
                (account.baseGrant ?? account.granted) <
                  grantFor(
                    account.type as AccountType,
                    active.config,
                    accountPeriod(
                      account.type as AccountType,
                      employee.employmentStartDate,
                      clock.today,
                    ).eligible,
                  ),
            )
          ? "OPENING_BALANCE_REQUIRED"
          : null,
      types: LEAVE_TYPES,
    };
  },
});
export const history = queryWithOrg({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.any(),
  permissionCode: SELF,
  target: { table: "hrLeaveRequests" },
  handler: async (ctx, args) => {
    const employee = await linkedEmployee(ctx);
    if (!employee) return { ok: false as const, code: "HR_NOT_LINKED" };
    const page = await ctx.tenantDb
      .byIndex<Request>("hrLeaveRequests", "by_orgId_employeeId_submittedAt", [
        { field: "employeeId", value: employee._id },
      ])
      .page({
        limit: Math.min(50, Math.max(1, args.paginationOpts.numItems)),
        ...(args.paginationOpts.cursor
          ? { cursor: args.paginationOpts.cursor }
          : {}),
        order: "desc",
      });
    return { ok: true as const, ...page };
  },
});
export const queue = queryWithOrg({
  args: {},
  returns: v.any(),
  permissionCode: REVIEW,
  target: { table: "hrLeaveRequests" },
  handler: async (ctx) => {
    const scope = await reviewScope(ctx);
    if (!scope.sites.complete)
      return { ok: false as const, code: "LIMIT_EXCEEDED" };
    const items = [];
    for (const status of ["PENDING", "CANCELLATION_REQUESTED"] as const) {
      const rows = await ctx.tenantDb
        .byIndex<Request>("hrLeaveRequests", "by_orgId_status_submittedAt", [
          { field: "status", value: status },
        ])
        .all(501);
      if (rows.length > 500)
        return { ok: false as const, code: "LIMIT_EXCEEDED" };
      for (const request of rows) {
        const employee = await ctx.tenantDb.get<Employee>(
          "hrEmployees",
          request.employeeId,
        );
        if (employee && reviewBlocker(scope, employee) === null)
          items.push({
            ...request,
            employeeName: employee.displayName,
            employeeCode: employee.code,
          });
      }
    }
    return {
      ok: true as const,
      items: items.sort((a, b) => b.submittedAt - a.submittedAt),
      complete: true,
    };
  },
});
/**
 * The leave review queue a page at a time: pending requests, then
 * cancellation requests, newest submission first within each. Requests the
 * actor may not review are skipped before paging, so no total cap applies.
 */
export const queuePage = queryWithOrg({
  args: { ...hrPageArgs },
  returns: v.any(),
  permissionCode: REVIEW,
  target: { table: "hrLeaveRequests" },
  handler: async (ctx, args) => {
    const input = hrListInput(args);
    if (!input.ok) return input;
    const scope = await reviewScope(ctx);
    // Exact site authorization: requests at sites beyond the preloaded scope
    // bound stay reachable, and a revoked site's requests disappear.
    const grants = new Map<string, Promise<boolean>>();
    const employees = new Map<string, Promise<Employee | null>>();
    const employeeOf = (id: string) => {
      let entry = employees.get(id);
      if (entry === undefined) {
        entry = ctx.tenantDb.get<Employee>("hrEmployees", id);
        employees.set(id, entry);
      }
      return entry;
    };
    const page = await hrScanPage(ctx, {
      surface: "leave-queue",
      criteria: {},
      pageSize: input.pageSize,
      cursor: args.cursor,
      scanCursor: args.scanCursor,
      table: "hrLeaveRequests",
      lanes: (["PENDING", "CANCELLATION_REQUESTED"] as const).map((status) => ({
        key: status,
        index: "by_orgId_status_submittedAt",
        equality: [{ field: "status", value: status }],
        order: "desc" as const,
      })),
      chunk: input.pageSize,
      match: async (request: Request) => {
        if (
          request.status !== "PENDING" &&
          request.status !== "CANCELLATION_REQUESTED"
        )
          return false;
        const employee = await employeeOf(request.employeeId);
        return (
          employee !== null &&
          (await reviewAccess(ctx, scope, employee, grants)) === null
        );
      },
      hydrate: async (request) => {
        const employee = await employeeOf(request.employeeId);
        return employee === null
          ? null
          : {
              ...request,
              employeeName: employee.displayName,
              employeeCode: employee.code,
            };
      },
    });
    return { ok: true as const, ...page };
  },
});
async function charge(
  ctx: TenantFunctionContext,
  request: Request,
  kind: "RESERVE" | "RELEASE" | "CONSUME" | "RESTORE",
  reason: string,
) {
  if (!request.accountId) return;
  const account = await ctx.tenantDb.get<Doc<"hrLeaveAccounts">>(
    "hrLeaveAccounts",
    request.accountId,
  );
  if (!account) throw new Error("Missing leave account");
  const delta =
    kind === "RESERVE"
      ? {
          used: 0,
          reserved: request.days,
          paidUsed: 0,
          paidReserved: request.paidDays,
        }
      : kind === "RELEASE"
        ? {
            used: 0,
            reserved: -request.days,
            paidUsed: 0,
            paidReserved: -request.paidDays,
          }
        : kind === "CONSUME"
          ? {
              used: request.days,
              reserved: -request.days,
              paidUsed: request.paidDays,
              paidReserved: -request.paidDays,
            }
          : {
              used: -request.days,
              reserved: 0,
              paidUsed: -request.paidDays,
              paidReserved: 0,
            };
  if (
    account.used + delta.used < 0 ||
    account.reserved + delta.reserved < 0 ||
    account.paidUsed + delta.paidUsed < 0 ||
    account.paidReserved + delta.paidReserved < 0
  )
    throw new Error("Leave ledger invariant violated");
  await ctx.tenantDb.patch("hrLeaveAccounts", account._id, {
    used: account.used + delta.used,
    reserved: account.reserved + delta.reserved,
    paidUsed: account.paidUsed + delta.paidUsed,
    paidReserved: account.paidReserved + delta.paidReserved,
    version: account.version + 1,
  });
  await ctx.tenantDb.insert("hrLeaveLedger", {
    accountId: account._id,
    employeeId: request.employeeId,
    leaveRequestId: request._id,
    leaveRequestVersion: request.version,
    kind,
    grantedDelta: 0,
    usedDelta: delta.used,
    reservedDelta: delta.reserved,
    paidUsedDelta: delta.paidUsed,
    paidReservedDelta: delta.paidReserved,
    at: Date.now(),
    actorUserId: ctx.tenant.actor._id,
    reason,
  });
  // A later HR correction must make restored carryover usable in the live
  // anniversary account rather than stranding it in a past year.
  const clock = orgClock(ctx);
  if (
    kind === "RESTORE" &&
    account.type === "ANNUAL" &&
    clock &&
    account.periodEnd < clock.today
  ) {
    const employee = await ctx.tenantDb.get<Employee>(
      "hrEmployees",
      request.employeeId,
    );
    const current = employee
      ? await leaveAccount(ctx, employee, "ANNUAL", clock.today)
      : null;
    if (current && current._id !== account._id) {
      await ctx.tenantDb.patch("hrLeaveAccounts", account._id, {
        granted: account.granted - request.days,
      });
      await ctx.tenantDb.patch("hrLeaveAccounts", current._id, {
        granted: current.granted + request.days,
        version: current.version + 1,
      });
      for (const [accountId, grantedDelta] of [
        [account._id, -request.days],
        [current._id, request.days],
      ] as const)
        await ctx.tenantDb.insert("hrLeaveLedger", {
          accountId,
          employeeId: request.employeeId,
          leaveRequestId: request._id,
          kind: "CARRYOVER",
          grantedDelta,
          usedDelta: 0,
          reservedDelta: 0,
          paidUsedDelta: 0,
          paidReservedDelta: 0,
          at: clock.now,
          actorUserId: ctx.tenant.actor._id,
          reason: `Restored annual days transferred to live account ${current._id}`,
        });
    }
  }
}
const leaveDraftArgs = {
  type: leaveTypeValidator,
  from: v.string(),
  to: v.string(),
  reason: v.string(),
  evidence: v.optional(v.string()),
  eventDate: v.optional(v.string()),
};
type LeaveDraft = {
  type: LeaveType;
  from: string;
  to: string;
  reason: string;
  evidence?: string;
  eventDate?: string;
};
/** One read-only planner drives preview, first submission and retained resubmission. */
async function planLeaveRequest(
  ctx: TenantFunctionContext,
  employee: Employee,
  args: LeaveDraft,
) {
  if (employee.status !== "ACTIVE") return fail("HR_EMPLOYEE_INACTIVE");
  const clock = orgClock(ctx);
  if (!clock) return fail("TIMEZONE_UNSUPPORTED");
  if (
    !isIsoDate(args.from) ||
    !isIsoDate(args.to) ||
    inclusiveDayCount(args.from, args.to) < 1 ||
    inclusiveDayCount(args.from, args.to) > 366
  )
    return fail("RANGE_INVALID");
  const policy = await activePolicy(ctx, "LEAVE", args.from);
  const currentPolicy = await activePolicy(ctx, "LEAVE", clock.today);
  if (!policy || !currentPolicy) return fail("POLICY_NOT_ACTIVE");
  const reason = cleanReason(args.reason);
  if (!reason) return fail("REASON_REQUIRED", "reason");
  const evidence = args.evidence?.trim();
  if (evidence && evidence.length > 1000) return fail("EVIDENCE_INVALID");
  if (args.type === "ANNUAL" && args.from < clock.today)
    return fail("ANNUAL_LEAVE_PAST_DATE");
  if (args.type === "TRAINING" && args.from < addDays(clock.today, 7))
    return fail("TRAINING_NOTICE_REQUIRED");
  if (
    ["SPOUSE", "NEWBORN_CARE", "MATERNITY"].includes(args.type) &&
    !isIsoDate(args.eventDate)
  )
    return fail("LEAVE_EVENT_DATE_REQUIRED", "eventDate");
  if (
    args.type === "SPOUSE" &&
    (args.from < args.eventDate! || args.from > addDays(args.eventDate!, 90))
  )
    return fail("SPOUSE_BIRTH_WINDOW_INVALID");
  if (
    ["NEWBORN_CARE", "STERILIZATION", "MILITARY"].includes(args.type) &&
    !evidence
  )
    return fail("EVIDENCE_REQUIRED", "evidence");
  const allDates = datesInRange(args.from, args.to);
  const snapshots = [];
  const dates: string[] = [];
  for (const date of allDates) {
    if (!isEmployedOn(employmentOf(employee), date))
      return fail("HR_OUTSIDE_EMPLOYMENT");
    if (await closedPeriodCovering(ctx, employee.warehouseId, date))
      return fail("HR_PERIOD_CLOSED");
    const day = await dayOf(ctx, employee._id, date);
    const plan = day
      ? day.plan
      : await livePlan(ctx, employee, date, clock.offset);
    if (plan.kind === "NONWORKING" && plan.reason === "NO_SCHEDULE")
      return fail("SCHEDULE_REQUIRED");
    if (plan.kind === "SCHEDULED" || args.type === "MATERNITY")
      dates.push(date);
    snapshots.push({
      date,
      ...(day ? { dayId: day._id } : {}),
      revision: day?.revision ?? 0,
      scheduled: plan.kind === "SCHEDULED",
      plan: day
        ? day.plan
        : storedPlan(await livePlan(ctx, employee, date, clock.offset)),
      ...("holidayName" in plan && plan.holidayName
        ? { holidayName: plan.holidayName }
        : {}),
    });
  }
  if (!dates.length) return fail("LEAVE_NO_WORKING_DAYS");
  for (const date of dates)
    if (await claimOf(ctx, employee._id, date)) return fail("LEAVE_OVERLAP");
  if (
    args.type === "SICK" &&
    dates.length >= 3 &&
    !evidence &&
    reason.length < 10
  )
    return fail("SICK_EVIDENCE_OR_EXPLANATION_REQUIRED");
  let account: Doc<"hrLeaveAccounts"> | null = null;
  let paidDays = dates.length;
  let payPercent = 100;
  if (ACCOUNT_TYPES.some((type) => type === args.type)) {
    const type = args.type as AccountType;
    const period = accountPeriod(type, employee.employmentStartDate, args.from);
    if (args.to > period.end) return fail("LEAVE_SPLIT_PERIOD_REQUIRED");
    account = await leaveAccount(ctx, employee, type, args.from);
    if (
      !account ||
      (account.baseGrant ?? account.granted) <
        grantFor(type, policy.config, period.eligible)
    )
      return fail("OPENING_BALANCE_REQUIRED");
    if (
      (type === "ANNUAL" || type === "PERSONAL") &&
      account.granted - account.used - account.reserved < dates.length
    )
      return fail("LEAVE_INSUFFICIENT_BALANCE");
    paidDays = Math.min(
      dates.length,
      Math.max(0, account.granted - account.paidUsed - account.paidReserved),
    );
  } else if (
    args.type === "MATERNITY" ||
    args.type === "SPOUSE" ||
    args.type === "NEWBORN_CARE"
  ) {
    const eventRows = (
      await eventRequests(ctx, employee._id, args.type, args.eventDate!)
    ).filter((row) => activeStatus(row.status));
    const daysUsed = eventRows.reduce((total, row) => total + row.days, 0);
    const paidUsed = eventRows.reduce((total, row) => total + row.paidDays, 0);
    const maximum =
      args.type === "MATERNITY"
        ? policy.config.maternityDays
        : args.type === "SPOUSE"
          ? policy.config.spouseDays
          : policy.config.newbornCareDays;
    if (daysUsed + dates.length > maximum) return fail("LEAVE_EVENT_LIMIT");
    if (args.type === "MATERNITY")
      paidDays = Math.min(
        dates.length,
        Math.max(0, policy.config.maternityPaidDays - paidUsed),
      );
    if (args.type === "NEWBORN_CARE") {
      const maternity = (
        await eventRequests(ctx, employee._id, "MATERNITY", args.eventDate!)
      )
        .filter(
          (row) =>
            row.type === "MATERNITY" &&
            row.eventDate === args.eventDate &&
            row.status === "APPROVED",
        )
        .sort((a, b) => b.to.localeCompare(a.to))[0];
      if (
        !maternity ||
        args.from <= maternity.to ||
        args.from < args.eventDate! ||
        maternity.to < args.eventDate!
      )
        return fail("NEWBORN_CARE_AFTER_MATERNITY_REQUIRED");
      payPercent = policy.config.newbornCarePayPercent;
    }
  } else if (args.type === "TRAINING") {
    paidDays = 0;
    payPercent = 0;
  }
  const fields = {
    employeeId: employee._id,
    warehouseId: employee.warehouseId,
    type: args.type,
    from: args.from,
    to: args.to,
    dates,
    days: dates.length,
    paidDays,
    payPercent,
    reason,
    ...(evidence ? { evidence } : {}),
    ...(args.eventDate ? { eventDate: args.eventDate } : {}),
    policyVersionId: policy._id,
    policyConfig: policy.config,
    ...(account ? { accountId: account._id } : {}),
    daySnapshots: snapshots,
  };
  const previewHash = await sha256Hex(
    JSON.stringify({
      fields,
      today: clock.today,
      currentPolicyId: currentPolicy._id,
      employeeVersion: employee.version,
      employment: employmentOf(employee),
      schedule: employee.schedule ?? null,
      account: account
        ? {
            id: account._id,
            version: account.version,
            granted: account.granted,
            baseGrant: account.baseGrant ?? account.granted,
            used: account.used,
            reserved: account.reserved,
            paidUsed: account.paidUsed,
            paidReserved: account.paidReserved,
          }
        : null,
    }),
  );
  return { fields, previewHash, now: clock.now };
}
async function returnedRequest(
  ctx: TenantFunctionContext,
  employee: Employee,
  id: string,
  expectedVersion: number,
) {
  const row = await ctx.tenantDb.get<Request>("hrLeaveRequests", id);
  if (!row || row.employeeId !== employee._id) return fail("NOT_FOUND");
  if (row.status !== "RETURNED" || row.version !== expectedVersion)
    return fail("LEAVE_STALE");
  if (row.version >= 100) return fail("LEAVE_REVISION_LIMIT");
  return { row };
}
async function selfReceipt(
  ctx: TenantFunctionContext,
  employee: Employee,
  id: string,
) {
  const row = await ctx.tenantDb.get<Request>("hrLeaveRequests", id);
  if (!row || row.employeeId !== employee._id) return fail("NOT_FOUND");
  return {
    version: row.version,
    status: row.status,
    days: row.days,
    paidDays: row.paidDays,
  };
}
async function reviewReceipt(ctx: TenantFunctionContext, id: string) {
  const row = await ctx.tenantDb.get<Request>("hrLeaveRequests", id);
  const employee = row
    ? await ctx.tenantDb.get<Employee>("hrEmployees", row.employeeId)
    : null;
  if (!row || !employee) return fail("NOT_FOUND");
  const blocker = await reviewAccess(ctx, await reviewScope(ctx), employee);
  return blocker ? fail(blocker) : { version: row.version, status: row.status };
}
export const preview = queryWithOrg({
  args: {
    ...leaveDraftArgs,
    leaveRequestId: v.optional(v.string()),
    expectedVersion: v.optional(v.number()),
  },
  returns: v.any(),
  permissionCode: SELF,
  target: { table: "hrLeaveRequests" },
  handler: async (ctx, args) => {
    const employee = await linkedEmployee(ctx);
    if (!employee) return { ok: false as const, code: "HR_NOT_LINKED" };
    let revision: number | undefined;
    if (args.leaveRequestId !== undefined) {
      if (args.expectedVersion === undefined)
        return { ok: false as const, code: "LEAVE_STALE" };
      const retained = await returnedRequest(
        ctx,
        employee,
        args.leaveRequestId,
        args.expectedVersion,
      );
      if ("written" in retained)
        return { ok: false as const, code: retained.error.code };
      revision = retained.row.version;
    } else if (args.expectedVersion !== undefined)
      return { ok: false as const, code: "LEAVE_STALE" };
    const plan = await planLeaveRequest(ctx, employee, args);
    if ("written" in plan) return { ok: false as const, code: plan.error.code };
    const previewHash =
      args.leaveRequestId === undefined
        ? plan.previewHash
        : await sha256Hex(
            `${plan.previewHash}:${args.leaveRequestId}:${revision}`,
          );
    return { ok: true as const, previewHash, ...plan.fields };
  },
});
export const submit = mutationWithOrg({
  args: {
    requestId: v.string(),
    expectedPreviewHash: v.string(),
    ...leaveDraftArgs,
  },
  returns: v.any(),
  permissionCode: SELF,
  target: { table: "hrLeaveRequests" },
  handler: async (ctx, args) => {
    const employee = await linkedEmployee(ctx);
    if (!employee) return fail("HR_NOT_LINKED");
    return await hrCommand(ctx, {
      operation: "hr.leave.submit",
      requestId: args.requestId,
      payload: { ...args, employeeId: employee._id },
      table: "hrLeaveRequests",
      replay: async (id) => selfReceipt(ctx, employee, id),
      run: async () => {
        const plan = await planLeaveRequest(ctx, employee, args);
        if ("written" in plan) return plan;
        if (!args.expectedPreviewHash) return fail("LEAVE_PREVIEW_REQUIRED");
        if (args.expectedPreviewHash !== plan.previewHash)
          return fail("LEAVE_PREVIEW_STALE");
        const id = await ctx.tenantDb.insert("hrLeaveRequests", {
          ...plan.fields,
          status: "PENDING",
          version: 1,
          history: [
            {
              action: "SUBMITTED",
              at: plan.now,
              actorUserId: ctx.tenant.actor._id,
            },
          ],
          submittedAt: plan.now,
          updatedAt: plan.now,
        });
        for (const date of plan.fields.dates)
          await ctx.tenantDb.insert("hrLeaveDayClaims", {
            employeeId: employee._id,
            businessDate: date,
            leaveRequestId: id,
          });
        const request = await ctx.tenantDb.getX<Request>("hrLeaveRequests", id);
        await charge(ctx, request, "RESERVE", "Leave submitted");
        return {
          documentId: id,
          warehouseId: employee.warehouseId,
          extra: {
            version: 1,
            status: "PENDING",
            days: plan.fields.days,
            paidDays: plan.fields.paidDays,
          },
          changes: [
            { field: "type", to: args.type },
            { field: "status", to: "PENDING" },
          ],
        };
      },
    });
  },
});
export const resubmit = mutationWithOrg({
  args: {
    requestId: v.string(),
    leaveRequestId: v.string(),
    expectedVersion: v.number(),
    expectedPreviewHash: v.string(),
    ...leaveDraftArgs,
  },
  returns: v.any(),
  permissionCode: SELF,
  target: { table: "hrLeaveRequests" },
  handler: async (ctx, args) => {
    const employee = await linkedEmployee(ctx);
    if (!employee) return fail("HR_NOT_LINKED");
    return await hrCommand(ctx, {
      operation: "hr.leave.resubmit",
      requestId: args.requestId,
      payload: { ...args, employeeId: employee._id },
      table: "hrLeaveRequests",
      replay: async (id) => selfReceipt(ctx, employee, id),
      run: async () => {
        const retained = await returnedRequest(
          ctx,
          employee,
          args.leaveRequestId,
          args.expectedVersion,
        );
        if ("written" in retained) return retained;
        const plan = await planLeaveRequest(ctx, employee, args);
        if ("written" in plan) return plan;
        const hash = await sha256Hex(
          `${plan.previewHash}:${args.leaveRequestId}:${retained.row.version}`,
        );
        if (!args.expectedPreviewHash) return fail("LEAVE_PREVIEW_REQUIRED");
        if (args.expectedPreviewHash !== hash)
          return fail("LEAVE_PREVIEW_STALE");
        const {
          _id: _originalId,
          _creationTime: _originalAt,
          orgId: _originalOrg,
          ...snapshot
        } = retained.row;
        await ctx.tenantDb.insert("hrLeaveRequestRevisions", {
          leaveRequestId: retained.row._id,
          version: retained.row.version,
          snapshot,
          archivedAt: plan.now,
          archivedByUserId: ctx.tenant.actor._id,
        });
        const version = retained.row.version + 1;
        await ctx.tenantDb.replace("hrLeaveRequests", retained.row._id, {
          ...plan.fields,
          status: "PENDING",
          version,
          history: [
            ...retained.row.history,
            {
              action: "RESUBMITTED",
              at: plan.now,
              actorUserId: ctx.tenant.actor._id,
            },
          ],
          submittedAt: plan.now,
          updatedAt: plan.now,
        });
        for (const date of plan.fields.dates)
          await ctx.tenantDb.insert("hrLeaveDayClaims", {
            employeeId: employee._id,
            businessDate: date,
            leaveRequestId: retained.row._id,
          });
        const request = await ctx.tenantDb.getX<Request>(
          "hrLeaveRequests",
          retained.row._id,
        );
        await charge(ctx, request, "RESERVE", "Returned leave resubmitted");
        return {
          documentId: retained.row._id,
          warehouseId: employee.warehouseId,
          extra: {
            version,
            status: "PENDING",
            days: plan.fields.days,
            paidDays: plan.fields.paidDays,
          },
          changes: [
            { field: "status", from: "RETURNED", to: "PENDING" },
            {
              field: "version",
              from: String(retained.row.version),
              to: String(version),
            },
          ],
        };
      },
    });
  },
});
export const cancel = mutationWithOrg({
  args: {
    requestId: v.string(),
    leaveRequestId: v.string(),
    expectedVersion: v.number(),
    reason: v.optional(v.string()),
  },
  returns: v.any(),
  permissionCode: SELF,
  target: { table: "hrLeaveRequests" },
  handler: async (ctx, args) => {
    const employee = await linkedEmployee(ctx);
    if (!employee) return fail("HR_NOT_LINKED");
    return await hrCommand(ctx, {
      operation: "hr.leave.cancel",
      requestId: args.requestId,
      payload: { ...args, employeeId: employee._id },
      table: "hrLeaveRequests",
      replay: async (id) => selfReceipt(ctx, employee, id),
      run: async () => {
        const row = await ctx.tenantDb.get<Request>(
          "hrLeaveRequests",
          args.leaveRequestId,
        );
        if (!row || row.employeeId !== employee._id) return fail("NOT_FOUND");
        if (row.version !== args.expectedVersion) return fail("LEAVE_STALE");
        const clock = orgClock(ctx);
        if (!clock) return fail("TIMEZONE_UNSUPPORTED");
        if (row.status !== "PENDING" && row.status !== "APPROVED")
          return fail("LEAVE_STALE");
        if (row.status === "APPROVED" && row.from <= clock.today)
          return fail("LEAVE_STARTED_HR_ADJUSTMENT_REQUIRED");
        const status =
          row.status === "PENDING" ? "WITHDRAWN" : "CANCELLATION_REQUESTED";
        if (status === "WITHDRAWN") {
          await releaseClaims(ctx, row);
          await charge(
            ctx,
            row,
            "RELEASE",
            "Employee withdrew undecided request",
          );
        }
        await ctx.tenantDb.patch("hrLeaveRequests", row._id, {
          status,
          version: row.version + 1,
          updatedAt: clock.now,
          history: [
            ...row.history,
            {
              action: status,
              at: clock.now,
              actorUserId: ctx.tenant.actor._id,
              ...(args.reason ? { reason: args.reason.slice(0, 1000) } : {}),
            },
          ],
        });
        return {
          documentId: row._id,
          warehouseId: employee.warehouseId,
          extra: { version: row.version + 1, status },
          changes: [{ field: "status", from: row.status, to: status }],
        };
      },
    });
  },
});
export const decide = mutationWithOrg({
  args: {
    requestId: v.string(),
    leaveRequestId: v.string(),
    expectedVersion: v.number(),
    decision: v.union(
      v.literal("APPROVE"),
      v.literal("RETURN"),
      v.literal("CONFIRM_CANCEL"),
      v.literal("KEEP"),
    ),
    reason: v.optional(v.string()),
  },
  returns: v.any(),
  permissionCode: REVIEW,
  target: { table: "hrLeaveRequests" },
  handler: async (ctx, args) =>
    hrCommand(ctx, {
      operation: "hr.leave.decide",
      requestId: args.requestId,
      payload: args,
      table: "hrLeaveRequests",
      replay: async (id) => reviewReceipt(ctx, id),
      run: async () => {
        const row = await ctx.tenantDb.get<Request>(
          "hrLeaveRequests",
          args.leaveRequestId,
        );
        if (!row) return fail("NOT_FOUND");
        const employee = await ctx.tenantDb.get<Employee>(
          "hrEmployees",
          row.employeeId,
        );
        if (!employee) return fail("NOT_FOUND");
        const blocker = await reviewAccess(
          ctx,
          await reviewScope(ctx),
          employee,
        );
        if (blocker) return fail(blocker);
        if (row.version !== args.expectedVersion) return fail("LEAVE_STALE");
        const clock = orgClock(ctx);
        if (!clock) return fail("TIMEZONE_UNSUPPORTED");
        const reason = args.reason ? cleanReason(args.reason) : null;
        if ((args.decision === "RETURN" || args.decision === "KEEP") && !reason)
          return fail("REASON_REQUIRED");
        if (
          row.status === "PENDING" &&
          args.decision !== "APPROVE" &&
          args.decision !== "RETURN"
        )
          return fail("LEAVE_STALE");
        if (
          row.status === "CANCELLATION_REQUESTED" &&
          args.decision !== "CONFIRM_CANCEL" &&
          args.decision !== "KEEP"
        )
          return fail("LEAVE_STALE");
        if (row.status !== "PENDING" && row.status !== "CANCELLATION_REQUESTED")
          return fail("LEAVE_STALE");
        let status: Request["status"];
        const attendanceRevisions = [];
        if (args.decision === "RETURN") {
          // Statutory notification/evidence types cannot be rejected like discretionary annual leave.
          if (
            row.type !== "ANNUAL" &&
            row.type !== "PERSONAL" &&
            row.type !== "TRAINING"
          )
            return fail("STATUTORY_LEAVE_EVIDENCE_REVIEW_REQUIRED");
          status = "RETURNED";
          await releaseClaims(ctx, row);
          await charge(ctx, row, "RELEASE", reason!);
        } else if (args.decision === "KEEP") {
          status = "APPROVED";
        } else {
          if (args.decision === "CONFIRM_CANCEL" && row.from <= clock.today)
            return fail("LEAVE_STARTED_HR_ADJUSTMENT_REQUIRED");
          for (const date of row.dates) {
            if (await closedPeriodCovering(ctx, employee.warehouseId, date))
              return fail("HR_PERIOD_CLOSED");
            const day = await dayOf(ctx, employee._id, date);
            const snapshot = row.daySnapshots.find(
              (item) => item.date === date,
            );
            if (args.decision === "APPROVE") {
              if (
                (day?.revision ?? 0) !== snapshot?.revision ||
                day?.clockInAt !== undefined ||
                day?.clockOutAt !== undefined ||
                day?.certification ||
                day?.pendingCorrectionId
              )
                return fail("LEAVE_ATTENDANCE_CONFLICT");
            } else {
              const applied = row.attendanceRevisions?.find(
                (item) => item.date === date,
              );
              if (
                !day ||
                day.revision !== applied?.revision ||
                day.approvedLeaveRequestId !== row._id
              )
                return fail("LEAVE_ATTENDANCE_CONFLICT");
              if ((day.certificationHistory?.length ?? 0) >= 50)
                return fail("CERTIFICATION_HISTORY_LIMIT");
            }
          }
          // All checks complete before any attendance mutation; refusals cannot leave partial writes.
          for (const date of row.dates) {
            const day = await ensureDay(ctx, employee, date, clock.offset);
            const revision = day.revision + 1;
            await ctx.tenantDb.patch("hrAttendanceDays", day._id, {
              revision,
              plan: row.daySnapshots.find((snapshot) => snapshot.date === date)!
                .plan,
              approvedLeaveRequestId:
                args.decision === "APPROVE" ? row._id : undefined,
              open: false,
              updatedAt: clock.now,
              certification:
                args.decision === "APPROVE"
                  ? {
                      disposition: "LEAVE",
                      revision,
                      reason: `Leave request ${row._id}`,
                      decidedByUserId: ctx.tenant.actor._id,
                      decidedAt: clock.now,
                    }
                  : undefined,
              ...(args.decision === "CONFIRM_CANCEL" && day.certification
                ? {
                    certificationHistory: [
                      ...(day.certificationHistory ?? []),
                      {
                        disposition: day.certification.disposition,
                        reason: day.certification.reason,
                        decidedByUserId: day.certification.decidedByUserId,
                        decidedAt: day.certification.decidedAt,
                      },
                    ],
                  }
                : {}),
            });
            attendanceRevisions.push({ date, revision });
          }
          status = args.decision === "APPROVE" ? "APPROVED" : "CANCELLED";
          if (status === "CANCELLED") await releaseClaims(ctx, row);
          await charge(
            ctx,
            row,
            args.decision === "APPROVE" ? "CONSUME" : "RESTORE",
            reason ?? args.decision,
          );
        }
        await ctx.tenantDb.patch("hrLeaveRequests", row._id, {
          status,
          version: row.version + 1,
          updatedAt: clock.now,
          ...(attendanceRevisions.length ? { attendanceRevisions } : {}),
          history: [
            ...row.history,
            {
              action: status,
              at: clock.now,
              actorUserId: ctx.tenant.actor._id,
              ...(reason ? { reason } : {}),
            },
          ],
        });
        await deliverNotification(ctx, {
          employeeId: row.employeeId,
          event: "LEAVE_DECIDED",
          title: "Leave request updated",
          resourceId: row._id,
          eventKey: `leave:${row._id}:${row.version + 1}`,
        });
        return {
          documentId: row._id,
          warehouseId: employee.warehouseId,
          extra: { version: row.version + 1, status },
          changes: [{ field: "status", from: row.status, to: status }],
        };
      },
    }),
});

/** New periods derive from captured, reconciled prior periods; never seed initial usage. */
export const renewEntitlements = mutationWithOrg({
  args: { requestId: v.string() },
  returns: v.any(),
  permissionCode: SELF,
  target: { table: "hrLeaveAccounts" },
  handler: async (ctx, args) => {
    const employee = await linkedEmployee(ctx);
    if (!employee) return fail("HR_NOT_LINKED");
    return await hrCommand(ctx, {
      operation: "hr.leave.renewEntitlements",
      requestId: args.requestId,
      payload: { employeeId: employee._id },
      table: "hrLeaveAccounts",
      replay: async (id) => {
        const account = await ctx.tenantDb.get<Doc<"hrLeaveAccounts">>(
          "hrLeaveAccounts",
          id,
        );
        return account?.employeeId === employee._id ? {} : fail("NOT_FOUND");
      },
      run: async () => {
        const clock = orgClock(ctx);
        if (!clock) return fail("TIMEZONE_UNSUPPORTED");
        const policy = await activePolicy(ctx, "LEAVE", clock.today);
        if (!policy) return fail("POLICY_NOT_ACTIVE");
        const changes = [];
        let documentId: string | undefined;
        // Validate the entire renewal before mutation, including unresolved reservations.
        const plans = [];
        const topups: {
          account: Doc<"hrLeaveAccounts">;
          delta: number;
          baseGrant: number;
        }[] = [];
        for (const type of ACCOUNT_TYPES) {
          const current = await leaveAccount(ctx, employee, type, clock.today);
          if (current) {
            documentId = current._id;
            const period = accountPeriod(
              type,
              employee.employmentStartDate,
              clock.today,
            );
            const baseGrant = grantFor(type, policy.config, period.eligible);
            const delta = Math.max(
              0,
              baseGrant - (current.baseGrant ?? current.granted),
            );
            if (delta) topups.push({ account: current, delta, baseGrant });
            continue;
          }
          const period = accountPeriod(
            type,
            employee.employmentStartDate,
            clock.today,
          );
          if (!(await activePolicy(ctx, "LEAVE", period.start)))
            return fail("OPENING_BALANCE_REQUIRED");
          const previous = await leaveAccount(
            ctx,
            employee,
            type,
            addDays(period.start, -1),
          );
          if (!previous && employee.employmentStartDate < period.start)
            return fail("OPENING_BALANCE_REQUIRED");
          if (type === "ANNUAL" && previous && previous.reserved > 0)
            return fail("ANNUAL_ROLLOVER_PENDING_RESERVATIONS");
          const carryover =
            type === "ANNUAL" && previous
              ? Math.max(
                  0,
                  previous.granted - previous.used - previous.reserved,
                )
              : 0;
          // Preserve an imported higher annual contractual benefit conservatively.
          const baseGrant = grantFor(type, policy.config, period.eligible);
          const granted =
            (type === "ANNUAL" && previous && period.eligible
              ? Math.max(baseGrant, previous.baseGrant ?? previous.granted)
              : baseGrant) + carryover;
          plans.push({
            type,
            period,
            previous,
            carryover,
            granted,
            baseGrant: granted - carryover,
          });
        }
        for (const topup of topups) {
          await ctx.tenantDb.patch("hrLeaveAccounts", topup.account._id, {
            granted: topup.account.granted + topup.delta,
            baseGrant: topup.baseGrant,
            version: topup.account.version + 1,
          });
          await ctx.tenantDb.insert("hrLeaveLedger", {
            accountId: topup.account._id,
            employeeId: employee._id,
            kind: "POLICY_GRANT",
            grantedDelta: topup.delta,
            usedDelta: 0,
            reservedDelta: 0,
            paidUsedDelta: 0,
            paidReservedDelta: 0,
            at: clock.now,
            actorUserId: ctx.tenant.actor._id,
            reason: `Effective policy ${policy._id} benefit increase`,
          });
          changes.push({ field: topup.account.type, to: String(topup.delta) });
        }
        for (const plan of plans) {
          const id = await ctx.tenantDb.insert("hrLeaveAccounts", {
            employeeId: employee._id,
            warehouseId: employee.warehouseId,
            type: plan.type,
            periodStart: plan.period.start,
            periodEnd: plan.period.end,
            granted: plan.granted,
            baseGrant: plan.baseGrant,
            used: 0,
            reserved: 0,
            paidUsed: 0,
            paidReserved: 0,
            asOf: plan.period.start,
            sourceReference: `Policy ${policy._id}; preserved annual carryover ${plan.carryover}`,
            version: 1,
            reconciledByUserId: ctx.tenant.actor._id,
            reconciledAt: clock.now,
          });
          documentId = id;
          await ctx.tenantDb.insert("hrLeaveLedger", {
            accountId: id,
            employeeId: employee._id,
            kind: "OPENING",
            grantedDelta: plan.granted,
            usedDelta: 0,
            reservedDelta: 0,
            paidUsedDelta: 0,
            paidReservedDelta: 0,
            at: clock.now,
            actorUserId: ctx.tenant.actor._id,
            reason: `Policy ${policy._id} period grant including preserved carryover ${plan.carryover}`,
          });
          if (plan.carryover && plan.previous) {
            await ctx.tenantDb.patch("hrLeaveAccounts", plan.previous._id, {
              granted: plan.previous.granted - plan.carryover,
              version: plan.previous.version + 1,
            });
            await ctx.tenantDb.insert("hrLeaveLedger", {
              accountId: plan.previous._id,
              employeeId: employee._id,
              kind: "CARRYOVER",
              grantedDelta: -plan.carryover,
              usedDelta: 0,
              reservedDelta: 0,
              paidUsedDelta: 0,
              paidReservedDelta: 0,
              at: clock.now,
              actorUserId: ctx.tenant.actor._id,
              reason: `Unused annual days transferred to ${id}`,
            });
          }
          changes.push({ field: plan.type, to: plan.period.start });
        }
        if (!documentId) return fail("OPENING_BALANCE_REQUIRED");
        return {
          documentId,
          warehouseId: employee.warehouseId,
          extra: { renewed: plans.length + topups.length },
          changes,
        };
      },
    });
  },
});

/** HR can correct started leave after a closed period has entered its existing revision flow. */
export const adjust = mutationWithOrg({
  args: {
    requestId: v.string(),
    leaveRequestId: v.string(),
    expectedVersion: v.number(),
    restoreDates: v.array(v.string()),
    reason: v.string(),
  },
  returns: v.any(),
  permissionCode: HR_PERMISSION.adminManage,
  target: { table: "hrLeaveRequests" },
  handler: async (ctx, args) =>
    hrCommand(ctx, {
      operation: "hr.leave.adjust",
      requestId: args.requestId,
      payload: args,
      table: "hrLeaveRequests",
      replay: async (id) => reviewReceipt(ctx, id),
      run: async () => {
        const row = await ctx.tenantDb.get<Request>(
          "hrLeaveRequests",
          args.leaveRequestId,
        );
        if (!row) return fail("NOT_FOUND");
        const employee = await ctx.tenantDb.get<Employee>(
          "hrEmployees",
          row.employeeId,
        );
        if (!employee) return fail("NOT_FOUND");
        const blocker = await reviewAccess(
          ctx,
          await reviewScope(ctx),
          employee,
        );
        if (blocker) return fail(blocker);
        if (!(await holds(ctx, HR_PERMISSION.adminManage)))
          return fail("NOT_FOUND");
        if (
          row.version !== args.expectedVersion ||
          !(
            row.status === "APPROVED" || row.status === "CANCELLATION_REQUESTED"
          )
        )
          return fail("LEAVE_STALE");
        const reason = cleanReason(args.reason);
        if (!reason) return fail("REASON_REQUIRED");
        const restore = [...new Set(args.restoreDates)];
        if (
          !restore.length ||
          restore.some((date) => !row.dates.includes(date))
        )
          return fail("LEAVE_ADJUST_DATES_INVALID");
        const clock = orgClock(ctx);
        if (!clock) return fail("TIMEZONE_UNSUPPORTED");
        for (const date of restore) {
          if (await closedPeriodCovering(ctx, employee.warehouseId, date))
            return fail("HR_PERIOD_CLOSED");
          const day = await dayOf(ctx, employee._id, date);
          if (
            !day ||
            day.approvedLeaveRequestId !== row._id ||
            day.revision !==
              row.attendanceRevisions?.find((item) => item.date === date)
                ?.revision
          )
            return fail("LEAVE_ATTENDANCE_CONFLICT");
          if ((day.certificationHistory?.length ?? 0) >= 50)
            return fail("CERTIFICATION_HISTORY_LIMIT");
        }
        const paidDates = row.dates.slice(0, row.paidDays);
        const paidRestored = restore.filter((date) =>
          paidDates.includes(date),
        ).length;
        for (const date of restore) {
          const day = (await dayOf(ctx, employee._id, date))!;
          await ctx.tenantDb.patch("hrAttendanceDays", day._id, {
            certification: undefined,
            approvedLeaveRequestId: undefined,
            revision: day.revision + 1,
            updatedAt: clock.now,
            ...(day.certification
              ? {
                  certificationHistory: [
                    ...(day.certificationHistory ?? []),
                    {
                      disposition: day.certification.disposition,
                      reason: day.certification.reason,
                      decidedByUserId: day.certification.decidedByUserId,
                      decidedAt: day.certification.decidedAt,
                    },
                  ],
                }
              : {}),
          });
        }
        await releaseClaims(ctx, row, restore);
        await charge(
          ctx,
          { ...row, days: restore.length, paidDays: paidRestored },
          "RESTORE",
          reason,
        );
        const dates = row.dates.filter((date) => !restore.includes(date));
        const status = dates.length ? "APPROVED" : "CANCELLED";
        await ctx.tenantDb.patch("hrLeaveRequests", row._id, {
          dates,
          days: dates.length,
          paidDays: row.paidDays - paidRestored,
          status,
          version: row.version + 1,
          updatedAt: clock.now,
          attendanceRevisions: row.attendanceRevisions?.filter(
            (item) => !restore.includes(item.date),
          ),
          history: [
            ...row.history,
            {
              action: "HR_ADJUSTMENT",
              at: clock.now,
              actorUserId: ctx.tenant.actor._id,
              reason: `${reason}; restored dates ${restore.join(", ")}`,
            },
          ],
        });
        await deliverNotification(ctx, {
          employeeId: row.employeeId,
          event: "LEAVE_DECIDED",
          title: "Leave request updated",
          resourceId: row._id,
          eventKey: `leave:${row._id}:${row.version + 1}`,
        });
        return {
          documentId: row._id,
          warehouseId: employee.warehouseId,
          extra: { version: row.version + 1, status },
          changes: [
            { field: "restoredDates", to: restore.join(",") },
            { field: "reason", to: reason },
          ],
        };
      },
    }),
});

async function requestRevisions(
  ctx: TenantFunctionContext,
  leaveRequestId: string,
) {
  const revisions = await ctx.tenantDb
    .byIndex<Doc<"hrLeaveRequestRevisions">>(
      "hrLeaveRequestRevisions",
      "by_orgId_leaveRequestId_version",
      [{ field: "leaveRequestId", value: leaveRequestId }],
    )
    .all(101);
  return revisions.map((revision) => ({
    version: revision.version,
    snapshot: revision.snapshot,
    archivedAt: revision.archivedAt,
  }));
}

export const detail = queryWithOrg({
  args: { leaveRequestId: v.string() },
  returns: v.any(),
  permissionCode: REVIEW,
  target: { table: "hrLeaveRequests" },
  handler: async (ctx, args) => {
    const request = await ctx.tenantDb.get<Request>(
      "hrLeaveRequests",
      args.leaveRequestId,
    );
    if (!request) return { ok: false as const, code: "NOT_FOUND" };
    const employee = await ctx.tenantDb.get<Employee>(
      "hrEmployees",
      request.employeeId,
    );
    if (
      !employee ||
      (await reviewAccess(ctx, await reviewScope(ctx), employee)) !== null
    )
      return { ok: false as const, code: "NOT_FOUND" };
    return {
      ok: true as const,
      request,
      employeeName: employee.displayName,
      employeeCode: employee.code,
      canAdjust: await holds(ctx, HR_PERMISSION.adminManage),
      revisions: await requestRevisions(ctx, request._id),
    };
  },
});

/** Exact retained employee history, independent of current policy activation. */
export const selfDetail = queryWithOrg({
  args: { leaveRequestId: v.string() },
  returns: v.any(),
  permissionCode: SELF,
  target: { table: "hrLeaveRequests" },
  handler: async (ctx, args) => {
    const employee = await linkedEmployee(ctx);
    if (!employee) return { ok: false as const, code: "HR_NOT_LINKED" };
    const request = await ctx.tenantDb.get<Request>(
      "hrLeaveRequests",
      args.leaveRequestId,
    );
    if (!request || request.employeeId !== employee._id)
      return { ok: false as const, code: "NOT_FOUND" };
    const clock = orgClock(ctx);
    if (!clock) return { ok: false as const, code: "TIMEZONE_UNSUPPORTED" };
    return {
      ok: true as const,
      item: request,
      today: clock.today,
      revisions: await requestRevisions(ctx, request._id),
    };
  },
});
