/**
 * Employee self-service: today, clocking, personal history, profile and
 * correction requests. Every function resolves the employee from the
 * authenticated member; no client-supplied employee or user ID is accepted.
 */
import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import { HR_PERMISSION } from "../lib/permissions";
import {
  mutationWithOrg,
  queryWithOrg,
  type TenantFunctionContext,
} from "../lib/tenantFunctions";
import { resolveProposedInterval } from "../model/hr/attendance";
import {
  addDays,
  compareDates,
  inclusiveDayCount,
  isIsoDate,
  type IsoDate,
} from "../model/hr/calendar";
import { normalizeReason } from "../model/hr/employee";
import { buildPeriodRows, periodTotals } from "../model/hr/period";
import {
  isEmployedOn,
  openDayDeadline,
  startBelongsToDate,
  resolveClockInDate,
  type DayPlan,
} from "../model/hr/schedule";
import { buildDayDetail, correctionView, latestCorrection } from "./dayDetail";
import {
  closedPeriodCovering,
  dayOf,
  employeeDaysInRange,
  employmentOf,
  ensureDay,
  fail,
  holidaysInRange,
  hrCommand,
  linkedEmployee,
  livePlan,
  localTimeValidator,
  memberName,
  openDays,
  orgClock,
  planFromStored,
  planView,
  recordedDay,
  type AttendanceDay,
  type Employee,
  type OrgClock,
} from "./shared";

const SELF = HR_PERMISSION.selfAccess;
export const MAX_HISTORY_DAYS = 31;
/** Resubmissions stop here; every earlier entry is kept, never truncated. */
export const MAX_CORRECTION_HISTORY = 200;
export const MIN_HOLIDAY_YEAR = 1900;
export const MAX_HOLIDAY_YEAR = 2200;
export const MAX_REQUEST_PAGE_SIZE = 50;

type SelfState =
  | {
      readonly kind: "CLOCKED_IN";
      readonly day: AttendanceDay;
      readonly plan: DayPlan;
    }
  | {
      readonly kind: "UNRESOLVED_OPEN";
      readonly openDay: AttendanceDay;
      readonly date: IsoDate;
      readonly plan: DayPlan;
      readonly day: AttendanceDay | null;
    }
  | {
      readonly kind: "OUTSIDE_EMPLOYMENT";
      readonly date: IsoDate;
      readonly plan: DayPlan;
      readonly day: AttendanceDay | null;
      /**
       * True when `day` is a still-open clock-in whose business date HR has
       * since moved outside employment: it may not be clocked out.
       */
      readonly openClockIn: boolean;
    }
  | {
      readonly kind: "CLOCKED_OUT" | "NONWORKING" | "NOT_CLOCKED_IN";
      readonly date: IsoDate;
      readonly plan: DayPlan;
      readonly day: AttendanceDay | null;
    };

/** The authoritative attendance state the next clock command acts on. */
async function selfState(
  ctx: TenantFunctionContext,
  employee: Employee,
  clock: OrgClock,
): Promise<SelfState> {
  const opens = await openDays(ctx, employee._id);
  for (const day of opens) {
    const plan = planFromStored(day.plan);
    if (
      day.clockInAt !== undefined &&
      clock.now < openDayDeadline(plan, day.clockInAt)
    )
      // Employment is checked against the OPEN day's business date, not
      // today's: a final-day overnight shift still clocks out after midnight.
      return isEmployedOn(employmentOf(employee), day.businessDate)
        ? { kind: "CLOCKED_IN", day, plan }
        : {
            kind: "OUTSIDE_EMPLOYMENT",
            date: day.businessDate,
            plan,
            day,
            openClockIn: true,
          };
  }
  // An expired open day blocks clocking until a decision resolves it, even
  // while its correction is pending: no fabricated end, no second open pair.
  const unresolved = opens[0];

  const today = clock.today;
  const yesterday = addDays(today, -1);
  const known = new Map<
    IsoDate,
    { day: AttendanceDay | null; plan: DayPlan }
  >();
  for (const date of [yesterday, today]) {
    const day = await dayOf(ctx, employee._id, date);
    known.set(date, {
      day,
      plan: day
        ? planFromStored(day.plan)
        : await livePlan(ctx, employee, date, clock.offset),
    });
  }
  const date = resolveClockInDate({
    now: clock.now,
    offsetMinutes: clock.offset,
    planOf: (candidate) => known.get(candidate)!.plan,
    hasClockIn: (candidate) =>
      known.get(candidate)?.day?.clockInAt !== undefined,
  });
  const { day, plan } = known.get(date)!;
  if (unresolved !== undefined)
    return { kind: "UNRESOLVED_OPEN", openDay: unresolved, date, plan, day };
  if (!isEmployedOn(employmentOf(employee), date))
    return { kind: "OUTSIDE_EMPLOYMENT", date, plan, day, openClockIn: false };
  if (day?.clockInAt !== undefined)
    return { kind: "CLOCKED_OUT", date, plan, day };
  return {
    kind: plan.kind === "SCHEDULED" ? "NOT_CLOCKED_IN" : "NONWORKING",
    date,
    plan,
    day,
  };
}

async function siteSummary(ctx: TenantFunctionContext, employee: Employee) {
  const site = await ctx.tenantDb.get<Doc<"warehouses">>(
    "warehouses",
    employee.warehouseId,
  );
  return site === null
    ? null
    : { id: site._id, code: site.code, name: site.name };
}

const employeeSummary = async (
  ctx: TenantFunctionContext,
  employee: Employee,
) => ({
  id: employee._id,
  code: employee.code,
  displayName: employee.displayName,
  status: employee.status,
  site: await siteSummary(ctx, employee),
});

export const today = queryWithOrg({
  args: { clockRefresh: v.optional(v.number()) },
  returns: v.any(),
  permissionCode: SELF,
  target: { table: "hrAttendanceDays" },
  handler: async (ctx) => {
    const clock = orgClock(ctx);
    if (clock === null) return { state: "TIMEZONE_UNSUPPORTED" as const };
    const employee = await linkedEmployee(ctx);
    const base = {
      timezone: clock.timezone,
      today: clock.today,
      now: clock.now,
    };
    if (employee === null) return { ...base, state: "NOT_LINKED" as const };
    const summary = await employeeSummary(ctx, employee);
    if (employee.status !== "ACTIVE")
      return { ...base, state: "INACTIVE" as const, employee: summary };

    const state = await selfState(ctx, employee, clock);
    const current = state.kind === "CLOCKED_IN" ? state.day : state.day;
    const date =
      state.kind === "CLOCKED_IN" ? state.day.businessDate : state.date;
    const corrections = await recentCorrections(ctx, employee, clock);
    return {
      ...base,
      state: state.kind,
      employee: summary,
      businessDate: date,
      plan: planView(state.plan),
      clockInAt: current?.clockInAt,
      clockOutAt: current?.clockOutAt,
      nextAction:
        state.kind === "CLOCKED_IN"
          ? ("CLOCK_OUT" as const)
          : state.kind === "NOT_CLOCKED_IN" || state.kind === "NONWORKING"
            ? ("CLOCK_IN" as const)
            : ("NONE" as const),
      openDay:
        state.kind === "UNRESOLVED_OPEN"
          ? {
              businessDate: state.openDay.businessDate,
              clockInAt: state.openDay.clockInAt,
              pendingCorrection:
                state.openDay.pendingCorrectionId !== undefined,
            }
          : undefined,
      corrections,
    };
  },
});

async function recentCorrections(
  ctx: TenantFunctionContext,
  employee: Employee,
  clock: OrgClock,
) {
  // Bounded: the latest request of each of the last 14 recorded dates, read
  // as one date range, newest date first.
  const days = await employeeDaysInRange(
    ctx,
    employee._id,
    addDays(clock.today, -13),
    clock.today,
  );
  const items = [];
  for (let offset = 0; offset < 14 && items.length < 5; offset += 1) {
    const date = addDays(clock.today, -offset);
    const day = days.get(date);
    if (day === undefined) continue;
    const latest = await latestCorrection(ctx, day);
    if (latest === null) continue;
    items.push({
      id: latest._id,
      businessDate: date,
      status: latest.status,
      submittedAt: latest.submittedAt,
    });
  }
  return items;
}

/** One holiday per site date, so a year holds at most 366. */
const MAX_YEAR_HOLIDAYS = 366;

/**
 * One site's complete holidays of a calendar year, in date order: a single
 * checked date-range read on the site's calendar index (tenant prefix
 * first), so other years are never read. ISO date strings order
 * chronologically, so no time-zone arithmetic is involved.
 */
export async function yearHolidays(
  ctx: TenantFunctionContext,
  warehouseId: string,
  year: number,
): Promise<readonly Doc<"hrHolidays">[]> {
  return await ctx.tenantDb
    .byIndex<Doc<"hrHolidays">>(
      "hrHolidays",
      "by_orgId_warehouseId_date",
      [{ field: "warehouseId", value: warehouseId }],
      {
        field: "date",
        lower: { value: `${year}-01-01`, inclusive: true },
        upper: { value: `${year}-12-31`, inclusive: true },
      },
    )
    // Fails rather than truncates if the one-per-date rule were broken.
    .all(MAX_YEAR_HOLIDAYS);
}

/**
 * The linked employee's complete selected-year site calendar (see
 * `yearHolidays`), independently of older site calendars and the
 * administrator list's paging. No site ID is accepted.
 */
export const holidays = queryWithOrg({
  args: { clockRefresh: v.optional(v.number()), year: v.number() },
  returns: v.any(),
  permissionCode: SELF,
  target: { table: "hrHolidays" },
  handler: async (ctx, args) => {
    if (
      !Number.isInteger(args.year) ||
      args.year < MIN_HOLIDAY_YEAR ||
      args.year > MAX_HOLIDAY_YEAR
    )
      return { ok: false as const, code: "YEAR_INVALID" };
    const clock = orgClock(ctx);
    if (clock === null)
      return { ok: false as const, code: "TIMEZONE_UNSUPPORTED" };
    const employee = await linkedEmployee(ctx);
    if (employee === null) return { ok: false as const, code: "HR_NOT_LINKED" };
    const rows = await yearHolidays(ctx, employee.warehouseId, args.year);
    const holidays = rows.map((row) => ({
      id: row._id,
      date: row.date,
      name: row.name,
    }));
    return {
      ok: true as const,
      year: args.year,
      today: clock.today,
      timezone: clock.timezone,
      employee: await employeeSummary(ctx, employee),
      complete: true as const,
      holidays,
      nextHoliday:
        holidays.find(
          (holiday) => compareDates(holiday.date, clock.today) >= 0,
        ) ?? null,
    };
  },
});

/** Complete personal correction history, accessed one bounded page at a time. */
export const requests = queryWithOrg({
  args: {
    clockRefresh: v.optional(v.number()),
    cursor: v.optional(v.string()),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    text: v.optional(v.string()),
    limit: v.optional(v.number()),
    status: v.optional(
      v.union(
        v.literal("PENDING"),
        v.literal("CERTIFIED"),
        v.literal("RETURNED"),
      ),
    ),
  },
  returns: v.any(),
  permissionCode: SELF,
  target: { table: "hrCorrectionRequests" },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_REQUEST_PAGE_SIZE)
      return { ok: false as const, code: "PAGE_SIZE_INVALID" };
    const clock = orgClock(ctx);
    if (clock === null)
      return { ok: false as const, code: "TIMEZONE_UNSUPPORTED" };
    const employee = await linkedEmployee(ctx);
    if (employee === null) return { ok: false as const, code: "HR_NOT_LINKED" };
    const text = args.text?.trim().toLocaleLowerCase() ?? "";
    if (text.length > 100)
      return { ok: false as const, code: "REQUEST_FILTER_INVALID" };
    if (
      (args.from !== undefined && !isIsoDate(args.from)) ||
      (args.to !== undefined && !isIsoDate(args.to)) ||
      (args.from !== undefined && args.to !== undefined && args.from > args.to)
    )
      return { ok: false as const, code: "DATE_RANGE_INVALID" };
    const index = ctx.tenantDb.byIndex<Doc<"hrCorrectionRequests">>(
      "hrCorrectionRequests",
      args.status === undefined
        ? "by_orgId_employeeId_businessDate"
        : "by_orgId_employeeId_status_businessDate",
      [
        { field: "employeeId", value: employee._id },
        ...(args.status === undefined
          ? []
          : [{ field: "status", value: args.status }]),
      ],
    );
    // Filters apply across retained history, with one indexed pagination call
    // per query. Empty filtered pages keep continuation for further scanning.
    const page = await index.page({
      limit,
      cursor: args.cursor,
      order: "desc",
    });
    const matches = (request: Doc<"hrCorrectionRequests">) =>
      (args.from === undefined || request.businessDate >= args.from) &&
      (args.to === undefined || request.businessDate <= args.to) &&
      (text === "" ||
        `${request.businessDate} ${request.reason} ${request.decisionReason ?? ""}`
          .toLocaleLowerCase()
          .includes(text));
    const items = page.page.filter(matches);
    return {
      ok: true as const,
      today: clock.today,
      timezone: clock.timezone,
      // The index orders dates, then creation time; resubmissions retain their
      // identity and business date rather than pretending to be new records.
      items: items.map((request) => ({
        id: request._id,
        businessDate: request.businessDate,
        status: request.status,
        reason: request.reason,
        version: request.version,
        proposedStartAt: request.proposedStartAt,
        proposedEndAt: request.proposedEndAt,
        submittedAt: request.submittedAt,
        decidedAt: request.decidedAt,
        decisionReason: request.decisionReason,
      })),
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

/** An exact owned request, including every retained resubmission/decision. */
export const requestDetail = queryWithOrg({
  // URL segments are untrusted strings; tenantDb normalizes before reading.
  args: { clockRefresh: v.optional(v.number()), correctionId: v.string() },
  returns: v.any(),
  permissionCode: SELF,
  target: { table: "hrCorrectionRequests" },
  handler: async (ctx, args) => {
    const clock = orgClock(ctx);
    if (clock === null)
      return { ok: false as const, code: "TIMEZONE_UNSUPPORTED" };
    const employee = await linkedEmployee(ctx);
    if (employee === null) return { ok: false as const, code: "HR_NOT_LINKED" };
    const request = await ctx.tenantDb.get<Doc<"hrCorrectionRequests">>(
      "hrCorrectionRequests",
      args.correctionId,
    );
    if (request === null || request.employeeId !== employee._id)
      return { ok: false as const, code: "NOT_FOUND" };
    const day = await ctx.tenantDb.get<AttendanceDay>(
      "hrAttendanceDays",
      request.dayId,
    );
    if (day === null || day.employeeId !== employee._id)
      return { ok: false as const, code: "NOT_FOUND" };
    return {
      ok: true as const,
      today: clock.today,
      timezone: clock.timezone,
      businessDate: request.businessDate,
      detail: await correctionView(ctx, request, day.revision, new Map()),
    };
  },
});

const clockReplay = (ctx: TenantFunctionContext) => async (eventId: string) => {
  const event = await ctx.tenantDb.get<Doc<"hrAttendanceEvents">>(
    "hrAttendanceEvents",
    eventId,
  );
  // A relinked account cannot recover a previous employee's saved receipt.
  const employee = await linkedEmployee(ctx);
  return event === null ||
    event.actorUserId !== ctx.tenant.actor._id ||
    employee?._id !== event.employeeId
    ? null
    : {
        occurredAt: event.occurredAt,
        businessDate: event.businessDate,
        kind: event.kind,
      };
};

async function recordClock(
  ctx: TenantFunctionContext,
  employee: Employee,
  day: AttendanceDay,
  kind: "CLOCK_IN" | "CLOCK_OUT",
  requestId: string,
  now: number,
) {
  await ctx.tenantDb.patch("hrAttendanceDays", day._id, {
    ...(kind === "CLOCK_IN"
      ? { clockInAt: now, open: true }
      : { clockOutAt: now, open: false }),
    revision: day.revision + 1,
    updatedAt: now,
  });
  const eventId = await ctx.tenantDb.insert("hrAttendanceEvents", {
    dayId: day._id,
    employeeId: employee._id,
    warehouseId: employee.warehouseId,
    businessDate: day.businessDate,
    kind,
    occurredAt: now,
    actorUserId: ctx.tenant.actor._id,
    requestId,
    source: "ONLINE_SELF",
  });
  return {
    documentId: eventId,
    warehouseId: employee.warehouseId,
    extra: { occurredAt: now, businessDate: day.businessDate, kind },
    changes: [
      { field: "businessDate", to: day.businessDate },
      {
        field: kind === "CLOCK_IN" ? "clockInAt" : "clockOutAt",
        to: String(now),
      },
    ],
  };
}

async function activeLinkedEmployee(ctx: TenantFunctionContext) {
  const employee = await linkedEmployee(ctx);
  if (employee === null) return fail("HR_NOT_LINKED");
  if (employee.status !== "ACTIVE") return fail("HR_EMPLOYEE_INACTIVE");
  return employee;
}

export const clockIn = mutationWithOrg({
  args: { requestId: v.string(), expectedBusinessDate: v.optional(v.string()) },
  returns: v.any(),
  permissionCode: SELF,
  target: { table: "hrAttendanceEvents" },
  handler: async (ctx, args) =>
    hrCommand(ctx, {
      operation: "hr.attendance.clockIn",
      requestId: args.requestId,
      payload:
        args.expectedBusinessDate === undefined
          ? {}
          : { expectedBusinessDate: args.expectedBusinessDate },
      table: "hrAttendanceEvents",
      replay: clockReplay(ctx),
      run: async () => {
        const clock = orgClock(ctx);
        if (clock === null) return fail("TIMEZONE_UNSUPPORTED");
        const employee = await activeLinkedEmployee(ctx);
        if ("written" in employee) return employee;
        const state = await selfState(ctx, employee, clock);
        if (
          args.expectedBusinessDate !== undefined &&
          args.expectedBusinessDate !==
            (state.kind === "CLOCKED_IN" ? state.day.businessDate : state.date)
        )
          return fail("HR_CLOCK_DAY_CHANGED");
        switch (state.kind) {
          case "CLOCKED_IN":
            return fail("HR_ALREADY_CLOCKED_IN");
          case "UNRESOLVED_OPEN":
            return fail(
              "HR_OPEN_DAY_UNRESOLVED",
              "businessDate",
              state.openDay.businessDate,
            );
          case "OUTSIDE_EMPLOYMENT":
            return fail("HR_OUTSIDE_EMPLOYMENT");
          case "CLOCKED_OUT":
            return fail("HR_ALREADY_CLOCKED_OUT");
          case "NOT_CLOCKED_IN":
          case "NONWORKING":
            break;
        }
        if (await closedPeriodCovering(ctx, employee.warehouseId, state.date))
          return fail("HR_PERIOD_CLOSED");
        const day = await ensureDay(ctx, employee, state.date, clock.offset);
        if (day.approvedLeaveRequestId !== undefined)
          return fail("HR_DAY_ON_APPROVED_LEAVE");
        return await recordClock(
          ctx,
          employee,
          day,
          "CLOCK_IN",
          args.requestId,
          clock.now,
        );
      },
    }),
});

export const clockOut = mutationWithOrg({
  args: { requestId: v.string(), expectedBusinessDate: v.optional(v.string()) },
  returns: v.any(),
  permissionCode: SELF,
  target: { table: "hrAttendanceEvents" },
  handler: async (ctx, args) =>
    hrCommand(ctx, {
      operation: "hr.attendance.clockOut",
      requestId: args.requestId,
      payload:
        args.expectedBusinessDate === undefined
          ? {}
          : { expectedBusinessDate: args.expectedBusinessDate },
      table: "hrAttendanceEvents",
      replay: clockReplay(ctx),
      run: async () => {
        const clock = orgClock(ctx);
        if (clock === null) return fail("TIMEZONE_UNSUPPORTED");
        const employee = await activeLinkedEmployee(ctx);
        if ("written" in employee) return employee;
        const state = await selfState(ctx, employee, clock);
        if (state.kind === "UNRESOLVED_OPEN")
          return fail(
            "HR_OPEN_DAY_EXPIRED",
            "businessDate",
            state.openDay.businessDate,
          );
        if (state.kind === "OUTSIDE_EMPLOYMENT" && state.openClockIn)
          return fail("HR_OUTSIDE_EMPLOYMENT");
        if (state.kind !== "CLOCKED_IN") return fail("HR_NOT_CLOCKED_IN");
        if (
          args.expectedBusinessDate !== undefined &&
          args.expectedBusinessDate !== state.day.businessDate
        )
          return fail("HR_CLOCK_DAY_CHANGED");
        if (state.day.approvedLeaveRequestId !== undefined)
          return fail("HR_DAY_ON_APPROVED_LEAVE");
        if (
          await closedPeriodCovering(
            ctx,
            employee.warehouseId,
            state.day.businessDate,
          )
        )
          return fail("HR_PERIOD_CLOSED");
        return await recordClock(
          ctx,
          employee,
          state.day,
          "CLOCK_OUT",
          args.requestId,
          clock.now,
        );
      },
    }),
});

export const history = queryWithOrg({
  args: {
    clockRefresh: v.optional(v.number()),
    from: v.string(),
    to: v.string(),
  },
  returns: v.any(),
  permissionCode: SELF,
  target: { table: "hrAttendanceDays" },
  handler: async (ctx, args) => {
    const clock = orgClock(ctx);
    if (clock === null)
      return { ok: false as const, code: "TIMEZONE_UNSUPPORTED" };
    if (!isIsoDate(args.from) || !isIsoDate(args.to))
      return { ok: false as const, code: "RANGE_INVALID" };
    const days = inclusiveDayCount(args.from, args.to);
    if (days < 1) return { ok: false as const, code: "RANGE_INVALID" };
    if (days > MAX_HISTORY_DAYS)
      return { ok: false as const, code: "RANGE_TOO_LARGE" };
    const employee = await linkedEmployee(ctx);
    if (employee === null) return { ok: false as const, code: "HR_NOT_LINKED" };
    const to = compareDates(args.to, clock.today) > 0 ? clock.today : args.to;
    // One date-range read each for the days and the site's holidays; the
    // holidays matter only for dates without a recorded day.
    const [recorded, siteHolidays] = await Promise.all([
      employeeDaysInRange(ctx, employee._id, args.from, to),
      holidaysInRange(ctx, employee.warehouseId, args.from, to),
    ]);
    const holidays = new Map<IsoDate, string>();
    for (const [date, name] of siteHolidays)
      if (!recorded.has(date)) holidays.set(date, name);
    const corrections = new Map<
      IsoDate,
      { id: Id<"hrCorrectionRequests">; status: string }
    >();
    for (const [date, day] of recorded) {
      const latest = await latestCorrection(ctx, day);
      if (latest)
        corrections.set(date, { id: latest._id, status: latest.status });
    }
    const rows =
      compareDates(args.from, to) > 0
        ? []
        : buildPeriodRows({
            startDate: args.from,
            endDate: to,
            employees: [
              {
                id: employee._id,
                code: employee.code,
                name: employee.displayName,
                employment: employmentOf(employee),
                schedule: employee.schedule,
              },
            ],
            offsetMinutes: clock.offset,
            now: clock.now,
            holidayName: (date) => holidays.get(date),
            recorded: (_id, date) => {
              const day = recorded.get(date);
              return day ? recordedDay(day) : undefined;
            },
            pending: (_id, date) =>
              recorded.get(date)?.pendingCorrectionId !== undefined,
          });
    return {
      ok: true as const,
      today: clock.today,
      timezone: clock.timezone,
      summary: periodTotals(rows),
      rows: [...rows].reverse().map((row) => ({
        businessDate: row.businessDate,
        plan: planView(row.plan),
        originalStartAt: recorded.get(row.businessDate)?.clockInAt,
        originalEndAt: recorded.get(row.businessDate)?.clockOutAt,
        effectiveStartAt: row.actualStartAt,
        effectiveEndAt: row.actualEndAt,
        workedMinutes: row.workedMinutes,
        outsideShiftMinutes: row.outsideShiftMinutes,
        status: row.status,
        issue: row.issue,
        disposition: row.disposition,
        correction: corrections.get(row.businessDate),
      })),
    };
  },
});

export const dayDetail = queryWithOrg({
  args: { clockRefresh: v.optional(v.number()), businessDate: v.string() },
  returns: v.any(),
  permissionCode: SELF,
  target: { table: "hrAttendanceDays" },
  handler: async (ctx, args) => {
    const clock = orgClock(ctx);
    if (clock === null)
      return { ok: false as const, code: "TIMEZONE_UNSUPPORTED" };
    if (!isIsoDate(args.businessDate))
      return { ok: false as const, code: "DATE_INVALID" };
    const employee = await linkedEmployee(ctx);
    if (employee === null) return { ok: false as const, code: "HR_NOT_LINKED" };
    return {
      ok: true as const,
      timezone: clock.timezone,
      today: clock.today,
      detail: await buildDayDetail(ctx, employee, args.businessDate, clock),
    };
  },
});

export const profile = queryWithOrg({
  args: { clockRefresh: v.optional(v.number()) },
  returns: v.any(),
  permissionCode: SELF,
  target: { table: "hrEmployees" },
  handler: async (ctx) => {
    const employee = await linkedEmployee(ctx);
    if (employee === null) return { linked: false as const };
    const clock = orgClock(ctx);
    return {
      linked: true as const,
      timezone: ctx.tenant.organization.settings.timezone,
      employed:
        clock === null
          ? false
          : isEmployedOn(employmentOf(employee), clock.today),
      employee: {
        ...(await employeeSummary(ctx, employee)),
        supervisorName: await memberName(ctx, employee.supervisorUserId),
        employmentStartDate: employee.employmentStartDate,
        employmentEndDate: employee.employmentEndDate,
        schedule: employee.schedule,
      },
    };
  },
});

export const submitCorrection = mutationWithOrg({
  args: {
    requestId: v.string(),
    businessDate: v.string(),
    start: v.optional(localTimeValidator),
    end: v.optional(localTimeValidator),
    reason: v.string(),
    /** A returned request being resubmitted with its history retained. */
    correctionId: v.optional(v.id("hrCorrectionRequests")),
  },
  returns: v.any(),
  permissionCode: SELF,
  target: { table: "hrCorrectionRequests" },
  handler: async (ctx, args) =>
    hrCommand(ctx, {
      operation: "hr.correction.submit",
      requestId: args.requestId,
      payload: {
        businessDate: args.businessDate,
        start: args.start,
        end: args.end,
        reason: args.reason,
        correctionId: args.correctionId,
      },
      table: "hrCorrectionRequests",
      run: async () => {
        const clock = orgClock(ctx);
        if (clock === null) return fail("TIMEZONE_UNSUPPORTED");
        const employee = await activeLinkedEmployee(ctx);
        if ("written" in employee) return employee;
        const date = args.businessDate;
        if (!isIsoDate(date)) return fail("DATE_INVALID", "businessDate");
        if (compareDates(date, clock.today) > 0)
          return fail("CORRECTION_IN_FUTURE", "businessDate");
        if (!isEmployedOn(employmentOf(employee), date))
          return fail("HR_OUTSIDE_EMPLOYMENT", "businessDate");
        const reason = normalizeReason(args.reason);
        if (reason === null) return fail("REASON_REQUIRED", "reason");
        if (await closedPeriodCovering(ctx, employee.warehouseId, date))
          return fail("HR_PERIOD_CLOSED");

        const existing = await dayOf(ctx, employee._id, date);
        if (existing?.approvedLeaveRequestId !== undefined)
          return fail("HR_DAY_ON_APPROVED_LEAVE");
        if (existing?.pendingCorrectionId !== undefined)
          return fail("CORRECTION_ALREADY_PENDING");
        const plan = existing
          ? planFromStored(existing.plan)
          : await livePlan(ctx, employee, date, clock.offset);
        if (!startBelongsToDate(plan, date, clock.offset, args.start))
          return fail("CORRECTION_DATE_INVALID", "start");
        const interval = resolveProposedInterval({
          businessDate: date,
          offsetMinutes: clock.offset,
          now: clock.now,
          start: args.start,
          end: args.end,
          originalStartAt: existing?.clockInAt,
          originalEndAt: existing?.clockOutAt,
        });
        if (!interval.ok) return fail(interval.error.code);

        let previous: Doc<"hrCorrectionRequests"> | null = null;
        if (args.correctionId !== undefined) {
          previous = await ctx.tenantDb.get<Doc<"hrCorrectionRequests">>(
            "hrCorrectionRequests",
            args.correctionId,
          );
          if (
            previous === null ||
            previous.employeeId !== employee._id ||
            previous.businessDate !== date
          )
            return fail("NOT_FOUND", "correctionId");
          if (previous.status !== "RETURNED")
            return fail("CORRECTION_NOT_RETURNED", "correctionId");
        }

        const day =
          existing ?? (await ensureDay(ctx, employee, date, clock.offset));
        const actorUserId = ctx.tenant.actor._id;
        const entry = {
          action: "SUBMITTED" as const,
          actorUserId,
          at: clock.now,
          reason,
          proposedStartAt: interval.value.startAt,
          proposedEndAt: interval.value.endAt,
        };
        const fields = {
          status: "PENDING" as const,
          proposedStartAt: interval.value.startAt,
          proposedEndAt: interval.value.endAt,
          reason,
          baseRevision: day.revision,
          submittedByUserId: actorUserId,
          submittedAt: clock.now,
        };
        let correctionId: Id<"hrCorrectionRequests">;
        if (previous !== null) {
          if (previous.history.length >= MAX_CORRECTION_HISTORY)
            return fail("CORRECTION_HISTORY_LIMIT", "correctionId");
          correctionId = previous._id;
          await ctx.tenantDb.patch("hrCorrectionRequests", previous._id, {
            ...fields,
            version: previous.version + 1,
            decidedByUserId: undefined,
            decidedAt: undefined,
            decisionReason: undefined,
            history: [...previous.history, entry],
          });
        } else {
          correctionId = (await ctx.tenantDb.insert("hrCorrectionRequests", {
            ...fields,
            dayId: day._id,
            employeeId: employee._id,
            warehouseId: employee.warehouseId,
            businessDate: date,
            version: 1,
            history: [entry],
          })) as Id<"hrCorrectionRequests">;
        }
        await ctx.tenantDb.patch("hrAttendanceDays", day._id, {
          pendingCorrectionId: correctionId,
          updatedAt: clock.now,
        });
        return {
          documentId: correctionId,
          warehouseId: employee.warehouseId,
          changes: [
            { field: "businessDate", to: date },
            { field: "proposedStartAt", to: String(interval.value.startAt) },
            { field: "proposedEndAt", to: String(interval.value.endAt) },
            { field: "reason", to: reason },
          ],
        };
      },
    }),
});
