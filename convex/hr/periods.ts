/**
 * Attendance periods: draft review, close (freeze), revision and CSV export.
 *
 * A close recomputes every row from authoritative data inside the mutation,
 * requires the fingerprint the reviewer saw, and writes an immutable version
 * with its rows. Exports read only those frozen rows, so a later punch,
 * correction, holiday or schedule edit cannot change a closed version.
 */
import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import { sha256Hex } from "../lib/idempotency";
import { HR_PERMISSION } from "../lib/permissions";
import {
  mutationWithOrg,
  queryWithOrg,
  type TenantFunctionContext,
} from "../lib/tenantFunctions";
import { datesInRange, type IsoDate } from "../model/hr/calendar";
import { attendanceCsvFileName, renderAttendanceCsv } from "../model/hr/csv";
import { normalizeReason } from "../model/hr/employee";
import {
  MAX_PERIOD_EMPLOYEES,
  buildPeriodRows,
  closeBlocker,
  periodFingerprintText,
  periodTotals,
  rangesOverlap,
  validatePeriodRange,
  type PeriodRow,
} from "../model/hr/period";
import {
  employmentOf,
  fail,
  hrCommand,
  inScope,
  loadSiteDays,
  orgClock,
  planFromStored,
  planView,
  recordedDay,
  siteEmployeesInRange,
  siteOf,
  sitePeriods,
  siteScope,
  scopedSitesAnyStatus,
  storedPlan,
  type OrgClock,
} from "./shared";

const CLOSE = HR_PERMISSION.periodClose;
const EXPORT = HR_PERMISSION.periodExport;
const MAX_VERSION_ROWS = MAX_PERIOD_EMPLOYEES * 31;
const MAX_VERSIONS = 50;
export const MAX_PERIOD_LIST = 200;

type Period = Doc<"hrPeriods">;
type Version = Doc<"hrPeriodVersions">;

async function liveRows(
  ctx: TenantFunctionContext,
  period: Pick<Period, "warehouseId" | "startDate" | "endDate">,
  clock: OrgClock,
): Promise<readonly PeriodRow[] | null> {
  const employees = await siteEmployeesInRange(
    ctx,
    period.warehouseId,
    period.startDate,
    period.endDate,
    MAX_PERIOD_EMPLOYEES,
  );
  if (employees === null) return null;
  const { days, holidays } = await loadSiteDays(
    ctx,
    period.warehouseId,
    datesInRange(period.startDate, period.endDate),
  );
  return buildPeriodRows({
    startDate: period.startDate,
    endDate: period.endDate,
    employees: employees.map((employee) => ({
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
}

const fingerprintOf = async (period: Period, rows: readonly PeriodRow[]) =>
  await sha256Hex(
    `${period._id}:${period.draftVersion}:${periodFingerprintText(rows)}`,
  );

/** The newest versions, newest first, for the version selector (bounded). */
async function recentVersions(
  ctx: TenantFunctionContext,
  period: Period,
): Promise<readonly Version[]> {
  const versions: Version[] = [];
  for (
    let number = period.latestClosedVersion;
    number >= 1 && versions.length < MAX_VERSIONS;
    number -= 1
  ) {
    const version = await versionNumbered(ctx, period._id, number);
    if (version !== null) versions.push(version);
  }
  return versions;
}

/** One version by number: an exact indexed lookup, unbounded by listings. */
async function versionNumbered(
  ctx: TenantFunctionContext,
  periodId: string,
  version: number,
): Promise<Version | null> {
  if (!Number.isSafeInteger(version) || version < 1) return null;
  return await ctx.tenantDb
    .byIndex<Version>("hrPeriodVersions", "by_orgId_periodId_version", [
      { field: "periodId", value: periodId },
      { field: "version", value: version },
    ])
    .unique();
}

const versionSummary = (version: Version) => ({
  id: version._id,
  version: version.version,
  closedAt: version.closedAt,
  revisionReason: version.revisionReason,
  totals: version.totals,
});

export const list = queryWithOrg({
  args: { warehouseId: v.optional(v.id("warehouses")) },
  returns: v.any(),
  permissionCode: CLOSE,
  target: { table: "hrPeriods" },
  handler: async (ctx, args) => {
    const scope = await siteScope(ctx);
    const list = await scopedSitesAnyStatus(ctx, scope);
    const sites = list.sites.filter(
      (site) => args.warehouseId === undefined || site._id === args.warehouseId,
    );
    const items = [];
    for (const site of sites) {
      for (const period of await sitePeriods(ctx, site._id)) {
        items.push({
          id: period._id,
          siteId: site._id,
          siteCode: site.code,
          siteName: site.name,
          siteActive: site.status === "ACTIVE",
          startDate: period.startDate,
          endDate: period.endDate,
          status: period.status,
          draftVersion: period.draftVersion,
          latestClosedVersion: period.latestClosedVersion,
        });
      }
    }
    items.sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
    // Bounded, newest first, and never silently: `complete` says if more exist.
    return {
      items: items.slice(0, MAX_PERIOD_LIST),
      complete: list.complete && items.length <= MAX_PERIOD_LIST,
      sites: sites.map((site) => ({
        id: site._id,
        code: site.code,
        name: site.name,
      })),
    };
  },
});

async function scopedPeriod(ctx: TenantFunctionContext, periodId: string) {
  const period = await ctx.tenantDb.get<Period>("hrPeriods", periodId);
  if (period === null) return null;
  return inScope(await siteScope(ctx), period.warehouseId) ? period : null;
}

const rowView = (row: {
  readonly employeeId: string;
  readonly employeeCode: string;
  readonly employeeName: string;
  readonly businessDate: string;
  readonly plan: ReturnType<typeof planView>;
  readonly actualStartAt?: number | undefined;
  readonly actualEndAt?: number | undefined;
  readonly workedMinutes: number;
  readonly outsideShiftMinutes: number;
  readonly status: string;
  readonly issue?: string | undefined;
  readonly disposition: string | null;
  readonly correctionReason?: string | undefined;
}) => row;

export const preview = queryWithOrg({
  args: {
    // A string, so a malformed link answers NOT_FOUND instead of throwing.
    periodId: v.string(),
    version: v.optional(v.number()),
  },
  returns: v.any(),
  permissionCode: CLOSE,
  target: { table: "hrPeriods" },
  handler: async (ctx, args) => {
    // Closed versions carry their own frozen timezone, so history stays
    // readable even when the current organization timezone is unsupported.
    // Only the live draft calculation needs the organization clock.
    const clock = orgClock(ctx);
    const period = await scopedPeriod(ctx, args.periodId);
    if (period === null) return { ok: false as const, code: "NOT_FOUND" };
    const site = await ctx.tenantDb.get<Doc<"warehouses">>(
      "warehouses",
      period.warehouseId,
    );
    const versions = await recentVersions(ctx, period);
    // Older versions stay reachable by number; the selector lists the newest.
    const versionsComplete = period.latestClosedVersion <= MAX_VERSIONS;
    const header = {
      id: period._id,
      siteCode: site?.code ?? "",
      siteName: site?.name ?? "",
      startDate: period.startDate,
      endDate: period.endDate,
      status: period.status,
      draftVersion: period.draftVersion,
      latestClosedVersion: period.latestClosedVersion,
      revisionReason: period.revisionReason,
      timezone: ctx.tenant.organization.settings.timezone,
      timezoneSupported: clock !== null,
      ...(clock === null ? {} : { today: clock.today }),
    };
    const selected =
      args.version === undefined
        ? undefined
        : await versionNumbered(ctx, period._id, args.version);
    if (args.version !== undefined && selected === null)
      return { ok: false as const, code: "VERSION_NOT_FOUND" };

    if (selected || period.status === "CLOSED") {
      const version =
        selected ??
        (await versionNumbered(ctx, period._id, period.latestClosedVersion));
      if (version === null)
        return { ok: false as const, code: "VERSION_NOT_FOUND" };
      const rows = await frozenRows(ctx, version._id);
      return {
        ok: true as const,
        // A closed version shows the identity and timezone it was frozen with.
        period: {
          ...header,
          siteCode: version.siteCode,
          siteName: version.siteName,
          timezone: version.timezone,
        },
        versions: versions.map(versionSummary),
        versionsComplete,
        view: {
          kind: "CLOSED" as const,
          versionId: version._id,
          version: version.version,
          closedAt: version.closedAt,
          totals: version.totals,
          rows: rows.map((row) =>
            rowView({
              employeeId: row.employeeId,
              employeeCode: row.employeeCode,
              employeeName: row.employeeName,
              businessDate: row.businessDate,
              plan: planView(planFromStored(row.plan)),
              actualStartAt: row.actualStartAt,
              actualEndAt: row.actualEndAt,
              workedMinutes: row.workedMinutes,
              outsideShiftMinutes: row.outsideShiftMinutes,
              status: "READY",
              disposition: row.disposition,
              correctionReason: row.correctionReason,
            }),
          ),
        },
      };
    }

    if (clock === null)
      return {
        ok: true as const,
        period: header,
        versions: versions.map(versionSummary),
        versionsComplete,
        view: { kind: "TIMEZONE_UNSUPPORTED" as const },
      };
    const rows = await liveRows(ctx, period, clock);
    if (rows === null)
      return {
        ok: true as const,
        period: header,
        versions: versions.map(versionSummary),
        versionsComplete,
        view: { kind: "LIMIT" as const },
      };
    const blocker = closeBlocker({
      endDate: period.endDate,
      today: clock.today,
      rows,
    });
    return {
      ok: true as const,
      period: header,
      versions: versions.map(versionSummary),
      versionsComplete,
      view: {
        kind: "DRAFT" as const,
        totals: periodTotals(rows),
        blocker,
        fingerprint: await fingerprintOf(period, rows),
        rows: rows.map((row) =>
          rowView({
            employeeId: row.employeeId,
            employeeCode: row.employeeCode,
            employeeName: row.employeeName,
            businessDate: row.businessDate,
            plan: planView(row.plan),
            actualStartAt: row.actualStartAt,
            actualEndAt: row.actualEndAt,
            workedMinutes: row.workedMinutes,
            outsideShiftMinutes: row.outsideShiftMinutes,
            status: row.status,
            issue: row.issue,
            disposition: row.disposition,
            correctionReason: row.correctionReason,
          }),
        ),
      },
    };
  },
});

async function frozenRows(ctx: TenantFunctionContext, versionId: string) {
  const rows = await ctx.tenantDb
    .byIndex<Doc<"hrPeriodRows">>("hrPeriodRows", "by_orgId_versionId", [
      { field: "versionId", value: versionId },
    ])
    .all(MAX_VERSION_ROWS);
  return [...rows].sort((a, b) =>
    a.employeeCode === b.employeeCode
      ? a.businessDate < b.businessDate
        ? -1
        : 1
      : a.employeeCode < b.employeeCode
        ? -1
        : 1,
  );
}

export const create = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    startDate: v.string(),
    endDate: v.string(),
  },
  returns: v.any(),
  permissionCode: CLOSE,
  target: { table: "hrPeriods" },
  handler: async (ctx, args) =>
    hrCommand(ctx, {
      operation: "hr.period.create",
      requestId: args.requestId,
      payload: {
        warehouseId: args.warehouseId,
        startDate: args.startDate,
        endDate: args.endDate,
      },
      table: "hrPeriods",
      warehouseId: args.warehouseId,
      run: async () => {
        // A draft cannot be calculated or closed without a supported zone.
        if (orgClock(ctx) === null) return fail("TIMEZONE_UNSUPPORTED");
        const site = await siteOf(ctx, await siteScope(ctx), args.warehouseId);
        if (site === null) return fail("SITE_UNAVAILABLE", "warehouseId");
        const range = validatePeriodRange(args.startDate, args.endDate);
        if (!range.ok)
          return fail(
            range.error.code,
            "endDate",
            "reason" in range.error ? range.error.reason : undefined,
          );
        const existing = await sitePeriods(ctx, site._id);
        if (existing.some((period) => rangesOverlap(period, args)))
          return fail("PERIOD_OVERLAP");
        const employees = await siteEmployeesInRange(
          ctx,
          site._id,
          args.startDate,
          args.endDate,
          MAX_PERIOD_EMPLOYEES,
        );
        if (employees === null)
          return fail("PERIOD_TOO_LARGE", "warehouseId", "EMPLOYEES");
        const now = Date.now();
        const id = await ctx.tenantDb.insert("hrPeriods", {
          warehouseId: site._id,
          startDate: args.startDate,
          endDate: args.endDate,
          status: "DRAFT",
          draftVersion: 1,
          latestClosedVersion: 0,
          createdAt: now,
          createdByUserId: ctx.tenant.actor._id,
          updatedAt: now,
          updatedByUserId: ctx.tenant.actor._id,
        });
        return {
          documentId: id,
          changes: [
            { field: "startDate", to: args.startDate },
            { field: "endDate", to: args.endDate },
          ],
        };
      },
    }),
});

export const close = mutationWithOrg({
  args: {
    requestId: v.string(),
    periodId: v.id("hrPeriods"),
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
        expectedFingerprint: args.expectedFingerprint,
      },
      table: "hrPeriodVersions",
      replay: async (id) => {
        if ((await scopedPeriod(ctx, args.periodId)) === null)
          return fail("NOT_FOUND", "periodId");
        const version = await ctx.tenantDb.get<Version>("hrPeriodVersions", id);
        return version === null ? null : { version: version.version };
      },
      run: async () => {
        const clock = orgClock(ctx);
        if (clock === null) return fail("TIMEZONE_UNSUPPORTED");
        const period = await scopedPeriod(ctx, args.periodId);
        if (period === null) return fail("NOT_FOUND", "periodId");
        if (period.status !== "DRAFT") return fail("PERIOD_ALREADY_CLOSED");
        const site = await ctx.tenantDb.get<Doc<"warehouses">>(
          "warehouses",
          period.warehouseId,
        );
        if (site === null) return fail("SITE_UNAVAILABLE");
        // Authoritative recomputation: the preview is never trusted.
        const rows = await liveRows(ctx, period, clock);
        if (rows === null)
          return fail("PERIOD_TOO_LARGE", "periodId", "EMPLOYEES");
        const blocker = closeBlocker({
          endDate: period.endDate,
          today: clock.today,
          rows,
        });
        if (blocker !== null) return fail(blocker);
        if ((await fingerprintOf(period, rows)) !== args.expectedFingerprint)
          return fail("PERIOD_STALE");
        const totals = periodTotals(rows);
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
          fingerprint: args.expectedFingerprint,
          totals: {
            employees: totals.employees,
            days: totals.days,
            workedMinutes: totals.workedMinutes,
            outsideShiftMinutes: totals.outsideShiftMinutes,
            absentDays: totals.absentDays,
            leaveDays: totals.leaveDays,
            nonworkingDays: totals.nonworkingDays,
          },
          closedByUserId: ctx.tenant.actor._id,
          closedAt: clock.now,
        })) as Id<"hrPeriodVersions">;
        for (const row of rows) {
          await ctx.tenantDb.insert("hrPeriodRows", {
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
        }
        await ctx.tenantDb.patch("hrPeriods", period._id, {
          status: "CLOSED",
          latestClosedVersion: period.draftVersion,
          updatedAt: clock.now,
          updatedByUserId: ctx.tenant.actor._id,
        });
        return {
          documentId: versionId,
          warehouseId: period.warehouseId,
          extra: { version: period.draftVersion },
          changes: [
            { field: "periodId", to: period._id },
            { field: "version", to: String(period.draftVersion) },
            { field: "rows", to: String(rows.length) },
            { field: "workedMinutes", to: String(totals.workedMinutes) },
          ],
        };
      },
    }),
});

export const startRevision = mutationWithOrg({
  args: {
    requestId: v.string(),
    periodId: v.id("hrPeriods"),
    reason: v.string(),
  },
  returns: v.any(),
  permissionCode: CLOSE,
  target: { table: "hrPeriods", id: (args) => args.periodId },
  handler: async (ctx, args) =>
    hrCommand(ctx, {
      operation: "hr.period.revise",
      requestId: args.requestId,
      payload: { periodId: args.periodId, reason: args.reason },
      table: "hrPeriods",
      run: async () => {
        const period = await scopedPeriod(ctx, args.periodId);
        if (period === null) return fail("NOT_FOUND", "periodId");
        if (period.status !== "CLOSED") return fail("PERIOD_NOT_CLOSED");
        const reason = normalizeReason(args.reason);
        if (reason === null) return fail("REASON_REQUIRED", "reason");
        await ctx.tenantDb.patch("hrPeriods", period._id, {
          status: "DRAFT",
          draftVersion: period.latestClosedVersion + 1,
          revisionReason: reason,
          updatedAt: Date.now(),
          updatedByUserId: ctx.tenant.actor._id,
        });
        return {
          documentId: period._id,
          warehouseId: period.warehouseId,
          changes: [
            { field: "status", from: "CLOSED", to: "DRAFT" },
            {
              field: "draftVersion",
              to: String(period.latestClosedVersion + 1),
            },
            { field: "reason", to: reason },
          ],
        };
      },
    }),
});

async function csvOf(ctx: TenantFunctionContext, version: Version) {
  const rows = await frozenRows(ctx, version._id);
  const meta = {
    periodId: version.periodId,
    version: version.version,
    siteCode: version.siteCode,
    timezone: version.timezone,
    startDate: version.startDate as IsoDate,
    endDate: version.endDate as IsoDate,
  };
  return {
    fileName: attendanceCsvFileName(meta),
    content: renderAttendanceCsv(
      meta,
      rows.map((row) => ({
        employeeCode: row.employeeCode,
        employeeName: row.employeeName,
        businessDate: row.businessDate,
        plannedStartAt: row.plan.startAt,
        plannedEndAt: row.plan.endAt,
        actualStartAt: row.actualStartAt,
        actualEndAt: row.actualEndAt,
        workedMinutes: row.workedMinutes,
        outsideShiftMinutes: row.outsideShiftMinutes,
        disposition: row.disposition,
        correctionReason: row.correctionReason,
      })),
    ),
    rowCount: rows.length,
  };
}

/** A mutation, not a query, so every download is recorded in audit. */
export const exportCsv = mutationWithOrg({
  args: { requestId: v.string(), versionId: v.id("hrPeriodVersions") },
  returns: v.any(),
  permissionCode: EXPORT,
  target: { table: "hrPeriodVersions", id: (args) => args.versionId },
  handler: async (ctx, args) => {
    const load = async () => {
      const version = await ctx.tenantDb.get<Version>(
        "hrPeriodVersions",
        args.versionId,
      );
      if (version === null) return null;
      return inScope(await siteScope(ctx), version.warehouseId)
        ? version
        : null;
    };
    return hrCommand(ctx, {
      operation: "hr.period.exportVersion",
      requestId: args.requestId,
      payload: { versionId: args.versionId },
      table: "hrPeriodVersions",
      // A replay re-checks current scope; revoked access gets no content.
      replay: async () => {
        const version = await load();
        return version === null
          ? fail("NOT_FOUND", "versionId")
          : await csvOf(ctx, version);
      },
      run: async () => {
        const version = await load();
        if (version === null) return fail("NOT_FOUND", "versionId");
        const csv = await csvOf(ctx, version);
        return {
          documentId: version._id,
          warehouseId: version.warehouseId,
          extra: csv,
          changes: [
            { field: "version", to: String(version.version) },
            { field: "rows", to: String(csv.rowCount) },
            { field: "fileName", to: csv.fileName },
          ],
        };
      },
    });
  },
});
