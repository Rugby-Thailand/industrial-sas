import type { GenericMutationCtx } from "convex/server";
import type { GenericId } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as access from "../../convex/hr/access";
import * as review from "../../convex/hr/review";
import * as setup from "../../convex/hr/setup";
import type { DataModel } from "../../convex/schema";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";

/**
 * K-UX-HR-01: linking an account and a supervisor never grants HR access by
 * itself. The registry reports which linked member still lacks the role the
 * link needs, so the administrator can hand off to Settings > HR access, and
 * the report follows the separate, explicit grant.
 */

interface RuntimeFunction {
  readonly _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
}
type Outcome = { ok: boolean; value?: Record<string, any> };

const EMPLOYEE = "user_fixture_a"; // seeded with a storage-only role
const ADMIN = "user_handoff_hr_admin";
const LEAD = "user_handoff_line_lead";

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
      displayName: clerkUserId.replace("user_handoff_", ""),
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

describe("employee setup HR access handoff", () => {
  it("reports a linked account and supervisor without HR roles until Settings grants them", async () => {
    const world = await createConvexTenantWorld();
    await seedConvexAuthorization(world, { roleA: "SUPERVISOR" });
    await addMember(world, ADMIN, "HR_ADMIN");
    const lead = await addMember(world, LEAD, "WAREHOUSE_MANAGER");

    const saved = await call(
      world,
      setup.saveEmployee,
      {
        requestId: "handoff-link-0001",
        warehouseId: world.warehouses.alphaA,
        code: "EMP-101",
        displayName: "Linked worker",
        userId: world.userA,
        supervisorUserId: lead,
        employmentStartDate: "2026-10-01",
        status: "ACTIVE",
      },
      ADMIN,
    );
    expect(saved.value?.written, JSON.stringify(saved)).toBe(true);
    const employeeId = saved.value!.documentId as string;

    // Saving the link granted nothing.
    expect((await call(world, access.display, {}, EMPLOYEE)).ok).toBe(false);
    expect(
      (
        await call(
          world,
          review.queue,
          { from: "2026-10-01", to: "2026-10-15" },
          LEAD,
        )
      ).ok,
    ).toBe(false);

    const editor = async () =>
      (await call(world, setup.employee, { employeeId }, ADMIN)).value!
        .employee as Record<string, unknown>;
    const row = async () =>
      (
        (await call(world, setup.employeesPage, { pageSize: 20 }, ADMIN)).value!
          .page as Record<string, unknown>[]
      ).find((item) => item.id === employeeId)!;
    for (const item of [await editor(), await row()])
      expect(item).toMatchObject({
        linkedActive: true,
        linkedSelfAccess: false,
        supervisorReviewAccess: false,
      });

    const grant = (
      userId: GenericId<"users">,
      role: "HR_EMPLOYEE" | "HR_SUPERVISOR",
      requestId: string,
    ) =>
      call(
        world,
        setup.setMemberAccess,
        { requestId, userId, role, granted: true },
        ADMIN,
      );
    expect(
      (await grant(world.userA, "HR_EMPLOYEE", "handoff-grant-0001")).value
        ?.written,
    ).toBe(true);
    expect(await editor()).toMatchObject({
      linkedSelfAccess: true,
      supervisorReviewAccess: false,
    });
    expect((await call(world, access.display, {}, EMPLOYEE)).ok).toBe(true);

    expect(
      (await grant(lead, "HR_SUPERVISOR", "handoff-grant-0002")).value?.written,
    ).toBe(true);
    for (const item of [await editor(), await row()])
      expect(item).toMatchObject({
        linkedSelfAccess: true,
        supervisorReviewAccess: true,
      });
  });

  it("omits access facts for an unlinked employee and never exposes them to the employee", async () => {
    const world = await createConvexTenantWorld();
    await seedConvexAuthorization(world, { roleA: "SUPERVISOR" });
    await addMember(world, ADMIN, "HR_ADMIN");
    const saved = await call(
      world,
      setup.saveEmployee,
      {
        requestId: "handoff-unlinked-0001",
        warehouseId: world.warehouses.alphaA,
        code: "EMP-102",
        displayName: "Paper worker",
        employmentStartDate: "2026-10-01",
        status: "ACTIVE",
      },
      ADMIN,
    );
    const employeeId = saved.value!.documentId as string;
    const item = (await call(world, setup.employee, { employeeId }, ADMIN))
      .value!.employee as Record<string, unknown>;
    expect(item).not.toHaveProperty("linkedSelfAccess");
    expect(item).not.toHaveProperty("supervisorReviewAccess");
    // The registry stays an HR administrator read.
    expect(
      (await call(world, setup.employee, { employeeId }, EMPLOYEE)).ok,
    ).toBe(false);
  });
});
