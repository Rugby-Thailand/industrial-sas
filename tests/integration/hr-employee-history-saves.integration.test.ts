import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../convex/_generated/dataModel";
import * as setup from "../../convex/hr/setup";
import { fromLocal } from "../../convex/model/hr/calendar";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";
import { meteredCall } from "../fixtures/hr-read-meter";

/**
 * The employee change history through real saves: authorization audit rows,
 * idempotent replays, denied attempts and no-op saves share the employee's
 * audit range, yet every actual change stays reachable, newest first, with
 * full pages.
 */

const ADMIN = { subject: "user_fixture_a", org_id: "org_fixture_a" };

type Answer = { ok: true; value: any };
const run = (world: ConvexTenantWorld, fn: unknown, args: unknown) =>
  meteredCall<Answer>(world, fn, args, ADMIN).then(({ outcome }) => {
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
    return outcome.value;
  });

async function readAll(world: ConvexTenantWorld, employeeId: string) {
  const pages: { at: number; changes: { field: string; to?: string }[] }[][] =
    [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 50; guard += 1) {
    let scanCursor: string | undefined;
    let page: any;
    for (let scan = 0; scan < 50; scan += 1) {
      page = await run(world, setup.employeeHistoryPage, {
        employeeId,
        pageSize: 20,
        ...(cursor ? { cursor } : {}),
        ...(scanCursor ? { scanCursor } : {}),
      });
      if (page.status !== "scanning") break;
      scanCursor = page.scanCursor;
    }
    expect(page.status).toBe("ready");
    pages.push(page.page);
    if (page.isDone) return pages;
    cursor = page.continueCursor;
  }
  throw new Error("history did not finish");
}

describe("employee change history with real saves", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(fromLocal("2026-10-13", 9 * 60, 420));
  });
  afterEach(() => vi.useRealTimers());

  it("reaches every actual change past replays, denials and no-op saves", async () => {
    const world = await createConvexTenantWorld();
    await seedConvexAuthorization(world, {
      roleA: "HR_ADMIN",
      roleB: "HR_ADMIN",
    });
    const base = {
      warehouseId: world.warehouses.alphaA,
      code: "EMP-001",
      employmentStartDate: "2026-01-01",
      status: "ACTIVE" as const,
    };
    const created = await run(world, setup.saveEmployee, {
      ...base,
      requestId: "create-employee",
      displayName: "Name 0",
    });
    expect(created).toMatchObject({ written: true });
    const employeeId = created.documentId as Id<"hrEmployees">;
    let version = 1;
    const tick = () => vi.advanceTimersByTime(1_000);
    for (let index = 1; index <= 24; index += 1) {
      tick();
      const save = {
        ...base,
        employeeId,
        expectedVersion: version,
        displayName: `Name ${index}`,
        requestId: `rename-${index}-request`,
      };
      expect(await run(world, setup.saveEmployee, save)).toMatchObject({
        written: true,
        replayed: false,
      });
      version += 1;
      tick();
      // Replay of the same request: an authorization row, no new change.
      expect(await run(world, setup.saveEmployee, save)).toMatchObject({
        replayed: true,
      });
      tick();
      // A stale save is denied.
      expect(
        await run(world, setup.saveEmployee, {
          ...save,
          expectedVersion: version - 1,
          requestId: `stale-${index}-request`,
        }),
      ).toMatchObject({ written: false, error: { code: "EMPLOYEE_STALE" } });
      tick();
      // A save without changes is allowed but has nothing to show.
      expect(
        await run(world, setup.saveEmployee, {
          ...save,
          expectedVersion: version,
          requestId: `noop-${index}-request`,
        }),
      ).toMatchObject({ written: true });
      version += 1;
    }
    const pages = await readAll(world, employeeId);
    const rows = pages.flat();
    // Creation plus 24 renames, nothing else, newest first, full first page.
    expect(rows).toHaveLength(25);
    expect(pages[0]).toHaveLength(20);
    expect(rows.map((row) => row.at)).toEqual(
      [...rows.map((row) => row.at)].sort((a, b) => b - a),
    );
    expect(
      rows
        .slice(0, 24)
        .map((row) => row.changes.find((c) => c.field === "displayName")?.to),
    ).toEqual(
      Array.from({ length: 24 }, (_, i) => JSON.stringify(`Name ${24 - i}`)),
    );
  });
});
