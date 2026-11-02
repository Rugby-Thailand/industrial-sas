import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type * as ConvexTestModule from "convex-test";
import { makeFunctionReference } from "convex/server";
import { MAX_PERIOD_EMPLOYEES } from "../../../convex/model/hr/period";
import { MAX_ROSTER_CELLS } from "../../../convex/model/hr/roster";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../../fixtures/convex-tenant-world";

// Permanent registered regression: run the declared roster bounds with convex-test's deployed
// transaction limits enabled (4096 database queries, 32k documents read).
vi.mock("convex-test", async (original) => {
  const actual = await original<typeof ConvexTestModule>();
  return {
    ...actual,
    convexTest: (schema: never, modules: never) =>
      actual.convexTest({ schema, modules, transactionLimits: true } as never),
  };
});

const ADMIN = { subject: "user_fixture_a", org_id: "org_fixture_a" };
let sequence = 0;
const requestId = () => `roster-limits-${++sequence}`;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 9, 20, 3));
});
afterEach(() => vi.useRealTimers());

async function call(
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

it("a full declared roster selection (50 employees x 31 days) saves within deployed transaction limits", async () => {
  const world = await createConvexTenantWorld({
    "../convex/hr/roster.ts": () => import("../../../convex/hr/roster"),
    "../convex/hr/setup.ts": () => import("../../../convex/hr/setup"),
  });
  await seedConvexAuthorization(world, {
    roleA: "HR_ADMIN",
    roleB: "HR_ADMIN",
  });
  for (let index = 0; index < MAX_PERIOD_EMPLOYEES; index += 1) {
    await call(world, "mutation", "hr/setup:saveEmployee", {
      requestId: requestId(),
      warehouseId: world.warehouses.alphaA,
      code: `L${index}`,
      displayName: `Limit ${index}`,
      employmentStartDate: "2026-01-05",
      status: "ACTIVE",
    });
  }
  const roster = await call(world, "query", "hr/roster:roster", {
    warehouseId: world.warehouses.alphaA,
    month: "2026-10",
  });
  expect(roster.employees).toHaveLength(MAX_PERIOD_EMPLOYEES);
  const cells = roster.employees.flatMap(
    (row: { id: string; cells: { date: string; revision: number }[] }) =>
      row.cells.map((cell) => ({
        employeeId: row.id,
        date: cell.date,
        expectedRevision: cell.revision,
      })),
  );
  expect(cells).toHaveLength(MAX_ROSTER_CELLS);
  const saved = await call(world, "mutation", "hr/roster:assignRoster", {
    requestId: requestId(),
    warehouseId: world.warehouses.alphaA,
    action: { kind: "OFF" },
    cells,
  });
  expect(saved).toMatchObject({ written: true });
  // Updating the maximum also stays within production limits (including
  // tenant ownership reads). A stale last cell refuses the entire batch.
  const args = {
    warehouseId: world.warehouses.alphaA,
    action: { kind: "CLEAR" },
    cells: cells.map((cell: { expectedRevision: number }) => ({
      ...cell,
      expectedRevision: 1,
    })),
  };
  const invalid = await call(world, "mutation", "hr/roster:assignRoster", {
    ...args,
    requestId: requestId(),
    cells: [
      ...args.cells.slice(0, -1),
      { ...args.cells.at(-1), expectedRevision: 0 },
    ],
  });
  expect(invalid).toMatchObject({
    written: false,
    error: { code: "ROSTER_STALE" },
  });
  const unchanged = await world.t.run((ctx) =>
    ctx.db.query("hrRosterAssignments").collect(),
  );
  expect(unchanged).toHaveLength(1550);
  expect(
    unchanged.every((row) => row.revision === 1 && row.kind === "OFF"),
  ).toBe(true);
  const updated = await call(world, "mutation", "hr/roster:assignRoster", {
    ...args,
    requestId: requestId(),
  });
  expect(updated).toMatchObject({ written: true });
  const rows = await world.t.run((ctx) =>
    ctx.db.query("hrRosterAssignments").collect(),
  );
  expect(rows).toHaveLength(1550);
  expect(
    rows.every((row) => row.revision === 2 && row.kind === "CLEARED"),
  ).toBe(true);
});
