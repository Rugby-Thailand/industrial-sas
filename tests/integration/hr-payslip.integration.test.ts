import type { GenericMutationCtx } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as payslips from "../../convex/hr/payslips";
import type { DataModel } from "../../convex/schema";
import type { Id } from "../../convex/_generated/dataModel";
import { PAYSLIP_CSV_HEADER, pdfHash } from "../../convex/model/hr/payslip";
import { POLICY_PRESET, thailandDefaults } from "../../convex/model/hr/policy";
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
    error?: { code: string };
  };
};
type Identity = {
  subject: string;
  org_id: string;
  sid?: string;
  iat?: number;
  fva?: number[];
};
const now = Date.UTC(2026, 9, 12, 3);
const ADMIN: Identity = { subject: "user_fixture_a", org_id: "org_fixture_a" };
const OTHER: Identity = {
  subject: "user_payslip_other",
  org_id: "org_fixture_a",
};
const TENANT_B: Identity = {
  subject: "user_fixture_a",
  org_id: "org_fixture_b",
};
const fresh = (identity = ADMIN): Identity => ({
  ...identity,
  sid: "session_fresh",
  iat: Math.floor(Date.now() / 1000),
  fva: [0, -1],
});
let sequence = 0;
const rid = () => `payslip-private-test-${++sequence}`;
async function call(
  world: ConvexTenantWorld,
  fn: unknown,
  args: unknown,
  identity = ADMIN,
) {
  if (
    (fn === payslips.detail || fn === payslips.document) &&
    typeof args === "object" &&
    args !== null
  )
    args = { requestId: rid(), ...args };
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
function refused(outcome: Outcome, code: string) {
  expect(result(outcome)).toMatchObject({ written: false, error: { code } });
}
async function fixture(requireFileHash = true) {
  const world = await createConvexTenantWorld();
  const auth = await seedConvexAuthorization(world, {
    roleA: "HR_ADMIN",
    roleB: "HR_ADMIN",
  });
  const ids = await world.t.run(async (ctx) => {
    await ctx.db.patch("memberships", auth.identities.membershipA, {
      scopeMode: "ORG_WIDE",
    });
    const otherUser = await ctx.db.insert("users", {
      clerkUserId: OTHER.subject,
      displayName: "Other employee",
      status: "ACTIVE",
    });
    const membership = await ctx.db.insert("memberships", {
      orgId: world.orgA,
      userId: otherUser,
      clerkMembershipId: "payslip_other",
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
    const employee = async (
      orgId: typeof world.orgA,
      warehouseId: typeof world.warehouses.alphaA,
      code: string,
      userId: typeof world.userA,
    ) =>
      await ctx.db.insert("hrEmployees", {
        orgId,
        warehouseId,
        code,
        displayName: code,
        userId,
        employmentStartDate: "2020-01-01",
        status: "ACTIVE",
        version: 1,
        createdAt: 1,
        updatedAt: 1,
        createdByUserId: world.userA,
        updatedByUserId: world.userA,
      });
    const employeeId = await employee(
      world.orgA,
      world.warehouses.alphaA,
      "E1",
      world.userA,
    );
    await employee(world.orgA, world.warehouses.alphaA, "E2", otherUser);
    await employee(world.orgB, world.warehouses.alphaB, "E1", world.userA);
    const policyId = await ctx.db.insert("hrPolicyVersions", {
      orgId: world.orgA,
      capability: "PAYSLIPS",
      config: { ...thailandDefaults(), requireFileHash },
      effectiveDate: "2026-10-01",
      version: 1,
      draftVersion: 1,
      preset: POLICY_PRESET,
      coverageConfirmed: true,
      existingBenefitsReviewed: true,
      activatedAt: now,
      activatedByUserId: world.userA,
    });
    await ctx.db.insert("hrPolicyVersions", {
      orgId: world.orgB,
      capability: "PAYSLIPS",
      config: thailandDefaults(),
      effectiveDate: "2026-10-01",
      version: 1,
      draftVersion: 1,
      preset: POLICY_PRESET,
      coverageConfirmed: true,
      existingBenefitsReviewed: true,
      activatedAt: now,
      activatedByUserId: world.userA,
    });
    return { employeeId, policyId };
  });
  return { world, ...ids };
}
async function source(code = "E1", net = "29000.00") {
  const text = `%PDF-1.7\nPrivate payroll original ${code} net ${net}\n%%EOF\n`;
  const base64 = btoa(text);
  const expectedHash = await pdfHash(new TextEncoder().encode(text));
  const csv = `${PAYSLIP_CSV_HEADER}\n${code},2026-10-01,2026-10-31,2026-10-30,30000.00,1000.00,${net}`;
  return {
    requestId: rid(),
    from: "2026-10-01",
    to: "2026-10-31",
    sourceName: "Verified payroll register.csv",
    csv,
    sourceConfirmed: true,
    documents: [{ employeeCode: code, base64, expectedHash }],
  };
}
async function published(world: ConvexTenantWorld) {
  const args = await source();
  const staged = written(await call(world, payslips.stage, args));
  written(
    await call(world, payslips.publish, {
      requestId: rid(),
      importId: staged.documentId,
      replacementConfirmed: false,
    }),
  );
  const row = await world.t.run((ctx) =>
    ctx.db
      .query("hrPayslipRows")
      .filter((q) => q.eq(q.field("importId"), String(staged.documentId)))
      .first(),
  );
  return { row: row!, staged, args };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubEnv("HR_PAYSLIP_PROVIDER_FRESHNESS_ENABLED", "true");
  vi.stubEnv("HR_PAYSLIP_PRIVATE_STORAGE_ENABLED", "true");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
describe("private immutable payroll imports", () => {
  it("reconciles source amounts and PDFs before a single staged write; staging stays hidden from employees", async () => {
    const { world } = await fixture();
    const args = await source();
    refused(
      await call(world, payslips.stage, { ...args, sourceConfirmed: false }),
      "PAYSLIP_SOURCE_CONFIRMATION_REQUIRED",
    );
    refused(
      await call(world, payslips.stage, {
        ...args,
        requestId: rid(),
        documents: [{ ...args.documents[0]!, expectedHash: "0".repeat(64) }],
      }),
      "PAYSLIP_HASH_MISMATCH",
    );
    expect(
      await world.t.run((ctx) => ctx.db.query("hrPayslipImports").collect()),
    ).toHaveLength(0);
    const saved = written(await call(world, payslips.stage, args));
    expect(saved.rowCount).toBe(1);
    expect(written(await call(world, payslips.stage, args)).replayed).toBe(
      true,
    );
    expect(result(await call(world, payslips.list, {})).items).toEqual([]);
  });
  it("honors the configurable hash requirement while always preserving calculated integrity hashes", async () => {
    const { world } = await fixture(false);
    const args = await source();
    const withoutHash = {
      ...args,
      documents: args.documents.map((document) => ({
        employeeCode: document.employeeCode,
        base64: document.base64,
      })),
    };
    written(await call(world, payslips.stage, withoutHash));
    const row = await world.t.run((ctx) =>
      ctx.db.query("hrPayslipRows").first(),
    );
    expect(row?.sourceHash).toBe(args.documents[0]!.expectedHash);
  });
  it("lists published metadata without leaking private amounts or original bytes", async () => {
    const { world } = await fixture();
    const { row } = await published(world);
    const out = result(await call(world, payslips.list, {}));
    expect(out).toMatchObject({
      items: [{ id: row._id, version: 1 }],
      capabilityAvailable: true,
    });
    for (const secret of [
      "gross",
      "deductions",
      "net",
      "sourceBase64",
      "sourceCsv",
    ]) {
      expect(JSON.stringify(out)).not.toContain(`\"${secret}\"`);
    }
    expect(
      result(await call(world, payslips.detail, { rowId: row._id })),
    ).toMatchObject({
      written: false,
      error: { code: "REVERIFICATION_REQUIRED" },
    });
  });
  it("publishes replacements explicitly and retains the old original amount/version immutably", async () => {
    const { world } = await fixture();
    const { row } = await published(world);
    const replacement = await source();
    replacement.csv = replacement.csv.replace(
      "30000.00,1000.00,29000.00",
      "31000.00,1000.00,30000.00",
    );
    const staged = written(await call(world, payslips.stage, replacement));
    refused(
      await call(world, payslips.publish, {
        requestId: rid(),
        importId: staged.documentId,
        replacementConfirmed: false,
      }),
      "PAYSLIP_REPLACEMENT_CONFIRMATION_REQUIRED",
    );
    const args = {
      requestId: rid(),
      importId: staged.documentId,
      replacementConfirmed: true,
    };
    written(await call(world, payslips.publish, args));
    written(await call(world, payslips.publish, args));
    const rows = await world.t.run((ctx) =>
      ctx.db.query("hrPayslipRows").collect(),
    );
    expect(rows.find((candidate) => candidate._id === row._id)).toMatchObject({
      gross: 3000000,
      version: 1,
      supersededById: expect.any(String),
    });
    expect(rows.find((candidate) => candidate.version === 2)).toMatchObject({
      gross: 3100000,
      net: 3000000,
      predecessorId: row._id,
    });
    expect(
      result(await call(world, payslips.detail, { rowId: row._id }, fresh())),
    ).toMatchObject({ written: false, error: { code: "NOT_FOUND" } });
    expect(
      await world.t.run((ctx) => ctx.db.query("hrNotifications").collect()),
    ).toHaveLength(2);
  });
  it("refuses a stale staged predecessor after a competing replacement publishes", async () => {
    const { world } = await fixture();
    await published(world);
    const first = written(await call(world, payslips.stage, await source()));
    const second = written(await call(world, payslips.stage, await source()));
    written(
      await call(world, payslips.publish, {
        requestId: rid(),
        importId: first.documentId,
        replacementConfirmed: true,
      }),
    );
    refused(
      await call(world, payslips.publish, {
        requestId: rid(),
        importId: second.documentId,
        replacementConfirmed: true,
      }),
      "PAYSLIP_PUBLICATION_STALE",
    );
  });
  it("denies site-scoped imports and foreign-organization batch publication", async () => {
    const { world } = await fixture();
    const { staged } = await published(world);
    refused(
      await call(
        world,
        payslips.publish,
        {
          requestId: rid(),
          importId: staged.documentId,
          replacementConfirmed: true,
        },
        TENANT_B,
      ),
      "NOT_FOUND",
    );
    await world.t.run(async (ctx) => {
      const membership = await ctx.db
        .query("memberships")
        .withIndex("by_orgId_userId", (q) =>
          q.eq("orgId", world.orgA).eq("userId", world.userA),
        )
        .unique();
      await ctx.db.patch("memberships", membership!._id, {
        scopeMode: "WAREHOUSE_SCOPED",
      });
    });
    refused(
      await call(world, payslips.stage, await source()),
      "POLICY_ORG_SCOPE_REQUIRED",
    );
    expect(result(await call(world, payslips.imports, {}))).toMatchObject({
      ok: false,
      code: "POLICY_ORG_SCOPE_REQUIRED",
    });
  });
});
describe("source and audit integrity", () => {
  it("refuses to publish altered staged totals before publishing any employee statement", async () => {
    const { world } = await fixture();
    const stage = written(await call(world, payslips.stage, await source()));
    await world.t.run(async (ctx) => {
      const row = (await ctx.db.query("hrPayslipRows").first())!;
      await ctx.db.patch("hrPayslipRows", row._id, { net: row.net + 100 });
    });
    refused(
      await call(world, payslips.publish, {
        requestId: rid(),
        importId: stage.documentId,
        replacementConfirmed: false,
      }),
      "PAYSLIP_SOURCE_INTEGRITY_FAILED",
    );
    expect(
      await world.t.run((ctx) => ctx.db.query("hrNotifications").collect()),
    ).toHaveLength(0);
    expect(
      await world.t.run((ctx) => ctx.db.query("hrPayslipImports").first()),
    ).toMatchObject({ status: "STAGED" });
  });
  it("serves exact deep-link metadata without an unverified salary payload", async () => {
    const { world } = await fixture();
    const { row } = await published(world);
    const value = result(
      await call(world, payslips.metadata, { rowId: row._id }),
    );
    expect(value).toMatchObject({
      ok: true,
      item: { id: row._id },
      verificationMinutes: 5,
    });
    expect(JSON.stringify(value)).not.toContain("gross");
    expect(
      result(await call(world, payslips.metadata, { rowId: row._id }, OTHER)),
    ).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
  it("audits reveal and document delivery without recording salary amounts or original bytes", async () => {
    const { world } = await fixture();
    const { row, args } = await published(world);
    written(
      await call(
        world,
        payslips.detail,
        { requestId: rid(), rowId: row._id },
        fresh(),
      ),
    );
    const ticket = written(
      await call(
        world,
        payslips.ticket,
        { requestId: rid(), rowId: row._id },
        fresh(),
      ),
    );
    written(
      await call(
        world,
        payslips.document,
        { requestId: rid(), ticketId: ticket.documentId },
        fresh(),
      ),
    );
    const audit = await world.t.run((ctx) =>
      ctx.db.query("auditEvents").collect(),
    );
    expect(audit.map((event) => event.action)).toEqual(
      expect.arrayContaining([
        "hr.payslip.reveal",
        "hr.payslip.document",
        "hr.payslip.download",
      ]),
    );
    const json = JSON.stringify(audit);
    for (const secret of [
      args.documents[0]!.base64,
      args.csv,
      "gross",
      "deductions",
      "net:2900000",
    ]) {
      expect(json).not.toContain(secret);
    }
  });
});

describe("signed-session salary reveal and short private download grants", () => {
  it("requires actual signed freshness claims, refuses stale tokens, and expires an already fresh reveal", async () => {
    const { world } = await fixture();
    const { row } = await published(world);
    const identity = fresh();
    expect(
      result(await call(world, payslips.detail, { rowId: row._id }, identity)),
    ).toMatchObject({
      written: true,
      gross: 3000000,
      net: 2900000,
      expiresAt: now + 4 * 60000,
    });
    expect(
      result(
        await call(
          world,
          payslips.detail,
          { rowId: row._id },
          { ...identity, fva: [5, 0] },
        ),
      ),
    ).toMatchObject({
      written: false,
      error: { code: "REVERIFICATION_REQUIRED" },
    });
    vi.setSystemTime(now + 4 * 60000);
    expect(
      result(await call(world, payslips.detail, { rowId: row._id }, identity)),
    ).toMatchObject({
      written: false,
      error: { code: "REVERIFICATION_REQUIRED" },
    });
  });
  it("denies other employees and other tenants even when provider verification is fresh", async () => {
    const { world } = await fixture();
    const { row } = await published(world);
    for (const identity of [fresh(OTHER), fresh(TENANT_B)])
      expect(
        result(
          await call(world, payslips.detail, { rowId: row._id }, identity),
        ),
      ).toMatchObject({ written: false, error: { code: "NOT_FOUND" } });
  });
  it("binds a download ticket to actor, session, published statement and exact provider expiry", async () => {
    const { world } = await fixture();
    const { row, args } = await published(world);
    const identity = fresh();
    const input = { requestId: rid(), rowId: row._id };
    const issued = written(await call(world, payslips.ticket, input, identity));
    expect(issued.expiresAt).toBe(now + 60000);
    expect(
      written(await call(world, payslips.ticket, input, identity)).documentId,
    ).toBe(issued.documentId);
    expect(
      result(
        await call(
          world,
          payslips.document,
          { ticketId: issued.documentId },
          identity,
        ),
      ),
    ).toMatchObject({
      written: true,
      base64: args.documents[0]!.base64,
      sha256: row.sourceHash,
    });
    expect(
      result(
        await call(
          world,
          payslips.document,
          { ticketId: issued.documentId },
          { ...identity, sid: "different_session" },
        ),
      ),
    ).toMatchObject({
      written: false,
      error: { code: "PAYSLIP_TICKET_EXPIRED" },
    });
    expect(
      result(
        await call(
          world,
          payslips.document,
          { ticketId: issued.documentId },
          fresh(OTHER),
        ),
      ),
    ).toMatchObject({
      written: false,
      error: { code: "PAYSLIP_TICKET_EXPIRED" },
    });
    vi.setSystemTime(now + 60000);
    expect(
      result(
        await call(
          world,
          payslips.document,
          { ticketId: issued.documentId },
          identity,
        ),
      ),
    ).toMatchObject({
      written: false,
      error: { code: "PAYSLIP_TICKET_EXPIRED" },
    });
    refused(
      await call(world, payslips.ticket, input, identity),
      "PAYSLIP_TICKET_EXPIRED",
    );
  });
  it("invalidates tickets and replay receipts after publication supersedes their source", async () => {
    const { world } = await fixture();
    const { row } = await published(world);
    const input = { requestId: rid(), rowId: row._id };
    const identity = fresh();
    const issued = written(await call(world, payslips.ticket, input, identity));
    const staged = written(await call(world, payslips.stage, await source()));
    written(
      await call(world, payslips.publish, {
        requestId: rid(),
        importId: staged.documentId,
        replacementConfirmed: true,
      }),
    );
    refused(
      await call(world, payslips.ticket, input, identity),
      "PAYSLIP_TICKET_EXPIRED",
    );
    expect(
      result(
        await call(
          world,
          payslips.document,
          { ticketId: issued.documentId },
          identity,
        ),
      ),
    ).toMatchObject({ written: false, error: { code: "NOT_FOUND" } });
  });
  it("invalidates grants on a policy revision and refuses corrupted stored source bytes", async () => {
    const { world } = await fixture();
    const { row } = await published(world);
    const identity = fresh();
    const input = { requestId: rid(), rowId: row._id };
    const issued = written(await call(world, payslips.ticket, input, identity));
    await world.t.run((ctx) =>
      ctx.db.patch("hrPayslipRows", row._id, {
        sourceBase64: btoa("%PDF-1.7\ncorrupted source\n%%EOF"),
      }),
    );
    expect(
      result(
        await call(
          world,
          payslips.document,
          { ticketId: issued.documentId },
          identity,
        ),
      ),
    ).toMatchObject({
      written: false,
      error: { code: "PAYSLIP_SOURCE_INTEGRITY_FAILED" },
    });
    await world.t.run((ctx) =>
      ctx.db.insert("hrPolicyVersions", {
        orgId: world.orgA,
        capability: "PAYSLIPS",
        config: { ...thailandDefaults(), downloadSeconds: 10 },
        effectiveDate: "2026-10-12",
        version: 2,
        draftVersion: 2,
        preset: POLICY_PRESET,
        coverageConfirmed: true,
        existingBenefitsReviewed: true,
        activatedAt: now,
        activatedByUserId: world.userA,
      }),
    );
    refused(
      await call(world, payslips.ticket, input, identity),
      "PAYSLIP_TICKET_EXPIRED",
    );
    expect(
      result(
        await call(
          world,
          payslips.document,
          { ticketId: issued.documentId },
          identity,
        ),
      ),
    ).toMatchObject({
      written: false,
      error: { code: "PAYSLIP_TICKET_EXPIRED" },
    });
  });
  it("keeps source delivery and reveal disabled when provider capability is unavailable", async () => {
    const { world } = await fixture();
    const { row } = await published(world);
    vi.stubEnv("HR_PAYSLIP_PROVIDER_FRESHNESS_ENABLED", "false");
    expect(
      result(await call(world, payslips.detail, { rowId: row._id }, fresh())),
    ).toMatchObject({
      written: false,
      error: { code: "PAYSLIP_CAPABILITY_UNAVAILABLE" },
    });
    refused(
      await call(
        world,
        payslips.ticket,
        { requestId: rid(), rowId: row._id },
        fresh(),
      ),
      "PAYSLIP_CAPABILITY_UNAVAILABLE",
    );
    refused(
      await call(world, payslips.stage, await source()),
      "PAYSLIP_CAPABILITY_UNAVAILABLE",
    );
  });
});

it("records deliberate excluded source rows and publishes only the validated included set", async () => {
  const { world } = await fixture();
  const args = await source();
  args.csv += "\nUNKNOWN,2026-10-01,2026-10-31,2026-10-30,,1000,0";
  refused(await call(world, payslips.stage, args), "PAYSLIP_CSV_INVALID");
  refused(
    await call(world, payslips.stage, {
      ...args,
      requestId: rid(),
      exclusions: [{ rowNumber: 3, reason: " " }],
    }),
    "PAYSLIP_CSV_INVALID",
  );
  const staged = written(
    await call(world, payslips.stage, {
      ...args,
      requestId: rid(),
      exclusions: [
        {
          rowNumber: 3,
          reason: "Source amounts missing; payroll must correct",
        },
      ],
    }),
  );
  written(
    await call(world, payslips.publish, {
      requestId: rid(),
      importId: staged.documentId,
      replacementConfirmed: false,
    }),
  );
  const imports = result(await call(world, payslips.imports, {}));
  expect(imports.items).toMatchObject([
    {
      rowCount: 1,
      status: "PUBLISHED",
      exclusions: [
        {
          rowNumber: 3,
          employeeCode: "UNKNOWN",
          reason: "Source amounts missing; payroll must correct",
        },
      ],
      rows: [{ employeeCode: "E1", net: 2900000 }],
    },
  ]);
  const saved = await world.t.run((ctx) =>
    ctx.db.get(String(staged.documentId) as Id<"hrPayslipImports">),
  );
  expect(saved?.sourceCsv).toBe(args.csv);
  expect(result(await call(world, payslips.list, {})).items).toHaveLength(1);
});

it("refuses publication when the recorded excluded-row reason changes after staging", async () => {
  const { world } = await fixture();
  const args = await source();
  args.csv += "\nUNKNOWN,2026-10-01,2026-10-31,2026-10-30,,1000,0";
  const staged = written(
    await call(world, payslips.stage, {
      ...args,
      exclusions: [
        { rowNumber: 3, reason: "Payroll must correct missing amounts" },
      ],
    }),
  );
  await world.t.run(async (ctx) => {
    const batch = await ctx.db.get(
      String(staged.documentId) as Id<"hrPayslipImports">,
    );
    if (!batch?.exclusions?.length)
      throw new Error("Expected excluded source receipt");
    await ctx.db.patch(batch._id, {
      exclusions: batch.exclusions.map((row) => ({
        ...row,
        reason: "Changed after validation",
      })),
    });
  });
  refused(
    await call(world, payslips.publish, {
      requestId: rid(),
      importId: staged.documentId,
      replacementConfirmed: false,
    }),
    "PAYSLIP_SOURCE_INTEGRITY_FAILED",
  );
  expect(result(await call(world, payslips.list, {})).items).toHaveLength(0);
});
