import type { GenericMutationCtx } from "convex/server";
import { describe, expect, it } from "vitest";

import {
  clock,
  decideLeave,
  listTeamInbox,
  readMyHr,
  requestLeave,
} from "../../convex/hr/attendance";
import type { DataModel } from "../../convex/schema";
import { createConvexInventoryWorld } from "../fixtures/convex-inventory-world";
import { seedSecondActorForOrgA } from "../fixtures/convex-tenant-world";

interface RuntimeFunction {
  readonly _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
}

const employeeIdentity = {
  subject: "user_fixture_a",
  org_id: "org_fixture_a",
};

async function call(
  world: Awaited<ReturnType<typeof createConvexInventoryWorld>>,
  fn: unknown,
  args: unknown,
  identity = employeeIdentity,
): Promise<Record<string, unknown>> {
  return (await world.t
    .withIdentity(identity)
    .run(async (ctx) =>
      (fn as RuntimeFunction)._handler(
        ctx as GenericMutationCtx<DataModel>,
        args,
      ),
    )) as Record<string, unknown>;
}

const value = (outcome: Record<string, unknown>) => {
  expect(outcome["ok"], JSON.stringify(outcome)).toBe(true);
  return outcome["value"] as Record<string, unknown>;
};

describe("HR attendance and leave runtime", () => {
  it("deduplicates clock retry and keeps private leave context out of the team inbox", async () => {
    const world = await createConvexInventoryWorld({}, { roleA: "ORG_ADMIN" });
    const supervisor = await seedSecondActorForOrgA(world, "SUPERVISOR");
    await world.t.run(async (ctx) => {
      const supervisorEmployeeId = await ctx.db.insert("employees", {
        orgId: world.orgA,
        employeeNumber: "EMP-SUP-001",
        userId: supervisor.userId,
        displayName: "Supervisor One",
        warehouseId: world.warehouses.alphaA,
        status: "ACTIVE",
        startedOn: "2026-01-01",
        createdByUserId: supervisor.userId,
        createdAt: 1,
      });
      const teamId = await ctx.db.insert("hrTeams", {
        orgId: world.orgA,
        code: "TEAM-A",
        name: "Team A",
        warehouseId: world.warehouses.alphaA,
        supervisorEmployeeId,
        status: "ACTIVE",
        createdByUserId: supervisor.userId,
        createdAt: 1,
      });
      await ctx.db.patch("employees", supervisorEmployeeId, { teamId });
      await ctx.db.insert("employees", {
        orgId: world.orgA,
        employeeNumber: "EMP-001",
        userId: world.userA,
        displayName: "Employee One",
        warehouseId: world.warehouses.alphaA,
        teamId,
        supervisorEmployeeId,
        status: "ACTIVE",
        startedOn: "2026-01-01",
        createdByUserId: supervisor.userId,
        createdAt: 1,
      });
    });

    const clockArgs = {
      requestId: "hr-clock-0001",
      warehouseId: world.warehouses.alphaA,
      kind: "CLOCK_IN",
      deviceOccurredAt: Date.now() - 500,
    };
    const firstClock = value(await call(world, clock, clockArgs));
    expect(firstClock).toMatchObject({ written: true, replayed: false });
    expect(value(await call(world, clock, clockArgs))).toMatchObject({
      written: true,
      replayed: true,
      documentId: firstClock["documentId"],
    });

    const leave = value(
      await call(world, requestLeave, {
        requestId: "hr-leave-0001",
        warehouseId: world.warehouses.alphaA,
        startDate: "2026-09-01",
        endDate: "2026-09-01",
        leaveType: "SICK",
        durationKind: "FULL_DAY",
        privateReason: "Private medical context",
      }),
    );
    expect(leave).toMatchObject({ written: true, replayed: false });

    const supervisorIdentity = {
      subject: supervisor.clerkUserId,
      org_id: "org_fixture_a",
    };
    const inbox = value(
      await call(
        world,
        listTeamInbox,
        { warehouseId: world.warehouses.alphaA },
        supervisorIdentity,
      ),
    );
    expect(inbox["items"]).toEqual([
      expect.objectContaining({
        kind: "LEAVE",
        employeeNumber: "EMP-001",
        summary: "2026-09-01 – 2026-09-01",
      }),
    ]);
    expect(JSON.stringify(inbox)).not.toContain("Private medical context");
    expect(JSON.stringify(inbox)).not.toContain("SICK");

    expect(
      value(
        await call(
          world,
          decideLeave,
          {
            requestId: "hr-leave-decision-0001",
            warehouseId: world.warehouses.alphaA,
            leaveRequestId: leave["documentId"],
            decision: "APPROVE",
            note: "Coverage confirmed",
          },
          supervisorIdentity,
        ),
      ),
    ).toMatchObject({ written: true });

    const mine = value(await call(world, readMyHr, {}));
    expect(mine).toMatchObject({ found: true });
    expect(JSON.stringify(mine)).toContain("Private medical context");
    expect(JSON.stringify(mine)).toContain("APPROVED");
  });
});
