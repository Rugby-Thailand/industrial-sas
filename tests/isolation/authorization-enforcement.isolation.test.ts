/**
 * Isolation tier — server-side authorization across two tenants, over
 * `convex-test`.
 *
 * Every case here is a claim that cannot be made with one tenant, one actor, or a
 * fake: a grant row that belongs to the other organization, a warehouse the actor
 * may not act in, an approval whose maker is the actor, a step-up event stamped in
 * the future, an enabled support grant that must still grant nothing. The
 * functions under test are registered through the real wrappers and called through
 * `convexTest`, so the schema validators, index semantics, and — the point of this
 * file — Convex's **transaction boundaries** are the real ones.
 *
 * Two behaviours are proved here that no unit test can show:
 *
 * - **A denial commits its audit row.** The wrappers answer a denied request with
 *   `{ ok: false, denial }` instead of throwing, because a mutation that throws
 *   rolls back the row it just wrote. The `DENIED` rows asserted below exist only
 *   because of that choice.
 * - **An allowed attempt is atomic with the operation.** When the handler throws,
 *   the `ALLOWED` row disappears with the handler's writes, so no audit row claims
 *   an effect that did not happen.
 *
 * `RECEIVER`/`SUPERVISOR` compositions come from the production seed, not from
 * this file: a fixture that invented its own grants would prove the wrapper agrees
 * with the fixture. All data is synthetic (`tests/fixtures/README.md`).
 */
import { makeFunctionReference } from "convex/server";
import { ConvexError, v, type GenericId, type Value } from "convex/values";
import { describe, expect, it } from "vitest";

import {
  actionWithOrg,
  mutationWithOrg,
  queryWithOrg,
  type TenantFunctionOutcome,
} from "../../convex/lib/tenantFunctions";
import {
  createConvexTenantWorld,
  recordDevice,
  recordEntitlement,
  recordStepUp,
  seedConvexAuthorization,
  storedAuditEvents,
  storedWarehouses,
  type ConvexTenantWorld,
  type ConvexTestModuleMap,
} from "../fixtures/convex-tenant-world";

/* -------------------------------------------------------------------------- */
/* Functions under test                                                       */
/* -------------------------------------------------------------------------- */

/*
 * The handlers write a `warehouses` row as a stand-in for the domain write no
 * table exists for yet: this task adds enforcement, not warehouse management. The
 * permission each function declares is the one under test, and the write is only
 * there so "the operation happened" and "the operation rolled back" are
 * distinguishable.
 */

const scopedWrite = mutationWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    code: v.string(),
    installationId: v.optional(v.string()),
  },
  returns: v.string(),
  permissionCode: "receiving.receipt.post",
  target: { table: "warehouses", id: ({ warehouseId }) => warehouseId },
  warehouseId: ({ warehouseId }) => warehouseId,
  installationId: ({ installationId }) => installationId,
  handler: async ({ tenantDb }, { code }) =>
    await tenantDb.insert("warehouses", {
      code,
      name: `Marker ${code}`,
      status: "ACTIVE",
    }),
});

const optionalWarehouseWrite = mutationWithOrg({
  args: { warehouseId: v.optional(v.id("warehouses")) },
  returns: v.null(),
  permissionCode: "receiving.receipt.post",
  target: { table: "warehouses" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: () => null,
});

const entitledWrite = mutationWithOrg({
  args: { warehouseId: v.id("warehouses") },
  returns: v.null(),
  permissionCode: "receiving.receipt.post",
  target: { table: "warehouses", id: ({ warehouseId }) => warehouseId },
  entitlementKey: "SERIAL_TRACKING",
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: () => null,
});

const stepUpWrite = mutationWithOrg({
  args: {},
  returns: v.null(),
  permissionCode: "masterData.warehouse.manage",
  target: { table: "warehouses" },
  handler: () => null,
});

/**
 * An ORG-scoped permission that nonetheless names a warehouse.
 *
 * Legitimate — an organization-wide operation can still be *about* a site — and
 * the case worth pinning: the warehouse is revalidated like any other, so it can
 * only narrow the request, never widen it, and the decision itself never reads it.
 */
const orgWriteAboutWarehouse = mutationWithOrg({
  args: { warehouseId: v.id("warehouses") },
  returns: v.null(),
  permissionCode: "masterData.warehouse.manage",
  target: { table: "warehouses", id: ({ warehouseId }) => warehouseId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: () => null,
});

const ungrantedRead = queryWithOrg({
  args: {},
  returns: v.null(),
  permissionCode: "admin.device.manage",
  target: { table: "devices" },
  handler: () => null,
});

const grantedRead = queryWithOrg({
  args: {},
  returns: v.null(),
  permissionCode: "admin.audit.read",
  target: { table: "auditEvents" },
  handler: () => null,
});

const thresholdWrite = mutationWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    // A browser field with the name of a policy fact. It is never read: the
    // decision uses the callback's server-computed answer (`INV-0006-06`).
    thresholdExceeded: v.optional(v.boolean()),
  },
  returns: v.null(),
  permissionCode: "putaway.task.override",
  target: { table: "warehouses", id: ({ warehouseId }) => warehouseId },
  warehouseId: ({ warehouseId }) => warehouseId,
  policy: async ({ tenantDb }, { warehouseId }) => {
    // Server-computed from stored data: the marker for "above the limit" is the
    // target warehouse's own code, which only a tenant write can change.
    const warehouse = await tenantDb.get<{
      readonly orgId: GenericId<"organizations">;
      readonly code: string;
    }>("warehouses", warehouseId);
    return {
      thresholdExceeded: warehouse?.code === "ALPHA",
      thresholdApproved: false,
    };
  },
  handler: () => null,
});

const approveStatus = mutationWithOrg({
  args: { warehouseId: v.id("warehouses") },
  returns: v.null(),
  permissionCode: "inventory.statusChange.approve",
  target: { table: "warehouses", id: ({ warehouseId }) => warehouseId },
  warehouseId: ({ warehouseId }) => warehouseId,
  policy: async ({ tenantDb }) => {
    // The submission this approval is for, read from the tenant's own audit
    // trail: the maker is whoever the recorded attempt attributes it to.
    const submission = await tenantDb
      .byIndex<{
        readonly orgId: GenericId<"organizations">;
        readonly actorUserId?: GenericId<"users">;
      }>("auditEvents", "by_orgId_occurredAt")
      .first();
    return {
      approvalSatisfied: submission !== null,
      ...(submission?.actorUserId === undefined
        ? {}
        : { makerUserId: submission.actorUserId }),
    };
  },
  handler: () => null,
});

const failingWrite = mutationWithOrg({
  args: { warehouseId: v.id("warehouses") },
  returns: v.null(),
  permissionCode: "receiving.receipt.post",
  target: { table: "warehouses", id: ({ warehouseId }) => warehouseId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async ({ tenantDb }) => {
    await tenantDb.insert("warehouses", {
      code: "ROLLED-BACK",
      name: "Rolled back",
      status: "ACTIVE",
    });
    throw new Error("handler failed after writing");
  },
});

const printLabel = actionWithOrg({
  args: { warehouseId: v.id("warehouses") },
  returns: v.null(),
  permissionCode: "label.print.execute",
  target: { table: "warehouses", id: ({ warehouseId }) => warehouseId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: () => null,
});

const MODULES: ConvexTestModuleMap = {
  "../convex/lib/tenantFunctions.ts": () =>
    import("../../convex/lib/tenantFunctions"),
  "../convex/testing/authorizationFixture.ts": () =>
    Promise.resolve({
      approveStatus,
      entitledWrite,
      failingWrite,
      grantedRead,
      optionalWarehouseWrite,
      orgWriteAboutWarehouse,
      printLabel,
      scopedWrite,
      stepUpWrite,
      thresholdWrite,
      ungrantedRead,
    }),
};

const reference = <
  Kind extends "query" | "mutation" | "action",
  Args extends Record<string, unknown>,
  Result,
>(
  name: string,
) =>
  makeFunctionReference<Kind, Args, TenantFunctionOutcome<Result>>(
    `testing/authorizationFixture:${name}`,
  );

const scopedWriteRef = reference<
  "mutation",
  {
    warehouseId: GenericId<"warehouses">;
    code: string;
    installationId?: string;
  },
  string
>("scopedWrite");
const optionalWarehouseWriteRef = reference<
  "mutation",
  { warehouseId?: GenericId<"warehouses"> },
  null
>("optionalWarehouseWrite");
const entitledWriteRef = reference<
  "mutation",
  { warehouseId: GenericId<"warehouses"> },
  null
>("entitledWrite");
const stepUpWriteRef = reference<"mutation", Record<string, never>, null>(
  "stepUpWrite",
);
const orgWriteAboutWarehouseRef = reference<
  "mutation",
  { warehouseId: GenericId<"warehouses"> },
  null
>("orgWriteAboutWarehouse");
const thresholdWriteRef = reference<
  "mutation",
  { warehouseId: GenericId<"warehouses">; thresholdExceeded?: boolean },
  null
>("thresholdWrite");
const approveStatusRef = reference<
  "mutation",
  { warehouseId: GenericId<"warehouses"> },
  null
>("approveStatus");
const failingWriteRef = reference<
  "mutation",
  { warehouseId: GenericId<"warehouses"> },
  null
>("failingWrite");
const ungrantedReadRef = reference<"query", Record<string, never>, null>(
  "ungrantedRead",
);
const grantedReadRef = reference<"query", Record<string, never>, null>(
  "grantedRead",
);
const printLabelRef = reference<
  "action",
  { warehouseId: GenericId<"warehouses"> },
  null
>("printLabel");

/* -------------------------------------------------------------------------- */
/* Harness                                                                     */
/* -------------------------------------------------------------------------- */

function identity(org: "a" | "b", subject = "user_fixture_a") {
  return { subject, org_id: `org_fixture_${org}` };
}

async function authorizedWorld(
  options: { readonly roleA?: string; readonly roleB?: string } = {},
) {
  const world = await createConvexTenantWorld(MODULES);
  const seeded = await seedConvexAuthorization(world, options);
  return { world, seeded };
}

/** The `ConvexError` payload of a *tenancy* failure, which is still a throw. */
async function thrownData(operation: Promise<unknown>): Promise<Value> {
  try {
    await operation;
    throw new Error("Expected the request to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(ConvexError);
    return (error as ConvexError<Value>).data;
  }
}

/** Assert a denial: generic payload, correlated, and carrying no reason. */
function expectDenied(outcome: TenantFunctionOutcome<unknown>): string {
  if (outcome.ok) {
    throw new Error(`Expected a denial, got ${JSON.stringify(outcome)}`);
  }
  expect(outcome.denial).toMatchObject({
    kind: "AUTHORIZATION_DENIED",
    code: "AUTHORIZATION_DENIED",
    requestId: outcome.requestId,
  });
  expect(JSON.stringify(outcome.denial)).not.toMatch(
    /NO_PERMISSION|OUT_OF_WAREHOUSE_SCOPE|APPROVAL_REQUIRED|THRESHOLD_EXCEEDED|REVERIFICATION_REQUIRED|ENTITLEMENT_DISABLED|INACTIVE_MEMBERSHIP/,
  );
  return outcome.requestId;
}

/** The single audit row of one tenant, with the fields a reader depends on. */
async function onlyAuditRow(
  world: ConvexTenantWorld,
  orgId: GenericId<"organizations">,
): Promise<Record<string, unknown>> {
  const rows = await storedAuditEvents(world, orgId);
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

/* -------------------------------------------------------------------------- */
/* Cases                                                                       */
/* -------------------------------------------------------------------------- */

describe("server-side authorization across two tenants", () => {
  it("allows a granted, in-scope write and audits it in the same transaction", async () => {
    const { world } = await authorizedWorld();
    await recordDevice(world, {
      orgId: world.orgA,
      installationId: "install-a",
    });

    const outcome = await world.t
      .withIdentity(identity("a"))
      .mutation(scopedWriteRef, {
        warehouseId: world.warehouses.alphaA,
        code: "MARKER-A",
        installationId: "install-a",
      });

    if (!outcome.ok) throw new Error("expected the write to be allowed");
    const row = await onlyAuditRow(world, world.orgA);
    expect(row).toMatchObject({
      orgId: world.orgA,
      outcome: "ALLOWED",
      permissionCode: "receiving.receipt.post",
      entityTable: "warehouses",
      entityId: world.warehouses.alphaA,
      warehouseId: world.warehouses.alphaA,
      requestId: outcome.requestId,
      actorKind: "USER",
      actorUserId: world.userA,
    });
    expect(row["deviceId"]).toBeDefined();
    expect(row).not.toHaveProperty("denialReason");

    // The handler's own write committed with it.
    const written = await storedWarehouses(world);
    expect(
      written.filter((warehouse) => warehouse["code"] === "MARKER-A"),
    ).toHaveLength(1);
    // The other tenant sees nothing of either.
    expect(await storedAuditEvents(world, world.orgB)).toHaveLength(0);
  });

  it("denies an actor whose roles do not grant the code, and records why", async () => {
    const { world } = await authorizedWorld();

    const outcome = await world.t
      .withIdentity(identity("a"))
      .query(ungrantedReadRef, {});
    expectDenied(outcome);
    // A query cannot write, so the attempt is enforced but not recorded. This is
    // the documented observability limit (`RG-071`), asserted so it cannot change
    // silently.
    expect(await storedAuditEvents(world, world.orgA)).toHaveLength(0);

    // The same shape on a mutation *is* recorded, with the closed reason.
    const { world: second, seeded } = await authorizedWorld();
    await second.t.run(async (ctx) => {
      await ctx.db.delete("membershipRoles", seeded.membershipRoleA);
    });
    const denied = await second.t
      .withIdentity(identity("a"))
      .mutation(scopedWriteRef, {
        warehouseId: second.warehouses.alphaA,
        code: "NEVER",
      });
    const requestId = expectDenied(denied);
    expect(await onlyAuditRow(second, second.orgA)).toMatchObject({
      outcome: "DENIED",
      denialReason: "NO_PERMISSION",
      permissionCode: "receiving.receipt.post",
      requestId,
    });
    expect(
      (await storedWarehouses(second)).filter(
        (warehouse) => warehouse["code"] === "NEVER",
      ),
    ).toHaveLength(0);
  });

  it("ignores an archived role", async () => {
    const { world, seeded } = await authorizedWorld();
    await world.t.run(async (ctx) => {
      await ctx.db.patch("roles", seeded.rolesA.get(seeded.roleKeyA)!, {
        status: "ARCHIVED",
      });
    });

    expectDenied(
      await world.t.withIdentity(identity("a")).mutation(scopedWriteRef, {
        warehouseId: world.warehouses.alphaA,
        code: "NEVER",
      }),
    );
    expect(await onlyAuditRow(world, world.orgA)).toMatchObject({
      denialReason: "NO_PERMISSION",
    });
  });

  it("ignores the other tenant's role grant and the other tenant's permission row", async () => {
    const { world, seeded } = await authorizedWorld({ roleA: "VIEWER" });
    // `VIEWER` cannot post a receipt. Two cross-tenant rows that must not help:
    // a role grant stored under B naming A's membership, and a permission row
    // stored under B naming A's role.
    await world.t.run(async (ctx) => {
      await ctx.db.insert("membershipRoles", {
        orgId: world.orgB,
        membershipId: seeded.identities.membershipA,
        roleId: seeded.rolesB.get("ORG_ADMIN")!,
        grantedAt: 0,
      });
      await ctx.db.insert("rolePermissions", {
        orgId: world.orgB,
        roleId: seeded.rolesA.get("VIEWER")!,
        permissionCode: "receiving.receipt.post",
      });
    });

    expectDenied(
      await world.t.withIdentity(identity("a")).mutation(scopedWriteRef, {
        warehouseId: world.warehouses.alphaA,
        code: "NEVER",
      }),
    );
    expect(await onlyAuditRow(world, world.orgA)).toMatchObject({
      denialReason: "NO_PERMISSION",
    });
  });

  it.each([
    ["absent", "vanishedWarehouse", "WAREHOUSE_UNKNOWN"],
    ["foreign", "alphaB", "WAREHOUSE_UNKNOWN"],
    ["out-of-scope", "bravoA", "WAREHOUSE_OUT_OF_SCOPE"],
  ] as const)(
    "refuses an %s warehouse before any authorization decision",
    async (_name, key, code) => {
      const { world } = await authorizedWorld();
      const warehouseId =
        key === "vanishedWarehouse"
          ? world.vanishedWarehouse
          : world.warehouses[key];

      const data = await thrownData(
        world.t.withIdentity(identity("a")).mutation(scopedWriteRef, {
          warehouseId,
          code: "NEVER",
        }),
      );
      expect(data).toMatchObject({ kind: "TENANT_CONTEXT_DENIED", code });
      expect(JSON.stringify(data)).not.toContain(String(warehouseId));
      // Tenancy failed, so there is no resolved tenant to audit against.
      expect(await storedAuditEvents(world, world.orgA)).toHaveLength(0);
      expect(await storedAuditEvents(world, world.orgB)).toHaveLength(0);
    },
  );

  it("denies a warehouse permission whose target warehouse is absent from the call", async () => {
    const { world } = await authorizedWorld();

    expectDenied(
      await world.t
        .withIdentity(identity("a"))
        .mutation(optionalWarehouseWriteRef, {}),
    );
    const row = await onlyAuditRow(world, world.orgA);
    expect(row).toMatchObject({ denialReason: "OUT_OF_WAREHOUSE_SCOPE" });
    expect(row).not.toHaveProperty("warehouseId");
  });

  it("denies outside the membership's effective period", async () => {
    for (const period of [
      { effectiveFrom: Date.now() + 60_000 },
      { effectiveFrom: 0, effectiveTo: Date.now() - 1 },
    ]) {
      const { world, seeded } = await authorizedWorld();
      await world.t.run(async (ctx) => {
        await ctx.db.patch(
          "memberships",
          seeded.identities.membershipA,
          period,
        );
      });

      expectDenied(
        await world.t.withIdentity(identity("a")).mutation(scopedWriteRef, {
          warehouseId: world.warehouses.alphaA,
          code: "NEVER",
        }),
      );
      expect(await onlyAuditRow(world, world.orgA)).toMatchObject({
        denialReason: "INACTIVE_MEMBERSHIP",
      });
    }
  });

  it("refuses a suspended membership before authorization runs", async () => {
    const { world, seeded } = await authorizedWorld();
    await world.t.run(async (ctx) => {
      await ctx.db.patch("memberships", seeded.identities.membershipA, {
        status: "SUSPENDED",
      });
    });

    const data = await thrownData(
      world.t.withIdentity(identity("a")).mutation(scopedWriteRef, {
        warehouseId: world.warehouses.alphaA,
        code: "NEVER",
      }),
    );
    expect(data).toMatchObject({
      kind: "TENANT_CONTEXT_DENIED",
      code: "MEMBERSHIP_INACTIVE",
    });
  });

  it("requires an enabled entitlement row of this tenant", async () => {
    const { world } = await authorizedWorld();
    expectDenied(
      await world.t.withIdentity(identity("a")).mutation(entitledWriteRef, {
        warehouseId: world.warehouses.alphaA,
      }),
    );
    expect(await onlyAuditRow(world, world.orgA)).toMatchObject({
      denialReason: "ENTITLEMENT_DISABLED",
    });

    // Disabled, and enabled *for the other tenant*, are both still disabled.
    const { world: second } = await authorizedWorld();
    await recordEntitlement(second, {
      orgId: second.orgA,
      key: "SERIAL_TRACKING",
      enabled: false,
    });
    await recordEntitlement(second, {
      orgId: second.orgB,
      key: "SERIAL_TRACKING",
      enabled: true,
    });
    expectDenied(
      await second.t.withIdentity(identity("a")).mutation(entitledWriteRef, {
        warehouseId: second.warehouses.alphaA,
      }),
    );

    const { world: third } = await authorizedWorld();
    await recordEntitlement(third, {
      orgId: third.orgA,
      key: "SERIAL_TRACKING",
      enabled: true,
    });
    const allowed = await third.t
      .withIdentity(identity("a"))
      .mutation(entitledWriteRef, { warehouseId: third.warehouses.alphaA });
    expect(allowed.ok).toBe(true);
  });

  it("requires fresh step-up evidence for this actor in this tenant", async () => {
    const now = Date.now();
    const cases = [
      { name: "none", events: [] as const },
      {
        name: "stale",
        events: [
          { occurredAt: now - 3_600_000, reverifiedAt: now - 3_600_000 },
        ],
      },
      {
        name: "future",
        events: [{ occurredAt: now, reverifiedAt: now + 60_000 }],
      },
      {
        name: "denied",
        events: [
          {
            occurredAt: now,
            reverifiedAt: now,
            eventType: "STEP_UP_DENIED" as const,
          },
        ],
      },
    ];

    for (const testCase of cases) {
      const { world } = await authorizedWorld();
      for (const event of testCase.events) {
        await recordStepUp(world, {
          orgId: world.orgB,
          userId: world.userA,
          ...event,
        });
      }
      expectDenied(
        await world.t.withIdentity(identity("b")).mutation(stepUpWriteRef, {}),
      );
      expect(await onlyAuditRow(world, world.orgB)).toMatchObject({
        denialReason: "REVERIFICATION_REQUIRED",
        permissionCode: "masterData.warehouse.manage",
      });
    }

    // Evidence recorded for the *other* tenant is not evidence here.
    const { world: foreign } = await authorizedWorld();
    await recordStepUp(foreign, {
      orgId: foreign.orgA,
      userId: foreign.userA,
      occurredAt: now,
      reverifiedAt: now,
    });
    expectDenied(
      await foreign.t.withIdentity(identity("b")).mutation(stepUpWriteRef, {}),
    );

    const { world: fresh } = await authorizedWorld();
    await recordStepUp(fresh, {
      orgId: fresh.orgB,
      userId: fresh.userA,
      occurredAt: now,
      reverifiedAt: now,
    });
    const allowed = await fresh.t
      .withIdentity(identity("b"))
      .mutation(stepUpWriteRef, {});
    expect(allowed.ok).toBe(true);
    expect(await onlyAuditRow(fresh, fresh.orgB)).toMatchObject({
      outcome: "ALLOWED",
    });
  });

  it("decides a threshold from server-computed data, never from the argument", async () => {
    const { world } = await authorizedWorld();

    // The policy computes "above the limit" from the stored warehouse code, and
    // the argument that claims otherwise is ignored.
    expectDenied(
      await world.t.withIdentity(identity("a")).mutation(thresholdWriteRef, {
        warehouseId: world.warehouses.alphaA,
        thresholdExceeded: false,
      }),
    );
    expect(await onlyAuditRow(world, world.orgA)).toMatchObject({
      denialReason: "THRESHOLD_EXCEEDED",
      permissionCode: "putaway.task.override",
    });

    // Change the stored fact and the same call is allowed, with the same argument
    // absent — the policy, not the caller, moved the decision.
    const { world: second } = await authorizedWorld();
    await second.t.run(async (ctx) => {
      await ctx.db.patch("warehouses", second.warehouses.alphaA, {
        code: "UNDER-LIMIT",
      });
    });
    const allowed = await second.t
      .withIdentity(identity("a"))
      .mutation(thresholdWriteRef, {
        warehouseId: second.warehouses.alphaA,
        thresholdExceeded: true,
      });
    expect(allowed.ok).toBe(true);
  });

  it("refuses an approval whose maker is the approving actor", async () => {
    const { world } = await authorizedWorld();
    const otherUser = await world.t.run(
      async (ctx) =>
        await ctx.db.insert("users", {
          clerkUserId: "user_fixture_maker",
          displayName: "Maker",
          status: "ACTIVE",
        }),
    );

    // A submission attributed to the approver: self-approval, denied.
    const selfSubmission = async (
      target: ConvexTenantWorld,
      actorUserId: GenericId<"users">,
    ) => {
      await target.t.run(async (ctx) => {
        await ctx.db.insert("auditEvents", {
          orgId: target.orgA,
          occurredAt: 1,
          actorKind: "USER",
          actorUserId,
          action: "inventory.statusChange.submit",
          permissionCode: "inventory.statusChange.submit",
          entityTable: "warehouses",
          outcome: "ALLOWED",
          requestId: "req_fixture_submission",
        });
      });
    };

    await selfSubmission(world, world.userA);
    expectDenied(
      await world.t.withIdentity(identity("a")).mutation(approveStatusRef, {
        warehouseId: world.warehouses.alphaA,
      }),
    );
    const rows = await storedAuditEvents(world, world.orgA);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      outcome: "DENIED",
      denialReason: "APPROVAL_REQUIRED",
    });

    const { world: second } = await authorizedWorld();
    await selfSubmission(second, otherUser);
    const allowed = await second.t
      .withIdentity(identity("a"))
      .mutation(approveStatusRef, { warehouseId: second.warehouses.alphaA });
    expect(allowed.ok).toBe(true);
  });

  it("rolls an allowed attempt back with the handler that failed", async () => {
    const { world } = await authorizedWorld();

    const data = await thrownData(
      world.t.withIdentity(identity("a")).mutation(failingWriteRef, {
        warehouseId: world.warehouses.alphaA,
      }),
    );
    expect(data).toMatchObject({ code: "INTERNAL_ERROR" });

    // Neither the handler's row nor the `ALLOWED` audit row survives: one
    // transaction, one outcome. This is exactly why a *denial* returns instead of
    // throwing — a thrown denial would take its own `DENIED` row with it.
    expect(await storedAuditEvents(world, world.orgA)).toHaveLength(0);
    expect(
      (await storedWarehouses(world)).filter(
        (warehouse) => warehouse["code"] === "ROLLED-BACK",
      ),
    ).toHaveLength(0);
  });

  it("audits an action denial in the preflight, before any external work", async () => {
    const { world, seeded } = await authorizedWorld();
    await world.t.run(async (ctx) => {
      await ctx.db.delete("membershipRoles", seeded.membershipRoleA);
    });

    const outcome = await world.t
      .withIdentity(identity("a"))
      .action(printLabelRef, { warehouseId: world.warehouses.alphaA });
    const requestId = expectDenied(outcome);

    // The preflight is a separate transaction that committed before the action
    // returned, so the denial is durable even though the action refused to work.
    expect(await onlyAuditRow(world, world.orgA)).toMatchObject({
      outcome: "DENIED",
      denialReason: "NO_PERMISSION",
      permissionCode: "label.print.execute",
      requestId,
    });
  });

  it("correlates a device only when the installation ID is this tenant's", async () => {
    const { world } = await authorizedWorld();
    const deviceA = await recordDevice(world, {
      orgId: world.orgA,
      installationId: "install-shared",
    });
    await recordDevice(world, {
      orgId: world.orgB,
      installationId: "install-foreign",
    });

    const mine = await world.t
      .withIdentity(identity("a"))
      .mutation(scopedWriteRef, {
        warehouseId: world.warehouses.alphaA,
        code: "DEVICE-A",
        installationId: "install-shared",
      });
    expect(mine.ok).toBe(true);
    expect(await onlyAuditRow(world, world.orgA)).toMatchObject({
      deviceId: deviceA,
    });

    // The other tenant's installation ID resolves to nothing here, and changes
    // no decision: a device is context, never capability.
    const { world: second } = await authorizedWorld();
    await recordDevice(second, {
      orgId: second.orgB,
      installationId: "install-foreign",
    });
    const foreign = await second.t
      .withIdentity(identity("a"))
      .mutation(scopedWriteRef, {
        warehouseId: second.warehouses.alphaA,
        code: "DEVICE-B",
        installationId: "install-foreign",
      });
    expect(foreign.ok).toBe(true);
    expect(await onlyAuditRow(second, second.orgA)).not.toHaveProperty(
      "deviceId",
    );
  });

  it("grants nothing through an enabled, fully approved support grant", async () => {
    const { world } = await authorizedWorld();
    const outsider = "user_fixture_outsider";
    await world.t.run(async (ctx) => {
      await ctx.db.insert("users", {
        clerkUserId: outsider,
        displayName: "Outsider",
        status: "ACTIVE",
      });
      // The most permissive grant the schema can express, and enabled by policy.
      await ctx.db.patch("organizations", world.orgA, {
        settings: {
          ...(await ctx.db.get("organizations", world.orgA))!.settings,
          supportGrantsEnabled: true,
        },
      });
      await ctx.db.insert("supportGrants", {
        orgId: world.orgA,
        status: "ACTIVE",
        accessMode: "READ_WRITE",
        reason: "Fixture diagnosis",
        ticketRef: "TICKET-1",
        requestedBy: "platform_one",
        requestedAt: 0,
        firstApprovalBy: "platform_one",
        firstApprovalAt: 1,
        secondApprovalBy: "platform_two",
        secondApprovalAt: 2,
        tenantApprovalByUserId: world.userA,
        tenantApprovalAt: 3,
        expiresAt: Date.now() + 3_600_000,
      });
    });

    // An actor with no membership in the tenant is still anonymous to it.
    expect(
      await thrownData(
        world.t.withIdentity(identity("a", outsider)).query(grantedReadRef, {}),
      ),
    ).toMatchObject({
      kind: "TENANT_CONTEXT_DENIED",
      code: "MEMBERSHIP_MISSING",
    });

    // And a member's own missing permission is still missing.
    expectDenied(
      await world.t.withIdentity(identity("a")).query(ungrantedReadRef, {}),
    );
  });

  it("revalidates a warehouse an organization-wide decision merely mentions", async () => {
    const now = Date.now();

    // The other tenant's warehouse is refused before the ORG decision is reached,
    // so naming it cannot widen anything — and the payload does not confirm it
    // exists.
    const { world } = await authorizedWorld({ roleA: "ORG_ADMIN" });
    await recordStepUp(world, {
      orgId: world.orgA,
      userId: world.userA,
      occurredAt: now,
      reverifiedAt: now,
    });
    const data = await thrownData(
      world.t.withIdentity(identity("a")).mutation(orgWriteAboutWarehouseRef, {
        warehouseId: world.warehouses.alphaB,
      }),
    );
    expect(data).toMatchObject({
      kind: "TENANT_CONTEXT_DENIED",
      code: "WAREHOUSE_UNKNOWN",
    });
    expect(JSON.stringify(data)).not.toContain(String(world.warehouses.alphaB));

    // This tenant's in-scope warehouse is allowed, and the audit row names the
    // warehouse the server resolved rather than the argument it was sent.
    const allowed = await world.t
      .withIdentity(identity("a"))
      .mutation(orgWriteAboutWarehouseRef, {
        warehouseId: world.warehouses.alphaA,
      });
    expect(allowed.ok).toBe(true);
    expect(await onlyAuditRow(world, world.orgA)).toMatchObject({
      outcome: "ALLOWED",
      permissionCode: "masterData.warehouse.manage",
      warehouseId: world.warehouses.alphaA,
      entityId: world.warehouses.alphaA,
    });
  });

  it("keeps two tenants' decisions independent for the same code and actor", async () => {
    // A holds `VIEWER` (no receipt posting), B holds `ORG_ADMIN` (everything).
    const { world } = await authorizedWorld({ roleA: "VIEWER" });

    expectDenied(
      await world.t.withIdentity(identity("a")).mutation(scopedWriteRef, {
        warehouseId: world.warehouses.alphaA,
        code: "NEVER",
      }),
    );
    const allowed = await world.t
      .withIdentity(identity("b"))
      .mutation(scopedWriteRef, {
        warehouseId: world.warehouses.alphaB,
        code: "ALLOWED-B",
      });
    expect(allowed.ok).toBe(true);

    expect(await onlyAuditRow(world, world.orgA)).toMatchObject({
      outcome: "DENIED",
      denialReason: "NO_PERMISSION",
    });
    expect(await onlyAuditRow(world, world.orgB)).toMatchObject({
      outcome: "ALLOWED",
    });
  });
});
