/**
 * Attendance periods: draft review, revision and CSV export. Closing is a
 * staged build in `periodClose.ts`.
 *
 * A close recomputes every row from authoritative data, publishes only a
 * complete version (matching the fingerprint the reviewer saw) and writes an
 * immutable version with its rows. Exports read only those frozen rows, so a
 * later punch, correction, holiday or schedule edit cannot change a closed
 * version. Every read here is bounded: rosters beyond the complete-preview
 * size and large frozen versions are read a page at a time.
 */
import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import { HR_PERMISSION } from "../lib/permissions";
import {
  mutationWithOrg,
  queryWithOrg,
  type TenantFunctionContext,
} from "../lib/tenantFunctions";
import { timezoneOffsetMinutes, type IsoDate } from "../model/hr/calendar";
import {
  attendanceCsvFileName,
  renderAttendanceCsvPart,
} from "../model/hr/csv";
import { normalizeReason } from "../model/hr/employee";
import {
  MAX_PREVIEW_EMPLOYEES,
  buildPeriodRows,
  closeBlocker,
  periodTotals,
  rangesOverlap,
  validatePeriodRange,
  type PeriodRow,
} from "../model/hr/period";
import { beginCloseCommand } from "./periodClose";
import {
  draftFingerprint,
  liveRows,
  periodEmployee,
  periodRosterOf,
  published,
  scopedPeriod,
} from "./periodData";
import {
  HR_MAX_CHUNK,
  hrListInput,
  hrPageArgs,
  hrScanPage,
  type HrLane,
} from "./pagination";
import {
  employedInRange,
  employeeDaysInRange,
  fail,
  holidaysInRange,
  hrCommand,
  orgClock,
  planFromStored,
  planView,
  recordedDay,
  rosterAssignment,
  siteOf,
  siteAllowed,
  sitePeriods,
  sitePeriodsEndingFrom,
  siteResolver,
  siteScope,
  scopedSitesAnyStatus,
  type Employee,
} from "./shared";

const CLOSE = HR_PERMISSION.periodClose;
const EXPORT = HR_PERMISSION.periodExport;
/** Frozen rows a closed preview shows at once; larger versions are paged. */
export const MAX_PREVIEW_ROWS = MAX_PREVIEW_EMPLOYEES * 31;
/** Frozen rows one export part renders at most (whole employees only). */
export const EXPORT_PART_ROWS = 2000;
const EXPORT_SLICE_ROWS = 100;
const MAX_VERSIONS = 50;
export const MAX_PERIOD_LIST = 200;

type Period = Doc<"hrPeriods">;
type Version = Doc<"hrPeriodVersions">;
type FrozenRow = Doc<"hrPeriodRows">;

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
  const found = await ctx.tenantDb
    .byIndex<Version>("hrPeriodVersions", "by_orgId_periodId_version", [
      { field: "periodId", value: periodId },
      { field: "version", value: version },
    ])
    .unique();
  return published(found) ? found : null;
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

/**
 * The period registry, newest start date first across every in-scope site
 * (closed sites included, so history stays reachable), one cursor page at
 * a time with optional site and status filters. Unlike `list`, no period is
 * beyond reach: older ones follow on later pages.
 */
export const listPage = queryWithOrg({
  args: {
    ...hrPageArgs,
    // A string, so a stale or edited URL answers SITE_UNAVAILABLE.
    warehouseId: v.optional(v.string()),
    status: v.optional(
      v.union(v.literal("DRAFT"), v.literal("CLOSING"), v.literal("CLOSED")),
    ),
  },
  returns: v.any(),
  permissionCode: CLOSE,
  target: { table: "hrPeriods" },
  handler: async (ctx, args) => {
    const input = hrListInput(args);
    if (!input.ok) return input;
    // Exact site authorization of every period, any site status, so history
    // at sites beyond the preloaded scope bound and at closed sites stays
    // reachable; a revoked site's periods disappear at once.
    const siteFor = siteResolver(ctx, await siteScope(ctx), false);
    if (
      args.warehouseId !== undefined &&
      (await siteFor(args.warehouseId)) === null
    )
      return { ok: false as const, code: "SITE_UNAVAILABLE" };
    const lane: HrLane =
      args.warehouseId === undefined
        ? {
            key: "all",
            index: "by_orgId_startDate",
            equality: [],
            order: "desc",
          }
        : {
            key: args.warehouseId,
            index: "by_orgId_warehouseId_startDate",
            equality: [{ field: "warehouseId", value: args.warehouseId }],
            order: "desc",
          };
    const page = await hrScanPage(ctx, {
      surface: "periods",
      criteria: { site: args.warehouseId ?? null, status: args.status ?? null },
      pageSize: input.pageSize,
      cursor: args.cursor,
      scanCursor: args.scanCursor,
      table: "hrPeriods",
      lanes: [lane],
      chunk:
        args.status === undefined && args.warehouseId !== undefined
          ? input.pageSize
          : HR_MAX_CHUNK,
      match: async (period: Period) =>
        (args.warehouseId === undefined ||
          period.warehouseId === args.warehouseId) &&
        (args.status === undefined || period.status === args.status) &&
        (await siteFor(period.warehouseId)) !== null,
      hydrate: async (period) => {
        const site = await siteFor(period.warehouseId);
        if (site === null) return null;
        return {
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
        };
      },
    });
    return { ok: true as const, ...page, sitesComplete: true };
  },
});

/**
 * Every closed version of one period, newest first, a page at a time, so
 * versions older than the selector's newest `MAX_VERSIONS` stay
 * discoverable (not only by typing their number).
 */
export const versionsPage = queryWithOrg({
  args: { ...hrPageArgs, periodId: v.string() },
  returns: v.any(),
  permissionCode: CLOSE,
  target: { table: "hrPeriods" },
  handler: async (ctx, args) => {
    const input = hrListInput(args);
    if (!input.ok) return input;
    const period = await scopedPeriod(ctx, args.periodId);
    if (period === null) return { ok: false as const, code: "NOT_FOUND" };
    const page = await hrScanPage(ctx, {
      surface: "period-versions",
      criteria: { periodId: period._id },
      pageSize: input.pageSize,
      cursor: args.cursor,
      scanCursor: args.scanCursor,
      table: "hrPeriodVersions",
      lanes: [
        {
          key: period._id,
          index: "by_orgId_periodId_version",
          equality: [{ field: "periodId", value: period._id }],
          order: "desc",
        },
      ],
      match: (version: Version) =>
        version.periodId === period._id && published(version),
      hydrate: async (version) => versionSummary(version),
    });
    return { ok: true as const, ...page };
  },
});

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

const draftRowView = (row: PeriodRow) =>
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
  });

const frozenRowView = (row: FrozenRow) =>
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
  });

const failureView = (period: Period) =>
  period.closeFailure === undefined
    ? {}
    : {
        closeFailure: {
          code: period.closeFailure.code,
          ...(period.closeFailure.employeeId === undefined
            ? {}
            : { employeeId: period.closeFailure.employeeId }),
          ...(period.closeFailure.businessDate === undefined
            ? {}
            : { businessDate: period.closeFailure.businessDate }),
        },
      };

/** Progress of a CLOSING period's staged build (no rows). */
export function closingView(version: Version | null) {
  const build = version?.build;
  if (version === null || build === undefined)
    return { kind: "CLOSING" as const, state: "UNAVAILABLE" as const };
  return {
    kind: "CLOSING" as const,
    state: build.state,
    versionId: version._id,
    version: version.version,
    step: build.step,
    employees: version.totals.employees,
    days: version.totals.days,
    ...(build.state === "READY"
      ? { totals: version.totals, fingerprint: version.fingerprint }
      : {}),
    ...(build.failure === undefined ? {} : { failure: build.failure }),
  };
}

export const preview = queryWithOrg({
  args: {
    // A string, so a malformed link answers NOT_FOUND instead of throwing.
    periodId: v.string(),
    version: v.optional(v.number()),
    clockFree: v.optional(v.boolean()),
  },
  returns: v.any(),
  permissionCode: CLOSE,
  target: { table: "hrPeriods" },
  handler: async (ctx, args) => {
    // Closed versions carry their own frozen timezone, so history stays
    // readable even when the current organization timezone is unsupported.
    // Existing tabs retain period.today by default. Updated clients explicitly
    // opt into clock-free frozen previews; live drafts still need the clock.
    const legacyClock = args.clockFree === true ? null : orgClock(ctx);
    const timezoneSupported = timezoneOffsetMinutes(
      ctx.tenant.organization.settings.timezone,
    ).ok;
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
      timezoneSupported,
      ...(legacyClock === null ? {} : { today: legacyClock.today }),
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
      // A large version is read a page at a time (`versionRowsPage`).
      const paged = version.totals.days > MAX_PREVIEW_ROWS;
      const rows = paged ? [] : await frozenRows(ctx, version._id);
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
          rowsPaged: paged,
          rows: rows.map(frozenRowView),
        },
      };
    }

    if (period.status === "CLOSING")
      return {
        ok: true as const,
        period: header,
        versions: versions.map(versionSummary),
        versionsComplete,
        view: closingView(
          period.closingVersionId === undefined
            ? null
            : await ctx.tenantDb.get<Version>(
                "hrPeriodVersions",
                period.closingVersionId,
              ),
        ),
      };

    const clock = legacyClock ?? orgClock(ctx);
    if (clock === null)
      return {
        ok: true as const,
        period: header,
        versions: versions.map(versionSummary),
        versionsComplete,
        view: { kind: "TIMEZONE_UNSUPPORTED" as const },
      };
    const draftHeader = { ...header, today: clock.today };
    const live = await liveRows(ctx, period, clock);
    // A larger roster is reviewed a page at a time (`draftEmployeesPage`);
    // its readiness and totals are established by the staged close.
    if (live === null)
      return {
        ok: true as const,
        period: draftHeader,
        versions: versions.map(versionSummary),
        versionsComplete,
        view: {
          kind: "PAGED" as const,
          blocker:
            period.endDate < clock.today ? null : "PERIOD_INCLUDES_FUTURE",
          ...failureView(period),
        },
      };
    const blocker = closeBlocker({
      endDate: period.endDate,
      today: clock.today,
      rows: live.rows,
    });
    return {
      ok: true as const,
      period: draftHeader,
      versions: versions.map(versionSummary),
      versionsComplete,
      view: {
        kind: "DRAFT" as const,
        totals: periodTotals(live.rows),
        blocker,
        fingerprint: await draftFingerprint(period, live.byEmployee),
        ...failureView(period),
        rows: live.rows.map(draftRowView),
      },
    };
  },
});

/** A small published version's frozen rows in export order. */
async function frozenRows(ctx: TenantFunctionContext, versionId: string) {
  return await ctx.tenantDb
    .byIndex<FrozenRow>(
      "hrPeriodRows",
      "by_orgId_versionId_employeeCode_businessDate",
      [{ field: "versionId", value: versionId }],
    )
    .all(MAX_PREVIEW_ROWS);
}

/**
 * A large draft's employees, a page at a time in roster order, each with its
 * live rows (one bounded day read per employee).
 */
export const draftEmployeesPage = queryWithOrg({
  args: { ...hrPageArgs, periodId: v.string() },
  returns: v.any(),
  permissionCode: CLOSE,
  target: { table: "hrPeriods" },
  handler: async (ctx, args) => {
    const input = hrListInput(args);
    if (!input.ok) return input;
    const period = await scopedPeriod(ctx, args.periodId);
    if (period === null) return { ok: false as const, code: "NOT_FOUND" };
    if (period.status !== "DRAFT")
      return { ok: false as const, code: "PERIOD_NOT_DRAFT" };
    const clock = orgClock(ctx);
    if (clock === null)
      return { ok: false as const, code: "TIMEZONE_UNSUPPORTED" };
    let holidays: ReadonlyMap<IsoDate, string> | null = null;
    const page = await hrScanPage(ctx, {
      surface: "period-draft-employees",
      criteria: { periodId: period._id, draftVersion: period.draftVersion },
      pageSize: input.pageSize,
      cursor: args.cursor,
      scanCursor: args.scanCursor,
      table: "hrEmployees",
      lanes: [
        {
          key: period.warehouseId,
          index: "by_orgId_warehouseId_code",
          equality: [{ field: "warehouseId", value: period.warehouseId }],
          order: "asc",
        },
      ],
      peekLanes: 0,
      match: (employee: Employee) =>
        employee.warehouseId === period.warehouseId &&
        employedInRange(employee, period.startDate, period.endDate),
      hydrate: async (employee) => {
        holidays ??= await holidaysInRange(
          ctx,
          period.warehouseId,
          period.startDate,
          period.endDate,
        );
        const [days, roster] = await Promise.all([
          employeeDaysInRange(
            ctx,
            employee._id,
            period.startDate,
            period.endDate,
          ),
          periodRosterOf(ctx, employee._id, period),
        ]);
        const known = holidays;
        const rows = buildPeriodRows({
          assignment: (_id, date) => rosterAssignment(roster.get(date)),
          startDate: period.startDate,
          endDate: period.endDate,
          employees: [periodEmployee(employee)],
          offsetMinutes: clock.offset,
          now: clock.now,
          holidayName: (date) => known.get(date),
          recorded: (_id, date) => {
            const day = days.get(date);
            return day ? recordedDay(day) : undefined;
          },
          pending: (_id, date) =>
            days.get(date)?.pendingCorrectionId !== undefined,
        });
        return {
          employeeId: employee._id,
          code: employee.code,
          name: employee.displayName,
          totals: periodTotals(rows),
          rows: rows.map(draftRowView),
        };
      },
    });
    return { ok: true as const, ...page };
  },
});

/** A published version's frozen rows, a page at a time in export order. */
export const versionRowsPage = queryWithOrg({
  args: { ...hrPageArgs, versionId: v.string() },
  returns: v.any(),
  permissionCode: CLOSE,
  target: { table: "hrPeriodVersions" },
  handler: async (ctx, args) => {
    const input = hrListInput(args);
    if (!input.ok) return input;
    const version = await scopedVersion(ctx, args.versionId);
    if (version === null) return { ok: false as const, code: "NOT_FOUND" };
    const page = await hrScanPage(ctx, {
      surface: "period-version-rows",
      criteria: { versionId: version._id },
      pageSize: input.pageSize,
      cursor: args.cursor,
      scanCursor: args.scanCursor,
      table: "hrPeriodRows",
      lanes: [
        {
          key: version._id,
          index: "by_orgId_versionId_employeeCode_businessDate",
          equality: [{ field: "versionId", value: version._id }],
          order: "asc",
        },
      ],
      match: (row: FrozenRow) => row.versionId === version._id,
      hydrate: async (row) => frozenRowView(row),
    });
    return { ok: true as const, ...page };
  },
});

/** A published version the actor may read (current site scope). */
async function scopedVersion(ctx: TenantFunctionContext, versionId: string) {
  const version = await ctx.tenantDb.get<Version>(
    "hrPeriodVersions",
    versionId,
  );
  if (!published(version)) return null;
  return (await siteAllowed(ctx, await siteScope(ctx), version.warehouseId))
    ? version
    : null;
}

/**
 * Deprecated one-step close of a completely previewed draft, kept so tabs
 * opened before the staged close keep working during a rollout. It runs the
 * staged begin with the reviewed fingerprint, which checks, builds and
 * publishes up to `MAX_PREVIEW_EMPLOYEES` in this one transaction. Remove it
 * (contract step) once no deployed client calls `hr/periods:close`; see
 * docs/operations/hr-period-staged-close.md.
 */
export const close = mutationWithOrg({
  args: {
    requestId: v.string(),
    periodId: v.id("hrPeriods"),
    expectedFingerprint: v.string(),
  },
  returns: v.any(),
  permissionCode: CLOSE,
  target: { table: "hrPeriods", id: (args) => args.periodId },
  handler: async (ctx, args) => beginCloseCommand(ctx, args),
});

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
        // Legacy imports may violate both period length and non-overlap
        // bounds: every period ending on or after the start is examined.
        const existing = await sitePeriodsEndingFrom(
          ctx,
          site._id,
          args.startDate,
        );
        if (existing.some((period) => rangesOverlap(period, args)))
          return fail("PERIOD_OVERLAP");
        // Any roster size: large periods are previewed and closed in pages.
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

/**
 * One bounded part of a version's CSV, in export order: whole employees
 * after the `cursor` employee code, at most `EXPORT_PART_ROWS` rows.
 */
async function csvPart(
  ctx: TenantFunctionContext,
  version: Version,
  cursor: string | null,
) {
  // Tenant index reads return at most 100 rows: read whole employees in
  // bounded slices until the part is full or the version is exhausted.
  const rows: FrozenRow[] = [];
  let after = cursor;
  let isDone = false;
  while (rows.length + EXPORT_SLICE_ROWS <= EXPORT_PART_ROWS) {
    const slice = await ctx.tenantDb
      .byIndex<FrozenRow>(
        "hrPeriodRows",
        "by_orgId_versionId_employeeCode_businessDate",
        [{ field: "versionId", value: version._id }],
        after === null
          ? undefined
          : {
              field: "employeeCode",
              lower: { value: after, inclusive: false },
            },
      )
      .take(EXPORT_SLICE_ROWS);
    if (slice.length < EXPORT_SLICE_ROWS) {
      rows.push(...slice);
      isDone = true;
      break;
    }
    // A part never splits an employee (at most 31 rows each).
    const lastCode = slice[slice.length - 1]!.employeeCode;
    const whole = slice.filter((row) => row.employeeCode !== lastCode);
    if (whole.length === 0)
      throw new Error("Frozen rows of one employee exceed an export slice");
    rows.push(...whole);
    after = whole[whole.length - 1]!.employeeCode;
  }
  const page = {
    page: rows,
    isDone,
    continueCursor: after ?? "",
  };
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
    content: renderAttendanceCsvPart(
      meta,
      page.page.map((row) => ({
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
      cursor === null,
    ),
    rowCount: page.page.length,
    totalRows: version.totals.days,
    isDone: page.isDone,
    ...(page.isDone ? {} : { continueCursor: page.continueCursor }),
  };
}

/**
 * A mutation, not a query, so every download is recorded in audit. A large
 * version is delivered in parts: each call returns `EXPORT_PART_ROWS` rows
 * and the cursor of the next part; the client joins them in order.
 */
export const exportCsv = mutationWithOrg({
  args: {
    requestId: v.string(),
    versionId: v.id("hrPeriodVersions"),
    cursor: v.optional(v.string()),
  },
  returns: v.any(),
  permissionCode: EXPORT,
  target: { table: "hrPeriodVersions", id: (args) => args.versionId },
  handler: async (ctx, args) => {
    const cursor = args.cursor ?? null;
    return hrCommand(ctx, {
      operation: "hr.period.exportVersion",
      requestId: args.requestId,
      payload: {
        versionId: args.versionId,
        ...(cursor === null ? {} : { cursor }),
      },
      table: "hrPeriodVersions",
      // A replay re-checks current scope; revoked access gets no content.
      replay: async () => {
        const version = await scopedVersion(ctx, args.versionId);
        return version === null
          ? fail("NOT_FOUND", "versionId")
          : await csvPart(ctx, version, cursor);
      },
      run: async () => {
        const version = await scopedVersion(ctx, args.versionId);
        if (version === null) return fail("NOT_FOUND", "versionId");
        const csv = await csvPart(ctx, version, cursor);
        return {
          documentId: version._id,
          warehouseId: version.warehouseId,
          extra: csv,
          changes: [
            { field: "version", to: String(version.version) },
            { field: "rows", to: String(csv.rowCount) },
            { field: "fileName", to: csv.fileName },
            ...(cursor === null ? [] : [{ field: "part", to: "continued" }]),
          ],
        };
      },
    });
  },
});
