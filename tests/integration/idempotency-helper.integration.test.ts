/**
 * Integration tier — the extracted idempotency helper over `convex-test`.
 *
 * The ledger's own suites already prove the *posting* path is idempotent. This
 * file proves the machinery is correct **on its own**, because it now has a
 * second caller: a defect here would be a duplicate master-data row rather than a
 * duplicate posting, and a suite that only exercised it through the ledger would
 * not catch a regression in the generic part.
 *
 * All data is synthetic (`tests/fixtures/README.md`).
 */
import type { GenericMutationCtx } from "convex/server";
import { describe, expect, it } from "vitest";

import {
  checkIdempotency,
  fingerprintArguments,
  sha256Hex,
  writeIdempotencyRecord,
  IDEMPOTENCY_RETENTION_MS,
} from "../../convex/lib/idempotency";
import { canonicalArgumentText } from "../../convex/model/inventory/requestIdentity";
import {
  createTenantDocumentAccess,
  type TenantDocumentAccess,
} from "../../convex/lib/tenantDb";
import { createMutationTenantStorage } from "../../convex/lib/tenantStorage";
import type { DataModel } from "../../convex/schema";
import {
  createConvexTenantWorld,
  FIXTURE_REQUEST_ID,
  seedConvexTenantIdentities,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";

const OPERATION = "masterData.item.create";

/** Run a body with a tenant-bound accessor for one organization. */
async function withTenantDb<T>(
  world: ConvexTenantWorld,
  orgId: string,
  body: (tenantDb: TenantDocumentAccess) => Promise<T>,
): Promise<T> {
  return await world.t.run(async (ctx) => {
    const tenantDb = createTenantDocumentAccess(
      { orgId: orgId as never, requestId: FIXTURE_REQUEST_ID },
      createMutationTenantStorage(
        ctx as unknown as GenericMutationCtx<DataModel>,
        FIXTURE_REQUEST_ID,
      ),
    );
    return await body(tenantDb);
  });
}

describe("fingerprintArguments", () => {
  it("is stable across key order, because canonicalization sorts", () => {
    // Two structurally equal argument sets must fingerprint identically, or a
    // retry that serialized its object differently would read as a conflict.
    return Promise.all([
      fingerprintArguments({ b: 2, a: 1 }),
      fingerprintArguments({ a: 1, b: 2 }),
    ]).then(([left, right]) => {
      expect(left.ok && right.ok).toBe(true);
      expect(left.ok && left.value).toBe(right.ok && right.value);
    });
  });

  it("separates arguments that differ anywhere", async () => {
    const base = await fingerprintArguments({ sku: "A", name: "x" });
    const changed = await fingerprintArguments({ sku: "A", name: "y" });

    expect(base.ok && changed.ok).toBe(true);
    expect(base.ok && base.value).not.toBe(changed.ok && changed.value);
  });

  it("refuses a payload the canonical kernel cannot render", async () => {
    // A `bigint` means something this domain cannot compare; a fingerprint that
    // silently coerced it would compare two different requests as equal.
    const outcome = await fingerprintArguments({ value: 1n });

    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.error.code).toBe("REQUEST_IDENTITY_INVALID");
  });

  it("produces a lower-case hex SHA-256", async () => {
    const outcome = await fingerprintArguments({ a: 1 });
    expect(outcome.ok && /^[0-9a-f]{64}$/.test(outcome.value)).toBe(true);
  });

  it("is exactly the digest of the kernel's canonical text", async () => {
    /*
     * Composed from the two pieces rather than compared against a literal: the
     * canonical encoding is the kernel's business and is deliberately not JSON,
     * so a test that hard-coded `{"a":1}` would be asserting a format this module
     * does not own.
     */
    const canonical = canonicalArgumentText({ a: 1 });
    expect(canonical.ok).toBe(true);
    if (!canonical.ok) return;

    const direct = await sha256Hex(canonical.value);
    const viaFingerprint = await fingerprintArguments({ a: 1 });
    expect(viaFingerprint.ok && viaFingerprint.value).toBe(direct);
  });
});

describe("checkIdempotency", () => {
  it("reports FRESH when no record exists", async () => {
    const world = await createConvexTenantWorld();
    await seedConvexTenantIdentities(world);

    const decision = await withTenantDb(world, world.orgA, (tenantDb) =>
      checkIdempotency({
        tenantDb,
        operation: OPERATION,
        requestId: "req_1",
        requestHash: "abc",
      }),
    );

    expect(decision.ok && decision.value.kind).toBe("FRESH");
  });

  it("reports REPLAY for the same request with the same arguments", async () => {
    const world = await createConvexTenantWorld();
    await seedConvexTenantIdentities(world);

    await withTenantDb(world, world.orgA, (tenantDb) =>
      writeIdempotencyRecord({
        tenantDb,
        operation: OPERATION,
        requestId: "req_2",
        requestHash: "hash-1",
        resultRef: "items:abc",
        resultHash: "result-1",
        actorUserId: world.userA,
        now: 1_000,
      }),
    );

    const decision = await withTenantDb(world, world.orgA, (tenantDb) =>
      checkIdempotency({
        tenantDb,
        operation: OPERATION,
        requestId: "req_2",
        requestHash: "hash-1",
      }),
    );

    expect(decision.ok && decision.value.kind).toBe("REPLAY");
    if (!decision.ok || decision.value.kind !== "REPLAY") return;
    expect(decision.value.record.resultRef).toBe("items:abc");
    expect(decision.value.record.resultHash).toBe("result-1");
    expect(decision.value.record.status).toBe("SUCCEEDED");
  });

  it("refuses the same request ID with different arguments", async () => {
    /*
     * The rule that makes idempotency safe rather than merely convenient: a
     * reused ID is not a retry. Answering with the first result would silently
     * discard the second request.
     */
    const world = await createConvexTenantWorld();
    await seedConvexTenantIdentities(world);

    await withTenantDb(world, world.orgA, (tenantDb) =>
      writeIdempotencyRecord({
        tenantDb,
        operation: OPERATION,
        requestId: "req_3",
        requestHash: "hash-original",
        resultRef: "items:abc",
        resultHash: "result-1",
        actorUserId: world.userA,
        now: 1_000,
      }),
    );

    const decision = await withTenantDb(world, world.orgA, (tenantDb) =>
      checkIdempotency({
        tenantDb,
        operation: OPERATION,
        requestId: "req_3",
        requestHash: "hash-different",
      }),
    );

    expect(decision.ok).toBe(false);
    expect(!decision.ok && decision.error.code).toBe(
      "REQUEST_ARGUMENT_CONFLICT",
    );
    // The refusal names the request ID and nothing else: the stored arguments
    // are not this module's to disclose.
    expect(!decision.ok && JSON.stringify(decision.error)).not.toContain(
      "hash-original",
    );
  });

  it("scopes the key by operation, so two operations may share a request ID", async () => {
    // The key is `(orgId, operation, requestId)`. A handheld that mints one ID
    // per intent and uses it for a receipt and its label print is not retrying.
    const world = await createConvexTenantWorld();
    await seedConvexTenantIdentities(world);

    await withTenantDb(world, world.orgA, (tenantDb) =>
      writeIdempotencyRecord({
        tenantDb,
        operation: OPERATION,
        requestId: "shared",
        requestHash: "hash-a",
        resultRef: "items:abc",
        resultHash: "result-a",
        actorUserId: world.userA,
        now: 1_000,
      }),
    );

    const other = await withTenantDb(world, world.orgA, (tenantDb) =>
      checkIdempotency({
        tenantDb,
        operation: "masterData.location.create",
        requestId: "shared",
        requestHash: "hash-b",
      }),
    );

    expect(other.ok && other.value.kind).toBe("FRESH");
  });
});

describe("writeIdempotencyRecord", () => {
  it("stores a reference and two digests, and no payload", async () => {
    /*
     * An idempotency table holding requests and responses becomes a second,
     * unaudited copy of domain data and a place for PII to collect (plan §14).
     * The stored row is asserted field by field so an added payload column
     * fails here rather than in a privacy review.
     */
    const world = await createConvexTenantWorld();
    await seedConvexTenantIdentities(world);

    await withTenantDb(world, world.orgA, (tenantDb) =>
      writeIdempotencyRecord({
        tenantDb,
        operation: OPERATION,
        requestId: "req_4",
        requestHash: "hash-1",
        resultRef: "items:abc",
        resultHash: "result-1",
        actorUserId: world.userA,
        now: 5_000,
      }),
    );

    const rows = await world.t.run(async (ctx) =>
      ctx.db.query("idempotencyRecords").collect(),
    );
    const record = rows.find((row) => row.requestId === "req_4");

    expect(record).toBeDefined();
    expect(Object.keys(record ?? {}).sort()).toEqual([
      "_creationTime",
      "_id",
      "actorUserId",
      "completedAt",
      "expiresAt",
      "firstSeenAt",
      "operation",
      "orgId",
      "requestHash",
      "requestId",
      "resultHash",
      "resultRef",
      "status",
    ]);
  });

  it("sets the retention horizon 30 days out from the caller's clock", async () => {
    const world = await createConvexTenantWorld();
    await seedConvexTenantIdentities(world);
    const now = 1_786_414_500_000;

    await withTenantDb(world, world.orgA, (tenantDb) =>
      writeIdempotencyRecord({
        tenantDb,
        operation: OPERATION,
        requestId: "req_5",
        requestHash: "hash-1",
        resultRef: "items:abc",
        resultHash: "result-1",
        actorUserId: world.userA,
        now,
      }),
    );

    const rows = await world.t.run(async (ctx) =>
      ctx.db.query("idempotencyRecords").collect(),
    );
    const record = rows.find((row) => row.requestId === "req_5");

    expect(record?.firstSeenAt).toBe(now);
    expect(record?.completedAt).toBe(now);
    expect(record?.expiresAt).toBe(now + IDEMPOTENCY_RETENTION_MS);
    // 30 days, not the seven years D-27 gives the ledger and the audit trail.
    expect(IDEMPOTENCY_RETENTION_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("takes the caller's clock, never its own", async () => {
    // A module that read the wall clock would make a replay's retention depend
    // on when it was retried rather than on when the request first arrived.
    const world = await createConvexTenantWorld();
    await seedConvexTenantIdentities(world);

    await withTenantDb(world, world.orgA, (tenantDb) =>
      writeIdempotencyRecord({
        tenantDb,
        operation: OPERATION,
        requestId: "req_6",
        requestHash: "h",
        resultRef: "r",
        resultHash: "rh",
        actorUserId: world.userA,
        now: 0,
      }),
    );

    const rows = await world.t.run(async (ctx) =>
      ctx.db.query("idempotencyRecords").collect(),
    );
    expect(rows.find((row) => row.requestId === "req_6")?.expiresAt).toBe(
      IDEMPOTENCY_RETENTION_MS,
    );
  });

  it("is reachable with the fixture's own request ID shape", async () => {
    const world = await createConvexTenantWorld();
    await seedConvexTenantIdentities(world);

    await withTenantDb(world, world.orgA, (tenantDb) =>
      writeIdempotencyRecord({
        tenantDb,
        operation: OPERATION,
        requestId: FIXTURE_REQUEST_ID,
        requestHash: "h",
        resultRef: "r",
        resultHash: "rh",
        actorUserId: world.userA,
        now: 1,
      }),
    );

    const decision = await withTenantDb(world, world.orgA, (tenantDb) =>
      checkIdempotency({
        tenantDb,
        operation: OPERATION,
        requestId: FIXTURE_REQUEST_ID,
        requestHash: "h",
      }),
    );
    expect(decision.ok && decision.value.kind).toBe("REPLAY");
  });
});
