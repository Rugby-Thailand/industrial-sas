/**
 * Employee profile (personal, contact, emergency contact), private payment
 * details and the effective-dated employment lifecycle.
 *
 * Every function requires `hr.admin.manage` and re-checks the employee's site
 * against the administrator's scope; a record outside it answers NOT_FOUND.
 * Profile and payment details are only returned by these per-employee reads:
 * the registry list, search and self-service never include them, and audit
 * events record which fields changed, never their values.
 */
import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import { HR_PERMISSION } from "../lib/permissions";
import {
  mutationWithOrg,
  queryWithOrg,
  type TenantFunctionContext,
} from "../lib/tenantFunctions";
import {
  employmentState,
  planLifecycleTransition,
  type LifecycleCommand,
} from "../model/hr/lifecycle";
import {
  paymentFields,
  profileFields,
  profileUpdateArgs,
  separationType,
} from "../model/hr/employeeProfileSchema";
import {
  maskAccountNumber,
  mergeUpdate,
  type PaymentDraft,
  type ProfileDraft,
  validatePayment,
  validateProfile,
} from "../model/hr/profile";
import { validateEmployeeOrgReferences } from "./org";
import { isEmployedOn, openDayDeadline } from "../model/hr/schedule";
import {
  closingPeriodAt,
  employmentDateBounds,
  employmentOf,
  openDays,
  planFromStored,
  fail,
  hrCommand,
  memberName,
  orgClock,
  siteAllowed,
  siteScope,
  type Employee,
} from "./shared";

const ADMIN = HR_PERMISSION.adminManage;
const MAX_EVENTS = 100;

type Profile = Doc<"hrEmployeeProfiles">;
type Payment = Doc<"hrEmployeePayments">;

/** The employee when it exists inside the actor's site scope. */
async function scopedEmployee(
  ctx: TenantFunctionContext,
  employeeId: string,
): Promise<Employee | null> {
  const record = await ctx.tenantDb.get<Employee>("hrEmployees", employeeId);
  if (record === null) return null;
  return (await siteAllowed(ctx, await siteScope(ctx), record.warehouseId))
    ? record
    : null;
}

async function onePer<Row extends Profile | Payment>(
  ctx: TenantFunctionContext,
  table: "hrEmployeeProfiles" | "hrEmployeePayments",
  employeeId: Id<"hrEmployees">,
): Promise<Row | null> {
  return await ctx.tenantDb
    .byIndex<Row>(table, "by_orgId_employeeId", [
      { field: "employeeId", value: employeeId },
    ])
    .unique();
}

const PROFILE_KEYS = Object.keys(
  profileFields,
) as (keyof typeof profileFields)[];
const PAYMENT_KEYS = Object.keys(
  paymentFields,
) as (keyof typeof paymentFields)[];

/** Changed field names only: private values never enter the audit trail. */
function changedFields(
  keys: readonly string[],
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
) {
  return keys
    .filter((key) => (before?.[key] ?? undefined) !== (after[key] ?? undefined))
    .map((field) => ({ field }));
}

function pick<Key extends string>(
  row: Record<string, unknown> | null,
  keys: readonly Key[],
): Partial<Record<Key, unknown>> {
  const out: Partial<Record<Key, unknown>> = {};
  if (row === null) return out;
  for (const key of keys) if (row[key] !== undefined) out[key] = row[key];
  return out;
}

/* Profile ----------------------------------------------------------------- */

export const employeeProfile = queryWithOrg({
  args: { employeeId: v.string() },
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrEmployeeProfiles" },
  handler: async (ctx, args) => {
    const employee = await scopedEmployee(ctx, args.employeeId);
    if (employee === null) return { ok: false as const, code: "NOT_FOUND" };
    const row = await onePer<Profile>(ctx, "hrEmployeeProfiles", employee._id);
    return {
      ok: true as const,
      profile: pick(row as Record<string, unknown> | null, PROFILE_KEYS),
      version: row?.version ?? 0,
    };
  },
});

export const saveEmployeeProfile = mutationWithOrg({
  args: {
    /** Omitted fields are kept; an empty string clears a field. */
    ...profileUpdateArgs,
    requestId: v.string(),
    employeeId: v.id("hrEmployees"),
    /** 0 before the first save. */
    expectedVersion: v.number(),
  },
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrEmployeeProfiles" },
  handler: async (ctx, args) => {
    const employee = await scopedEmployee(ctx, args.employeeId);
    return hrCommand(ctx, {
      operation: "hr.employee.profile.save",
      requestId: args.requestId,
      payload: { ...args, requestId: undefined },
      table: "hrEmployeeProfiles",
      warehouseId: employee?.warehouseId,
      run: async () => {
        if (employee === null) return fail("NOT_FOUND", "employeeId");
        const clock = orgClock(ctx);
        if (clock === null) return fail("TIMEZONE_UNSUPPORTED");
        const before = await onePer<Profile>(
          ctx,
          "hrEmployeeProfiles",
          employee._id,
        );
        if ((before?.version ?? 0) !== args.expectedVersion)
          return fail("PROFILE_STALE");
        const merged = mergeUpdate(
          PROFILE_KEYS,
          before as Record<string, unknown> | null,
          args as Record<string, unknown>,
        );
        const valid = validateProfile(merged as ProfileDraft, clock.today);
        if (!valid.ok) return fail(valid.error.code, valid.error.field);
        const fields: Record<string, unknown> = {};
        for (const key of PROFILE_KEYS)
          fields[key] = (valid.value as Record<string, unknown>)[key];
        const now = Date.now();
        const actor = ctx.tenant.actor._id;
        let id: string;
        if (before === null) {
          id = await ctx.tenantDb.insert("hrEmployeeProfiles", {
            ...fields,
            employeeId: employee._id,
            version: 1,
            createdAt: now,
            createdByUserId: actor,
            updatedAt: now,
            updatedByUserId: actor,
          });
        } else {
          id = before._id;
          await ctx.tenantDb.patch("hrEmployeeProfiles", before._id, {
            ...fields,
            version: before.version + 1,
            updatedAt: now,
            updatedByUserId: actor,
          });
        }
        return {
          documentId: id,
          warehouseId: employee.warehouseId,
          changes: changedFields(
            PROFILE_KEYS,
            before as Record<string, unknown> | null,
            fields,
          ),
        };
      },
    });
  },
});

/* Payment ----------------------------------------------------------------- */

export const employeePayment = queryWithOrg({
  args: { employeeId: v.string() },
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrEmployeePayments" },
  handler: async (ctx, args) => {
    const employee = await scopedEmployee(ctx, args.employeeId);
    if (employee === null) return { ok: false as const, code: "NOT_FOUND" };
    const row = await onePer<Payment>(ctx, "hrEmployeePayments", employee._id);
    return {
      ok: true as const,
      payment:
        row === null
          ? null
          : {
              ...pick(row as Record<string, unknown>, PAYMENT_KEYS),
              ...(row.accountNumber === undefined
                ? {}
                : { accountMasked: maskAccountNumber(row.accountNumber) }),
            },
      version: row?.version ?? 0,
    };
  },
});

export const saveEmployeePayment = mutationWithOrg({
  args: {
    ...paymentFields,
    requestId: v.string(),
    employeeId: v.id("hrEmployees"),
    expectedVersion: v.number(),
  },
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrEmployeePayments" },
  handler: async (ctx, args) => {
    const employee = await scopedEmployee(ctx, args.employeeId);
    return hrCommand(ctx, {
      operation: "hr.employee.payment.save",
      requestId: args.requestId,
      payload: { ...args, requestId: undefined },
      table: "hrEmployeePayments",
      warehouseId: employee?.warehouseId,
      run: async () => {
        if (employee === null) return fail("NOT_FOUND", "employeeId");
        const before = await onePer<Payment>(
          ctx,
          "hrEmployeePayments",
          employee._id,
        );
        if ((before?.version ?? 0) !== args.expectedVersion)
          return fail("PAYMENT_STALE");
        // Omitted bank fields are kept; choosing cash explicitly clears them.
        const merged = mergeUpdate(
          PAYMENT_KEYS,
          before as Record<string, unknown> | null,
          args as Record<string, unknown>,
        );
        const valid = validatePayment(merged as unknown as PaymentDraft);
        if (!valid.ok) return fail(valid.error.code, valid.error.field);
        const fields: Record<string, unknown> = {};
        for (const key of PAYMENT_KEYS)
          fields[key] = (valid.value as unknown as Record<string, unknown>)[
            key
          ];
        const now = Date.now();
        const actor = ctx.tenant.actor._id;
        let id: string;
        if (before === null) {
          id = await ctx.tenantDb.insert("hrEmployeePayments", {
            ...fields,
            method: valid.value.method,
            employeeId: employee._id,
            version: 1,
            createdAt: now,
            createdByUserId: actor,
            updatedAt: now,
            updatedByUserId: actor,
          });
        } else {
          id = before._id;
          await ctx.tenantDb.patch("hrEmployeePayments", before._id, {
            ...fields,
            version: before.version + 1,
            updatedAt: now,
            updatedByUserId: actor,
          });
        }
        return {
          documentId: id,
          warehouseId: employee.warehouseId,
          changes: changedFields(
            PAYMENT_KEYS,
            before as Record<string, unknown> | null,
            fields,
          ),
        };
      },
    });
  },
});

/* Lifecycle --------------------------------------------------------------- */

export const employeeLifecycle = queryWithOrg({
  args: { employeeId: v.string() },
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrEmploymentEvents" },
  handler: async (ctx, args) => {
    const employee = await scopedEmployee(ctx, args.employeeId);
    if (employee === null) return { ok: false as const, code: "NOT_FOUND" };
    const clock = orgClock(ctx);
    const rows = await ctx.tenantDb
      .byIndex<Doc<"hrEmploymentEvents">>(
        "hrEmploymentEvents",
        "by_orgId_employeeId_recordedAt",
        [{ field: "employeeId", value: employee._id }],
      )
      .page({ limit: MAX_EVENTS, order: "desc" });
    const bounds = await employmentDateBounds(ctx, employee);
    const names = new Map<string, string | null>();
    return {
      ok: true as const,
      today: clock?.today ?? null,
      state: employmentState(employee),
      version: employee.version,
      employmentStartDate: employee.employmentStartDate,
      firstEffectiveDate: bounds.first,
      latestEffectiveDate: bounds.last,
      employmentIntervals: employee.employmentIntervals,
      probationEndDate: employee.probationEndDate,
      probationConfirmedDate: employee.probationConfirmedDate,
      separation: employee.separation,
      complete: rows.isDone,
      events: await Promise.all(
        rows.page.map(async (row) => ({
          id: row._id,
          type: row.type,
          effectiveDate: row.effectiveDate,
          reason: row.reason,
          fromState: row.fromState,
          toState: row.toState,
          recordedAt: row.recordedAt,
          recordedByName: await memberName(ctx, row.recordedByUserId, names),
        })),
      ),
    };
  },
});

export const recordEmploymentEvent = mutationWithOrg({
  args: {
    requestId: v.string(),
    employeeId: v.id("hrEmployees"),
    expectedVersion: v.number(),
    kind: v.union(
      v.literal("CONFIRM_PROBATION"),
      v.literal("OFFBOARD"),
      v.literal("REINSTATE"),
    ),
    effectiveDate: v.string(),
    separationType: v.optional(separationType),
    reason: v.optional(v.string()),
  },
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrEmployees", id: (args) => args.employeeId },
  handler: async (ctx, args) => {
    const employee = await scopedEmployee(ctx, args.employeeId);
    return hrCommand(ctx, {
      operation: "hr.employee.lifecycle",
      requestId: args.requestId,
      payload: { ...args, requestId: undefined },
      table: "hrEmployees",
      warehouseId: employee?.warehouseId,
      run: async () => {
        if (employee === null) return fail("NOT_FOUND", "employeeId");
        if (employee.version !== args.expectedVersion)
          return fail("EMPLOYEE_STALE");
        const clock = orgClock(ctx);
        if (clock === null) return fail("TIMEZONE_UNSUPPORTED");
        let command: LifecycleCommand;
        if (args.kind === "CONFIRM_PROBATION")
          command = { kind: args.kind, effectiveDate: args.effectiveDate };
        else if (args.kind === "OFFBOARD") {
          if (args.separationType === undefined)
            return fail("LIFECYCLE_TYPE_REQUIRED", "separationType");
          command = {
            kind: args.kind,
            separationType: args.separationType,
            lastWorkingDate: args.effectiveDate,
            reason: args.reason ?? "",
          };
        } else
          command = {
            kind: args.kind,
            effectiveDate: args.effectiveDate,
            reason: args.reason ?? "",
          };
        const bounds = await employmentDateBounds(ctx, employee);
        const plan = planLifecycleTransition(
          employee,
          command,
          clock.today,
          bounds.last,
        );
        if (!plan.ok) {
          const field =
            plan.error.field === "lastWorkingDate"
              ? "effectiveDate"
              : plan.error.field;
          return fail(plan.error.code, field);
        }
        if (args.kind === "REINSTATE") {
          const invalidOrg = await validateEmployeeOrgReferences(
            ctx,
            { ...employee, status: "ACTIVE" },
            employee,
          );
          if (invalidOrg) return invalidOrg;
        }
        if (args.kind === "OFFBOARD") {
          // Match selfState's retained-open-day clock-out window exactly. The
          // employee must be allowed to finish it before becoming INACTIVE.
          const opens = await openDays(ctx, employee._id);
          if (
            opens.some(
              (day) =>
                day.clockInAt !== undefined &&
                isEmployedOn(employmentOf(employee), day.businessDate) &&
                clock.now <
                  openDayDeadline(planFromStored(day.plan), day.clockInAt),
            )
          )
            return fail("LIFECYCLE_OPEN_SHIFT", "effectiveDate");
        }
        // A staged close reads its site's employees from one snapshot; no
        // lifecycle change may land until it publishes or cancels.
        if ((await closingPeriodAt(ctx, employee.warehouseId)) !== null)
          return fail("HR_PERIOD_CLOSING", "effectiveDate");
        const { patch, event } = plan.value;
        const now = Date.now();
        const actor = ctx.tenant.actor._id;
        const version = employee.version + 1;
        await ctx.tenantDb.patch("hrEmployees", employee._id, {
          ...(patch.status === undefined ? {} : { status: patch.status }),
          ...(patch.employmentIntervals === undefined
            ? {}
            : { employmentIntervals: patch.employmentIntervals }),
          ...(patch.probationConfirmedDate === undefined
            ? {}
            : { probationConfirmedDate: patch.probationConfirmedDate }),
          ...(patch.employmentEndDate === undefined
            ? {}
            : { employmentEndDate: patch.employmentEndDate ?? undefined }),
          ...(patch.separation === undefined
            ? {}
            : { separation: patch.separation ?? undefined }),
          version,
          updatedAt: now,
          updatedByUserId: actor,
        });
        await ctx.tenantDb.insert("hrEmploymentEvents", {
          employeeId: employee._id,
          warehouseId: employee.warehouseId,
          type: event.type,
          effectiveDate: event.effectiveDate,
          ...(event.reason === undefined ? {} : { reason: event.reason }),
          fromState: event.fromState,
          toState: event.toState,
          employeeVersion: version,
          recordedAt: now,
          recordedByUserId: actor,
        });
        return {
          documentId: employee._id,
          warehouseId: employee.warehouseId,
          changes: [
            { field: "lifecycle", from: event.fromState, to: event.toState },
          ],
        };
      },
    });
  },
});
