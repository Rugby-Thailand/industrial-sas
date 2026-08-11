/**
 * A two-tenant Convex world, backed by `convex-test` and running offline.
 *
 * This is a fixture, not a test: it is imported by the `convex-test`-backed suites
 * over the tenant boundary and over authorization —
 * `tests/integration/tenant-storage.integration.test.ts`,
 * `tests/integration/tenant-functions.integration.test.ts`,
 * `tests/integration/tenant-actions.integration.test.ts`,
 * `tests/isolation/tenant-storage.isolation.test.ts`, and
 * `tests/isolation/authorization-enforcement.isolation.test.ts` — and it sits
 * outside every Vitest project's `include` glob.
 *
 * ### Why `convex-test` rather than another hand-written fake
 *
 * The suites over `convex/lib/tenantDb.ts` use an in-memory port that enforces
 * nothing, because what they prove is that the *accessor* enforces everything. The
 * adapter cannot be tested that way: what it has to be right about is Convex — ID
 * normalization, `withIndex` field order, `take`, `paginate` cursors, schema
 * validation on write, and the one-`paginate()`-per-execution budget. A fake that
 * imitated those would be a fake of the thing under test.
 *
 * `convex-test` is the Convex-authored mock of the backend. It runs the real
 * `convex/server` database implementation, the real schema validators, and the
 * real index semantics — in-process, with no deployment, no `convex dev`, no
 * account, and no environment variable. It is already a pinned devDependency
 * (0.0.54). Nothing here reaches the network.
 *
 * Two limits are worth knowing, because the suites are shaped around them:
 *
 * - **One `.paginate()` per function execution**, exactly as a deployed backend.
 *   A test that reads two continuable pages must use two `t.run` calls.
 * - **Schema validation is real**, so every seeded document below is a valid one.
 *   That is a feature — but it also means a *malformed* document or a malformed
 *   `paginate` answer cannot be produced through this harness at all. Those faults
 *   are injected in the suites with a small structural stub of the seven Convex
 *   operations the adapter is allowed to reach, and each one says why.
 *
 * ### The `_generated` stub
 *
 * `convexTest` locates the Convex module root by looking for a path containing
 * `_generated` in the module map it is given. This repository has no
 * `convex/_generated/` — nothing has been deployed, and no command here needs a
 * Convex project — so the map below supplies exactly one entry to satisfy that
 * lookup. It is never loaded: a module is imported only when a *registered*
 * function inside it is called by reference, and no reference names this one. A
 * suite that does call registered functions — the action suite does — passes its
 * own entries to `createConvexTenantWorld`, keyed by the same `../convex/…` paths
 * the references resolve to. A missing entry fails loudly
 * (`Could not find module for: …`), not silently.
 *
 * All data below is synthetic — no real customer, supplier, or personal data
 * (PDPA, see `tests/fixtures/README.md`).
 */
import { convexTest } from "convex-test";
import type { GenericId } from "convex/values";

import { seedAuthorizationForOrganization } from "../../convex/lib/authorizationSeedConvex";
import { DEFAULT_ORGANIZATION_SETTINGS } from "../../convex/lib/organizationDefaults";
import { DEFAULT_ROLES } from "../../convex/lib/permissions";
import schema from "../../convex/schema";

/** The one map entry `convexTest` needs to find the module root. See above. */
const CONVEX_MODULE_ROOT: Record<string, () => Promise<unknown>> = {
  "../convex/_generated/server.js": () => Promise.resolve({}),
};

export type ConvexTestModuleMap = Record<string, () => Promise<unknown>>;

function harness(extraModules: ConvexTestModuleMap = {}) {
  return convexTest(schema, { ...CONVEX_MODULE_ROOT, ...extraModules });
}

/**
 * The `convex-test` accessor, typed by inference.
 *
 * Inferred rather than written out because `TestConvex`'s data model is derived
 * from the schema definition with a looser table-name parameter than
 * `convex/schema.ts` exports, and restating it by hand would be a second, wrong
 * copy.
 */
export type ConvexTenantHarness = ReturnType<typeof harness>;

/** The request ID every suite quotes. Server-minted in production (plan §7.4). */
export const FIXTURE_REQUEST_ID = "req_01JBZ0000000000000000000";

/**
 * Two tenants and their rows.
 *
 * Organization A holds four warehouses whose codes sort `ALPHA`, `BRAVO`,
 * `CHARLIE`, `DELTA` — three `ACTIVE`, one `INACTIVE` — which is enough for a
 * three-page read at a page size of two, a partial equality prefix that must
 * exclude a row, and a `unique()` that must find exactly one. Organization B holds
 * one warehouse whose code deliberately collides with A's first: `ALPHA` is unique
 * *per organization* by contract, so a read that forgot its tenant would find it
 * and a read that did not, must not.
 */
export interface ConvexTenantWorld {
  readonly t: ConvexTenantHarness;
  readonly orgA: GenericId<"organizations">;
  readonly orgB: GenericId<"organizations">;
  /** A global-table ID, for proving a foreign-table ID is rejected. */
  readonly userA: GenericId<"users">;
  readonly warehouses: {
    readonly alphaA: GenericId<"warehouses">;
    readonly bravoA: GenericId<"warehouses">;
    readonly charlieA: GenericId<"warehouses">;
    readonly deltaA: GenericId<"warehouses">;
    readonly alphaB: GenericId<"warehouses">;
  };
  /**
   * A syntactically valid `warehouses` ID that no document has: minted by
   * inserting a row and deleting it, so it is a real ID of the right table rather
   * than a string that merely looks like one.
   */
  readonly vanishedWarehouse: GenericId<"warehouses">;
}

/** Seed a fresh world. Each test gets its own; no suite sees another's writes. */
export async function createConvexTenantWorld(
  modules: ConvexTestModuleMap = {},
): Promise<ConvexTenantWorld> {
  const t = harness(modules);

  const seeded = await t.run(async (ctx) => {
    const orgA = await ctx.db.insert("organizations", {
      clerkOrganizationId: "org_fixture_a",
      name: "Tenant A",
      status: "ACTIVE",
      settings: DEFAULT_ORGANIZATION_SETTINGS,
    });
    const orgB = await ctx.db.insert("organizations", {
      clerkOrganizationId: "org_fixture_b",
      name: "Tenant B",
      status: "ACTIVE",
      settings: DEFAULT_ORGANIZATION_SETTINGS,
    });
    const userA = await ctx.db.insert("users", {
      clerkUserId: "user_fixture_a",
      displayName: "Fixture A",
      status: "ACTIVE",
    });

    const warehouse = async (
      orgId: GenericId<"organizations">,
      code: string,
      status: "ACTIVE" | "INACTIVE",
    ): Promise<GenericId<"warehouses">> =>
      await ctx.db.insert("warehouses", {
        orgId,
        code,
        name: `Warehouse ${code}`,
        status,
      });

    const alphaA = await warehouse(orgA, "ALPHA", "ACTIVE");
    const bravoA = await warehouse(orgA, "BRAVO", "ACTIVE");
    const charlieA = await warehouse(orgA, "CHARLIE", "ACTIVE");
    const deltaA = await warehouse(orgA, "DELTA", "INACTIVE");
    const alphaB = await warehouse(orgB, "ALPHA", "ACTIVE");

    const vanishedWarehouse = await warehouse(orgA, "GONE", "INACTIVE");
    await ctx.db.delete("warehouses", vanishedWarehouse);

    return {
      orgA,
      orgB,
      userA,
      warehouses: { alphaA, bravoA, charlieA, deltaA, alphaB },
      vanishedWarehouse,
    };
  });

  return { t, ...seeded };
}

/**
 * The identity rows tenant *context* resolution needs, seeded on request.
 *
 * A separate function rather than more rows in `createConvexTenantWorld`, so the
 * suites over the storage adapter keep the exact world they were written against.
 *
 * Two collisions are deliberate, and both are legal in this schema:
 *
 * - the same user holds a membership in both tenants, and both memberships carry
 *   the *same* `clerkMembershipId` — unique per organization by contract, not
 *   globally — so a `by_orgId_userId` read that dropped `orgId` would be visibly
 *   wrong rather than accidentally right;
 * - tenant B holds a `membershipWarehouses` row naming tenant A's membership and
 *   tenant A's warehouse. Convex's `v.id()` references are not tenant-checked, so
 *   this row is storable, and it makes the `orgId`-first equality order of
 *   `by_orgId_membershipId_warehouseId` decidable: the same pair of later terms
 *   resolves to two different rows depending only on the tenant.
 */
export interface ConvexTenantIdentities {
  readonly membershipA: GenericId<"memberships">;
  readonly membershipB: GenericId<"memberships">;
  readonly scopeA: GenericId<"membershipWarehouses">;
  readonly scopeB: GenericId<"membershipWarehouses">;
  /** The `clerkMembershipId` both memberships share. */
  readonly sharedClerkMembershipId: string;
}

export async function seedConvexTenantIdentities(
  world: ConvexTenantWorld,
): Promise<ConvexTenantIdentities> {
  const sharedClerkMembershipId = "orgmem_fixture_shared";

  return await world.t.run(async (ctx) => {
    const membership = async (
      orgId: GenericId<"organizations">,
      scopeMode: "ORG_WIDE" | "WAREHOUSE_SCOPED",
    ): Promise<GenericId<"memberships">> =>
      await ctx.db.insert("memberships", {
        orgId,
        userId: world.userA,
        clerkMembershipId: sharedClerkMembershipId,
        status: "ACTIVE",
        scopeMode,
        effectiveFrom: 0,
      });

    const membershipA = await membership(world.orgA, "WAREHOUSE_SCOPED");
    const membershipB = await membership(world.orgB, "ORG_WIDE");

    const scopeA = await ctx.db.insert("membershipWarehouses", {
      orgId: world.orgA,
      membershipId: membershipA,
      warehouseId: world.warehouses.alphaA,
    });
    const scopeB = await ctx.db.insert("membershipWarehouses", {
      orgId: world.orgB,
      membershipId: membershipA,
      warehouseId: world.warehouses.alphaA,
    });

    return {
      membershipA,
      membershipB,
      scopeA,
      scopeB,
      sharedClerkMembershipId,
    };
  });
}

/** The raw stored document, read outside any port. `null` when there is none. */
export async function storedWarehouse(
  world: ConvexTenantWorld,
  id: GenericId<"warehouses">,
): Promise<Record<string, unknown> | null> {
  return await world.t.run(async (ctx) => await ctx.db.get("warehouses", id));
}

/** Every `warehouses` row, read outside any port, for "nothing changed" checks. */
export async function storedWarehouses(
  world: ConvexTenantWorld,
): Promise<readonly Record<string, unknown>[]> {
  return await world.t.run(
    async (ctx) => await ctx.db.query("warehouses").collect(),
  );
}

/* -------------------------------------------------------------------------- */
/* Authorization world                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The seeded authorization state of both tenants, plus the one role grant each
 * membership holds.
 *
 * Built on `seedConvexTenantIdentities` and the production seed
 * (`convex/lib/authorizationSeedConvex.ts`) rather than hand-written role rows: a
 * fixture that invented its own compositions would prove the wrapper agrees with
 * the fixture, not with the catalogue the tenant actually gets.
 *
 * The default grants are deliberately different in the two tenants, so a test can
 * reach for the case it needs without reshaping the world:
 *
 * - **A** holds `SUPERVISOR` on a `WAREHOUSE_SCOPED` membership whose only scope
 *   row is `ALPHA`. That covers warehouse scope, threshold
 *   (`putaway.task.override`), maker-checker (`inventory.statusChange.approve`),
 *   and an ORG permission it does hold (`admin.audit.read`) and one it does not
 *   (`admin.device.manage`).
 * - **B** holds `ORG_ADMIN` on an `ORG_WIDE` membership, which is the only role
 *   with the step-up ORG permission `masterData.warehouse.manage`.
 */
export interface ConvexAuthorizationWorld {
  readonly identities: ConvexTenantIdentities;
  readonly rolesA: ReadonlyMap<string, GenericId<"roles">>;
  readonly rolesB: ReadonlyMap<string, GenericId<"roles">>;
  readonly membershipRoleA: GenericId<"membershipRoles">;
  readonly membershipRoleB: GenericId<"membershipRoles">;
  readonly roleKeyA: string;
  readonly roleKeyB: string;
}

/** Seed both tenants' catalogues, roles, and one role grant per membership. */
export async function seedConvexAuthorization(
  world: ConvexTenantWorld,
  options: { readonly roleA?: string; readonly roleB?: string } = {},
): Promise<ConvexAuthorizationWorld> {
  const roleKeyA = options.roleA ?? "SUPERVISOR";
  const roleKeyB = options.roleB ?? "ORG_ADMIN";
  const identities = await seedConvexTenantIdentities(world);

  // Plain records cross the `t.run` boundary; a `Map` is not a Convex value, and
  // `t.run` serializes whatever it returns exactly as a function would.
  const seeded = await world.t.run(async (ctx) => {
    await seedAuthorizationForOrganization(ctx, world.orgA);
    await seedAuthorizationForOrganization(ctx, world.orgB);

    const rolesOf = async (
      orgId: GenericId<"organizations">,
    ): Promise<Record<string, GenericId<"roles">>> => {
      const entries: Record<string, GenericId<"roles">> = {};
      for (const role of DEFAULT_ROLES) {
        const row = await ctx.db
          .query("roles")
          .withIndex("by_orgId_key", (query) =>
            query.eq("orgId", orgId).eq("key", role.key),
          )
          .unique();
        if (row === null) throw new Error(`missing seeded role ${role.key}`);
        entries[role.key] = row._id;
      }
      return entries;
    };

    const rolesA = await rolesOf(world.orgA);
    const rolesB = await rolesOf(world.orgB);
    const grant = async (
      orgId: GenericId<"organizations">,
      membershipId: GenericId<"memberships">,
      roleId: GenericId<"roles">,
    ): Promise<GenericId<"membershipRoles">> =>
      await ctx.db.insert("membershipRoles", {
        orgId,
        membershipId,
        roleId,
        grantedAt: 0,
      });

    return {
      rolesA,
      rolesB,
      membershipRoleA: await grant(
        world.orgA,
        identities.membershipA,
        rolesA[roleKeyA]!,
      ),
      membershipRoleB: await grant(
        world.orgB,
        identities.membershipB,
        rolesB[roleKeyB]!,
      ),
    };
  });

  return {
    identities,
    roleKeyA,
    roleKeyB,
    rolesA: new Map(Object.entries(seeded.rolesA)),
    rolesB: new Map(Object.entries(seeded.rolesB)),
    membershipRoleA: seeded.membershipRoleA,
    membershipRoleB: seeded.membershipRoleB,
  };
}

/** Record a step-up reverification for an actor, as the wrapper will read it. */
export async function recordStepUp(
  world: ConvexTenantWorld,
  input: {
    readonly orgId: GenericId<"organizations">;
    readonly userId: GenericId<"users">;
    readonly occurredAt: number;
    readonly reverifiedAt: number;
    readonly eventType?:
      | "STEP_UP_VERIFIED"
      | "STEP_UP_DENIED"
      | "SIGN_IN"
      | "SIGN_OUT"
      | "ORGANIZATION_SWITCH"
      | "SESSION_REVOKED";
    readonly outcome?: "ALLOWED" | "DENIED";
  },
): Promise<GenericId<"sessionsAudit">> {
  return await world.t.run(
    async (ctx) =>
      await ctx.db.insert("sessionsAudit", {
        orgId: input.orgId,
        userId: input.userId,
        eventType: input.eventType ?? "STEP_UP_VERIFIED",
        occurredAt: input.occurredAt,
        reverifiedAt: input.reverifiedAt,
        outcome: input.outcome ?? "ALLOWED",
      }),
  );
}

/** Seed an entitlement row for one tenant. An absent row is a disabled one. */
export async function recordEntitlement(
  world: ConvexTenantWorld,
  input: {
    readonly orgId: GenericId<"organizations">;
    readonly key: string;
    readonly enabled: boolean;
  },
): Promise<GenericId<"entitlements">> {
  return await world.t.run(
    async (ctx) =>
      await ctx.db.insert("entitlements", {
        orgId: input.orgId,
        key: input.key,
        enabled: input.enabled,
      }),
  );
}

/** Register a device with an opaque installation ID (correlation only). */
export async function recordDevice(
  world: ConvexTenantWorld,
  input: {
    readonly orgId: GenericId<"organizations">;
    readonly installationId: string;
    readonly label?: string;
  },
): Promise<GenericId<"devices">> {
  return await world.t.run(
    async (ctx) =>
      await ctx.db.insert("devices", {
        orgId: input.orgId,
        label: input.label ?? "Fixture handheld",
        deviceType: "HANDHELD",
        status: "ACTIVE",
        installationId: input.installationId,
      }),
  );
}

/** Every audit row of one tenant, newest first, read outside any wrapper. */
export async function storedAuditEvents(
  world: ConvexTenantWorld,
  orgId: GenericId<"organizations">,
): Promise<readonly Record<string, unknown>[]> {
  return await world.t.run(
    async (ctx) =>
      await ctx.db
        .query("auditEvents")
        .withIndex("by_orgId_occurredAt", (query) => query.eq("orgId", orgId))
        .order("desc")
        .take(50),
  );
}

/**
 * A **second** mirrored actor in tenant A, with an active membership and one
 * seeded role.
 *
 * Separate from the base world because most suites do not need it and every row
 * a fixture seeds unconditionally is a row some other suite has to reason about.
 * What needs it is maker-checker: the evaluator denies whenever the maker and
 * the actor are the same person, so proving the *allowed* branch of a
 * separation-of-duties workflow takes two people. Without this, every
 * maker-checker test could only assert a denial.
 *
 * The subject is distinct, so `withIdentity({ subject })` selects which actor is
 * acting; the organization claim is the same, because both work for tenant A.
 */
export interface ConvexSecondActor {
  readonly userId: GenericId<"users">;
  readonly membershipId: GenericId<"memberships">;
  readonly clerkUserId: string;
}

export async function seedSecondActorForOrgA(
  world: ConvexTenantWorld,
  roleKey: string,
): Promise<ConvexSecondActor> {
  const clerkUserId = "user_fixture_a2";

  return await world.t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      clerkUserId,
      displayName: "Fixture A2",
      status: "ACTIVE",
    });
    const membershipId = await ctx.db.insert("memberships", {
      orgId: world.orgA,
      userId,
      clerkMembershipId: "orgmem_fixture_a2",
      status: "ACTIVE",
      // Org-wide, so this actor is not the subject of a warehouse-scope test.
      scopeMode: "ORG_WIDE",
      effectiveFrom: 0,
    });

    const role = await ctx.db
      .query("roles")
      .withIndex("by_orgId_key", (query) =>
        query.eq("orgId", world.orgA).eq("key", roleKey),
      )
      .unique();
    if (role === null) throw new Error(`missing seeded role ${roleKey}`);

    await ctx.db.insert("membershipRoles", {
      orgId: world.orgA,
      membershipId,
      roleId: role._id,
      grantedAt: 0,
    });

    return { userId, membershipId, clerkUserId };
  });
}
