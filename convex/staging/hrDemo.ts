/**
 * Optional local HR demonstration data. Internal and guarded: it refuses to
 * run without `ALLOW_LOCAL_TEST_SEED=true`, a loopback Convex URL and the
 * literal confirmation. Never part of the public API.
 *
 * Creates (once per organization): HR provisioning, a supervisor and a staff
 * member, three employees (linked test account, unlinked, overnight shift),
 * a site holiday, an ordinary day, missing events, a certified and a pending
 * correction, and a period closed as v1 then reopened as a v2 draft.
 */
import { v } from "convex/values";
import type { GenericMutationCtx } from "convex/server";

import { internalMutation } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { storedPlan } from "../hr/shared";
import { provisionHrForOrganization } from "../lib/authorizationSeedConvex";
import { sha256Hex } from "../lib/idempotency";
import {
  addDays,
  fromLocal,
  timezoneOffsetMinutes,
  toLocal,
  type IsoDate,
} from "../model/hr/calendar";
import {
  buildPeriodRows,
  closeBlocker,
  periodFingerprintText,
  periodTotals,
} from "../model/hr/period";
import { planFor, type Schedule } from "../model/hr/schedule";
import type { DataModel } from "../schema";

export const HR_DEMO_CONFIRMATION = "LOCAL_HR_FIXTURES_V1";

const DAY: Schedule = {
  workDays: [1, 2, 3, 4, 5],
  startTime: "08:30",
  endTime: "17:30",
  endsNextDay: false,
  breakMinutes: 60,
};
const NIGHT: Schedule = {
  workDays: [1, 2, 3, 4, 5, 6, 7],
  startTime: "22:00",
  endTime: "06:00",
  endsNextDay: true,
  breakMinutes: 30,
};

function assertLocal(confirmation: string) {
  if (
    typeof process === "undefined" ||
    process.env.ALLOW_LOCAL_TEST_SEED !== "true" ||
    confirmation !== HR_DEMO_CONFIRMATION
  )
    throw new Error("Local HR seed is disabled");
  const url = process.env.CONVEX_CLOUD_URL ?? process.env.CONVEX_URL ?? "";
  if (url && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(url))
    throw new Error("Refusing local HR seed for a non-loopback Convex URL");
}

type Ctx = GenericMutationCtx<DataModel>;

async function member(
  ctx: Ctx,
  orgId: Id<"organizations">,
  clerkUserId: string,
  displayName: string,
  roleKey: string,
) {
  const userId =
    (
      await ctx.db
        .query("users")
        .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", clerkUserId))
        .unique()
    )?._id ??
    (await ctx.db.insert("users", {
      clerkUserId,
      displayName,
      status: "ACTIVE",
    }));
  const membershipId =
    (
      await ctx.db
        .query("memberships")
        .withIndex("by_orgId_userId", (q) =>
          q.eq("orgId", orgId).eq("userId", userId),
        )
        .unique()
    )?._id ??
    (await ctx.db.insert("memberships", {
      orgId,
      userId,
      clerkMembershipId: `local-hr-${clerkUserId}`,
      status: "ACTIVE",
      scopeMode: "ORG_WIDE",
      effectiveFrom: 0,
    }));
  await grant(ctx, orgId, membershipId, roleKey);
  return { userId, membershipId };
}

async function grant(
  ctx: Ctx,
  orgId: Id<"organizations">,
  membershipId: Id<"memberships">,
  roleKey: string,
) {
  const role = await ctx.db
    .query("roles")
    .withIndex("by_orgId_key", (q) => q.eq("orgId", orgId).eq("key", roleKey))
    .unique();
  if (role === null) throw new Error(`Role ${roleKey} is missing`);
  const existing = await ctx.db
    .query("membershipRoles")
    .withIndex("by_orgId_membershipId_roleId", (q) =>
      q
        .eq("orgId", orgId)
        .eq("membershipId", membershipId)
        .eq("roleId", role._id),
    )
    .unique();
  if (existing === null)
    await ctx.db.insert("membershipRoles", {
      orgId,
      membershipId,
      roleId: role._id,
      grantedAt: Date.now(),
    });
}

export const seed = internalMutation({
  args: {
    warehouseId: v.id("warehouses"),
    actorUserId: v.id("users"),
    confirmation: v.string(),
  },
  handler: async (ctx, args) => {
    assertLocal(args.confirmation);
    const site = await ctx.db.get("warehouses", args.warehouseId);
    if (site === null) throw new Error("Seed warehouse not found");
    const orgId = site.orgId;
    const organization = await ctx.db.get("organizations", orgId);
    const offset = timezoneOffsetMinutes(
      organization?.settings.timezone ?? "Asia/Bangkok",
    );
    if (!offset.ok) throw new Error("Organization timezone is unsupported");
    const existing = await ctx.db
      .query("hrEmployees")
      .withIndex("by_orgId_code", (q) =>
        q.eq("orgId", orgId).eq("code", "EMP-DEMO-001"),
      )
      .unique();
    if (existing !== null) return { created: false, employees: 0 };

    const provisioning = await provisionHrForOrganization(ctx, orgId);
    const actorMembership = await ctx.db
      .query("memberships")
      .withIndex("by_orgId_userId", (q) =>
        q.eq("orgId", orgId).eq("userId", args.actorUserId),
      )
      .unique();
    if (actorMembership === null) throw new Error("Actor is not a member");
    // ORG_ADMIN may be customized; HR_ADMIN guarantees the demo is usable.
    await grant(ctx, orgId, actorMembership._id, "HR_ADMIN");
    await grant(ctx, orgId, actorMembership._id, "HR_EMPLOYEE");
    const supervisor = await member(
      ctx,
      orgId,
      "local_hr_supervisor",
      "หัวหน้าทดสอบ (Supervisor)",
      "HR_SUPERVISOR",
    );
    const staff = await member(
      ctx,
      orgId,
      "local_hr_staff",
      "พนักงานกะดึก (Night staff)",
      "HR_EMPLOYEE",
    );

    const now = Date.now();
    const today = toLocal(now, offset.value).date;
    const start = addDays(today, -60);
    const stamps = {
      createdAt: now,
      createdByUserId: args.actorUserId,
      updatedAt: now,
      updatedByUserId: args.actorUserId,
    };
    const employee = async (
      code: string,
      displayName: string,
      schedule: Schedule,
      userId: Id<"users"> | undefined,
      supervisorUserId: Id<"users">,
    ) =>
      await ctx.db.insert("hrEmployees", {
        orgId,
        warehouseId: site._id,
        code,
        displayName,
        ...(userId === undefined ? {} : { userId }),
        supervisorUserId,
        employmentStartDate: start,
        status: "ACTIVE",
        schedule: { ...schedule, workDays: [...schedule.workDays] },
        version: 1,
        ...stamps,
      });
    const self = await employee(
      "EMP-DEMO-001",
      "สมชาย ใจดี (Test account)",
      DAY,
      args.actorUserId,
      supervisor.userId,
    );
    const unlinked = await employee(
      "EMP-DEMO-002",
      "วิภา ไม่มีบัญชี (No account)",
      DAY,
      undefined,
      args.actorUserId,
    );
    const night = await employee(
      "EMP-DEMO-003",
      "ธนา กะดึก (Night shift)",
      NIGHT,
      staff.userId,
      args.actorUserId,
    );
    const schedules = new Map<string, Schedule>([
      [self, DAY],
      [unlinked, DAY],
      [night, NIGHT],
    ]);

    const holidays = new Map<IsoDate, string>();
    const weekdayBefore = (date: IsoDate) => {
      let candidate = date;
      while (
        !DAY.workDays.includes(
          ((new Date(`${candidate}T00:00:00Z`).getUTCDay() + 6) % 7) + 1,
        )
      )
        candidate = addDays(candidate, -1);
      return candidate;
    };
    const periodStart = addDays(today, -20);
    const periodEnd = addDays(today, -14);
    const recentHoliday = weekdayBefore(addDays(today, -6));
    const periodHoliday = weekdayBefore(addDays(today, -16));
    for (const [date, name] of [
      [recentHoliday, "วันหยุดสถานที่ (Site holiday)"],
      [periodHoliday, "วันหยุดชดเชย (Substitute holiday)"],
    ] as const) {
      holidays.set(date, name);
      await ctx.db.insert("hrHolidays", {
        orgId,
        warehouseId: site._id,
        date,
        name,
        createdAt: now,
        createdByUserId: args.actorUserId,
      });
    }

    const plan = (employeeId: Id<"hrEmployees">, date: IsoDate) =>
      planFor({
        date,
        schedule: schedules.get(employeeId),
        holidayName: holidays.get(date),
        offsetMinutes: offset.value,
      });
    let sequence = 0;
    const record = async (
      employeeId: Id<"hrEmployees">,
      date: IsoDate,
      input: {
        readonly inMinute?: number;
        readonly outMinute?: number;
        readonly actor?: Id<"users">;
        readonly certification?: DataModel["hrAttendanceDays"]["document"]["certification"];
      },
    ) => {
      const dayPlan = plan(employeeId, date);
      const clockInAt =
        input.inMinute === undefined
          ? undefined
          : fromLocal(date, input.inMinute, offset.value);
      const clockOutAt =
        input.outMinute === undefined
          ? undefined
          : fromLocal(date, input.outMinute, offset.value);
      const events =
        (clockInAt === undefined ? 0 : 1) + (clockOutAt === undefined ? 0 : 1);
      const dayId = await ctx.db.insert("hrAttendanceDays", {
        orgId,
        employeeId,
        warehouseId: site._id,
        businessDate: date,
        plan: storedPlan(dayPlan),
        ...(clockInAt === undefined ? {} : { clockInAt }),
        ...(clockOutAt === undefined ? {} : { clockOutAt }),
        open:
          clockInAt !== undefined &&
          clockOutAt === undefined &&
          input.certification === undefined,
        revision: events + (input.certification === undefined ? 0 : 1),
        ...(input.certification === undefined
          ? {}
          : { certification: input.certification }),
        createdAt: now,
        updatedAt: now,
      });
      for (const [kind, occurredAt] of [
        ["CLOCK_IN", clockInAt],
        ["CLOCK_OUT", clockOutAt],
      ] as const) {
        if (occurredAt === undefined) continue;
        await ctx.db.insert("hrAttendanceEvents", {
          orgId,
          dayId,
          employeeId,
          warehouseId: site._id,
          businessDate: date,
          kind,
          occurredAt,
          actorUserId: input.actor ?? args.actorUserId,
          requestId: `local-hr-seed-${(sequence += 1)}`,
          source: "ONLINE_SELF",
        });
      }
      return dayId;
    };

    // Closed period: every employed date is accounted for.
    for (let date = periodStart; date <= periodEnd; date = addDays(date, 1)) {
      if (plan(self, date).kind === "SCHEDULED")
        await record(self, date, { inMinute: 505, outMinute: 1052 });
      if (plan(night, date).kind === "SCHEDULED")
        await record(night, date, {
          inMinute: 1318,
          outMinute: 1440 + 362,
          actor: staff.userId,
        });
      if (plan(unlinked, date).kind === "SCHEDULED")
        await record(unlinked, date, {
          certification: {
            disposition: date === periodStart ? "ABSENT" : "LEAVE",
            revision: 1,
            reason:
              date === periodStart
                ? "ไม่มาทำงาน ยืนยันทางโทรศัพท์"
                : "ลาตามใบลากระดาษ (paper leave form)",
            decidedByUserId: args.actorUserId,
            decidedAt: now,
          },
        });
    }

    // Recent days outside any period.
    const ordinary = weekdayBefore(addDays(today, -1));
    const certifiedDay = weekdayBefore(addDays(ordinary, -1));
    await record(self, ordinary, { inMinute: 503, outMinute: 1060 });
    const certifiedDayId = await record(self, certifiedDay, {
      inMinute: 509,
      certification: {
        disposition: "WORKED",
        startAt: fromLocal(certifiedDay, 509, offset.value),
        endAt: fromLocal(certifiedDay, 1050, offset.value),
        revision: 2,
        reason: "ลืมลงเวลาออก (forgot to clock out)",
        decidedByUserId: supervisor.userId,
        decidedAt: now,
      },
    });
    const certifiedId = await ctx.db.insert("hrCorrectionRequests", {
      orgId,
      dayId: certifiedDayId,
      employeeId: self,
      warehouseId: site._id,
      businessDate: certifiedDay,
      status: "CERTIFIED",
      proposedStartAt: fromLocal(certifiedDay, 509, offset.value),
      proposedEndAt: fromLocal(certifiedDay, 1050, offset.value),
      reason: "ลืมลงเวลาออก (forgot to clock out)",
      baseRevision: 1,
      version: 2,
      submittedByUserId: args.actorUserId,
      submittedAt: now - 3_600_000,
      decidedByUserId: supervisor.userId,
      decidedAt: now,
      history: [
        {
          action: "SUBMITTED",
          actorUserId: args.actorUserId,
          at: now - 3_600_000,
          reason: "ลืมลงเวลาออก (forgot to clock out)",
        },
        { action: "CERTIFIED", actorUserId: supervisor.userId, at: now },
      ],
    });
    await ctx.db.patch("hrAttendanceDays", certifiedDayId, { open: false });
    void certifiedId;

    // Overnight shift: a complete night, then a missing end with a pending request.
    const nightDone = addDays(today, -3);
    const nightOpen = addDays(today, -2);
    await record(night, nightDone, {
      inMinute: 1320,
      outMinute: 1440 + 360,
      actor: staff.userId,
    });
    const openDayId = await record(night, nightOpen, {
      inMinute: 1322,
      actor: staff.userId,
    });
    const pendingId = await ctx.db.insert("hrCorrectionRequests", {
      orgId,
      dayId: openDayId,
      employeeId: night,
      warehouseId: site._id,
      businessDate: nightOpen,
      status: "PENDING",
      proposedStartAt: fromLocal(nightOpen, 1322, offset.value),
      proposedEndAt: fromLocal(nightOpen, 1440 + 360, offset.value),
      reason: "ออกเวลา 06:00 แต่ลืมลงเวลา (left at 06:00)",
      baseRevision: 1,
      version: 1,
      submittedByUserId: staff.userId,
      submittedAt: now,
      history: [
        {
          action: "SUBMITTED",
          actorUserId: staff.userId,
          at: now,
          reason: "ออกเวลา 06:00 แต่ลืมลงเวลา (left at 06:00)",
        },
      ],
    });
    await ctx.db.patch("hrAttendanceDays", openDayId, {
      pendingCorrectionId: pendingId,
    });

    // Freeze the period as v1, then reopen it as a v2 draft with a reason.
    const periodId = await ctx.db.insert("hrPeriods", {
      orgId,
      warehouseId: site._id,
      startDate: periodStart,
      endDate: periodEnd,
      status: "DRAFT",
      draftVersion: 1,
      latestClosedVersion: 0,
      ...stamps,
    });
    const recorded = new Map<
      string,
      DataModel["hrAttendanceDays"]["document"]
    >();
    for (const day of await ctx.db
      .query("hrAttendanceDays")
      .withIndex("by_orgId_warehouseId_businessDate", (q) =>
        q.eq("orgId", orgId),
      )
      .take(500))
      recorded.set(`${day.employeeId}:${day.businessDate}`, day);
    const rows = buildPeriodRows({
      startDate: periodStart,
      endDate: periodEnd,
      employees: [
        {
          id: self,
          code: "EMP-DEMO-001",
          name: "สมชาย ใจดี (Test account)",
          employment: { startDate: start },
          schedule: DAY,
        },
        {
          id: unlinked,
          code: "EMP-DEMO-002",
          name: "วิภา ไม่มีบัญชี (No account)",
          employment: { startDate: start },
          schedule: DAY,
        },
        {
          id: night,
          code: "EMP-DEMO-003",
          name: "ธนา กะดึก (Night shift)",
          employment: { startDate: start },
          schedule: NIGHT,
        },
      ],
      offsetMinutes: offset.value,
      now,
      holidayName: (date) => holidays.get(date),
      recorded: (id, date) => {
        const day = recorded.get(`${id}:${date}`);
        if (day === undefined) return undefined;
        return {
          plan: plan(id as Id<"hrEmployees">, date),
          revision: day.revision,
          clockInAt: day.clockInAt,
          clockOutAt: day.clockOutAt,
          certification: day.certification,
        };
      },
      pending: () => false,
    });
    const blocker = closeBlocker({ endDate: periodEnd, today, rows });
    if (blocker !== null)
      throw new Error(`Demo period cannot close: ${blocker}`);
    const totals = periodTotals(rows);
    const versionId = await ctx.db.insert("hrPeriodVersions", {
      orgId,
      periodId,
      warehouseId: site._id,
      version: 1,
      startDate: periodStart,
      endDate: periodEnd,
      timezone: organization?.settings.timezone ?? "Asia/Bangkok",
      siteCode: site.code,
      siteName: site.name,
      fingerprint: await sha256Hex(
        `${periodId}:1:${periodFingerprintText(rows)}`,
      ),
      totals: {
        employees: totals.employees,
        days: totals.days,
        workedMinutes: totals.workedMinutes,
        outsideShiftMinutes: totals.outsideShiftMinutes,
        absentDays: totals.absentDays,
        leaveDays: totals.leaveDays,
        nonworkingDays: totals.nonworkingDays,
      },
      closedByUserId: args.actorUserId,
      closedAt: now,
    });
    for (const row of rows)
      await ctx.db.insert("hrPeriodRows", {
        orgId,
        versionId,
        employeeId: row.employeeId as Id<"hrEmployees">,
        employeeCode: row.employeeCode,
        employeeName: row.employeeName,
        businessDate: row.businessDate,
        plan: storedPlan(row.plan),
        ...(row.actualStartAt === undefined
          ? {}
          : { actualStartAt: row.actualStartAt }),
        ...(row.actualEndAt === undefined
          ? {}
          : { actualEndAt: row.actualEndAt }),
        workedMinutes: row.workedMinutes,
        outsideShiftMinutes: row.outsideShiftMinutes,
        disposition: row.disposition ?? "NONWORKING",
        ...(row.correctionReason === undefined
          ? {}
          : { correctionReason: row.correctionReason }),
      });
    await ctx.db.patch("hrPeriods", periodId, {
      status: "DRAFT",
      draftVersion: 2,
      latestClosedVersion: 1,
      revisionReason: "เปิดฉบับแก้ไขเพื่อทดสอบ (local revision demo)",
    });
    return {
      created: true,
      employees: 3,
      orgAdmin: provisioning.orgAdmin,
      periodId,
      closedVersionId: versionId,
      periodRange: `${periodStart}..${periodEnd}`,
      today,
    };
  },
});
