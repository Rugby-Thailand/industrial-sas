import type { GenericMutationCtx } from "convex/server";
import type { GenericId } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as access from "../../convex/hr/access";
import * as periods from "../../convex/hr/periods";
import * as review from "../../convex/hr/review";
import * as self from "../../convex/hr/self";
import * as setup from "../../convex/hr/setup";
import { storedPlan } from "../../convex/hr/shared";
import { fromLocal } from "../../convex/model/hr/calendar";
import { planFor, type Schedule } from "../../convex/model/hr/schedule";
import type { DataModel } from "../../convex/schema";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";

type Runtime = {
  _handler: (ctx: GenericMutationCtx<DataModel>, args: unknown) => Promise<any>;
};
const DATE = "2026-10-08";
const at = (date: string, minute: number) => fromLocal(date, minute, 420);
const DAY: Schedule = {
  workDays: [1, 2, 3, 4, 5],
  startTime: "08:30",
  endTime: "17:30",
  endsNextDay: false,
  breakMinutes: 60,
};
let sequence = 0;
const rid = (label: string) => `${label}-${(sequence += 1)}-completion`;

const call = (world: ConvexTenantWorld, fn: unknown, args: unknown) =>
  world.t
    .withIdentity({ subject: "user_fixture_a", org_id: "org_fixture_a" })
    .run((ctx) =>
      (fn as Runtime)._handler(ctx as GenericMutationCtx<DataModel>, args),
    );

async function world(roleA = "HR_ADMIN", linked = false) {
  const w = await createConvexTenantWorld();
  await seedConvexAuthorization(w, { roleA });
  const employeeId = await w.t.run((ctx) =>
    ctx.db.insert("hrEmployees", {
      orgId: w.orgA,
      warehouseId: w.warehouses.alphaA,
      code: "EMP-COMPLETE",
      displayName: "Completion employee",
      ...(linked ? { userId: w.userA } : { supervisorUserId: w.userA }),
      employmentStartDate: "2026-01-01",
      status: "ACTIVE",
      schedule: DAY,
      version: 1,
      createdAt: 1,
      createdByUserId: w.userA,
      updatedAt: 1,
      updatedByUserId: w.userA,
    }),
  );
  return { w, employeeId };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at("2026-10-09", 11 * 60));
});
afterEach(() => vi.useRealTimers());

describe("manual decision history and re-review (HR-033, HR-042, HR-050)", () => {
  it("keeps every earlier manual disposition visible and stale-checks the re-review", async () => {
    const { w, employeeId } = await world();
    const dispose = (extra: Record<string, unknown>) =>
      call(w, review.disposeDay, {
        requestId: rid("dispose"),
        employeeId,
        businessDate: DATE,
        reason: "Checked against the paper register",
        ...extra,
      });
    expect(
      await dispose({ expectedRevision: 0, disposition: "LEAVE" }),
    ).toMatchObject({ value: { written: true } });
    // A re-review against the old revision is refused without changes.
    expect(
      await dispose({ expectedRevision: 0, disposition: "ABSENT" }),
    ).toMatchObject({
      value: { written: false, error: { code: "DECISION_STALE" } },
    });
    expect(
      await dispose({
        expectedRevision: 1,
        disposition: "WORKED",
        start: { minute: 510, nextDay: false },
        end: { minute: 1050, nextDay: false },
        reason: "Gate log shows a full shift",
      }),
    ).toMatchObject({ value: { written: true } });
    const detail = (
      await call(w, review.dayDetail, { employeeId, businessDate: DATE })
    ).value.detail;
    expect(detail).toMatchObject({
      status: "READY",
      disposition: "WORKED",
      workedMinutes: 480,
      certification: { reason: "Gate log shows a full shift", current: true },
      priorCertifications: [
        {
          disposition: "LEAVE",
          reason: "Checked against the paper register",
          decidedByName: "Fixture A",
        },
      ],
    });
  });
});

describe("correction history bounds (HR-024, HR-051)", () => {
  it("returns the newest requests, always includes the pending one, and flags older ones", async () => {
    const { w, employeeId } = await world("HR_EMPLOYEE", true);
    const pendingId = await w.t.run(async (ctx) => {
      const dayId = await ctx.db.insert("hrAttendanceDays", {
        orgId: w.orgA,
        warehouseId: w.warehouses.alphaA,
        employeeId,
        businessDate: DATE,
        plan: storedPlan(
          planFor({
            date: DATE,
            schedule: DAY,
            offsetMinutes: 420,
            holidayName: undefined,
          }),
        ),
        clockInAt: at(DATE, 510),
        open: true,
        revision: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      const request = (
        status: "PENDING" | "RETURNED",
        submittedAt: number,
        reason: string,
      ) =>
        ctx.db.insert("hrCorrectionRequests", {
          orgId: w.orgA,
          dayId,
          employeeId,
          warehouseId: w.warehouses.alphaA,
          businessDate: DATE,
          status,
          proposedStartAt: at(DATE, 510),
          proposedEndAt: at(DATE, 1050),
          reason,
          baseRevision: 1,
          version: 1,
          submittedByUserId: w.userA,
          submittedAt,
          history: [],
        });
      // Created first, resubmitted last: the pending request.
      const pending = await request("PENDING", 10_000, "Current request");
      for (let index = 0; index < 22; index += 1)
        await request("RETURNED", 100 + index, `Returned ${index}`);
      await ctx.db.patch(dayId, { pendingCorrectionId: pending });
      return pending;
    });
    const detail = (await call(w, self.dayDetail, { businessDate: DATE })).value
      .detail;
    expect(detail.correctionsIncomplete).toBe(true);
    expect(detail.corrections[0]).toMatchObject({
      id: pendingId,
      status: "PENDING",
    });
    expect(
      detail.corrections.map((c: { reason: string }) => c.reason),
    ).toContain("Returned 21");
    expect(
      detail.corrections.map((c: { reason: string }) => c.reason),
    ).not.toContain("Returned 0");

    // A returned resubmission must stay recent after it stops being pending.
    await w.t.run(async (ctx) => {
      const request = await ctx.db.get(pendingId);
      await ctx.db.patch(pendingId, { status: "RETURNED" });
      await ctx.db.patch(request!.dayId, { pendingCorrectionId: undefined });
    });
    const returned = (await call(w, self.dayDetail, { businessDate: DATE }))
      .value.detail;
    expect(returned.corrections[0]).toMatchObject({
      id: pendingId,
      status: "RETURNED",
    });
  });
});

describe("bounded lists report completeness (HR-051)", () => {
  async function manySites(w: ConvexTenantWorld) {
    return await w.t.run(async (ctx) => {
      const membership = await ctx.db
        .query("memberships")
        .withIndex("by_orgId_userId", (q) =>
          q.eq("orgId", w.orgA).eq("userId", w.userA),
        )
        .unique();
      for (let index = 0; index < 51; index += 1) {
        const warehouseId = await ctx.db.insert("warehouses", {
          orgId: w.orgA,
          code: `S${String(index).padStart(3, "0")}`,
          name: `Site ${index}`,
          status: "ACTIVE",
        });
        await ctx.db.insert("membershipWarehouses", {
          orgId: w.orgA,
          membershipId: membership!._id,
          warehouseId,
        });
      }
    });
  }

  it("flags an oversized site scope without widening it", async () => {
    const { w } = await world("HR_ADMIN");
    await manySites(w);
    const current = (await call(w, access.current, {})).value;
    expect(current.sitesComplete).toBe(false);
    expect(current.sites.length).toBeLessThanOrEqual(50);
    // Nothing outside the membership's scope ever appears.
    expect(current.sites.map((s: { code: string }) => s.code)).not.toContain(
      "BRAVO",
    );
    expect((await call(w, setup.listEmployees, {})).value.complete).toBe(false);
    expect(
      (await call(w, review.queue, { from: "2026-10-01", to: DATE })).value,
    ).toMatchObject({ ok: false, code: "LIMIT_EXCEEDED" });
  });

  it("reports when the period list is bounded and keeps inactive-site history", async () => {
    const { w } = await world("HR_ADMIN");
    await w.t.run(async (ctx) => {
      for (let index = 0; index < 201; index += 1) {
        const day = `2020-${String((index % 12) + 1).padStart(2, "0")}-${String((index % 28) + 1).padStart(2, "0")}`;
        await ctx.db.insert("hrPeriods", {
          orgId: w.orgA,
          warehouseId: w.warehouses.alphaA,
          startDate: day,
          endDate: day,
          status: "CLOSED",
          draftVersion: 1,
          latestClosedVersion: 1,
          createdAt: 1,
          createdByUserId: w.userA,
          updatedAt: 1,
          updatedByUserId: w.userA,
        });
      }
      await ctx.db.patch(w.warehouses.alphaA, { status: "INACTIVE" });
    });
    const list = (await call(w, periods.list, {})).value;
    expect(list.complete).toBe(false);
    expect(list.items).toHaveLength(200);
    expect(list.items[0]).toMatchObject({ siteActive: false });
  });
});

describe("replay and frozen history (HR-022, HR-041, HR-043)", () => {
  it("refuses a replay whose saved result can no longer be rebuilt", async () => {
    const { w } = await world("HR_EMPLOYEE", true);
    vi.setSystemTime(at("2026-10-09", 8 * 60 + 25));
    const requestId = rid("clock");
    const first = await call(w, self.clockIn, { requestId });
    expect(first).toMatchObject({ value: { written: true } });
    await w.t.run((ctx) => ctx.db.delete(first.value.documentId));
    expect(await call(w, self.clockIn, { requestId })).toMatchObject({
      value: { written: false, error: { code: "REPLAY_RESULT_UNAVAILABLE" } },
    });
  });

  it("keeps closed versions viewable and exportable after the organization moves to an unsupported timezone", async () => {
    const { w, employeeId } = await world("HR_ADMIN");
    expect(
      await call(w, review.disposeDay, {
        requestId: rid("leave"),
        employeeId,
        businessDate: DATE,
        expectedRevision: 0,
        disposition: "LEAVE",
        reason: "Leave form on file",
      }),
    ).toMatchObject({ value: { written: true } });
    const periodId = (
      await call(w, periods.create, {
        requestId: rid("create"),
        warehouseId: w.warehouses.alphaA,
        startDate: DATE,
        endDate: DATE,
      })
    ).value.documentId as GenericId<"hrPeriods">;
    const draft = (await call(w, periods.preview, { periodId })).value;
    const closed = await call(w, periods.close, {
      requestId: rid("close"),
      periodId,
      expectedFingerprint: draft.view.fingerprint,
    });
    expect(closed).toMatchObject({ value: { written: true, version: 1 } });
    const before = (
      await call(w, periods.exportCsv, {
        requestId: rid("export"),
        versionId: closed.value.documentId,
      })
    ).value.content as string;

    await w.t.run(async (ctx) => {
      const organization = await ctx.db.get(w.orgA);
      await ctx.db.patch(w.orgA, {
        settings: { ...organization!.settings, timezone: "Europe/London" },
      });
    });
    expect((await call(w, access.current, {})).value.timezoneSupported).toBe(
      false,
    );
    expect((await call(w, periods.preview, { periodId })).value).toMatchObject({
      ok: true,
      period: { timezone: "Asia/Bangkok" },
      view: { kind: "CLOSED", version: 1 },
    });
    expect(
      (
        await call(w, periods.exportCsv, {
          requestId: rid("export"),
          versionId: closed.value.documentId,
        })
      ).value,
    ).toMatchObject({ written: true, content: before });
    // Live operations stay refused clearly.
    expect(
      await call(w, periods.create, {
        requestId: rid("create"),
        warehouseId: w.warehouses.alphaA,
        startDate: "2026-10-01",
        endDate: "2026-10-02",
      }),
    ).toMatchObject({
      value: { written: false, error: { code: "TIMEZONE_UNSUPPORTED" } },
    });
    expect(
      await call(w, periods.startRevision, {
        requestId: rid("revise"),
        periodId,
        reason: "Audit query",
      }),
    ).toMatchObject({ value: { written: true } });
    expect((await call(w, periods.preview, { periodId })).value).toMatchObject({
      ok: true,
      view: { kind: "TIMEZONE_UNSUPPORTED" },
      versions: [{ version: 1 }],
    });
    expect(
      (await call(w, periods.preview, { periodId, version: 1 })).value,
    ).toMatchObject({
      ok: true,
      period: { timezone: "Asia/Bangkok" },
      view: { kind: "CLOSED", version: 1 },
    });
  });
});
