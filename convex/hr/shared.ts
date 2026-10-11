/**
 * Server-side HR building blocks shared by the HR functions: organization
 * time, site and reporting scope, captured day plans, period locks and the
 * idempotent, audited command envelope.
 *
 * Every helper reads through `ctx.tenantDb`, so a forged ID from another
 * organization resolves as absent.
 */
import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import {
  checkIdempotency,
  fingerprintArguments,
  sha256Hex,
  writeIdempotencyRecord,
} from "../lib/idempotency";
import { grantedPermissionsAmong } from "../lib/navigationGrants";
import { HR_PERMISSION, HR_PERMISSION_CODES } from "../lib/permissions";
import type { TenantTableName } from "../lib/schemaPolicy";
import type { TenantFunctionContext } from "../lib/tenantFunctions";
import { refusal } from "../lib/writeEnvelope";
import {
  timezoneOffsetMinutes,
  toLocal,
  type IsoDate,
} from "../model/hr/calendar";
import { compareDates } from "../model/hr/calendar";
import type { RecordedDay } from "../model/hr/period";
import { planFor, type DayPlan, type Schedule } from "../model/hr/schedule";

export type Employee = Doc<"hrEmployees">;
export type AttendanceDay = Doc<"hrAttendanceDays">;
export type StoredPlan = Doc<"hrAttendanceDays">["plan"];

export const MAX_SCOPE_SITES = 50;
export const MAX_SITE_EMPLOYEES = 99;
export const MAX_SITE_PERIODS = 1000;

export const fail = (code: string, field?: string, reason?: string) =>
  refusal({ code, field, reason });
export type Refusal = ReturnType<typeof fail>;
export const isRefusal = (value: unknown): value is Refusal =>
  typeof value === "object" &&
  value !== null &&
  (value as { written?: unknown }).written === false;

export const localTimeValidator = v.object({
  minute: v.number(),
  nextDay: v.boolean(),
});

/* Organization time -------------------------------------------------------- */

export interface OrgClock {
  readonly timezone: string;
  readonly offset: number;
  readonly now: number;
  readonly today: IsoDate;
}

export function orgClock(ctx: TenantFunctionContext): OrgClock | null {
  const timezone = ctx.tenant.organization.settings.timezone;
  const offset = timezoneOffsetMinutes(timezone);
  if (!offset.ok) return null;
  const now = Date.now();
  return {
    timezone,
    offset: offset.value,
    now,
    today: toLocal(now, offset.value).date,
  };
}

/* Permissions and scope ---------------------------------------------------- */

export async function heldHrPermissions(
  ctx: TenantFunctionContext,
): Promise<readonly string[]> {
  return await grantedPermissionsAmong(ctx, HR_PERMISSION_CODES);
}

export async function holds(
  ctx: TenantFunctionContext,
  code: string,
): Promise<boolean> {
  return (await grantedPermissionsAmong(ctx, [code])).length === 1;
}

/**
 * The actor's HR site scope. A warehouse-scoped membership with more than
 * `MAX_SCOPE_SITES` sites keeps only the first ones (a conservative denial,
 * never a widening) and reports `complete: false` so lists can say so.
 */
export type SiteScope =
  | { readonly all: true; readonly complete: true }
  | {
      readonly all: false;
      readonly ids: ReadonlySet<string>;
      readonly complete: boolean;
    };

export async function siteScope(
  ctx: TenantFunctionContext,
): Promise<SiteScope> {
  if (ctx.tenant.membership.scopeMode === "ORG_WIDE")
    return { all: true, complete: true };
  const rows = await ctx.tenantDb
    .byIndex<Doc<"membershipWarehouses">>(
      "membershipWarehouses",
      "by_orgId_membershipId_warehouseId",
      [{ field: "membershipId", value: ctx.tenant.membership._id }],
    )
    .take(MAX_SCOPE_SITES + 1);
  return {
    all: false,
    ids: new Set(rows.slice(0, MAX_SCOPE_SITES).map((row) => row.warehouseId)),
    complete: rows.length <= MAX_SCOPE_SITES,
  };
}

export const inScope = (scope: SiteScope, warehouseId: string): boolean =>
  scope.all || scope.ids.has(warehouseId);

/** A bounded site list; `complete: false` means more sites exist than shown. */
export interface SiteList {
  readonly sites: readonly Doc<"warehouses">[];
  readonly complete: boolean;
}

const byCode = (a: Doc<"warehouses">, b: Doc<"warehouses">) =>
  a.code < b.code ? -1 : a.code > b.code ? 1 : 0;

async function listSites(
  ctx: TenantFunctionContext,
  scope: SiteScope,
  activeOnly: boolean,
): Promise<SiteList> {
  if (scope.all) {
    const rows = activeOnly
      ? await ctx.tenantDb
          .byIndex<Doc<"warehouses">>("warehouses", "by_orgId_status_code", [
            { field: "status", value: "ACTIVE" },
          ])
          .take(MAX_SCOPE_SITES + 1)
      : await ctx.tenantDb
          .byIndex<Doc<"warehouses">>("warehouses", "by_orgId_code")
          .take(MAX_SCOPE_SITES + 1);
    return {
      sites: rows.slice(0, MAX_SCOPE_SITES),
      complete: rows.length <= MAX_SCOPE_SITES,
    };
  }
  const sites: Doc<"warehouses">[] = [];
  for (const id of scope.ids) {
    const site = await ctx.tenantDb.get<Doc<"warehouses">>("warehouses", id);
    if (site !== null && (!activeOnly || site.status === "ACTIVE"))
      sites.push(site);
  }
  return { sites: sites.sort(byCode), complete: scope.complete };
}

/** Active warehouses the actor may see HR data for, in code order. */
export const scopedSites = (ctx: TenantFunctionContext, scope: SiteScope) =>
  listSites(ctx, scope, true);

/** In-scope sites of any status, so closed history stays discoverable. */
export const scopedSitesAnyStatus = (
  ctx: TenantFunctionContext,
  scope: SiteScope,
) => listSites(ctx, scope, false);

export async function siteOf(
  ctx: TenantFunctionContext,
  scope: SiteScope,
  warehouseId: string,
): Promise<Doc<"warehouses"> | null> {
  if (!inScope(scope, warehouseId)) return null;
  const site = await ctx.tenantDb.get<Doc<"warehouses">>(
    "warehouses",
    warehouseId,
  );
  return site?.status === "ACTIVE" ? site : null;
}

export interface ReviewScope {
  readonly admin: boolean;
  readonly sites: SiteScope;
  readonly actorUserId: Id<"users">;
}

export async function reviewScope(
  ctx: TenantFunctionContext,
): Promise<ReviewScope> {
  return {
    admin: await holds(ctx, HR_PERMISSION.adminManage),
    sites: await siteScope(ctx),
    actorUserId: ctx.tenant.actor._id,
  };
}

/**
 * Why the actor may not review this employee, or null. A supervisor needs the
 * reporting relationship and the site; HR needs the site. Nobody reviews
 * their own attendance.
 */
export function reviewBlocker(
  scope: ReviewScope,
  employee: Employee,
): "SELF_REVIEW" | "NOT_FOUND" | null {
  if (employee.userId !== undefined && employee.userId === scope.actorUserId)
    return "SELF_REVIEW";
  if (!inScope(scope.sites, employee.warehouseId)) return "NOT_FOUND";
  if (scope.admin) return null;
  return employee.supervisorUserId === scope.actorUserId ? null : "NOT_FOUND";
}

/* Employees, holidays and plans -------------------------------------------- */

export async function linkedEmployee(
  ctx: TenantFunctionContext,
): Promise<Employee | null> {
  return await ctx.tenantDb
    .byIndex<Employee>("hrEmployees", "by_orgId_userId", [
      { field: "userId", value: ctx.tenant.actor._id },
    ])
    .unique();
}

export const scheduleOf = (employee: Employee): Schedule | undefined =>
  employee.schedule;

export const employmentOf = (employee: Employee) => ({
  startDate: employee.employmentStartDate,
  endDate: employee.employmentEndDate,
});

export async function holidayName(
  ctx: TenantFunctionContext,
  warehouseId: string,
  date: IsoDate,
): Promise<string | undefined> {
  const holiday = await ctx.tenantDb
    .byIndex<Doc<"hrHolidays">>("hrHolidays", "by_orgId_warehouseId_date", [
      { field: "warehouseId", value: warehouseId },
      { field: "date", value: date },
    ])
    .unique();
  return holiday?.name;
}

export async function dayOf(
  ctx: TenantFunctionContext,
  employeeId: string,
  date: IsoDate,
): Promise<AttendanceDay | null> {
  return await ctx.tenantDb
    .byIndex<AttendanceDay>(
      "hrAttendanceDays",
      "by_orgId_employeeId_businessDate",
      [
        { field: "employeeId", value: employeeId },
        { field: "businessDate", value: date },
      ],
    )
    .unique();
}

export async function openDays(
  ctx: TenantFunctionContext,
  employeeId: string,
): Promise<readonly AttendanceDay[]> {
  const days = await ctx.tenantDb
    .byIndex<AttendanceDay>("hrAttendanceDays", "by_orgId_employeeId_open", [
      { field: "employeeId", value: employeeId },
      { field: "open", value: true },
    ])
    .take(10);
  return [...days].sort((a, b) => compareDates(b.businessDate, a.businessDate));
}

export function storedPlan(plan: DayPlan): StoredPlan {
  return plan.kind === "SCHEDULED"
    ? {
        kind: "SCHEDULED",
        startAt: plan.startAt,
        endAt: plan.endAt,
        startTime: plan.startTime,
        endTime: plan.endTime,
        endsNextDay: plan.endsNextDay,
        breakMinutes: plan.breakMinutes,
      }
    : {
        kind: "NONWORKING",
        breakMinutes: 0,
        reason: plan.reason,
        ...(plan.holidayName === undefined
          ? {}
          : { holidayName: plan.holidayName }),
      };
}

export function planFromStored(plan: StoredPlan): DayPlan {
  if (
    plan.kind === "SCHEDULED" &&
    plan.startAt !== undefined &&
    plan.endAt !== undefined
  )
    return {
      kind: "SCHEDULED",
      startAt: plan.startAt,
      endAt: plan.endAt,
      startTime: plan.startTime ?? "",
      endTime: plan.endTime ?? "",
      endsNextDay: plan.endsNextDay ?? false,
      breakMinutes: plan.breakMinutes,
    };
  return {
    kind: "NONWORKING",
    reason: plan.reason ?? "NO_SCHEDULE",
    ...(plan.holidayName === undefined
      ? {}
      : { holidayName: plan.holidayName }),
    breakMinutes: 0,
  };
}

/** The current plan for a date that has no recorded day yet. */
export async function livePlan(
  ctx: TenantFunctionContext,
  employee: Employee,
  date: IsoDate,
  offset: number,
): Promise<DayPlan> {
  return planFor({
    date,
    schedule: scheduleOf(employee),
    holidayName: await holidayName(ctx, employee.warehouseId, date),
    offsetMinutes: offset,
  });
}

export function recordedDay(day: AttendanceDay): RecordedDay {
  return {
    plan: planFromStored(day.plan),
    revision: day.revision,
    clockInAt: day.clockInAt,
    clockOutAt: day.clockOutAt,
    certification:
      day.certification === undefined
        ? undefined
        : {
            disposition: day.certification.disposition,
            startAt: day.certification.startAt,
            endAt: day.certification.endAt,
            revision: day.certification.revision,
            reason: day.certification.reason,
          },
  };
}

/** Create the day record with its captured plan, or return the existing one. */
export async function ensureDay(
  ctx: TenantFunctionContext,
  employee: Employee,
  date: IsoDate,
  offset: number,
): Promise<AttendanceDay> {
  const existing = await dayOf(ctx, employee._id, date);
  if (existing !== null) return existing;
  const now = Date.now();
  const id = await ctx.tenantDb.insert("hrAttendanceDays", {
    employeeId: employee._id,
    warehouseId: employee.warehouseId,
    businessDate: date,
    plan: storedPlan(await livePlan(ctx, employee, date, offset)),
    open: false,
    revision: 0,
    createdAt: now,
    updatedAt: now,
  });
  return await ctx.tenantDb.getX<AttendanceDay>("hrAttendanceDays", id);
}

/* Periods and locks -------------------------------------------------------- */

/** All recorded days and holidays of one site for the given dates. */
export async function loadSiteDays(
  ctx: TenantFunctionContext,
  warehouseId: string,
  dates: readonly IsoDate[],
): Promise<{
  readonly days: ReadonlyMap<string, AttendanceDay>;
  readonly holidays: ReadonlyMap<IsoDate, string>;
}> {
  const days = new Map<string, AttendanceDay>();
  const holidays = new Map<IsoDate, string>();
  for (const date of dates) {
    const rows = await ctx.tenantDb
      .byIndex<AttendanceDay>(
        "hrAttendanceDays",
        "by_orgId_warehouseId_businessDate",
        [
          { field: "warehouseId", value: warehouseId },
          { field: "businessDate", value: date },
        ],
      )
      .all(MAX_SITE_EMPLOYEES * 2);
    for (const row of rows) days.set(`${row.employeeId}:${date}`, row);
    const name = await holidayName(ctx, warehouseId, date);
    if (name !== undefined) holidays.set(date, name);
  }
  return { days, holidays };
}

/** Site employees employed at any point of the range, or null over the bound. */
export async function siteEmployeesInRange(
  ctx: TenantFunctionContext,
  warehouseId: string,
  startDate: IsoDate,
  endDate: IsoDate,
  limit: number,
): Promise<readonly Employee[] | null> {
  const rows = await ctx.tenantDb
    .byIndex<Employee>("hrEmployees", "by_orgId_warehouseId_code", [
      { field: "warehouseId", value: warehouseId },
    ])
    .take(MAX_SITE_EMPLOYEES + 1);
  if (rows.length > MAX_SITE_EMPLOYEES) return null;
  const employed = rows.filter(
    (employee) =>
      compareDates(employee.employmentStartDate, endDate) <= 0 &&
      (employee.employmentEndDate === undefined ||
        compareDates(startDate, employee.employmentEndDate) <= 0),
  );
  return employed.length > limit ? null : employed;
}

export async function sitePeriods(
  ctx: TenantFunctionContext,
  warehouseId: string,
): Promise<readonly Doc<"hrPeriods">[]> {
  return await ctx.tenantDb
    .byIndex<Doc<"hrPeriods">>("hrPeriods", "by_orgId_warehouseId_startDate", [
      { field: "warehouseId", value: warehouseId },
    ])
    .all(MAX_SITE_PERIODS);
}

/** A closed period covering this site date, which no normal write may change. */
export async function closedPeriodCovering(
  ctx: TenantFunctionContext,
  warehouseId: string,
  date: IsoDate,
): Promise<Doc<"hrPeriods"> | null> {
  const periods = await sitePeriods(ctx, warehouseId);
  return (
    periods.find(
      (period) =>
        period.status === "CLOSED" &&
        compareDates(period.startDate, date) <= 0 &&
        compareDates(date, period.endDate) <= 0,
    ) ?? null
  );
}

/* Command envelope --------------------------------------------------------- */

export interface AuditChange {
  readonly field: string;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}

export interface CommandSuccess<Extra> {
  readonly documentId: string;
  readonly extra?: Extra;
  readonly changes?: readonly AuditChange[];
  readonly warehouseId?: Id<"warehouses"> | undefined;
}

const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

const compactChanges = (changes: readonly AuditChange[]) =>
  changes.slice(0, 40).map((change) => ({
    field: change.field.slice(0, 80),
    ...(change.from === undefined ? {} : { from: change.from.slice(0, 300) }),
    ...(change.to === undefined ? {} : { to: change.to.slice(0, 300) }),
  }));

/**
 * Run one HR write exactly once per (operation, request ID).
 *
 * The fingerprint covers the arguments and the actor, so a reused request ID
 * with a different payload or a different user is rejected, while the same
 * retry replays the saved result. Refusals are returned (not thrown) so the
 * authorization audit row and this command's DENIED audit row both persist.
 */
export async function hrCommand<Extra extends Record<string, unknown>>(
  ctx: TenantFunctionContext,
  input: {
    readonly operation: string;
    readonly requestId: string;
    readonly payload: Record<string, unknown>;
    readonly table: TenantTableName;
    readonly warehouseId?: Id<"warehouses"> | undefined;
    readonly run: () => Promise<Refusal | CommandSuccess<Extra>>;
    /** Rebuild the saved answer; a refusal when current access forbids it. */
    readonly replay?: (documentId: string) => Promise<Extra | Refusal | null>;
  },
): Promise<
  | Refusal
  | ({ written: true; documentId: string; replayed: boolean } & Partial<Extra>)
> {
  const actorUserId = ctx.tenant.actor._id;
  if (!REQUEST_ID.test(input.requestId))
    return fail("REQUEST_IDENTITY_INVALID", "requestId");
  const hash = await fingerprintArguments({
    ...JSON.parse(JSON.stringify(input.payload)),
    requestId: input.requestId,
    actorUserId,
  });
  if (!hash.ok) return fail("REQUEST_IDENTITY_INVALID", "requestId");
  const decision = await checkIdempotency({
    tenantDb: ctx.tenantDb,
    operation: input.operation,
    requestId: input.requestId,
    requestHash: hash.value,
  });
  if (!decision.ok) return fail(decision.error.code, "requestId");
  if (decision.value.kind === "REPLAY") {
    const id = decision.value.record.resultRef;
    if (
      id === undefined ||
      decision.value.record.resultHash !==
        (await sha256Hex(`${input.table}:${id}`))
    )
      return fail("REPLAY_RESULT_UNVERIFIABLE");
    // A command that answers with data must be able to rebuild it now, under
    // current access; otherwise a replay is refused rather than reported as
    // a success without its result.
    const extra = input.replay ? await input.replay(id) : null;
    if (isRefusal(extra)) return extra;
    if (input.replay !== undefined && extra === null)
      return fail("REPLAY_RESULT_UNAVAILABLE");
    return {
      written: true as const,
      documentId: id,
      replayed: true,
      ...(extra ?? {}),
    } as {
      written: true;
      documentId: string;
      replayed: boolean;
    } & Partial<Extra>;
  }

  const result = await input.run();
  const now = Date.now();
  const audit = {
    occurredAt: now,
    actorKind: "USER" as const,
    actorUserId,
    action: input.operation,
    permissionCode: ctx.permission.code,
    entityTable: input.table,
    requestId: input.requestId,
  };
  if (isRefusal(result)) {
    await ctx.tenantDb.insert("auditEvents", {
      ...audit,
      ...(input.warehouseId === undefined
        ? {}
        : { warehouseId: input.warehouseId }),
      outcome: "DENIED",
      changes: [{ field: "error", to: result.error.code }],
    });
    return result;
  }
  const warehouseId = result.warehouseId ?? input.warehouseId;
  await ctx.tenantDb.insert("auditEvents", {
    ...audit,
    entityId: result.documentId,
    ...(warehouseId === undefined ? {} : { warehouseId }),
    outcome: "ALLOWED",
    ...(result.changes === undefined || result.changes.length === 0
      ? {}
      : { changes: compactChanges(result.changes) }),
  });
  await writeIdempotencyRecord({
    tenantDb: ctx.tenantDb,
    operation: input.operation,
    requestId: input.requestId,
    requestHash: hash.value,
    resultRef: result.documentId,
    resultHash: await sha256Hex(`${input.table}:${result.documentId}`),
    actorUserId,
    now,
  });
  return {
    written: true as const,
    documentId: result.documentId,
    replayed: false,
    ...(result.extra ?? {}),
  } as {
    written: true;
    documentId: string;
    replayed: boolean;
  } & Partial<Extra>;
}

/* Presentation ------------------------------------------------------------- */

export function planView(plan: DayPlan) {
  return plan.kind === "SCHEDULED"
    ? {
        kind: plan.kind,
        startAt: plan.startAt,
        endAt: plan.endAt,
        startTime: plan.startTime,
        endTime: plan.endTime,
        endsNextDay: plan.endsNextDay,
        breakMinutes: plan.breakMinutes,
      }
    : {
        kind: plan.kind,
        reason: plan.reason,
        ...(plan.holidayName === undefined
          ? {}
          : { holidayName: plan.holidayName }),
      };
}

export async function memberName(
  ctx: TenantFunctionContext,
  userId: string | undefined,
  cache: Map<string, string | null> = new Map(),
): Promise<string | null> {
  if (userId === undefined) return null;
  if (cache.has(userId)) return cache.get(userId) ?? null;
  const member = await ctx.members.get(userId);
  const name = member?.displayName ?? null;
  cache.set(userId, name);
  return name;
}
