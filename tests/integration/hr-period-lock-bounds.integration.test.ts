import { v } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../convex/_generated/dataModel";
import * as periods from "../../convex/hr/periods";
import { closedPeriodCovering, sitePeriods } from "../../convex/hr/shared";
import { HR_PERMISSION } from "../../convex/lib/permissions";
import { queryWithOrg } from "../../convex/lib/tenantFunctions";
import {
  addDays,
  compareDates,
  fromLocal,
} from "../../convex/model/hr/calendar";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";
import { meteredCall } from "../fixtures/hr-read-meter";

/** Period safety uses the exact site scan, including inconsistent legacy imports. */

const ACTOR = { subject: "user_fixture_a", org_id: "org_fixture_a" };
type Status = "DRAFT" | "CLOSED";
type Seed = readonly [start: string, end: string, status: Status];

const lock = queryWithOrg({
  args: { date: v.string(), warehouseId: v.id("warehouses") },
  returns: v.any(),
  permissionCode: HR_PERMISSION.periodClose,
  target: { table: "hrPeriods" },
  handler: async (ctx, args) =>
    (await closedPeriodCovering(ctx, args.warehouseId, args.date))?._id ?? null,
});
const exact = queryWithOrg({
  args: { date: v.string(), warehouseId: v.id("warehouses") },
  returns: v.any(),
  permissionCode: HR_PERMISSION.periodClose,
  target: { table: "hrPeriods" },
  handler: async (ctx, args) =>
    (await sitePeriods(ctx, args.warehouseId)).find(
      (period) =>
        period.status === "CLOSED" &&
        compareDates(period.startDate, args.date) <= 0 &&
        compareDates(args.date, period.endDate) <= 0,
    )?._id ?? null,
});

async function fixture() {
  const world = await createConvexTenantWorld();
  await seedConvexAuthorization(world, {
    roleA: "HR_ADMIN",
    roleB: "HR_ADMIN",
  });
  await world.t.run(async (ctx) => {
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_orgId_userId", (q) =>
        q.eq("orgId", world.orgA).eq("userId", world.userA),
      )
      .unique();
    await ctx.db.patch("memberships", membership!._id, {
      scopeMode: "ORG_WIDE",
    });
  });
  return world;
}

const seed = (
  world: ConvexTenantWorld,
  rows: readonly Seed[],
  warehouseId: Id<"warehouses"> = world.warehouses.alphaA,
  orgId: Id<"organizations"> = world.orgA,
) =>
  world.t.run(async (ctx) => {
    for (const [startDate, endDate, status] of rows)
      await ctx.db.insert("hrPeriods", {
        orgId,
        warehouseId,
        startDate,
        endDate,
        status,
        draftVersion: 1,
        latestClosedVersion: status === "CLOSED" ? 1 : 0,
        createdAt: 1,
        createdByUserId: world.userA,
        updatedAt: 1,
        updatedByUserId: world.userA,
      });
  });

/** Weekly closed periods ending the day before `until`, oldest first. */
const weekly = (count: number, until: string): Seed[] =>
  Array.from({ length: count }, (_, index) => {
    const start = addDays(until, -7 * (count - index));
    return [start, addDays(start, 6), "CLOSED"] as const;
  });

async function check(world: ConvexTenantWorld, date: string) {
  const args = { date, warehouseId: world.warehouses.alphaA };
  const fast = await meteredCall<{ ok: true; value: string | null }>(
    world,
    lock,
    args,
    ACTOR,
  );
  const old = await meteredCall<{ ok: true; value: string | null }>(
    world,
    exact,
    args,
    ACTOR,
  );
  expect(fast.outcome.value, date).toBe(old.outcome.value);
  return {
    locked: fast.outcome.value !== null,
    read: fast.meter.docs.hrPeriods ?? 0,
  };
}

describe("exact period lock", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(fromLocal("2026-10-13", 10 * 60, 420));
  });
  afterEach(() => vi.useRealTimers());

  it("answers with no periods", async () => {
    const world = await fixture();
    expect(await check(world, "2026-10-13")).toEqual({
      locked: false,
      read: 0,
    });
  });

  it("checks recent and backdated dates across the complete site history", async () => {
    const world = await fixture();
    // Five years of weekly closed periods, a gap, then a current draft.
    await seed(world, [
      ...weekly(260, "2026-09-28"),
      ["2026-10-05", "2026-10-11", "DRAFT"],
    ]);
    const first = addDays("2026-09-28", -7 * 260);
    for (const date of [
      "2026-10-13", // after the draft: not locked
      "2026-10-08", // in the draft
      "2026-09-27", // last day of the newest closed period
      "2026-09-21", // first day of it
      "2026-09-24", // middle
      "2026-09-30", // gap between closed history and the draft
      first, // first day of the oldest period
      addDays(first, -1), // before any period
      "2024-02-29", // backdated, deep in history
    ]) {
      const { read } = await check(world, date);
      expect(read, date).toBe(261);
    }
    expect((await check(world, "2026-09-27")).locked).toBe(true);
    expect((await check(world, "2026-09-30")).locked).toBe(false);
    expect((await check(world, "2026-10-08")).locked).toBe(false);
  });

  it("finds a covering period that starts before the window in legacy history", async () => {
    const world = await fixture();
    // An imported period longer than the creation bound still locks.
    await seed(world, [["2026-01-01", "2026-06-30", "CLOSED"]]);
    expect(await check(world, "2026-06-30")).toMatchObject({ locked: true });
    expect(await check(world, "2026-07-01")).toMatchObject({ locked: false });
  });

  it("keeps locks when stored periods overlap", async () => {
    const world = await fixture();
    // Legacy data includes duplicate start dates and overlapping drafts.
    const rows: Seed[] = [["2026-03-01", "2026-03-31", "CLOSED"]];
    for (let day = 0; day < 31; day += 1) {
      const date = addDays("2026-03-01", day);
      rows.push([date, date, "DRAFT"]);
      rows.push([date, date, "DRAFT"]);
    }
    await seed(world, rows);
    for (const date of ["2026-03-01", "2026-03-15", "2026-03-31", "2026-04-01"])
      await check(world, date);
    expect((await check(world, "2026-03-15")).locked).toBe(true);
  });

  it("locks an overlong closed period hidden behind an overlapping draft", async () => {
    const world = await fixture();
    await seed(world, [
      ["2026-08-01", "2026-10-31", "CLOSED"],
      ["2026-09-01", "2026-09-02", "DRAFT"],
    ]);
    expect(await check(world, "2026-10-13")).toEqual({ locked: true, read: 2 });
  });

  it("ignores other sites and tenants", async () => {
    const world = await fixture();
    await seed(
      world,
      [["2026-10-01", "2026-10-07", "CLOSED"]],
      world.warehouses.bravoA,
    );
    await seed(
      world,
      [["2026-10-01", "2026-10-07", "CLOSED"]],
      world.warehouses.alphaB,
      world.orgB,
    );
    expect(await check(world, "2026-10-03")).toEqual({
      locked: false,
      read: 0,
    });
  });
});

describe("period creation overlap check", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(fromLocal("2026-10-13", 10 * 60, 420));
  });
  afterEach(() => vi.useRealTimers());

  const create = (
    world: ConvexTenantWorld,
    startDate: string,
    endDate: string,
    requestId: string,
  ) =>
    meteredCall<{
      ok: true;
      value: { written: boolean; error?: { code: string } };
    }>(
      world,
      periods.create,
      { requestId, warehouseId: world.warehouses.alphaA, startDate, endDate },
      ACTOR,
    );

  it("refuses overlaps with recent, future and backdated periods", async () => {
    const world = await fixture();
    await seed(world, [
      ...weekly(260, "2026-09-28"),
      ["2026-12-01", "2026-12-31", "DRAFT"],
    ]);
    const cases = [
      ["2026-09-27", "2026-10-03", "PERIOD_OVERLAP"], // touches the last day
      ["2026-11-20", "2026-12-01", "PERIOD_OVERLAP"], // touches a future one
      ["2024-03-01", "2024-03-01", "PERIOD_OVERLAP"], // backdated inside history
    ] as const;
    for (const [index, [start, end, code]] of cases.entries()) {
      const { outcome, meter } = await create(
        world,
        start,
        end,
        `overlap-${index}-req`,
      );
      expect(outcome.value, start).toMatchObject({
        written: false,
        error: { code },
      });
      expect(meter.docs.hrPeriods ?? 0).toBe(261);
    }
    const free = await create(
      world,
      "2026-09-28",
      "2026-10-04",
      "free-gap-req1",
    );
    expect(free.outcome.value).toMatchObject({ written: true });
    expect(free.meter.docs.hrPeriods ?? 0).toBe(261);
  });

  it("refuses an overlong overlap hidden behind a later draft", async () => {
    const world = await fixture();
    await seed(world, [
      ["2026-08-01", "2026-10-31", "CLOSED"],
      ["2026-09-01", "2026-09-02", "DRAFT"],
    ]);
    expect(
      (await create(world, "2026-10-13", "2026-10-14", "legacy-overlap-req"))
        .outcome.value,
    ).toMatchObject({ written: false, error: { code: "PERIOD_OVERLAP" } });
  });

  it("still refuses a long imported period that started before the window", async () => {
    const world = await fixture();
    await seed(world, [["2026-01-01", "2026-06-30", "CLOSED"]]);
    expect(
      (await create(world, "2026-06-25", "2026-07-05", "long-import-req"))
        .outcome.value,
    ).toMatchObject({ written: false, error: { code: "PERIOD_OVERLAP" } });
  });
});
