/**
 * Slice 02 work-rule foundation through the real exported Convex policy
 * handlers (`convex/hr/policies.ts`) on the in-process convex-test backend.
 *
 * Scope of these claims: handlers run with their production tenant wrapper,
 * permission checks, idempotency ledger, audit writes and schema validation.
 * Most cases call `_handler` directly, which skips Convex's argument
 * validators, so the domain validator is what rejects malformed values. The
 * last block calls the registered function reference so the public argument
 * validator is exercised too. Nothing in this file exercises a deployed
 * backend or a browser.
 */
import { makeFunctionReference, type GenericMutationCtx } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as leave from "../../convex/hr/leave";
import * as policies from "../../convex/hr/policies";
import type { Id } from "../../convex/_generated/dataModel";
import type { DataModel } from "../../convex/schema";
import { thailandDefaults } from "../../convex/model/hr/policy";
import { WORK_RULES_EXECUTION } from "../../convex/model/hr/workRules";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";

type Runtime = {
  _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
};
type Outcome = {
  ok: boolean;
  value?: Record<string, unknown> & {
    written?: boolean;
    replayed?: boolean;
    error?: { code: string; field?: string };
  };
};
const ADMIN = { subject: "user_fixture_a", org_id: "org_fixture_a" };
const EMPLOYEE = { subject: "user_rules_employee", org_id: "org_fixture_a" };
const OTHER_ORG = { subject: "user_fixture_a", org_id: "org_fixture_b" };
const today = "2026-10-12";
let sequence = 0;
const rid = () => `work-rules-test-${++sequence}`;

const RULES = {
  attendance: {
    lateAfterMinutes: 5,
    veryLateAfterMinutes: 15,
    absentAfterMinutes: 30,
    excludeGraceMinutesFromLate: true,
  },
  overtime: {
    automaticCalculation: false,
    beforeShiftStartMinutes: 0,
    afterShiftEndMinutes: 30,
    minimumMinutes: 60,
    rounding: { direction: "DOWN" as const, intervalMinutes: 30 },
    eligibility: {
      requirePassedProbation: true,
      minimumTenureDays: 90,
      excludedGroupKeys: ["contractors"],
    },
  },
};

async function call(
  world: ConvexTenantWorld,
  fn: unknown,
  args: unknown,
  identity = ADMIN,
) {
  return (await world.t
    .withIdentity(identity)
    .run((ctx) =>
      (fn as Runtime)._handler(ctx as GenericMutationCtx<DataModel>, args),
    )) as Outcome;
}
function result(outcome: Outcome) {
  expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
  return outcome.value!;
}
function written(outcome: Outcome) {
  const value = result(outcome);
  expect(value, JSON.stringify(value)).toMatchObject({ written: true });
  return value;
}
function refused(outcome: Outcome, code: string, field?: string) {
  expect(result(outcome)).toMatchObject({
    written: false,
    error: { code, ...(field === undefined ? {} : { field }) },
  });
}
const drafts = (world: ConvexTenantWorld) =>
  world.t.run((ctx) => ctx.db.query("hrPolicyDrafts").collect());
const policyAudits = (world: ConvexTenantWorld) =>
  world.t.run(async (ctx) =>
    (await ctx.db.query("auditEvents").collect()).filter(
      (row) => row.action === "hr.policy.saveDraft",
    ),
  );

async function fixture({ orgWide = true } = {}) {
  const world = await createConvexTenantWorld({
    "../convex/hr/policies.ts": () => import("../../convex/hr/policies"),
  });
  const auth = await seedConvexAuthorization(world, {
    roleA: "HR_ADMIN",
    roleB: "HR_ADMIN",
  });
  const employeeId = await world.t.run(async (ctx) => {
    if (orgWide)
      await ctx.db.patch("memberships", auth.identities.membershipA, {
        scopeMode: "ORG_WIDE",
      });
    const employeeUser = await ctx.db.insert("users", {
      clerkUserId: EMPLOYEE.subject,
      displayName: "Employee",
      status: "ACTIVE",
    });
    const membership = await ctx.db.insert("memberships", {
      orgId: world.orgA,
      userId: employeeUser,
      clerkMembershipId: "member_rules_employee",
      status: "ACTIVE",
      scopeMode: "ORG_WIDE",
      effectiveFrom: 0,
    });
    await ctx.db.insert("membershipRoles", {
      orgId: world.orgA,
      membershipId: membership,
      roleId: auth.rolesA.get("HR_EMPLOYEE")!,
      grantedAt: 0,
    });
    const id = await ctx.db.insert("hrEmployees", {
      orgId: world.orgA,
      warehouseId: world.warehouses.alphaA,
      code: "EMP1",
      displayName: "Employee 1",
      userId: employeeUser,
      supervisorUserId: world.userA,
      employmentStartDate: "2020-01-01",
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
      createdByUserId: world.userA,
      updatedAt: 1,
      updatedByUserId: world.userA,
    });
    for (const date of [
      "2026-01-01",
      "2026-01-02",
      "2026-02-02",
      "2026-03-02",
      "2026-04-06",
      "2026-04-13",
      "2026-04-14",
      "2026-04-15",
      "2026-05-01",
      "2026-05-04",
      "2026-06-03",
      "2026-07-28",
      "2026-08-12",
    ])
      await ctx.db.insert("hrHolidays", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        date,
        name: "Company holiday",
        createdAt: 1,
        createdByUserId: world.userA,
      });
    return id;
  });
  return { world, employeeId };
}
const saveArgs = (
  expectedVersion = 0,
  config: Record<string, unknown> = { ...thailandDefaults(), workRules: RULES },
  capability = "LEAVE",
) => ({
  requestId: rid(),
  capability,
  expectedVersion,
  effectiveDate: today,
  config,
});
const current = async (world: ConvexTenantWorld, identity = ADMIN) =>
  result(
    await call(world, policies.current, { capability: "LEAVE" }, identity),
  ) as {
    ok: boolean;
    code?: string;
    draft: { version: number; config: Record<string, unknown> };
    active: { config: Record<string, unknown> } | null;
    workRulesExecution?: unknown;
  };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-12T03:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("work rules on the real LEAVE policy handlers", () => {
  it("keeps legacy policies without work rules and labels execution inactive", async () => {
    const { world } = await fixture();
    const before = await current(world);
    expect(before).toMatchObject({
      ok: true,
      draft: { version: 0 },
      workRulesExecution: WORK_RULES_EXECUTION,
    });
    expect(before.draft.config).not.toHaveProperty("workRules");
    written(
      await call(world, policies.saveDraft, saveArgs(0, thailandDefaults())),
    );
    const [row] = await drafts(world);
    expect(row!.config).toEqual(thailandDefaults());
    expect(row!.config).not.toHaveProperty("workRules");
    const [audit] = await policyAudits(world);
    expect(audit).toMatchObject({ outcome: "ALLOWED" });
    expect(audit!.changes).toContainEqual({ field: "workRules", to: "NONE" });
    // Non-LEAVE reads do not advertise work rules at all.
    const payslips = result(
      await call(world, policies.current, { capability: "PAYSLIPS" }),
    );
    expect(payslips).not.toHaveProperty("workRulesExecution");
  });

  it("saves, reloads, replaces and removes work rules with versioned audit", async () => {
    const { world } = await fixture();
    expect(
      written(await call(world, policies.saveDraft, saveArgs(0))),
    ).toMatchObject({ version: 1, replayed: false });
    const reloaded = await current(world);
    expect(reloaded.draft).toMatchObject({ version: 1 });
    expect(reloaded.draft.config.workRules).toEqual(RULES);
    expect(reloaded.workRulesExecution).toEqual(WORK_RULES_EXECUTION);
    expect((await drafts(world))[0]!.config.workRules).toEqual(RULES);
    expect((await policyAudits(world))[0]!.changes).toContainEqual({
      field: "workRules",
      to: "STORED_INACTIVE",
    });

    const changed = {
      attendance: { lateAfterMinutes: 0 },
      overtime: { maximumOutsideShiftMinutes: 120, minimumMinutes: 120 },
    };
    written(
      await call(
        world,
        policies.saveDraft,
        saveArgs(1, { ...thailandDefaults(), workRules: changed }),
      ),
    );
    expect((await current(world)).draft.config.workRules).toEqual(changed);

    // A full-config save without work rules clears them, like any other field.
    written(
      await call(world, policies.saveDraft, saveArgs(2, thailandDefaults())),
    );
    const cleared = await current(world);
    expect(cleared.draft.version).toBe(3);
    expect(cleared.draft.config).not.toHaveProperty("workRules");
    expect(await drafts(world)).toHaveLength(1);
  });

  it.each([
    [
      { overtime: { automaticCalculation: true } },
      "workRules.overtime.automaticCalculation:UNSUPPORTED",
    ],
    [
      { attendance: { lateAfterMinutes: 15, veryLateAfterMinutes: 15 } },
      "workRules.attendance.veryLateAfterMinutes:ORDER",
    ],
    [
      { attendance: { absentAfterMinutes: 30.5 } },
      "workRules.attendance.absentAfterMinutes",
    ],
    [{ overtime: { minimumMinutes: -1 } }, "workRules.overtime.minimumMinutes"],
    [
      { overtime: { minimumMinutes: 90, maximumOutsideShiftMinutes: 60 } },
      "workRules.overtime.maximumOutsideShiftMinutes:ORDER",
    ],
    [
      { overtime: { rounding: { direction: "UP", intervalMinutes: 30 } } },
      "workRules.overtime.rounding.direction",
    ],
    [
      { overtime: { eligibility: { excludedGroupKeys: ["a", "a"] } } },
      "workRules.overtime.eligibility.excludedGroupKeys",
    ],
    [{ penaltyPoints: { late: -0.25 } }, "workRules.penaltyPoints"],
  ])(
    "refuses invalid work rules %j without writing a draft",
    async (workRules, field) => {
      const { world } = await fixture();
      refused(
        await call(
          world,
          policies.saveDraft,
          saveArgs(0, { ...thailandDefaults(), workRules }),
        ),
        "POLICY_INVALID",
        field,
      );
      expect(await drafts(world)).toHaveLength(0);
      const audits = await policyAudits(world);
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        outcome: "DENIED",
        changes: [{ field: "error", to: "POLICY_INVALID" }],
      });
    },
  );

  it("refuses work rules on non-LEAVE capabilities", async () => {
    const { world } = await fixture();
    for (const capability of ["ANNOUNCEMENTS", "PAYSLIPS"])
      refused(
        await call(
          world,
          policies.saveDraft,
          saveArgs(0, { ...thailandDefaults(), workRules: {} }, capability),
        ),
        "POLICY_INVALID",
        "workRules:CAPABILITY",
      );
    expect(await drafts(world)).toHaveLength(0);
  });

  it("denies an employee without HR admin permission to read or save", async () => {
    const { world } = await fixture();
    expect(
      (await call(world, policies.current, { capability: "LEAVE" }, EMPLOYEE))
        .ok,
    ).toBe(false);
    expect(
      (await call(world, policies.saveDraft, saveArgs(0), EMPLOYEE)).ok,
    ).toBe(false);
    expect(await drafts(world)).toHaveLength(0);
  });

  it("requires organization-wide scope for a site-scoped HR admin", async () => {
    const { world } = await fixture({ orgWide: false });
    expect(await current(world)).toEqual({
      ok: false,
      code: "POLICY_ORG_SCOPE_REQUIRED",
    });
    refused(
      await call(world, policies.saveDraft, saveArgs(0)),
      "POLICY_ORG_SCOPE_REQUIRED",
    );
    expect(await drafts(world)).toHaveLength(0);
  });

  it("isolates work rules between tenants", async () => {
    const { world } = await fixture();
    written(await call(world, policies.saveDraft, saveArgs(0)));
    const foreign = await current(world, OTHER_ORG);
    expect(foreign.draft.version).toBe(0);
    expect(foreign.draft.config).not.toHaveProperty("workRules");
    const otherRules = { attendance: { lateAfterMinutes: 10 } };
    written(
      await call(
        world,
        policies.saveDraft,
        saveArgs(0, { ...thailandDefaults(), workRules: otherRules }),
        OTHER_ORG,
      ),
    );
    expect((await current(world)).draft.config.workRules).toEqual(RULES);
    expect((await current(world, OTHER_ORG)).draft.config.workRules).toEqual(
      otherRules,
    );
    const rows = await drafts(world);
    expect(rows.map((row) => row.orgId).sort()).toEqual(
      [world.orgA, world.orgB].sort(),
    );
  });

  it("rejects a stale expected version without changing the stored rules", async () => {
    const { world } = await fixture();
    written(await call(world, policies.saveDraft, saveArgs(0)));
    refused(
      await call(
        world,
        policies.saveDraft,
        saveArgs(0, {
          ...thailandDefaults(),
          workRules: { attendance: { lateAfterMinutes: 1 } },
        }),
      ),
      "POLICY_STALE",
    );
    const stored = await current(world);
    expect(stored.draft.version).toBe(1);
    expect(stored.draft.config.workRules).toEqual(RULES);
  });

  it("replays an identical command and rejects a reused request ID with different rules", async () => {
    const { world } = await fixture();
    const args = saveArgs(0);
    written(await call(world, policies.saveDraft, args));
    expect(written(await call(world, policies.saveDraft, args))).toMatchObject({
      replayed: true,
      version: 1,
    });
    refused(
      await call(world, policies.saveDraft, {
        ...args,
        config: {
          ...thailandDefaults(),
          workRules: { attendance: { lateAfterMinutes: 6 } },
        },
      }),
      "REQUEST_ARGUMENT_CONFLICT",
    );
    expect(await drafts(world)).toHaveLength(1);
    expect((await current(world)).draft).toMatchObject({ version: 1 });
    expect((await current(world)).draft.config.workRules).toEqual(RULES);
  });

  it("snapshots work rules on activation while leave requests keep working", async () => {
    const { world, employeeId } = await fixture();
    written(await call(world, policies.saveDraft, saveArgs(0)));
    for (const [type, granted] of [
      ["ANNUAL", 6],
      ["SICK", 30],
      ["PERSONAL", 3],
      ["MILITARY", 60],
    ] as const)
      written(
        await call(world, policies.reconcileOpening, {
          requestId: rid(),
          employeeId: employeeId as Id<"hrEmployees">,
          type,
          asOf: today,
          granted,
          used: 0,
          reserved: 0,
          paidUsed: 0,
          paidReserved: 0,
          sourceReference: "Signed HR source register 2026",
          expectedVersion: 0,
        }),
      );
    written(
      await call(world, policies.activate, {
        requestId: rid(),
        capability: "LEAVE",
        expectedVersion: 1,
        coverageConfirmed: true,
        existingBenefitsReviewed: true,
      }),
    );
    const versions = await world.t.run((ctx) =>
      ctx.db.query("hrPolicyVersions").collect(),
    );
    expect(versions).toHaveLength(1);
    expect(versions[0]!.config.workRules).toEqual(RULES);
    expect((await current(world)).active!.config.workRules).toEqual(RULES);

    // Leave behavior is unchanged by the stored, inactive rules.
    const fields = {
      type: "ANNUAL",
      from: "2026-10-13",
      to: "2026-10-13",
      reason: "Real employee request",
    };
    const prepared = result(
      await call(world, leave.preview, fields, EMPLOYEE),
    ) as { ok: boolean; previewHash?: string; days?: number };
    expect(prepared.ok, JSON.stringify(prepared)).toBe(true);
    written(
      await call(
        world,
        leave.submit,
        {
          requestId: rid(),
          ...fields,
          expectedPreviewHash: prepared.previewHash,
        },
        EMPLOYEE,
      ),
    );
    const request = await world.t.run((ctx) =>
      ctx.db.query("hrLeaveRequests").first(),
    );
    expect(request).toMatchObject({ days: 1, status: "PENDING" });
    expect(request!.policyConfig.workRules).toEqual(RULES);
  });
});

describe("work rules through the registered Convex function and its argument validator", () => {
  const saveDraft = makeFunctionReference<"mutation">("hr/policies:saveDraft");
  const read = makeFunctionReference<"query">("hr/policies:current");

  it("allows only one competing save for the same expected version", async () => {
    const { world } = await fixture();
    const client = world.t.withIdentity(ADMIN);
    const outcomes = await Promise.all([
      client.mutation(saveDraft, saveArgs(0)),
      client.mutation(
        saveDraft,
        saveArgs(0, {
          ...thailandDefaults(),
          workRules: { attendance: { lateAfterMinutes: 10 } },
        }),
      ),
    ]);
    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
    expect(outcomes.filter((outcome) => outcome.value.written)).toHaveLength(1);
    expect(
      outcomes.filter(
        (outcome) => outcome.value.error?.code === "POLICY_STALE",
      ),
    ).toHaveLength(1);
    const rows = await drafts(world);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.version).toBe(1);
  });

  it("rechecks permission before replaying a previously authorized save", async () => {
    const { world } = await fixture();
    const client = world.t.withIdentity(ADMIN);
    const args = saveArgs(0);
    expect(await client.mutation(saveDraft, args)).toMatchObject({
      ok: true,
      value: { written: true },
    });
    await world.t.run(async (ctx) => {
      const membership = await ctx.db
        .query("memberships")
        .withIndex("by_orgId_userId", (q) =>
          q.eq("orgId", world.orgA).eq("userId", world.userA),
        )
        .unique();
      await ctx.db.patch("memberships", membership!._id, {
        status: "REVOKED",
      });
    });
    await expect(client.mutation(saveDraft, args)).rejects.toMatchObject({
      data: { code: "MEMBERSHIP_INACTIVE" },
    });
    await expect(
      client.query(read, { capability: "LEAVE" }),
    ).rejects.toMatchObject({
      data: { code: "MEMBERSHIP_INACTIVE" },
    });
    expect((await drafts(world))[0]!.version).toBe(1);
    expect(await policyAudits(world)).toHaveLength(1);
  });

  it("accepts valid work rules and rejects mistyped or unknown fields before the handler", async () => {
    const { world } = await fixture();
    const client = world.t.withIdentity(ADMIN);
    expect(await client.mutation(saveDraft, saveArgs(0))).toMatchObject({
      ok: true,
      value: { written: true, version: 1 },
    });
    expect(await client.query(read, { capability: "LEAVE" })).toMatchObject({
      ok: true,
      value: { draft: { version: 1, config: { workRules: RULES } } },
    });
    for (const workRules of [
      { attendance: { lateAfterMinutes: "5" } },
      { overtime: { rate: 1.5 } },
    ])
      await expect(
        client.mutation(
          saveDraft,
          saveArgs(1, { ...thailandDefaults(), workRules }),
        ),
      ).rejects.toThrow(/Validator|validator|ArgumentValidationError/);
    expect(await drafts(world)).toHaveLength(1);
    expect((await drafts(world))[0]!.version).toBe(1);
  });
});
