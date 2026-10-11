import type { GenericMutationCtx } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../convex/_generated/dataModel";
import * as self from "../../convex/hr/self";
import * as adminSetup from "../../convex/hr/setup";
import { storedPlan } from "../../convex/hr/shared";
import { addDays, fromLocal } from "../../convex/model/hr/calendar";
import { planFor } from "../../convex/model/hr/schedule";
import type { DataModel } from "../../convex/schema";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";

interface RuntimeFunction {
  _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
}

async function call(
  world: ConvexTenantWorld,
  fn: unknown,
  args: unknown,
  orgId = "org_fixture_a",
) {
  return world.t
    .withIdentity({ subject: "user_fixture_a", org_id: orgId })
    .run((ctx) =>
      (fn as RuntimeFunction)._handler(
        ctx as GenericMutationCtx<DataModel>,
        args,
      ),
    );
}

function result<T>(outcome: unknown): T {
  expect(outcome).toMatchObject({ ok: true });
  return (outcome as { value: T }).value;
}

const SCHEDULE = {
  workDays: [1, 2, 3, 4, 5],
  startTime: "08:30",
  endTime: "17:30",
  endsNextDay: false,
  breakMinutes: 60,
};

async function fixture(linked = true, roleA = "HR_EMPLOYEE") {
  const world = await createConvexTenantWorld();
  await seedConvexAuthorization(world, { roleA, roleB: "HR_EMPLOYEE" });
  const insertEmployee = (
    orgId: Id<"organizations">,
    warehouseId: Id<"warehouses">,
    code: string,
    userId?: Id<"users">,
  ) =>
    world.t.run((ctx) =>
      ctx.db.insert("hrEmployees", {
        orgId,
        warehouseId,
        code,
        displayName: code,
        ...(userId ? { userId } : {}),
        employmentStartDate: "2024-01-01",
        status: "ACTIVE",
        schedule: SCHEDULE,
        version: 1,
        createdAt: 1,
        createdByUserId: world.userA,
        updatedAt: 1,
        updatedByUserId: world.userA,
      }),
    );
  const employeeId = await insertEmployee(
    world.orgA,
    world.warehouses.alphaA,
    "OWN",
    linked ? world.userA : undefined,
  );
  const otherId = await insertEmployee(
    world.orgA,
    world.warehouses.bravoA,
    "OTHER",
  );
  const tenantBId = await insertEmployee(
    world.orgB,
    world.warehouses.alphaB,
    "TENANT-B",
    world.userA,
  );
  return { world, employeeId, otherId, tenantBId };
}

type HolidayResult = {
  ok: true;
  complete: true;
  year: number;
  employee: { id: string; site: { id: string } };
  holidays: { id: string; date: string; name: string }[];
  nextHoliday: { id: string; date: string; name: string } | null;
};
type RequestResult = {
  ok: true;
  items: {
    id: Id<"hrCorrectionRequests">;
    businessDate: string;
    status: string;
  }[];
  isDone: boolean;
  continueCursor: string;
};

async function insertRequest(
  world: ConvexTenantWorld,
  employeeId: Id<"hrEmployees">,
  date: string,
  status: "PENDING" | "CERTIFIED" | "RETURNED" = "PENDING",
  orgId = world.orgA,
  warehouseId = world.warehouses.alphaA,
) {
  return world.t.run(async (ctx) => {
    const dayId = await ctx.db.insert("hrAttendanceDays", {
      orgId,
      warehouseId,
      employeeId,
      businessDate: date,
      plan: storedPlan(
        planFor({
          date,
          schedule: SCHEDULE,
          holidayName: undefined,
          offsetMinutes: 420,
        }),
      ),
      open: false,
      revision: 0,
      createdAt: 1,
      updatedAt: 1,
    });
    return ctx.db.insert("hrCorrectionRequests", {
      orgId,
      warehouseId,
      employeeId,
      dayId,
      businessDate: date,
      status,
      proposedStartAt: fromLocal(date, 510, 420),
      proposedEndAt: fromLocal(date, 1050, 420),
      reason: "Missing punch",
      baseRevision: 0,
      version: 1,
      submittedByUserId: world.userA,
      submittedAt: 1,
      history: [{ action: "SUBMITTED", actorUserId: world.userA, at: 1 }],
    });
  });
}

describe("linked employee calendars and complete request history", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(fromLocal("2026-10-12", 11 * 60, 420));
  });
  afterEach(() => vi.useRealTimers());

  it("returns a complete selected year beyond the admin list limit, scoped to the linked site and tenant", async () => {
    const { world, employeeId, tenantBId } = await fixture();
    await world.t.run(async (ctx) => {
      for (let offset = 0; offset < 130; offset++)
        await ctx.db.insert("hrHolidays", {
          orgId: world.orgA,
          warehouseId: world.warehouses.alphaA,
          date: addDays("2026-01-01", offset),
          name: `Holiday ${offset}`,
          createdAt: 1,
          createdByUserId: world.userA,
        });
      for (const [orgId, warehouseId, date, name] of [
        [world.orgA, world.warehouses.alphaA, "2026-12-31", "Year end"],
        [world.orgA, world.warehouses.alphaA, "2027-01-01", "Next year"],
        [world.orgA, world.warehouses.bravoA, "2026-10-13", "Other site"],
        [world.orgB, world.warehouses.alphaB, "2026-10-14", "Other tenant"],
      ] as const)
        await ctx.db.insert("hrHolidays", {
          orgId,
          warehouseId,
          date,
          name,
          createdAt: 1,
          createdByUserId: world.userA,
        });
    });
    const calendar = result<HolidayResult>(
      await call(world, self.holidays, { year: 2026 }),
    );
    expect(calendar.complete).toBe(true);
    expect(calendar.employee).toMatchObject({
      id: employeeId,
      site: { id: world.warehouses.alphaA },
    });
    expect(calendar.holidays).toHaveLength(131);
    expect(calendar.holidays[0]?.date).toBe("2026-01-01");
    expect(calendar.holidays.at(-1)?.date).toBe("2026-12-31");
    expect(calendar.nextHoliday?.name).toBe("Year end");
    const otherTenant = result<HolidayResult>(
      await call(world, self.holidays, { year: 2026 }, "org_fixture_b"),
    );
    expect(otherTenant.employee.id).toBe(tenantBId);
    expect(otherTenant.holidays.map((holiday) => holiday.name)).toEqual([
      "Other tenant",
    ]);
    expect(
      await call(world, adminSetup.listHolidays, {
        warehouseId: world.warehouses.alphaA,
      }),
    ).toMatchObject({ ok: false });
  });

  it("supports leap days and exact empty years, and rejects invalid years", async () => {
    const { world } = await fixture();
    await world.t.run((ctx) =>
      ctx.db.insert("hrHolidays", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        date: "2024-02-29",
        name: "Leap holiday",
        createdAt: 1,
        createdByUserId: world.userA,
      }),
    );
    expect(
      result<HolidayResult>(
        await call(world, self.holidays, {
          year: 2024,
        }),
      ).holidays.map((holiday) => holiday.date),
    ).toEqual(["2024-02-29"]);
    expect(
      result<HolidayResult>(
        await call(world, self.holidays, {
          year: 2027,
        }),
      ),
    ).toMatchObject({ complete: true, holidays: [], nextHoliday: null });
    for (const year of [1899, 2201, 2026.5])
      expect(result(await call(world, self.holidays, { year }))).toEqual({
        ok: false,
        code: "YEAR_INVALID",
      });
  });

  it("pages all older requests without including another employee or tenant", async () => {
    const { world, employeeId, otherId, tenantBId } = await fixture();
    const expected = [];
    for (let offset = 0; offset < 61; offset++)
      expected.push(
        await insertRequest(
          world,
          employeeId,
          addDays("2025-01-01", offset),
          (["PENDING", "CERTIFIED", "RETURNED"] as const)[offset % 3],
        ),
      );
    const otherRequest = await insertRequest(world, otherId, "2026-10-10");
    const tenantBRequest = await insertRequest(
      world,
      tenantBId,
      "2026-10-11",
      "CERTIFIED",
      world.orgB,
      world.warehouses.alphaB,
    );
    const items: RequestResult["items"] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = result<RequestResult>(
        await call(world, self.requests, { cursor, limit: 17 }),
      );
      items.push(...page.items);
      cursor = page.isDone ? undefined : page.continueCursor;
      pages++;
      expect(pages).toBeLessThan(10);
    } while (cursor);
    expect(pages).toBe(4);
    expect(items.map((item) => item.id)).toEqual(expected.reverse());
    expect(new Set(items.map((item) => item.id)).size).toBe(61);
    expect(new Set(items.map((item) => item.status))).toEqual(
      new Set(["PENDING", "CERTIFIED", "RETURNED"]),
    );
    for (const status of ["PENDING", "CERTIFIED", "RETURNED"] as const) {
      const filtered: RequestResult["items"] = [];
      let filteredCursor: string | undefined;
      do {
        const page = result<RequestResult>(
          await call(world, self.requests, {
            status,
            cursor: filteredCursor,
            limit: 7,
          }),
        );
        filtered.push(...page.items);
        filteredCursor = page.isDone ? undefined : page.continueCursor;
      } while (filteredCursor);
      expect(filtered.length).toBe(status === "PENDING" ? 21 : 20);
      expect(filtered.every((item) => item.status === status)).toBe(true);
      expect(new Set(filtered.map((item) => item.id)).size).toBe(
        filtered.length,
      );
    }
    for (const correctionId of [otherRequest, tenantBRequest])
      expect(
        result(await call(world, self.requestDetail, { correctionId })),
      ).toEqual({ ok: false, code: "NOT_FOUND" });
    for (const limit of [0, 51, 1.5])
      expect(result(await call(world, self.requests, { limit }))).toEqual({
        ok: false,
        code: "PAGE_SIZE_INVALID",
      });
  });

  it("returns every retained action for an exact old request without a day-list cap", async () => {
    const { world, employeeId } = await fixture();
    const correctionId = await insertRequest(world, employeeId, "2024-01-02");
    await world.t.run((ctx) =>
      ctx.db.patch("hrCorrectionRequests", correctionId, {
        status: "RETURNED",
        history: Array.from({ length: 40 }, (_, index) => ({
          action: index % 2 ? ("RETURNED" as const) : ("SUBMITTED" as const),
          actorUserId: world.userA,
          at: index + 1,
          reason: `Retained ${index}`,
        })),
      }),
    );
    const detail = result<{
      businessDate: string;
      detail: { id: string; status: string; history: { reason: string }[] };
    }>(await call(world, self.requestDetail, { correctionId }));
    expect(detail.businessDate).toBe("2024-01-02");
    expect(detail.detail).toMatchObject({
      id: correctionId,
      status: "RETURNED",
    });
    expect(detail.detail.history).toHaveLength(40);
    expect(detail.detail.history[0]?.reason).toBe("Retained 0");
    expect(detail.detail.history.at(-1)?.reason).toBe("Retained 39");
  });

  it("requires a linked employee and the existing employee self permission", async () => {
    const { world } = await fixture(false);
    expect(result(await call(world, self.holidays, { year: 2026 }))).toEqual({
      ok: false,
      code: "HR_NOT_LINKED",
    });
    expect(result(await call(world, self.requests, {}))).toEqual({
      ok: false,
      code: "HR_NOT_LINKED",
    });
    const manager = await fixture(true, "WAREHOUSE_MANAGER");
    expect(
      await call(manager.world, self.holidays, { year: 2026 }),
    ).toMatchObject({ ok: false });
    expect(await call(manager.world, self.requests, {})).toMatchObject({
      ok: false,
    });
  });

  it("summarizes exactly the evaluated nonfuture business dates without treating missing punches as absence", async () => {
    const { world, employeeId } = await fixture();
    await world.t.run((ctx) =>
      ctx.db.insert("hrAttendanceDays", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        employeeId,
        businessDate: "2026-10-09",
        plan: storedPlan(
          planFor({
            date: "2026-10-09",
            schedule: SCHEDULE,
            holidayName: undefined,
            offsetMinutes: 420,
          }),
        ),
        clockInAt: fromLocal("2026-10-09", 510, 420),
        clockOutAt: fromLocal("2026-10-09", 1050, 420),
        open: false,
        revision: 2,
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    const history = result<{
      rows: { businessDate: string; workedMinutes: number; status: string }[];
      summary: { days: number; workedMinutes: number; absentDays: number };
    }>(
      await call(world, self.history, {
        from: "2026-10-08",
        to: "2026-10-31",
      }),
    );
    expect(history.rows).toHaveLength(5);
    expect(history.summary.days).toBe(history.rows.length);
    expect(history.summary.workedMinutes).toBe(
      history.rows.reduce((sum, row) => sum + row.workedMinutes, 0),
    );
    expect(history.summary.workedMinutes).toBe(480);
    expect(history.summary.absentDays).toBe(0);
    expect(
      history.rows.find((row) => row.businessDate === "2026-10-08")?.status,
    ).toBe("EXCEPTION");
    expect(history.rows.every((row) => row.businessDate <= "2026-10-12")).toBe(
      true,
    );
  });
});
