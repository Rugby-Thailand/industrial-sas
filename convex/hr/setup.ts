/**
 * HR administration: employee registry, schedules, site holidays and HR
 * access grants. All functions require `hr.admin.manage`; every referenced
 * site, member and supervisor is re-validated against the active organization
 * and the administrator's site scope.
 */
import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import { MEMBERSHIP_ROLE_LIMIT } from "../lib/authorization";
import { HR_PERMISSION } from "../lib/permissions";
import {
  mutationWithOrg,
  queryWithOrg,
  type TenantFunctionContext,
} from "../lib/tenantFunctions";
import { isIsoDate } from "../model/hr/calendar";
import { MAX_NAME_LENGTH, validateEmployeeDraft } from "../model/hr/employee";
import { validateSchedule } from "../model/hr/schedule";
import {
  MAX_SITE_EMPLOYEES,
  fail,
  hrCommand,
  inScope,
  memberName,
  scopedSites,
  siteOf,
  siteScope,
  type Employee,
} from "./shared";

const ADMIN = HR_PERMISSION.adminManage;
const MAX_MEMBERS = 200;
const MAX_SITE_HOLIDAYS = 99;
const GRANTABLE_ROLES = ["HR_EMPLOYEE", "HR_SUPERVISOR"] as const;

const scheduleValidator = v.object({
  workDays: v.array(v.number()),
  startTime: v.string(),
  endTime: v.string(),
  endsNextDay: v.boolean(),
  breakMinutes: v.number(),
});

/** One employee as the registry and the editor show it. */
async function employeeItem(
  ctx: TenantFunctionContext,
  employee: Employee,
  site: Doc<"warehouses">,
  names: Map<string, string | null>,
) {
  const member =
    employee.userId === undefined
      ? null
      : await ctx.members.get(employee.userId);
  return {
    id: employee._id,
    code: employee.code,
    displayName: employee.displayName,
    status: employee.status,
    siteId: site._id,
    siteCode: site.code,
    linkedUserId: employee.userId,
    linkedName: member?.displayName,
    linkedActive: member?.active ?? false,
    supervisorUserId: employee.supervisorUserId,
    supervisorName: await memberName(ctx, employee.supervisorUserId, names),
    employmentStartDate: employee.employmentStartDate,
    employmentEndDate: employee.employmentEndDate,
    schedule: employee.schedule,
    version: employee.version,
  };
}

export const listEmployees = queryWithOrg({
  args: { warehouseId: v.optional(v.id("warehouses")) },
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrEmployees" },
  handler: async (ctx, args) => {
    const scope = await siteScope(ctx);
    const list = await scopedSites(ctx, scope);
    const sites = list.sites.filter(
      (site) => args.warehouseId === undefined || site._id === args.warehouseId,
    );
    const names = new Map<string, string | null>();
    const items = [];
    let complete = list.complete;
    for (const site of sites) {
      const rows = await ctx.tenantDb
        .byIndex<Employee>("hrEmployees", "by_orgId_warehouseId_code", [
          { field: "warehouseId", value: site._id },
        ])
        .take(MAX_SITE_EMPLOYEES + 1);
      if (rows.length > MAX_SITE_EMPLOYEES) complete = false;
      for (const employee of rows.slice(0, MAX_SITE_EMPLOYEES))
        items.push(await employeeItem(ctx, employee, site, names));
    }
    return {
      items,
      complete,
      sites: sites.map((site) => ({
        id: site._id,
        code: site.code,
        name: site.name,
      })),
    };
  },
});

/**
 * One employee for the editor by ID, independent of the bounded registry
 * list, so a deep link opens a record beyond its first page. The ID is a
 * string so a malformed link answers NOT_FOUND instead of throwing.
 */
export const employee = queryWithOrg({
  args: { employeeId: v.string() },
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrEmployees" },
  handler: async (ctx, args) => {
    const record = await ctx.tenantDb.get<Employee>(
      "hrEmployees",
      args.employeeId,
    );
    const scope = await siteScope(ctx);
    if (record === null || !inScope(scope, record.warehouseId))
      return { ok: false as const, code: "NOT_FOUND" };
    const site = await ctx.tenantDb.get<Doc<"warehouses">>(
      "warehouses",
      record.warehouseId,
    );
    // The registry lists active sites only; the editor follows the same rule.
    if (site === null || site.status !== "ACTIVE")
      return { ok: false as const, code: "NOT_FOUND" };
    return {
      ok: true as const,
      employee: await employeeItem(ctx, record, site, new Map()),
    };
  },
});

export const employeeHistory = queryWithOrg({
  args: { employeeId: v.id("hrEmployees") },
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrEmployees" },
  handler: async (ctx, args) => {
    const employee = await ctx.tenantDb.get<Employee>(
      "hrEmployees",
      args.employeeId,
    );
    if (
      employee === null ||
      !inScope(await siteScope(ctx), employee.warehouseId)
    )
      return { ok: false as const, code: "NOT_FOUND" };
    const rows = await ctx.tenantDb
      .byIndex<Doc<"auditEvents">>(
        "auditEvents",
        "by_orgId_entityTable_entityId_occurredAt",
        [
          { field: "entityTable", value: "hrEmployees" },
          { field: "entityId", value: employee._id },
        ],
      )
      .page({ limit: 20, order: "desc" });
    const names = new Map<string, string | null>();
    return {
      ok: true as const,
      // The newest 20 changes; older ones are reported, not silently dropped.
      complete: rows.isDone,
      items: await Promise.all(
        rows.page
          .filter(
            (row) =>
              row.outcome === "ALLOWED" &&
              row.action === "hr.employee.save" &&
              (row.changes?.length ?? 0) > 0,
          )
          .map(async (row) => ({
            at: row.occurredAt,
            action: row.action,
            actorName: await memberName(ctx, row.actorUserId, names),
            changes: row.changes ?? [],
          })),
      ),
    };
  },
});

export const memberOptions = queryWithOrg({
  args: {},
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrEmployees" },
  handler: async (ctx) => {
    const members = await ctx.members.listActive(MAX_MEMBERS);
    if (members === null) return { ok: false as const, code: "LIMIT_EXCEEDED" };
    const items = [];
    for (const member of members) {
      const linked = await ctx.tenantDb
        .byIndex<Employee>("hrEmployees", "by_orgId_userId", [
          { field: "userId", value: member.userId },
        ])
        .unique();
      items.push({
        userId: member.userId,
        displayName: member.displayName,
        linkedEmployeeId: linked?._id,
        linkedEmployeeCode: linked?.code,
      });
    }
    items.sort((a, b) => a.displayName.localeCompare(b.displayName));
    return { ok: true as const, items };
  },
});

const diff = (
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
) =>
  Object.keys(after)
    .filter(
      (key) => JSON.stringify(before?.[key]) !== JSON.stringify(after[key]),
    )
    .map((key) => ({
      field: key,
      ...(before?.[key] === undefined
        ? {}
        : { from: JSON.stringify(before[key]) }),
      ...(after[key] === undefined ? {} : { to: JSON.stringify(after[key]) }),
    }));

export const saveEmployee = mutationWithOrg({
  args: {
    requestId: v.string(),
    employeeId: v.optional(v.id("hrEmployees")),
    expectedVersion: v.optional(v.number()),
    warehouseId: v.id("warehouses"),
    code: v.string(),
    displayName: v.string(),
    userId: v.optional(v.id("users")),
    supervisorUserId: v.optional(v.id("users")),
    employmentStartDate: v.string(),
    employmentEndDate: v.optional(v.string()),
    status: v.union(v.literal("ACTIVE"), v.literal("INACTIVE")),
    schedule: v.optional(scheduleValidator),
  },
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrEmployees", id: (args) => args.employeeId },
  handler: async (ctx, args) =>
    hrCommand(ctx, {
      operation: "hr.employee.save",
      requestId: args.requestId,
      payload: { ...args, requestId: undefined },
      table: "hrEmployees",
      warehouseId: args.warehouseId,
      run: async () => {
        const draft = validateEmployeeDraft(args);
        if (!draft.ok) return fail(draft.error.code, draft.error.field);
        let schedule = undefined;
        if (args.schedule !== undefined) {
          const valid = validateSchedule(args.schedule);
          if (!valid.ok)
            return fail(
              valid.error.code,
              "field" in valid.error ? valid.error.field : "schedule",
            );
          schedule = {
            workDays: [...valid.value.workDays],
            startTime: valid.value.startTime,
            endTime: valid.value.endTime,
            endsNextDay: valid.value.endsNextDay,
            breakMinutes: valid.value.breakMinutes,
          };
        }
        const scope = await siteScope(ctx);
        const site = await siteOf(ctx, scope, args.warehouseId);
        if (site === null) return fail("SITE_UNAVAILABLE", "warehouseId");

        const before =
          args.employeeId === undefined
            ? null
            : await ctx.tenantDb.get<Employee>("hrEmployees", args.employeeId);
        if (args.employeeId !== undefined) {
          if (before === null || !inScope(scope, before.warehouseId))
            return fail("NOT_FOUND", "employeeId");
          if (before.version !== args.expectedVersion)
            return fail("EMPLOYEE_STALE");
          if (before.warehouseId !== args.warehouseId) {
            const recorded = await ctx.tenantDb
              .byIndex<Doc<"hrAttendanceDays">>(
                "hrAttendanceDays",
                "by_orgId_employeeId_businessDate",
                [{ field: "employeeId", value: before._id }],
              )
              .first();
            if (recorded !== null)
              return fail("EMPLOYEE_SITE_LOCKED", "warehouseId");
          }
        }

        const sameCode = await ctx.tenantDb
          .byIndex<Employee>("hrEmployees", "by_orgId_code", [
            { field: "code", value: draft.value.code },
          ])
          .unique();
        if (sameCode !== null && sameCode._id !== before?._id)
          return fail("EMPLOYEE_CODE_TAKEN", "code");

        if (args.userId !== undefined) {
          const member = await ctx.members.get(args.userId);
          if (member === null || !member.active)
            return fail("MEMBER_UNAVAILABLE", "userId");
          const linked = await ctx.tenantDb
            .byIndex<Employee>("hrEmployees", "by_orgId_userId", [
              { field: "userId", value: args.userId },
            ])
            .unique();
          if (linked !== null && linked._id !== before?._id)
            return fail("MEMBER_ALREADY_LINKED", "userId");
        }
        if (args.supervisorUserId !== undefined) {
          const supervisor = await ctx.members.get(args.supervisorUserId);
          if (supervisor === null || !supervisor.active)
            return fail("SUPERVISOR_UNAVAILABLE", "supervisorUserId");
        }

        const fields = {
          warehouseId: site._id,
          code: draft.value.code,
          displayName: draft.value.displayName,
          userId: args.userId,
          supervisorUserId: args.supervisorUserId,
          employmentStartDate: args.employmentStartDate,
          employmentEndDate: args.employmentEndDate,
          status: args.status,
          schedule,
        };
        const now = Date.now();
        const actor = ctx.tenant.actor._id;
        let id: Id<"hrEmployees">;
        if (before === null) {
          id = (await ctx.tenantDb.insert("hrEmployees", {
            ...fields,
            version: 1,
            createdAt: now,
            createdByUserId: actor,
            updatedAt: now,
            updatedByUserId: actor,
          })) as Id<"hrEmployees">;
        } else {
          id = before._id;
          await ctx.tenantDb.patch("hrEmployees", before._id, {
            ...fields,
            version: before.version + 1,
            updatedAt: now,
            updatedByUserId: actor,
          });
        }
        return {
          documentId: id,
          warehouseId: site._id,
          changes: diff(before as Record<string, unknown> | null, fields),
        };
      },
    }),
});

export const listHolidays = queryWithOrg({
  args: { warehouseId: v.id("warehouses") },
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrHolidays" },
  handler: async (ctx, args) => {
    const site = await siteOf(ctx, await siteScope(ctx), args.warehouseId);
    if (site === null) return { ok: false as const, code: "SITE_UNAVAILABLE" };
    const rows = await ctx.tenantDb
      .byIndex<Doc<"hrHolidays">>("hrHolidays", "by_orgId_warehouseId_date", [
        { field: "warehouseId", value: site._id },
      ])
      .take(MAX_SITE_HOLIDAYS + 1, "desc");
    // Newest dates first; `complete: false` says older holidays exist.
    return {
      ok: true as const,
      complete: rows.length <= MAX_SITE_HOLIDAYS,
      items: rows
        .slice(0, MAX_SITE_HOLIDAYS)
        .map((row) => ({ id: row._id, date: row.date, name: row.name })),
    };
  },
});

export const saveHoliday = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    date: v.string(),
    name: v.string(),
  },
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrHolidays" },
  handler: async (ctx, args) =>
    hrCommand(ctx, {
      operation: "hr.holiday.save",
      requestId: args.requestId,
      payload: {
        warehouseId: args.warehouseId,
        date: args.date,
        name: args.name,
      },
      table: "hrHolidays",
      warehouseId: args.warehouseId,
      run: async () => {
        const site = await siteOf(ctx, await siteScope(ctx), args.warehouseId);
        if (site === null) return fail("SITE_UNAVAILABLE", "warehouseId");
        if (!isIsoDate(args.date)) return fail("DATE_INVALID", "date");
        const name = args.name.trim();
        if (name.length < 1 || name.length > MAX_NAME_LENGTH)
          return fail("HOLIDAY_NAME_INVALID", "name");
        const existing = await ctx.tenantDb
          .byIndex<Doc<"hrHolidays">>(
            "hrHolidays",
            "by_orgId_warehouseId_date",
            [
              { field: "warehouseId", value: site._id },
              { field: "date", value: args.date },
            ],
          )
          .unique();
        if (existing !== null) {
          await ctx.tenantDb.patch("hrHolidays", existing._id, { name });
          return {
            documentId: existing._id,
            changes: [{ field: "name", from: existing.name, to: name }],
          };
        }
        const id = await ctx.tenantDb.insert("hrHolidays", {
          warehouseId: site._id,
          date: args.date,
          name,
          createdAt: Date.now(),
          createdByUserId: ctx.tenant.actor._id,
        });
        return {
          documentId: id,
          changes: [
            { field: "date", to: args.date },
            { field: "name", to: name },
          ],
        };
      },
    }),
});

export const deleteHoliday = mutationWithOrg({
  args: { requestId: v.string(), holidayId: v.id("hrHolidays") },
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrHolidays", id: (args) => args.holidayId },
  handler: async (ctx, args) =>
    hrCommand(ctx, {
      operation: "hr.holiday.delete",
      requestId: args.requestId,
      payload: { holidayId: args.holidayId },
      table: "hrHolidays",
      run: async () => {
        const holiday = await ctx.tenantDb.get<Doc<"hrHolidays">>(
          "hrHolidays",
          args.holidayId,
        );
        if (
          holiday === null ||
          !inScope(await siteScope(ctx), holiday.warehouseId)
        )
          return fail("NOT_FOUND", "holidayId");
        await ctx.tenantDb.delete("hrHolidays", holiday._id);
        return {
          documentId: holiday._id,
          warehouseId: holiday.warehouseId,
          changes: [
            { field: "date", from: holiday.date },
            { field: "name", from: holiday.name },
          ],
        };
      },
    }),
});

async function hrRoles(ctx: TenantFunctionContext) {
  const roles = new Map<string, Doc<"roles">>();
  for (const key of [...GRANTABLE_ROLES, "HR_ADMIN", "ORG_ADMIN"]) {
    const role = await ctx.tenantDb
      .byIndex<Doc<"roles">>("roles", "by_orgId_key", [
        { field: "key", value: key },
      ])
      .unique();
    if (role !== null) roles.set(key, role);
  }
  return roles;
}

export const accessMembers = queryWithOrg({
  args: {},
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "membershipRoles" },
  handler: async (ctx) => {
    const members = await ctx.members.listActive(MAX_MEMBERS);
    if (members === null) return { ok: false as const, code: "LIMIT_EXCEEDED" };
    const roles = await hrRoles(ctx);
    const byId = new Map(
      [...roles.values()].map((role) => [role._id, role.key]),
    );
    const items = [];
    for (const member of members) {
      const grants = await ctx.tenantDb
        .byIndex<Doc<"membershipRoles">>(
          "membershipRoles",
          "by_orgId_membershipId_roleId",
          [{ field: "membershipId", value: member.membershipId }],
        )
        .take(MEMBERSHIP_ROLE_LIMIT);
      const keys = grants
        .map((grant) => byId.get(grant.roleId))
        .filter((key): key is string => key !== undefined);
      items.push({
        userId: member.userId,
        displayName: member.displayName,
        roles: keys,
      });
    }
    items.sort((a, b) => a.displayName.localeCompare(b.displayName));
    return {
      ok: true as const,
      provisioned: GRANTABLE_ROLES.every(
        (key) => roles.get(key)?.status === "ACTIVE",
      ),
      items,
    };
  },
});

export const setMemberAccess = mutationWithOrg({
  args: {
    requestId: v.string(),
    userId: v.id("users"),
    role: v.union(v.literal("HR_EMPLOYEE"), v.literal("HR_SUPERVISOR")),
    granted: v.boolean(),
  },
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "membershipRoles" },
  handler: async (ctx, args) =>
    hrCommand(ctx, {
      operation: "hr.access.set",
      requestId: args.requestId,
      payload: { userId: args.userId, role: args.role, granted: args.granted },
      table: "membershipRoles",
      run: async () => {
        const member = await ctx.members.get(args.userId);
        if (member === null || !member.active)
          return fail("MEMBER_UNAVAILABLE", "userId");
        const role = (await hrRoles(ctx)).get(args.role);
        if (role === undefined || role.status !== "ACTIVE")
          return fail("HR_ROLES_NOT_PROVISIONED");
        const existing = await ctx.tenantDb
          .byIndex<Doc<"membershipRoles">>(
            "membershipRoles",
            "by_orgId_membershipId_roleId",
            [
              { field: "membershipId", value: member.membershipId },
              { field: "roleId", value: role._id },
            ],
          )
          .unique();
        if (args.granted && existing === null) {
          const grants = await ctx.tenantDb
            .byIndex<Doc<"membershipRoles">>(
              "membershipRoles",
              "by_orgId_membershipId_roleId",
              [{ field: "membershipId", value: member.membershipId }],
            )
            .take(MEMBERSHIP_ROLE_LIMIT);
          if (grants.length >= MEMBERSHIP_ROLE_LIMIT)
            return fail("ROLE_LIMIT_REACHED");
          const id = await ctx.tenantDb.insert("membershipRoles", {
            membershipId: member.membershipId,
            roleId: role._id,
            grantedAt: Date.now(),
            grantedByUserId: ctx.tenant.actor._id,
          });
          return {
            documentId: id,
            changes: [{ field: args.role, from: "false", to: "true" }],
          };
        }
        if (!args.granted && existing !== null) {
          await ctx.tenantDb.delete("membershipRoles", existing._id);
          return {
            documentId: existing._id,
            changes: [{ field: args.role, from: "true", to: "false" }],
          };
        }
        return { documentId: existing?._id ?? role._id, changes: [] };
      },
    }),
});
