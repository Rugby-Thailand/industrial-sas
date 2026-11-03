import { thailandDefaults, POLICY_PRESET } from "../../convex/model/hr/policy";
import type { GenericMutationCtx } from "convex/server";
import type { DataModel } from "../../convex/schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sweep } from "../../convex/operations/temporaryRetention";
import { createConvexTenantWorld } from "../fixtures/convex-tenant-world";
import {
  checkIdempotency,
  writeIdempotencyRecord,
  IDEMPOTENCY_RETENTION_MS,
} from "../../convex/lib/idempotency";
import { createTenantDocumentAccess } from "../../convex/lib/tenantDb";
import { createMutationTenantStorage } from "../../convex/lib/tenantStorage";

afterEach(() => {
  vi.useRealTimers();
});

describe("temporary retention", () => {
  it("bounds resumable tenant sweeps, supports dry runs and preserves permanent fences", async () => {
    const world = await createConvexTenantWorld();
    const cutoff = Date.now() - 1000;
    await world.t.run(async (ctx) => {
      for (const [orgId, expiry] of [
        [world.orgA, cutoff - 1],
        [world.orgA, cutoff],
        [world.orgA, cutoff + 1],
        [world.orgA, Number.MAX_SAFE_INTEGER],
        [world.orgB, cutoff],
      ] as const)
        await ctx.db.insert("idempotencyRecords", {
          orgId,
          operation: "test",
          requestId: `${orgId}-${expiry}`,
          status: "SUCCEEDED",
          requestHash: "h",
          firstSeenAt: 0,
          expiresAt: expiry,
        });
    });
    const args = {
      orgId: world.orgA,
      table: "idempotencyRecords" as const,
      cutoff,
      limit: 1,
      dryRun: true,
    };
    const run = (input: typeof args & { cursor?: string }) =>
      world.t.run((ctx) =>
        (
          sweep as unknown as {
            _handler: (
              ctx: GenericMutationCtx<DataModel>,
              args: unknown,
            ) => Promise<{ cursor: string }>;
          }
        )._handler(ctx, input),
      );
    expect(await run(args)).toMatchObject({
      scanned: 1,
      deleted: 0,
      isDone: false,
    });
    const first = await run({ ...args, dryRun: false });
    expect(first).toMatchObject({ scanned: 1, deleted: 1, isDone: false });
    expect(
      await run({ ...args, dryRun: false, cursor: first.cursor }),
    ).toMatchObject({ deleted: 1, isDone: true });
    const remaining = await world.t.run((ctx) =>
      ctx.db.query("idempotencyRecords").collect(),
    );
    expect(remaining.map((r) => r.expiresAt).sort()).toEqual(
      [cutoff, cutoff + 1, Number.MAX_SAFE_INTEGER].sort(),
    );
    expect(remaining.some((r) => r.orgId === world.orgB)).toBe(true);
  });
  it("permits expired ordinary keys before or after cleanup and atomically replaces expired records", async () => {
    const world = await createConvexTenantWorld();
    await world.t.run(async (ctx) => {
      const tenantDb = createTenantDocumentAccess(
        { orgId: world.orgA, requestId: "test" },
        createMutationTenantStorage(ctx, "test"),
      );
      const base = {
        tenantDb,
        operation: "test",
        requestId: "key",
        requestHash: "old",
        resultRef: "result",
        resultHash: "digest",
        actorUserId: world.userA,
      };
      const now = Date.now();
      await writeIdempotencyRecord({
        ...base,
        now: now - IDEMPOTENCY_RETENTION_MS,
      });
      expect(
        await checkIdempotency({ ...base, requestHash: "new" }),
      ).toMatchObject({ ok: true, value: { kind: "FRESH" } });
      await writeIdempotencyRecord({ ...base, requestHash: "new", now });
      expect(
        await checkIdempotency({ ...base, requestHash: "new" }),
      ).toMatchObject({ ok: true, value: { kind: "REPLAY" } });
      expect(await checkIdempotency(base)).toMatchObject({
        ok: false,
        error: { code: "REQUEST_ARGUMENT_CONFLICT" },
      });
      expect(await ctx.db.query("idempotencyRecords").collect()).toHaveLength(
        1,
      );
    });
  });
});

it("expires grants without deleting approval history and preserves other tenants and future grants", async () => {
  const world = await createConvexTenantWorld();
  const cutoff = Date.now() - 1000;
  await world.t.run(async (ctx) => {
    for (const [orgId, status, expiresAt] of [
      [world.orgA, "ACTIVE", cutoff],
      [world.orgA, "REVOKED", cutoff],
      [world.orgA, "APPROVED", cutoff + 1],
      [world.orgB, "ACTIVE", cutoff],
    ] as const)
      await ctx.db.insert("supportGrants", {
        orgId,
        status,
        expiresAt,
        accessMode: "READ_ONLY",
        reason: "Support",
        ticketRef: "T1",
        requestedBy: "operator",
        requestedAt: 1,
      });
  });
  type Runtime = {
    _handler: (
      ctx: GenericMutationCtx<DataModel>,
      args: unknown,
    ) => Promise<unknown>;
  };
  const run = (dryRun: boolean) =>
    world.t.run((ctx) =>
      (sweep as unknown as Runtime)._handler(ctx, {
        orgId: world.orgA,
        table: "supportGrants",
        cutoff,
        limit: 100,
        dryRun,
      }),
    );
  expect(await run(true)).toMatchObject({
    expired: 1,
    retained: 1,
    deleted: 0,
  });
  expect(
    await world.t.run((ctx) => ctx.db.query("supportGrants").collect()),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ orgId: world.orgA, status: "ACTIVE" }),
    ]),
  );
  expect(await run(false)).toMatchObject({
    expired: 1,
    retained: 1,
    deleted: 0,
  });
  const grants = await world.t.run((ctx) =>
    ctx.db.query("supportGrants").collect(),
  );
  expect(grants).toHaveLength(4);
  expect(
    grants
      .filter((g) => g.orgId === world.orgA)
      .map((g) => g.status)
      .sort(),
  ).toEqual(["APPROVED", "EXPIRED", "REVOKED"]);
  expect(grants.find((g) => g.orgId === world.orgB)!.status).toBe("ACTIVE");
});

it("deletes only expired access tickets and retains payroll source rows", async () => {
  const world = await createConvexTenantWorld();
  const cutoff = Date.now() - 1000;
  const ids = await world.t.run(async (ctx) => {
    const employeeId = await ctx.db.insert("hrEmployees", {
      orgId: world.orgA,
      warehouseId: world.warehouses.alphaA,
      code: "E1",
      displayName: "Employee",
      employmentStartDate: "2020-01-01",
      status: "ACTIVE",
      version: 1,
      createdAt: 1,
      updatedAt: 1,
      createdByUserId: world.userA,
      updatedByUserId: world.userA,
    });
    const policyVersionId = await ctx.db.insert("hrPolicyVersions", {
      orgId: world.orgA,
      capability: "PAYSLIPS",
      config: thailandDefaults(),
      effectiveDate: "2026-01-01",
      version: 1,
      draftVersion: 1,
      preset: POLICY_PRESET,
      coverageConfirmed: true,
      existingBenefitsReviewed: true,
      activatedAt: 1,
      activatedByUserId: world.userA,
    });
    const importId = await ctx.db.insert("hrPayslipImports", {
      orgId: world.orgA,
      from: "2026-01-01",
      to: "2026-01-31",
      sourceName: "payroll",
      sourceCsv: "immutable source",
      sourceHash: "hash",
      policyVersionId,
      status: "PUBLISHED",
      rowCount: 1,
      createdAt: 1,
      createdByUserId: world.userA,
    });
    const rowId = await ctx.db.insert("hrPayslipRows", {
      orgId: world.orgA,
      importId,
      employeeId,
      warehouseId: world.warehouses.alphaA,
      employeeCode: "E1",
      employeeName: "Employee",
      from: "2026-01-01",
      to: "2026-01-31",
      paymentDate: "2026-01-31",
      gross: 100,
      deductions: 0,
      net: 100,
      sourceBase64: "source",
      sourceHash: "hash",
      version: 1,
    });
    for (const [orgId, expiresAt] of [
      [world.orgA, cutoff],
      [world.orgA, cutoff + 1],
      [world.orgB, cutoff],
    ] as const)
      await ctx.db.insert("hrPayslipTickets", {
        orgId,
        rowId,
        employeeId,
        userId: world.userA,
        sessionId: "session",
        policyVersionId,
        issuedAt: 1,
        expiresAt,
      });
    return { rowId, importId };
  });
  type Runtime = {
    _handler: (
      ctx: GenericMutationCtx<DataModel>,
      args: unknown,
    ) => Promise<unknown>;
  };
  expect(
    await world.t.run((ctx) =>
      (sweep as unknown as Runtime)._handler(ctx, {
        orgId: world.orgA,
        table: "hrPayslipTickets",
        cutoff,
        limit: 1,
        dryRun: false,
      }),
    ),
  ).toMatchObject({ deleted: 1, scanned: 1 });
  await world.t.run(async (ctx) => {
    expect(await ctx.db.query("hrPayslipTickets").collect()).toHaveLength(2);
    expect(await ctx.db.get(ids.rowId)).toMatchObject({
      sourceBase64: "source",
      gross: 100,
    });
    expect(await ctx.db.get(ids.importId)).toMatchObject({
      sourceCsv: "immutable source",
    });
  });
});

it("treats the exact replay expiry as fresh while future and permanent keys stay protected", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-03T00:00:00.000Z"));
  const world = await createConvexTenantWorld();
  await world.t.run(async (ctx) => {
    const tenantDb = createTenantDocumentAccess(
      { orgId: world.orgA, requestId: "expiry-boundary" },
      createMutationTenantStorage(ctx, "expiry-boundary"),
    );
    const now = Date.now();
    for (const [requestId, expiresAt] of [
      ["past", now - 1],
      ["boundary", now],
      ["future", now + 1],
      ["permanent", Number.MAX_SAFE_INTEGER],
    ] as const) {
      await ctx.db.insert("idempotencyRecords", {
        orgId: world.orgA,
        operation: "boundary",
        requestId,
        status: "SUCCEEDED",
        requestHash: "original",
        firstSeenAt: now - IDEMPOTENCY_RETENTION_MS,
        expiresAt,
      });
    }
    for (const requestId of ["past", "boundary"])
      expect(
        await checkIdempotency({
          tenantDb,
          operation: "boundary",
          requestId,
          requestHash: "replacement",
        }),
      ).toMatchObject({ ok: true, value: { kind: "FRESH" } });
    for (const requestId of ["future", "permanent"]) {
      expect(
        await checkIdempotency({
          tenantDb,
          operation: "boundary",
          requestId,
          requestHash: "original",
        }),
      ).toMatchObject({ ok: true, value: { kind: "REPLAY" } });
      expect(
        await checkIdempotency({
          tenantDb,
          operation: "boundary",
          requestId,
          requestHash: "replacement",
        }),
      ).toMatchObject({
        ok: false,
        error: { code: "REQUEST_ARGUMENT_CONFLICT" },
      });
    }
  });
});
