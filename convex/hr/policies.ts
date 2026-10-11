/** Immutable policy versions and explicit, audited opening-balance migration. */
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { HR_PERMISSION } from "../lib/permissions";
import {
  mutationWithOrg,
  queryWithOrg,
  type TenantFunctionContext,
} from "../lib/tenantFunctions";
import { isIsoDate } from "../model/hr/calendar";
import {
  ACCOUNT_TYPES,
  POLICY_PRESET,
  POLICY_SOURCES,
  accountPeriod,
  capabilityValidator,
  grantFor,
  policyConfigValidator,
  thailandDefaults,
  validatePolicy,
  type PolicyCapability,
} from "../model/hr/policy";
import { validateSchedule } from "../model/hr/schedule";
import {
  fail,
  hrCommand,
  inScope,
  orgClock,
  siteScope,
  type Employee,
} from "./shared";
const ADMIN = HR_PERMISSION.adminManage;
async function canReviewAs(
  ctx: TenantFunctionContext,
  userId: string,
  employee: Employee,
  requireAdmin = false,
) {
  if (employee.userId === userId) return false;
  const member = await ctx.members.get(userId);
  if (!member?.active) return false;
  const membership = await ctx.tenantDb.get<Doc<"memberships">>(
    "memberships",
    member.membershipId,
  );
  if (!membership) return false;
  if (
    membership.scopeMode !== "ORG_WIDE" &&
    !(await ctx.tenantDb
      .byIndex<Doc<"membershipWarehouses">>(
        "membershipWarehouses",
        "by_orgId_membershipId_warehouseId",
        [
          { field: "membershipId", value: membership._id },
          { field: "warehouseId", value: employee.warehouseId },
        ],
      )
      .unique())
  )
    return false;
  const grants = await ctx.tenantDb
    .byIndex<Doc<"membershipRoles">>(
      "membershipRoles",
      "by_orgId_membershipId_roleId",
      [{ field: "membershipId", value: membership._id }],
    )
    .take(32);
  for (const permissionCode of [
    HR_PERMISSION.teamReview,
    ...(requireAdmin ? [ADMIN] : []),
  ]) {
    let held = false;
    for (const grant of grants) {
      const role = await ctx.tenantDb.get<Doc<"roles">>("roles", grant.roleId);
      if (role?.status !== "ACTIVE") continue;
      if (
        await ctx.tenantDb
          .byIndex<Doc<"rolePermissions">>(
            "rolePermissions",
            "by_orgId_roleId_permissionCode",
            [
              { field: "roleId", value: role._id },
              { field: "permissionCode", value: permissionCode },
            ],
          )
          .unique()
      ) {
        held = true;
        break;
      }
    }
    if (!held) return false;
  }
  return true;
}
const draftOf = (ctx: TenantFunctionContext, capability: PolicyCapability) =>
  ctx.tenantDb
    .byIndex<Doc<"hrPolicyDrafts">>("hrPolicyDrafts", "by_orgId_capability", [
      { field: "capability", value: capability },
    ])
    .unique();
export async function policyVersions(
  ctx: TenantFunctionContext,
  capability: PolicyCapability,
) {
  const versions = await ctx.tenantDb
    .byIndex<Doc<"hrPolicyVersions">>(
      "hrPolicyVersions",
      "by_orgId_capability_effectiveDate",
      [{ field: "capability", value: capability }],
    )
    .all(101);
  return versions.length > 100 ? null : versions;
}
export async function activePolicy(
  ctx: TenantFunctionContext,
  capability: PolicyCapability,
  date: string,
) {
  const versions = await policyVersions(ctx, capability);
  return (
    versions
      ?.filter((version) => version.effectiveDate <= date)
      .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0] ?? null
  );
}
export async function leaveAccount(
  ctx: TenantFunctionContext,
  employee: Employee,
  type: (typeof ACCOUNT_TYPES)[number],
  date: string,
) {
  const period = accountPeriod(type, employee.employmentStartDate, date);
  return await ctx.tenantDb
    .byIndex<Doc<"hrLeaveAccounts">>(
      "hrLeaveAccounts",
      "by_orgId_employeeId_type_periodStart",
      [
        { field: "employeeId", value: employee._id },
        { field: "type", value: type },
        { field: "periodStart", value: period.start },
      ],
    )
    .unique();
}
async function readiness(
  ctx: TenantFunctionContext,
  capability: PolicyCapability,
  config: Doc<"hrPolicyDrafts">["config"],
  effectiveDate: string,
) {
  const blockers: string[] = [];
  if (ctx.tenant.membership.scopeMode !== "ORG_WIDE")
    blockers.push("POLICY_ORG_SCOPE_REQUIRED");
  if (capability === "PAYSLIPS") {
    if (process.env.HR_PAYSLIP_PROVIDER_FRESHNESS_ENABLED !== "true")
      blockers.push("PAYSLIP_PROVIDER_UNAVAILABLE");
    if (process.env.HR_PAYSLIP_PRIVATE_STORAGE_ENABLED !== "true")
      blockers.push("PAYSLIP_PRIVATE_STORAGE_UNAVAILABLE");
  }
  const employees: {
    id: string;
    code: string;
    displayName: string;
    warehouseId: string;
    employmentStartDate: string;
    accounts: Doc<"hrLeaveAccounts">[];
  }[] = [];
  if (capability !== "LEAVE") return { blockers, employees };
  const rows = await ctx.tenantDb
    .byIndex<Employee>("hrEmployees", "by_orgId_code")
    .all(501);
  if (rows.length > 500)
    return { blockers: [...blockers, "EMPLOYEE_LIMIT_EXCEEDED"], employees };
  const sites = new Set<string>();
  const previousPolicy = await activePolicy(ctx, "LEAVE", effectiveDate);
  for (const employee of rows) {
    if (
      employee.status !== "ACTIVE" ||
      employee.employmentStartDate > effectiveDate ||
      (employee.employmentEndDate && employee.employmentEndDate < effectiveDate)
    )
      continue;
    sites.add(employee.warehouseId);
    if (
      !employee.schedule ||
      !validateSchedule(employee.schedule).ok ||
      employee.schedule.workDays.length > 6
    )
      blockers.push(`SCHEDULE_REQUIRED:${employee.code}`);
    let reviewerReady = employee.supervisorUserId
      ? await canReviewAs(ctx, employee.supervisorUserId, employee)
      : false;
    if (!reviewerReady)
      reviewerReady = await canReviewAs(
        ctx,
        ctx.tenant.actor._id,
        employee,
        true,
      );
    if (!reviewerReady) {
      const members = await ctx.members.listActive(500);
      if (members)
        for (const member of members) {
          if (await canReviewAs(ctx, member.userId, employee, true)) {
            reviewerReady = true;
            break;
          }
        }
    }
    if (!reviewerReady) blockers.push(`REVIEWER_REQUIRED:${employee.code}`);
    const accounts = [];
    for (const type of ACCOUNT_TYPES) {
      const account = await leaveAccount(ctx, employee, type, effectiveDate);
      if (account) accounts.push(account);
      const period = accountPeriod(
        type,
        employee.employmentStartDate,
        effectiveDate,
      );
      if (
        !account ||
        (!previousPolicy && account.asOf !== effectiveDate) ||
        account.asOf > effectiveDate
      )
        blockers.push(`OPENING_REQUIRED:${employee.code}:${type}`);
      else if (
        !previousPolicy &&
        (account.baseGrant ?? account.granted) <
          grantFor(type, config, period.eligible)
      )
        blockers.push(`OPENING_BELOW_BENEFIT:${employee.code}:${type}`);
    }
    employees.push({
      id: employee._id,
      code: employee.code,
      displayName: employee.displayName,
      warehouseId: employee.warehouseId,
      employmentStartDate: employee.employmentStartDate,
      accounts,
    });
  }
  for (const warehouseId of sites) {
    const holidays = await ctx.tenantDb
      .byIndex<Doc<"hrHolidays">>("hrHolidays", "by_orgId_warehouseId_date", [
        { field: "warehouseId", value: warehouseId },
      ])
      .all(1001);
    const year = effectiveDate.slice(0, 4);
    const current = holidays.filter((holiday) =>
      holiday.date.startsWith(`${year}-`),
    );
    if (holidays.length > 1000)
      blockers.push(`HOLIDAY_LIMIT_EXCEEDED:${warehouseId}`);
    else if (
      new Set(current.map((holiday) => holiday.date)).size < 13 ||
      !current.some((holiday) => holiday.date === `${year}-05-01`)
    )
      blockers.push(`HOLIDAYS_REQUIRED:${warehouseId}`);
  }
  return { blockers: [...new Set(blockers)], employees };
}
export const current = queryWithOrg({
  args: { capability: capabilityValidator },
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrPolicyDrafts" },
  handler: async (ctx, args) => {
    const clock = orgClock(ctx);
    if (!clock) return { ok: false as const, code: "TIMEZONE_UNSUPPORTED" };
    if (ctx.tenant.membership.scopeMode !== "ORG_WIDE")
      return { ok: false as const, code: "POLICY_ORG_SCOPE_REQUIRED" };
    const stored = await draftOf(ctx, args.capability);
    const draft = stored ?? {
      config: thailandDefaults(),
      effectiveDate: clock.today,
      version: 0,
      preset: POLICY_PRESET,
    };
    return {
      ok: true as const,
      draft,
      active: await activePolicy(ctx, args.capability, clock.today),
      sources: POLICY_SOURCES,
      ...(await readiness(
        ctx,
        args.capability,
        draft.config,
        draft.effectiveDate,
      )),
    };
  },
});
export const saveDraft = mutationWithOrg({
  args: {
    requestId: v.string(),
    capability: capabilityValidator,
    expectedVersion: v.number(),
    effectiveDate: v.string(),
    config: policyConfigValidator,
  },
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrPolicyDrafts" },
  handler: async (ctx, args) =>
    hrCommand(ctx, {
      operation: "hr.policy.saveDraft",
      requestId: args.requestId,
      payload: args,
      table: "hrPolicyDrafts",
      replay: async (id) => {
        if (ctx.tenant.membership.scopeMode !== "ORG_WIDE")
          return fail("POLICY_ORG_SCOPE_REQUIRED");
        const row = await ctx.tenantDb.get<Doc<"hrPolicyDrafts">>(
          "hrPolicyDrafts",
          id,
        );
        return row ? { version: row.version } : null;
      },
      run: async () => {
        if (ctx.tenant.membership.scopeMode !== "ORG_WIDE")
          return fail("POLICY_ORG_SCOPE_REQUIRED");
        const clock = orgClock(ctx);
        if (!clock) return fail("TIMEZONE_UNSUPPORTED");
        if (!isIsoDate(args.effectiveDate) || args.effectiveDate < clock.today)
          return fail("POLICY_EFFECTIVE_DATE_INVALID", "effectiveDate");
        const stored = await draftOf(ctx, args.capability);
        if ((stored?.version ?? 0) !== args.expectedVersion)
          return fail("POLICY_STALE");
        const versions = await policyVersions(ctx, args.capability);
        if (!versions) return fail("POLICY_VERSION_LIMIT");
        for (const previous of versions.length ? versions : [undefined]) {
          const error = validatePolicy(args.config, previous?.config);
          if (error) return fail("POLICY_INVALID", error);
        }
        const fields = {
          capability: args.capability,
          config: args.config,
          effectiveDate: args.effectiveDate,
          version: args.expectedVersion + 1,
          preset: POLICY_PRESET,
          updatedAt: clock.now,
          updatedByUserId: ctx.tenant.actor._id,
        };
        const id = stored
          ? stored._id
          : await ctx.tenantDb.insert("hrPolicyDrafts", fields);
        if (stored) await ctx.tenantDb.patch("hrPolicyDrafts", id, fields);
        return {
          documentId: id,
          extra: { version: fields.version },
          changes: [
            { field: "version", to: String(fields.version) },
            { field: "capability", to: args.capability },
          ],
        };
      },
    }),
});
export const activate = mutationWithOrg({
  args: {
    requestId: v.string(),
    capability: capabilityValidator,
    expectedVersion: v.number(),
    coverageConfirmed: v.boolean(),
    existingBenefitsReviewed: v.boolean(),
  },
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrPolicyVersions" },
  handler: async (ctx, args) =>
    hrCommand(ctx, {
      operation: "hr.policy.activate",
      requestId: args.requestId,
      payload: args,
      table: "hrPolicyVersions",
      replay: async (id) => {
        if (ctx.tenant.membership.scopeMode !== "ORG_WIDE")
          return fail("POLICY_ORG_SCOPE_REQUIRED");
        const row = await ctx.tenantDb.get<Doc<"hrPolicyVersions">>(
          "hrPolicyVersions",
          id,
        );
        return row ? { version: row.version } : null;
      },
      run: async () => {
        if (!args.coverageConfirmed || !args.existingBenefitsReviewed)
          return fail("POLICY_CONFIRMATION_REQUIRED");
        const clock = orgClock(ctx);
        if (!clock) return fail("TIMEZONE_UNSUPPORTED");
        const draft = await draftOf(ctx, args.capability);
        if (!draft || draft.version !== args.expectedVersion)
          return fail("POLICY_STALE");
        if (draft.effectiveDate < clock.today)
          return fail("POLICY_EFFECTIVE_DATE_INVALID");
        const versions = await policyVersions(ctx, args.capability);
        if (!versions || versions.length >= 100)
          return fail("POLICY_VERSION_LIMIT");
        if (
          versions.some(
            (version) => version.effectiveDate >= draft.effectiveDate,
          )
        )
          return fail("POLICY_EFFECTIVE_DATE_CONFLICT");
        for (const previous of versions.length ? versions : [undefined]) {
          const error = validatePolicy(draft.config, previous?.config);
          if (error) return fail("POLICY_INVALID", error);
        }
        const ready = await readiness(
          ctx,
          args.capability,
          draft.config,
          draft.effectiveDate,
        );
        if (ready.blockers.length)
          return fail("POLICY_NOT_READY", undefined, ready.blockers.join(", "));
        const version = versions.length + 1;
        const documentId = await ctx.tenantDb.insert("hrPolicyVersions", {
          capability: args.capability,
          config: draft.config,
          effectiveDate: draft.effectiveDate,
          version,
          draftVersion: draft.version,
          preset: draft.preset,
          coverageConfirmed: true,
          existingBenefitsReviewed: true,
          activatedAt: clock.now,
          activatedByUserId: ctx.tenant.actor._id,
        });
        return {
          documentId,
          extra: { version },
          changes: [
            { field: "capability", to: args.capability },
            { field: "effectiveDate", to: draft.effectiveDate },
            { field: "version", to: String(version) },
          ],
        };
      },
    }),
});
export const reconcileOpening = mutationWithOrg({
  args: {
    requestId: v.string(),
    employeeId: v.string(),
    type: v.union(
      v.literal("ANNUAL"),
      v.literal("SICK"),
      v.literal("PERSONAL"),
      v.literal("MILITARY"),
    ),
    asOf: v.string(),
    granted: v.number(),
    baseGrant: v.optional(v.number()),
    used: v.number(),
    reserved: v.number(),
    paidUsed: v.number(),
    paidReserved: v.number(),
    sourceReference: v.string(),
    expectedVersion: v.number(),
  },
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrLeaveAccounts" },
  handler: async (ctx, args) =>
    hrCommand(ctx, {
      operation: "hr.leave.reconcileOpening",
      requestId: args.requestId,
      payload: args,
      table: "hrLeaveAccounts",
      replay: async (id) => {
        const row = await ctx.tenantDb.get<Doc<"hrLeaveAccounts">>(
          "hrLeaveAccounts",
          id,
        );
        return row && inScope(await siteScope(ctx), row.warehouseId)
          ? { version: row.version }
          : fail("NOT_FOUND");
      },
      run: async () => {
        const clock = orgClock(ctx);
        if (!clock) return fail("TIMEZONE_UNSUPPORTED");
        if (!isIsoDate(args.asOf)) return fail("DATE_INVALID", "asOf");
        const employee = await ctx.tenantDb.get<Employee>(
          "hrEmployees",
          args.employeeId,
        );
        if (!employee || !inScope(await siteScope(ctx), employee.warehouseId))
          return fail("NOT_FOUND");
        if (
          args.asOf < employee.employmentStartDate ||
          (employee.employmentEndDate && args.asOf > employee.employmentEndDate)
        )
          return fail("HR_OUTSIDE_EMPLOYMENT");
        const source = args.sourceReference.trim();
        if (source.length < 3 || source.length > 300)
          return fail("OPENING_SOURCE_REQUIRED", "sourceReference");
        for (const value of [
          args.granted,
          args.used,
          args.reserved,
          args.paidUsed,
          args.paidReserved,
        ])
          if (!Number.isSafeInteger(value) || value < 0 || value > 10000)
            return fail("OPENING_INVALID");
        if (
          args.paidUsed > args.used ||
          args.paidReserved > args.reserved ||
          args.paidUsed + args.paidReserved > args.granted
        )
          return fail("OPENING_INVALID");
        if (
          (args.type === "ANNUAL" || args.type === "PERSONAL") &&
          args.used + args.reserved > args.granted
        )
          return fail("OPENING_INVALID");
        if (
          (args.type === "ANNUAL" || args.type === "PERSONAL") &&
          (args.paidUsed !== args.used || args.paidReserved !== args.reserved)
        )
          return fail("OPENING_INVALID");
        if (
          args.baseGrant !== undefined &&
          (!Number.isSafeInteger(args.baseGrant) ||
            args.baseGrant < 0 ||
            args.baseGrant > args.granted)
        )
          return fail("OPENING_INVALID", "baseGrant");
        const period = accountPeriod(
          args.type,
          employee.employmentStartDate,
          args.asOf,
        );
        const effectivePolicy = await activePolicy(ctx, "LEAVE", args.asOf);
        if (
          effectivePolicy &&
          (args.baseGrant ?? args.granted) <
            grantFor(args.type, effectivePolicy.config, period.eligible)
        )
          return fail("OPENING_BELOW_BENEFIT");
        const stored = await leaveAccount(ctx, employee, args.type, args.asOf);
        if ((stored?.version ?? 0) !== args.expectedVersion)
          return fail("OPENING_STALE");
        // Once requests have charged an account, a migration cannot replace it.
        if (stored) {
          const entries = await ctx.tenantDb
            .byIndex<Doc<"hrLeaveLedger">>(
              "hrLeaveLedger",
              "by_orgId_accountId",
              [{ field: "accountId", value: stored._id }],
            )
            .take(2);
          if (entries.some((entry) => entry.kind !== "OPENING"))
            return fail("OPENING_ALREADY_IN_USE");
        }
        if (stored && (await activePolicy(ctx, "LEAVE", args.asOf)))
          return fail("OPENING_ACTIVE_POLICY_LOCKED");
        const fields = {
          employeeId: employee._id,
          warehouseId: employee.warehouseId,
          type: args.type,
          periodStart: period.start,
          periodEnd: period.end,
          granted: args.granted,
          baseGrant: args.baseGrant ?? args.granted,
          used: args.used,
          reserved: args.reserved,
          paidUsed: args.paidUsed,
          paidReserved: args.paidReserved,
          asOf: args.asOf,
          sourceReference: source,
          version: args.expectedVersion + 1,
          reconciledByUserId: ctx.tenant.actor._id,
          reconciledAt: clock.now,
        };
        const id = stored
          ? stored._id
          : await ctx.tenantDb.insert("hrLeaveAccounts", fields);
        if (stored) await ctx.tenantDb.patch("hrLeaveAccounts", id, fields);
        await ctx.tenantDb.insert("hrLeaveLedger", {
          accountId: id,
          employeeId: employee._id,
          kind: "OPENING",
          grantedDelta: args.granted - (stored?.granted ?? 0),
          usedDelta: args.used - (stored?.used ?? 0),
          reservedDelta: args.reserved - (stored?.reserved ?? 0),
          paidUsedDelta: args.paidUsed - (stored?.paidUsed ?? 0),
          paidReservedDelta: args.paidReserved - (stored?.paidReserved ?? 0),
          at: clock.now,
          actorUserId: ctx.tenant.actor._id,
          reason: source,
        });
        return {
          documentId: id,
          warehouseId: employee.warehouseId,
          extra: { version: fields.version },
          changes: [
            { field: "sourceReference", to: source },
            { field: "type", to: args.type },
            { field: "periodStart", to: period.start },
          ],
        };
      },
    }),
});
