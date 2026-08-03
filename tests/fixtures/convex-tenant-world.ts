/**
 * A two-tenant Convex world, backed by `convex-test` and running offline.
 *
 * This is a fixture, not a test: it is imported by
 * `tests/integration/tenant-storage.integration.test.ts` and
 * `tests/isolation/tenant-storage.isolation.test.ts`, and it sits outside every
 * Vitest project's `include` glob.
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
 * lookup. It is never loaded: modules are only imported when a *registered*
 * function is called by reference, and these suites only ever use `t.run` and
 * `t.query` with inline functions. If that ever stops being true, the failure is
 * loud (`Could not find module for: …`), not silent.
 *
 * All data below is synthetic — no real customer, supplier, or personal data
 * (PDPA, see `tests/fixtures/README.md`).
 */
import { convexTest } from "convex-test";
import type { GenericId } from "convex/values";

import { DEFAULT_ORGANIZATION_SETTINGS } from "../../convex/lib/organizationDefaults";
import schema from "../../convex/schema";

/** The one map entry `convexTest` needs to find the module root. See above. */
const CONVEX_MODULE_ROOT: Record<string, () => Promise<unknown>> = {
  "../convex/_generated/server.js": () => Promise.resolve({}),
};

function harness() {
  return convexTest(schema, CONVEX_MODULE_ROOT);
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
export async function createConvexTenantWorld(): Promise<ConvexTenantWorld> {
  const t = harness();

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
