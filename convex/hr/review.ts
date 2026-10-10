/**
 * Supervisor and HR review: the scoped exception queue, a day's detail, and
 * the two decisions — a correction request (certify / return) and an
 * exception disposition (worked, absent, external leave, nonworking).
 *
 * Every decision re-reads the employee, checks scope and the reporting
 * relationship, refuses self-review, closed periods and stale revisions, and
 * writes the decision with its audit row atomically.
 */
import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import { HR_PERMISSION } from "../lib/permissions";
import {
  mutationWithOrg,
  queryWithOrg,
  type TenantFunctionContext,
} from "../lib/tenantFunctions";
import {
  evaluateDay,
  resolveProposedInterval,
  type Disposition,
} from "../model/hr/attendance";
import {
  compareDates,
  datesInRange,
  inclusiveDayCount,
  isIsoDate,
} from "../model/hr/calendar";
import { normalizeReason } from "../model/hr/employee";
import { buildPeriodRows } from "../model/hr/period";
import { isEmployedOn, startBelongsToDate } from "../model/hr/schedule";
import { buildDayDetail } from "./dayDetail";
import {
  MAX_SITE_EMPLOYEES,
  closedPeriodCovering,
  dayOf,
  employmentOf,
  ensureDay,
  fail,
  hrCommand,
  livePlan,
  loadSiteDays,
  localTimeValidator,
  orgClock,
  planFromStored,
  recordedDay,
  reviewBlocker,
  reviewScope,
  scopedSites,
  type Employee,
  type ReviewScope,
} from "./shared";

const REVIEW = HR_PERMISSION.teamReview;
export const MAX_QUEUE_DAYS = 31;
export const MAX_QUEUE_EMPLOYEES = 200;
export const MAX_QUEUE_ITEMS = 500;

async function reviewableEmployees(
  ctx: TenantFunctionContext,
  scope: ReviewScope,
  warehouseId: string | undefined,
): Promise<readonly Employee[] | null> {
  let candidates: Employee[] = [];
  // An incomplete site scope could hide reports: refuse visibly instead.
  if (!scope.sites.complete) return null;
  if (scope.admin) {
    const { sites, complete } = await scopedSites(ctx, scope.sites);
    if (!complete) return null;
    for (const site of sites) {
      if (warehouseId !== undefined && site._id !== warehouseId) continue;
      const rows = await ctx.tenantDb
        .byIndex<Employee>("hrEmployees", "by_orgId_warehouseId_code", [
          { field: "warehouseId", value: site._id },
        ])
        .take(MAX_SITE_EMPLOYEES + 1);
      if (rows.length > MAX_SITE_EMPLOYEES) return null;
      candidates.push(...rows);
    }
  } else {
    const rows = await ctx.tenantDb
      .byIndex<Employee>("hrEmployees", "by_orgId_supervisorUserId", [
        { field: "supervisorUserId", value: scope.actorUserId },
      ])
      .take(MAX_SITE_EMPLOYEES + 1);
    if (rows.length > MAX_SITE_EMPLOYEES) return null;
    candidates = rows.filter(
      (employee) =>
        warehouseId === undefined || employee.warehouseId === warehouseId,
    );
  }
  const visible = candidates.filter(
    (employee) => reviewBlocker(scope, employee) === null,
  );
  return visible.length > MAX_QUEUE_EMPLOYEES ? null : visible;
}

export const queue = queryWithOrg({
  args: {
    from: v.string(),
    to: v.string(),
    warehouseId: v.optional(v.id("warehouses")),
  },
  returns: v.any(),
  permissionCode: REVIEW,
  target: { table: "hrAttendanceDays" },
  handler: async (ctx, args) => {
    const clock = orgClock(ctx);
    if (clock === null)
      return { ok: false as const, code: "TIMEZONE_UNSUPPORTED" };
    if (!isIsoDate(args.from) || !isIsoDate(args.to))
      return { ok: false as const, code: "RANGE_INVALID" };
    const count = inclusiveDayCount(args.from, args.to);
    if (count < 1) return { ok: false as const, code: "RANGE_INVALID" };
    if (count > MAX_QUEUE_DAYS)
      return { ok: false as const, code: "RANGE_TOO_LARGE" };
    const to = compareDates(args.to, clock.today) > 0 ? clock.today : args.to;
    const scope = await reviewScope(ctx);
    const employees = await reviewableEmployees(ctx, scope, args.warehouseId);
    if (employees === null)
      return { ok: false as const, code: "LIMIT_EXCEEDED" };
    if (compareDates(args.from, to) > 0)
      return { ok: true as const, items: [], today: clock.today };

    const dates = datesInRange(args.from, to);
    const bySite = new Map<string, Employee[]>();
    for (const employee of employees) {
      const list = bySite.get(employee.warehouseId) ?? [];
      list.push(employee);
      bySite.set(employee.warehouseId, list);
    }
    const items = [];
    for (const [warehouseId, siteEmployees] of bySite) {
      const site = await ctx.tenantDb.get<Doc<"warehouses">>(
        "warehouses",
        warehouseId,
      );
      const { days, holidays } = await loadSiteDays(ctx, warehouseId, dates);
      const rows = buildPeriodRows({
        startDate: args.from,
        endDate: to,
        employees: siteEmployees.map((employee) => ({
          id: employee._id,
          code: employee.code,
          name: employee.displayName,
          employment: employmentOf(employee),
          schedule: employee.schedule,
        })),
        offsetMinutes: clock.offset,
        now: clock.now,
        holidayName: (date) => holidays.get(date),
        recorded: (id, date) => {
          const day = days.get(`${id}:${date}`);
          return day ? recordedDay(day) : undefined;
        },
        pending: (id, date) =>
          days.get(`${id}:${date}`)?.pendingCorrectionId !== undefined,
      });
      for (const row of rows) {
        const day = days.get(`${row.employeeId}:${row.businessDate}`);
        const certified =
          day?.certification !== undefined && row.status === "READY";
        if (row.status !== "EXCEPTION" && !certified) continue;
        items.push({
          employeeId: row.employeeId,
          employeeCode: row.employeeCode,
          employeeName: row.employeeName,
          siteCode: site?.code ?? "",
          businessDate: row.businessDate,
          status: row.status,
          issue: row.issue,
          disposition: row.disposition,
          revision: day?.revision ?? 0,
          pendingCorrectionId: day?.pendingCorrectionId,
          certified,
        });
      }
    }
    items.sort((a, b) =>
      a.businessDate === b.businessDate
        ? a.employeeCode < b.employeeCode
          ? -1
          : 1
        : a.businessDate < b.businessDate
          ? 1
          : -1,
    );
    // Never a silently truncated queue: too many items is a visible limit.
    if (items.length > MAX_QUEUE_ITEMS)
      return { ok: false as const, code: "LIMIT_EXCEEDED" };
    return { ok: true as const, complete: true, items, today: clock.today };
  },
});

export const dayDetail = queryWithOrg({
  // A string, so a malformed deep link answers NOT_FOUND instead of throwing.
  args: { employeeId: v.string(), businessDate: v.string() },
  returns: v.any(),
  permissionCode: REVIEW,
  target: { table: "hrAttendanceDays" },
  handler: async (ctx, args) => {
    const clock = orgClock(ctx);
    if (clock === null)
      return { ok: false as const, code: "TIMEZONE_UNSUPPORTED" };
    if (!isIsoDate(args.businessDate))
      return { ok: false as const, code: "DATE_INVALID" };
    const employee = await ctx.tenantDb.get<Employee>(
      "hrEmployees",
      args.employeeId,
    );
    const scope = await reviewScope(ctx);
    // Self and foreign employees answer identically, so a guess reveals nothing.
    if (employee === null || reviewBlocker(scope, employee) !== null)
      return { ok: false as const, code: "NOT_FOUND" };
    const site = await ctx.tenantDb.get<Doc<"warehouses">>(
      "warehouses",
      employee.warehouseId,
    );
    return {
      ok: true as const,
      timezone: clock.timezone,
      today: clock.today,
      employee: {
        id: employee._id,
        code: employee.code,
        displayName: employee.displayName,
        linked: employee.userId !== undefined,
        siteCode: site?.code ?? "",
        siteName: site?.name ?? "",
      },
      detail: await buildDayDetail(ctx, employee, args.businessDate, clock),
    };
  },
});

/** Re-certifications of one day stop here; history is never pruned. */
export const MAX_CERTIFICATION_HISTORY = 50;

const historyFull = (day: Doc<"hrAttendanceDays">) =>
  day.certification !== undefined &&
  (day.certificationHistory?.length ?? 0) >= MAX_CERTIFICATION_HISTORY;

/** Keep the certification a new decision replaces, so no history is lost. */
function retainedCertification(day: Doc<"hrAttendanceDays">) {
  const previous = day.certification;
  if (previous === undefined) return {};
  return {
    certificationHistory: [
      ...(day.certificationHistory ?? []),
      {
        disposition: previous.disposition,
        ...(previous.startAt === undefined
          ? {}
          : { startAt: previous.startAt }),
        ...(previous.endAt === undefined ? {} : { endAt: previous.endAt }),
        reason: previous.reason,
        decidedByUserId: previous.decidedByUserId,
        decidedAt: previous.decidedAt,
      },
    ],
  };
}

async function reviewTarget(ctx: TenantFunctionContext, employeeId: string) {
  const employee = await ctx.tenantDb.get<Employee>("hrEmployees", employeeId);
  if (employee === null) return fail("NOT_FOUND", "employeeId");
  const blocker = reviewBlocker(await reviewScope(ctx), employee);
  if (blocker === "SELF_REVIEW") return fail("SELF_REVIEW");
  if (blocker !== null) return fail("NOT_FOUND", "employeeId");
  return employee;
}

export const decideCorrection = mutationWithOrg({
  args: {
    requestId: v.string(),
    correctionId: v.id("hrCorrectionRequests"),
    expectedVersion: v.number(),
    decision: v.union(v.literal("CERTIFY"), v.literal("RETURN")),
    reason: v.optional(v.string()),
  },
  returns: v.any(),
  permissionCode: REVIEW,
  target: { table: "hrCorrectionRequests", id: (args) => args.correctionId },
  handler: async (ctx, args) =>
    hrCommand(ctx, {
      operation: "hr.correction.decide",
      requestId: args.requestId,
      payload: {
        correctionId: args.correctionId,
        expectedVersion: args.expectedVersion,
        decision: args.decision,
        reason: args.reason,
      },
      table: "hrCorrectionRequests",
      run: async () => {
        const clock = orgClock(ctx);
        if (clock === null) return fail("TIMEZONE_UNSUPPORTED");
        const correction = await ctx.tenantDb.get<Doc<"hrCorrectionRequests">>(
          "hrCorrectionRequests",
          args.correctionId,
        );
        if (correction === null) return fail("NOT_FOUND", "correctionId");
        const employee = await reviewTarget(ctx, correction.employeeId);
        if ("written" in employee) return employee;
        if (
          correction.status !== "PENDING" ||
          correction.version !== args.expectedVersion
        )
          return fail("DECISION_STALE");
        const day = await ctx.tenantDb.get<Doc<"hrAttendanceDays">>(
          "hrAttendanceDays",
          correction.dayId,
        );
        if (day === null || day.pendingCorrectionId !== correction._id)
          return fail("DECISION_STALE");
        if (
          await closedPeriodCovering(
            ctx,
            employee.warehouseId,
            day.businessDate,
          )
        )
          return fail("HR_PERIOD_CLOSED");
        const reason =
          args.reason === undefined || args.reason.trim() === ""
            ? undefined
            : normalizeReason(args.reason);
        if (reason === null) return fail("REASON_INVALID", "reason");
        const actorUserId = ctx.tenant.actor._id;
        const decidedAt = clock.now;

        if (args.decision === "RETURN") {
          if (reason === undefined) return fail("REASON_REQUIRED", "reason");
          await ctx.tenantDb.patch("hrCorrectionRequests", correction._id, {
            status: "RETURNED",
            version: correction.version + 1,
            decidedByUserId: actorUserId,
            decidedAt,
            decisionReason: reason,
            history: [
              ...correction.history,
              {
                action: "RETURNED" as const,
                actorUserId,
                at: decidedAt,
                reason,
              },
            ],
          });
          await ctx.tenantDb.patch("hrAttendanceDays", day._id, {
            pendingCorrectionId: undefined,
            updatedAt: decidedAt,
          });
          return {
            documentId: correction._id,
            warehouseId: employee.warehouseId,
            changes: [
              { field: "status", from: "PENDING", to: "RETURNED" },
              { field: "reason", to: reason },
            ],
          };
        }

        // Punches since submission make the proposal stale: it must be resubmitted.
        if (day.revision !== correction.baseRevision)
          return fail("CORRECTION_STALE");
        if (
          correction.proposedEndAt > clock.now ||
          correction.proposedEndAt <= correction.proposedStartAt
        )
          return fail("CORRECTION_ORDER_INVALID");
        if (historyFull(day)) return fail("CERTIFICATION_HISTORY_LIMIT");
        const revision = day.revision + 1;
        await ctx.tenantDb.patch("hrAttendanceDays", day._id, {
          ...retainedCertification(day),
          certification: {
            disposition: "WORKED",
            startAt: correction.proposedStartAt,
            endAt: correction.proposedEndAt,
            revision,
            reason: correction.reason,
            decidedByUserId: actorUserId,
            decidedAt,
            correctionId: correction._id,
          },
          revision,
          open: false,
          pendingCorrectionId: undefined,
          updatedAt: decidedAt,
        });
        await ctx.tenantDb.patch("hrCorrectionRequests", correction._id, {
          status: "CERTIFIED",
          version: correction.version + 1,
          decidedByUserId: actorUserId,
          decidedAt,
          ...(reason === undefined ? {} : { decisionReason: reason }),
          history: [
            ...correction.history,
            {
              action: "CERTIFIED" as const,
              actorUserId,
              at: decidedAt,
              ...(reason === undefined ? {} : { reason }),
            },
          ],
        });
        return {
          documentId: correction._id,
          warehouseId: employee.warehouseId,
          changes: [
            { field: "status", from: "PENDING", to: "CERTIFIED" },
            {
              field: "effectiveStartAt",
              to: String(correction.proposedStartAt),
            },
            { field: "effectiveEndAt", to: String(correction.proposedEndAt) },
          ],
        };
      },
    }),
});

const dispositionValidator = v.union(
  v.literal("WORKED"),
  v.literal("ABSENT"),
  v.literal("LEAVE"),
  v.literal("NONWORKING"),
);

export const disposeDay = mutationWithOrg({
  args: {
    requestId: v.string(),
    employeeId: v.id("hrEmployees"),
    businessDate: v.string(),
    expectedRevision: v.number(),
    disposition: dispositionValidator,
    start: v.optional(localTimeValidator),
    end: v.optional(localTimeValidator),
    reason: v.string(),
  },
  returns: v.any(),
  permissionCode: REVIEW,
  target: { table: "hrAttendanceDays" },
  handler: async (ctx, args) =>
    hrCommand(ctx, {
      operation: "hr.attendance.dispose",
      requestId: args.requestId,
      payload: {
        employeeId: args.employeeId,
        businessDate: args.businessDate,
        expectedRevision: args.expectedRevision,
        disposition: args.disposition,
        start: args.start,
        end: args.end,
        reason: args.reason,
      },
      table: "hrAttendanceDays",
      run: async () => {
        const clock = orgClock(ctx);
        if (clock === null) return fail("TIMEZONE_UNSUPPORTED");
        const employee = await reviewTarget(ctx, args.employeeId);
        if ("written" in employee) return employee;
        const date = args.businessDate;
        if (!isIsoDate(date)) return fail("DATE_INVALID", "businessDate");
        if (!isEmployedOn(employmentOf(employee), date))
          return fail("HR_OUTSIDE_EMPLOYMENT", "businessDate");
        const reason = normalizeReason(args.reason);
        if (reason === null) return fail("REASON_REQUIRED", "reason");
        if (await closedPeriodCovering(ctx, employee.warehouseId, date))
          return fail("HR_PERIOD_CLOSED");
        const existing = await dayOf(ctx, employee._id, date);
        if ((existing?.revision ?? 0) !== args.expectedRevision)
          return fail("DECISION_STALE");
        if (existing?.pendingCorrectionId !== undefined)
          return fail("DAY_HAS_PENDING_CORRECTION");
        const plan = existing
          ? planFromStored(existing.plan)
          : await livePlan(ctx, employee, date, clock.offset);
        const evaluation = evaluateDay({
          plan,
          now: clock.now,
          revision: existing?.revision ?? 0,
          clockInAt: existing?.clockInAt,
          clockOutAt: existing?.clockOutAt,
          certification: existing?.certification,
          pendingCorrection: false,
        });
        // Exceptions need a disposition; an already-certified day may be
        // re-certified (e.g. inside a period revision). Ordinary complete days
        // are corrected by the employee's own request instead.
        if (evaluation.status !== "EXCEPTION" && !evaluation.certified)
          return fail("DAY_NOT_EXCEPTION");

        if (!startBelongsToDate(plan, date, clock.offset, args.start))
          return fail("CORRECTION_DATE_INVALID", "start");
        const disposition: Disposition = args.disposition;
        let interval: { startAt: number; endAt: number } | undefined;
        if (disposition === "WORKED") {
          const resolved = resolveProposedInterval({
            businessDate: date,
            offsetMinutes: clock.offset,
            now: clock.now,
            start: args.start,
            end: args.end,
            originalStartAt: existing?.clockInAt,
            originalEndAt: existing?.clockOutAt,
          });
          if (!resolved.ok) return fail(resolved.error.code);
          interval = resolved.value;
        } else if (args.start !== undefined || args.end !== undefined) {
          return fail("DISPOSITION_TIMES_UNEXPECTED");
        }
        const day =
          existing ?? (await ensureDay(ctx, employee, date, clock.offset));
        if (historyFull(day)) return fail("CERTIFICATION_HISTORY_LIMIT");
        const revision = day.revision + 1;
        await ctx.tenantDb.patch("hrAttendanceDays", day._id, {
          ...retainedCertification(day),
          certification: {
            disposition,
            ...(interval === undefined
              ? {}
              : { startAt: interval.startAt, endAt: interval.endAt }),
            revision,
            reason,
            decidedByUserId: ctx.tenant.actor._id,
            decidedAt: clock.now,
          },
          revision,
          open: false,
          updatedAt: clock.now,
        });
        return {
          documentId: day._id,
          warehouseId: employee.warehouseId,
          changes: [
            { field: "businessDate", to: date },
            { field: "issue", from: evaluation.issue },
            { field: "disposition", to: disposition },
            ...(interval === undefined
              ? []
              : [
                  { field: "effectiveStartAt", to: String(interval.startAt) },
                  { field: "effectiveEndAt", to: String(interval.endAt) },
                ]),
            { field: "reason", to: reason },
          ],
        };
      },
    }),
});
