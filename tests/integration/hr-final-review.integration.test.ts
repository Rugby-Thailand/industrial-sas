import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { thailandDefaults } from "../../convex/model/hr/policy";
import { PAYSLIP_CSV_HEADER, pdfHash } from "../../convex/model/hr/payslip";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  seedSecondActorForOrgA,
} from "../fixtures/convex-tenant-world";
const actor = { subject: "user_fixture_a", org_id: "org_fixture_a" };
const refs = {
  preview: makeFunctionReference<"query">("hr/leave:preview"),
  submit: makeFunctionReference<"mutation">("hr/leave:submit"),
  resubmit: makeFunctionReference<"mutation">("hr/leave:resubmit"),
  decide: makeFunctionReference<"mutation">("hr/leave:decide"),
  detail: makeFunctionReference<"query">("hr/leave:selfDetail"),
  policyDraft: makeFunctionReference<"mutation">("hr/policies:saveDraft"),
  policyActivate: makeFunctionReference<"mutation">("hr/policies:activate"),
  payslipStage: makeFunctionReference<"mutation">("hr/payslips:stage"),
  payslipPublish: makeFunctionReference<"mutation">("hr/payslips:publish"),
  payslipList: makeFunctionReference<"query">("hr/payslips:list"),
  payslipImports: makeFunctionReference<"query">("hr/payslips:imports"),
  clockIn: makeFunctionReference<"mutation">("hr/self:clockIn"),
  clockOut: makeFunctionReference<"mutation">("hr/self:clockOut"),
};
function value<T = Record<string, unknown>>(outcome: unknown): T {
  expect(outcome).toMatchObject({ ok: true });
  return (outcome as { value: T }).value;
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 9, 12, 1));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
async function fixture() {
  const world = await createConvexTenantWorld({
    "../convex/hr/leave.ts": () => import("../../convex/hr/leave"),
    "../convex/hr/policies.ts": () => import("../../convex/hr/policies"),
    "../convex/hr/payslips.ts": () => import("../../convex/hr/payslips"),
    "../convex/hr/self.ts": () => import("../../convex/hr/self"),
  });
  await seedConvexAuthorization(world, { roleA: "HR_EMPLOYEE" });
  const reviewer = await seedSecondActorForOrgA(world, "HR_ADMIN");
  const seeded = await world.t.run(async (ctx) => {
    const employee = (code: string, userId?: Id<"users">) =>
      ctx.db.insert("hrEmployees", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        code,
        displayName: code,
        ...(userId ? { userId } : {}),
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
        updatedAt: 1,
        createdByUserId: world.userA,
        updatedByUserId: world.userA,
      });
    const own = await employee("ONE", world.userA),
      other = await employee("TWO");
    const account = await ctx.db.insert("hrLeaveAccounts", {
      orgId: world.orgA,
      employeeId: own,
      warehouseId: world.warehouses.alphaA,
      type: "ANNUAL",
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      granted: 6,
      used: 0,
      reserved: 0,
      paidUsed: 0,
      paidReserved: 0,
      asOf: "2026-10-12",
      sourceReference: "Signed register",
      version: 1,
      reconciledByUserId: reviewer.userId,
      reconciledAt: 1,
    });
    await ctx.db.insert("hrPolicyVersions", {
      orgId: world.orgA,
      capability: "LEAVE",
      config: thailandDefaults(),
      effectiveDate: "2020-01-01",
      version: 1,
      draftVersion: 1,
      preset: "TH_TEST",
      coverageConfirmed: true,
      existingBenefitsReviewed: true,
      activatedAt: 1,
      activatedByUserId: reviewer.userId,
    });
    return { own, other, account };
  });
  const client = world.t.withIdentity(actor),
    review = world.t.withIdentity({
      subject: reviewer.clerkUserId,
      org_id: actor.org_id,
    });
  const fields = {
    type: "ANNUAL",
    from: "2026-10-13",
    to: "2026-10-13",
    reason: "Annual leave for family",
  };
  const prepared = async (
    draft = fields,
    retained?: { leaveRequestId: string; expectedVersion: number },
  ) =>
    value<{
      ok: true;
      previewHash: string;
      days: number;
      dates: string[];
      paidDays: number;
    }>(await client.query(refs.preview, { ...draft, ...retained }));
  const submit = async () => {
    const preview = await prepared();
    const args = {
      requestId: "independent-leave-submit",
      ...fields,
      expectedPreviewHash: preview.previewHash,
    };
    const receipt = value<{
      written: true;
      documentId: Id<"hrLeaveRequests">;
      version: number;
    }>(await client.mutation(refs.submit, args));
    expect(receipt.written).toBe(true);
    return { args, receipt, preview };
  };
  const relink = () =>
    world.t.run(async (ctx) => {
      await ctx.db.patch(seeded.own, { userId: undefined });
      await ctx.db.patch(seeded.other, { userId: world.userA });
    });
  return {
    world,
    ...seeded,
    client,
    review,
    reviewerMembership: reviewer.membershipId,
    fields,
    prepared,
    submit,
    relink,
  };
}
it("binds preview to current account evidence and stores the exact charge shown", async () => {
  const f = await fixture();
  const preview = await f.prepared();
  await f.world.t.run((ctx) => ctx.db.patch(f.account, { version: 2 }));
  expect(
    value(
      await f.client.mutation(refs.submit, {
        requestId: "independent-stale-preview",
        ...f.fields,
        expectedPreviewHash: preview.previewHash,
      }),
    ),
  ).toMatchObject({ written: false, error: { code: "LEAVE_PREVIEW_STALE" } });
  expect(
    await f.world.t.run((ctx) => ctx.db.query("hrLeaveRequests").collect()),
  ).toEqual([]);
  const submitted = await f.submit();
  const stored = await f.world.t.run((ctx) =>
    ctx.db.get(submitted.receipt.documentId),
  );
  expect(stored).toMatchObject({
    days: submitted.preview.days,
    dates: submitted.preview.dates,
    paidDays: submitted.preview.paidDays,
  });
});
it("refuses an old submission receipt after the same actor is linked to another employee", async () => {
  const f = await fixture(),
    submitted = await f.submit();
  await f.relink();
  expect(
    value(await f.client.mutation(refs.submit, submitted.args)),
  ).toMatchObject({ written: false });
});
it("resubmits the retained ID with immutable prior charges and refuses its receipt after relinking", async () => {
  const f = await fixture(),
    submitted = await f.submit();
  expect(
    value(
      await f.review.mutation(refs.decide, {
        requestId: "independent-return-leave",
        leaveRequestId: submitted.receipt.documentId,
        expectedVersion: 1,
        decision: "RETURN",
        reason: "Please correct the requested date",
      }),
    ),
  ).toMatchObject({ written: true });
  const changed = {
    ...f.fields,
    from: "2026-10-14",
    to: "2026-10-14",
    reason: "Corrected requested date",
  };
  const preview = await f.prepared(changed, {
    leaveRequestId: submitted.receipt.documentId,
    expectedVersion: 2,
  });
  const args = {
    requestId: "independent-retained-resubmit",
    leaveRequestId: submitted.receipt.documentId,
    expectedVersion: 2,
    expectedPreviewHash: preview.previewHash,
    ...changed,
  };
  expect(value(await f.client.mutation(refs.resubmit, args))).toMatchObject({
    written: true,
    documentId: submitted.receipt.documentId,
    version: 3,
  });
  const detail = value<{
    item: { dates: string[]; history: { action: string }[] };
    revisions: { version: number; snapshot: { dates: string[] } }[];
  }>(
    await f.client.query(refs.detail, {
      leaveRequestId: submitted.receipt.documentId,
    }),
  );
  expect(detail.item.dates).toEqual(["2026-10-14"]);
  expect(detail.item.history.map((entry) => entry.action)).toEqual([
    "SUBMITTED",
    "RETURNED",
    "RESUBMITTED",
  ]);
  expect(detail.revisions).toMatchObject([
    { version: 2, snapshot: { dates: ["2026-10-13"] } },
  ]);
  const ledger = await f.world.t.run((ctx) =>
    ctx.db.query("hrLeaveLedger").collect(),
  );
  expect(ledger.map((entry) => entry.kind)).toEqual([
    "RESERVE",
    "RELEASE",
    "RESERVE",
  ]);
  await f.relink();
  expect(value(await f.client.mutation(refs.resubmit, args))).toMatchObject({
    written: false,
  });
});

it("rechecks organization-wide policy scope before replaying draft or activation receipts", async () => {
  const f = await fixture();
  const draftArgs = {
    requestId: "independent-policy-save",
    capability: "ANNOUNCEMENTS",
    expectedVersion: 0,
    effectiveDate: "2026-10-12",
    config: thailandDefaults(),
  };
  expect(
    value(await f.review.mutation(refs.policyDraft, draftArgs)),
  ).toMatchObject({ written: true });
  const activationArgs = {
    requestId: "independent-policy-activate",
    capability: "ANNOUNCEMENTS",
    expectedVersion: 1,
    coverageConfirmed: true,
    existingBenefitsReviewed: true,
  };
  expect(
    value(await f.review.mutation(refs.policyActivate, activationArgs)),
  ).toMatchObject({ written: true });
  await f.world.t.run((ctx) =>
    ctx.db.patch(f.reviewerMembership, { scopeMode: "WAREHOUSE_SCOPED" }),
  );
  expect(
    value(await f.review.mutation(refs.policyDraft, draftArgs)),
  ).toMatchObject({ written: false });
  expect(
    value(await f.review.mutation(refs.policyActivate, activationArgs)),
  ).toMatchObject({ written: false });
});

it("publishes the exact selected source set, including deliberate exclusion of a valid employee row", async () => {
  vi.stubEnv("HR_PAYSLIP_PROVIDER_FRESHNESS_ENABLED", "true");
  vi.stubEnv("HR_PAYSLIP_PRIVATE_STORAGE_ENABLED", "true");
  const f = await fixture();
  await f.world.t.run((ctx) =>
    ctx.db.insert("hrPolicyVersions", {
      orgId: f.world.orgA,
      capability: "PAYSLIPS",
      config: thailandDefaults(),
      effectiveDate: "2020-01-01",
      version: 1,
      draftVersion: 1,
      preset: "TH_TEST",
      coverageConfirmed: true,
      existingBenefitsReviewed: true,
      activatedAt: 1,
      activatedByUserId: f.world.userA,
    }),
  );
  const csv = [
    PAYSLIP_CSV_HEADER,
    "ONE,2026-10-01,2026-10-31,2026-10-30,30000.00,1000.00,29000.00",
    "TWO,2026-10-01,2026-10-31,2026-10-30,25000.00,1000.00,24000.00",
  ].join("\n");
  const original = "%PDF-1.7\nPrivate original for TWO\n%%EOF\n";
  const stage = value<{ written: true; documentId: Id<"hrPayslipImports"> }>(
    await f.review.mutation(refs.payslipStage, {
      requestId: "independent-selected-source",
      from: "2026-10-01",
      to: "2026-10-31",
      sourceName: "Approved payroll register.csv",
      sourceConfirmed: true,
      csv,
      exclusions: [{ rowNumber: 2, reason: "Hold until payroll approval" }],
      documents: [
        {
          employeeCode: "TWO",
          base64: btoa(original),
          expectedHash: await pdfHash(new TextEncoder().encode(original)),
        },
      ],
    }),
  );
  expect(stage.written).toBe(true);
  expect(
    value(
      await f.review.mutation(refs.payslipPublish, {
        requestId: "independent-selected-publish",
        importId: stage.documentId,
        replacementConfirmed: false,
      }),
    ),
  ).toMatchObject({ written: true });
  const rows = await f.world.t.run((ctx) =>
    ctx.db.query("hrPayslipRows").collect(),
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    employeeId: f.other,
    employeeCode: "TWO",
    net: 2400000,
    publishedAt: expect.any(Number),
  });
  const notifications = await f.world.t.run((ctx) =>
    ctx.db.query("hrNotifications").collect(),
  );
  expect(notifications).toHaveLength(1);
  expect(notifications[0]).toMatchObject({ employeeId: f.other });
  const batch = await f.world.t.run((ctx) => ctx.db.get(stage.documentId));
  expect(batch?.status).toBe("PUBLISHED");
  expect(batch?.sourceCsv).toBe(csv);
  expect(batch?.exclusions).toMatchObject([
    {
      rowNumber: 2,
      employeeCode: "ONE",
      reason: "Hold until payroll approval",
    },
  ]);
  expect(value(await f.client.query(refs.payslipList, {}))).toMatchObject({
    items: [],
  });
  const imports = value<{ items: unknown[] }>(
    await f.review.query(refs.payslipImports, {}),
  );
  expect(imports.items).toHaveLength(1);
  expect(JSON.stringify(imports)).not.toContain(original);
  expect(JSON.stringify(imports)).not.toContain(btoa(original));
  expect(JSON.stringify(imports)).not.toContain(csv);
});

it("replays owned clock receipts on a later date but refuses both after employee relinking without any new writes", async () => {
  const f = await fixture();
  const inArgs = {
    requestId: "independent-clock-in",
    expectedBusinessDate: "2026-10-12",
  };
  const outArgs = {
    requestId: "independent-clock-out",
    expectedBusinessDate: "2026-10-12",
  };
  const clockIn = value(await f.client.mutation(refs.clockIn, inArgs));
  expect(clockIn).toMatchObject({
    written: true,
    kind: "CLOCK_IN",
    businessDate: "2026-10-12",
  });
  vi.setSystemTime(Date.UTC(2026, 9, 12, 10));
  const clockOut = value(await f.client.mutation(refs.clockOut, outArgs));
  expect(clockOut).toMatchObject({
    written: true,
    kind: "CLOCK_OUT",
    businessDate: "2026-10-12",
  });
  const before = await f.world.t.run(async (ctx) => ({
    events: await ctx.db.query("hrAttendanceEvents").collect(),
    days: await ctx.db.query("hrAttendanceDays").collect(),
  }));
  vi.setSystemTime(Date.UTC(2026, 9, 13, 1));
  expect(value(await f.client.mutation(refs.clockIn, inArgs))).toMatchObject({
    written: true,
    replayed: true,
    documentId: clockIn.documentId,
  });
  expect(value(await f.client.mutation(refs.clockOut, outArgs))).toMatchObject({
    written: true,
    replayed: true,
    documentId: clockOut.documentId,
  });
  await f.relink();
  expect(value(await f.client.mutation(refs.clockIn, inArgs))).toMatchObject({
    written: false,
  });
  expect(value(await f.client.mutation(refs.clockOut, outArgs))).toMatchObject({
    written: false,
  });
  const after = await f.world.t.run(async (ctx) => ({
    events: await ctx.db.query("hrAttendanceEvents").collect(),
    days: await ctx.db.query("hrAttendanceDays").collect(),
  }));
  expect(after).toEqual(before);
});

it("refuses an uncommitted clock intent from yesterday instead of creating today's clock event", async () => {
  const f = await fixture();
  vi.setSystemTime(Date.UTC(2026, 9, 13, 1));
  expect(
    value(
      await f.client.mutation(refs.clockIn, {
        requestId: "independent-old-day-unsaved",
        expectedBusinessDate: "2026-10-12",
      }),
    ),
  ).toMatchObject({ written: false, error: { code: "HR_CLOCK_DAY_CHANGED" } });
  expect(
    await f.world.t.run((ctx) => ctx.db.query("hrAttendanceEvents").collect()),
  ).toEqual([]);
  expect(
    await f.world.t.run((ctx) => ctx.db.query("hrAttendanceDays").collect()),
  ).toEqual([]);
  expect(
    value(
      await f.client.mutation(refs.clockIn, {
        requestId: "independent-new-day-clock-in",
        expectedBusinessDate: "2026-10-13",
      }),
    ),
  ).toMatchObject({ written: true });
  const originalDay = await f.world.t.run((ctx) =>
    ctx.db.query("hrAttendanceDays").collect(),
  );
  expect(
    value(
      await f.client.mutation(refs.clockOut, {
        requestId: "independent-old-day-clock-out-unsaved",
        expectedBusinessDate: "2026-10-12",
      }),
    ),
  ).toMatchObject({
    written: false,
    error: { code: "HR_CLOCK_DAY_CHANGED" },
  });
  expect(
    await f.world.t.run((ctx) => ctx.db.query("hrAttendanceEvents").collect()),
  ).toHaveLength(1);
  expect(
    await f.world.t.run((ctx) => ctx.db.query("hrAttendanceDays").collect()),
  ).toEqual(originalDay);
});
