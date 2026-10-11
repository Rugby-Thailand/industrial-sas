/** Employee reads of their exact immutable attendance versions. */
import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import { HR_PERMISSION } from "../lib/permissions";
import {
  queryWithOrg,
  type TenantFunctionContext,
} from "../lib/tenantFunctions";
import { linkedEmployee } from "./shared";

type Version = Doc<"hrPeriodVersions">;
type Row = Doc<"hrPeriodRows">;
const ownedRows = (
  ctx: TenantFunctionContext,
  versionId: string,
  employeeId: string,
) =>
  ctx.tenantDb
    .byIndex<Row>("hrPeriodRows", "by_orgId_versionId_employeeId", [
      { field: "versionId", value: versionId },
      { field: "employeeId", value: employeeId },
    ])
    .take(32);
const metadata = (version: Version) => ({
  id: version._id,
  periodId: version.periodId,
  revision: version.version,
  from: version.startDate,
  to: version.endDate,
  closedAt: version.closedAt,
  revisionReason: version.revisionReason,
  timezone: version.timezone,
  siteCode: version.siteCode,
  siteName: version.siteName,
});

export const list = queryWithOrg({
  args: { cursor: v.optional(v.string()) },
  returns: v.any(),
  permissionCode: HR_PERMISSION.selfAccess,
  target: { table: "hrPeriodVersions" },
  handler: async (ctx, args) => {
    const employee = await linkedEmployee(ctx);
    if (!employee) return { ok: false as const, code: "HR_NOT_LINKED" };
    // Page immutable versions, checking exact owned rows even after a site
    // transfer. An empty page can have a continuation; it is never "no history".
    const page = await ctx.tenantDb
      .byIndex<Version>("hrPeriodVersions", "by_orgId_closedAt")
      .page({ limit: 25, cursor: args.cursor, order: "desc" });
    const items = [];
    for (const version of page.page) {
      const rows = await ownedRows(ctx, version._id, employee._id);
      if (rows.length > 0 && rows.length <= 31) items.push(metadata(version));
    }
    return {
      ok: true as const,
      items,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

export const detail = queryWithOrg({
  args: { versionId: v.string() },
  returns: v.any(),
  permissionCode: HR_PERMISSION.selfAccess,
  target: { table: "hrPeriodVersions" },
  handler: async (ctx, args) => {
    const employee = await linkedEmployee(ctx);
    if (!employee) return { ok: false as const, code: "HR_NOT_LINKED" };
    const version = await ctx.tenantDb.get<Version>(
      "hrPeriodVersions",
      args.versionId,
    );
    if (!version) return { ok: false as const, code: "NOT_FOUND" };
    const rows = [...(await ownedRows(ctx, version._id, employee._id))];
    if (!rows.length) return { ok: false as const, code: "NOT_FOUND" };
    if (rows.length > 31)
      return { ok: false as const, code: "FROZEN_ROWS_INVALID" };
    rows.sort((a, b) => a.businessDate.localeCompare(b.businessDate));
    return {
      ok: true as const,
      version: metadata(version),
      employee: { code: rows[0]!.employeeCode, name: rows[0]!.employeeName },
      summary: {
        days: rows.length,
        workedMinutes: rows.reduce((sum, row) => sum + row.workedMinutes, 0),
        outsideShiftMinutes: rows.reduce(
          (sum, row) => sum + row.outsideShiftMinutes,
          0,
        ),
        leaveDays: rows.filter((row) => row.disposition === "LEAVE").length,
        absentDays: rows.filter((row) => row.disposition === "ABSENT").length,
        nonworkingDays: rows.filter((row) => row.disposition === "NONWORKING")
          .length,
      },
      rows: rows.map((row) => ({
        date: row.businessDate,
        plannedStart: row.plan.startAt,
        plannedEnd: row.plan.endAt,
        originalCaptured: row.originalCaptured === true,
        originalStart: row.originalStartAt,
        originalEnd: row.originalEndAt,
        effectiveStart: row.actualStartAt,
        effectiveEnd: row.actualEndAt,
        workedMinutes: row.workedMinutes,
        outsideShiftMinutes: row.outsideShiftMinutes,
        disposition: row.disposition,
        correctionReason: row.correctionReason,
      })),
    };
  },
});
