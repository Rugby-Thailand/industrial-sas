import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import { fromLocal } from "../../convex/model/hr/calendar";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";

const DATE = "2026-10-05";
const at = (date: string, minute: number) => fromLocal(date, minute, 420);
const OPERATION = "hr.attendance.clockIn";
const actor = (
  w: ConvexTenantWorld,
  subject = "user_fixture_a",
  org = "org_fixture_a",
) => w.t.withIdentity({ subject, org_id: org });

async function world() {
  const w = await createConvexTenantWorld({
    "../convex/hr/self.ts": () => import("../../convex/hr/self"),
    "../convex/hr/recovery.ts": () => import("../../convex/hr/recovery"),
  });
  await seedConvexAuthorization(w, {
    roleA: "HR_EMPLOYEE",
    roleB: "HR_EMPLOYEE",
  });
  await w.t.run(async (ctx) => {
    await ctx.db.insert("hrEmployees", {
      orgId: w.orgA,
      warehouseId: w.warehouses.alphaA,
      code: "EMP-RECOVERY",
      displayName: "Worker",
      userId: w.userA,
      employmentStartDate: "2026-01-01",
      status: "ACTIVE",
      schedule: {
        workDays: [1, 2, 3, 4, 5],
        startTime: "08:30",
        endTime: "17:30",
        endsNextDay: false,
        breakMinutes: 60,
      },
      version: 1,
      createdAt: 1,
      updatedAt: 1,
      createdByUserId: w.userA,
      updatedByUserId: w.userA,
    });
    const userId = await ctx.db.insert("users", {
      clerkUserId: "user_other_actor",
      displayName: "Other actor",
      status: "ACTIVE",
    });
    const membershipId = await ctx.db.insert("memberships", {
      orgId: w.orgA,
      userId,
      clerkMembershipId: "member_other_actor",
      status: "ACTIVE",
      scopeMode: "ORG_WIDE",
      effectiveFrom: 0,
    });
    const role = await ctx.db
      .query("roles")
      .withIndex("by_orgId_key", (q) =>
        q.eq("orgId", w.orgA).eq("key", "HR_EMPLOYEE"),
      )
      .unique();
    await ctx.db.insert("membershipRoles", {
      orgId: w.orgA,
      membershipId,
      roleId: role!._id,
      grantedAt: 0,
    });
  });
  return w;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at(DATE, 510));
});
afterEach(() => vi.useRealTimers());

describe("HR uncertain request reconciliation", () => {
  it("returns only COMMITTED when the original commits before reconciliation and retains exact replay", async () => {
    const w = await world();
    const command = {
      requestId: "committed-before-recovery",
      expectedBusinessDate: DATE,
    };
    const original = await actor(w).mutation(api.hr.self.clockIn, command);
    expect(original).toMatchObject({
      ok: true,
      value: { written: true, businessDate: DATE },
    });
    expect(
      await actor(w).mutation(api.hr.recovery.reconcileRequest, {
        operation: OPERATION,
        requestId: command.requestId,
      }),
    ).toMatchObject({
      ok: true,
      value: { resolved: true, status: "COMMITTED" },
    });
    vi.setSystemTime(at("2026-10-06", 600));
    expect(await actor(w).mutation(api.hr.self.clockIn, command)).toMatchObject(
      {
        ok: true,
        value: {
          written: true,
          replayed: true,
          businessDate: DATE,
          occurredAt: at(DATE, 510),
        },
      },
    );
    expect(
      await w.t.run((ctx) => ctx.db.query("hrAttendanceEvents").collect()),
    ).toHaveLength(1);
  });

  it("atomically fences an absent original and prevents any later old-ID write", async () => {
    const w = await world();
    const requestId = "fence-before-original";
    const recovery = { operation: OPERATION, requestId };
    expect(
      await actor(w).mutation(api.hr.recovery.reconcileRequest, recovery),
    ).toMatchObject({ ok: true, value: { resolved: true, status: "FENCED" } });
    expect(
      await actor(w).mutation(api.hr.recovery.reconcileRequest, recovery),
    ).toMatchObject({ ok: true, value: { resolved: true, status: "FENCED" } });
    expect(
      await actor(w).mutation(api.hr.self.clockIn, { requestId }),
    ).toMatchObject({
      ok: true,
      value: { written: false, error: { code: "REQUEST_RETIRED" } },
    });
    expect(
      await actor(w).mutation(api.hr.self.clockIn, {
        requestId,
        expectedBusinessDate: DATE,
      }),
    ).toMatchObject({
      ok: true,
      value: { written: false, error: { code: "REQUEST_RETIRED" } },
    });
    expect(
      await w.t.run((ctx) => ctx.db.query("hrAttendanceEvents").collect()),
    ).toHaveLength(0);
    const [fence] = await w.t.run((ctx) =>
      ctx.db.query("idempotencyRecords").collect(),
    );
    expect(fence).toMatchObject({
      actorUserId: w.userA,
      expiresAt: Number.MAX_SAFE_INTEGER,
    });
    expect(
      await actor(w).mutation(api.hr.self.clockIn, {
        requestId: "explicit-fresh-after-fence",
        expectedBusinessDate: DATE,
      }),
    ).toMatchObject({ ok: true, value: { written: true, businessDate: DATE } });
  });

  it("keeps fences scoped to the actor and tenant and never reveals another actor's receipt", async () => {
    const w = await world();
    const requestId = "actor-tenant-scoped-fence";
    expect(
      await actor(w, "user_other_actor").mutation(
        api.hr.recovery.reconcileRequest,
        { operation: OPERATION, requestId },
      ),
    ).toMatchObject({ ok: true, value: { resolved: true, status: "FENCED" } });
    expect(
      await actor(w, "user_fixture_a", "org_fixture_b").mutation(
        api.hr.recovery.reconcileRequest,
        { operation: OPERATION, requestId },
      ),
    ).toMatchObject({ ok: true, value: { resolved: true, status: "FENCED" } });
    expect(
      await actor(w).mutation(api.hr.self.clockIn, {
        requestId,
        expectedBusinessDate: DATE,
      }),
    ).toMatchObject({ ok: true, value: { written: true } });
    const denied = await actor(w, "user_other_actor").mutation(
      api.hr.recovery.reconcileRequest,
      { operation: OPERATION, requestId },
    );
    expect(denied).toMatchObject({
      ok: true,
      value: { resolved: false, code: "NOT_FOUND" },
    });
    expect(denied).not.toHaveProperty("value.documentId");
    expect(denied).not.toHaveProperty("value.businessDate");
    expect(
      await actor(w).mutation(api.hr.recovery.reconcileRequest, {
        operation: OPERATION,
        requestId,
      }),
    ).toMatchObject({
      ok: true,
      value: { resolved: true, status: "COMMITTED" },
    });
  });

  it("refuses unauthorized operations and malformed request IDs before recording a fence", async () => {
    const w = await world();
    expect(
      await actor(w).mutation(api.hr.recovery.reconcileRequest, {
        operation: "hr.employee.save",
        requestId: "cannot-recover-admin",
      }),
    ).toMatchObject({
      ok: true,
      value: { resolved: false, code: "PERMISSION_DENIED" },
    });
    expect(
      await actor(w).mutation(api.hr.recovery.reconcileRequest, {
        operation: "storageLayouts.save",
        requestId: "cannot-recover-other",
      }),
    ).toMatchObject({
      ok: true,
      value: { resolved: false, code: "OPERATION_INVALID" },
    });
    expect(
      await actor(w).mutation(api.hr.recovery.reconcileRequest, {
        operation: OPERATION,
        requestId: "bad",
      }),
    ).toMatchObject({
      ok: true,
      value: { resolved: false, code: "REQUEST_IDENTITY_INVALID" },
    });
    expect(
      await w.t.run((ctx) => ctx.db.query("idempotencyRecords").collect()),
    ).toHaveLength(0);
  });
});

describe("HR clock command business-date ownership", () => {
  it("refuses an uncommitted prior-day clock-in rather than applying it on the new day", async () => {
    const w = await world();
    vi.setSystemTime(at("2026-10-06", 510));
    expect(
      await actor(w).mutation(api.hr.self.clockIn, {
        requestId: "prior-day-uncommitted",
        expectedBusinessDate: DATE,
      }),
    ).toMatchObject({
      ok: true,
      value: { written: false, error: { code: "HR_CLOCK_DAY_CHANGED" } },
    });
    expect(
      await w.t.run((ctx) => ctx.db.query("hrAttendanceEvents").collect()),
    ).toHaveLength(0);
  });

  it("refuses a clock-out whose captured date differs from the selected open day", async () => {
    const w = await world();
    await actor(w).mutation(api.hr.self.clockIn, {
      requestId: "correct-date-clock-in",
      expectedBusinessDate: DATE,
    });
    vi.setSystemTime(at(DATE, 1050));
    expect(
      await actor(w).mutation(api.hr.self.clockOut, {
        requestId: "wrong-date-clock-out",
        expectedBusinessDate: "2026-10-06",
      }),
    ).toMatchObject({
      ok: true,
      value: { written: false, error: { code: "HR_CLOCK_DAY_CHANGED" } },
    });
    expect(
      await actor(w).mutation(api.hr.self.clockOut, {
        requestId: "correct-date-clock-out",
        expectedBusinessDate: DATE,
      }),
    ).toMatchObject({ ok: true, value: { written: true, businessDate: DATE } });
  });

  it("preserves legacy empty-payload idempotent clock replay", async () => {
    const w = await world();
    const command = { requestId: "legacy-clock-command" };
    expect(await actor(w).mutation(api.hr.self.clockIn, command)).toMatchObject(
      { ok: true, value: { written: true } },
    );
    vi.setSystemTime(at("2026-10-06", 510));
    expect(await actor(w).mutation(api.hr.self.clockIn, command)).toMatchObject(
      {
        ok: true,
        value: { written: true, replayed: true, businessDate: DATE },
      },
    );
  });
});
