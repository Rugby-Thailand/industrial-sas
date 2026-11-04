/**
 * Named FIXED shifts and the monthly employee roster.
 *
 * Shift definitions belong to one site; codes are unique per site. A roster
 * command assigns one shift, an explicit OFF or a clear (weekly fallback) to
 * one or more employee dates of one site in a single atomic, idempotent and
 * audited write. Every cell carries the revision the editor saw; rows are
 * never deleted, so revisions stay monotonic across clears (ABA-safe).
 *
 * Immutable recorded plan rule: a date that already has an attendance day
 * (its plan was captured) or lies in a closed period is refused for every
 * action, including clear, and the whole command writes nothing. A date
 * claimed by an active leave request (whose submission captured the plan)
 * is refused the same way until the request is withdrawn or returned. There
 * is no retroactive recalculation here (S04-21 stays deferred).
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
  compareDates,
  isIsoDate,
  isoWeekday,
  type IsoDate,
} from "../model/hr/calendar";
import {
  MAX_ROSTER_CELLS,
  MAX_ROSTER_EMPLOYEES,
  MAX_SITE_SHIFTS,
  monthDates,
  rosterPlanFor,
  validateShiftDraft,
} from "../model/hr/roster";
import { isEmployedOn } from "../model/hr/schedule";
import {
  HR_MAX_CHUNK,
  hrPageArgs,
  hrScanPage,
  isHrPageSize,
} from "./pagination";
import {
  diff,
  employedInRange,
  employeeRosterRowsInRange,
  employmentOf,
  fail,
  hasFrozenPlan,
  holidaysInRange,
  hrCommand,
  orgClock,
  planView,
  rosterAssignment,
  sitePeriods,
  siteOf,
  siteScope,
  planFromStored,
  type Employee,
  type RosterRow,
} from "./shared";

const ADMIN = HR_PERMISSION.adminManage;
type Shift = Doc<"hrShifts">;

const shiftColor = v.union(
  v.literal("sky"),
  v.literal("teal"),
  v.literal("green"),
  v.literal("amber"),
  v.literal("rose"),
  v.literal("violet"),
  v.literal("slate"),
);

const shiftView = (shift: Shift) => ({
  id: shift._id,
  code: shift.code,
  name: shift.name,
  ...(shift.description === undefined
    ? {}
    : { description: shift.description }),
  color: shift.color,
  status: shift.status,
  startTime: shift.startTime,
  endTime: shift.endTime,
  endsNextDay: shift.endsNextDay,
  breakMinutes: shift.breakMinutes,
  version: shift.version,
});

async function siteShifts(
  ctx: TenantFunctionContext,
  warehouseId: string,
): Promise<{ readonly items: readonly Shift[]; readonly complete: boolean }> {
  const rows = await ctx.tenantDb
    .byIndex<Shift>("hrShifts", "by_orgId_warehouseId_code", [
      { field: "warehouseId", value: warehouseId },
    ])
    .take(MAX_SITE_SHIFTS + 1);
  return {
    items: rows.slice(0, MAX_SITE_SHIFTS),
    complete: rows.length <= MAX_SITE_SHIFTS,
  };
}

/** One site's shift catalogue in code order, optionally by status. */
export const shifts = queryWithOrg({
  args: {
    warehouseId: v.string(),
    status: v.optional(
      v.union(v.literal("ACTIVE"), v.literal("INACTIVE"), v.literal("ALL")),
    ),
  },
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrShifts" },
  handler: async (ctx, args) => {
    const site = await siteOf(ctx, await siteScope(ctx), args.warehouseId);
    if (site === null) return { ok: false as const, code: "SITE_UNAVAILABLE" };
    const list = await siteShifts(ctx, site._id);
    const status = args.status ?? "ALL";
    return {
      ok: true as const,
      site: { id: site._id, code: site.code, name: site.name },
      complete: list.complete,
      items: list.items
        .filter((shift) => status === "ALL" || shift.status === status)
        .map(shiftView),
    };
  },
});

export const saveShift = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    shiftId: v.optional(v.id("hrShifts")),
    expectedVersion: v.optional(v.number()),
    code: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    color: shiftColor,
    status: v.union(v.literal("ACTIVE"), v.literal("INACTIVE")),
    startTime: v.string(),
    endTime: v.string(),
    endsNextDay: v.boolean(),
    breakMinutes: v.number(),
  },
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrShifts", id: (args) => args.shiftId },
  handler: async (ctx, args) =>
    hrCommand(ctx, {
      operation: "hr.shift.save",
      requestId: args.requestId,
      payload: { ...args, requestId: undefined },
      table: "hrShifts",
      warehouseId: args.warehouseId,
      run: async () => {
        const draft = validateShiftDraft(args);
        if (!draft.ok)
          return fail(
            draft.error.code,
            "field" in draft.error ? draft.error.field : "startTime",
          );
        const site = await siteOf(ctx, await siteScope(ctx), args.warehouseId);
        if (site === null) return fail("SITE_UNAVAILABLE", "warehouseId");
        const before =
          args.shiftId === undefined
            ? null
            : await ctx.tenantDb.get<Shift>("hrShifts", args.shiftId);
        if (args.shiftId !== undefined) {
          // A shift never moves between sites; another site's ID is absent.
          if (before === null || before.warehouseId !== site._id)
            return fail("NOT_FOUND", "shiftId");
          if (before.version !== args.expectedVersion)
            return fail("SHIFT_STALE");
        }
        const sameCode = await ctx.tenantDb
          .byIndex<Shift>("hrShifts", "by_orgId_warehouseId_code", [
            { field: "warehouseId", value: site._id },
            { field: "code", value: draft.value.code },
          ])
          .unique();
        if (sameCode !== null && sameCode._id !== before?._id)
          return fail("SHIFT_CODE_TAKEN", "code");
        if (before === null) {
          const catalogue = await siteShifts(ctx, site._id);
          if (catalogue.items.length >= MAX_SITE_SHIFTS)
            return fail("SHIFT_LIMIT_EXCEEDED");
        }
        const fields = {
          code: draft.value.code,
          name: draft.value.name,
          description: draft.value.description,
          color: draft.value.color,
          status: args.status,
          startTime: draft.value.startTime,
          endTime: draft.value.endTime,
          endsNextDay: draft.value.endsNextDay,
          breakMinutes: draft.value.breakMinutes,
        };
        const now = Date.now();
        const actor = ctx.tenant.actor._id;
        let id: Id<"hrShifts">;
        if (before === null) {
          id = (await ctx.tenantDb.insert("hrShifts", {
            warehouseId: site._id,
            ...fields,
            version: 1,
            createdAt: now,
            createdByUserId: actor,
            updatedAt: now,
            updatedByUserId: actor,
          })) as Id<"hrShifts">;
        } else {
          id = before._id;
          // Assigned dates keep their snapshot; this edit applies only to
          // later assignments.
          await ctx.tenantDb.patch("hrShifts", before._id, {
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

/* Roster ------------------------------------------------------------------- */

/**
 * Whether a roster cell may be assigned at all for this employee and date.
 *
 * Employee-eligibility seam: today this is the employee's own site, ACTIVE
 * status and `isEmployedOn(employmentOf(employee), date)`. The separate
 * hardening lane adds optional intervals to that shared employment value;
 * its gap-aware predicate must be retained at combined integration. Do not
 * rebuild eligibility from just start/end dates here or in livePlan.
 */
export function rosterCellEligible(
  employee: Employee,
  warehouseId: string,
  date: IsoDate,
): "OK" | "EMPLOYEE_SITE_MISMATCH" | "EMPLOYEE_INACTIVE" | "NOT_EMPLOYED" {
  if (employee.warehouseId !== warehouseId) return "EMPLOYEE_SITE_MISMATCH";
  if (employee.status !== "ACTIVE") return "EMPLOYEE_INACTIVE";
  if (!isEmployedOn(employmentOf(employee), date)) return "NOT_EMPLOYED";
  return "OK";
}

/** A closed or closing (staged-close snapshot) period covering this date. */
const frozenCovering = (
  periods: readonly Doc<"hrPeriods">[],
  date: IsoDate,
): Doc<"hrPeriods"> | undefined =>
  periods.find(
    (period) =>
      period.status !== "DRAFT" &&
      compareDates(period.startDate, date) <= 0 &&
      compareDates(date, period.endDate) <= 0,
  );

/**
 * Dates of one employee in `[from, to]` claimed by an active leave request
 * (pending, approved or awaiting cancellation). A pending request captured
 * each date's plan at submission and approval writes that plan, so the
 * roster must not change it underneath; one bounded range read per employee.
 */
async function leaveClaimedDates(
  ctx: TenantFunctionContext,
  employeeId: string,
  from: IsoDate,
  to: IsoDate,
  bound: number,
): Promise<ReadonlySet<string>> {
  const claims = await ctx.tenantDb
    .byIndex<Doc<"hrLeaveDayClaims">>(
      "hrLeaveDayClaims",
      "by_orgId_employeeId_businessDate",
      [{ field: "employeeId", value: employeeId }],
      {
        field: "businessDate",
        lower: { value: from, inclusive: true },
        upper: { value: to, inclusive: true },
      },
    )
    .all(bound);
  return new Set(claims.map((claim) => claim.businessDate));
}

const includes = (value: string, search: string) =>
  value.toLocaleLowerCase().includes(search.toLocaleLowerCase());

/**
 * One site's monthly roster: a page of employee rows × every date of the
 * month, in site employee-code order (`hrScanPage`, one index lane).
 *
 * Employment in the month, search and department are matched while
 * scanning, so a filter narrows pages instead of applying after a cap. A
 * page reads only its own employees' attendance days, roster rows, leave
 * claims and frozen-plan checks; holidays, periods and the shift catalogue
 * are read once per answered page.
 *
 * Callers that predate paging omit `pageSize`: they get one 50-employee page
 * (the former grid size) with its rows also under `employees`.
 */
export const roster = queryWithOrg({
  args: {
    warehouseId: v.string(),
    month: v.string(),
    search: v.optional(v.string()),
    departmentId: v.optional(v.string()),
    ...hrPageArgs,
  },
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrRosterAssignments" },
  handler: async (ctx, args) => {
    const legacy = args.pageSize === undefined;
    const pageSize = args.pageSize ?? MAX_ROSTER_EMPLOYEES;
    if (!isHrPageSize(pageSize))
      return { ok: false as const, code: "PAGE_SIZE_INVALID" };
    const clock = orgClock(ctx);
    if (clock === null)
      return { ok: false as const, code: "TIMEZONE_UNSUPPORTED" };
    const dates = monthDates(args.month);
    if (dates === null) return { ok: false as const, code: "MONTH_INVALID" };
    const site = await siteOf(ctx, await siteScope(ctx), args.warehouseId);
    if (site === null) return { ok: false as const, code: "SITE_UNAVAILABLE" };
    const first = dates[0]!;
    const last = dates[dates.length - 1]!;
    const search = args.search?.trim() ?? "";
    const departmentId =
      args.departmentId === undefined || args.departmentId === ""
        ? null
        : args.departmentId;

    // Site-level facts, read once and only for an answered page.
    let facts:
      | Promise<
          readonly [
            ReadonlyMap<IsoDate, string>,
            readonly Doc<"hrPeriods">[],
            Awaited<ReturnType<typeof siteShifts>>,
          ]
        >
      | undefined;
    const siteFacts = () =>
      (facts ??= Promise.all([
        holidaysInRange(ctx, site._id, first, last),
        sitePeriods(ctx, site._id),
        siteShifts(ctx, site._id),
      ]));
    const departments = new Map<string, string | null>();
    const departmentName = async (id: string | undefined) => {
      if (id === undefined) return null;
      if (!departments.has(id)) {
        const row = await ctx.tenantDb.get<Doc<"hrDepartments">>(
          "hrDepartments",
          id,
        );
        departments.set(id, row?.name ?? null);
      }
      return departments.get(id) ?? null;
    };

    const page = await hrScanPage(ctx, {
      surface: "roster",
      criteria: { site: site._id, month: args.month, search, departmentId },
      pageSize,
      cursor: args.cursor,
      scanCursor: args.scanCursor,
      table: "hrEmployees",
      lanes: [
        {
          key: site._id,
          index: "by_orgId_warehouseId_code",
          equality: [{ field: "warehouseId", value: site._id }],
        },
      ],
      chunk:
        legacy || search !== "" || departmentId !== null
          ? HR_MAX_CHUNK
          : pageSize,
      match: (employee: Employee) =>
        employee.warehouseId === site._id &&
        employedInRange(employee, first, last) &&
        (search === "" ||
          includes(employee.code, search) ||
          includes(employee.displayName, search)) &&
        (departmentId === null || employee.departmentId === departmentId),
      hydrate: async (employee) => {
        const [holidays, periods] = await siteFacts();
        return await rosterRow(ctx, {
          employee,
          siteId: site._id,
          dates,
          holidays,
          periods,
          offset: clock.offset,
          departmentName: await departmentName(employee.departmentId),
        });
      },
    });
    if (page.status !== "ready") return { ok: true as const, ...page };
    const [holidays, , catalogue] = await siteFacts();
    return {
      ok: true as const,
      today: clock.today,
      month: args.month,
      site: { id: site._id, code: site.code, name: site.name },
      dates: dates.map((date) => ({
        date,
        weekday: isoWeekday(date),
        ...(holidays.has(date) ? { holidayName: holidays.get(date) } : {}),
      })),
      shifts: catalogue.items.map(shiftView),
      shiftsComplete: catalogue.complete,
      ...page,
      ...(legacy ? { employees: page.page } : {}),
    };
  },
});

/**
 * One employee's roster row for the month: per-employee index reads only.
 * Days and live assignment times count only at this site (a moved
 * employee's old-site rows keep just their global revision).
 */
async function rosterRow(
  ctx: TenantFunctionContext,
  input: {
    readonly employee: Employee;
    readonly siteId: string;
    readonly dates: readonly IsoDate[];
    readonly holidays: ReadonlyMap<IsoDate, string>;
    readonly periods: readonly Doc<"hrPeriods">[];
    readonly offset: number;
    readonly departmentName: string | null;
  },
) {
  const { employee, siteId, dates, holidays, periods } = input;
  const first = dates[0]!;
  const last = dates[dates.length - 1]!;
  const [rows, recorded, claimed] = await Promise.all([
    employeeRosterRowsInRange(ctx, employee._id, first, last),
    ctx.tenantDb
      .byIndex<Doc<"hrAttendanceDays">>(
        "hrAttendanceDays",
        "by_orgId_employeeId_businessDate",
        [{ field: "employeeId", value: employee._id }],
        {
          field: "businessDate",
          lower: { value: first, inclusive: true },
          upper: { value: last, inclusive: true },
        },
      )
      .all(dates.length * 2),
    leaveClaimedDates(ctx, employee._id, first, last, dates.length * 2),
  ]);
  const days = new Map<IsoDate, Doc<"hrAttendanceDays">>();
  for (const day of recorded)
    if (day.warehouseId === siteId) days.set(day.businessDate, day);
  const cells = await Promise.all(
    dates.map(async (date) => {
      const revisionRow = rows.get(date);
      // Old-site times never transfer implicitly. Keep only the global
      // employee/date revision so a new authorized decision can replace
      // the old row without an unresolvable stale revision or an ABA reset.
      const row = revisionRow?.warehouseId === siteId ? revisionRow : undefined;
      const day = days.get(date);
      const eligibility = rosterCellEligible(employee, siteId, date);
      const plan = day
        ? undefined
        : rosterPlanFor({
            date,
            schedule: employee.schedule,
            assignment: rosterAssignment(row),
            holidayName: holidays.get(date),
            offsetMinutes: input.offset,
          });
      const lock = day
        ? "RECORDED"
        : frozenCovering(periods, date) !== undefined
          ? "PERIOD_CLOSED"
          : (await hasFrozenPlan(ctx, employee._id, date))
            ? "FROZEN"
            : claimed.has(date)
              ? "LEAVE_CLAIMED"
              : eligibility !== "OK"
                ? eligibility
                : null;
      return {
        date,
        revision: revisionRow?.revision ?? 0,
        assignment:
          row === undefined || row.kind === "CLEARED"
            ? null
            : row.kind === "OFF"
              ? { kind: "OFF" as const }
              : {
                  kind: "SHIFT" as const,
                  shiftId: row.shift?.shiftId,
                  code: row.shift?.code ?? "",
                  name: row.shift?.name ?? "",
                  color: row.shift?.color ?? "slate",
                  version: row.shift?.version ?? 0,
                  startTime: row.shift?.startTime ?? "",
                  endTime: row.shift?.endTime ?? "",
                  endsNextDay: row.shift?.endsNextDay ?? false,
                },
        // The captured plan of a recorded day is shown as recorded.
        plan: planView(day ? planFromStored(day.plan) : plan!),
        recorded: day !== undefined,
        lock,
      };
    }),
  );
  return {
    id: employee._id,
    code: employee.code,
    displayName: employee.displayName,
    status: employee.status,
    departmentId: employee.departmentId ?? null,
    departmentName: input.departmentName,
    cells,
  };
}

const cellValidator = v.object({
  employeeId: v.id("hrEmployees"),
  date: v.string(),
  /** The cell revision the editor saw; 0 when it had never been assigned. */
  expectedRevision: v.number(),
});

/**
 * Assign one shift, an explicit OFF or a clear to the selected cells.
 * Every cell is validated before anything is written; one refusal refuses
 * the whole command and writes no assignment and no attendance.
 */
export const assignRoster = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    action: v.union(
      v.object({
        kind: v.literal("SHIFT"),
        shiftId: v.id("hrShifts"),
        expectedShiftVersion: v.number(),
      }),
      v.object({ kind: v.literal("OFF") }),
      v.object({ kind: v.literal("CLEAR") }),
    ),
    cells: v.array(cellValidator),
  },
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrRosterAssignments" },
  handler: async (ctx, args) =>
    hrCommand(ctx, {
      operation: "hr.roster.assign",
      requestId: args.requestId,
      payload: { ...args, requestId: undefined },
      table: "hrRosterAssignments",
      warehouseId: args.warehouseId,
      run: async () => {
        if (args.cells.length < 1 || args.cells.length > MAX_ROSTER_CELLS)
          return fail("ROSTER_SELECTION_INVALID", "cells");
        const seen = new Set<string>();
        const employeeIds = new Set<string>();
        const month = args.cells[0]!.date.slice(0, 7);
        const dates = monthDates(month);
        if (dates === null) return fail("DATE_INVALID", "cells");
        for (const cell of args.cells) {
          if (!isIsoDate(cell.date)) return fail("DATE_INVALID", "cells");
          employeeIds.add(cell.employeeId);
          if (
            cell.date.slice(0, 7) !== month ||
            employeeIds.size > MAX_ROSTER_EMPLOYEES
          )
            return fail("ROSTER_SELECTION_INVALID", "cells");
          if (!Number.isSafeInteger(cell.expectedRevision))
            return fail("ROSTER_SELECTION_INVALID", "cells");
          const key = `${cell.employeeId}:${cell.date}`;
          if (seen.has(key)) return fail("ROSTER_SELECTION_INVALID", "cells");
          seen.add(key);
        }
        const site = await siteOf(ctx, await siteScope(ctx), args.warehouseId);
        if (site === null) return fail("SITE_UNAVAILABLE", "warehouseId");

        let snapshot: RosterRow["shift"] = undefined;
        if (args.action.kind === "SHIFT") {
          const shift = await ctx.tenantDb.get<Shift>(
            "hrShifts",
            args.action.shiftId,
          );
          if (shift === null || shift.warehouseId !== site._id)
            return fail("NOT_FOUND", "shiftId");
          if (shift.status !== "ACTIVE")
            return fail("SHIFT_INACTIVE", "shiftId");
          if (shift.version !== args.action.expectedShiftVersion)
            return fail("SHIFT_STALE", "shiftId");
          snapshot = {
            shiftId: shift._id,
            code: shift.code,
            name: shift.name,
            color: shift.color,
            version: shift.version,
            startTime: shift.startTime,
            endTime: shift.endTime,
            endsNextDay: shift.endsNextDay,
            breakMinutes: shift.breakMinutes,
          };
        }

        const periods = await sitePeriods(ctx, site._id);
        const employees = new Map<string, Employee | null>();
        const rosterRows = new Map<string, ReadonlyMap<IsoDate, RosterRow>>();
        const recordedDates = new Map<string, ReadonlySet<string>>();
        const claimedDates = new Map<string, ReadonlySet<string>>();
        const plans: { row: RosterRow | null; cell: (typeof args.cells)[0] }[] =
          [];
        // Validate everything first: a refusal must leave no partial write.
        for (const cell of args.cells) {
          const reason = `${cell.employeeId}:${cell.date}`;
          if (!employees.has(cell.employeeId))
            employees.set(
              cell.employeeId,
              await ctx.tenantDb.get<Employee>("hrEmployees", cell.employeeId),
            );
          const employee = employees.get(cell.employeeId) ?? null;
          if (employee === null || employee.warehouseId !== site._id)
            return fail("NOT_FOUND", "employeeId", reason);
          const eligibility = rosterCellEligible(employee, site._id, cell.date);
          if (eligibility !== "OK")
            return fail(
              eligibility === "EMPLOYEE_INACTIVE"
                ? "EMPLOYEE_INACTIVE"
                : "ROSTER_NOT_EMPLOYED",
              "employeeId",
              reason,
            );
          // At most 50 bounded monthly reads per table, rather than one
          // indexed read per cell. Employee/date revisions remain global
          // across site moves; recorded attendance also follows the employee.
          if (!rosterRows.has(employee._id)) {
            rosterRows.set(
              employee._id,
              await employeeRosterRowsInRange(
                ctx,
                employee._id,
                dates[0]!,
                dates[dates.length - 1]!,
              ),
            );
            const days = await ctx.tenantDb
              .byIndex<Doc<"hrAttendanceDays">>(
                "hrAttendanceDays",
                "by_orgId_employeeId_businessDate",
                [{ field: "employeeId", value: employee._id }],
                {
                  field: "businessDate",
                  lower: { value: dates[0]!, inclusive: true },
                  upper: { value: dates[dates.length - 1]!, inclusive: true },
                },
              )
              .all(dates.length * 2);
            recordedDates.set(
              employee._id,
              new Set(days.map((day) => day.businessDate)),
            );
            claimedDates.set(
              employee._id,
              await leaveClaimedDates(
                ctx,
                employee._id,
                dates[0]!,
                dates[dates.length - 1]!,
                dates.length * 2,
              ),
            );
          }
          if (recordedDates.get(employee._id)!.has(cell.date))
            return fail("ROSTER_DAY_RECORDED", "cells", reason);
          const frozen = frozenCovering(periods, cell.date);
          if (frozen !== undefined)
            return fail(
              frozen.status === "CLOSING"
                ? "HR_PERIOD_CLOSING"
                : "PERIOD_CLOSED",
              "cells",
              reason,
            );
          if (await hasFrozenPlan(ctx, employee._id, cell.date))
            return fail("ROSTER_DAY_FROZEN", "cells", reason);
          // A pending request's captured plan would otherwise be written
          // back over this change on approval (and the day consumed).
          if (claimedDates.get(employee._id)!.has(cell.date))
            return fail("ROSTER_DAY_LEAVE_CLAIMED", "cells", reason);
          const row = rosterRows.get(employee._id)!.get(cell.date) ?? null;
          if ((row?.revision ?? 0) !== cell.expectedRevision)
            return fail("ROSTER_STALE", "cells", reason);
          plans.push({ row, cell });
        }

        const kind =
          args.action.kind === "CLEAR"
            ? ("CLEARED" as const)
            : args.action.kind === "OFF"
              ? ("OFF" as const)
              : ("SHIFT" as const);
        const now = Date.now();
        const actor = ctx.tenant.actor._id;
        let firstId: string | null = null;
        for (const { row, cell } of plans) {
          let id: string;
          if (row === null) {
            id = await ctx.tenantDb.insert("hrRosterAssignments", {
              warehouseId: site._id,
              employeeId: cell.employeeId,
              businessDate: cell.date,
              kind,
              ...(snapshot === undefined ? {} : { shift: snapshot }),
              revision: 1,
              createdAt: now,
              updatedAt: now,
              updatedByUserId: actor,
            });
          } else {
            id = row._id;
            await ctx.tenantDb.patch("hrRosterAssignments", row._id, {
              warehouseId: site._id,
              kind,
              shift: snapshot,
              revision: row.revision + 1,
              updatedAt: now,
              updatedByUserId: actor,
            });
          }
          firstId ??= id;
        }
        return {
          documentId: firstId!,
          warehouseId: site._id,
          changes: [
            { field: "action", to: kind },
            { field: "cells", to: String(plans.length) },
            ...(snapshot === undefined
              ? []
              : [
                  {
                    field: "shift",
                    to: `${snapshot.code}@${snapshot.version}`,
                  },
                ]),
            ...plans.slice(0, 30).map(({ row, cell }) => ({
              field: `${cell.employeeId}:${cell.date}`,
              ...(row === null ? {} : { from: row.kind }),
              to: kind,
            })),
          ],
        };
      },
    }),
});
