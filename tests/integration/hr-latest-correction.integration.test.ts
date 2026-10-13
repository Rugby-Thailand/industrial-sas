import { v } from "convex/values";
import { describe, expect, it } from "vitest";

import type { Doc, Id } from "../../convex/_generated/dataModel";
import { dayCorrections, latestCorrection } from "../../convex/hr/dayDetail";
import { storedPlan } from "../../convex/hr/shared";
import { queryWithOrg } from "../../convex/lib/tenantFunctions";
import { HR_PERMISSION } from "../../convex/lib/permissions";
import { fromLocal } from "../../convex/model/hr/calendar";
import { planFor } from "../../convex/model/hr/schedule";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";
import { meteredCall } from "../fixtures/hr-read-meter";

/**
 * `latestCorrection` must equal `dayCorrections(...).items[0]` (the value
 * Today and History showed) for pending, returned, resubmitted, tied and
 * long histories, while reading at most the newest row plus the pending one.
 */

const ACTOR = { subject: "user_fixture_a", org_id: "org_fixture_a" };
const DATE = "2026-10-01";

const probe = queryWithOrg({
  args: { dayId: v.id("hrAttendanceDays") },
  returns: v.any(),
  permissionCode: HR_PERMISSION.selfAccess,
  target: { table: "hrCorrectionRequests" },
  handler: async (ctx, args) => {
    const day = await ctx.tenantDb.getX<Doc<"hrAttendanceDays">>(
      "hrAttendanceDays",
      args.dayId,
    );
    return (await latestCorrection(ctx, day))?._id ?? null;
  },
});
const full = queryWithOrg({
  args: { dayId: v.id("hrAttendanceDays") },
  returns: v.any(),
  permissionCode: HR_PERMISSION.selfAccess,
  target: { table: "hrCorrectionRequests" },
  handler: async (ctx, args) => {
    const day = await ctx.tenantDb.getX<Doc<"hrAttendanceDays">>(
      "hrAttendanceDays",
      args.dayId,
    );
    return (await dayCorrections(ctx, day)).items[0]?._id ?? null;
  },
});

async function fixture() {
  const world = await createConvexTenantWorld();
  await seedConvexAuthorization(world, {
    roleA: "HR_EMPLOYEE",
    roleB: "HR_EMPLOYEE",
  });
  const employeeId = await world.t.run((ctx) =>
    ctx.db.insert("hrEmployees", {
      orgId: world.orgA,
      warehouseId: world.warehouses.alphaA,
      code: "OWN",
      displayName: "Own",
      userId: world.userA,
      employmentStartDate: "2024-01-01",
      status: "ACTIVE",
      version: 1,
      createdAt: 1,
      createdByUserId: world.userA,
      updatedAt: 1,
      updatedByUserId: world.userA,
    }),
  );
  return { world, employeeId };
}

type Seed = {
  readonly status: "PENDING" | "CERTIFIED" | "RETURNED";
  readonly submittedAt: number;
};

async function day(
  world: ConvexTenantWorld,
  employeeId: Id<"hrEmployees">,
  seeds: readonly Seed[],
  pendingIndex?: number,
) {
  return world.t.run(async (ctx) => {
    const dayId = await ctx.db.insert("hrAttendanceDays", {
      orgId: world.orgA,
      warehouseId: world.warehouses.alphaA,
      employeeId,
      businessDate: DATE,
      plan: storedPlan(
        planFor({
          date: DATE,
          schedule: undefined,
          holidayName: undefined,
          offsetMinutes: 420,
        }),
      ),
      open: false,
      revision: 0,
      createdAt: 1,
      updatedAt: 1,
    });
    const ids: Id<"hrCorrectionRequests">[] = [];
    for (const seed of seeds)
      ids.push(
        await ctx.db.insert("hrCorrectionRequests", {
          orgId: world.orgA,
          warehouseId: world.warehouses.alphaA,
          employeeId,
          dayId,
          businessDate: DATE,
          status: seed.status,
          proposedStartAt: fromLocal(DATE, 510, 420),
          proposedEndAt: fromLocal(DATE, 1050, 420),
          reason: "Missing punch",
          baseRevision: 0,
          version: 1,
          submittedByUserId: world.userA,
          submittedAt: seed.submittedAt,
          history: [{ action: "SUBMITTED", actorUserId: world.userA, at: 1 }],
        }),
      );
    if (pendingIndex !== undefined)
      await ctx.db.patch("hrAttendanceDays", dayId, {
        pendingCorrectionId: ids[pendingIndex]!,
      });
    return { dayId, ids };
  });
}

async function compare(
  world: ConvexTenantWorld,
  dayId: Id<"hrAttendanceDays">,
) {
  const fast = await meteredCall<{ ok: true; value: string | null }>(
    world,
    probe,
    { dayId },
    ACTOR,
  );
  const old = await meteredCall<{ ok: true; value: string | null }>(
    world,
    full,
    { dayId },
    ACTOR,
  );
  expect(fast.outcome.value).toBe(old.outcome.value);
  return { latest: fast.outcome.value, fast: fast.meter, old: old.meter };
}

describe("latest correction of a day", () => {
  it("is null for a day without requests", async () => {
    const { world, employeeId } = await fixture();
    const { dayId } = await day(world, employeeId, []);
    expect((await compare(world, dayId)).latest).toBeNull();
  });

  it("matches the full helper over pending, returned and decided requests", async () => {
    const { world, employeeId } = await fixture();
    // A pending request submitted after earlier decided/returned ones.
    const a = await day(
      world,
      employeeId,
      [
        { status: "RETURNED", submittedAt: 10 },
        { status: "CERTIFIED", submittedAt: 20 },
        { status: "PENDING", submittedAt: 30 },
      ],
      2,
    );
    expect((await compare(world, a.dayId)).latest).toBe(a.ids[2]);
    // Only returned/decided requests: the newest submission.
    const b = await day(world, employeeId, [
      { status: "RETURNED", submittedAt: 10 },
      { status: "CERTIFIED", submittedAt: 40 },
      { status: "RETURNED", submittedAt: 30 },
    ]);
    expect((await compare(world, b.dayId)).latest).toBe(b.ids[1]);
  });

  it("reads one correction for a long history instead of twenty-one", async () => {
    const { world, employeeId } = await fixture();
    const seeds: Seed[] = Array.from({ length: 30 }, (_, index) => ({
      status: "RETURNED" as const,
      submittedAt: 100 + index,
    }));
    seeds.push({ status: "PENDING", submittedAt: 1_000 });
    const { dayId, ids } = await day(world, employeeId, seeds, 30);
    const { latest, fast, old } = await compare(world, dayId);
    expect(latest).toBe(ids[30]);
    expect(fast.docs.hrCorrectionRequests).toBe(1);
    expect(old.docs.hrCorrectionRequests).toBe(21);
  });

  it("follows the pending request when its index entry is stale or tied", async () => {
    const { world, employeeId } = await fixture();
    // A pending request outside the newest 20 (an older submittedAt, e.g.
    // imported data) sorts after newer ones, exactly as before.
    const seeds: Seed[] = [{ status: "PENDING", submittedAt: 5 }];
    for (let index = 0; index < 25; index += 1)
      seeds.push({ status: "RETURNED", submittedAt: 100 + index });
    const stale = await day(world, employeeId, seeds, 0);
    const result = await compare(world, stale.dayId);
    expect(result.latest).toBe(stale.ids[1 + 24]);
    // Equal submittedAt: the rare tie defers to the full helper's ordering.
    const tied = await day(
      world,
      employeeId,
      [
        { status: "RETURNED", submittedAt: 50 },
        { status: "PENDING", submittedAt: 50 },
        { status: "RETURNED", submittedAt: 50 },
      ],
      0,
    );
    await compare(world, tied.dayId);
  });
});
