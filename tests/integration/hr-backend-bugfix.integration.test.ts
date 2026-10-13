import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import * as review from "../../convex/hr/review";
import * as leave from "../../convex/hr/leave";
import { thailandDefaults } from "../../convex/model/hr/policy";
import { meteredCall } from "../fixtures/hr-read-meter";
import { fromLocal } from "../../convex/model/hr/calendar";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";

const DATE = "2026-10-05";
const at = (date: string, minute: number) => fromLocal(date, minute, 420);
const schedule = {
  workDays: [1, 2, 3, 4, 5],
  startTime: "08:30",
  endTime: "17:30",
  endsNextDay: false,
  breakMinutes: 60,
};

async function world(roleA = "HR_ADMIN") {
  const w = await createConvexTenantWorld({
    "../convex/hr/leave.ts": () => import("../../convex/hr/leave"),
    "../convex/hr/setup.ts": () => import("../../convex/hr/setup"),
    "../convex/hr/review.ts": () => import("../../convex/hr/review"),
    "../convex/hr/periods.ts": () => import("../../convex/hr/periods"),
    "../convex/hr/self.ts": () => import("../../convex/hr/self"),
    "../convex/hr/recovery.ts": () => import("../../convex/hr/recovery"),
    "../convex/hr/search.ts": () => import("../../convex/hr/search"),
  });
  await seedConvexAuthorization(w, { roleA, roleB: "HR_EMPLOYEE" });
  return w;
}

const actor = (w: ConvexTenantWorld) =>
  w.t.withIdentity({ subject: "user_fixture_a", org_id: "org_fixture_a" });
const draft = (w: ConvexTenantWorld) => ({
  warehouseId: w.warehouses.alphaA,
  code: "EMP-001",
  displayName: "Worker",
  employmentStartDate: "2026-01-01",
  status: "ACTIVE" as const,
  schedule,
});

async function employee(w: ConvexTenantWorld, linked = true) {
  const result = await actor(w).mutation(api.hr.setup.saveEmployee, {
    requestId: "create-employee",
    ...draft(w),
    ...(linked ? { userId: w.userA } : {}),
  });
  expect(result).toMatchObject({ ok: true, value: { written: true } });
  if (!result.ok || !result.value.written) throw new Error("Create failed");
  return result.value.documentId as Id<"hrEmployees">;
}

async function savedDraft(w: ConvexTenantWorld, id: Id<"hrEmployees">) {
  const stored = await w.t.run((ctx) => ctx.db.get(id));
  if (!stored) throw new Error("Missing employee");
  return {
    ...draft(w),
    employeeId: id,
    expectedVersion: stored.version,
    ...(stored.userId ? { userId: stored.userId } : {}),
  };
}

async function dispose(w: ConvexTenantWorld, employeeId: Id<"hrEmployees">) {
  return actor(w).mutation(api.hr.review.disposeDay, {
    requestId: "dispose-day",
    employeeId,
    businessDate: DATE,
    expectedRevision: 0,
    disposition: "WORKED",
    start: { minute: 510, nextDay: false },
    end: { minute: 1050, nextDay: false },
    reason: "Verified the missing clock events",
  });
}

async function formerWorkers(w: ConvexTenantWorld, count: number) {
  await w.t.run(async (ctx) => {
    for (let index = 0; index < count; index += 1) {
      await ctx.db.insert("hrEmployees", {
        orgId: w.orgA,
        ...draft(w),
        code: `FORMER-${String(index).padStart(5, "0")}`,
        employmentStartDate: "2020-01-01",
        employmentEndDate: "2020-12-31",
        status: "INACTIVE",
        version: 1,
        createdAt: 1,
        updatedAt: 1,
        createdByUserId: w.userA,
        updatedByUserId: w.userA,
      });
    }
  });
}

async function pendingLeave(
  w: ConvexTenantWorld,
  employeeId: Id<"hrEmployees">,
) {
  return await w.t.run(async (ctx) => {
    const config = thailandDefaults();
    const policyVersionId = await ctx.db.insert("hrPolicyVersions", {
      orgId: w.orgA,
      capability: "LEAVE",
      config,
      effectiveDate: "2026-01-01",
      version: 1,
      draftVersion: 1,
      preset: "test",
      coverageConfirmed: true,
      existingBenefitsReviewed: true,
      activatedAt: 1,
      activatedByUserId: w.userA,
    });
    return await ctx.db.insert("hrLeaveRequests", {
      orgId: w.orgA,
      employeeId,
      warehouseId: w.warehouses.alphaA,
      type: "ANNUAL",
      from: DATE,
      to: DATE,
      dates: [DATE],
      days: 1,
      paidDays: 1,
      payPercent: 100,
      reason: "Family leave",
      policyVersionId,
      policyConfig: config,
      daySnapshots: [
        {
          date: DATE,
          revision: 0,
          scheduled: false,
          plan: { kind: "NONWORKING", reason: "UNSCHEDULED", breakMinutes: 0 },
        },
      ],
      status: "PENDING",
      version: 1,
      history: [{ action: "SUBMITTED", actorUserId: w.userA, at: 1 }],
      submittedAt: 1,
      updatedAt: 1,
    });
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at("2026-10-07", 600));
});
afterEach(() => vi.useRealTimers());

describe("HR self-review identity regressions", () => {
  it("protects an already-unlinked legacy employee using the exact retained save audit and persists that affiliation", async () => {
    const w = await world();
    const id = await employee(w);
    const { userId: _userId, ...unlinked } = await savedDraft(w, id);
    expect(
      await actor(w).mutation(api.hr.setup.saveEmployee, {
        requestId: "legacy-self-unlink",
        ...unlinked,
      }),
    ).toMatchObject({ ok: true, value: { written: true } });
    // Model the old deployment's schema: its existing save audit is retained,
    // while the newly introduced optional identity fields were never present.
    await w.t.run((ctx) =>
      ctx.db.patch(id, {
        reviewExcludedUserIds: undefined,
        reviewerUserIds: undefined,
      }),
    );
    expect(await dispose(w, id)).toMatchObject({
      ok: true,
      value: { written: false, error: { code: "SELF_REVIEW" } },
    });
    expect(
      await actor(w).query(api.hr.review.queue, { from: DATE, to: DATE }),
    ).toMatchObject({ ok: true, value: { ok: true, items: [] } });
    expect(
      await actor(w).query(api.hr.search.reviewEmployees, {
        text: "EMP-001",
        codes: ["EMP-001"],
      }),
    ).toMatchObject({ ok: true, value: { items: [], complete: true } });
    expect(
      await actor(w).mutation(api.hr.setup.saveEmployee, {
        requestId: "persist-legacy-affiliation",
        ...(await savedDraft(w, id)),
        displayName: "Updated worker name",
      }),
    ).toMatchObject({ ok: true, value: { written: true } });
    expect(await w.t.run((ctx) => ctx.db.get(id))).toMatchObject({
      reviewExcludedUserIds: [w.userA],
    });
    expect(await dispose(w, id)).toMatchObject({
      ok: true,
      value: { written: false, error: { code: "SELF_REVIEW" } },
    });
  });

  it("allows a legitimate first self-link on a legacy unlinked employee without prior review", async () => {
    const w = await world();
    const id = await employee(w, false);
    await w.t.run((ctx) =>
      ctx.db.patch(id, {
        reviewExcludedUserIds: undefined,
        reviewerUserIds: undefined,
      }),
    );
    expect(
      await actor(w).mutation(api.hr.setup.saveEmployee, {
        requestId: "legacy-first-legitimate-link",
        ...(await savedDraft(w, id)),
        userId: w.userA,
      }),
    ).toMatchObject({ ok: true, value: { written: true } });
    expect(await w.t.run((ctx) => ctx.db.get(id))).toMatchObject({
      userId: w.userA,
      reviewExcludedUserIds: [w.userA],
    });
  });

  it("refuses review and linkage and reports incomplete search when legacy identity history exceeds its bounded scan", async () => {
    const w = await world();
    const id = await employee(w, false);
    await w.t.run(async (ctx) => {
      await ctx.db.patch(id, {
        reviewExcludedUserIds: undefined,
        reviewerUserIds: undefined,
      });
      for (let index = 0; index < 10_000; index += 1) {
        await ctx.db.insert("auditEvents", {
          orgId: w.orgA,
          occurredAt: index,
          actorKind: "USER",
          actorUserId: w.userA,
          action: "hr.employee.save",
          permissionCode: "hr.admin.manage",
          entityTable: "hrEmployees",
          entityId: id,
          outcome: "ALLOWED",
          requestId: `legacy-audit-${index}`,
        });
      }
    });
    expect(await dispose(w, id)).toMatchObject({
      ok: true,
      value: { written: false, error: { code: "LIMIT_EXCEEDED" } },
    });
    expect(
      await actor(w).query(api.hr.review.queue, { from: DATE, to: DATE }),
    ).toMatchObject({ ok: true, value: { ok: false, code: "LIMIT_EXCEEDED" } });
    expect(
      await actor(w).query(api.hr.search.reviewEmployees, {
        text: "EMP-001",
        codes: ["EMP-001"],
      }),
    ).toMatchObject({ ok: true, value: { items: [], complete: false } });
    expect(
      await actor(w).mutation(api.hr.setup.saveEmployee, {
        requestId: "cannot-link-incomplete-legacy",
        ...(await savedDraft(w, id)),
        userId: w.userA,
      }),
    ).toMatchObject({
      ok: true,
      value: { written: false, error: { code: "LIMIT_EXCEEDED" } },
    });
  });

  it("retains a sole HR administrator's legitimate first self-link and blocks review after unlink", async () => {
    const w = await world();
    const id = await employee(w);
    const { userId: _userId, ...unlinked } = await savedDraft(w, id);
    expect(
      await actor(w).mutation(api.hr.setup.saveEmployee, {
        requestId: "unlink-self",
        ...unlinked,
      }),
    ).toMatchObject({ ok: true, value: { written: true } });
    expect(await dispose(w, id)).toMatchObject({
      ok: true,
      value: { written: false, error: { code: "SELF_REVIEW" } },
    });
    expect(
      await actor(w).query(api.hr.review.queue, { from: DATE, to: DATE }),
    ).toMatchObject({ ok: true, value: { ok: true, items: [] } });
    expect(
      await w.t.run((ctx) => ctx.db.query("hrAttendanceDays").collect()),
    ).toHaveLength(0);
  });

  it("prevents the reverse certify-then-self-link sequence while retaining ordinary linking", async () => {
    const w = await world();
    const id = await employee(w, false);
    expect(await dispose(w, id)).toMatchObject({
      ok: true,
      value: { written: true },
    });
    expect(
      await actor(w).mutation(api.hr.setup.saveEmployee, {
        requestId: "link-reviewed-self",
        ...(await savedDraft(w, id)),
        userId: w.userA,
      }),
    ).toMatchObject({
      ok: true,
      value: { written: false, error: { code: "EMPLOYEE_SELF_LINK_REVIEWED" } },
    });
    const secondMember = await w.t.run(async (ctx) => {
      const id = await ctx.db.insert("users", {
        clerkUserId: "user_other_worker",
        displayName: "Other worker",
        status: "ACTIVE",
      });
      await ctx.db.insert("memberships", {
        orgId: w.orgA,
        userId: id,
        clerkMembershipId: "other-worker-member",
        status: "ACTIVE",
        scopeMode: "ORG_WIDE",
        effectiveFrom: 0,
      });
      return id;
    });
    expect(
      await actor(w).mutation(api.hr.setup.saveEmployee, {
        requestId: "link-other-worker",
        ...(await savedDraft(w, id)),
        userId: secondMember,
      }),
    ).toMatchObject({ ok: true, value: { written: true } });
  });

  it("checks retained legacy certifications before allowing an actor to self-link", async () => {
    const w = await world();
    const id = await employee(w, false);
    await w.t.run((ctx) =>
      ctx.db.insert("hrAttendanceDays", {
        orgId: w.orgA,
        warehouseId: w.warehouses.alphaA,
        employeeId: id,
        businessDate: DATE,
        plan: { kind: "NONWORKING", reason: "UNSCHEDULED", breakMinutes: 0 },
        open: false,
        revision: 1,
        createdAt: 1,
        updatedAt: 1,
        certification: {
          disposition: "NONWORKING",
          revision: 1,
          reason: "Verified",
          decidedByUserId: w.userA,
          decidedAt: 1,
        },
      }),
    );
    expect(
      await actor(w).mutation(api.hr.setup.saveEmployee, {
        requestId: "link-legacy-reviewed-self",
        ...(await savedDraft(w, id)),
        userId: w.userA,
      }),
    ).toMatchObject({
      ok: true,
      value: { written: false, error: { code: "EMPLOYEE_SELF_LINK_REVIEWED" } },
    });
  });
});

describe("HR employment-range bounds", () => {
  it("creates and reviews a current period despite more than 99 former employees", async () => {
    const w = await world();
    await employee(w, false);
    await formerWorkers(w, 210);
    expect(
      await actor(w).mutation(api.hr.periods.create, {
        requestId: "current-period",
        warehouseId: w.warehouses.alphaA,
        startDate: DATE,
        endDate: DATE,
      }),
    ).toMatchObject({ ok: true, value: { written: true } });
    const result = await actor(w).query(api.hr.review.queue, {
      from: DATE,
      to: DATE,
    });
    expect(result).toMatchObject({ ok: true, value: { ok: true } });
    if (!result.ok || !result.value.ok) throw new Error("Queue failed");
    expect(result.value.items).toHaveLength(1);
  });

  it("still refuses periods over 50 employed people and over 31 days", async () => {
    const w = await world();
    await w.t.run(async (ctx) => {
      for (let index = 0; index < 51; index += 1) {
        await ctx.db.insert("hrEmployees", {
          orgId: w.orgA,
          ...draft(w),
          code: `CURRENT-${index}`,
          version: 1,
          createdAt: 1,
          updatedAt: 1,
          createdByUserId: w.userA,
          updatedByUserId: w.userA,
        });
      }
    });
    expect(
      await actor(w).mutation(api.hr.periods.create, {
        requestId: "over-employee-bound",
        warehouseId: w.warehouses.alphaA,
        startDate: DATE,
        endDate: DATE,
      }),
    ).toMatchObject({
      ok: true,
      value: {
        written: false,
        error: { code: "PERIOD_TOO_LARGE", reason: "EMPLOYEES" },
      },
    });
    expect(
      await actor(w).mutation(api.hr.periods.create, {
        requestId: "over-day-bound",
        warehouseId: w.warehouses.alphaA,
        startDate: "2026-09-01",
        endDate: "2026-10-02",
      }),
    ).toMatchObject({
      ok: true,
      value: { written: false, error: { code: "PERIOD_TOO_LARGE" } },
    });
  });

  it("refuses incomplete bounded directory reads instead of silently omitting employees", async () => {
    const w = await world();
    await employee(w, false);
    await formerWorkers(w, 10_000);
    expect(
      await actor(w).mutation(api.hr.periods.create, {
        requestId: "incomplete-directory",
        warehouseId: w.warehouses.alphaA,
        startDate: DATE,
        endDate: DATE,
      }),
    ).toMatchObject({
      ok: true,
      value: {
        written: false,
        error: { code: "PERIOD_TOO_LARGE", reason: "EMPLOYEES" },
      },
    });
    expect(
      await actor(w).query(api.hr.review.queue, { from: DATE, to: DATE }),
    ).toMatchObject({ ok: true, value: { ok: false, code: "LIMIT_EXCEEDED" } });
  });
});

it("returns identical personal request not-found results for malformed, absent, foreign, and other-employee IDs", async () => {
  const w = await world();
  const id = await employee(w);
  const ids = await w.t.run(async (ctx) => {
    const dayId = await ctx.db.insert("hrAttendanceDays", {
      orgId: w.orgA,
      warehouseId: w.warehouses.alphaA,
      employeeId: id,
      businessDate: DATE,
      plan: { kind: "NONWORKING", reason: "UNSCHEDULED", breakMinutes: 0 },
      open: false,
      revision: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    const fields: Omit<Doc<"hrCorrectionRequests">, "_id" | "_creationTime"> = {
      orgId: w.orgA,
      dayId,
      employeeId: id,
      warehouseId: w.warehouses.alphaA,
      businessDate: DATE,
      status: "RETURNED",
      proposedStartAt: at(DATE, 510),
      proposedEndAt: at(DATE, 1050),
      reason: "Forgot to clock",
      baseRevision: 1,
      version: 1,
      submittedByUserId: w.userA,
      submittedAt: 1,
      history: [],
    };
    const absent = await ctx.db.insert("hrCorrectionRequests", fields);
    await ctx.db.delete(absent);
    const foreign = await ctx.db.insert("hrCorrectionRequests", {
      ...fields,
      orgId: w.orgB,
    });
    const otherEmployee = await ctx.db.insert("hrEmployees", {
      orgId: w.orgA,
      ...draft(w),
      code: "OTHER",
      version: 1,
      createdAt: 1,
      updatedAt: 1,
      createdByUserId: w.userA,
      updatedByUserId: w.userA,
    });
    const other = await ctx.db.insert("hrCorrectionRequests", {
      ...fields,
      employeeId: otherEmployee,
    });
    return [absent, foreign, other, w.warehouses.alphaA];
  });
  const requestDetail = makeFunctionReference<
    "query",
    { correctionId: string },
    unknown
  >("hr/self:requestDetail");
  for (const correctionId of ["not-a-convex-id", "", ...ids]) {
    await expect(
      actor(w).query(requestDetail, { correctionId }),
    ).resolves.toMatchObject({
      ok: true,
      value: { ok: false, code: "NOT_FOUND" },
    });
  }
});

describe("HR current paged review identity coverage", () => {
  it("denies retained own leave identities after unlink in pages, details and registered decisions", async () => {
    const w = await world();
    const id = await employee(w);
    const request = await pendingLeave(w, id);
    const { userId: _userId, ...unlinked } = await savedDraft(w, id);
    expect(
      await actor(w).mutation(api.hr.setup.saveEmployee, {
        requestId: "leave-unlink-own",
        ...unlinked,
      }),
    ).toMatchObject({ ok: true, value: { written: true } });
    expect(
      await actor(w).query(api.hr.leave.queuePage, { pageSize: 20 }),
    ).toMatchObject({
      ok: true,
      value: { ok: true, page: [] },
    });
    expect(
      await actor(w).query(api.hr.leave.detail, {
        leaveRequestId: request,
      }),
    ).toMatchObject({
      ok: true,
      value: { ok: false, code: "NOT_FOUND" },
    });
    expect(
      await actor(w).mutation(api.hr.leave.decide, {
        requestId: "cannot-review-unlinked-own-leave",
        leaveRequestId: request,
        expectedVersion: 1,
        decision: "RETURN",
        reason: "Need additional details",
      }),
    ).toMatchObject({
      ok: true,
      value: { written: false, error: { code: "SELF_REVIEW" } },
    });
    expect(await w.t.run((ctx) => ctx.db.get(request))).toMatchObject({
      status: "PENDING",
      version: 1,
    });
    expect(
      await actor(w).query(api.hr.review.queuePage, {
        pageSize: 20,
        from: DATE,
        to: DATE,
      }),
    ).toMatchObject({
      ok: true,
      value: { ok: true, page: [] },
    });
  });

  it("retains leave reviewers and checks legacy leave decision history before a first self-link", async () => {
    const w = await world();
    const id = await employee(w, false);
    const request = await pendingLeave(w, id);
    expect(
      await actor(w).mutation(api.hr.leave.decide, {
        requestId: "review-before-leave-self-link",
        leaveRequestId: request,
        expectedVersion: 1,
        decision: "RETURN",
        reason: "Need additional details",
      }),
    ).toMatchObject({ ok: true, value: { written: true } });
    expect(await w.t.run((ctx) => ctx.db.get(id))).toMatchObject({
      reviewerUserIds: [w.userA],
    });
    for (const legacy of [false, true]) {
      if (legacy)
        await w.t.run((ctx) =>
          ctx.db.patch(id, { reviewerUserIds: undefined }),
        );
      expect(
        await actor(w).mutation(api.hr.setup.saveEmployee, {
          requestId: `leave-self-link-${legacy}`,
          ...(await savedDraft(w, id)),
          userId: w.userA,
        }),
      ).toMatchObject({
        ok: true,
        value: {
          written: false,
          error: { code: "EMPLOYEE_SELF_LINK_REVIEWED" },
        },
      });
    }
  });

  it("reads legacy affiliations once per employee when a leave page includes multiple requests", async () => {
    const w = await world();
    const id = await employee(w, false);
    await pendingLeave(w, id);
    await pendingLeave(w, id);
    await w.t.run((ctx) =>
      ctx.db.patch(id, { reviewExcludedUserIds: undefined }),
    );
    const measured = await meteredCall<{ ok: true; value: any }>(
      w,
      leave.queuePage,
      { pageSize: 20 },
      { subject: "user_fixture_a", org_id: "org_fixture_a" },
    );
    expect(measured.outcome).toMatchObject({ ok: true, value: { ok: true } });
    expect(measured.outcome.value.page).toHaveLength(2);
    expect(measured.meter.ranges.auditEvents).toBe(1);
  });

  it("skips former employees before paged review's legacy audit and holiday reads", async () => {
    const w = await world();
    await formerWorkers(w, 20);
    const measured = await meteredCall<{ ok: true; value: any }>(
      w,
      review.queuePage,
      { pageSize: 20, from: DATE, to: DATE },
      { subject: "user_fixture_a", org_id: "org_fixture_a" },
    );
    expect(measured.outcome).toMatchObject({
      ok: true,
      value: { ok: true, page: [] },
    });
    expect(measured.meter.ranges.auditEvents ?? 0).toBe(0);
    expect(measured.meter.ranges.hrHolidays ?? 0).toBe(0);
    expect(measured.meter.ranges.hrAttendanceDays ?? 0).toBe(0);
  });
});

it("refreshes live server business dates with untrusted invalidation tokens and leaves attendance untouched", async () => {
  const w = await world();
  await employee(w);
  vi.setSystemTime(at(DATE, 23 * 60 + 59));
  expect(
    await actor(w).query(api.hr.self.today, { clockRefresh: -1 }),
  ).toMatchObject({
    ok: true,
    value: { today: DATE },
  });
  vi.setSystemTime(at("2026-10-06", 1));
  expect(
    await actor(w).query(api.hr.self.today, {
      clockRefresh: 9_999_999_999_999,
    }),
  ).toMatchObject({
    ok: true,
    value: { today: "2026-10-06" },
  });
  expect(
    await w.t.run((ctx) => ctx.db.query("hrAttendanceDays").collect()),
  ).toHaveLength(0);
});
