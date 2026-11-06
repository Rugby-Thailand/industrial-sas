import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { makeFunctionReference } from "convex/server";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../../fixtures/convex-tenant-world";

// Integration review: the roster eligibility seam against the employee
// hardening lane's retained employment intervals. Registered functions run
// through convex-test; nothing is mocked.

const ADMIN = { subject: "user_fixture_a", org_id: "org_fixture_a" };
let sequence = 0;
const requestId = () => `roster-employment-${++sequence}`;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 9, 20, 3));
});
afterEach(() => vi.useRealTimers());

async function fixture() {
  const world = await createConvexTenantWorld({
    "../convex/hr/roster.ts": () => import("../../../convex/hr/roster"),
    "../convex/hr/setup.ts": () => import("../../../convex/hr/setup"),
    "../convex/hr/employeeProfile.ts": () =>
      import("../../../convex/hr/employeeProfile"),
  });
  await seedConvexAuthorization(world, {
    roleA: "HR_ADMIN",
    roleB: "HR_ADMIN",
  });
  return world;
}

async function run(
  world: ConvexTenantWorld,
  kind: "query" | "mutation",
  name: string,
  args: object,
): Promise<any> {
  const client = world.t.withIdentity(ADMIN);
  const out = (await (kind === "query"
    ? client.query(makeFunctionReference<"query">(name), args as never)
    : client.mutation(
        makeFunctionReference<"mutation">(name),
        args as never,
      ))) as { ok: boolean; value?: unknown };
  expect(out.ok, JSON.stringify(out)).toBe(true);
  return out.value;
}
const write = (world: ConvexTenantWorld, name: string, args: object) =>
  run(world, "mutation", name, { requestId: requestId(), ...args });

async function hire(world: ConvexTenantWorld, startDate = "2026-01-05") {
  const value = await write(world, "hr/setup:saveEmployee", {
    warehouseId: world.warehouses.alphaA,
    code: `E${sequence}`,
    displayName: "Gap Employee",
    employmentStartDate: startDate,
    status: "ACTIVE",
    schedule: {
      workDays: [1, 2, 3, 4, 5],
      startTime: "09:00",
      endTime: "18:00",
      endsNextDay: false,
      breakMinutes: 60,
    },
  });
  expect(value).toMatchObject({ written: true });
  return value.documentId as Id<"hrEmployees">;
}
async function lifecycle(
  world: ConvexTenantWorld,
  id: Id<"hrEmployees">,
  kind: "OFFBOARD" | "REINSTATE",
  date: string,
) {
  const employee = await world.t.run((ctx) => ctx.db.get(id));
  const value = await write(world, "hr/employeeProfile:recordEmploymentEvent", {
    employeeId: id,
    expectedVersion: employee!.version,
    kind,
    effectiveDate: date,
    reason: "Roster integration review",
    ...(kind === "OFFBOARD" ? { separationType: "RESIGNATION" } : {}),
  });
  expect(value, JSON.stringify(value)).toMatchObject({ written: true });
}
async function dayShift(world: ConvexTenantWorld) {
  const value = await write(world, "hr/roster:saveShift", {
    warehouseId: world.warehouses.alphaA,
    code: "DAY",
    name: "Day",
    color: "sky",
    status: "ACTIVE",
    startTime: "08:00",
    endTime: "17:00",
    endsNextDay: false,
    breakMinutes: 60,
  });
  return value.documentId as Id<"hrShifts">;
}
const stored = (world: ConvexTenantWorld) =>
  world.t.run((ctx) => ctx.db.query("hrRosterAssignments").collect());

it("refuses SHIFT, OFF and CLEAR inside a separation gap atomically and locks the gap cells", async () => {
  const world = await fixture();
  const id = await hire(world);
  const shiftId = await dayShift(world);
  await lifecycle(world, id, "OFFBOARD", "2026-09-30");
  await lifecycle(world, id, "REINSTATE", "2026-10-19");
  const employee = await world.t.run((ctx) => ctx.db.get(id));
  expect(employee!.employmentIntervals).toEqual([
    { startDate: "2026-01-05", endDate: "2026-09-30" },
    { startDate: "2026-10-19" },
  ]);

  for (const action of [
    { kind: "SHIFT", shiftId, expectedShiftVersion: 1 },
    { kind: "OFF" },
    { kind: "CLEAR" },
  ]) {
    const refused = await write(world, "hr/roster:assignRoster", {
      warehouseId: world.warehouses.alphaA,
      action,
      cells: [
        { employeeId: id, date: "2026-10-20", expectedRevision: 0 },
        { employeeId: id, date: "2026-10-10", expectedRevision: 0 },
      ],
    });
    expect(refused).toMatchObject({
      written: false,
      error: { code: "ROSTER_NOT_EMPLOYED" },
    });
  }
  expect(await stored(world)).toEqual([]);

  const roster = await run(world, "query", "hr/roster:roster", {
    warehouseId: world.warehouses.alphaA,
    month: "2026-10",
  });
  const cells = roster.employees.find((row: { id: string }) => row.id === id)
    .cells as { date: string; lock: string | null }[];
  const lock = (date: string) => cells.find((c) => c.date === date)!.lock;
  expect(lock("2026-10-01")).toBe("NOT_EMPLOYED");
  expect(lock("2026-10-18")).toBe("NOT_EMPLOYED");
  expect(lock("2026-10-19")).toBeNull();

  const accepted = await write(world, "hr/roster:assignRoster", {
    warehouseId: world.warehouses.alphaA,
    action: { kind: "OFF" },
    cells: [{ employeeId: id, date: "2026-10-20", expectedRevision: 0 }],
  });
  expect(accepted).toMatchObject({ written: true });
  expect((await stored(world)).map((row) => row.businessDate)).toEqual([
    "2026-10-20",
  ]);
});

it("refuses a batch that includes a date before employment starts without a partial write", async () => {
  const world = await fixture();
  const late = await hire(world, "2026-10-15");
  const other = await hire(world);
  const shiftId = await dayShift(world);
  const refused = await write(world, "hr/roster:assignRoster", {
    warehouseId: world.warehouses.alphaA,
    action: { kind: "SHIFT", shiftId, expectedShiftVersion: 1 },
    cells: [
      { employeeId: other, date: "2026-10-12", expectedRevision: 0 },
      { employeeId: late, date: "2026-10-16", expectedRevision: 0 },
      { employeeId: late, date: "2026-10-14", expectedRevision: 0 },
    ],
  });
  expect(refused).toMatchObject({
    written: false,
    error: { code: "ROSTER_NOT_EMPLOYED" },
  });
  expect(await stored(world)).toEqual([]);
});
