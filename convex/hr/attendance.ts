/** Phase 8 HR attendance, correction, and leave vertical slice. */
import { v, type GenericId, type Infer } from "convex/values";

import {
  mutationWithOrg,
  queryWithOrg,
  type TenantFunctionContext,
  type TenantPolicyContext,
} from "../lib/tenantFunctions";
import type { TenantOrgId } from "../lib/tenantDb";
import {
  attendanceEventKind,
  hrRequestStatus,
  leaveDurationKind,
  leaveType,
} from "../lib/validators";
import { refusal, writeOutcomeValidator, written } from "../lib/writeEnvelope";
import {
  applyAttendanceCorrection,
  applyClockIntent,
  businessDateAt,
  validateLeaveRange,
  type AttendanceDayState,
  type ClockIntent,
} from "../model/hr/attendance";

export const HR_OPERATIONS = Object.freeze({
  clock: "hr.attendance.clock",
  requestCorrection: "hr.attendance.requestCorrection",
  decideCorrection: "hr.attendance.decideCorrection",
  requestLeave: "hr.leave.request",
  cancelLeave: "hr.leave.cancel",
  decideLeave: "hr.leave.decide",
});

const MAX_SELF_ROWS = 40;
const MAX_TEAM_ROWS = 99;

interface EmployeeRow {
  readonly _id: GenericId<"employees">;
  readonly orgId: TenantOrgId;
  readonly employeeNumber: string;
  readonly userId?: GenericId<"users">;
  readonly displayName: string;
  readonly warehouseId: GenericId<"warehouses">;
  readonly teamId?: GenericId<"hrTeams">;
  readonly status: string;
}

interface HrTeamRow {
  readonly _id: GenericId<"hrTeams">;
  readonly orgId: TenantOrgId;
  readonly warehouseId: GenericId<"warehouses">;
  readonly supervisorEmployeeId?: GenericId<"employees">;
  readonly status: string;
}

interface AttendanceDayRow extends AttendanceDayState {
  readonly _id: GenericId<"attendanceDays">;
  readonly orgId: TenantOrgId;
  readonly employeeId: GenericId<"employees">;
  readonly warehouseId: GenericId<"warehouses">;
  readonly businessDate: string;
  readonly lastEventAt: number;
  readonly timezone: string;
}

interface AttendanceEventRow {
  readonly _id: GenericId<"attendanceEvents">;
  readonly orgId: TenantOrgId;
  readonly employeeId: GenericId<"employees">;
  readonly warehouseId: GenericId<"warehouses">;
  readonly attendanceDayId: GenericId<"attendanceDays">;
  readonly businessDate: string;
  readonly kind: string;
  readonly commandId: string;
  readonly serverReceivedAt: number;
  readonly deviceOccurredAt?: number;
}

interface CorrectionRow {
  readonly _id: GenericId<"attendanceCorrections">;
  readonly orgId: TenantOrgId;
  readonly requestId: string;
  readonly employeeId: GenericId<"employees">;
  readonly warehouseId: GenericId<"warehouses">;
  readonly attendanceDayId: GenericId<"attendanceDays">;
  readonly requestedClockInAt: number;
  readonly requestedClockOutAt: number;
  readonly requestedBreakMinutes: number;
  readonly reason: string;
  readonly status: string;
  readonly requestedByUserId: GenericId<"users">;
  readonly requestedAt: number;
  readonly decidedByUserId?: GenericId<"users">;
  readonly decidedAt?: number;
  readonly decisionNote?: string;
}

interface LeaveRow {
  readonly _id: GenericId<"leaveRequests">;
  readonly orgId: TenantOrgId;
  readonly requestId: string;
  readonly employeeId: GenericId<"employees">;
  readonly warehouseId: GenericId<"warehouses">;
  readonly startDate: string;
  readonly endDate: string;
  readonly leaveType: string;
  readonly durationKind: string;
  readonly hours?: number;
  readonly privateReason?: string;
  readonly status: string;
  readonly requestedByUserId: GenericId<"users">;
  readonly requestedAt: number;
  readonly decidedByUserId?: GenericId<"users">;
  readonly decidedAt?: number;
  readonly decisionNote?: string;
}

async function employeeForActor(
  ctx: TenantFunctionContext,
): Promise<EmployeeRow | null> {
  return await ctx.tenantDb
    .byIndex<EmployeeRow>("employees", "by_orgId_userId", [
      { field: "userId", value: ctx.tenant.actor._id },
    ])
    .first();
}

async function supervisorForActor(
  ctx: Pick<TenantFunctionContext, "tenant" | "tenantDb">,
): Promise<{
  readonly employee: EmployeeRow;
  readonly team: HrTeamRow;
} | null> {
  const employee = await ctx.tenantDb
    .byIndex<EmployeeRow>("employees", "by_orgId_userId", [
      { field: "userId", value: ctx.tenant.actor._id },
    ])
    .first();
  if (employee?.teamId === undefined || employee.status !== "ACTIVE")
    return null;
  const team = await ctx.tenantDb.get<HrTeamRow>("hrTeams", employee.teamId);
  if (
    team === null ||
    team.status !== "ACTIVE" ||
    team.supervisorEmployeeId !== employee._id
  ) {
    return null;
  }
  return { employee, team };
}

async function isActorSupervisorOf(
  ctx: Pick<TenantFunctionContext, "tenant" | "tenantDb">,
  employeeId: GenericId<"employees">,
): Promise<boolean> {
  const [scope, employee] = await Promise.all([
    supervisorForActor(ctx),
    ctx.tenantDb.get<EmployeeRow>("employees", employeeId),
  ]);
  return (
    scope !== null &&
    employee !== null &&
    employee.teamId === scope.team._id &&
    employee.warehouseId === scope.team.warehouseId
  );
}

async function dayForDate(
  ctx: TenantFunctionContext,
  employeeId: string,
  businessDate: string,
): Promise<AttendanceDayRow | null> {
  return await ctx.tenantDb
    .byIndex<AttendanceDayRow>(
      "attendanceDays",
      "by_orgId_employeeId_businessDate",
      [
        { field: "employeeId", value: employeeId },
        { field: "businessDate", value: businessDate },
      ],
    )
    .first();
}

const ownEmployeeValidator = v.object({
  employeeId: v.id("employees"),
  employeeNumber: v.string(),
  displayName: v.string(),
  warehouseId: v.id("warehouses"),
});

const dayValidator = v.object({
  attendanceDayId: v.id("attendanceDays"),
  businessDate: v.string(),
  status: v.string(),
  clockInAt: v.optional(v.number()),
  breakStartedAt: v.optional(v.number()),
  breakMinutes: v.number(),
  clockOutAt: v.optional(v.number()),
  lastEventAt: v.number(),
  timezone: v.string(),
});

/** Self-only view; private leave reasons never enter the team query below. */
export const readMyHr = queryWithOrg({
  args: {},
  returns: v.union(
    v.object({ found: v.literal(false) }),
    v.object({
      found: v.literal(true),
      employee: ownEmployeeValidator,
      days: v.array(dayValidator),
      corrections: v.array(
        v.object({
          attendanceCorrectionId: v.id("attendanceCorrections"),
          attendanceDayId: v.id("attendanceDays"),
          status: hrRequestStatus,
          reason: v.string(),
          requestedAt: v.number(),
          decisionNote: v.optional(v.string()),
        }),
      ),
      leaves: v.array(
        v.object({
          leaveRequestId: v.id("leaveRequests"),
          startDate: v.string(),
          endDate: v.string(),
          leaveType,
          durationKind: leaveDurationKind,
          hours: v.optional(v.number()),
          privateReason: v.optional(v.string()),
          status: hrRequestStatus,
          requestedAt: v.number(),
          decisionNote: v.optional(v.string()),
        }),
      ),
      complete: v.boolean(),
      asOf: v.number(),
    }),
  ),
  permissionCode: "hr.self.read",
  target: { table: "employees" },
  handler: async (ctx) => {
    const employee = await employeeForActor(ctx);
    if (employee === null || employee.status !== "ACTIVE") {
      return { found: false as const };
    }
    const [days, corrections, leaves] = await Promise.all([
      ctx.tenantDb
        .byIndex<AttendanceDayRow>(
          "attendanceDays",
          "by_orgId_employeeId_businessDate",
          [{ field: "employeeId", value: employee._id }],
        )
        .page({ limit: MAX_SELF_ROWS + 1 }),
      ctx.tenantDb
        .byIndex<CorrectionRow>(
          "attendanceCorrections",
          "by_orgId_employeeId_status_requestedAt",
          [{ field: "employeeId", value: employee._id }],
        )
        .page({ limit: MAX_SELF_ROWS + 1 }),
      ctx.tenantDb
        .byIndex<LeaveRow>(
          "leaveRequests",
          "by_orgId_employeeId_status_startDate",
          [{ field: "employeeId", value: employee._id }],
        )
        .page({ limit: MAX_SELF_ROWS + 1 }),
    ]);
    const complete =
      days.page.length <= MAX_SELF_ROWS &&
      corrections.page.length <= MAX_SELF_ROWS &&
      leaves.page.length <= MAX_SELF_ROWS;
    return {
      found: true as const,
      employee: {
        employeeId: employee._id,
        employeeNumber: employee.employeeNumber,
        displayName: employee.displayName,
        warehouseId: employee.warehouseId,
      },
      days: days.page.slice(0, MAX_SELF_ROWS).map((day) => ({
        attendanceDayId: day._id,
        businessDate: day.businessDate,
        status: day.status,
        ...(day.clockInAt === undefined ? {} : { clockInAt: day.clockInAt }),
        ...(day.breakStartedAt === undefined
          ? {}
          : { breakStartedAt: day.breakStartedAt }),
        breakMinutes: day.breakMinutes,
        ...(day.clockOutAt === undefined ? {} : { clockOutAt: day.clockOutAt }),
        lastEventAt: day.lastEventAt,
        timezone: day.timezone,
      })),
      corrections: corrections.page.slice(0, MAX_SELF_ROWS).map((request) => ({
        attendanceCorrectionId: request._id,
        attendanceDayId: request.attendanceDayId,
        status: request.status as Infer<typeof hrRequestStatus>,
        reason: request.reason,
        requestedAt: request.requestedAt,
        ...(request.decisionNote === undefined
          ? {}
          : { decisionNote: request.decisionNote }),
      })),
      leaves: leaves.page.slice(0, MAX_SELF_ROWS).map((request) => ({
        leaveRequestId: request._id,
        startDate: request.startDate,
        endDate: request.endDate,
        leaveType: request.leaveType as Infer<typeof leaveType>,
        durationKind: request.durationKind as Infer<typeof leaveDurationKind>,
        ...(request.hours === undefined ? {} : { hours: request.hours }),
        ...(request.privateReason === undefined
          ? {}
          : { privateReason: request.privateReason }),
        status: request.status as Infer<typeof hrRequestStatus>,
        requestedAt: request.requestedAt,
        ...(request.decisionNote === undefined
          ? {}
          : { decisionNote: request.decisionNote }),
      })),
      complete,
      asOf: Date.now(),
    };
  },
});

export const clock = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    kind: attendanceEventKind,
    deviceOccurredAt: v.optional(v.number()),
    installationId: v.optional(v.string()),
  },
  returns: writeOutcomeValidator,
  permissionCode: "hr.self.attendance.record",
  target: { table: "attendanceEvents" },
  warehouseId: ({ warehouseId }) => warehouseId,
  installationId: ({ installationId }) => installationId,
  handler: async (ctx, args) => {
    if (args.kind === "CORRECTION_APPLIED") {
      return refusal({ code: "FIELD_INVALID", field: "kind" });
    }
    const employee = await employeeForActor(ctx);
    if (
      employee === null ||
      employee.status !== "ACTIVE" ||
      employee.warehouseId !== args.warehouseId
    ) {
      return refusal({ code: "EMPLOYEE_PROFILE_MISSING" });
    }
    const replay = await ctx.tenantDb
      .byIndex<AttendanceEventRow>("attendanceEvents", "by_orgId_commandId", [
        { field: "commandId", value: args.requestId },
      ])
      .first();
    if (replay !== null) {
      return replay.employeeId === employee._id && replay.kind === args.kind
        ? written({ documentId: replay._id, replayed: true })
        : refusal({ code: "REQUEST_ID_REUSED", field: "requestId" });
    }

    const now = Date.now();
    const timezone = ctx.tenant.organization.settings.timezone;
    const today = businessDateAt(now, timezone);
    const previous = businessDateAt(now - 24 * 60 * 60 * 1_000, timezone);
    let day = await dayForDate(ctx, employee._id, today);
    if (
      args.kind !== "CLOCK_IN" &&
      (day === null || day.status === "CLOSED" || day.status === "CORRECTED")
    ) {
      const priorDay = await dayForDate(ctx, employee._id, previous);
      if (
        priorDay !== null &&
        priorDay.status !== "CLOSED" &&
        priorDay.status !== "CORRECTED"
      ) {
        day = priorDay;
      }
    }
    const next = applyClockIntent(day, args.kind as ClockIntent, now);
    if (!next.ok) return refusal({ code: next.error.code, field: "kind" });

    let attendanceDayId = day?._id;
    const businessDate = day?.businessDate ?? today;
    if (day === null) {
      attendanceDayId = (await ctx.tenantDb.insert("attendanceDays", {
        employeeId: employee._id,
        warehouseId: args.warehouseId,
        businessDate,
        ...next.value,
        lastEventAt: now,
        timezone,
      })) as GenericId<"attendanceDays">;
    } else {
      await ctx.tenantDb.patch("attendanceDays", day._id, {
        ...next.value,
        lastEventAt: now,
      });
    }
    const eventId = await ctx.tenantDb.insert("attendanceEvents", {
      employeeId: employee._id,
      warehouseId: args.warehouseId,
      attendanceDayId: attendanceDayId!,
      businessDate,
      kind: args.kind,
      commandId: args.requestId,
      ...(args.deviceOccurredAt === undefined
        ? {}
        : { deviceOccurredAt: args.deviceOccurredAt }),
      serverReceivedAt: now,
      timezone,
      actorUserId: ctx.tenant.actor._id,
    });
    return written({ documentId: eventId, replayed: false });
  },
});

export const requestAttendanceCorrection = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    attendanceDayId: v.id("attendanceDays"),
    requestedClockInAt: v.number(),
    requestedClockOutAt: v.number(),
    requestedBreakMinutes: v.number(),
    reason: v.string(),
  },
  returns: writeOutcomeValidator,
  permissionCode: "hr.self.correction.request",
  target: { table: "attendanceCorrections" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const employee = await employeeForActor(ctx);
    const day = await ctx.tenantDb.get<AttendanceDayRow>(
      "attendanceDays",
      args.attendanceDayId,
    );
    if (
      employee === null ||
      employee.warehouseId !== args.warehouseId ||
      day === null ||
      day.employeeId !== employee._id
    ) {
      return refusal({ code: "NOT_FOUND", table: "attendanceDays" });
    }
    const preview = applyAttendanceCorrection(
      day,
      args.requestedClockInAt,
      args.requestedClockOutAt,
      args.requestedBreakMinutes,
    );
    if (!preview.ok) return refusal({ code: preview.error.code });
    const reason = args.reason.trim();
    if (reason.length < 3 || reason.length > 500) {
      return refusal({ code: "FIELD_INVALID", field: "reason" });
    }
    const replay = await ctx.tenantDb
      .byIndex<CorrectionRow>("attendanceCorrections", "by_orgId_requestId", [
        { field: "requestId", value: args.requestId },
      ])
      .first();
    if (replay !== null) {
      return replay.employeeId === employee._id
        ? written({ documentId: replay._id, replayed: true })
        : refusal({ code: "REQUEST_ID_REUSED", field: "requestId" });
    }
    const id = await ctx.tenantDb.insert("attendanceCorrections", {
      requestId: args.requestId,
      employeeId: employee._id,
      warehouseId: args.warehouseId,
      attendanceDayId: day._id,
      requestedClockInAt: args.requestedClockInAt,
      requestedClockOutAt: args.requestedClockOutAt,
      requestedBreakMinutes: args.requestedBreakMinutes,
      reason,
      status: "SUBMITTED",
      requestedByUserId: ctx.tenant.actor._id,
      requestedAt: Date.now(),
    });
    return written({ documentId: id, replayed: false });
  },
});

async function correctionDecisionPolicy(
  ctx: TenantPolicyContext,
  args: { readonly attendanceCorrectionId: string },
) {
  const request = await ctx.tenantDb.get<CorrectionRow>(
    "attendanceCorrections",
    args.attendanceCorrectionId,
  );
  const ownTeam =
    request === null
      ? false
      : await isActorSupervisorOf(ctx, request.employeeId);
  return {
    thresholdExceeded: false,
    approvalSatisfied: request?.status === "SUBMITTED" && ownTeam,
    ...(request === null ? {} : { makerUserId: request.requestedByUserId }),
  };
}

export const decideAttendanceCorrection = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    attendanceCorrectionId: v.id("attendanceCorrections"),
    decision: v.union(v.literal("APPROVE"), v.literal("REJECT")),
    note: v.string(),
  },
  returns: writeOutcomeValidator,
  permissionCode: "hr.team.correction.decide",
  target: {
    table: "attendanceCorrections",
    id: ({ attendanceCorrectionId }) => attendanceCorrectionId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  policy: correctionDecisionPolicy,
  handler: async (ctx, args) => {
    const request = await ctx.tenantDb.get<CorrectionRow>(
      "attendanceCorrections",
      args.attendanceCorrectionId,
    );
    if (
      request === null ||
      request.warehouseId !== args.warehouseId ||
      request.status !== "SUBMITTED" ||
      !(await isActorSupervisorOf(ctx, request.employeeId))
    ) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "attendanceCorrectionId",
      });
    }
    const note = args.note.trim();
    if (note.length < 2 || note.length > 500) {
      return refusal({ code: "FIELD_INVALID", field: "note" });
    }
    const now = Date.now();
    if (args.decision === "APPROVE") {
      const day = await ctx.tenantDb.get<AttendanceDayRow>(
        "attendanceDays",
        request.attendanceDayId,
      );
      if (day === null)
        return refusal({
          code: "REFERENCE_NOT_FOUND",
          field: "attendanceDayId",
        });
      const next = applyAttendanceCorrection(
        day,
        request.requestedClockInAt,
        request.requestedClockOutAt,
        request.requestedBreakMinutes,
      );
      if (!next.ok) return refusal({ code: next.error.code });
      await ctx.tenantDb.patch("attendanceDays", day._id, {
        ...next.value,
        lastEventAt: now,
      });
      await ctx.tenantDb.insert("attendanceEvents", {
        employeeId: request.employeeId,
        warehouseId: request.warehouseId,
        attendanceDayId: day._id,
        businessDate: day.businessDate,
        kind: "CORRECTION_APPLIED",
        commandId: args.requestId,
        serverReceivedAt: now,
        timezone: day.timezone,
        actorUserId: ctx.tenant.actor._id,
        correctionRequestId: request._id,
      });
    }
    await ctx.tenantDb.patch("attendanceCorrections", request._id, {
      status: args.decision === "APPROVE" ? "APPROVED" : "REJECTED",
      decidedByUserId: ctx.tenant.actor._id,
      decidedAt: now,
      decisionNote: note,
    });
    return written({ documentId: request._id, replayed: false });
  },
});

export const requestLeave = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    startDate: v.string(),
    endDate: v.string(),
    leaveType,
    durationKind: leaveDurationKind,
    hours: v.optional(v.number()),
    privateReason: v.optional(v.string()),
  },
  returns: writeOutcomeValidator,
  permissionCode: "hr.self.leave.request",
  target: { table: "leaveRequests" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const employee = await employeeForActor(ctx);
    if (
      employee === null ||
      employee.status !== "ACTIVE" ||
      employee.warehouseId !== args.warehouseId
    ) {
      return refusal({ code: "EMPLOYEE_PROFILE_MISSING" });
    }
    const range = validateLeaveRange(
      args.startDate,
      args.endDate,
      args.durationKind === "HOURS" ? args.hours : undefined,
    );
    if (!range.ok) return refusal({ code: range.error.code });
    if (args.durationKind === "HOURS" && args.hours === undefined) {
      return refusal({ code: "FIELD_REQUIRED", field: "hours" });
    }
    const replay = await ctx.tenantDb
      .byIndex<LeaveRow>("leaveRequests", "by_orgId_requestId", [
        { field: "requestId", value: args.requestId },
      ])
      .first();
    if (replay !== null) {
      return replay.employeeId === employee._id
        ? written({ documentId: replay._id, replayed: true })
        : refusal({ code: "REQUEST_ID_REUSED", field: "requestId" });
    }
    const active: LeaveRow[] = [];
    for (const status of ["SUBMITTED", "APPROVED"] as const) {
      const page = await ctx.tenantDb
        .byIndex<LeaveRow>(
          "leaveRequests",
          "by_orgId_employeeId_status_startDate",
          [
            { field: "employeeId", value: employee._id },
            { field: "status", value: status },
          ],
        )
        .page({ limit: MAX_TEAM_ROWS + 1 });
      if (!page.isDone || page.page.length > MAX_TEAM_ROWS) {
        return refusal({
          code: "BOUNDED_VIEW_EXCEEDED",
          field: "leaveRequests",
        });
      }
      active.push(...page.page);
    }
    if (
      active.some(
        (request) =>
          args.startDate <= request.endDate &&
          args.endDate >= request.startDate,
      )
    ) {
      return refusal({ code: "LEAVE_OVERLAP", field: "startDate" });
    }
    const privateReason = args.privateReason?.trim();
    if (privateReason !== undefined && privateReason.length > 1_000) {
      return refusal({ code: "FIELD_INVALID", field: "privateReason" });
    }
    const id = await ctx.tenantDb.insert("leaveRequests", {
      requestId: args.requestId,
      employeeId: employee._id,
      warehouseId: args.warehouseId,
      startDate: args.startDate,
      endDate: args.endDate,
      leaveType: args.leaveType,
      durationKind: args.durationKind,
      ...(args.hours === undefined ? {} : { hours: args.hours }),
      ...(privateReason === undefined || privateReason.length === 0
        ? {}
        : { privateReason }),
      status: "SUBMITTED",
      requestedByUserId: ctx.tenant.actor._id,
      requestedAt: Date.now(),
    });
    return written({ documentId: id, replayed: false });
  },
});

export const cancelLeave = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    leaveRequestId: v.id("leaveRequests"),
  },
  returns: writeOutcomeValidator,
  permissionCode: "hr.self.leave.request",
  target: {
    table: "leaveRequests",
    id: ({ leaveRequestId }) => leaveRequestId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const employee = await employeeForActor(ctx);
    const request = await ctx.tenantDb.get<LeaveRow>(
      "leaveRequests",
      args.leaveRequestId,
    );
    if (
      employee === null ||
      request === null ||
      request.employeeId !== employee._id ||
      request.warehouseId !== args.warehouseId
    ) {
      return refusal({ code: "NOT_FOUND", table: "leaveRequests" });
    }
    if (request.status === "CANCELLED") {
      return written({ documentId: request._id, replayed: true });
    }
    if (request.status !== "SUBMITTED" && request.status !== "APPROVED") {
      return refusal({ code: "PRECONDITION_FAILED", field: "status" });
    }
    await ctx.tenantDb.patch("leaveRequests", request._id, {
      status: "CANCELLED",
      decidedByUserId: ctx.tenant.actor._id,
      decidedAt: Date.now(),
      decisionNote: "CANCELLED_BY_EMPLOYEE",
    });
    return written({ documentId: request._id, replayed: false });
  },
});

async function leaveDecisionPolicy(
  ctx: TenantPolicyContext,
  args: { readonly leaveRequestId: string },
) {
  const request = await ctx.tenantDb.get<LeaveRow>(
    "leaveRequests",
    args.leaveRequestId,
  );
  const ownTeam =
    request === null
      ? false
      : await isActorSupervisorOf(ctx, request.employeeId);
  return {
    thresholdExceeded: false,
    approvalSatisfied: request?.status === "SUBMITTED" && ownTeam,
    ...(request === null ? {} : { makerUserId: request.requestedByUserId }),
  };
}

export const decideLeave = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    leaveRequestId: v.id("leaveRequests"),
    decision: v.union(v.literal("APPROVE"), v.literal("REJECT")),
    note: v.string(),
  },
  returns: writeOutcomeValidator,
  permissionCode: "hr.team.leave.decide",
  target: {
    table: "leaveRequests",
    id: ({ leaveRequestId }) => leaveRequestId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  policy: leaveDecisionPolicy,
  handler: async (ctx, args) => {
    const request = await ctx.tenantDb.get<LeaveRow>(
      "leaveRequests",
      args.leaveRequestId,
    );
    if (
      request === null ||
      request.warehouseId !== args.warehouseId ||
      request.status !== "SUBMITTED" ||
      !(await isActorSupervisorOf(ctx, request.employeeId))
    ) {
      return refusal({ code: "PRECONDITION_FAILED", field: "leaveRequestId" });
    }
    const note = args.note.trim();
    if (note.length < 2 || note.length > 500) {
      return refusal({ code: "FIELD_INVALID", field: "note" });
    }
    await ctx.tenantDb.patch("leaveRequests", request._id, {
      status: args.decision === "APPROVE" ? "APPROVED" : "REJECTED",
      decidedByUserId: ctx.tenant.actor._id,
      decidedAt: Date.now(),
      decisionNote: note,
    });
    return written({ documentId: request._id, replayed: false });
  },
});

const teamRequestValidator = v.object({
  requestId: v.string(),
  kind: v.union(v.literal("CORRECTION"), v.literal("LEAVE")),
  employeeId: v.id("employees"),
  employeeNumber: v.string(),
  displayName: v.string(),
  requestedAt: v.number(),
  summary: v.string(),
});

/** Team inbox omits correction reason and leave type/reason: only capacity facts cross the scope. */
export const listTeamInbox = queryWithOrg({
  args: { warehouseId: v.id("warehouses") },
  returns: v.object({
    items: v.array(teamRequestValidator),
    complete: v.boolean(),
    asOf: v.number(),
  }),
  permissionCode: "hr.team.read",
  target: { table: "employees" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const supervisor = await supervisorForActor(ctx);
    if (
      supervisor === null ||
      supervisor.team.warehouseId !== args.warehouseId
    ) {
      return { items: [], complete: true, asOf: Date.now() };
    }
    const [corrections, leaves] = await Promise.all([
      ctx.tenantDb
        .byIndex<CorrectionRow>(
          "attendanceCorrections",
          "by_orgId_warehouseId_status_requestedAt",
          [
            { field: "warehouseId", value: args.warehouseId },
            { field: "status", value: "SUBMITTED" },
          ],
        )
        .page({ limit: MAX_TEAM_ROWS + 1 }),
      ctx.tenantDb
        .byIndex<LeaveRow>(
          "leaveRequests",
          "by_orgId_warehouseId_status_startDate",
          [
            { field: "warehouseId", value: args.warehouseId },
            { field: "status", value: "SUBMITTED" },
          ],
        )
        .page({ limit: MAX_TEAM_ROWS + 1 }),
    ]);
    const raw = [
      ...corrections.page.slice(0, MAX_TEAM_ROWS).map((request) => ({
        requestId: request._id,
        employeeId: request.employeeId,
        kind: "CORRECTION" as const,
        requestedAt: request.requestedAt,
        summary: "Attendance correction",
      })),
      ...leaves.page.slice(0, MAX_TEAM_ROWS).map((request) => ({
        requestId: request._id,
        employeeId: request.employeeId,
        kind: "LEAVE" as const,
        requestedAt: request.requestedAt,
        summary: `${request.startDate} – ${request.endDate}`,
      })),
    ].sort((a, b) => a.requestedAt - b.requestedAt);
    const rows = await Promise.all(
      raw.slice(0, MAX_TEAM_ROWS).map(async (request) => ({
        request,
        employee: await ctx.tenantDb.get<EmployeeRow>(
          "employees",
          request.employeeId,
        ),
      })),
    );
    return {
      items: rows.flatMap(({ request, employee }) =>
        employee === null || employee.teamId !== supervisor.team._id
          ? []
          : [
              {
                ...request,
                employeeNumber: employee.employeeNumber,
                displayName: employee.displayName,
              },
            ],
      ),
      complete:
        corrections.page.length <= MAX_TEAM_ROWS &&
        leaves.page.length <= MAX_TEAM_ROWS &&
        raw.length <= MAX_TEAM_ROWS,
      asOf: Date.now(),
    };
  },
});
