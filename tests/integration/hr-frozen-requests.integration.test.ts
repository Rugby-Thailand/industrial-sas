import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { addDays, fromLocal } from "../../convex/model/hr/calendar";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
} from "../fixtures/convex-tenant-world";
const actor = { subject: "user_fixture_a", org_id: "org_fixture_a" };
const requests = makeFunctionReference<"query">("hr/self:requests"),
  list = makeFunctionReference<"query">("hr/selfPeriods:list"),
  detail = makeFunctionReference<"query">("hr/selfPeriods:detail");
function value<T = Record<string, unknown>>(outcome: unknown): T {
  expect(outcome).toMatchObject({ ok: true });
  return (outcome as { value: T }).value;
}
type RequestPage = {
  items: { id: string; reason: string }[];
  isDone: boolean;
  continueCursor: string;
};
const date = "2026-10-01";
async function fixture(role = "HR_EMPLOYEE") {
  const world = await createConvexTenantWorld({
    "../convex/hr/self.ts": () => import("../../convex/hr/self"),
    "../convex/hr/selfPeriods.ts": () => import("../../convex/hr/selfPeriods"),
    "../convex/hr/periods.ts": () => import("../../convex/hr/periods"),
  });
  await seedConvexAuthorization(world, { roleA: role, roleB: "HR_EMPLOYEE" });
  const [employeeId, otherId, tenantBId] = await world.t.run(async (ctx) => {
    const employee = (
      orgId: Id<"organizations">,
      warehouseId: Id<"warehouses">,
      code: string,
      userId?: Id<"users">,
    ) =>
      ctx.db.insert("hrEmployees", {
        orgId,
        warehouseId,
        code,
        displayName: code,
        ...(userId ? { userId } : {}),
        employmentStartDate: "2020-01-01",
        status: "ACTIVE",
        schedule: {
          workDays: [1, 2, 3, 4, 5],
          startTime: "08:30",
          endTime: "17:30",
          endsNextDay: false,
          breakMinutes: 60,
        },
        version: 1,
        createdAt: 1,
        updatedAt: 1,
        createdByUserId: world.userA,
        updatedByUserId: world.userA,
      });
    return [
      await employee(world.orgA, world.warehouses.alphaA, "OWN", world.userA),
      await employee(world.orgA, world.warehouses.bravoA, "OTHER"),
      await employee(
        world.orgB,
        world.warehouses.alphaB,
        "FOREIGN",
        world.userA,
      ),
    ];
  });
  const request = async (
    offset: number,
    reason: string,
    employee = employeeId,
  ) =>
    world.t.run(async (ctx) => {
      const businessDate = addDays("2026-01-01", offset),
        dayId = await ctx.db.insert("hrAttendanceDays", {
          orgId: world.orgA,
          warehouseId: world.warehouses.alphaA,
          employeeId: employee,
          businessDate,
          plan: { kind: "NONWORKING", reason: "UNSCHEDULED", breakMinutes: 0 },
          open: false,
          revision: 0,
          createdAt: 1,
          updatedAt: 1,
        });
      return ctx.db.insert("hrCorrectionRequests", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        employeeId: employee,
        dayId,
        businessDate,
        status: "RETURNED",
        proposedStartAt: 1,
        proposedEndAt: 2,
        reason,
        version: 1,
        baseRevision: 0,
        submittedAt: 1,
        submittedByUserId: world.userA,
        decisionReason: reason,
        history: [{ action: "SUBMITTED", at: 1, actorUserId: world.userA }],
      });
    });
  const version = async (
    employee = employeeId,
    closedAt = 1,
    originalCaptured?: boolean,
    foreign = false,
  ) =>
    world.t.run(async (ctx) => {
      const orgId = foreign ? world.orgB : world.orgA,
        warehouseId = foreign
          ? world.warehouses.alphaB
          : world.warehouses.alphaA;
      const periodId = await ctx.db.insert("hrPeriods", {
        orgId,
        warehouseId,
        startDate: date,
        endDate: date,
        status: "CLOSED",
        draftVersion: 1,
        latestClosedVersion: 1,
        createdAt: 1,
        updatedAt: 1,
        createdByUserId: world.userA,
        updatedByUserId: world.userA,
      });
      const versionId = await ctx.db.insert("hrPeriodVersions", {
        orgId,
        warehouseId,
        periodId,
        version: 1,
        startDate: date,
        endDate: date,
        timezone: "Asia/Bangkok",
        siteCode: "CAPTURED",
        siteName: "Captured site",
        fingerprint: "frozen",
        totals: {
          employees: 99,
          days: 99,
          workedMinutes: 99999,
          outsideShiftMinutes: 9999,
          absentDays: 5,
          leaveDays: 7,
          nonworkingDays: 4,
        },
        closedByUserId: world.userA,
        closedAt,
      });
      await ctx.db.insert("hrPeriodRows", {
        orgId,
        versionId,
        employeeId: employee,
        employeeCode: "CAPTURED-EMP",
        employeeName: "Captured employee",
        businessDate: date,
        plan: { kind: "SCHEDULED", breakMinutes: 60, startAt: 100, endAt: 200 },
        ...(originalCaptured === undefined
          ? {}
          : { originalCaptured, originalStartAt: 110, originalEndAt: 190 }),
        actualStartAt: 120,
        actualEndAt: 200,
        workedMinutes: 80,
        outsideShiftMinutes: 5,
        disposition: "WORKED",
        correctionReason: "Captured correction",
      });
      return versionId;
    });
  return {
    world,
    employeeId,
    otherId,
    tenantBId,
    client: world.t.withIdentity(actor),
    request,
    version,
  };
}
describe("employee frozen periods and retained correction filters", () => {
  it("searches beyond the first page without treating an empty filtered page as the end", async () => {
    const f = await fixture();
    await f.request(0, "NEEDLE older request");
    for (let i = 1; i < 48; i++) await f.request(i, "Different request");
    let page = value<RequestPage>(
      await f.client.query(requests, {
        text: "needle",
        status: "RETURNED",
        limit: 10,
      }),
    );
    expect(page.items).toEqual([]);
    expect(page.isDone).toBe(false);
    for (let i = 0; i < 10 && !page.items.length && !page.isDone; i++)
      page = value<RequestPage>(
        await f.client.query(requests, {
          text: "needle",
          status: "RETURNED",
          limit: 10,
          cursor: page.continueCursor,
        }),
      );
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.reason).toContain("NEEDLE");
  });
  it("applies date/status/text criteria to owned rows and rejects invalid filters", async () => {
    const f = await fixture();
    await f.request(0, "owned match");
    await f.request(0, "other employee secret", f.otherId);
    expect(
      value<RequestPage>(
        await f.client.query(requests, {
          from: "2026-01-01",
          to: "2026-01-01",
          text: "owned",
          status: "RETURNED",
        }),
      ).items,
    ).toHaveLength(1);
    for (const args of [
      { from: "2026-02-30" },
      { from: "2026-03-01", to: "2026-01-01" },
    ])
      expect(value(await f.client.query(requests, args))).toMatchObject({
        ok: false,
        code: "DATE_RANGE_INVALID",
      });
    expect(
      value(await f.client.query(requests, { text: "x".repeat(101) })),
    ).toMatchObject({ ok: false, code: "REQUEST_FILTER_INVALID" });
    expect(value(await f.client.query(requests, { limit: 0 }))).toMatchObject({
      ok: false,
      code: "PAGE_SIZE_INVALID",
    });
  });
  it("recomputes employee-only frozen totals and retains captured names and punches after live changes", async () => {
    const f = await fixture(),
      versionId = await f.version(f.employeeId, 1, true);
    const before = value(await f.client.query(detail, { versionId }));
    expect(before).toMatchObject({
      employee: { code: "CAPTURED-EMP", name: "Captured employee" },
      version: { siteCode: "CAPTURED", timezone: "Asia/Bangkok" },
      summary: {
        days: 1,
        workedMinutes: 80,
        outsideShiftMinutes: 5,
        leaveDays: 0,
      },
      rows: [
        {
          originalCaptured: true,
          originalStart: 110,
          originalEnd: 190,
          effectiveStart: 120,
          effectiveEnd: 200,
        },
      ],
    });
    await f.world.t.run(async (ctx) => {
      await ctx.db.patch(f.employeeId, {
        displayName: "Renamed",
        warehouseId: f.world.warehouses.bravoA,
      });
      await ctx.db.patch(f.world.warehouses.alphaA, { code: "CHANGED" });
      const org = await ctx.db.get(f.world.orgA);
      await ctx.db.patch(f.world.orgA, {
        settings: { ...org!.settings, timezone: "Asia/Tokyo" },
      });
    });
    expect(value(await f.client.query(detail, { versionId }))).toEqual(before);
    expect(
      value<{ items: { id: string }[] }>(
        await f.client.query(list, {}),
      ).items.map((row) => row.id),
    ).toContain(versionId);
  });
  it("denies another employee's version and cross-organization forged version IDs", async () => {
    const f = await fixture(),
      other = await f.version(f.otherId),
      foreign = await f.version(f.tenantBId, 2, true, true);
    for (const versionId of [other, foreign, "malformed-id"])
      expect(value(await f.client.query(detail, { versionId }))).toMatchObject({
        ok: false,
        code: "NOT_FOUND",
      });
    expect(value(await f.client.query(list, {}))).toMatchObject({ items: [] });
  });
  it("labels original punches unknown for old frozen versions instead of inventing them", async () => {
    const f = await fixture(),
      versionId = await f.version();
    const result = value<{
      rows: {
        originalCaptured: boolean;
        originalStart?: number;
        effectiveStart: number;
      }[];
    }>(await f.client.query(detail, { versionId }));
    expect(result.rows[0]).toMatchObject({
      originalCaptured: false,
      effectiveStart: 120,
    });
    expect(result.rows[0]!.originalStart).toBeUndefined();
  });
  it("preserves continuation across a page of versions belonging only to other staff", async () => {
    const f = await fixture(),
      own = await f.version();
    for (let i = 0; i < 26; i++) await f.version(f.otherId, i + 2);
    const first = value<{
      items: unknown[];
      isDone: boolean;
      continueCursor: string;
    }>(await f.client.query(list, {}));
    expect(first.items).toEqual([]);
    expect(first.isDone).toBe(false);
    expect(
      value<{ items: { id: string }[] }>(
        await f.client.query(list, { cursor: first.continueCursor }),
      ).items.map((row) => row.id),
    ).toEqual([own]);
  });
  it("captures original punches when the real period close creates a new immutable version", async () => {
    const f = await fixture("HR_ADMIN"),
      start = fromLocal(date, 510, 420),
      end = fromLocal(date, 1050, 420);
    await f.world.t.run((ctx) =>
      ctx.db.insert("hrAttendanceDays", {
        orgId: f.world.orgA,
        warehouseId: f.world.warehouses.alphaA,
        employeeId: f.employeeId,
        businessDate: date,
        plan: {
          kind: "SCHEDULED",
          breakMinutes: 60,
          startAt: start,
          endAt: end,
          startTime: "08:30",
          endTime: "17:30",
          endsNextDay: false,
        },
        clockInAt: start,
        clockOutAt: end,
        open: false,
        revision: 2,
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    const created = value<{ documentId: string }>(
      await f.client.mutation(
        makeFunctionReference<"mutation">("hr/periods:create"),
        {
          requestId: "frozen_period_create",
          warehouseId: f.world.warehouses.alphaA,
          startDate: date,
          endDate: date,
        },
      ),
    );
    const preview = value<{
      view: { kind: "DRAFT"; fingerprint: string; blocker: unknown };
    }>(
      await f.client.query(
        makeFunctionReference<"query">("hr/periods:preview"),
        { periodId: created.documentId },
      ),
    );
    expect(
      value(
        await f.client.mutation(
          makeFunctionReference<"mutation">("hr/periods:close"),
          {
            requestId: "frozen_period_close",
            periodId: created.documentId,
            expectedFingerprint: preview.view.fingerprint,
          },
        ),
      ),
    ).toMatchObject({ written: true });
    const versions = value<{ items: { id: string }[] }>(
      await f.client.query(list, {}),
    );
    expect(
      value(await f.client.query(detail, { versionId: versions.items[0]!.id })),
    ).toMatchObject({
      rows: [
        {
          originalCaptured: true,
          originalStart: start,
          originalEnd: end,
          effectiveStart: start,
          effectiveEnd: end,
        },
      ],
    });
  });
});
