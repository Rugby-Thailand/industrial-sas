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
import { buildPeriodRows } from "../model/hr/period";
import {
  isEmployedOn,
  openDayDeadline,
  startBelongsToDate,
  resolveClockInDate,
  type DayPlan,
} from "../model/hr/schedule";
import { buildDayDetail, dayCorrections } from "./dayDetail";
import {
  closedPeriodCovering,
  dayOf,
  employmentOf,
  ensureDay,
  fail,
  holidayName,
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
      readonly kind:
        "OUTSIDE_EMPLOYMENT" | "CLOCKED_OUT" | "NONWORKING" | "NOT_CLOCKED_IN";
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
      return { kind: "CLOCKED_IN", day, plan };
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
    return { kind: "OUTSIDE_EMPLOYMENT", date, plan, day };
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
  args: {},
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
    const corrections = await recentCorrections(ctx, employee);
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
) {
  // Bounded: the latest request of each of the last 14 recorded dates.
  const clock = orgClock(ctx);
  if (clock === null) return [];
  const items = [];
  for (let offset = 0; offset < 14 && items.length < 5; offset += 1) {
    const date = addDays(clock.today, -offset);
    const day = await dayOf(ctx, employee._id, date);
    if (day === null) continue;
    const latest = (await dayCorrections(ctx, day)).items[0];
    if (latest === undefined) continue;
    items.push({
      id: latest._id,
      businessDate: date,
      status: latest.status,
      submittedAt: latest.submittedAt,
    });
  }
  return items;
}

const clockReplay = (ctx: TenantFunctionContext) => async (eventId: string) => {
  const event = await ctx.tenantDb.get<Doc<"hrAttendanceEvents">>(
    "hrAttendanceEvents",
    eventId,
  );
  // Only the actor who recorded the event gets its saved answer back.
  return event === null || event.actorUserId !== ctx.tenant.actor._id
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
  args: { requestId: v.string() },
  returns: v.any(),
  permissionCode: SELF,
  target: { table: "hrAttendanceEvents" },
  handler: async (ctx, args) =>
    hrCommand(ctx, {
      operation: "hr.attendance.clockIn",
      requestId: args.requestId,
      payload: {},
      table: "hrAttendanceEvents",
      replay: clockReplay(ctx),
      run: async () => {
        const clock = orgClock(ctx);
        if (clock === null) return fail("TIMEZONE_UNSUPPORTED");
        const employee = await activeLinkedEmployee(ctx);
        if ("written" in employee) return employee;
        const state = await selfState(ctx, employee, clock);
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
  args: { requestId: v.string() },
  returns: v.any(),
  permissionCode: SELF,
  target: { table: "hrAttendanceEvents" },
  handler: async (ctx, args) =>
    hrCommand(ctx, {
      operation: "hr.attendance.clockOut",
      requestId: args.requestId,
      payload: {},
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
        if (state.kind !== "CLOCKED_IN") return fail("HR_NOT_CLOCKED_IN");
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
  args: { from: v.string(), to: v.string() },
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
    const recorded = new Map<IsoDate, AttendanceDay>();
    const holidays = new Map<IsoDate, string>();
    const corrections = new Map<
      IsoDate,
      { id: Id<"hrCorrectionRequests">; status: string }
    >();
    for (
      let date = args.from;
      compareDates(date, to) <= 0;
      date = addDays(date, 1)
    ) {
      const day = await dayOf(ctx, employee._id, date);
      if (day) {
        recorded.set(date, day);
        const latest = (await dayCorrections(ctx, day)).items[0];
        if (latest)
          corrections.set(date, { id: latest._id, status: latest.status });
      } else {
        const name = await holidayName(ctx, employee.warehouseId, date);
        if (name !== undefined) holidays.set(date, name);
      }
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
  args: { businessDate: v.string() },
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
  args: {},
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
