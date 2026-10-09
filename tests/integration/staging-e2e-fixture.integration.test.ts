import { ConvexError } from "convex/values";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import type { Id, TableNames } from "../../convex/_generated/dataModel";
import type { IdentityWebhookEvent } from "../../convex/lib/identityWebhook";
import schema from "../../convex/schema";
import * as fixture from "../../convex/staging/e2eFixture";
import {
  createConvexTenantWorld,
  type ConvexTenantWorld,
  type ConvexTestModuleMap,
} from "../fixtures/convex-tenant-world";
import { snapshotOf } from "../fixtures/public-contract";

const MODULES: ConvexTestModuleMap = Object.fromEntries(
  Object.entries(
    import.meta.glob([
      "../../convex/**/*.ts",
      "!../../convex/_generated/**",
      "!../../convex/**/*.test.ts",
    ]) as Record<string, () => Promise<unknown>>,
  ).map(([path, load]) => [path.replace("../../convex/", "../convex/"), load]),
);
const STAGING = {
  CONVEX_CLOUD_URL: "https://befitting-stoat-208.convex.cloud",
  E2E_FIXTURE_TARGET: "befitting-stoat-208",
};
const confirmation = fixture.E2E_FIXTURE_CONFIRMATION;
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
function stub(env: Record<string, string>) {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
}

/** Registered normalized-event fixture. Real signed HTTP/JWT delivery needs staging. */
async function syntheticWorld(
  runId = "run-000001",
  existing?: ConvexTenantWorld,
) {
  const world = existing ?? (await createConvexTenantWorld(MODULES));
  const args = {
    confirmation,
    runId,
    clerkOrganizationId: `org_e2e_${runId}_primary`,
    otherClerkOrganizationId: `org_e2e_${runId}_other`,
    clerkUserId: `user_e2e_${runId}`,
    clerkMembershipId: `orgmem_e2e_${runId}`,
  } as const;
  const clock = Date.now() - 100;
  const events: IdentityWebhookEvent[] = [
    {
      type: "organization.upsert",
      eventId: `msg_${runId}_primary`,
      eventAt: clock,
      eventTimestamp: clock,
      data: {
        clerkOrganizationId: args.clerkOrganizationId,
        name: fixture.organizationName(runId, "primary"),
      },
    },
    {
      type: "organization.upsert",
      eventId: `msg_${runId}_other`,
      eventAt: clock,
      eventTimestamp: clock,
      data: {
        clerkOrganizationId: args.otherClerkOrganizationId,
        name: fixture.organizationName(runId, "other"),
      },
    },
    {
      type: "user.upsert",
      eventId: `msg_${runId}_user`,
      eventAt: clock,
      eventTimestamp: clock,
      data: {
        clerkUserId: args.clerkUserId,
        displayName: fixture.userDisplayName(runId),
      },
    },
    {
      type: "membership.upsert",
      eventId: `msg_${runId}_member`,
      eventAt: clock,
      eventTimestamp: clock,
      data: {
        clerkOrganizationId: args.clerkOrganizationId,
        name: fixture.organizationName(runId, "primary"),
        clerkUserId: args.clerkUserId,
        displayName: fixture.userDisplayName(runId),
        clerkMembershipId: args.clerkMembershipId,
      },
    },
  ];
  for (const event of events)
    await world.t.mutation(
      internal.lib.identityMirrorConvex.applyClerkIdentityEvent,
      { event },
    );
  const ids = await world.t.run(async (ctx) => {
    const orgA = await ctx.db
      .query("organizations")
      .withIndex("by_clerkOrganizationId", (q) =>
        q.eq("clerkOrganizationId", args.clerkOrganizationId),
      )
      .unique();
    const orgB = await ctx.db
      .query("organizations")
      .withIndex("by_clerkOrganizationId", (q) =>
        q.eq("clerkOrganizationId", args.otherClerkOrganizationId),
      )
      .unique();
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", args.clerkUserId))
      .unique();
    if (orgA === null || orgB === null || user === null)
      throw new Error("Identity fixture did not apply.");
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_orgId_clerkMembershipId", (q) =>
        q.eq("orgId", orgA._id).eq("clerkMembershipId", args.clerkMembershipId),
      )
      .unique();
    if (membership === null)
      throw new Error("Membership fixture did not apply.");
    return {
      orgA: orgA._id,
      orgB: orgB._id,
      user: user._id,
      membership: membership._id,
    };
  });
  return {
    ...world,
    ids,
    args,
    manager: { subject: args.clerkUserId, org_id: args.clerkOrganizationId },
  };
}
const building = (warehouseId: Id<"warehouses">, code: string) => ({
  warehouseId,
  requestId: `req-${code}`,
  code,
  name: `CI ${code}`,
  widthMm: 10_000,
  depthMm: 10_000,
  defaultFloorHeightMm: 3_000,
  floorCount: 1,
});
async function prepare(world: Awaited<ReturnType<typeof syntheticWorld>>) {
  return await world.t.mutation(
    internal.staging.e2eFixture.prepare,
    world.args,
  );
}
async function status(world: Awaited<ReturnType<typeof syntheticWorld>>) {
  return await world.t.query(
    internal.staging.e2eFixture.identityStatus,
    world.args,
  );
}
async function deleteOwnedParents(
  world: Awaited<ReturnType<typeof syntheticWorld>>,
) {
  const clock = Date.now();
  const events: IdentityWebhookEvent[] = [
    {
      type: "organization.delete",
      eventId: "msg_parent_primary_delete",
      eventAt: clock,
      eventTimestamp: clock,
      data: { clerkOrganizationId: world.args.clerkOrganizationId },
    },
    {
      type: "organization.delete",
      eventId: "msg_parent_other_delete",
      eventAt: clock,
      eventTimestamp: clock,
      data: { clerkOrganizationId: world.args.otherClerkOrganizationId },
    },
    {
      type: "user.delete",
      eventId: "msg_parent_user_delete",
      eventAt: clock,
      eventTimestamp: clock,
      data: { clerkUserId: world.args.clerkUserId },
    },
  ];
  for (const event of events)
    await world.t.mutation(
      internal.lib.identityMirrorConvex.applyClerkIdentityEvent,
      { event },
    );
}
async function denied(operation: Promise<unknown>, code: string) {
  const error = await operation.then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(error).toBeInstanceOf(ConvexError);
  expect(error).toMatchObject({
    data: { kind: "TENANT_CONTEXT_DENIED", code },
  });
}
const countedTables = Object.keys(schema.tables) as TableNames[];
async function rowCounts(world: ConvexTenantWorld) {
  return await world.t.run(async (ctx) => {
    const rows = await Promise.all(
      countedTables.map(async (table) => ({
        table,
        count: (await ctx.db.query(table).collect()).length,
      })),
    );
    return {
      total: rows.reduce((sum, { count }) => sum + count, 0),
      tables: Object.fromEntries(
        rows.map(({ table, count }) => [table, count]),
      ),
    };
  });
}

describe("staging fixture target and registered boundary", () => {
  it("exports only internal registered functions", () => {
    const inventory = snapshotOf({ "staging/e2eFixture": fixture });
    expect(Object.keys(inventory).sort()).toEqual([
      "staging/e2eFixture:cleanup",
      "staging/e2eFixture:cleanupPartial",
      "staging/e2eFixture:identityStatus",
      "staging/e2eFixture:prepare",
      "staging/e2eFixture:staleRuns",
    ]);
    expect(
      Object.values(inventory).every(
        (entry) => entry.visibility === "internal",
      ),
    ).toBe(true);
  });
  it("accepts only marked staging or explicit loopback", () => {
    expect(fixture.assertE2eFixtureTarget(STAGING)).toBe("befitting-stoat-208");
    expect(
      fixture.assertE2eFixtureTarget({
        CONVEX_CLOUD_URL: "http://127.0.0.1:3210",
        E2E_FIXTURE_TARGET: "local",
      }),
    ).toBe("local");
    for (const env of [
      {
        CONVEX_CLOUD_URL: "https://greedy-cardinal-537.convex.cloud",
        E2E_FIXTURE_TARGET: "greedy-cardinal-537",
      },
      { CONVEX_CLOUD_URL: STAGING.CONVEX_CLOUD_URL },
      { ...STAGING, E2E_FIXTURE_TARGET: "local" },
      {
        CONVEX_CLOUD_URL: "https://other-otter-1.convex.cloud",
        E2E_FIXTURE_TARGET: "other-otter-1",
      },
      { CONVEX_CLOUD_URL: "http://127.0.0.1:3210" },
      { CONVEX_CLOUD_URL: "http://10.0.0.2:3210", E2E_FIXTURE_TARGET: "local" },
      {},
    ])
      expect(() => fixture.assertE2eFixtureTarget(env)).toThrow();
  });
  it("refuses every registered function on production, even when marked", async () => {
    const world = await syntheticWorld();
    stub({
      CONVEX_CLOUD_URL: "https://greedy-cardinal-537.convex.cloud",
      E2E_FIXTURE_TARGET: "greedy-cardinal-537",
    });
    for (const operation of [
      () => world.t.mutation(internal.staging.e2eFixture.prepare, world.args),
      () => world.t.mutation(internal.staging.e2eFixture.cleanup, world.args),
      () =>
        world.t.mutation(
          internal.staging.e2eFixture.cleanupPartial,
          world.args,
        ),
      () =>
        world.t.query(internal.staging.e2eFixture.identityStatus, world.args),
      () =>
        world.t.query(internal.staging.e2eFixture.staleRuns, {
          ...world.args,
          olderThanMs: 3_600_000,
        }),
    ])
      await expect(operation()).rejects.toThrow(/never run on production/);
  });
  it("refuses an unmarked deployment and wrong confirmation", async () => {
    const world = await syntheticWorld();
    stub({
      CONVEX_CLOUD_URL: STAGING.CONVEX_CLOUD_URL,
      E2E_FIXTURE_TARGET: "",
    });
    await expect(prepare(world)).rejects.toThrow(/E2E_FIXTURE_TARGET/);
    stub(STAGING);
    await expect(
      world.t.mutation(internal.staging.e2eFixture.prepare, {
        ...world.args,
        confirmation: "YES" as typeof confirmation,
      }),
    ).rejects.toThrow(/Validator error/);
  });
  it("rejects malformed run IDs", async () => {
    const world = await syntheticWorld();
    stub(STAGING);
    for (const runId of [
      "",
      "short",
      "UPPER-CASE-1",
      "../../etc",
      "x".repeat(41),
    ]) {
      await expect(
        world.t.mutation(internal.staging.e2eFixture.prepare, {
          ...world.args,
          runId,
        }),
      ).rejects.toThrow(/Invalid run ID/);
    }
  });
});

describe("exact per-run identity ownership and readiness", () => {
  it("reports all exact verified mirrors ready without exposing documents", async () => {
    const world = await syntheticWorld();
    stub(STAGING);
    expect(await status(world)).toEqual({
      ready: true,
      organizations: 2,
      user: true,
      membership: true,
    });
  });
  it.each(["primary", "other", "user", "membership"] as const)(
    "waits when the %s signed-event watermark is missing",
    async (kind) => {
      const world = await syntheticWorld();
      stub(STAGING);
      await world.t.run(async (ctx) => {
        if (kind === "primary" || kind === "other")
          await ctx.db.patch(
            "organizations",
            kind === "primary" ? world.ids.orgA : world.ids.orgB,
            { clerkLastEventTimestamp: undefined },
          );
        else if (kind === "user")
          await ctx.db.patch("users", world.ids.user, {
            clerkLastEventTimestamp: undefined,
          });
        else
          await ctx.db.patch("memberships", world.ids.membership, {
            clerkLastEventTimestamp: undefined,
          });
      });
      expect((await status(world)).ready).toBe(false);
      await expect(prepare(world)).rejects.toThrow(/not ready or owned/);
      await expect(
        world.t.mutation(internal.staging.e2eFixture.cleanup, world.args),
      ).rejects.toThrow(/not ready or owned/);
    },
  );
  it("refuses a prefix lookalike, wrong run and wrong user owner without writes", async () => {
    const world = await syntheticWorld();
    const second = await syntheticWorld("run-000002", world);
    stub(STAGING);
    const before = await rowCounts(world);
    for (const args of [
      { ...world.args, runId: second.args.runId },
      { ...world.args, clerkUserId: second.args.clerkUserId },
    ]) {
      await expect(
        world.t.mutation(internal.staging.e2eFixture.prepare, args),
      ).rejects.toThrow(/not ready or owned/);
      await expect(
        world.t.mutation(internal.staging.e2eFixture.cleanup, args),
      ).rejects.toThrow(/not ready or owned/);
    }
    await world.t.run(async (ctx) =>
      ctx.db.patch("organizations", world.ids.orgA, {
        name: "CI E2E unrelated tenant",
      }),
    );
    expect((await status(world)).ready).toBe(false);
    await expect(prepare(world)).rejects.toThrow(/not ready or owned/);
    expect(await rowCounts(world)).toEqual(before);
  });
  it.each([
    "inactive-user",
    "expired-member",
    "wrong-member-owner",
    "double-active",
  ] as const)("fails closed for %s", async (cause) => {
    const world = await syntheticWorld();
    stub(STAGING);
    await world.t.run(async (ctx) => {
      if (cause === "inactive-user")
        await ctx.db.patch("users", world.ids.user, { status: "DEACTIVATED" });
      else if (cause === "expired-member")
        await ctx.db.patch("memberships", world.ids.membership, {
          effectiveTo: Date.now() - 1,
        });
      else if (cause === "wrong-member-owner")
        await ctx.db.patch("memberships", world.ids.membership, {
          userId: world.userA,
        });
      else {
        const row = await ctx.db.get("memberships", world.ids.membership);
        if (row === null) throw new Error("Missing fixture membership.");
        const { _id, _creationTime, ...fields } = row;
        void _id;
        void _creationTime;
        await ctx.db.insert("memberships", {
          ...fields,
          clerkMembershipId: "orgmem_duplicate",
        });
      }
    });
    expect((await status(world)).ready).toBe(false);
    await expect(prepare(world)).rejects.toThrow(/not ready or owned/);
  });
  it("refuses unrelated scopes instead of extending a shared identity's grants", async () => {
    const world = await syntheticWorld();
    stub(STAGING);
    const unrelated = await world.t.run(async (ctx) => {
      const warehouseId = await ctx.db.insert("warehouses", {
        orgId: world.ids.orgA,
        code: "OTHER",
        name: "Unrelated",
        status: "ACTIVE",
      });
      await ctx.db.insert("membershipWarehouses", {
        orgId: world.ids.orgA,
        membershipId: world.ids.membership,
        warehouseId,
      });
      return warehouseId;
    });
    await expect(prepare(world)).rejects.toThrow(/unrelated warehouse scope/);
    await expect(
      world.t.mutation(internal.staging.e2eFixture.cleanup, world.args),
    ).rejects.toThrow(/unrelated warehouses/);
    expect(
      await world.t.run(async (ctx) => ctx.db.get("warehouses", unrelated)),
    ).not.toBeNull();
  });
});

describe("prepared staging authorization", () => {
  it("uses the actual manager role, reads/writes its run and denies other warehouses", async () => {
    const world = await syntheticWorld();
    const second = await syntheticWorld("run-000002", world);
    stub(STAGING);
    const first = await prepare(world);
    const otherRun = await prepare(second);
    expect(await prepare(world)).toEqual(first);
    const actor = world.t.withIdentity(world.manager);
    const workspace = await actor.query(api.workspace.current.readCurrent, {});
    expect(workspace).toMatchObject({
      ok: true,
      value: {
        warehouses: [{ id: first.runWarehouseId, code: "E2E-RUN-000001" }],
      },
    });
    const created = await actor.mutation(
      api.storageLayouts.writes.createStorageBuilding,
      building(first.runWarehouseId, "E2E-B1"),
    );
    expect(created).toMatchObject({
      ok: true,
      value: { written: true, documentId: expect.any(String) },
    });
    await denied(
      actor.mutation(
        api.storageLayouts.writes.createStorageBuilding,
        building(first.forbiddenWarehouseId, "DENIED-1"),
      ),
      "WAREHOUSE_OUT_OF_SCOPE",
    );
    await denied(
      actor.mutation(
        api.storageLayouts.writes.createStorageBuilding,
        building(first.otherTenantWarehouseId, "DENIED-2"),
      ),
      "WAREHOUSE_UNKNOWN",
    );
    await denied(
      actor.mutation(
        api.storageLayouts.writes.createStorageBuilding,
        building(otherRun.runWarehouseId, "DENIED-3"),
      ),
      "WAREHOUSE_UNKNOWN",
    );
    await denied(
      actor.query(api.finishedGoods.workflow.list, {
        warehouseId: first.forbiddenWarehouseId,
      }),
      "WAREHOUSE_OUT_OF_SCOPE",
    );
    await denied(
      actor.query(api.finishedGoods.workflow.list, {
        warehouseId: otherRun.runWarehouseId,
      }),
      "WAREHOUSE_UNKNOWN",
    );
  });
});

describe("bounded truthful cleanup", () => {
  it("keeps deletion acknowledgement pending until all exact mirrors receive delete events", async () => {
    const world = await syntheticWorld();
    stub(STAGING);
    await prepare(world);
    const before = await world.t.mutation(
      internal.staging.e2eFixture.cleanupPartial,
      world.args,
    );
    expect(before.done).toBe(true);
    expect(before.mirrorsPending).toBe(4);
    const clock = Date.now();
    const events: IdentityWebhookEvent[] = [
      {
        type: "organization.delete",
        eventId: "msg_cleanup_delete_primary",
        eventAt: clock,
        eventTimestamp: clock,
        data: { clerkOrganizationId: world.args.clerkOrganizationId },
      },
      {
        type: "organization.delete",
        eventId: "msg_cleanup_delete_other",
        eventAt: clock,
        eventTimestamp: clock,
        data: { clerkOrganizationId: world.args.otherClerkOrganizationId },
      },
      {
        type: "user.delete",
        eventId: "msg_cleanup_delete_user",
        eventAt: clock,
        eventTimestamp: clock,
        data: { clerkUserId: world.args.clerkUserId },
      },
      {
        type: "membership.delete",
        eventId: "msg_cleanup_delete_membership",
        eventAt: clock,
        eventTimestamp: clock,
        data: {
          clerkOrganizationId: world.args.clerkOrganizationId,
          name: fixture.organizationName(world.args.runId, "primary"),
          clerkUserId: world.args.clerkUserId,
          displayName: fixture.userDisplayName(world.args.runId),
          clerkMembershipId: world.args.clerkMembershipId,
        },
      },
    ];
    // Normal teardown explicitly deletes membership before either parent.
    const directOrder = [events[3]!, ...events.slice(0, 3)];
    for (const [index, event] of directOrder.entries()) {
      await world.t.mutation(
        internal.lib.identityMirrorConvex.applyClerkIdentityEvent,
        { event },
      );
      const output = await world.t.mutation(
        internal.staging.e2eFixture.cleanupPartial,
        world.args,
      );
      expect(output.done).toBe(true);
      expect(output.mirrorsPending).toBe(3 - index);
    }
    const mirrors = await world.t.run(async (ctx) => ({
      primary: await ctx.db.get("organizations", world.ids.orgA),
      other: await ctx.db.get("organizations", world.ids.orgB),
      user: await ctx.db.get("users", world.ids.user),
      membership: await ctx.db.get("memberships", world.ids.membership),
    }));
    expect(mirrors.primary?.status).toBe("CLOSED");
    expect(mirrors.other?.status).toBe("CLOSED");
    expect(mirrors.user?.status).toBe("DEACTIVATED");
    expect(mirrors.membership?.status).toBe("REVOKED");
    expect(
      await world.t.mutation(
        internal.staging.e2eFixture.cleanupPartial,
        world.args,
      ),
    ).toEqual({ deleted: 0, done: true, mirrorsPending: 0 });
    expect(
      await world.t.run(async (ctx) => ({
        primary: await ctx.db.get("organizations", world.ids.orgA),
        other: await ctx.db.get("organizations", world.ids.orgB),
        user: await ctx.db.get("users", world.ids.user),
        membership: await ctx.db.get("memberships", world.ids.membership),
      })),
    ).toEqual(mirrors);
  });
  it("settles a retained historical member only with both later signed terminal parents without changing it", async () => {
    const world = await syntheticWorld();
    stub(STAGING);
    await prepare(world);
    const member = await world.t.run(async (ctx) =>
      ctx.db.get("memberships", world.ids.membership),
    );
    await deleteOwnedParents(world);
    const output = await world.t.mutation(
      internal.staging.e2eFixture.cleanupPartial,
      world.args,
    );
    expect(output.done).toBe(true);
    expect(output.mirrorsPending).toBe(0);
    expect(
      await world.t.run(async (ctx) =>
        ctx.db.get("memberships", world.ids.membership),
      ),
    ).toEqual(member);
    expect(member?.status).toBe("ACTIVE");
    await denied(
      world.t
        .withIdentity(world.manager)
        .query(api.workspace.current.readCurrent, {}),
      "USER_INACTIVE",
    );
  });
  it.each([
    "organization-clock",
    "user-clock",
    "membership-clock",
    "missing-member",
    "later-member-clock",
  ] as const)(
    "does not settle parent-cascade recovery with %s missing or unproven",
    async (gap) => {
      const world = await syntheticWorld();
      stub(STAGING);
      await deleteOwnedParents(world);
      await world.t.run(async (ctx) => {
        if (gap === "organization-clock")
          await ctx.db.patch("organizations", world.ids.orgA, {
            clerkLastEventTimestamp: undefined,
          });
        if (gap === "user-clock")
          await ctx.db.patch("users", world.ids.user, {
            clerkLastEventTimestamp: undefined,
          });
        if (gap === "membership-clock")
          await ctx.db.patch("memberships", world.ids.membership, {
            clerkLastEventTimestamp: undefined,
          });
        if (gap === "missing-member")
          await ctx.db.delete("memberships", world.ids.membership);
        if (gap === "later-member-clock")
          await ctx.db.patch("memberships", world.ids.membership, {
            clerkLastEventTimestamp: Date.now() + 60_000,
          });
      });
      const output = await world.t.mutation(
        internal.staging.e2eFixture.cleanupPartial,
        world.args,
      );
      expect(output.mirrorsPending).toBeGreaterThan(0);
    },
  );
  it.each([
    "duplicate-id",
    "duplicate-current",
    "foreign-association",
  ] as const)(
    "refuses parent-cascade recovery before deletion on %s",
    async (gap) => {
      const world = await syntheticWorld();
      const other = await syntheticWorld("run-000002", world);
      stub(STAGING);
      await deleteOwnedParents(world);
      await world.t.run(async (ctx) => {
        const member = await ctx.db.get("memberships", world.ids.membership);
        if (member === null) throw new Error("Missing synthetic member.");
        if (gap === "foreign-association")
          await ctx.db.patch("memberships", member._id, {
            userId: other.ids.user,
          });
        else {
          const { _id: _id, _creationTime: _creationTime, ...data } = member;
          await ctx.db.insert("memberships", {
            ...data,
            ...(gap === "duplicate-current"
              ? { clerkMembershipId: "orgmem_other_current" }
              : {}),
          });
        }
      });
      const before = await rowCounts(world);
      await expect(
        world.t.mutation(
          internal.staging.e2eFixture.cleanupPartial,
          world.args,
        ),
      ).rejects.toThrow(/ambiguous|not owned/);
      expect(await rowCounts(world)).toEqual(before);
    },
  );
  it("compensates a partial mirror without granting access or changing identity clocks", async () => {
    const world = await syntheticWorld();
    stub(STAGING);
    await world.t.run(async (ctx) => {
      await ctx.db.patch("organizations", world.ids.orgA, {
        clerkLastEventTimestamp: undefined,
      });
      await ctx.db.patch("users", world.ids.user, { status: "DEACTIVATED" });
    });
    const before = await world.t.run(async (ctx) => ({
      organization: await ctx.db.get("organizations", world.ids.orgA),
      user: await ctx.db.get("users", world.ids.user),
      otherRoles: await ctx.db
        .query("roles")
        .withIndex("by_orgId_key", (q) => q.eq("orgId", world.ids.orgB))
        .collect(),
    }));
    await expect(prepare(world)).rejects.toThrow(/not ready or owned/);
    const result = await world.t.mutation(
      internal.staging.e2eFixture.cleanupPartial,
      {
        confirmation,
        runId: world.args.runId,
        clerkOrganizationId: world.args.clerkOrganizationId,
        clerkUserId: world.args.clerkUserId,
        otherClerkOrganizationId: "org_not_yet_mirrored",
      },
    );
    expect(result.done).toBe(true);
    expect(result.deleted).toBeGreaterThan(0);
    const after = await world.t.run(async (ctx) => ({
      organization: await ctx.db.get("organizations", world.ids.orgA),
      user: await ctx.db.get("users", world.ids.user),
      otherRoles: await ctx.db
        .query("roles")
        .withIndex("by_orgId_key", (q) => q.eq("orgId", world.ids.orgB))
        .collect(),
      primaryRoles: await ctx.db
        .query("roles")
        .withIndex("by_orgId_key", (q) => q.eq("orgId", world.ids.orgA))
        .collect(),
    }));
    expect(after.primaryRoles).toEqual([]);
    expect(after.organization).toEqual(before.organization);
    expect(after.user).toEqual(before.user);
    expect(after.otherRoles).toEqual(before.otherRoles);
    expect(
      await world.t.mutation(internal.staging.e2eFixture.cleanupPartial, {
        confirmation,
        runId: world.args.runId,
      }),
    ).toEqual({ deleted: 0, done: true, mirrorsPending: 0 });
  });
  it("partial compensation denies any existing ownership mismatch before deleting", async () => {
    const world = await syntheticWorld();
    const second = await syntheticWorld("run-000002", world);
    stub(STAGING);
    const initial = await rowCounts(world);
    for (const args of [
      { ...world.args, clerkOrganizationId: second.args.clerkOrganizationId },
      {
        ...world.args,
        otherClerkOrganizationId: second.args.otherClerkOrganizationId,
      },
      { ...world.args, clerkUserId: second.args.clerkUserId },
      { ...world.args, clerkOrganizationId: "" },
      {
        confirmation,
        runId: world.args.runId,
        clerkMembershipId: world.args.clerkMembershipId,
      } as const,
    ])
      await expect(
        world.t.mutation(internal.staging.e2eFixture.cleanupPartial, args),
      ).rejects.toThrow(/not owned|invalid|requires its owned/);
    await world.t.run(async (ctx) =>
      ctx.db.patch("memberships", world.ids.membership, {
        userId: second.ids.user,
      }),
    );
    await expect(
      world.t.mutation(internal.staging.e2eFixture.cleanupPartial, world.args),
    ).rejects.toThrow(/not owned/);
    expect(await rowCounts(world)).toEqual(initial);
  });
  it("purges exact-owned audit/idempotency/auth rows after warehouses are gone, preserving other runs and mirror clocks", async () => {
    const world = await syntheticWorld();
    const second = await syntheticWorld("run-000002", world);
    stub(STAGING);
    const first = await prepare(world);
    const otherRun = await prepare(second);
    for (const [owner, warehouseId, code] of [
      [world, first.runWarehouseId, "E2E-ONE"],
      [second, otherRun.runWarehouseId, "E2E-TWO"],
    ] as const)
      await world.t
        .withIdentity(owner.manager)
        .mutation(
          api.storageLayouts.writes.createStorageBuilding,
          building(warehouseId, code),
        );
    await world.t.run(async (ctx) => {
      await ctx.db.insert("auditEvents", {
        orgId: world.ids.orgA,
        occurredAt: Date.now(),
        actorKind: "USER",
        actorUserId: world.ids.user,
        action: "synthetic.no-warehouse",
        entityTable: "warehouses",
        outcome: "ALLOWED",
        requestId: "owned-audit",
      });
      await ctx.db.insert("idempotencyRecords", {
        orgId: world.ids.orgB,
        operation: "synthetic.other",
        requestId: "owned-idempotency",
        status: "SUCCEEDED",
        requestHash: "synthetic",
        firstSeenAt: Date.now(),
        expiresAt: Date.now() + 86_400_000,
      });
    });
    const preserved = await world.t.run(async (ctx) => ({
      organizations: (await ctx.db.query("organizations").collect()).filter(
        (row) => row._id === world.ids.orgA || row._id === world.ids.orgB,
      ),
      user: await ctx.db.get("users", world.ids.user),
      membership: await ctx.db.get("memberships", world.ids.membership),
      otherAudit: (await ctx.db.query("auditEvents").collect()).filter(
        (row) => row.orgId === second.ids.orgA,
      ),
      globalPermissions: await ctx.db.query("permissions").collect(),
    }));
    let completed = false;
    let deleted = 0;
    const initial = await rowCounts(world);
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const before = await rowCounts(world);
      const result = await world.t.mutation(
        internal.staging.e2eFixture.cleanup,
        { ...world.args, limit: 7 },
      );
      const after = await rowCounts(world);
      expect(result.deleted).toBe(before.total - after.total);
      expect(result.deleted).toBeLessThanOrEqual(7);
      deleted += result.deleted;
      if (result.done) {
        completed = true;
        break;
      }
    }
    expect(completed).toBe(true);
    expect(deleted).toBe(initial.total - (await rowCounts(world)).total);
    const after = await world.t.run(async (ctx) => ({
      warehouses: await ctx.db.query("warehouses").collect(),
      buildings: await ctx.db.query("storageBuildings").collect(),
      audits: await ctx.db.query("auditEvents").collect(),
      idempotency: await ctx.db.query("idempotencyRecords").collect(),
      organizations: (await ctx.db.query("organizations").collect()).filter(
        (row) => row._id === world.ids.orgA || row._id === world.ids.orgB,
      ),
      user: await ctx.db.get("users", world.ids.user),
      membership: await ctx.db.get("memberships", world.ids.membership),
      permissions: await ctx.db.query("permissions").collect(),
    }));
    const owned = new Set([world.ids.orgA, world.ids.orgB]);
    expect(after.warehouses.some((row) => owned.has(row.orgId))).toBe(false);
    expect(after.buildings.some((row) => owned.has(row.orgId))).toBe(false);
    expect(after.audits.some((row) => owned.has(row.orgId))).toBe(false);
    expect(after.idempotency.some((row) => owned.has(row.orgId))).toBe(false);
    expect(after.buildings.map(({ code }) => code)).toEqual(["E2E-TWO"]);
    expect(after.audits.filter((row) => row.orgId === second.ids.orgA)).toEqual(
      preserved.otherAudit,
    );
    expect(after.organizations).toEqual(preserved.organizations);
    expect(after.user).toEqual(preserved.user);
    expect(after.membership).toEqual(preserved.membership);
    expect(after.permissions).toEqual(preserved.globalPermissions);
    expect(
      await world.t.mutation(internal.staging.e2eFixture.cleanup, world.args),
    ).toEqual({ deleted: 0, done: true });
  });
  it("caps each call at 200 deletions and never claims completion early", async () => {
    const world = await syntheticWorld();
    stub(STAGING);
    await world.t.run(async (ctx) => {
      for (let index = 0; index < 205; index += 1)
        await ctx.db.insert("auditEvents", {
          orgId: world.ids.orgA,
          occurredAt: index,
          actorKind: "USER",
          actorUserId: world.ids.user,
          action: "synthetic",
          entityTable: "warehouses",
          outcome: "ALLOWED",
          requestId: `synthetic-${index}`,
        });
    });
    const before = await rowCounts(world);
    const first = await world.t.mutation(internal.staging.e2eFixture.cleanup, {
      ...world.args,
      limit: 999,
    });
    expect(first).toEqual({ deleted: 200, done: false });
    const middle = await rowCounts(world);
    expect(before.total - middle.total).toBe(first.deleted);
    const last = await world.t.mutation(
      internal.staging.e2eFixture.cleanup,
      world.args,
    );
    expect(last.done).toBe(true);
    expect(last.deleted).toBe(middle.total - (await rowCounts(world)).total);
    expect(last.deleted).toBeGreaterThanOrEqual(5);
    expect(
      await world.t.run(async (ctx) => ctx.db.query("auditEvents").collect()),
    ).toEqual([]);
  });
  it("rejects invalid bounds", async () => {
    const world = await syntheticWorld();
    stub(STAGING);
    for (const limit of [0, -1, 1.5, Number.POSITIVE_INFINITY, Number.NaN]) {
      await expect(
        world.t.mutation(internal.staging.e2eFixture.cleanup, {
          ...world.args,
          limit,
        }),
      ).rejects.toThrow(/positive integer/);
    }
  });
  it("checks only its exact owned run for stale age", async () => {
    const world = await syntheticWorld();
    stub(STAGING);
    await prepare(world);
    const args = { ...world.args, olderThanMs: 2 * 60 * 60 * 1000 };
    expect(
      await world.t.query(internal.staging.e2eFixture.staleRuns, args),
    ).toEqual([]);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 3 * 60 * 60 * 1000);
    expect(
      await world.t.query(internal.staging.e2eFixture.staleRuns, args),
    ).toEqual([world.args.runId]);
    for (const olderThanMs of [1000, 3_600_000.5, Number.POSITIVE_INFINITY]) {
      await expect(
        world.t.query(internal.staging.e2eFixture.staleRuns, {
          ...world.args,
          olderThanMs,
        }),
      ).rejects.toThrow(/integer of at least one hour/);
    }
  });
});
