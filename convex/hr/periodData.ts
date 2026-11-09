/**
 * Shared attendance-period reads used by the period queries (`periods.ts`)
 * and the staged close (`periodClose.ts`): scope checks, the complete live
 * rows of a small roster and the period fingerprint chain.
 */
import type { Doc } from "../_generated/dataModel";
import { sha256Hex } from "../lib/idempotency";
import type { TenantFunctionContext } from "../lib/tenantFunctions";
import { datesInRange } from "../model/hr/calendar";
import {
  MAX_PREVIEW_EMPLOYEES,
  buildPeriodRows,
  periodFingerprintText,
  type PeriodEmployee,
  type PeriodRow,
} from "../model/hr/period";
import type { IsoDate } from "../model/hr/calendar";
import {
  employeeRosterRowsInRange,
  employmentOf,
  loadSiteDays,
  recordedDay,
  rosterAssignment,
  siteAllowed,
  siteEmployeesInRange,
  siteRosterInRange,
  siteScope,
  type Employee,
  type OrgClock,
} from "./shared";

type Period = Doc<"hrPeriods">;
type Version = Doc<"hrPeriodVersions">;
type RosterRow = Doc<"hrRosterAssignments">;

/** Pending corrections and unresolved leave both block a period's day. */
export async function periodPending(
  ctx: TenantFunctionContext,
  employeeId: string,
  period: Pick<Period, "startDate" | "endDate">,
) {
  const claims = await ctx.tenantDb
    .byIndex<Doc<"hrLeaveDayClaims">>(
      "hrLeaveDayClaims",
      "by_orgId_employeeId_businessDate",
      [{ field: "employeeId", value: employeeId }],
      {
        field: "businessDate",
        lower: { value: period.startDate, inclusive: true },
        upper: { value: period.endDate, inclusive: true },
      },
    )
    .all(datesInRange(period.startDate, period.endDate).length);
  const requests = new Map<string, Doc<"hrLeaveRequests"> | null>();
  const pending = new Set<IsoDate>();
  for (const claim of claims) {
    if (!requests.has(claim.leaveRequestId))
      requests.set(
        claim.leaveRequestId,
        await ctx.tenantDb.get<Doc<"hrLeaveRequests">>(
          "hrLeaveRequests",
          claim.leaveRequestId,
        ),
      );
    const request = requests.get(claim.leaveRequestId);
    if (
      request?.status === "PENDING" ||
      request?.status === "CANCELLATION_REQUESTED"
    )
      pending.add(claim.businessDate);
  }
  return (date: IsoDate, day: Doc<"hrAttendanceDays"> | undefined) =>
    day?.pendingCorrectionId !== undefined || pending.has(date);
}

/**
 * One employee's dated roster rows on the period's site, by date. Rows the
 * employee holds at another site never plan this site's period, matching
 * `siteRosterInRange` for a whole-site read.
 */
export async function periodRosterOf(
  ctx: TenantFunctionContext,
  employeeId: string,
  period: Pick<Period, "warehouseId" | "startDate" | "endDate">,
): Promise<ReadonlyMap<IsoDate, RosterRow>> {
  const rows = await employeeRosterRowsInRange(
    ctx,
    employeeId,
    period.startDate,
    period.endDate,
  );
  return new Map(
    [...rows].filter(([, row]) => row.warehouseId === period.warehouseId),
  );
}

/** A published version; an unpublished staged build is never history. */
export const published = (version: Version | null): version is Version =>
  version !== null && version.build === undefined;

/**
 * The fingerprint of a period's rows: a hash chain over each employee's rows
 * in roster index order, so a staged build can extend it chunk by chunk and
 * a complete preview computes the same value.
 */
export const fingerprintSeed = async (
  period: Pick<Period, "_id" | "draftVersion">,
) => await sha256Hex(`${period._id}:${period.draftVersion}`);
export const fingerprintStep = async (
  chain: string,
  rows: readonly PeriodRow[],
) => await sha256Hex(`${chain}:${periodFingerprintText(rows)}`);

export const periodEmployee = (employee: Employee): PeriodEmployee => ({
  id: employee._id,
  code: employee.code,
  name: employee.displayName,
  employment: employmentOf(employee),
  schedule: employee.schedule,
});

/** The complete live rows of a small roster, in roster index order. */
export async function liveRows(
  ctx: TenantFunctionContext,
  period: Pick<Period, "warehouseId" | "startDate" | "endDate">,
  clock: OrgClock,
): Promise<{
  readonly rows: readonly PeriodRow[];
  readonly byEmployee: readonly (readonly PeriodRow[])[];
} | null> {
  const employees = await siteEmployeesInRange(
    ctx,
    period.warehouseId,
    period.startDate,
    period.endDate,
    MAX_PREVIEW_EMPLOYEES,
  );
  if (employees === null) return null;
  const [{ days, holidays }, roster] = await Promise.all([
    loadSiteDays(
      ctx,
      period.warehouseId,
      datesInRange(period.startDate, period.endDate),
    ),
    siteRosterInRange(
      ctx,
      period.warehouseId,
      period.startDate,
      period.endDate,
    ),
  ]);
  const pending = new Map<string, Awaited<ReturnType<typeof periodPending>>>(
    await Promise.all(
      employees.map(
        async (employee) =>
          [
            employee._id,
            await periodPending(ctx, employee._id, period),
          ] as const,
      ),
    ),
  );
  // The roster plans only dates the employment window already includes.
  const rows = buildPeriodRows({
    assignment: (id, date) => rosterAssignment(roster.get(`${id}:${date}`)),
    startDate: period.startDate,
    endDate: period.endDate,
    employees: employees.map(periodEmployee),
    offsetMinutes: clock.offset,
    now: clock.now,
    holidayName: (date) => holidays.get(date),
    recorded: (id, date) => {
      const day = days.get(`${id}:${date}`);
      return day ? recordedDay(day) : undefined;
    },
    pending: (id, date) => pending.get(id)!(date, days.get(`${id}:${date}`)),
  });
  return {
    rows,
    byEmployee: employees
      .map((employee) => rows.filter((row) => row.employeeId === employee._id))
      .filter((group) => group.length > 0),
  };
}

export const draftFingerprint = async (
  period: Period,
  byEmployee: readonly (readonly PeriodRow[])[],
) => {
  let chain = await fingerprintSeed(period);
  for (const rows of byEmployee) chain = await fingerprintStep(chain, rows);
  return chain;
};

/** A period the actor may read under current site scope. */
export async function scopedPeriod(
  ctx: TenantFunctionContext,
  periodId: string,
) {
  const period = await ctx.tenantDb.get<Period>("hrPeriods", periodId);
  if (period === null) return null;
  return (await siteAllowed(ctx, await siteScope(ctx), period.warehouseId))
    ? period
    : null;
}
