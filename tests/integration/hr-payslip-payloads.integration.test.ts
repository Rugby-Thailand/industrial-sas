/**
 * Payslip metadata/payload split: statement listing, predecessor and version
 * checks never read original PDF bytes; publication reads only its own
 * batch's payloads; the legacy inline-bytes migration is bounded, resumable,
 * idempotent and verified by hash.
 */
import type { GenericMutationCtx } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Doc, Id } from "../../convex/_generated/dataModel";
import * as migration from "../../convex/hr/payslipMigration";
import * as payslips from "../../convex/hr/payslips";
import {
  MAX_PDF_BYTES,
  PAYSLIP_CSV_HEADER,
  pdfHash,
} from "../../convex/model/hr/payslip";
import { POLICY_PRESET, thailandDefaults } from "../../convex/model/hr/policy";
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
type Outcome = {
  ok: boolean;
  value?: Record<string, unknown> & {
    written?: boolean;
    error?: { code: string };
    items?: unknown[];
  };
};
type Identity = {
  subject: string;
  org_id: string;
  sid?: string;
  iat?: number;
  fva?: number[];
};
type Report = {
  scanned: number;
  migrated: number;
  alreadyMigrated: number;
  inline: number;
  missingPayload: number;
  integrityFailures: string[];
  isDone: boolean;
  continueCursor: string;
};

const now = Date.UTC(2026, 9, 12, 3);
const ADMIN: Identity = { subject: "user_fixture_a", org_id: "org_fixture_a" };
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
const rid = () => `payslip-payload-test-${++sequence}`;

async function call(
  world: ConvexTenantWorld,
  fn: unknown,
  args: unknown,
  identity = ADMIN,
) {
  return (await world.t
    .withIdentity(identity)
    .run((ctx) =>
      (fn as Handler)._handler(ctx as GenericMutationCtx<DataModel>, args),
    )) as Outcome;
}
function value(outcome: Outcome) {
  expect(outcome.ok, JSON.stringify(outcome).slice(0, 400)).toBe(true);
  return outcome.value!;
}
function written(outcome: Outcome) {
  const result = value(outcome);
  expect(result.written, JSON.stringify(result).slice(0, 400)).toBe(true);
  return result;
}
const migrate = (
  world: ConvexTenantWorld,
  args: { cursor?: string | null; batchSize?: number; dryRun?: boolean },
) =>
  world.t.run(
    async (ctx) =>
      (await (migration.migrateInlinePayloads as unknown as Handler)._handler(
        ctx as GenericMutationCtx<DataModel>,
        args,
      )) as Report,
  );

/** A valid PDF of exactly `size` bytes whose content varies by `label`. */
function pdf(label: string, size = MAX_PDF_BYTES) {
  const head = `%PDF-1.7\n% ${label}\n`;
  const tail = "\n%%EOF\n";
  const text = head + "x".repeat(size - head.length - tail.length) + tail;
  return { text, base64: btoa(text) };
}

async function fixture() {
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
    const employee = (
      orgId: Id<"organizations">,
      warehouseId: Id<"warehouses">,
      code: string,
      userId?: Id<"users">,
    ) =>
      ctx.db.insert("hrEmployees", {
        orgId,
        warehouseId,
        code,
        displayName: code,
        ...(userId ? { userId } : {}),
        employmentStartDate: "2020-01-01",
        status: "ACTIVE",
        version: 1,
        createdAt: 1,
        updatedAt: 1,
        createdByUserId: world.userA,
        updatedByUserId: world.userA,
      });
    const e1 = await employee(
      world.orgA,
      world.warehouses.alphaA,
      "E1",
      world.userA,
    );
    const e2 = await employee(world.orgA, world.warehouses.alphaA, "E2");
    const b1 = await employee(
      world.orgB,
      world.warehouses.alphaB,
      "E1",
      world.userA,
    );
    for (const orgId of [world.orgA, world.orgB])
      await ctx.db.insert("hrPolicyVersions", {
        orgId,
        capability: "PAYSLIPS",
        config: { ...thailandDefaults(), requireFileHash: true },
        effectiveDate: "2026-10-01",
        version: 1,
        draftVersion: 1,
        preset: POLICY_PRESET,
        coverageConfirmed: true,
        existingBenefitsReviewed: true,
        activatedAt: now,
        activatedByUserId: world.userA,
      });
    return { e1, e2, b1 };
  });
  return { world, ...ids };
}

async function stageArgs(codes: readonly string[], label: string) {
  const documents = [];
  for (const code of codes) {
    const file = pdf(`${label}:${code}`);
    documents.push({
      employeeCode: code,
      base64: file.base64,
      expectedHash: await pdfHash(new TextEncoder().encode(file.text)),
    });
  }
  return {
    requestId: rid(),
    from: "2026-10-01",
    to: "2026-10-31",
    sourceName: `${label}.csv`,
    csv: [
      PAYSLIP_CSV_HEADER,
      ...codes.map(
        (code) =>
          `${code},2026-10-01,2026-10-31,2026-10-30,30000.00,0,30000.00`,
      ),
    ].join("\n"),
    sourceConfirmed: true,
    documents,
  };
}

async function stageAndPublish(
  world: ConvexTenantWorld,
  label: string,
  codes: readonly string[] = ["E1"],
  identity = ADMIN,
) {
  const staged = written(
    await call(world, payslips.stage, await stageArgs(codes, label), identity),
  );
  written(
    await call(
      world,
      payslips.publish,
      {
        requestId: rid(),
        importId: staged.documentId,
        replacementConfirmed: true,
      },
      identity,
    ),
  );
  return staged.documentId as Id<"hrPayslipImports">;
}

const latestRow = (world: ConvexTenantWorld, employeeId: Id<"hrEmployees">) =>
  world.t.run(async (ctx) => {
    const rows = await ctx.db
      .query("hrPayslipRows")
      .withIndex("by_orgId_employeeId_from", (q) =>
        q.eq("orgId", world.orgA).eq("employeeId", employeeId),
      )
      .collect();
    return rows.sort((a, b) => b.version - a.version)[0]!;
  });

async function download(
  world: ConvexTenantWorld,
  rowId: string,
  identity = fresh(),
) {
  const ticket = value(
    await call(world, payslips.ticket, { requestId: rid(), rowId }, identity),
  );
  if (!ticket.written) return ticket;
  return value(
    await call(
      world,
      payslips.document,
      { requestId: rid(), ticketId: ticket.documentId },
      identity,
    ),
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  vi.stubEnv("HR_PAYSLIP_PROVIDER_FRESHNESS_ENABLED", "true");
  vi.stubEnv("HR_PAYSLIP_PRIVATE_STORAGE_ENABLED", "true");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const VERSIONS = 30;
const PAYLOAD_BYTES = Math.ceil(MAX_PDF_BYTES / 3) * 4;

describe("payslip metadata never carries original bytes", () => {
  it("keeps near-max PDF versions out of listing, version and predecessor reads", async () => {
    const { world, e1 } = await fixture();
    for (let index = 1; index <= VERSIONS; index += 1)
      await stageAndPublish(world, `v${index}`);
    const latest = await latestRow(world, e1);
    expect(latest.version).toBe(VERSIONS);
    expect(latest).not.toHaveProperty("sourceBase64");
    // Every version keeps its own immutable, hash-verified original.
    const payloads = await world.t.run((ctx) =>
      ctx.db.query("hrPayslipPayloads").collect(),
    );
    expect(payloads).toHaveLength(VERSIONS);
    expect(new Set(payloads.map((row) => row.sourceHash)).size).toBe(VERSIONS);
    expect(payloads.every((row) => row.byteLength === MAX_PDF_BYTES)).toBe(
      true,
    );

    // Employee listing and deep-link metadata read rows only.
    for (const [fn, args] of [
      [payslips.list, {}],
      [payslips.metadata, { rowId: latest._id }],
      [payslips.imports, {}],
    ] as const) {
      const { meter } = await meteredCall(world, fn, args, ADMIN);
      expect(meter.bytes.hrPayslipPayloads ?? 0).toBe(0);
      // 30 metadata rows stay far below one inline PDF.
      expect(meter.bytes.hrPayslipRows ?? 0).toBeLessThan(PAYLOAD_BYTES / 8);
    }

    // Staging the next version checks every predecessor by metadata alone.
    const stage = await meteredCall<Outcome>(
      world,
      payslips.stage,
      await stageArgs(["E1"], "next"),
      ADMIN,
    );
    expect(value(stage.outcome).written).toBe(true);
    expect(stage.meter.bytes.hrPayslipPayloads ?? 0).toBe(0);
    expect(stage.meter.bytes.hrPayslipRows ?? 0).toBeLessThan(
      PAYLOAD_BYTES / 8,
    );

    // Publication re-verifies only its own batch's single payload.
    const publish = await meteredCall<Outcome>(
      world,
      payslips.publish,
      {
        requestId: rid(),
        importId: value(stage.outcome).documentId,
        replacementConfirmed: true,
      },
      ADMIN,
    );
    expect(value(publish.outcome).written).toBe(true);
    expect(publish.meter.bytes.hrPayslipPayloads).toBeGreaterThan(
      PAYLOAD_BYTES,
    );
    expect(publish.meter.bytes.hrPayslipPayloads).toBeLessThan(
      2 * PAYLOAD_BYTES,
    );
    expect(publish.meter.bytes.hrPayslipRows ?? 0).toBeLessThan(
      PAYLOAD_BYTES / 8,
    );

    // The private document still returns the exact original.
    const newest = await latestRow(world, e1);
    expect(newest.version).toBe(VERSIONS + 1);
    const document = await download(world, newest._id);
    expect(document).toMatchObject({
      written: true,
      sha256: newest.sourceHash,
    });
    expect(document.base64).toBe(pdf("next:E1").base64);
  }, 60_000);

  it("refuses a payload that belongs to another statement or tenant", async () => {
    const { world, e1, e2 } = await fixture();
    await stageAndPublish(world, "pair", ["E1", "E2"]);
    await stageAndPublish(world, "tenant-b", ["E1"], TENANT_B);
    const own = await latestRow(world, e1);
    const other = await latestRow(world, e2);
    const foreign = await world.t.run(
      async (ctx) =>
        (await ctx.db
          .query("hrPayslipPayloads")
          .filter((q) => q.eq(q.field("orgId"), world.orgB))
          .first())!,
    );
    // Each payload is tenant-owned like its statement.
    const pairPayloads = await world.t.run((ctx) =>
      ctx.db
        .query("hrPayslipPayloads")
        .filter((q) => q.eq(q.field("orgId"), world.orgA))
        .collect(),
    );
    expect(pairPayloads).toHaveLength(2);

    for (const payloadId of [other.payloadId!, foreign._id]) {
      await world.t.run((ctx) =>
        ctx.db.patch("hrPayslipRows", own._id, { payloadId }),
      );
      const refused = await download(world, own._id);
      expect(refused).toMatchObject({ written: false });
      // A cross-tenant ID is not even readable through the tenant store.
      expect((refused.error as { code: string }).code).toMatch(
        /PAYSLIP_SOURCE_INTEGRITY_FAILED|NOT_FOUND|TENANT/,
      );
    }
    await world.t.run((ctx) =>
      ctx.db.patch("hrPayslipRows", own._id, { payloadId: own.payloadId }),
    );
    expect(await download(world, own._id)).toMatchObject({ written: true });
  });
});

describe("legacy inline payload migration", () => {
  /** Rows written before the split: bytes inline, no payload record. */
  async function legacy(world: ConvexTenantWorld) {
    return await world.t.run(async (ctx) => {
      const seeded: {
        rowId: Id<"hrPayslipRows">;
        base64: string;
        orgId: Id<"organizations">;
      }[] = [];
      const employees = await ctx.db.query("hrEmployees").collect();
      for (const [index, employee] of employees.entries()) {
        const importId = await ctx.db.insert("hrPayslipImports", {
          orgId: employee.orgId,
          from: "2026-09-01",
          to: "2026-09-30",
          sourceName: "legacy.csv",
          sourceCsv: "legacy",
          sourceHash: "legacy",
          policyVersionId: (await ctx.db
            .query("hrPolicyVersions")
            .filter((q) => q.eq(q.field("orgId"), employee.orgId))
            .first())!._id,
          status: "PUBLISHED",
          rowCount: 1,
          createdAt: 1,
          createdByUserId: employee.createdByUserId,
          publishedAt: 2,
          publishedByUserId: employee.createdByUserId,
        });
        const file = pdf(`legacy:${index}`, index === 0 ? MAX_PDF_BYTES : 900);
        const rowId = await ctx.db.insert("hrPayslipRows", {
          orgId: employee.orgId,
          importId,
          employeeId: employee._id,
          warehouseId: employee.warehouseId,
          employeeCode: employee.code,
          employeeName: employee.displayName,
          from: "2026-09-01",
          to: "2026-09-30",
          paymentDate: "2026-09-30",
          gross: 100,
          deductions: 0,
          net: 100,
          sourceBase64: file.base64,
          sourceHash: await pdfHash(new TextEncoder().encode(file.text)),
          version: 1,
          publishedAt: 2,
        });
        seeded.push({ rowId, base64: file.base64, orgId: employee.orgId });
      }
      return seeded;
    });
  }
  async function pass(world: ConvexTenantWorld, dryRun: boolean) {
    const total: Omit<Report, "isDone" | "continueCursor"> = {
      scanned: 0,
      migrated: 0,
      alreadyMigrated: 0,
      inline: 0,
      missingPayload: 0,
      integrityFailures: [],
    };
    let cursor: string | null = null;
    for (;;) {
      const report: Report = await migrate(world, {
        cursor,
        batchSize: 1,
        dryRun,
      });
      total.scanned += report.scanned;
      total.migrated += report.migrated;
      total.alreadyMigrated += report.alreadyMigrated;
      total.inline += report.inline;
      total.missingPayload += report.missingPayload;
      total.integrityFailures.push(...report.integrityFailures);
      if (report.isDone) return total;
      cursor = report.continueCursor;
    }
  }

  it("moves verified bytes in resumable, idempotent pages and reports completion", async () => {
    const { world } = await fixture();
    const seeded = await legacy(world);
    const [first, second, third] = seeded;
    // A corrupted legacy original is reported and left untouched.
    await world.t.run((ctx) =>
      ctx.db.patch("hrPayslipRows", third!.rowId, {
        sourceBase64: btoa("%PDF-1.7\ncorrupted\n%%EOF"),
      }),
    );
    // Before migration, delivery fails closed with an explicit reason.
    expect(await download(world, first!.rowId)).toMatchObject({
      written: false,
      error: { code: "PAYSLIP_SOURCE_MIGRATION_PENDING" },
    });

    const dry = await pass(world, true);
    expect(dry).toMatchObject({
      scanned: 3,
      inline: 2,
      migrated: 0,
      integrityFailures: [third!.rowId],
    });
    expect(
      await world.t.run((ctx) => ctx.db.query("hrPayslipPayloads").collect()),
    ).toHaveLength(0);

    await expect(migrate(world, { batchSize: 9 })).rejects.toThrow(/batchSize/);

    // Interrupted after the first page, then the same page is delivered
    // twice: the retry changes nothing and creates no duplicate payload.
    const page = await migrate(world, { cursor: null, batchSize: 1 });
    expect(page).toMatchObject({ scanned: 1, migrated: 1, isDone: false });
    const again = await migrate(world, { cursor: null, batchSize: 1 });
    expect(again).toMatchObject({
      scanned: 1,
      migrated: 0,
      alreadyMigrated: 1,
    });
    const resumed = await migrate(world, {
      cursor: page.continueCursor,
      batchSize: 8,
    });
    expect(resumed).toMatchObject({
      scanned: 2,
      migrated: 1,
      integrityFailures: [third!.rowId],
      isDone: true,
    });

    // Completion evidence: a verification pass finds nothing left inline,
    // and every moved payload keeps its tenant, bytes and immutable hash.
    expect(await pass(world, true)).toMatchObject({
      scanned: 3,
      alreadyMigrated: 2,
      inline: 0,
      missingPayload: 0,
      integrityFailures: [third!.rowId],
    });
    const state = await world.t.run(async (ctx) => ({
      rows: await ctx.db.query("hrPayslipRows").collect(),
      payloads: await ctx.db.query("hrPayslipPayloads").collect(),
    }));
    expect(state.payloads).toHaveLength(2);
    for (const seed of [first!, second!]) {
      const row = state.rows.find((r) => r._id === seed.rowId)!;
      const payload = state.payloads.find((p) => p._id === row.payloadId)!;
      expect(row.sourceBase64).toBeUndefined();
      expect(payload).toMatchObject({
        orgId: seed.orgId,
        sourceBase64: seed.base64,
        sourceHash: row.sourceHash,
        importId: row.importId,
        employeeId: row.employeeId,
      });
    }
    const corrupt = state.rows.find((r) => r._id === third!.rowId)!;
    expect(corrupt.payloadId).toBeUndefined();
    expect(corrupt.sourceBase64).toBe(btoa("%PDF-1.7\ncorrupted\n%%EOF"));

    // The migrated original is delivered byte-for-byte.
    const delivered = await download(world, first!.rowId);
    expect(delivered).toMatchObject({ written: true });
    expect(delivered.base64).toBe(first!.base64);
  });

  it("finishes a row left with both copies and flags a row with neither", async () => {
    const { world } = await fixture();
    const [first, second] = await legacy(world);
    await world.t.run(async (ctx) => {
      const row = (await ctx.db.get(first!.rowId))! as Doc<"hrPayslipRows">;
      const payloadId = await ctx.db.insert("hrPayslipPayloads", {
        orgId: row.orgId,
        importId: row.importId,
        employeeId: row.employeeId,
        sourceBase64: row.sourceBase64!,
        sourceHash: row.sourceHash,
        byteLength: MAX_PDF_BYTES,
        createdAt: 1,
      });
      await ctx.db.patch("hrPayslipRows", row._id, { payloadId });
      await ctx.db.patch("hrPayslipRows", second!.rowId, {
        sourceBase64: undefined,
      });
    });
    const report = await pass(world, false);
    expect(report).toMatchObject({ migrated: 2, missingPayload: 1 });
    expect(
      await world.t.run((ctx) => ctx.db.query("hrPayslipPayloads").collect()),
    ).toHaveLength(2);
    expect(await pass(world, true)).toMatchObject({
      inline: 0,
      alreadyMigrated: 2,
      missingPayload: 1,
    });
  });

  it("does not certify migrated payloads with corrupted bytes, length or statement ownership", async () => {
    const { world } = await fixture();
    const seeded = await legacy(world);
    await pass(world, false);
    const row = await world.t.run((ctx) => ctx.db.get(seeded[0]!.rowId));
    const payload = await world.t.run((ctx) => ctx.db.get(row!.payloadId!));
    const other = await world.t.run((ctx) => ctx.db.get(seeded[1]!.rowId));
    for (const corrupt of [
      { sourceBase64: btoa("%PDF-1.7\ncorrupted\n%%EOF") },
      { byteLength: payload!.byteLength - 1 },
      { employeeId: other!.employeeId },
      { importId: other!.importId },
    ]) {
      await world.t.run((ctx) => ctx.db.patch(payload!._id, corrupt));
      expect(await pass(world, true)).toMatchObject({
        alreadyMigrated: 2,
        integrityFailures: [row!._id],
      });
      await world.t.run((ctx) =>
        ctx.db.patch(payload!._id, {
          sourceBase64: payload!.sourceBase64,
          byteLength: payload!.byteLength,
          employeeId: payload!.employeeId,
          importId: payload!.importId,
        }),
      );
    }
    expect(await pass(world, true)).toMatchObject({
      alreadyMigrated: 3,
      integrityFailures: [],
    });
  });
});
