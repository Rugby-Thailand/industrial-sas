import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../convex/_generated/dataModel";
import * as access from "../../convex/hr/access";
import * as periods from "../../convex/hr/periods";
import * as self from "../../convex/hr/self";
import { fromLocal } from "../../convex/model/hr/calendar";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";
import { meteredCall } from "../fixtures/hr-read-meter";

/**
 * Clock independence of HR display reads: the shell-wide access query and
 * closed (frozen) period versions answer without reading the time, so their
 * cached results stay reusable; time-dependent answers still use it.
 */

const ACTOR = { subject: "user_fixture_a", org_id: "org_fixture_a" };
const TODAY = "2026-10-13";
const BANGKOK = 420;

async function world(role = "HR_ADMIN") {
  const w = await createConvexTenantWorld();
  await seedConvexAuthorization(w, { roleA: role, roleB: "HR_ADMIN" });
  const employeeId = await w.t.run((ctx) =>
    ctx.db.insert("hrEmployees", {
      orgId: w.orgA,
      warehouseId: w.warehouses.alphaA,
      code: "OWN",
      displayName: "Own",
      userId: w.userA,
      employmentStartDate: "2024-01-01",
      status: "ACTIVE",
      version: 1,
      createdAt: 1,
      createdByUserId: w.userA,
      updatedAt: 1,
      updatedByUserId: w.userA,
    }),
  );
  return { w, employeeId };
}

async function closedPeriod(
  w: ConvexTenantWorld,
  employeeId: Id<"hrEmployees">,
  status: "CLOSED" | "DRAFT" = "CLOSED",
) {
  return w.t.run(async (ctx) => {
    const periodId = await ctx.db.insert("hrPeriods", {
      orgId: w.orgA,
      warehouseId: w.warehouses.alphaA,
      startDate: "2026-09-01",
      endDate: "2026-09-07",
      status,
      draftVersion: status === "CLOSED" ? 1 : 2,
      latestClosedVersion: 1,
      createdAt: 1,
      createdByUserId: w.userA,
      updatedAt: 1,
      updatedByUserId: w.userA,
    });
    const versionId = await ctx.db.insert("hrPeriodVersions", {
      orgId: w.orgA,
      warehouseId: w.warehouses.alphaA,
      periodId,
      version: 1,
      startDate: "2026-09-01",
      endDate: "2026-09-07",
      timezone: "Asia/Bangkok",
      siteCode: "FROZEN",
      siteName: "Frozen site",
      fingerprint: "frozen",
      totals: {
        employees: 1,
        days: 1,
        workedMinutes: 480,
        outsideShiftMinutes: 0,
        absentDays: 0,
        leaveDays: 0,
        nonworkingDays: 0,
      },
      closedByUserId: w.userA,
      closedAt: 1,
    });
    await ctx.db.insert("hrPeriodRows", {
      orgId: w.orgA,
      versionId,
      employeeId,
      employeeCode: "OWN",
      employeeName: "Own",
      businessDate: "2026-09-01",
      plan: { kind: "SCHEDULED", breakMinutes: 60, startAt: 100, endAt: 200 },
      workedMinutes: 480,
      outsideShiftMinutes: 0,
      disposition: "WORKED",
    });
    return periodId;
  });
}

describe("clock-free HR display reads", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(fromLocal(TODAY, 23 * 60 + 30, BANGKOK));
  });
  afterEach(() => vi.useRealTimers());

  it("serves shell access with the offset and without reading the clock", async () => {
    const { w } = await world();
    const display = await meteredCall<{ ok: true; value: any }>(
      w,
      access.display,
      {},
      ACTOR,
    );
    expect(display.outcome.ok).toBe(true);
    expect(display.meter.clock).toBe(0);
    expect(display.outcome.value).toMatchObject({
      timezone: "Asia/Bangkok",
      timezoneSupported: true,
      offsetMinutes: BANGKOK,
      employee: { code: "OWN" },
    });
    expect(display.outcome.value).not.toHaveProperty("today");

    // The legacy query keeps the server business date for older open tabs.
    const legacy = await meteredCall<{ ok: true; value: any }>(
      w,
      access.current,
      {},
      ACTOR,
    );
    const { today, ...facts } = legacy.outcome.value;
    expect(today).toBe(TODAY);
    expect(facts).toEqual(display.outcome.value);
  });

  it("reports an unsupported timezone without an offset", async () => {
    const { w } = await world();
    await w.t.run(async (ctx) => {
      const org = await ctx.db.get("organizations", w.orgA);
      await ctx.db.patch("organizations", w.orgA, {
        settings: { ...org!.settings, timezone: "Mars/Olympus" },
      });
    });
    const display = await meteredCall<{ ok: true; value: any }>(
      w,
      access.display,
      {},
      ACTOR,
    );
    expect(display.outcome.value.timezoneSupported).toBe(false);
    expect(display.outcome.value).not.toHaveProperty("offsetMinutes");
  });

  it("previews a closed version without the clock and a draft with today", async () => {
    const { w, employeeId } = await world();
    const closed = await closedPeriod(w, employeeId);
    const frozen = await meteredCall<{ ok: true; value: any }>(
      w,
      periods.preview,
      { periodId: closed },
      ACTOR,
    );
    expect(frozen.meter.clock).toBe(0);
    expect(frozen.outcome.value).toMatchObject({
      ok: true,
      period: { siteCode: "FROZEN", timezoneSupported: true },
      view: { kind: "CLOSED", version: 1, rows: [{ employeeCode: "OWN" }] },
    });
    expect(frozen.outcome.value.period).not.toHaveProperty("today");

    const draft = await meteredCall<{ ok: true; value: any }>(
      w,
      periods.preview,
      { periodId: await closedPeriod(w, employeeId, "DRAFT") },
      ACTOR,
    );
    expect(draft.outcome.value).toMatchObject({
      period: { today: TODAY },
      view: { kind: "DRAFT" },
    });
    // A revised draft's earlier frozen version stays readable by number.
    expect(
      (
        await meteredCall<{ ok: true; value: any }>(
          w,
          periods.preview,
          { periodId: closed, version: 1 },
          ACTOR,
        )
      ).meter.clock,
    ).toBe(0);
  });

  it("still dates the employee's own today answer with the server clock", async () => {
    const { w } = await world();
    const today = await meteredCall<{ ok: true; value: any }>(
      w,
      self.today,
      {},
      ACTOR,
    );
    expect(today.outcome.value).toMatchObject({ today: TODAY });
    expect(today.meter.clock).toBeGreaterThan(0);
  });
});
