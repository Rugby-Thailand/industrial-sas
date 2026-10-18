/**
 * Kiro HR UX-flow probe — employee setup with real registered handlers.
 *
 * The admin links an organization member and assigns a supervisor through
 * `hr/setup:saveEmployee`. Neither person holds an HR role. The probe asserts
 * the expected outcome of a complete setup step: the linked member can open
 * HR self-service, or the admin-facing member options disclose that access is
 * still missing. A failure on current source is the evidence.
 *
 * Fixture data lives only in convex-test's in-memory database.
 * Run: pnpm exec vitest run --config docs/reviews/ux-flow-kiro-2026-10-15/hr/probes/vitest.config.mts hr-setup
 */
import type { GenericMutationCtx } from "convex/server";
import type { GenericId } from "convex/values";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import * as access from "../../../../../convex/hr/access";
import * as review from "../../../../../convex/hr/review";
import * as self from "../../../../../convex/hr/self";
import * as setup from "../../../../../convex/hr/setup";
import type { DataModel } from "../../../../../convex/schema";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../../../../../tests/fixtures/convex-tenant-world";

interface RuntimeFunction {
  readonly _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
}
type Outcome = { ok: boolean; value?: Record<string, any> };

const EMPLOYEE = "user_fixture_a"; // seeded with a storage-only role
const ADMIN = "user_probe_hr_admin";
const SUPERVISOR = "user_probe_line_lead";

async function call(
  world: ConvexTenantWorld,
  fn: unknown,
  args: unknown,
  subject: string,
): Promise<Outcome> {
  return (await world.t
    .withIdentity({ subject, org_id: "org_fixture_a" })
    .run((ctx) =>
      (fn as RuntimeFunction)._handler(
        ctx as GenericMutationCtx<DataModel>,
        args,
      ),
    )) as Outcome;
}

async function addMember(
  world: ConvexTenantWorld,
  clerkUserId: string,
  roleKey: string,
) {
  return await world.t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      clerkUserId,
      displayName: clerkUserId.replace("user_probe_", ""),
      status: "ACTIVE",
    });
    const membershipId = await ctx.db.insert("memberships", {
      orgId: world.orgA,
      userId,
      clerkMembershipId: `orgmem_${clerkUserId}`,
      status: "ACTIVE",
      scopeMode: "ORG_WIDE",
      effectiveFrom: 0,
    });
    const role = await ctx.db
      .query("roles")
      .withIndex("by_orgId_key", (q) =>
        q.eq("orgId", world.orgA).eq("key", roleKey),
      )
      .unique();
    await ctx.db.insert("membershipRoles", {
      orgId: world.orgA,
      membershipId,
      roleId: role!._id,
      grantedAt: 0,
    });
    return userId;
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.parse("2026-10-15T09:00:00+07:00"));
});
afterEach(() => vi.useRealTimers());

it("K-UX-HR-01 expected: linking an account and supervisor completes HR setup or tells the admin what is missing", async () => {
  const world = await createConvexTenantWorld();
  // A real planner role (storage only) for the employee's account.
  await seedConvexAuthorization(world, { roleA: "SUPERVISOR" });
  await addMember(world, ADMIN, "HR_ADMIN");
  const lineLead = await addMember(world, SUPERVISOR, "WAREHOUSE_MANAGER");

  const options = await call(world, setup.memberOptions, {}, ADMIN);
  const option = (options.value?.items as Record<string, unknown>[]).find(
    (item) => item.userId === world.userA,
  )!;
  const saved = await call(
    world,
    setup.saveEmployee,
    {
      requestId: "probe-link-0001",
      warehouseId: world.warehouses.alphaA,
      code: "EMP-101",
      displayName: "Linked worker",
      userId: world.userA,
      supervisorUserId: lineLead,
      employmentStartDate: "2026-10-01",
      status: "ACTIVE",
      schedule: {
        workDays: [1, 2, 3, 4, 5],
        startTime: "08:30",
        endTime: "17:30",
        endsNextDay: false,
        breakMinutes: 60,
      },
    },
    ADMIN,
  );
  const employeeAccess = await call(world, access.current, {}, EMPLOYEE);
  const employeeToday = await call(world, self.today, {}, EMPLOYEE);
  const supervisorQueue = await call(
    world,
    review.queue,
    { from: "2026-10-01", to: "2026-10-15" },
    SUPERVISOR,
  );
  const facts = {
    saveWritten: saved.value?.written,
    memberOptionKeys: Object.keys(option).sort(),
    employeeAccessOk: employeeAccess.ok,
    employeeTodayOk: employeeToday.ok,
    supervisorQueueOk: supervisorQueue.ok,
  };
  expect(saved.value?.written, JSON.stringify(saved)).toBe(true);
  const disclosed = Object.keys(option).some((key) =>
    /access|role|permission/i.test(key),
  );
  // Either the linked member can actually use self-service, or the admin's
  // selector says the account lacks it. Today neither holds.
  expect(employeeAccess.ok || disclosed, JSON.stringify(facts)).toBe(true);
  // The assigned supervisor likewise cannot review without a separate grant.
  expect(supervisorQueue.ok || disclosed, JSON.stringify(facts)).toBe(true);
});

it("control: the same member can open HR once the separate Settings grant is made", async () => {
  const world = await createConvexTenantWorld();
  await seedConvexAuthorization(world, { roleA: "SUPERVISOR" });
  await addMember(world, ADMIN, "HR_ADMIN");
  const members = await call(world, setup.accessMembers, {}, ADMIN);
  expect(members.ok, JSON.stringify(members)).toBe(true);
  const granted = await call(
    world,
    setup.setMemberAccess,
    {
      requestId: "probe-grant-0001",
      userId: world.userA as GenericId<"users">,
      role: "HR_EMPLOYEE",
      granted: true,
    },
    ADMIN,
  );
  expect(granted.value?.written, JSON.stringify(granted)).toBe(true);
  const employeeAccess = await call(world, access.current, {}, EMPLOYEE);
  expect(employeeAccess.ok, JSON.stringify(employeeAccess)).toBe(true);
});
