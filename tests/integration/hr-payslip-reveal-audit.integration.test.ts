import { afterEach, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import * as payslips from "../../convex/hr/payslips";
import { PAYSLIP_CSV_HEADER, pdfHash } from "../../convex/model/hr/payslip";
import { POLICY_PRESET, thailandDefaults } from "../../convex/model/hr/policy";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
} from "../fixtures/convex-tenant-world";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

it("independent reveals after a committed download ticket each create a reveal audit record", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const now = Date.UTC(2026, 9, 12, 3);
  vi.setSystemTime(now);
  vi.stubEnv("HR_PAYSLIP_PROVIDER_FRESHNESS_ENABLED", "true");
  vi.stubEnv("HR_PAYSLIP_PRIVATE_STORAGE_ENABLED", "true");
  const w = await createConvexTenantWorld({
    "../convex/hr/payslips.ts": () => Promise.resolve(payslips),
  });
  const auth = await seedConvexAuthorization(w, { roleA: "HR_ADMIN" });
  await w.t.run(async (ctx) => {
    await ctx.db.patch("memberships", auth.identities.membershipA, {
      scopeMode: "ORG_WIDE",
    });
    await ctx.db.insert("hrEmployees", {
      orgId: w.orgA,
      warehouseId: w.warehouses.alphaA,
      code: "E1",
      displayName: "Employee",
      userId: w.userA,
      employmentStartDate: "2020-01-01",
      status: "ACTIVE",
      version: 1,
      createdAt: 1,
      updatedAt: 1,
      createdByUserId: w.userA,
      updatedByUserId: w.userA,
    });
    await ctx.db.insert("hrPolicyVersions", {
      orgId: w.orgA,
      capability: "PAYSLIPS",
      config: thailandDefaults(),
      effectiveDate: "2026-10-01",
      version: 1,
      draftVersion: 1,
      preset: POLICY_PRESET,
      coverageConfirmed: true,
      existingBenefitsReviewed: true,
      activatedAt: now,
      activatedByUserId: w.userA,
    });
  });
  const client = w.t.withIdentity({
    subject: "user_fixture_a",
    org_id: "org_fixture_a",
    sid: "session_fresh",
    iat: Math.floor(now / 1000),
    fva: [0, -1],
  });
  const pdf = "%PDF-1.7\nPayroll E1\n%%EOF\n";
  const staged = await client.mutation(api.hr.payslips.stage, {
    requestId: "reveal-audit-stage",
    from: "2026-10-01",
    to: "2026-10-31",
    sourceName: "Payroll.csv",
    sourceConfirmed: true,
    csv: `${PAYSLIP_CSV_HEADER}\nE1,2026-10-01,2026-10-31,2026-10-30,30000.00,1000.00,29000.00`,
    documents: [
      {
        employeeCode: "E1",
        base64: btoa(pdf),
        expectedHash: await pdfHash(new TextEncoder().encode(pdf)),
      },
    ],
  });
  expect(staged).toMatchObject({ ok: true, value: { written: true } });
  if (!staged.ok || !staged.value.written)
    throw new Error("stage authorization failed");
  const published = await client.mutation(api.hr.payslips.publish, {
    requestId: "reveal-audit-publish",
    importId: staged.value.documentId,
    replacementConfirmed: false,
  });
  expect(published).toMatchObject({ ok: true, value: { written: true } });
  const row = await w.t.run((ctx) => ctx.db.query("hrPayslipRows").first());
  if (!row) throw new Error("missing published row");
  const requestId = "download-ticket-intent";
  // A ticket can commit before its HTTP response is lost. Later reveal actions
  // use their own identities while the ticket identity remains for a download retry.
  expect(
    await client.mutation(api.hr.payslips.ticket, {
      requestId,
      rowId: row._id,
    }),
  ).toMatchObject({ ok: true, value: { written: true } });
  const first = await client.mutation(api.hr.payslips.detail, {
    requestId: "first-reveal-intent",
    rowId: row._id,
  });
  vi.setSystemTime(now + 10_000);
  const second = await client.mutation(api.hr.payslips.detail, {
    requestId: "second-reveal-intent",
    rowId: row._id,
  });
  expect(first).toMatchObject({
    ok: true,
    value: { written: true, replayed: false, gross: 3000000 },
  });
  expect(second).toMatchObject({
    ok: true,
    value: { written: true, replayed: false, gross: 3000000 },
  });
  const audits = await w.t.run((ctx) => ctx.db.query("auditEvents").collect());
  expect(
    audits.filter(
      (event) =>
        event.action === "hr.payslip.reveal" && event.outcome === "ALLOWED",
    ),
  ).toHaveLength(2);
});
