/**
 * Staged period close beyond the former 50-employee cliff: paged review,
 * bounded build steps under a write freeze, exactly-once steps, discard on
 * failure or cancel, and publication of totals only on complete success.
 */
import type { GenericMutationCtx } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../convex/_generated/dataModel";
import * as periodClose from "../../convex/hr/periodClose";
import * as periods from "../../convex/hr/periods";
import * as self from "../../convex/hr/self";
import * as selfPeriods from "../../convex/hr/selfPeriods";
import * as setup from "../../convex/hr/setup";
import { fromLocal } from "../../convex/model/hr/calendar";
import type { DataModel } from "../../convex/schema";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";
import { meteredCall } from "../fixtures/hr-read-meter";

type Handler = {
  _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
};
// Test-only loose view of command and query answers.
type Answer = Record<string, any>;

const ADMIN = { subject: "user_fixture_a", org_id: "org_fixture_a" };
const TENANT_B = { subject: "user_fixture_a", org_id: "org_fixture_b" };
const START = "2026-10-05";
const END = "2026-10-07";
const DAYS = 3;
const SCHEDULE = {
  workDays: [1, 2, 3, 4, 5],
  startTime: "08:30",
  endTime: "17:30",
  endsNextDay: false,
  breakMinutes: 60,
};

let sequence = 0;
const rid = (label: string) => `${label}-${(sequence += 1)}-staged`;

async function call(
  world: ConvexTenantWorld,
  fn: unknown,
  args: unknown,
  identity = ADMIN,
): Promise<Answer> {
  const outcome = (await world.t
    .withIdentity(identity)
    .run((ctx) =>
      (fn as Handler)._handler(ctx as GenericMutationCtx<DataModel>, args),
    )) as { ok: boolean; value: Answer };
  expect(outcome.ok, JSON.stringify(outcome).slice(0, 300)).toBe(true);
  return outcome.value;
}
const written = (answer: Answer) => {
  expect(answer.written, JSON.stringify(answer).slice(0, 300)).toBe(true);
  return answer;
};
const refused = (answer: Answer, code: string) =>
  expect(answer).toMatchObject({ written: false, error: { code } });

async function fixture(employees: number) {
  const world = await createConvexTenantWorld();
  const auth = await seedConvexAuthorization(world, {
    roleA: "HR_ADMIN",
    roleB: "HR_ADMIN",
  });
  const ids = await world.t.run(async (ctx) => {
    for (const membership of [
      auth.identities.membershipA,
      auth.identities.membershipB,
    ])
      await ctx.db.patch("memberships", membership, { scopeMode: "ORG_WIDE" });
    const employeeIds: Id<"hrEmployees">[] = [];
    for (let index = 0; index < employees; index += 1)
      employeeIds.push(
        await ctx.db.insert("hrEmployees", {
          orgId: world.orgA,
          warehouseId: world.warehouses.alphaA,
          code: `E${String(index).padStart(4, "0")}`,
          displayName: `Employee ${index}`,
          // The first employee is linked to the acting user (self-service).
          ...(index === 0 ? { userId: world.userA } : {}),
          employmentStartDate: "2020-01-01",
          status: "ACTIVE",
          version: 1,
          createdAt: 1,
          updatedAt: 1,
          createdByUserId: world.userA,
          updatedByUserId: world.userA,
        }),
      );
    // Former staff are skipped by every bounded roster read.
    for (let index = 0; index < 30; index += 1)
      await ctx.db.insert("hrEmployees", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        code: `F${String(index).padStart(4, "0")}`,
        displayName: `Former ${index}`,
        employmentStartDate: "2020-01-01",
        employmentEndDate: "2021-01-01",
        status: "INACTIVE",
        version: 1,
        createdAt: 1,
        updatedAt: 1,
        createdByUserId: world.userA,
        updatedByUserId: world.userA,
      });
    return { employeeIds };
  });
  const created = written(
    await call(world, periods.create, {
      requestId: rid("create"),
      warehouseId: world.warehouses.alphaA,
      startDate: START,
      endDate: END,
    }),
  );
  return {
    world,
    ...ids,
    periodId: created.documentId as Id<"hrPeriods">,
  };
}

const preview = async (world: ConvexTenantWorld, periodId: string) =>
  await call(world, periods.preview, { periodId, clockFree: true });

/** Drive a close step by step from what the period view shows. */
async function drive(world: ConvexTenantWorld, periodId: string) {
  for (let guard = 0; guard < 100; guard += 1) {
    const view = (await preview(world, periodId)).view;
    if (view.kind !== "CLOSING" || view.state === "READY") return view;
    written(
      await call(world, periodClose.advance, {
        requestId: rid("advance"),
        periodId,
        versionId: view.versionId,
        step: view.step,
      }),
    );
  }
  throw new Error("close did not settle");
}

async function pages(
  world: ConvexTenantWorld,
  fn: unknown,
  args: Record<string, unknown>,
) {
  const items: Answer[] = [];
  let cursor: string | undefined;
  let scanCursor: string | undefined;
  for (let guard = 0; guard < 200; guard += 1) {
    const page = await call(world, fn, {
      ...args,
      pageSize: 50,
      ...(cursor === undefined ? {} : { cursor }),
      ...(scanCursor === undefined ? {} : { scanCursor }),
    });
    expect(page.ok, JSON.stringify(page).slice(0, 300)).toBe(true);
    items.push(...page.page);
    if (page.status === "scanning") {
      scanCursor = page.scanCursor;
      continue;
    }
    scanCursor = undefined;
    if (page.isDone) return items;
    cursor = page.continueCursor;
  }
  throw new Error("paging did not finish");
}

const counts = (world: ConvexTenantWorld) =>
  world.t.run(async (ctx) => ({
    versions: await ctx.db.query("hrPeriodVersions").collect(),
    rows: (await ctx.db.query("hrPeriodRows").collect()).length,
  }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(fromLocal("2026-10-13", 10 * 60, 420));
});
afterEach(() => vi.useRealTimers());

const EMPLOYEES = 120;

describe("staged close beyond 50 employees", () => {
  it("reviews in pages, builds in bounded steps and publishes totals only when complete", async () => {
    const { world, periodId } = await fixture(EMPLOYEES);
    const draft = await preview(world, periodId);
    expect(draft.view).toEqual({ kind: "PAGED", blocker: null });

    // Every employee is reviewable, one bounded page at a time.
    const reviewed = await pages(world, periods.draftEmployeesPage, {
      periodId,
    });
    expect(reviewed).toHaveLength(EMPLOYEES);
    expect(reviewed.every((item) => item.rows.length === DAYS)).toBe(true);
    expect(reviewed.every((item) => item.totals.ready === DAYS)).toBe(true);

    const begun = written(
      await call(world, periodClose.begin, {
        requestId: rid("begin"),
        periodId,
      }),
    );
    expect(begun).toMatchObject({ state: "BUILDING", step: 1, version: 1 });

    // A step reads a bounded slice of the roster, never all of it.
    const view = (await preview(world, periodId)).view;
    const metered = await meteredCall<{ ok: true; value: Answer }>(
      world,
      periodClose.advance,
      {
        requestId: rid("advance-metered"),
        periodId,
        versionId: view.versionId,
        step: view.step,
      },
      ADMIN,
    );
    expect(metered.outcome.value).toMatchObject({ written: true });
    expect(metered.meter.docs.hrEmployees).toBeLessThanOrEqual(
      periodClose.BUILD_SCAN,
    );
    expect(metered.meter.docs.hrAttendanceDays ?? 0).toBeLessThanOrEqual(
      periodClose.BUILD_EMPLOYEES * DAYS,
    );

    // While building, nothing is history: no version, row page or export.
    const staged = (await counts(world)).versions[0]!;
    expect(staged.build).toBeDefined();
    expect(
      await call(world, periods.preview, { periodId, version: 1 }),
    ).toMatchObject({ ok: false, code: "VERSION_NOT_FOUND" });
    expect(await pages(world, periods.versionsPage, { periodId })).toHaveLength(
      0,
    );
    refused(
      await call(world, periods.exportCsv, {
        requestId: rid("export-staged"),
        versionId: staged._id,
      }),
      "NOT_FOUND",
    );
    expect(
      (await call(world, selfPeriods.list, {})).items as unknown[],
    ).toHaveLength(0);

    const ready = await drive(world, periodId);
    expect(ready).toMatchObject({
      kind: "CLOSING",
      state: "READY",
      employees: EMPLOYEES,
      days: EMPLOYEES * DAYS,
      totals: { employees: EMPLOYEES, days: EMPLOYEES * DAYS },
    });
    refused(
      await call(world, periodClose.publish, {
        requestId: rid("publish-wrong"),
        periodId,
        versionId: ready.versionId,
        expectedFingerprint: "not-the-candidate",
      }),
      "PERIOD_STALE",
    );
    const published = written(
      await call(world, periodClose.publish, {
        requestId: rid("publish"),
        periodId,
        versionId: ready.versionId,
        expectedFingerprint: ready.fingerprint,
      }),
    );
    expect(published).toMatchObject({ version: 1 });

    const closed = await preview(world, periodId);
    expect(closed.period.status).toBe("CLOSED");
    // Bounded by frozen rows, not employees: 360 rows still show at once.
    expect(closed.view).toMatchObject({
      kind: "CLOSED",
      version: 1,
      rowsPaged: false,
      totals: { employees: EMPLOYEES, days: EMPLOYEES * DAYS },
    });
    expect(closed.view.rows).toHaveLength(EMPLOYEES * DAYS);
    const frozen = await pages(world, periods.versionRowsPage, {
      versionId: ready.versionId,
    });
    expect(frozen).toHaveLength(EMPLOYEES * DAYS);
    expect(frozen[0]).toMatchObject({ employeeCode: "E0000" });

    // The CSV arrives in whole-employee parts that join into one file.
    let content = "";
    let cursor: string | undefined;
    let parts = 0;
    for (;;) {
      const part = written(
        await call(world, periods.exportCsv, {
          requestId: rid("export"),
          versionId: ready.versionId,
          ...(cursor === undefined ? {} : { cursor }),
        }),
      );
      parts += 1;
      content += part.content;
      if (part.isDone) break;
      cursor = part.continueCursor;
    }
    expect(parts).toBeGreaterThan(0);
    const lines = content.trimEnd().split("\r\n");
    expect(lines).toHaveLength(EMPLOYEES * DAYS + 1);
    expect(lines.filter((line) => line.includes("period_id"))).toHaveLength(1);
    expect(content.startsWith("﻿")).toBe(true);
  });

  it("splits a large export into bounded parts", async () => {
    const { world, periodId } = await fixture(700);
    written(
      await call(world, periodClose.begin, {
        requestId: rid("begin"),
        periodId,
      }),
    );
    const ready = await drive(world, periodId);
    written(
      await call(world, periodClose.publish, {
        requestId: rid("publish"),
        periodId,
        versionId: ready.versionId,
        expectedFingerprint: ready.fingerprint,
      }),
    );
    // Beyond the single-read bound, the frozen rows are paged.
    expect((await preview(world, periodId)).view).toMatchObject({
      kind: "CLOSED",
      rowsPaged: true,
      rows: [],
      totals: { employees: 700, days: 700 * DAYS },
    });
    const first = written(
      await call(world, periods.exportCsv, {
        requestId: rid("export-1"),
        versionId: ready.versionId,
      }),
    );
    expect(first.isDone).toBe(false);
    expect(first.rowCount).toBeLessThanOrEqual(periods.EXPORT_PART_ROWS);
    const second = written(
      await call(world, periods.exportCsv, {
        requestId: rid("export-2"),
        versionId: ready.versionId,
        cursor: first.continueCursor,
      }),
    );
    expect(first.rowCount + second.rowCount).toBe(700 * DAYS);
    expect(second).toMatchObject({ isDone: true });
    expect(second.content.includes("period_id")).toBe(false);
  }, 60_000);

  it("freezes attendance, correction, holiday and roster writes while closing", async () => {
    const { world, periodId, employeeIds } = await fixture(60);
    written(
      await call(world, periodClose.begin, {
        requestId: rid("begin"),
        periodId,
      }),
    );
    refused(
      await call(world, self.submitCorrection, {
        requestId: rid("correction"),
        businessDate: "2026-10-06",
        start: { minute: 510, nextDay: false },
        end: { minute: 1050, nextDay: false },
        reason: "Forgot to clock in",
      }),
      "HR_PERIOD_CLOSING",
    );
    refused(
      await call(world, setup.saveHoliday, {
        requestId: rid("holiday"),
        warehouseId: world.warehouses.alphaA,
        date: "2026-10-06",
        name: "Late holiday",
      }),
      "HR_PERIOD_CLOSING",
    );
    const employee = await world.t.run((ctx) => ctx.db.get(employeeIds[5]!));
    refused(
      await call(world, setup.saveEmployee, {
        requestId: rid("employee"),
        employeeId: employee!._id,
        expectedVersion: employee!.version,
        warehouseId: world.warehouses.alphaA,
        code: employee!.code,
        displayName: "Renamed during close",
        employmentStartDate: employee!.employmentStartDate,
        status: "ACTIVE",
      }),
      "HR_PERIOD_CLOSING",
    );
    // A second close cannot start; another site stays writable.
    refused(
      await call(world, periodClose.begin, {
        requestId: rid("begin-again"),
        periodId,
      }),
      "PERIOD_CLOSE_IN_PROGRESS",
    );
    written(
      await call(world, setup.saveHoliday, {
        requestId: rid("other-site"),
        warehouseId: world.warehouses.bravoA,
        date: "2026-10-06",
        name: "Other site holiday",
      }),
    );
    // After publication the dates stay locked as CLOSED, roster edits resume.
    const ready = await drive(world, periodId);
    written(
      await call(world, periodClose.publish, {
        requestId: rid("publish"),
        periodId,
        versionId: ready.versionId,
        expectedFingerprint: ready.fingerprint,
      }),
    );
    refused(
      await call(world, self.submitCorrection, {
        requestId: rid("correction-closed"),
        businessDate: "2026-10-06",
        start: { minute: 510, nextDay: false },
        end: { minute: 1050, nextDay: false },
        reason: "Forgot to clock in",
      }),
      "HR_PERIOD_CLOSED",
    );
    written(
      await call(world, setup.saveEmployee, {
        requestId: rid("employee-after"),
        employeeId: employee!._id,
        expectedVersion: employee!.version,
        warehouseId: world.warehouses.alphaA,
        code: employee!.code,
        displayName: "Renamed after close",
        employmentStartDate: employee!.employmentStartDate,
        status: "ACTIVE",
      }),
    );
    // The frozen version keeps the name it was closed with.
    const frozen = await pages(world, periods.versionRowsPage, {
      versionId: ready.versionId,
    });
    expect(
      frozen.find((row) => row.employeeCode === employee!.code)?.employeeName,
    ).toBe("Employee 5");
  });

  it("applies each step exactly once and resumes an interrupted build", async () => {
    const { world, periodId } = await fixture(EMPLOYEES);
    written(
      await call(world, periodClose.begin, {
        requestId: rid("begin"),
        periodId,
      }),
    );
    const view = (await preview(world, periodId)).view;
    const args = {
      periodId,
      versionId: view.versionId,
      step: view.step,
    };
    const requestId = rid("advance");
    written(await call(world, periodClose.advance, { ...args, requestId }));
    const after = await counts(world);
    // The same delivery replays; a duplicate with a new request ID is stale.
    expect(
      await call(world, periodClose.advance, { ...args, requestId }),
    ).toMatchObject({ written: true, replayed: true });
    refused(
      await call(world, periodClose.advance, {
        ...args,
        requestId: rid("duplicate"),
      }),
      "PERIOD_CLOSE_STEP_STALE",
    );
    expect((await counts(world)).rows).toBe(after.rows);
    // The driver went away; whoever opens the period later resumes it.
    const ready = await drive(world, periodId);
    expect(ready).toMatchObject({ state: "READY", days: EMPLOYEES * DAYS });
    expect((await counts(world)).rows).toBe(EMPLOYEES * DAYS);
    refused(
      await call(world, periodClose.advance, {
        requestId: rid("after-ready"),
        periodId,
        versionId: ready.versionId,
        step: ready.step,
      }),
      "PERIOD_CLOSE_READY",
    );
  });

  it("discards a failed build in bounded steps and returns the draft with the reason", async () => {
    const { world, periodId, employeeIds } = await fixture(EMPLOYEES);
    // An employee late in the roster has an unresolved scheduled day.
    const blocked = employeeIds[100]!;
    await world.t.run((ctx) =>
      ctx.db.patch("hrEmployees", blocked, { schedule: SCHEDULE }),
    );
    written(
      await call(world, periodClose.begin, {
        requestId: rid("begin"),
        periodId,
      }),
    );
    const settled = await drive(world, periodId);
    expect(settled.kind).toBe("PAGED");
    expect(settled.closeFailure).toMatchObject({
      code: "PERIOD_NOT_READY",
      employeeId: blocked,
      businessDate: START,
    });
    // Nothing partial survives, and the version number is not consumed.
    expect(await counts(world)).toMatchObject({ versions: [], rows: 0 });
    const period = (await preview(world, periodId)).period;
    expect(period).toMatchObject({
      status: "DRAFT",
      draftVersion: 1,
      latestClosedVersion: 0,
    });

    // Once resolved, a new attempt closes; the failure is cleared.
    await world.t.run((ctx) =>
      ctx.db.patch("hrEmployees", blocked, { schedule: undefined }),
    );
    written(
      await call(world, periodClose.begin, {
        requestId: rid("retry"),
        periodId,
      }),
    );
    const ready = await drive(world, periodId);
    expect(ready).toMatchObject({ state: "READY" });
    expect(ready.failure).toBeUndefined();
  });

  it("discards a build whose sources changed after the snapshot", async () => {
    const { world, periodId, employeeIds } = await fixture(EMPLOYEES);
    written(
      await call(world, periodClose.begin, {
        requestId: rid("begin"),
        periodId,
      }),
    );
    // A write that bypassed the freeze (e.g. an operator repair) is caught
    // by explicit revision validation of the not-yet-processed employee.
    await world.t.run((ctx) =>
      ctx.db.patch("hrEmployees", employeeIds[90]!, {
        updatedAt: Date.now() + 1,
      }),
    );
    const settled = await drive(world, periodId);
    expect(settled.closeFailure).toMatchObject({
      code: "PERIOD_STALE",
      employeeId: employeeIds[90],
    });
    expect(await counts(world)).toMatchObject({ versions: [], rows: 0 });
  });

  it("cancels a ready candidate, deleting its rows over several bounded steps", async () => {
    const { world, periodId } = await fixture(200);
    written(
      await call(world, periodClose.begin, {
        requestId: rid("begin"),
        periodId,
      }),
    );
    const ready = await drive(world, periodId);
    expect(ready.days).toBe(600);
    expect(ready.days).toBeGreaterThan(periodClose.DISCARD_ROWS);
    const cancelled = written(
      await call(world, periodClose.cancel, {
        requestId: rid("cancel"),
        periodId,
        versionId: ready.versionId,
      }),
    );
    expect(cancelled).toMatchObject({ state: "CANCELLING" });
    refused(
      await call(world, periodClose.publish, {
        requestId: rid("publish-cancelled"),
        periodId,
        versionId: ready.versionId,
        expectedFingerprint: ready.fingerprint,
      }),
      "PERIOD_CLOSE_NOT_READY",
    );
    const settled = await drive(world, periodId);
    expect(settled.kind).toBe("PAGED");
    expect(settled.closeFailure).toBeUndefined();
    expect(await counts(world)).toMatchObject({ versions: [], rows: 0 });
  });

  it("keeps every close command inside its tenant", async () => {
    const { world, periodId } = await fixture(60);
    written(
      await call(world, periodClose.begin, {
        requestId: rid("begin"),
        periodId,
      }),
    );
    const view = (await preview(world, periodId)).view;
    for (const [fn, args] of [
      [periodClose.begin, { periodId }],
      [
        periodClose.advance,
        { periodId, versionId: view.versionId, step: view.step },
      ],
      [periodClose.cancel, { periodId, versionId: view.versionId }],
      [
        periodClose.publish,
        { periodId, versionId: view.versionId, expectedFingerprint: "x" },
      ],
    ] as const) {
      const answer = await world.t
        .withIdentity(TENANT_B)
        .run((ctx) =>
          (fn as unknown as Handler)._handler(
            ctx as GenericMutationCtx<DataModel>,
            { requestId: rid("foreign"), ...args },
          ),
        );
      // Refused by the tenant boundary or as not found; never applied.
      expect(JSON.stringify(answer)).not.toContain('"written":true');
    }
    expect(
      await call(
        world,
        periods.draftEmployeesPage,
        { periodId, pageSize: 20 },
        TENANT_B,
      ),
    ).toMatchObject({ ok: false });
    expect((await preview(world, periodId)).view).toMatchObject({
      state: "BUILDING",
      step: view.step,
    });
  });
});

describe("complete-preview close (up to 50 employees)", () => {
  it("publishes in one command when the build matches the reviewed fingerprint", async () => {
    const { world, periodId } = await fixture(50);
    const draft = await preview(world, periodId);
    expect(draft.view).toMatchObject({ kind: "DRAFT", blocker: null });
    const closed = written(
      await call(world, periodClose.begin, {
        requestId: rid("begin"),
        periodId,
        expectedFingerprint: draft.view.fingerprint,
      }),
    );
    expect(closed).toMatchObject({ state: "CLOSED", version: 1 });
    const version = (await counts(world)).versions[0]!;
    expect(version.build).toBeUndefined();
    expect(version.fingerprint).toBe(draft.view.fingerprint);
    expect(version.totals).toMatchObject({ employees: 50, days: 50 * DAYS });
  });

  it("keeps the deprecated one-step close working for tabs opened before the rollout", async () => {
    const { world, periodId } = await fixture(12);
    const draft = await preview(world, periodId);
    const args = {
      requestId: rid("legacy-close"),
      periodId,
      expectedFingerprint: draft.view.fingerprint,
    };
    const closed = written(await call(world, periods.close, args));
    expect(closed).toMatchObject({ version: 1, state: "CLOSED" });
    expect(await call(world, periods.close, args)).toMatchObject({
      written: true,
      replayed: true,
      documentId: closed.documentId,
    });
  });

  it("refuses a stale review before freezing anything", async () => {
    const { world, periodId, employeeIds } = await fixture(10);
    const draft = await preview(world, periodId);
    await world.t.run((ctx) =>
      ctx.db.patch("hrEmployees", employeeIds[3]!, {
        displayName: "Renamed after review",
      }),
    );
    refused(
      await call(world, periodClose.begin, {
        requestId: rid("stale"),
        periodId,
        expectedFingerprint: draft.view.fingerprint,
      }),
      "PERIOD_STALE",
    );
    expect((await preview(world, periodId)).period.status).toBe("DRAFT");
    expect(await counts(world)).toMatchObject({ versions: [], rows: 0 });
  });
});
