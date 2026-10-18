/**
 * Kiro diagnostic probes (backend). Each test asserts the EXPECTED behaviour,
 * so a failure on current source is evidence of the defect. Fixture data
 * lives only in convex-test's in-memory database.
 *
 * Run: pnpm exec vitest run --config docs/reviews/daily-bug-search-2026-10-13/expanded/kiro/vitest.config.mts hr-backend
 */
import type { GenericMutationCtx } from "convex/server";
import type { GenericId } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as periods from "../../../../../convex/hr/periods";
import * as review from "../../../../../convex/hr/review";
import * as self from "../../../../../convex/hr/self";
import * as setup from "../../../../../convex/hr/setup";
import { fromLocal } from "../../../../../convex/model/hr/calendar";
import type { DataModel } from "../../../../../convex/schema";
import {
  sideFromInstant,
  toLocalTimeInput,
} from "../../../../../src/features/hr/TimeSideField";
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
type Outcome = {
  ok: boolean;
  value?: Record<string, any> & { written?: boolean; error?: { code: string } };
};

const EMPLOYEE = "user_fixture_a";
const SUPERVISOR = "user_probe_supervisor";
const HR_ADMIN = "user_probe_admin";
const SCOPED_ADMIN = "user_probe_scoped_admin";
const BRAVO_SUPERVISOR = "user_probe_bravo_supervisor";
const OFFSET = 420;

const at = (date: string, hhmm: string, seconds = 0) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return fromLocal(date, h * 60 + m, OFFSET) + seconds * 1000;
};
const setNow = (date: string, hhmm: string, seconds = 0) =>
  vi.setSystemTime(at(date, hhmm, seconds));

let sequence = 0;
const rid = (label: string) => `${label}-${(sequence += 1)}-kiro`;

async function call(
  world: ConvexTenantWorld,
  fn: unknown,
  args: unknown,
  subject = EMPLOYEE,
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
const value = (outcome: Outcome) => {
  expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
  return outcome.value as Record<string, any>;
};
const written = (outcome: Outcome) => {
  const v = value(outcome);
  expect(v.written, JSON.stringify(v)).toBe(true);
  return v;
};

async function addActor(
  world: ConvexTenantWorld,
  clerkUserId: string,
  roleKey: string,
  sites: readonly GenericId<"warehouses">[] | "ORG_WIDE",
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
      scopeMode: sites === "ORG_WIDE" ? "ORG_WIDE" : "WAREHOUSE_SCOPED",
      effectiveFrom: 0,
    });
    if (sites !== "ORG_WIDE")
      for (const warehouseId of sites)
        await ctx.db.insert("membershipWarehouses", {
          orgId: world.orgA,
          membershipId,
          warehouseId,
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

const DAY_SHIFT = {
  workDays: [1, 2, 3, 4, 5],
  startTime: "08:30",
  endTime: "17:30",
  endsNextDay: false,
  breakMinutes: 60,
};

async function world() {
  const w = await createConvexTenantWorld();
  await seedConvexAuthorization(w, { roleA: "HR_EMPLOYEE" });
  const supervisorId = await addActor(w, SUPERVISOR, "HR_SUPERVISOR", [
    w.warehouses.alphaA,
  ]);
  const adminId = await addActor(w, HR_ADMIN, "HR_ADMIN", "ORG_WIDE");
  setNow("2026-10-01", "09:00");
  const base = {
    warehouseId: w.warehouses.alphaA,
    supervisorUserId: supervisorId,
    employmentStartDate: "2026-01-01",
    status: "ACTIVE",
  };
  const employee = written(
    await call(
      w,
      setup.saveEmployee,
      {
        requestId: rid("emp"),
        ...base,
        code: "EMP-001",
        displayName: "Linked worker",
        userId: w.userA,
        schedule: DAY_SHIFT,
      },
      HR_ADMIN,
    ),
  );
  // No schedule: every day is NONWORKING/READY, so a period is never empty.
  written(
    await call(
      w,
      setup.saveEmployee,
      {
        requestId: rid("emp"),
        ...base,
        code: "EMP-900",
        displayName: "Unscheduled filler",
      },
      HR_ADMIN,
    ),
  );
  return {
    w,
    supervisorId,
    adminId,
    employeeId: employee.documentId as GenericId<"hrEmployees">,
  };
}

const employeeArgs = async (
  w: ConvexTenantWorld,
  id: GenericId<"hrEmployees">,
) => {
  const doc = (await w.t.run((ctx) => ctx.db.get(id)))!;
  return {
    employeeId: id,
    expectedVersion: doc.version,
    warehouseId: doc.warehouseId,
    code: doc.code,
    displayName: doc.displayName,
    ...(doc.userId ? { userId: doc.userId } : {}),
    ...(doc.supervisorUserId ? { supervisorUserId: doc.supervisorUserId } : {}),
    employmentStartDate: doc.employmentStartDate,
    ...(doc.employmentEndDate
      ? { employmentEndDate: doc.employmentEndDate }
      : {}),
    status: doc.status,
    ...(doc.schedule ? { schedule: doc.schedule } : {}),
  };
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("KIRO-01 employment-date edit and recorded attendance", () => {
  it("recorded worked time must not silently disappear from a closed period/CSV", async () => {
    const { w, employeeId } = await world();
    setNow("2026-10-05", "08:30");
    written(await call(w, self.clockIn, { requestId: rid("in") }));
    setNow("2026-10-05", "17:30");
    written(await call(w, self.clockOut, { requestId: rid("out") }));

    // HR corrects the start date to the next day. No warning or refusal.
    setNow("2026-10-07", "09:00");
    const edit = await call(
      w,
      setup.saveEmployee,
      {
        requestId: rid("edit"),
        ...(await employeeArgs(w, employeeId)),
        employmentStartDate: "2026-10-06",
      },
      HR_ADMIN,
    );
    console.info(
      "KIRO-01 save after recorded day:",
      JSON.stringify(edit.value),
    );

    const created = written(
      await call(
        w,
        periods.create,
        {
          requestId: rid("period"),
          warehouseId: w.warehouses.alphaA,
          startDate: "2026-10-03",
          endDate: "2026-10-05",
        },
        HR_ADMIN,
      ),
    );
    const preview = value(
      await call(
        w,
        periods.preview,
        { periodId: created.documentId },
        HR_ADMIN,
      ),
    );
    const day = await w.t.run((ctx) =>
      ctx.db
        .query("hrAttendanceDays")
        .withIndex("by_orgId_employeeId_businessDate", (q) =>
          q
            .eq("orgId", w.orgA)
            .eq("employeeId", employeeId)
            .eq("businessDate", "2026-10-05"),
        )
        .unique(),
    );
    let csv = "";
    if (preview.view.kind === "DRAFT" && preview.view.blocker === null) {
      const closed = written(
        await call(
          w,
          periods.close,
          {
            requestId: rid("close"),
            periodId: created.documentId,
            expectedFingerprint: preview.view.fingerprint,
          },
          HR_ADMIN,
        ),
      );
      csv = written(
        await call(
          w,
          periods.exportCsv,
          { requestId: rid("csv"), versionId: closed.documentId },
          HR_ADMIN,
        ),
      ).content;
    }
    console.info("KIRO-01 evidence", {
      saveWritten: edit.value?.written,
      recordedDay: {
        clockInAt: day?.clockInAt,
        clockOutAt: day?.clockOutAt,
      },
      previewBlocker: preview.view.blocker,
      previewWorkedMinutes: preview.view.totals?.workedMinutes,
      csvHasEmp001: csv.includes("EMP-001"),
      csvRows: csv.trim().split("\r\n").length - 1,
    });
    expect(day?.clockOutAt).toBeDefined();
    // Expected: either the edit is refused/flagged, or the recorded day stays
    // in the period (blocking or counted). Actual: it vanishes.
    expect(
      edit.value?.written === false ||
        preview.view.blocker !== null ||
        preview.view.totals.workedMinutes > 0,
    ).toBe(true);
  });
});

describe("KIRO-02 retroactive schedule/holiday edits", () => {
  it("an unaccounted past absence must stay an exception after a schedule edit", async () => {
    const { w, employeeId } = await world();
    // Monday 5 Oct: scheduled, no record at all.
    setNow("2026-10-07", "09:00");
    const queueBefore = value(
      await call(
        w,
        review.queue,
        { from: "2026-10-05", to: "2026-10-05" },
        SUPERVISOR,
      ),
    );
    written(
      await call(
        w,
        setup.saveEmployee,
        {
          requestId: rid("sched"),
          ...(await employeeArgs(w, employeeId)),
          // From now on Tue–Sat. Nothing says "effective from".
          schedule: { ...DAY_SHIFT, workDays: [2, 3, 4, 5, 6] },
        },
        HR_ADMIN,
      ),
    );
    const queueAfter = value(
      await call(
        w,
        review.queue,
        { from: "2026-10-03", to: "2026-10-05" },
        SUPERVISOR,
      ),
    );
    console.info("KIRO-02 evidence", {
      before: queueBefore.items.map(
        (i: any) => `${i.businessDate}:${i.status}:${i.issue}`,
      ),
      after: queueAfter.items.map(
        (i: any) => `${i.businessDate}:${i.status}:${i.issue}`,
      ),
    });
    expect(queueBefore.items).toHaveLength(1);
    expect(
      queueAfter.items.some(
        (i: any) =>
          i.businessDate === "2026-10-05" && i.issue === "MISSING_RECORD",
      ),
    ).toBe(true);
  });

  it("adding a past holiday must not erase an unaccounted absence", async () => {
    const { w } = await world();
    setNow("2026-10-07", "09:00");
    written(
      await call(
        w,
        setup.saveHoliday,
        {
          requestId: rid("hol"),
          warehouseId: w.warehouses.alphaA,
          date: "2026-10-05",
          name: "Late-entered holiday",
        },
        HR_ADMIN,
      ),
    );
    const queue = value(
      await call(
        w,
        review.queue,
        { from: "2026-10-05", to: "2026-10-05" },
        SUPERVISOR,
      ),
    );
    console.info("KIRO-02 holiday evidence", queue.items);
    expect(queue.items).toHaveLength(1);
  });
});

describe("KIRO-03 HR admin self-review through unlink", () => {
  it("an HR admin must not certify their own attendance by unlinking first", async () => {
    const w = await createConvexTenantWorld();
    await seedConvexAuthorization(w, { roleA: "HR_EMPLOYEE" });
    const adminId = await addActor(w, HR_ADMIN, "HR_ADMIN", "ORG_WIDE");
    setNow("2026-10-01", "09:00");
    const own = written(
      await call(
        w,
        setup.saveEmployee,
        {
          requestId: rid("own"),
          warehouseId: w.warehouses.alphaA,
          code: "ADM-001",
          displayName: "HR admin as employee",
          userId: adminId,
          employmentStartDate: "2026-01-01",
          status: "ACTIVE",
          schedule: DAY_SHIFT,
        },
        HR_ADMIN,
      ),
    );
    const ownId = own.documentId as GenericId<"hrEmployees">;
    setNow("2026-10-07", "09:00");
    const dispose = (label: string) =>
      call(
        w,
        review.disposeDay,
        {
          requestId: rid(label),
          employeeId: ownId,
          businessDate: "2026-10-05",
          expectedRevision: 0,
          disposition: "WORKED",
          start: { minute: 8 * 60 + 30, nextDay: false },
          end: { minute: 17 * 60 + 30, nextDay: false },
          reason: "Worked on site",
        },
        HR_ADMIN,
      );
    const direct = value(await dispose("self-direct"));
    const { userId: _drop, ...unlinked } = await employeeArgs(w, ownId);
    const unlink = value(
      await call(
        w,
        setup.saveEmployee,
        { requestId: rid("unlink"), ...unlinked },
        HR_ADMIN,
      ),
    );
    const afterUnlink = value(await dispose("self-after-unlink"));
    const relink = value(
      await call(
        w,
        setup.saveEmployee,
        {
          requestId: rid("relink"),
          ...(await employeeArgs(w, ownId)),
          userId: adminId,
        },
        HR_ADMIN,
      ),
    );
    const day = await w.t.run((ctx) =>
      ctx.db
        .query("hrAttendanceDays")
        .withIndex("by_orgId_employeeId_businessDate", (q) =>
          q
            .eq("orgId", w.orgA)
            .eq("employeeId", ownId)
            .eq("businessDate", "2026-10-05"),
        )
        .unique(),
    );
    console.info("KIRO-03 evidence", {
      direct: direct.written ? true : direct.error?.code,
      unlink: unlink.written,
      afterUnlink: afterUnlink.written ? true : afterUnlink.error?.code,
      relink: relink.written,
      certifiedBySelf: day?.certification?.decidedByUserId === adminId,
    });
    expect(direct.error?.code).toBe("SELF_REVIEW");
    expect(day?.certification?.decidedByUserId).not.toBe(adminId);
  });
});

describe("KIRO-04 warehouse-scoped HR admin and org-wide HR roles", () => {
  it("a site-A-only HR admin must not revoke HR roles of a site-B-only member", async () => {
    const w = await createConvexTenantWorld();
    await seedConvexAuthorization(w, { roleA: "HR_EMPLOYEE" });
    await addActor(w, SCOPED_ADMIN, "HR_ADMIN", [w.warehouses.alphaA]);
    const bravoSupervisor = await addActor(
      w,
      BRAVO_SUPERVISOR,
      "HR_SUPERVISOR",
      [w.warehouses.bravoA],
    );
    setNow("2026-10-07", "09:00");
    const listed = value(await call(w, setup.accessMembers, {}, SCOPED_ADMIN));
    const visible = listed.items?.some(
      (item: any) => item.userId === bravoSupervisor,
    );
    const revoke = value(
      await call(
        w,
        setup.setMemberAccess,
        {
          requestId: rid("revoke"),
          userId: bravoSupervisor,
          role: "HR_SUPERVISOR",
          granted: false,
        },
        SCOPED_ADMIN,
      ),
    );
    const bravoQueue = await call(
      w,
      review.queue,
      { from: "2026-10-01", to: "2026-10-07" },
      BRAVO_SUPERVISOR,
    );
    console.info("KIRO-04 evidence", {
      outOfScopeMemberListed: visible,
      revoke: revoke.written ? true : revoke.error?.code,
      bravoSupervisorQueueOk: bravoQueue.ok,
    });
    expect(revoke.written).not.toBe(true);
  });
});

describe("KIRO-05 lifetime site registry bound", () => {
  it("a site with 1 current employee and 100 historical records must still create a period", async () => {
    const { w, adminId } = await world();
    await w.t.run(async (ctx) => {
      for (let index = 0; index < 100; index += 1)
        await ctx.db.insert("hrEmployees", {
          orgId: w.orgA,
          warehouseId: w.warehouses.alphaA,
          code: `OLD-${String(index).padStart(3, "0")}`,
          displayName: `Former worker ${index}`,
          employmentStartDate: "2024-01-01",
          employmentEndDate: "2024-12-31",
          status: "INACTIVE",
          version: 1,
          createdAt: 1,
          createdByUserId: adminId,
          updatedAt: 1,
          updatedByUserId: adminId,
        });
    });
    setNow("2026-10-07", "09:00");
    const create = value(
      await call(
        w,
        periods.create,
        {
          requestId: rid("period"),
          warehouseId: w.warehouses.alphaA,
          startDate: "2026-09-01",
          endDate: "2026-09-30",
        },
        HR_ADMIN,
      ),
    );
    const queue = value(
      await call(
        w,
        review.queue,
        { from: "2026-10-01", to: "2026-10-06" },
        HR_ADMIN,
      ),
    );
    console.info("KIRO-05 evidence", {
      employedInRange: 2,
      create: create.written ? true : create.error,
      adminQueue: queue.ok === false ? queue.code : "ok",
    });
    expect(create.written).toBe(true);
    expect(queue.ok).toBe(true);
  });
});

describe("KIRO-06 correction certified while the shift is still open", () => {
  it("certifying a correction during an open shift must not end the shift and block clock-out", async () => {
    const { w } = await world();
    setNow("2026-10-05", "09:00");
    written(await call(w, self.clockIn, { requestId: rid("in") }));
    // Still working; fixes the forgotten earlier arrival (form needs an end ≤ now).
    setNow("2026-10-05", "10:05");
    const detailBefore = value(
      await call(w, self.dayDetail, { businessDate: "2026-10-05" }),
    );
    const submitted = written(
      await call(w, self.submitCorrection, {
        requestId: rid("corr"),
        businessDate: "2026-10-05",
        start: { minute: 8 * 60, nextDay: false },
        end: { minute: 10 * 60, nextDay: false },
        reason: "Arrived at 08:00",
      }),
    );
    setNow("2026-10-05", "10:10");
    const correction = await w.t.run((ctx) =>
      ctx.db.get(submitted.documentId as GenericId<"hrCorrectionRequests">),
    );
    written(
      await call(
        w,
        review.decideCorrection,
        {
          requestId: rid("cert"),
          correctionId: submitted.documentId,
          expectedVersion: correction!.version,
          decision: "CERTIFY",
        },
        SUPERVISOR,
      ),
    );
    setNow("2026-10-05", "17:30");
    const out = value(await call(w, self.clockOut, { requestId: rid("out") }));
    const today = value(await call(w, self.today, {}));
    console.info("KIRO-06 evidence", {
      statusWhenSubmitted: detailBefore.detail.status,
      clockOut: out.written ? true : out.error?.code,
      todayState: today.state,
      nextAction: today.nextAction,
    });
    expect(out.written).toBe(true);
  });
});

describe("KIRO-07 prefilled correction side truncates seconds", () => {
  it("an untouched prefilled clock-in must not change the proposed start", async () => {
    const { w } = await world();
    setNow("2026-10-05", "08:30", 45);
    written(await call(w, self.clockIn, { requestId: rid("in") }));
    setNow("2026-10-05", "17:30", 10);
    written(await call(w, self.clockOut, { requestId: rid("out") }));
    setNow("2026-10-06", "09:00");
    const detail = value(
      await call(w, self.dayDetail, { businessDate: "2026-10-05" }),
    ).detail;
    // Exactly what CorrectionForm sends when only the end is changed.
    const start = toLocalTimeInput(
      sideFromInstant(detail.originalStartAt, "2026-10-05", "Asia/Bangkok"),
    );
    const submitted = written(
      await call(w, self.submitCorrection, {
        requestId: rid("corr"),
        businessDate: "2026-10-05",
        ...(start ? { start } : {}),
        end: { minute: 18 * 60, nextDay: false },
        reason: "Left at 18:00",
      }),
    );
    const correction = await w.t.run((ctx) =>
      ctx.db.get(submitted.documentId as GenericId<"hrCorrectionRequests">),
    );
    console.info("KIRO-07 evidence", {
      originalStartAt: detail.originalStartAt,
      proposedStartAt: correction!.proposedStartAt,
      deltaSeconds:
        (detail.originalStartAt - correction!.proposedStartAt) / 1000,
    });
    // ReviewDetail marks start as "changed" when these differ (line 308).
    expect(correction!.proposedStartAt).toBe(detail.originalStartAt);
  });
});

describe("KIRO-08 time-only change of the Today query", () => {
  it("documents that Today's answer changes with time alone (no data write)", async () => {
    const { w } = await world();
    setNow("2026-10-12", "08:30");
    written(await call(w, self.clockIn, { requestId: rid("in") }));
    setNow("2026-10-12", "17:30");
    written(await call(w, self.clockOut, { requestId: rid("out") }));
    setNow("2026-10-12", "23:50");
    const evening = value(await call(w, self.today, {}));
    setNow("2026-10-13", "08:20");
    const morning = value(await call(w, self.today, {}));
    console.info("KIRO-08 evidence", {
      evening: [evening.businessDate, evening.state, evening.nextAction],
      morning: [morning.businessDate, morning.state, morning.nextAction],
    });
    // Same database, different answer: only a re-execution can show it.
    expect(evening.nextAction).toBe("NONE");
    expect(morning.nextAction).toBe("CLOCK_IN");
  });
});
