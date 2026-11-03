import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeFunctionReference } from "convex/server";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  seedSecondActorForOrgA,
  type ConvexTenantWorld,
} from "../../fixtures/convex-tenant-world";

// S04 named FIXED shifts and the dated roster, through the registered Convex
// functions (argument validators, tenant/permission wrappers and the HR
// command envelope all run). Nothing is mocked; no browser or deployment.
// Fixture-only shortcuts are explicit: a CLOSED period row is seeded with
// `t.run` because closing a real period needs every row certified first.

const ADMIN = { subject: "user_fixture_a", org_id: "org_fixture_a" };
const ADMIN2 = { subject: "user_fixture_a2", org_id: "org_fixture_a" };
const FOREIGN = { subject: "user_fixture_a", org_id: "org_fixture_b" };
type Identity = typeof ADMIN;

// 2026-10-20 (Tuesday) 10:00 in Bangkok.
const NOW = Date.UTC(2026, 9, 20, 3);
const TODAY = "2026-10-20";
let sequence = 0;
const requestId = () => `roster-request-${++sequence}`;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

async function fixture() {
  const world = await createConvexTenantWorld({
    "../convex/hr/roster.ts": () => import("../../../convex/hr/roster"),
    "../convex/hr/setup.ts": () => import("../../../convex/hr/setup"),
    "../convex/hr/self.ts": () => import("../../../convex/hr/self"),
    "../convex/hr/periods.ts": () => import("../../../convex/hr/periods"),
    "../convex/hr/periodClose.ts": () =>
      import("../../../convex/hr/periodClose"),
  });
  await seedConvexAuthorization(world, {
    roleA: "HR_ADMIN",
    roleB: "HR_ADMIN",
  });
  return world;
}

async function call(
  world: ConvexTenantWorld,
  identity: Identity,
  kind: "query" | "mutation",
  name: string,
  args: object,
) {
  const client = world.t.withIdentity(identity);
  const out = (await (kind === "query"
    ? client.query(makeFunctionReference<"query">(name), args as never)
    : client.mutation(
        makeFunctionReference<"mutation">(name),
        args as never,
      ))) as { ok: boolean; value?: any };
  expect(out.ok, JSON.stringify(out)).toBe(true);
  return out.value;
}
const mutate = (
  world: ConvexTenantWorld,
  name: string,
  args: object,
  identity: Identity = ADMIN,
) => call(world, identity, "mutation", name, args);
const query = (
  world: ConvexTenantWorld,
  name: string,
  args: object,
  identity: Identity = ADMIN,
) => call(world, identity, "query", name, args);
async function written(
  world: ConvexTenantWorld,
  name: string,
  args: object,
  identity: Identity = ADMIN,
) {
  const value = await mutate(
    world,
    name,
    { requestId: requestId(), ...args },
    identity,
  );
  expect(value, JSON.stringify(value)).toMatchObject({ written: true });
  return value as { documentId: string; replayed: boolean };
}
async function refused(
  world: ConvexTenantWorld,
  name: string,
  args: object,
  code: string,
  identity: Identity = ADMIN,
) {
  const value = await mutate(
    world,
    name,
    { requestId: requestId(), ...args },
    identity,
  );
  expect(value, JSON.stringify(value)).toMatchObject({
    written: false,
    error: { code },
  });
  return value;
}

const DAY_SHIFT = {
  code: "shift101",
  name: "Work time 08:00 - 17:00",
  description: "Regular day shift",
  color: "sky",
  status: "ACTIVE",
  startTime: "08:00",
  endTime: "17:00",
  endsNextDay: false,
  breakMinutes: 60,
} as const;
const NIGHT_SHIFT = {
  code: "NIGHT",
  name: "Night 22:00 - 06:00",
  color: "violet",
  status: "ACTIVE",
  startTime: "22:00",
  endTime: "06:00",
  endsNextDay: true,
  breakMinutes: 30,
} as const;
const WEEKLY = {
  workDays: [1, 2, 3, 4, 5],
  startTime: "09:00",
  endTime: "18:00",
  endsNextDay: false,
  breakMinutes: 60,
};

async function employee(
  world: ConvexTenantWorld,
  code: string,
  extra: Record<string, unknown> = {},
) {
  return (
    await written(world, "hr/setup:saveEmployee", {
      warehouseId: world.warehouses.alphaA,
      code,
      displayName: `Employee ${code}`,
      employmentStartDate: "2026-01-05",
      status: "ACTIVE",
      schedule: WEEKLY,
      ...extra,
    })
  ).documentId as Id<"hrEmployees">;
}
async function shift(
  world: ConvexTenantWorld,
  fields: Record<string, unknown> = DAY_SHIFT,
) {
  return (
    await written(world, "hr/roster:saveShift", {
      warehouseId: world.warehouses.alphaA,
      ...fields,
    })
  ).documentId as Id<"hrShifts">;
}
const rosterOf = (world: ConvexTenantWorld, month = "2026-10") =>
  query(world, "hr/roster:roster", {
    warehouseId: world.warehouses.alphaA,
    month,
  });
async function cell(
  world: ConvexTenantWorld,
  employeeId: string,
  date: string,
  identity: Identity = ADMIN,
) {
  const roster = await query(
    world,
    "hr/roster:roster",
    { warehouseId: world.warehouses.alphaA, month: date.slice(0, 7) },
    identity,
  );
  expect(roster.ok, JSON.stringify(roster)).toBe(true);
  const row = roster.employees.find(
    (item: { id: string }) => item.id === employeeId,
  );
  return row.cells.find((item: { date: string }) => item.date === date);
}
const assign = (
  world: ConvexTenantWorld,
  action: Record<string, unknown>,
  cells: readonly {
    employeeId: string;
    date: string;
    expectedRevision: number;
  }[],
) => ({
  warehouseId: world.warehouses.alphaA,
  action,
  cells,
});
const storedAssignments = (world: ConvexTenantWorld) =>
  world.t.run((ctx) => ctx.db.query("hrRosterAssignments").collect());
const storedDays = (world: ConvexTenantWorld) =>
  world.t.run((ctx) => ctx.db.query("hrAttendanceDays").collect());

describe("S04 shift definitions", () => {
  it("saves a named FIXED shift, reloads it and protects its code, revision and request identity", async () => {
    const world = await fixture();
    const fixedId = await shift(world);
    const list = await query(world, "hr/roster:shifts", {
      warehouseId: world.warehouses.alphaA,
    });
    expect(list).toMatchObject({
      ok: true,
      complete: true,
      items: [
        {
          id: fixedId,
          code: "SHIFT101",
          name: DAY_SHIFT.name,
          description: DAY_SHIFT.description,
          color: "sky",
          status: "ACTIVE",
          startTime: "08:00",
          endTime: "17:00",
          endsNextDay: false,
          breakMinutes: 60,
          version: 1,
        },
      ],
    });

    // Duplicate code protection is case-insensitive within the site.
    await refused(
      world,
      "hr/roster:saveShift",
      { warehouseId: world.warehouses.alphaA, ...DAY_SHIFT, code: "Shift101" },
      "SHIFT_CODE_TAKEN",
    );
    // Existing schedule rules: the break must be shorter than the shift.
    await refused(
      world,
      "hr/roster:saveShift",
      {
        warehouseId: world.warehouses.alphaA,
        ...DAY_SHIFT,
        code: "BAD",
        breakMinutes: 540,
      },
      "SCHEDULE_BREAK_INVALID",
    );
    // OFF is the reserved nonworking override, not a definable shift.
    await refused(
      world,
      "hr/roster:saveShift",
      { warehouseId: world.warehouses.alphaA, ...DAY_SHIFT, code: "off" },
      "SHIFT_CODE_INVALID",
    );

    // Idempotency: the same request replays; a changed payload is refused.
    const fixedRequest = requestId();
    const args = {
      requestId: fixedRequest,
      warehouseId: world.warehouses.alphaA,
      shiftId: fixedId,
      expectedVersion: 1,
      ...DAY_SHIFT,
      name: "Day shift",
    };
    const first = await mutate(world, "hr/roster:saveShift", args);
    const again = await mutate(world, "hr/roster:saveShift", args);
    expect(first).toMatchObject({ written: true, replayed: false });
    expect(again).toMatchObject({
      written: true,
      replayed: true,
      documentId: fixedId,
    });
    const changed = await mutate(world, "hr/roster:saveShift", {
      ...args,
      name: "Other",
    });
    expect(changed).toMatchObject({ written: false });

    // Two administrators: the second editor opened version 1 and is stale.
    await seedSecondActorForOrgA(world, "HR_ADMIN");
    await refused(
      world,
      "hr/roster:saveShift",
      {
        warehouseId: world.warehouses.alphaA,
        shiftId: fixedId,
        expectedVersion: 1,
        ...DAY_SHIFT,
        name: "Lost update",
      },
      "SHIFT_STALE",
      ADMIN2,
    );
    const stored = await world.t.run((ctx) => ctx.db.get(fixedId));
    expect(stored).toMatchObject({ name: "Day shift", version: 2 });
  });

  it("denies another site and another tenant without writing", async () => {
    const world = await fixture();
    const fixedId = await shift(world);
    // The site-scoped administrator holds only ALPHA in organization A.
    await refused(
      world,
      "hr/roster:saveShift",
      { warehouseId: world.warehouses.bravoA, ...DAY_SHIFT },
      "SITE_UNAVAILABLE",
    );
    expect(
      await query(world, "hr/roster:shifts", {
        warehouseId: world.warehouses.bravoA,
      }),
    ).toEqual({ ok: false, code: "SITE_UNAVAILABLE" });
    // Organization B cannot read or edit organization A's site or shift.
    expect(
      await query(
        world,
        "hr/roster:shifts",
        { warehouseId: world.warehouses.alphaA },
        FOREIGN,
      ),
    ).toEqual({ ok: false, code: "SITE_UNAVAILABLE" });
    await refused(
      world,
      "hr/roster:saveShift",
      {
        warehouseId: world.warehouses.alphaB,
        shiftId: fixedId,
        expectedVersion: 1,
        ...DAY_SHIFT,
      },
      "NOT_FOUND",
      FOREIGN,
    );
    const rows = await world.t.run((ctx) => ctx.db.query("hrShifts").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ version: 1, name: DAY_SHIFT.name });
  });
});

describe("S04 dated roster", () => {
  it("assigns FIXED and OFF, clears back to the weekly fallback and reloads every cell", async () => {
    const world = await fixture();
    const a = await employee(world, "E001");
    const b = await employee(world, "E002");
    const fixedId = await shift(world);

    const roster = await rosterOf(world);
    expect(roster.dates).toHaveLength(31);
    expect(roster.dates[0]).toMatchObject({ date: "2026-10-01", weekday: 4 });
    expect(roster.employees.map((row: { code: string }) => row.code)).toEqual([
      "E001",
      "E002",
    ]);
    // Weekly fallback before any assignment.
    expect(await cell(world, a, "2026-10-21")).toMatchObject({
      revision: 0,
      assignment: null,
      plan: { kind: "SCHEDULED", startTime: "09:00", endTime: "18:00" },
      lock: null,
    });

    await written(
      world,
      "hr/roster:assignRoster",
      assign(
        world,
        { kind: "SHIFT", shiftId: fixedId, expectedShiftVersion: 1 },
        [
          { employeeId: a, date: "2026-10-21", expectedRevision: 0 },
          { employeeId: b, date: "2026-10-21", expectedRevision: 0 },
          // A weekend date the weekly schedule does not cover.
          { employeeId: a, date: "2026-10-24", expectedRevision: 0 },
        ],
      ),
    );
    await written(
      world,
      "hr/roster:assignRoster",
      assign(world, { kind: "OFF" }, [
        { employeeId: a, date: "2026-10-22", expectedRevision: 0 },
      ]),
    );

    expect(await cell(world, a, "2026-10-21")).toMatchObject({
      revision: 1,
      assignment: { kind: "SHIFT", code: "SHIFT101", version: 1 },
      plan: {
        kind: "SCHEDULED",
        startTime: "08:00",
        endTime: "17:00",
        breakMinutes: 60,
        shiftCode: "SHIFT101",
      },
    });
    expect(await cell(world, a, "2026-10-24")).toMatchObject({
      plan: { kind: "SCHEDULED", startTime: "08:00", shiftCode: "SHIFT101" },
    });
    // Explicit OFF is a stored nonworking override, distinct from no row.
    expect(await cell(world, a, "2026-10-22")).toMatchObject({
      revision: 1,
      assignment: { kind: "OFF" },
      plan: { kind: "NONWORKING", reason: "OFF" },
    });
    expect(await cell(world, a, "2026-10-23")).toMatchObject({
      revision: 0,
      assignment: null,
      plan: { kind: "SCHEDULED", startTime: "09:00" },
    });

    // Clear restores the fallback through a versioned tombstone.
    await written(
      world,
      "hr/roster:assignRoster",
      assign(world, { kind: "CLEAR" }, [
        { employeeId: a, date: "2026-10-22", expectedRevision: 1 },
        { employeeId: a, date: "2026-10-24", expectedRevision: 1 },
      ]),
    );
    expect(await cell(world, a, "2026-10-22")).toMatchObject({
      revision: 2,
      assignment: null,
      plan: { kind: "SCHEDULED", startTime: "09:00" },
    });
    expect(await cell(world, a, "2026-10-24")).toMatchObject({
      revision: 2,
      assignment: null,
      plan: { kind: "NONWORKING", reason: "UNSCHEDULED" },
    });
    const rows = await storedAssignments(world);
    expect(rows).toHaveLength(4);
    expect(
      rows.filter((row) => row.kind === "CLEARED").map((row) => row.revision),
    ).toEqual([2, 2]);
    // Employee B's same date is isolated from A's later edits.
    expect(await cell(world, b, "2026-10-21")).toMatchObject({
      revision: 1,
      assignment: { kind: "SHIFT", code: "SHIFT101" },
    });
    expect(await cell(world, b, "2026-10-22")).toMatchObject({
      assignment: null,
    });
  });

  it("refuses stale two-admin edits across clear and reassignment (ABA) and replays one request once", async () => {
    const world = await fixture();
    const a = await employee(world, "E001");
    const fixedId = await shift(world);
    await seedSecondActorForOrgA(world, "HR_ADMIN");
    const date = "2026-10-21";
    const shiftAction = {
      kind: "SHIFT",
      shiftId: fixedId,
      expectedShiftVersion: 1,
    };
    await written(
      world,
      "hr/roster:assignRoster",
      assign(world, shiftAction, [
        { employeeId: a, date, expectedRevision: 0 },
      ]),
    );
    // Admin 2 opened the roster at revision 1 (SHIFT101) …
    expect((await cell(world, a, date, ADMIN2)).revision).toBe(1);
    // … admin 1 clears it and assigns SHIFT101 again: same visible value.
    await written(
      world,
      "hr/roster:assignRoster",
      assign(world, { kind: "CLEAR" }, [
        { employeeId: a, date, expectedRevision: 1 },
      ]),
    );
    await written(
      world,
      "hr/roster:assignRoster",
      assign(world, shiftAction, [
        { employeeId: a, date, expectedRevision: 2 },
      ]),
    );
    // Admin 2's OFF based on revision 1 is refused despite the equal value.
    await refused(
      world,
      "hr/roster:assignRoster",
      assign(world, { kind: "OFF" }, [
        { employeeId: a, date, expectedRevision: 1 },
      ]),
      "ROSTER_STALE",
      ADMIN2,
    );
    expect(await cell(world, a, date)).toMatchObject({
      revision: 3,
      assignment: { kind: "SHIFT" },
    });

    const args = {
      requestId: requestId(),
      ...assign(world, { kind: "OFF" }, [
        { employeeId: a, date, expectedRevision: 3 },
      ]),
    };
    const first = await mutate(world, "hr/roster:assignRoster", args);
    const replay = await mutate(world, "hr/roster:assignRoster", args);
    expect(first).toMatchObject({ written: true, replayed: false });
    expect(replay).toMatchObject({ written: true, replayed: true });
    expect(await cell(world, a, date)).toMatchObject({
      revision: 4,
      assignment: { kind: "OFF" },
    });
    // A duplicated cell in one command is refused outright.
    await refused(
      world,
      "hr/roster:assignRoster",
      assign(world, { kind: "CLEAR" }, [
        { employeeId: a, date, expectedRevision: 4 },
        { employeeId: a, date, expectedRevision: 4 },
      ]),
      "ROSTER_SELECTION_INVALID",
    );
  });

  it("snapshots the definition so a later edit never changes an assigned date", async () => {
    const world = await fixture();
    const a = await employee(world, "E001");
    const fixedId = await shift(world);
    await written(
      world,
      "hr/roster:assignRoster",
      assign(
        world,
        { kind: "SHIFT", shiftId: fixedId, expectedShiftVersion: 1 },
        [{ employeeId: a, date: "2026-10-21", expectedRevision: 0 }],
      ),
    );
    await written(world, "hr/roster:saveShift", {
      warehouseId: world.warehouses.alphaA,
      shiftId: fixedId,
      expectedVersion: 1,
      ...DAY_SHIFT,
      startTime: "07:00",
      endTime: "16:00",
    });
    expect(await cell(world, a, "2026-10-21")).toMatchObject({
      assignment: { version: 1, startTime: "08:00" },
      plan: { startTime: "08:00", endTime: "17:00" },
    });
    // An editor that still holds version 1 cannot assign the changed shift.
    await refused(
      world,
      "hr/roster:assignRoster",
      assign(
        world,
        { kind: "SHIFT", shiftId: fixedId, expectedShiftVersion: 1 },
        [{ employeeId: a, date: "2026-10-22", expectedRevision: 0 }],
      ),
      "SHIFT_STALE",
    );
    await written(
      world,
      "hr/roster:assignRoster",
      assign(
        world,
        { kind: "SHIFT", shiftId: fixedId, expectedShiftVersion: 2 },
        [{ employeeId: a, date: "2026-10-22", expectedRevision: 0 }],
      ),
    );
    expect(await cell(world, a, "2026-10-22")).toMatchObject({
      assignment: { version: 2 },
      plan: { startTime: "07:00" },
    });
    expect(await cell(world, a, "2026-10-21")).toMatchObject({
      plan: { startTime: "08:00" },
    });
  });

  it("refuses inactive references, other sites and tenants atomically", async () => {
    const world = await fixture();
    const a = await employee(world, "E001");
    const inactive = await employee(world, "E002", {
      status: "INACTIVE",
      employmentEndDate: "2026-10-15",
    });
    const late = await employee(world, "E003", {
      employmentStartDate: "2026-10-25",
    });
    const fixedId = await shift(world);
    const retiredId = await shift(world, {
      ...DAY_SHIFT,
      code: "OLD",
      status: "INACTIVE",
    });
    const action = { kind: "SHIFT", shiftId: fixedId, expectedShiftVersion: 1 };
    const valid = { employeeId: a, date: "2026-10-21", expectedRevision: 0 };

    await refused(
      world,
      "hr/roster:assignRoster",
      assign(
        world,
        { kind: "SHIFT", shiftId: retiredId, expectedShiftVersion: 1 },
        [valid],
      ),
      "SHIFT_INACTIVE",
    );
    await refused(
      world,
      "hr/roster:assignRoster",
      assign(world, action, [
        valid,
        { employeeId: inactive, date: "2026-10-21", expectedRevision: 0 },
      ]),
      "EMPLOYEE_INACTIVE",
    );
    await refused(
      world,
      "hr/roster:assignRoster",
      assign(world, action, [
        valid,
        { employeeId: late, date: "2026-10-21", expectedRevision: 0 },
      ]),
      "ROSTER_NOT_EMPLOYED",
    );
    // The scoped admin cannot assign on a site outside its grants.
    await refused(
      world,
      "hr/roster:assignRoster",
      {
        ...assign(world, { kind: "OFF" }, [valid]),
        warehouseId: world.warehouses.bravoA,
      },
      "SITE_UNAVAILABLE",
    );
    // Another tenant cannot resolve organization A's employee or shift.
    await refused(
      world,
      "hr/roster:assignRoster",
      {
        ...assign(world, action, [valid]),
        warehouseId: world.warehouses.alphaB,
      },
      "NOT_FOUND",
      FOREIGN,
    );
    await refused(
      world,
      "hr/roster:assignRoster",
      {
        ...assign(world, { kind: "OFF" }, [valid]),
        warehouseId: world.warehouses.alphaB,
      },
      "NOT_FOUND",
      FOREIGN,
    );
    expect(
      await query(
        world,
        "hr/roster:roster",
        { warehouseId: world.warehouses.alphaA, month: "2026-10" },
        FOREIGN,
      ),
    ).toEqual({ ok: false, code: "SITE_UNAVAILABLE" });
    // Every refusal above wrote nothing, including the valid first cell.
    expect(await storedAssignments(world)).toEqual([]);
    expect(
      await query(world, "hr/roster:roster", {
        warehouseId: world.warehouses.alphaA,
        month: "2026-02-30",
      }),
    ).toEqual({ ok: false, code: "MONTH_INVALID" });
  });

  it("refuses captured and frozen dates, including clear, without changing attendance", async () => {
    const world = await fixture();
    const a = await employee(world, "E001", { userId: world.userA });
    const b = await employee(world, "E002");
    const fixedId = await shift(world);
    // OFF on yesterday and today is planned before the employee clocks in.
    await written(
      world,
      "hr/roster:assignRoster",
      assign(world, { kind: "OFF" }, [
        { employeeId: a, date: TODAY, expectedRevision: 0 },
      ]),
    );
    // Clocking in captures today's plan (explicit OFF) on the attendance day.
    await written(world, "hr/self:clockIn", {});
    const [captured] = await storedDays(world);
    expect(captured).toMatchObject({
      businessDate: TODAY,
      plan: {
        kind: "NONWORKING",
        reason: "OFF",
        roster: { kind: "OFF", revision: 1 },
      },
    });
    expect(await cell(world, a, TODAY)).toMatchObject({
      recorded: true,
      lock: "RECORDED",
    });

    const shiftAction = {
      kind: "SHIFT",
      shiftId: fixedId,
      expectedShiftVersion: 1,
    };
    for (const action of [shiftAction, { kind: "OFF" }, { kind: "CLEAR" }])
      await refused(
        world,
        "hr/roster:assignRoster",
        assign(world, action, [
          { employeeId: b, date: TODAY, expectedRevision: 0 },
          { employeeId: a, date: TODAY, expectedRevision: 1 },
        ]),
        "ROSTER_DAY_RECORDED",
      );
    // Atomic: employee B's valid cell was not written either.
    expect(await storedAssignments(world)).toHaveLength(1);
    expect(await storedDays(world)).toEqual([captured]);

    // A closed period freezes every date it covers, even for clear.
    await world.t.run(async (ctx) => {
      await ctx.db.insert("hrPeriods", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        startDate: "2026-10-01",
        endDate: "2026-10-15",
        status: "CLOSED",
        draftVersion: 2,
        latestClosedVersion: 1,
        createdAt: NOW,
        createdByUserId: world.userA,
        updatedAt: NOW,
        updatedByUserId: world.userA,
      });
    });
    for (const action of [shiftAction, { kind: "OFF" }, { kind: "CLEAR" }])
      await refused(
        world,
        "hr/roster:assignRoster",
        assign(world, action, [
          { employeeId: b, date: "2026-10-16", expectedRevision: 0 },
          { employeeId: b, date: "2026-10-15", expectedRevision: 0 },
        ]),
        "PERIOD_CLOSED",
      );
    expect(await cell(world, b, "2026-10-10")).toMatchObject({
      lock: "PERIOD_CLOSED",
    });
    expect(await storedAssignments(world)).toHaveLength(1);
    expect(await storedDays(world)).toEqual([captured]);

    // A staged close in progress reads one snapshot: its dates freeze too.
    await world.t.run(async (ctx) => {
      await ctx.db.insert("hrPeriods", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        startDate: "2026-10-16",
        endDate: "2026-10-18",
        status: "CLOSING",
        draftVersion: 1,
        latestClosedVersion: 0,
        createdAt: NOW,
        createdByUserId: world.userA,
        updatedAt: NOW,
        updatedByUserId: world.userA,
      });
    });
    for (const action of [shiftAction, { kind: "OFF" }, { kind: "CLEAR" }])
      await refused(
        world,
        "hr/roster:assignRoster",
        assign(world, action, [
          { employeeId: b, date: "2026-10-19", expectedRevision: 0 },
          { employeeId: b, date: "2026-10-17", expectedRevision: 0 },
        ]),
        "HR_PERIOD_CLOSING",
      );
    expect(await cell(world, b, "2026-10-17")).toMatchObject({
      lock: "PERIOD_CLOSED",
    });
    expect(await storedAssignments(world)).toHaveLength(1);
  });
});

describe("S04 live plan wiring", () => {
  it("staged close publishes a dated OFF instead of inventing a weekly absence", async () => {
    const world = await fixture();
    const id = await employee(world, "E001");
    await written(
      world,
      "hr/roster:assignRoster",
      assign(world, { kind: "OFF" }, [
        { employeeId: id, date: "2026-10-19", expectedRevision: 0 },
      ]),
    );
    const { documentId: periodId } = await written(world, "hr/periods:create", {
      warehouseId: world.warehouses.alphaA,
      startDate: "2026-10-19",
      endDate: "2026-10-19",
    });
    await written(world, "hr/periodClose:begin", { periodId });
    let published = false;
    for (let step = 0; step < 12; step += 1) {
      const { view } = await query(world, "hr/periods:preview", {
        periodId,
        clockFree: true,
      });
      expect(view.kind).toBe("CLOSING");
      if (view.state === "READY") {
        await written(world, "hr/periodClose:publish", {
          periodId,
          versionId: view.versionId,
          expectedFingerprint: view.fingerprint,
        });
        published = true;
        break;
      }
      await written(world, "hr/periodClose:advance", {
        periodId,
        versionId: view.versionId,
        step: view.step,
      });
    }
    expect(published).toBe(true);
    const closed = await query(world, "hr/periods:preview", {
      periodId,
      clockFree: true,
    });
    expect(closed.view).toMatchObject({
      kind: "CLOSED",
      totals: { absentDays: 0 },
    });
    expect(closed.view.rows).toHaveLength(1);
    expect(closed.view.rows[0]).toMatchObject({
      businessDate: "2026-10-19",
      plan: { kind: "NONWORKING", reason: "OFF" },
    });
  });

  it("Today and the draft period use FIXED/OFF assignments, the weekly fallback and site holiday precedence", async () => {
    const world = await fixture();
    const a = await employee(world, "E001", { userId: world.userA });
    const fixedId = await shift(world);
    await written(
      world,
      "hr/roster:assignRoster",
      assign(
        world,
        { kind: "SHIFT", shiftId: fixedId, expectedShiftVersion: 1 },
        [
          { employeeId: a, date: TODAY, expectedRevision: 0 },
          { employeeId: a, date: "2026-10-24", expectedRevision: 0 },
          { employeeId: a, date: "2026-10-26", expectedRevision: 0 },
        ],
      ),
    );
    await written(
      world,
      "hr/roster:assignRoster",
      assign(world, { kind: "OFF" }, [
        { employeeId: a, date: "2026-10-21", expectedRevision: 0 },
      ]),
    );
    // Our preserved rule: a site holiday wins over a dated assignment.
    await written(world, "hr/setup:saveHoliday", {
      warehouseId: world.warehouses.alphaA,
      date: "2026-10-26",
      name: "Site holiday",
    });

    const today = await query(world, "hr/self:today", {});
    expect(today).toMatchObject({
      state: "NOT_CLOCKED_IN",
      businessDate: TODAY,
      plan: {
        kind: "SCHEDULED",
        startTime: "08:00",
        endTime: "17:00",
        breakMinutes: 60,
        shiftCode: "SHIFT101",
      },
    });

    const period = await written(world, "hr/periods:create", {
      warehouseId: world.warehouses.alphaA,
      startDate: "2026-10-19",
      endDate: "2026-10-26",
    });
    const preview = await query(world, "hr/periods:preview", {
      periodId: period.documentId,
    });
    expect(preview.view.kind).toBe("DRAFT");
    const plans = Object.fromEntries(
      preview.view.rows.map((row: { businessDate: string; plan: unknown }) => [
        row.businessDate,
        row.plan,
      ]),
    );
    expect(plans["2026-10-19"]).toMatchObject({
      kind: "SCHEDULED",
      startTime: "09:00",
    });
    expect(plans[TODAY]).toMatchObject({
      kind: "SCHEDULED",
      startTime: "08:00",
      shiftCode: "SHIFT101",
    });
    expect(plans["2026-10-21"]).toEqual({ kind: "NONWORKING", reason: "OFF" });
    expect(plans["2026-10-24"]).toMatchObject({
      kind: "SCHEDULED",
      shiftCode: "SHIFT101",
    });
    expect(plans["2026-10-25"]).toEqual({
      kind: "NONWORKING",
      reason: "UNSCHEDULED",
    });
    expect(plans["2026-10-26"]).toEqual({
      kind: "NONWORKING",
      reason: "HOLIDAY",
      holidayName: "Site holiday",
    });
    expect(await cell(world, a, "2026-10-26")).toMatchObject({
      assignment: { kind: "SHIFT" },
      plan: { kind: "NONWORKING", reason: "HOLIDAY" },
    });
    // The paged draft view (used for periods too large to preview whole)
    // plans each date exactly as the complete preview does.
    let scanCursor: string | undefined;
    let paged: { status?: string; page: { rows: typeof preview.view.rows }[] };
    for (let guard = 0; ; guard += 1) {
      expect(guard).toBeLessThan(20);
      paged = await query(world, "hr/periods:draftEmployeesPage", {
        periodId: period.documentId,
        ...(scanCursor === undefined ? {} : { scanCursor }),
      });
      if (paged.status !== "scanning") break;
      scanCursor = (paged as { scanCursor?: string }).scanCursor;
    }
    expect(
      Object.fromEntries(
        paged.page
          .flatMap((employee) => employee.rows)
          .map((row: { businessDate: string; plan: unknown }) => [
            row.businessDate,
            row.plan,
          ]),
      ),
    ).toEqual(plans);

    // Explicit OFF on Today's date is a nonworking day.
    vi.setSystemTime(Date.UTC(2026, 9, 21, 3));
    expect(await query(world, "hr/self:today", {})).toMatchObject({
      state: "NONWORKING",
      businessDate: "2026-10-21",
      plan: { kind: "NONWORKING", reason: "OFF" },
    });
  });

  it("an overnight FIXED assignment resolves its start business date in the site timezone and captures provenance", async () => {
    const world = await fixture();
    const a = await employee(world, "E001", { userId: world.userA });
    const nightId = await shift(world, NIGHT_SHIFT);
    await written(
      world,
      "hr/roster:assignRoster",
      assign(
        world,
        { kind: "SHIFT", shiftId: nightId, expectedShiftVersion: 1 },
        [{ employeeId: a, date: "2026-10-19", expectedRevision: 0 }],
      ),
    );
    // 2026-10-20 01:00 Bangkok, during Monday's overnight shift.
    vi.setSystemTime(Date.UTC(2026, 9, 19, 18));
    const today = await query(world, "hr/self:today", {});
    expect(today).toMatchObject({
      businessDate: "2026-10-19",
      plan: {
        kind: "SCHEDULED",
        startTime: "22:00",
        endTime: "06:00",
        endsNextDay: true,
        startAt: Date.UTC(2026, 9, 19, 15),
        endAt: Date.UTC(2026, 9, 19, 23),
        shiftCode: "NIGHT",
      },
    });
    await written(world, "hr/self:clockIn", {});
    const [day] = await storedDays(world);
    expect(day).toMatchObject({
      businessDate: "2026-10-19",
      plan: {
        kind: "SCHEDULED",
        startAt: Date.UTC(2026, 9, 19, 15),
        endAt: Date.UTC(2026, 9, 19, 23),
        roster: {
          kind: "SHIFT",
          revision: 1,
          shiftId: nightId,
          shiftCode: "NIGHT",
          shiftVersion: 1,
        },
      },
    });
    // Later definition edits do not rewrite the captured plan.
    await written(world, "hr/roster:saveShift", {
      warehouseId: world.warehouses.alphaA,
      shiftId: nightId,
      expectedVersion: 1,
      ...NIGHT_SHIFT,
      startTime: "21:00",
    });
    expect((await storedDays(world))[0]!.plan).toEqual(day!.plan);
  });
});
