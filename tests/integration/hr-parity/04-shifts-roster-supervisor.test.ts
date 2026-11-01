import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";

import { MAX_SITE_SHIFTS } from "../../../convex/model/hr/roster";
import type { ConvexTenantWorld } from "../../fixtures/convex-tenant-world";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
} from "../../fixtures/convex-tenant-world";

it("a full shift catalogue refuses another definition while allowing a versioned edit", async () => {
  const world = await createConvexTenantWorld({
    "../convex/hr/roster.ts": () => import("../../../convex/hr/roster"),
  });
  await seedConvexAuthorization(world, {
    roleA: "HR_ADMIN",
    roleB: "HR_ADMIN",
  });
  const draft = {
    warehouseId: world.warehouses.alphaA,
    code: "EXTRA",
    name: "Day shift",
    color: "sky" as const,
    status: "ACTIVE" as const,
    startTime: "08:00",
    endTime: "17:00",
    endsNextDay: false,
    breakMinutes: 60,
  };
  const ids = await world.t.run(async (ctx) => {
    const inserted = [];
    for (let index = 0; index < MAX_SITE_SHIFTS; index += 1) {
      inserted.push(
        await ctx.db.insert("hrShifts", {
          ...draft,
          code: `SHIFT${String(index).padStart(3, "0")}`,
          orgId: world.orgA,
          version: 1,
          createdAt: 1,
          createdByUserId: world.userA,
          updatedAt: 1,
          updatedByUserId: world.userA,
        }),
      );
    }
    return inserted;
  });
  const client = world.t.withIdentity({
    subject: "user_fixture_a",
    org_id: "org_fixture_a",
  });
  const save = makeFunctionReference<"mutation">("hr/roster:saveShift");
  const refused = await client.mutation(save, {
    ...draft,
    requestId: "supervisor-capacity-create",
  });
  expect(refused).toMatchObject({
    ok: true,
    value: { written: false, error: { code: "SHIFT_LIMIT_EXCEEDED" } },
  });
  expect(
    await world.t.run((ctx) => ctx.db.query("hrShifts").collect()),
  ).toHaveLength(MAX_SITE_SHIFTS);

  const edited = await client.mutation(save, {
    ...draft,
    shiftId: ids[0],
    code: "SHIFT000",
    name: "Updated day shift",
    expectedVersion: 1,
    requestId: "supervisor-capacity-edit",
  });
  expect(edited).toMatchObject({ ok: true, value: { written: true } });
  expect(await world.t.run((ctx) => ctx.db.get(ids[0]!))).toMatchObject({
    name: "Updated day shift",
    version: 2,
  });
});

let requestSequence = 0;
async function registered(
  world: ConvexTenantWorld,
  kind: "query" | "mutation",
  name: string,
  args: Record<string, unknown>,
) {
  const client = world.t.withIdentity({
    subject: "user_fixture_a",
    org_id: "org_fixture_a",
  });
  const outcome = (
    kind === "query"
      ? await client.query(makeFunctionReference<"query">(name), args)
      : await client.mutation(makeFunctionReference<"mutation">(name), {
          requestId: `supervisor-roster-${++requestSequence}`,
          ...args,
        })
  ) as { ok: boolean; value: any };
  expect(outcome.ok).toBe(true);
  return outcome.value;
}

async function rosterWorld() {
  const world = await createConvexTenantWorld({
    "../convex/hr/roster.ts": () => import("../../../convex/hr/roster"),
    "../convex/hr/setup.ts": () => import("../../../convex/hr/setup"),
    "../convex/hr/periods.ts": () => import("../../../convex/hr/periods"),
    "../convex/hr/self.ts": () => import("../../../convex/hr/self"),
    "../convex/hr/review.ts": () => import("../../../convex/hr/review"),
  });
  await seedConvexAuthorization(world, {
    roleA: "HR_ADMIN",
    roleB: "HR_ADMIN",
  });
  return world;
}

it.each([
  ["2024-02", 29],
  ["2026-02", 28],
  ["2026-04", 30],
  ["2026-12", 31],
])(
  "the registered month roster returns exactly valid dates for %s",
  async (month, count) => {
    const world = await rosterWorld();
    const value = await registered(world, "query", "hr/roster:roster", {
      warehouseId: world.warehouses.alphaA,
      month,
    });
    expect(value.ok).toBe(true);
    expect(value.dates).toHaveLength(count);
    expect(value.dates[0].date).toBe(`${month}-01`);
    expect(value.dates.at(-1).date).toBe(`${month}-${count}`);
  },
);

it("registered period close rejects an unseen OFF revision and freezes the reviewed plan without attendance mutation", async () => {
  const world = await rosterWorld();
  const date = "2026-10-19";
  const warehouseId = world.warehouses.alphaA;
  const employee = await registered(
    world,
    "mutation",
    "hr/setup:saveEmployee",
    {
      warehouseId,
      userId: world.userA,
      code: "FROZEN",
      displayName: "Frozen roster employee",
      status: "ACTIVE",
      employmentStartDate: "2026-01-01",
      schedule: {
        workDays: [1, 2, 3, 4, 5],
        startTime: "08:00",
        endTime: "17:00",
        endsNextDay: false,
        breakMinutes: 60,
      },
    },
  );
  expect(employee.written).toBe(true);
  const assign = (kind: "OFF" | "CLEAR", expectedRevision: number) =>
    registered(world, "mutation", "hr/roster:assignRoster", {
      warehouseId,
      action: { kind },
      cells: [{ employeeId: employee.documentId, date, expectedRevision }],
    });
  expect(await assign("OFF", 0)).toMatchObject({ written: true });
  const period = await registered(world, "mutation", "hr/periods:create", {
    warehouseId,
    startDate: date,
    endDate: date,
  });
  expect(period.written).toBe(true);
  const preview = () =>
    registered(world, "query", "hr/periods:preview", {
      periodId: period.documentId,
    });
  const reviewed = await preview();
  expect(reviewed.view.blocker).toBeNull();
  expect(await assign("CLEAR", 1)).toMatchObject({ written: true });
  expect(await assign("OFF", 2)).toMatchObject({ written: true });
  expect(
    await registered(world, "mutation", "hr/periods:close", {
      periodId: period.documentId,
      expectedFingerprint: reviewed.view.fingerprint,
    }),
  ).toMatchObject({ written: false, error: { code: "PERIOD_STALE" } });
  expect(
    await world.t.run((ctx) => ctx.db.query("hrPeriodRows").collect()),
  ).toEqual([]);
  const fresh = await preview();
  expect(
    await registered(world, "mutation", "hr/periods:close", {
      periodId: period.documentId,
      expectedFingerprint: fresh.view.fingerprint,
    }),
  ).toMatchObject({ written: true });
  const frozen = await world.t.run(async (ctx) => ({
    rows: await ctx.db.query("hrPeriodRows").collect(),
    versions: await ctx.db.query("hrPeriodVersions").collect(),
    days: await ctx.db.query("hrAttendanceDays").collect(),
  }));
  expect(frozen.rows).toHaveLength(1);
  expect(frozen.rows[0]?.plan).toMatchObject({
    kind: "NONWORKING",
    reason: "OFF",
    roster: { kind: "OFF", revision: 3 },
  });
  expect(frozen.days).toEqual([]);
  for (const kind of ["CLEAR", "OFF"] as const)
    expect(await assign(kind, 3)).toMatchObject({
      written: false,
      error: { code: "PERIOD_CLOSED" },
    });
  expect(
    await world.t.run(async (ctx) => ({
      rows: await ctx.db.query("hrPeriodRows").collect(),
      versions: await ctx.db.query("hrPeriodVersions").collect(),
      days: await ctx.db.query("hrAttendanceDays").collect(),
    })),
  ).toEqual(frozen);

  const history = await registered(world, "query", "hr/self:history", {
    from: date,
    to: date,
  });
  expect(history.rows[0].plan).toMatchObject({
    kind: "NONWORKING",
    reason: "OFF",
  });
  expect(
    await registered(world, "query", "hr/review:queue", {
      warehouseId,
      from: date,
      to: date,
    }),
  ).toMatchObject({ ok: true, items: [] });
  expect(
    await registered(world, "mutation", "hr/periods:startRevision", {
      periodId: period.documentId,
      reason: "Review attendance corrections",
    }),
  ).toMatchObject({ written: true });
  // Starting an attendance revision is not authorization for this slice's
  // unknown roster recalculation policy. A once-frozen plan remains fixed.
  expect(await assign("CLEAR", 3)).toMatchObject({
    written: false,
    error: { code: "ROSTER_DAY_FROZEN" },
  });
  await world.t.run(async (ctx) => {
    const member = await ctx.db
      .query("memberships")
      .withIndex("by_orgId_userId", (q) =>
        q.eq("orgId", world.orgA).eq("userId", world.userA),
      )
      .unique();
    await ctx.db.patch("memberships", member!._id, { scopeMode: "ORG_WIDE" });
  });
  expect(
    await registered(world, "mutation", "hr/setup:saveEmployee", {
      employeeId: employee.documentId,
      expectedVersion: 1,
      warehouseId: world.warehouses.bravoA,
      code: "FROZEN",
      displayName: "Frozen roster employee",
      status: "ACTIVE",
      userId: world.userA,
      employmentStartDate: "2026-01-01",
    }),
  ).toMatchObject({ written: true });
  expect(
    await registered(world, "mutation", "hr/roster:assignRoster", {
      warehouseId: world.warehouses.bravoA,
      action: { kind: "CLEAR" },
      cells: [{ employeeId: employee.documentId, date, expectedRevision: 3 }],
    }),
  ).toMatchObject({ written: false, error: { code: "ROSTER_DAY_FROZEN" } });
  const moved = await registered(world, "query", "hr/roster:roster", {
    warehouseId: world.warehouses.bravoA,
    month: "2026-10",
  });
  expect(
    moved.employees[0].cells.find(
      (cell: { date: string }) => cell.date === date,
    ),
  ).toMatchObject({ lock: "FROZEN", revision: 3 });
  expect(
    await world.t.run(async (ctx) => ({
      rows: await ctx.db.query("hrPeriodRows").collect(),
      versions: await ctx.db.query("hrPeriodVersions").collect(),
      days: await ctx.db.query("hrAttendanceDays").collect(),
    })),
  ).toEqual(frozen);
});

it("a moved employee keeps the cell revision while an old-site assignment does not apply at the new site", async () => {
  const world = await rosterWorld();
  // This actor legitimately administers both sites. No production permission
  // check is replaced; the fixture grants the real organization-wide scope.
  await world.t.run(async (ctx) => {
    const member = await ctx.db
      .query("memberships")
      .withIndex("by_orgId_userId", (q) =>
        q.eq("orgId", world.orgA).eq("userId", world.userA),
      )
      .unique();
    await ctx.db.patch("memberships", member!._id, { scopeMode: "ORG_WIDE" });
  });
  const employeeDraft = {
    code: "MOVED",
    displayName: "Moved employee",
    status: "ACTIVE",
    employmentStartDate: "2026-01-01",
    schedule: {
      workDays: [1, 2, 3, 4, 5],
      startTime: "09:00",
      endTime: "18:00",
      endsNextDay: false,
      breakMinutes: 60,
    },
  };
  const employee = await registered(
    world,
    "mutation",
    "hr/setup:saveEmployee",
    {
      ...employeeDraft,
      warehouseId: world.warehouses.alphaA,
    },
  );
  expect(employee.written).toBe(true);
  const date = "2026-10-21";
  expect(
    await registered(world, "mutation", "hr/roster:assignRoster", {
      warehouseId: world.warehouses.alphaA,
      action: { kind: "OFF" },
      cells: [{ employeeId: employee.documentId, date, expectedRevision: 0 }],
    }),
  ).toMatchObject({ written: true });
  expect(
    await registered(world, "mutation", "hr/setup:saveEmployee", {
      ...employeeDraft,
      employeeId: employee.documentId,
      expectedVersion: 1,
      warehouseId: world.warehouses.bravoA,
    }),
  ).toMatchObject({ written: true });
  const value = await registered(world, "query", "hr/roster:roster", {
    warehouseId: world.warehouses.bravoA,
    month: "2026-10",
  });
  const cell = value.employees[0].cells.find(
    (item: { date: string }) => item.date === date,
  );
  expect(cell).toMatchObject({
    revision: 1,
    assignment: null,
    plan: { kind: "SCHEDULED", startTime: "09:00" },
  });
  expect(
    await registered(world, "mutation", "hr/roster:assignRoster", {
      warehouseId: world.warehouses.bravoA,
      action: { kind: "OFF" },
      cells: [{ employeeId: employee.documentId, date, expectedRevision: 1 }],
    }),
  ).toMatchObject({ written: true });
  const rows = await world.t.run((ctx) =>
    ctx.db.query("hrRosterAssignments").collect(),
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    warehouseId: world.warehouses.bravoA,
    revision: 2,
  });
  const reloaded = await registered(world, "query", "hr/roster:roster", {
    warehouseId: world.warehouses.bravoA,
    month: "2026-10",
  });
  expect(
    reloaded.employees[0].cells.find(
      (item: { date: string }) => item.date === date,
    ),
  ).toMatchObject({
    revision: 2,
    assignment: { kind: "OFF" },
    plan: { kind: "NONWORKING", reason: "OFF" },
  });
});
