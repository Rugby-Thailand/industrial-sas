import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../convex/_generated/dataModel";
import * as review from "../../convex/hr/review";
import * as self from "../../convex/hr/self";
import { storedPlan } from "../../convex/hr/shared";
import { addDays, fromLocal } from "../../convex/model/hr/calendar";
import { planFor } from "../../convex/model/hr/schedule";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";
import { meteredCall } from "../fixtures/hr-read-meter";

/**
 * Personal history, Today's recent requests and the review queue read
 * days and holidays as date ranges (one index range each) instead of one
 * lookup per date, with the same answers.
 */

const ACTOR = { subject: "user_fixture_a", org_id: "org_fixture_a" };
const TODAY = "2026-10-13";
const SCHEDULE = {
  workDays: [1, 2, 3, 4, 5],
  startTime: "08:30",
  endTime: "17:30",
  endsNextDay: false,
  breakMinutes: 60,
};

async function fixture(role: string) {
  const world = await createConvexTenantWorld();
  await seedConvexAuthorization(world, { roleA: role, roleB: "HR_EMPLOYEE" });
  const insert = (code: string, userId?: Id<"users">) =>
    world.t.run((ctx) =>
      ctx.db.insert("hrEmployees", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
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
  return { world, own: await insert("OWN", world.userA), insert };
}

/** Recorded days with a correction each, plus site holidays. */
async function history(
  world: ConvexTenantWorld,
  employeeId: Id<"hrEmployees">,
) {
  await world.t.run(async (ctx) => {
    for (let back = 0; back < 31; back += 1) {
      const date = addDays(TODAY, -back);
      if (back % 3 === 1) {
        await ctx.db.insert("hrHolidays", {
          orgId: world.orgA,
          warehouseId: world.warehouses.alphaA,
          date,
          name: `Holiday ${back}`,
          createdAt: 1,
          createdByUserId: world.userA,
        });
        continue;
      }
      if (back % 3 === 2) continue;
      const dayId = await ctx.db.insert("hrAttendanceDays", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
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
      await ctx.db.insert("hrCorrectionRequests", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        employeeId,
        dayId,
        businessDate: date,
        status: "RETURNED",
        proposedStartAt: fromLocal(date, 510, 420),
        proposedEndAt: fromLocal(date, 1050, 420),
        reason: "Missing punch",
        baseRevision: 0,
        version: 1,
        submittedByUserId: world.userA,
        submittedAt: 1,
        history: [{ action: "SUBMITTED", actorUserId: world.userA, at: 1 }],
      });
    }
  });
}

describe("HR date-range reads", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(fromLocal(TODAY, 18 * 60, 420));
  });
  afterEach(() => vi.useRealTimers());

  it("reads a month of personal history with one day range and one holiday range", async () => {
    const { world, own } = await fixture("HR_EMPLOYEE");
    await history(world, own);
    const { outcome, meter } = await meteredCall<{ ok: true; value: any }>(
      world,
      self.history,
      { from: addDays(TODAY, -30), to: TODAY },
      ACTOR,
    );
    const rows = outcome.value.rows as {
      businessDate: string;
      plan: { kind: string; holidayName?: string };
      correction?: { status: string };
    }[];
    expect(rows).toHaveLength(31);
    expect(rows[0]!.businessDate).toBe(TODAY);
    expect(rows[0]!.correction).toMatchObject({ status: "RETURNED" });
    expect(rows[1]!.plan).toMatchObject({ holidayName: "Holiday 1" });
    expect(rows.filter((row) => row.correction).length).toBe(11);
    expect(meter.ranges.hrAttendanceDays).toBe(1);
    expect(meter.ranges.hrHolidays).toBe(1);
    // One latest correction per recorded day, never the 21-row history.
    expect(meter.docs.hrCorrectionRequests).toBe(11);
  });

  it("lists Today's recent requests from one 14-day range", async () => {
    const { world, own } = await fixture("HR_EMPLOYEE");
    await history(world, own);
    const { outcome, meter } = await meteredCall<{ ok: true; value: any }>(
      world,
      self.today,
      {},
      ACTOR,
    );
    expect(
      (outcome.value.corrections as { businessDate: string }[]).map(
        (item) => item.businessDate,
      ),
    ).toEqual([0, 3, 6, 9, 12].map((back) => addDays(TODAY, -back)));
    // selfState still reads yesterday and today exactly; the summary adds one.
    expect(meter.ranges.hrAttendanceDays).toBeLessThanOrEqual(4);
  });

  it("evaluates the review queue page with one range per employee and site", async () => {
    const { world, insert } = await fixture("HR_ADMIN");
    const other = await insert("TEAM");
    await history(world, other);
    const { outcome, meter } = await meteredCall<{ ok: true; value: any }>(
      world,
      review.queuePage,
      { from: addDays(TODAY, -30), to: TODAY, tab: "OPEN" },
      ACTOR,
    );
    expect(outcome.value).toMatchObject({ ok: true, status: "ready" });
    expect(outcome.value.page).toHaveLength(1);
    expect(meter.ranges.hrAttendanceDays).toBe(1);
    expect(meter.ranges.hrHolidays).toBe(1);
  });
});
