/**
 * Staged attendance-period close: any roster size, bounded transactions.
 *
 *   DRAFT ──begin──▶ CLOSING/BUILDING ──advance×n──▶ CLOSING/READY ──publish──▶ CLOSED
 *                         │                               │
 *                         └──── failure or cancel ───▶ CLOSING/CANCELLING ──advance×n──▶ DRAFT
 *
 * `begin` freezes the period (every attendance, correction, leave, holiday and
 * roster write covering it is refused while CLOSING) and records a snapshot
 * time and timezone offset. Each `advance` processes the next
 * `BUILD_EMPLOYEES` employees in roster index order, evaluates their rows at
 * the snapshot, validates their source revisions against it, and writes
 * their frozen rows into an unpublished version (`build` present), extending
 * the running totals and fingerprint chain. A step number makes every chunk
 * apply exactly once: a duplicate or stale delivery is refused and changes
 * nothing. Any open day, empty roster, newer source revision or a mismatch
 * with the reviewer's complete-preview fingerprint discards the attempt; the
 * staged rows are deleted in bounded chunks and the period returns to DRAFT
 * with the reason. Totals become visible as history only when `publish` (or
 * a matching complete-preview fingerprint at the end of the build) flips the
 * version to published in one transaction.
 */
import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import { HR_PERMISSION } from "../lib/permissions";
import {
  mutationWithOrg,
  type TenantFunctionContext,
} from "../lib/tenantFunctions";
import {
  MAX_PREVIEW_EMPLOYEES,
  buildPeriodRows,
  closeBlocker,
  periodTotals,
  type PeriodRow,
} from "../model/hr/period";
import {
  draftFingerprint,
  fingerprintSeed,
  fingerprintStep,
  liveRows,
  periodEmployee,
  scopedPeriod,
} from "./periodData";
import {
  employedInRange,
  employeeDaysInRange,
  fail,
  hrCommand,
  orgClock,
  recordedDay,
  storedPlan,
  type Employee,
} from "./shared";

const CLOSE = HR_PERMISSION.periodClose;
/** Employed people one build step evaluates (≤ 31 rows each). */
export const BUILD_EMPLOYEES = 25;
/** Roster documents one build step examines (former staff are skipped). */
export const BUILD_SCAN = 100;
/** Staged rows one discard step deletes. */
export const DISCARD_ROWS = 500;
/** Build steps that cover a complete-preview roster in one transaction. */
const PREVIEW_STEPS = Math.ceil(MAX_PREVIEW_EMPLOYEES / BUILD_EMPLOYEES) + 1;

type Period = Doc<"hrPeriods">;
type Version = Doc<"hrPeriodVersions">;
type Build = NonNullable<Version["build"]>;
type Failure = NonNullable<Build["failure"]>;

/** Where a close stands, as every close command answers it. */
async function progress(ctx: TenantFunctionContext, periodId: string) {
  const period = await scopedPeriod(ctx, periodId);
  if (period === null) return fail("NOT_FOUND", "periodId");
  if (period.status !== "CLOSING")
    return {
      state: period.status,
      latestClosedVersion: period.latestClosedVersion,
      ...(period.status === "CLOSED"
        ? { version: period.latestClosedVersion }
        : {}),
      ...(period.closeFailure === undefined
        ? {}
        : { failure: period.closeFailure.code }),
    };
  const version = await stagedVersion(ctx, period);
  return version === null
    ? fail("PERIOD_CLOSE_UNAVAILABLE")
    : {
        state: version.build.state,
        versionId: version._id,
        version: version.version,
        step: version.build.step,
        employees: version.totals.employees,
        days: version.totals.days,
      };
}

async function stagedVersion(
  ctx: TenantFunctionContext,
  period: Period,
): Promise<(Version & { build: Build }) | null> {
  if (period.status !== "CLOSING" || period.closingVersionId === undefined)
    return null;
  const version = await ctx.tenantDb.get<Version>(
    "hrPeriodVersions",
    period.closingVersionId,
  );
  return version !== null &&
    version.build !== undefined &&
    version.periodId === period._id
    ? (version as Version & { build: Build })
    : null;
}

/** Discard the attempt: switch to bounded cleanup, keeping the reason. */
async function discard(
  ctx: TenantFunctionContext,
  version: Version & { build: Build },
  failure: Failure | undefined,
) {
  await ctx.tenantDb.patch("hrPeriodVersions", version._id, {
    build: {
      ...version.build,
      state: "CANCELLING" as const,
      step: version.build.step + 1,
      ...(failure === undefined ? {} : { failure }),
    },
  });
}

/** One bounded build step: the next employees of the roster. */
async function buildStep(
  ctx: TenantFunctionContext,
  period: Period,
  version: Version & { build: Build },
) {
  const { build } = version;
  const employees = await ctx.tenantDb
    .byIndex<Employee>(
      "hrEmployees",
      "by_orgId_warehouseId_code",
      [{ field: "warehouseId", value: period.warehouseId }],
      build.cursor === undefined
        ? undefined
        : {
            field: "code",
            lower: { value: build.cursor, inclusive: false },
          },
    )
    .take(BUILD_SCAN);
  const holidays = await ctx.tenantDb
    .byIndex<Doc<"hrHolidays">>(
      "hrHolidays",
      "by_orgId_warehouseId_date",
      [{ field: "warehouseId", value: period.warehouseId }],
      {
        field: "date",
        lower: { value: period.startDate, inclusive: true },
        upper: { value: period.endDate, inclusive: true },
      },
    )
    .all(64);
  const stale = holidays.find(
    (holiday) => holiday.createdAt > build.snapshotAt,
  );
  if (stale !== undefined)
    return await discard(ctx, version, {
      code: "PERIOD_STALE",
      businessDate: stale.date,
    });
  const holidayName = new Map(holidays.map((row) => [row.date, row.name]));

  const groups: PeriodRow[][] = [];
  let examined = 0;
  let evaluated = 0;
  for (const employee of employees) {
    if (evaluated === BUILD_EMPLOYEES) break;
    examined += 1;
    if (!employedInRange(employee, period.startDate, period.endDate)) continue;
    evaluated += 1;
    // Explicit snapshot validation, beyond the write guards: any source
    // revised after the snapshot discards the attempt.
    if (employee.updatedAt > build.snapshotAt)
      return await discard(ctx, version, {
        code: "PERIOD_STALE",
        employeeId: employee._id,
      });
    const days = await employeeDaysInRange(
      ctx,
      employee._id,
      period.startDate,
      period.endDate,
    );
    for (const day of days.values())
      if (day.updatedAt > build.snapshotAt)
        return await discard(ctx, version, {
          code: "PERIOD_STALE",
          employeeId: employee._id,
          businessDate: day.businessDate,
        });
    const rows = buildPeriodRows({
      startDate: period.startDate,
      endDate: period.endDate,
      employees: [periodEmployee(employee)],
      offsetMinutes: build.offsetMinutes,
      now: build.snapshotAt,
      holidayName: (date) => holidayName.get(date),
      recorded: (_id, date) => {
        const day = days.get(date);
        return day ? recordedDay(day) : undefined;
      },
      pending: (_id, date) => days.get(date)?.pendingCorrectionId !== undefined,
    });
    const open =
      rows.find((row) => row.status === "EXCEPTION") ??
      rows.find((row) => row.status !== "READY");
    if (open !== undefined)
      return await discard(ctx, version, {
        code:
          open.status === "EXCEPTION"
            ? "PERIOD_NOT_READY"
            : "PERIOD_SHIFT_UNFINISHED",
        employeeId: employee._id,
        businessDate: open.businessDate,
      });
    if (rows.length > 0) groups.push([...rows]);
  }

  let chain = version.fingerprint;
  const totals = { ...version.totals };
  for (const rows of groups) {
    chain = await fingerprintStep(chain, rows);
    const add = periodTotals(rows);
    totals.employees += add.employees;
    totals.days += add.days;
    totals.workedMinutes += add.workedMinutes;
    totals.outsideShiftMinutes += add.outsideShiftMinutes;
    totals.absentDays += add.absentDays;
    totals.leaveDays += add.leaveDays;
    totals.nonworkingDays += add.nonworkingDays;
    for (const row of rows)
      await ctx.tenantDb.insert("hrPeriodRows", {
        versionId: version._id,
        employeeId: row.employeeId as Id<"hrEmployees">,
        employeeCode: row.employeeCode,
        employeeName: row.employeeName,
        businessDate: row.businessDate,
        plan: storedPlan(row.plan),
        originalCaptured: true,
        ...(row.originalStartAt === undefined
          ? {}
          : { originalStartAt: row.originalStartAt }),
        ...(row.originalEndAt === undefined
          ? {}
          : { originalEndAt: row.originalEndAt }),
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
  }
  const done = examined === employees.length && employees.length < BUILD_SCAN;
  const next: Version & { build: Build } = {
    ...version,
    fingerprint: chain,
    totals,
    build: {
      ...build,
      step: build.step + 1,
      state: done ? "READY" : "BUILDING",
      ...(examined === 0 ? {} : { cursor: employees[examined - 1]!.code }),
    },
  };
  await ctx.tenantDb.patch("hrPeriodVersions", version._id, {
    fingerprint: next.fingerprint,
    totals: next.totals,
    build: next.build,
  });
  if (!done) return;
  if (totals.days === 0)
    return await discard(ctx, next, { code: "PERIOD_EMPTY" });
  // A reviewer who saw the complete draft approved exactly these rows.
  if (build.expectedFingerprint !== undefined) {
    if (build.expectedFingerprint !== chain)
      return await discard(ctx, next, { code: "PERIOD_STALE" });
    await publishVersion(ctx, period, next);
  }
}

/** One bounded discard step; the last one returns the period to DRAFT. */
async function discardStep(
  ctx: TenantFunctionContext,
  period: Period,
  version: Version & { build: Build },
) {
  // Tenant index reads return at most 100 rows per range.
  let deleted = 0;
  let finished = false;
  while (deleted < DISCARD_ROWS) {
    const rows = await ctx.tenantDb
      .byIndex<Doc<"hrPeriodRows">>("hrPeriodRows", "by_orgId_versionId", [
        { field: "versionId", value: version._id },
      ])
      .take(100);
    for (const row of rows) await ctx.tenantDb.delete("hrPeriodRows", row._id);
    deleted += rows.length;
    if (rows.length < 100) {
      finished = true;
      break;
    }
  }
  if (!finished) {
    await ctx.tenantDb.patch("hrPeriodVersions", version._id, {
      build: { ...version.build, step: version.build.step + 1 },
    });
    return;
  }
  await ctx.tenantDb.delete("hrPeriodVersions", version._id);
  const failure = version.build.failure;
  await ctx.tenantDb.patch("hrPeriods", period._id, {
    status: "DRAFT",
    closingVersionId: undefined,
    closeFailure:
      failure === undefined ? undefined : { ...failure, at: Date.now() },
    updatedAt: Date.now(),
    updatedByUserId: ctx.tenant.actor._id,
  });
}

async function publishVersion(
  ctx: TenantFunctionContext,
  period: Period,
  version: Version & { build: Build },
) {
  const now = Date.now();
  await ctx.tenantDb.patch("hrPeriodVersions", version._id, {
    build: undefined,
    closedAt: now,
    closedByUserId: ctx.tenant.actor._id,
  });
  await ctx.tenantDb.patch("hrPeriods", period._id, {
    status: "CLOSED",
    latestClosedVersion: version.version,
    closingVersionId: undefined,
    closeFailure: undefined,
    updatedAt: now,
    updatedByUserId: ctx.tenant.actor._id,
  });
}

/** Apply one step; answer the build state it leaves (null once settled). */
async function applyStep(ctx: TenantFunctionContext, periodId: string) {
  const period = await scopedPeriod(ctx, periodId);
  if (period === null) return null;
  const version = await stagedVersion(ctx, period);
  if (version === null) return null;
  if (version.build.state === "BUILDING") await buildStep(ctx, period, version);
  else if (version.build.state === "CANCELLING")
    await discardStep(ctx, period, version);
  const after = await scopedPeriod(ctx, periodId);
  const next = after === null ? null : await stagedVersion(ctx, after);
  return next?.build.state ?? null;
}

/**
 * Freeze a draft and run the first build step. With the fingerprint of a
 * complete preview (at most `MAX_PREVIEW_EMPLOYEES`), the draft is checked
 * first exactly as the reviewer saw it, then built and published in this one
 * transaction; otherwise later `advance` calls continue the build.
 */
/** The begin command, shared with the deprecated one-step `periods:close`. */
export const beginCloseCommand = (
  ctx: TenantFunctionContext,
  args: {
    readonly requestId: string;
    readonly periodId: string;
    readonly expectedFingerprint?: string | undefined;
  },
) =>
  hrCommand(ctx, {
    operation: "hr.period.beginClose",
    requestId: args.requestId,
    payload: {
      periodId: args.periodId,
      ...(args.expectedFingerprint === undefined
        ? {}
        : { expectedFingerprint: args.expectedFingerprint }),
    },
    table: "hrPeriodVersions",
    replay: async () => await progress(ctx, args.periodId),
    run: async () => {
      const clock = orgClock(ctx);
      if (clock === null) return fail("TIMEZONE_UNSUPPORTED");
      const period = await scopedPeriod(ctx, args.periodId);
      if (period === null) return fail("NOT_FOUND", "periodId");
      if (period.status === "CLOSING") return fail("PERIOD_CLOSE_IN_PROGRESS");
      if (period.status !== "DRAFT") return fail("PERIOD_ALREADY_CLOSED");
      if (period.endDate >= clock.today) return fail("PERIOD_INCLUDES_FUTURE");
      const site = await ctx.tenantDb.get<Doc<"warehouses">>(
        "warehouses",
        period.warehouseId,
      );
      if (site === null) return fail("SITE_UNAVAILABLE");
      if (args.expectedFingerprint !== undefined) {
        // Refuse before any write, like a one-step close always did.
        const live = await liveRows(ctx, period, clock);
        if (live === null) return fail("PERIOD_PREVIEW_INCOMPLETE");
        const blocker = closeBlocker({
          endDate: period.endDate,
          today: clock.today,
          rows: live.rows,
        });
        if (blocker !== null) return fail(blocker);
        if (
          (await draftFingerprint(period, live.byEmployee)) !==
          args.expectedFingerprint
        )
          return fail("PERIOD_STALE");
      }
      const versionId = (await ctx.tenantDb.insert("hrPeriodVersions", {
        periodId: period._id,
        warehouseId: period.warehouseId,
        version: period.draftVersion,
        startDate: period.startDate,
        endDate: period.endDate,
        timezone: clock.timezone,
        siteCode: site.code,
        siteName: site.name,
        ...(period.revisionReason === undefined
          ? {}
          : { revisionReason: period.revisionReason }),
        fingerprint: await fingerprintSeed(period),
        totals: {
          employees: 0,
          days: 0,
          workedMinutes: 0,
          outsideShiftMinutes: 0,
          absentDays: 0,
          leaveDays: 0,
          nonworkingDays: 0,
        },
        closedByUserId: ctx.tenant.actor._id,
        closedAt: clock.now,
        build: {
          state: "BUILDING",
          step: 0,
          snapshotAt: clock.now,
          offsetMinutes: clock.offset,
          ...(args.expectedFingerprint === undefined
            ? {}
            : { expectedFingerprint: args.expectedFingerprint }),
        },
      })) as Id<"hrPeriodVersions">;
      await ctx.tenantDb.patch("hrPeriods", period._id, {
        status: "CLOSING",
        closingVersionId: versionId,
        closeFailure: undefined,
        updatedAt: clock.now,
        updatedByUserId: ctx.tenant.actor._id,
      });
      const steps = args.expectedFingerprint === undefined ? 1 : PREVIEW_STEPS;
      for (let step = 0; step < steps; step += 1)
        if ((await applyStep(ctx, period._id)) !== "BUILDING") break;
      const extra = await progress(ctx, period._id);
      if ("written" in extra) return extra;
      return {
        documentId: versionId,
        warehouseId: period.warehouseId,
        extra: { ...extra, version: period.draftVersion },
        changes: [
          { field: "status", from: "DRAFT", to: "CLOSING" },
          { field: "version", to: String(period.draftVersion) },
          { field: "state", to: extra.state },
        ],
      };
    },
  });

export const begin = mutationWithOrg({
  args: {
    requestId: v.string(),
    periodId: v.id("hrPeriods"),
    /** The fingerprint of a complete preview: publish when the build matches. */
    expectedFingerprint: v.optional(v.string()),
  },
  returns: v.any(),
  permissionCode: CLOSE,
  target: { table: "hrPeriods", id: (args) => args.periodId },
  handler: async (ctx, args) => beginCloseCommand(ctx, args),
});

/**
 * Apply exactly the step the caller observed. A duplicate or late delivery
 * names an older step and is refused without changing anything, so retries
 * and concurrent drivers are safe; the next step resumes an interrupted close.
 */
export const advance = mutationWithOrg({
  args: {
    requestId: v.string(),
    periodId: v.id("hrPeriods"),
    versionId: v.id("hrPeriodVersions"),
    step: v.number(),
  },
  returns: v.any(),
  permissionCode: CLOSE,
  target: { table: "hrPeriods", id: (args) => args.periodId },
  handler: async (ctx, args) =>
    hrCommand(ctx, {
      operation: "hr.period.advanceClose",
      requestId: args.requestId,
      payload: {
        periodId: args.periodId,
        versionId: args.versionId,
        step: args.step,
      },
      table: "hrPeriods",
      replay: async () => await progress(ctx, args.periodId),
      run: async () => {
        const period = await scopedPeriod(ctx, args.periodId);
        if (period === null) return fail("NOT_FOUND", "periodId");
        const version = await stagedVersion(ctx, period);
        if (version === null || version._id !== args.versionId)
          return fail("PERIOD_CLOSE_NOT_IN_PROGRESS");
        if (version.build.state === "READY") return fail("PERIOD_CLOSE_READY");
        if (version.build.step !== args.step)
          return fail("PERIOD_CLOSE_STEP_STALE");
        await applyStep(ctx, period._id);
        const extra = await progress(ctx, period._id);
        if ("written" in extra) return extra;
        return {
          documentId: period._id,
          warehouseId: period.warehouseId,
          extra,
          changes: [
            { field: "step", to: String(args.step) },
            { field: "state", to: extra.state },
          ],
        };
      },
    }),
});

/** Publish a READY build: only the exact candidate the caller reviewed. */
export const publish = mutationWithOrg({
  args: {
    requestId: v.string(),
    periodId: v.id("hrPeriods"),
    versionId: v.id("hrPeriodVersions"),
    expectedFingerprint: v.string(),
  },
  returns: v.any(),
  permissionCode: CLOSE,
  target: { table: "hrPeriods", id: (args) => args.periodId },
  handler: async (ctx, args) =>
    hrCommand(ctx, {
      operation: "hr.period.closeVersion",
      requestId: args.requestId,
      payload: {
        periodId: args.periodId,
        versionId: args.versionId,
        expectedFingerprint: args.expectedFingerprint,
      },
      table: "hrPeriodVersions",
      replay: async (id) => {
        if ((await scopedPeriod(ctx, args.periodId)) === null)
          return fail("NOT_FOUND", "periodId");
        const version = await ctx.tenantDb.get<Version>("hrPeriodVersions", id);
        return version === null || version.build !== undefined
          ? null
          : { version: version.version };
      },
      run: async () => {
        const period = await scopedPeriod(ctx, args.periodId);
        if (period === null) return fail("NOT_FOUND", "periodId");
        if (period.status === "CLOSED") return fail("PERIOD_ALREADY_CLOSED");
        const version = await stagedVersion(ctx, period);
        if (version === null || version._id !== args.versionId)
          return fail("PERIOD_CLOSE_NOT_IN_PROGRESS");
        if (version.build.state !== "READY")
          return fail("PERIOD_CLOSE_NOT_READY");
        if (version.fingerprint !== args.expectedFingerprint)
          return fail("PERIOD_STALE");
        await publishVersion(ctx, period, version);
        return {
          documentId: version._id,
          warehouseId: period.warehouseId,
          extra: { version: version.version },
          changes: [
            { field: "periodId", to: period._id },
            { field: "version", to: String(version.version) },
            { field: "rows", to: String(version.totals.days) },
            {
              field: "workedMinutes",
              to: String(version.totals.workedMinutes),
            },
          ],
        };
      },
    }),
});

/** Discard an unpublished build and return the period to DRAFT. */
export const cancel = mutationWithOrg({
  args: {
    requestId: v.string(),
    periodId: v.id("hrPeriods"),
    versionId: v.id("hrPeriodVersions"),
  },
  returns: v.any(),
  permissionCode: CLOSE,
  target: { table: "hrPeriods", id: (args) => args.periodId },
  handler: async (ctx, args) =>
    hrCommand(ctx, {
      operation: "hr.period.cancelClose",
      requestId: args.requestId,
      payload: { periodId: args.periodId, versionId: args.versionId },
      table: "hrPeriods",
      replay: async () => await progress(ctx, args.periodId),
      run: async () => {
        const period = await scopedPeriod(ctx, args.periodId);
        if (period === null) return fail("NOT_FOUND", "periodId");
        const version = await stagedVersion(ctx, period);
        if (version === null || version._id !== args.versionId)
          return fail("PERIOD_CLOSE_NOT_IN_PROGRESS");
        if (version.build.state !== "CANCELLING")
          await discard(ctx, version, undefined);
        await applyStep(ctx, period._id);
        const extra = await progress(ctx, period._id);
        if ("written" in extra) return extra;
        return {
          documentId: period._id,
          warehouseId: period.warehouseId,
          extra,
          changes: [{ field: "state", to: extra.state }],
        };
      },
    }),
});
