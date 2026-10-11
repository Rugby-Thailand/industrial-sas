import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";

import type { Id } from "../../convex/_generated/dataModel";
import { SHORTCUT_KEYS } from "../../convex/hr/preferences";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";

type Shortcut = { key: string; visible: boolean };
type SaveArgs = {
  requestId: string;
  expectedVersion: number;
  shortcuts: Shortcut[];
};
type Saved = {
  written: true;
  documentId: string;
  replayed: boolean;
  shortcuts: Shortcut[];
  version: number;
};
type Current = {
  ok: true;
  shortcuts: Shortcut[];
  version: number;
  updatedAt?: number;
};
const currentRef = makeFunctionReference<
  "query",
  Record<string, never>,
  unknown
>("hr/preferences:current");
const saveRef = makeFunctionReference<"mutation", SaveArgs, unknown>(
  "hr/preferences:save",
);
const todayRef = makeFunctionReference<"query", Record<string, never>, unknown>(
  "hr/self:today",
);

const ACTOR = { subject: "user_fixture_a", org_id: "org_fixture_a" };
const ACTOR_B = { ...ACTOR, org_id: "org_fixture_b" };
const OTHER = { subject: "user_preferences_other", org_id: "org_fixture_a" };
const defaults = (): Shortcut[] =>
  SHORTCUT_KEYS.map((key) => ({ key, visible: true }));

function value<T>(outcome: unknown): T {
  expect(outcome).toMatchObject({ ok: true });
  return (outcome as { value: T }).value;
}

async function fixture(linked = true, roleA = "HR_EMPLOYEE") {
  const world = await createConvexTenantWorld({
    "../convex/hr/preferences.ts": () => import("../../convex/hr/preferences"),
    "../convex/hr/self.ts": () => import("../../convex/hr/self"),
  });
  await seedConvexAuthorization(world, { roleA, roleB: "HR_EMPLOYEE" });
  const seeded = await world.t.run(async (ctx) => {
    const otherUserId = await ctx.db.insert("users", {
      clerkUserId: OTHER.subject,
      displayName: "Other member",
      status: "ACTIVE",
    });
    const otherMembershipId = await ctx.db.insert("memberships", {
      orgId: world.orgA,
      userId: otherUserId,
      clerkMembershipId: "orgmem_preferences_other",
      status: "ACTIVE",
      scopeMode: "ORG_WIDE",
      effectiveFrom: 0,
    });
    const role = await ctx.db
      .query("roles")
      .withIndex("by_orgId_key", (q) =>
        q.eq("orgId", world.orgA).eq("key", "HR_EMPLOYEE"),
      )
      .unique();
    await ctx.db.insert("membershipRoles", {
      orgId: world.orgA,
      membershipId: otherMembershipId,
      roleId: role!._id,
      grantedAt: 0,
    });
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
        createdByUserId: world.userA,
        updatedAt: 1,
        updatedByUserId: world.userA,
      });
    const employeeId = await employee(
      world.orgA,
      world.warehouses.alphaA,
      "OWN",
      linked ? world.userA : undefined,
    );
    await employee(
      world.orgB,
      world.warehouses.alphaB,
      "TENANT-B",
      world.userA,
    );
    await employee(world.orgA, world.warehouses.alphaA, "OTHER", otherUserId);
    return { employeeId, otherUserId };
  });
  return { world, ...seeded };
}

const stored = (world: ConvexTenantWorld) =>
  world.t.run((ctx) => ctx.db.query("hrShortcutPreferences").collect());

describe("persisted authenticated shortcut preferences", () => {
  it("returns fixed delivered defaults without a read creating a document", async () => {
    const { world } = await fixture();
    expect(
      value(await world.t.withIdentity(ACTOR).query(currentRef, {})),
    ).toEqual({ ok: true, shortcuts: defaults(), version: 0 });
    expect(await stored(world)).toEqual([]);
  });

  it("extends legacy saved shortcuts without resetting order, visibility, or optimistic version", async () => {
    const { world } = await fixture();
    const legacy = defaults()
      .slice(0, 5)
      .reverse()
      .map((entry, index) => ({ ...entry, visible: index !== 1 }));
    await world.t.run((ctx) =>
      ctx.db.insert("hrShortcutPreferences", {
        orgId: world.orgA,
        userId: world.userA,
        shortcuts: legacy,
        version: 7,
        createdAt: 1,
        updatedAt: 2,
      }),
    );
    const loaded = value<Current>(
      await world.t.withIdentity(ACTOR).query(currentRef, {}),
    );
    expect(loaded.version).toBe(7);
    expect(loaded.shortcuts).toEqual([...legacy, ...defaults().slice(5)]);
    expect((await stored(world))[0]!.shortcuts).toEqual(legacy);
    expect(
      value(
        await world.t.withIdentity(ACTOR).mutation(saveRef, {
          requestId: "legacy-partial-save",
          expectedVersion: 7,
          shortcuts: legacy,
        }),
      ),
    ).toMatchObject({ written: false, error: { code: "PREFERENCES_INVALID" } });
  });

  it("persists order and visibility across reads, independently for each user and organization", async () => {
    const { world } = await fixture();
    const shortcuts = defaults()
      .reverse()
      .map((entry, index) => ({
        ...entry,
        visible: index % 2 === 0,
      }));
    const saved = value<Saved>(
      await world.t.withIdentity(ACTOR).mutation(saveRef, {
        requestId: "preferences-owner-save",
        expectedVersion: 0,
        shortcuts,
      }),
    );
    expect(saved).toMatchObject({ written: true, version: 1, replayed: false });
    expect(saved.shortcuts).toEqual(shortcuts);
    const reloaded = value<Current>(
      await world.t.withIdentity(ACTOR).query(currentRef, {}),
    );
    expect(reloaded).toMatchObject({ ok: true, version: 1, shortcuts });
    expect(reloaded.updatedAt).toEqual(expect.any(Number));
    for (const actor of [ACTOR_B, OTHER])
      expect(
        value(await world.t.withIdentity(actor).query(currentRef, {})),
      ).toEqual({ ok: true, version: 0, shortcuts: defaults() });
    for (const actor of [ACTOR_B, OTHER])
      expect(
        value(
          await world.t.withIdentity(actor).mutation(saveRef, {
            requestId: `preferences-${actor.org_id}-${actor.subject}`,
            expectedVersion: 0,
            shortcuts: defaults(),
          }),
        ),
      ).toMatchObject({ written: true, version: 1 });
    expect(
      value(await world.t.withIdentity(ACTOR).query(currentRef, {})),
    ).toMatchObject({ version: 1, shortcuts });
    expect(await stored(world)).toHaveLength(3);
  });

  it("allows hiding every shortcut while Today and its clock action remain available", async () => {
    const { world } = await fixture();
    const shortcuts = defaults().map((entry) => ({ ...entry, visible: false }));
    expect(
      value(
        await world.t.withIdentity(ACTOR).mutation(saveRef, {
          requestId: "preferences-hide-all",
          expectedVersion: 0,
          shortcuts,
        }),
      ),
    ).toMatchObject({ written: true });
    expect(
      value(await world.t.withIdentity(ACTOR).query(todayRef, {})),
    ).toMatchObject({ state: "NONWORKING", nextAction: "CLOCK_IN" });
  });

  it("denies unknown, duplicate, missing keys and invalid versions without storing partial preferences", async () => {
    const { world } = await fixture();
    const invalid = [
      [...defaults().slice(1), { key: "hr.leave", visible: true }],
      [...defaults().slice(1), defaults()[1]!],
      defaults().slice(1),
      [...defaults(), { key: "https://example.com", visible: true }],
    ];
    for (const [index, shortcuts] of invalid.entries())
      expect(
        value(
          await world.t.withIdentity(ACTOR).mutation(saveRef, {
            requestId: `preferences-invalid-${index}`,
            expectedVersion: 0,
            shortcuts,
          }),
        ),
      ).toMatchObject({
        written: false,
        error: { code: "PREFERENCES_INVALID", field: "shortcuts" },
      });
    for (const [index, expectedVersion] of [-1, 0.5].entries())
      expect(
        value(
          await world.t.withIdentity(ACTOR).mutation(saveRef, {
            requestId: `preferences-invalid-version-${index}`,
            expectedVersion,
            shortcuts: defaults(),
          }),
        ),
      ).toMatchObject({
        written: false,
        error: { code: "PREFERENCES_INVALID", field: "expectedVersion" },
      });
    expect(await stored(world)).toEqual([]);
  });

  it("replays the same operation once and refuses changed payloads or another actor's operation ID", async () => {
    const { world } = await fixture();
    const args = {
      requestId: "preferences-idempotent-save",
      expectedVersion: 0,
      shortcuts: defaults(),
    };
    const first = value<Saved>(
      await world.t.withIdentity(ACTOR).mutation(saveRef, args),
    );
    const replay = value<Saved>(
      await world.t.withIdentity(ACTOR).mutation(saveRef, args),
    );
    expect(replay).toEqual({ ...first, replayed: true });
    expect(await stored(world)).toHaveLength(1);
    const audit = await world.t.run((ctx) =>
      ctx.db.query("auditEvents").collect(),
    );
    expect(
      audit.filter(
        (entry) =>
          entry.action === "hr.preferences.save" && entry.outcome === "ALLOWED",
      ),
    ).toHaveLength(1);
    for (const [actor, payload] of [
      [ACTOR, { ...args, shortcuts: defaults().reverse() }],
      [OTHER, args],
    ] as const)
      expect(
        value(await world.t.withIdentity(actor).mutation(saveRef, payload)),
      ).toMatchObject({
        written: false,
        error: { code: "REQUEST_ARGUMENT_CONFLICT" },
      });
    expect(await stored(world)).toHaveLength(1);
  });

  it("prevents a stale editor from overwriting a newer save while preserving valid retry", async () => {
    const { world } = await fixture();
    const actor = world.t.withIdentity(ACTOR);
    const args = {
      requestId: "preferences-version-first",
      expectedVersion: 0,
      shortcuts: defaults(),
    };
    value(await actor.mutation(saveRef, args));
    expect(
      value(
        await actor.mutation(saveRef, {
          ...args,
          requestId: "preferences-version-stale",
          shortcuts: defaults().reverse(),
        }),
      ),
    ).toMatchObject({ written: false, error: { code: "PREFERENCES_STALE" } });
    const changed = defaults().reverse();
    expect(
      value(
        await actor.mutation(saveRef, {
          requestId: "preferences-version-newer",
          expectedVersion: 1,
          shortcuts: changed,
        }),
      ),
    ).toMatchObject({ written: true, version: 2 });
    // Replaying an older successful command answers the current authoritative
    // preferences and never rolls them back or increments their version.
    expect(value(await actor.mutation(saveRef, args))).toMatchObject({
      written: true,
      replayed: true,
      version: 2,
      shortcuts: changed,
    });
    expect(value(await actor.query(currentRef, {}))).toMatchObject({
      version: 2,
      shortcuts: changed,
    });
  });

  it("requires an employee link on reads, writes and retries, and the existing self permission", async () => {
    const { world, employeeId } = await fixture();
    const actor = world.t.withIdentity(ACTOR);
    const args = {
      requestId: "preferences-link-replay",
      expectedVersion: 0,
      shortcuts: defaults(),
    };
    value(await actor.mutation(saveRef, args));
    await world.t.run((ctx) =>
      ctx.db.patch("hrEmployees", employeeId, {
        userId: undefined,
      }),
    );
    expect(value(await actor.query(currentRef, {}))).toEqual({
      ok: false,
      code: "HR_NOT_LINKED",
    });
    expect(value(await actor.mutation(saveRef, args))).toMatchObject({
      written: false,
      error: { code: "HR_NOT_LINKED" },
    });
    expect(
      value(
        await actor.mutation(saveRef, {
          ...args,
          requestId: "preferences-no-link-new",
        }),
      ),
    ).toMatchObject({ written: false, error: { code: "HR_NOT_LINKED" } });
    const manager = await fixture(true, "WAREHOUSE_MANAGER");
    expect(
      await manager.world.t.withIdentity(ACTOR).query(currentRef, {}),
    ).toMatchObject({ ok: false });
    expect(
      await manager.world.t.withIdentity(ACTOR).mutation(saveRef, args),
    ).toMatchObject({ ok: false });
    await expect(world.t.query(currentRef, {})).rejects.toThrow();
    await expect(world.t.mutation(saveRef, args)).rejects.toThrow();
  });
});
