/**
 * The Convex implementation of `TenantContextLookups`
 * ([`tenantContext.ts`](./tenantContext.ts), `ADR-0001` §4, `ADR-0002` §5).
 *
 * Status: **adapter only.** It exports no Convex `query`, `mutation`, `action`, or
 * HTTP handler, registers nothing, reads no environment variable, and constructs
 * no `ConvexError`. It is the five bounded reads the pure resolver declared, and
 * nothing else: `resolveTenantContext` still owns every decision — claim
 * validation, status gates, scope mode, denial codes and causes — and this module
 * owns only the translation of "find at most one document" into Convex.
 *
 * That split is why there is no policy here to disagree with the kernel about.
 * This module never inspects `status`, never reads `scopeMode`, never decides that
 * a foreign warehouse is `WAREHOUSE_UNKNOWN` rather than something more specific,
 * and never validates a Clerk reference: it answers a document or `null`, and the
 * kernel converts `null` into the denial the caller sees.
 *
 * What it does guarantee, per method:
 *
 * - **Bounded by construction.** The only query shape expressible here is
 *   `db.query(table).withIndex(index, eq…).take(2)`. There is no `filter`, no
 *   `collect`, no `order`, no `first`, no `unique`, no `paginate`, and no caller
 *   callback that could smuggle one in (`INV-0002-04`).
 * - **`take(2)`, not `unique()`.** Every "unique" key in this schema is unique *by
 *   contract* — Convex has no unique constraint, and the mutation that owes the
 *   check does not exist yet. `unique()` would throw Convex's own error, whose
 *   message describes the duplicate rows; `take(2)` lets this module see the
 *   ambiguity and fail closed with `null` instead, so a broken uniqueness contract
 *   denies rather than silently selecting whichever row Convex ordered first.
 * - **`orgId` first, always.** The two tenant-table reads name `orgId` as their
 *   first equality term, in the field order the index declares
 *   (`convex/lib/tenantIndexPolicy.ts`, `INV-0002-02`).
 * - **The answer is re-verified.** Every returned document has its correlation
 *   fields compared against the arguments that were asked for, even though the
 *   index should make that impossible to violate. The kernel re-verifies too, and
 *   that is not redundant: this adapter is one implementation of an interface with
 *   more than one possible caller, and a mismatch here must not depend on the
 *   caller having remembered to look.
 * - **One answer for every wrong ID.** A malformed warehouse ID, an ID of another
 *   table, an ID whose document was deleted, and an ID belonging to another tenant
 *   all return `null` — indistinguishable, so this is not an existence oracle over
 *   other tenants' IDs (`INV-0002-03`).
 *
 * `requestId` is taken for exactly one purpose: the `TenantDbError` raised when
 * Convex answers in a shape its own types say is impossible (a non-array from
 * `take`, or a row that is not an object). That is not a denial and not a tenancy
 * decision — it means the database handed over is not the one this module was
 * written against — so it fails loudly with a coarse code and a request ID, the
 * same vocabulary [`tenantStorage.ts`](./tenantStorage.ts) uses for the same
 * class of fault. Ambiguity is *not* that fault: two legitimate rows are a broken
 * uniqueness contract, which is data, and data denies.
 *
 * **No cast.** Unlike the storage adapter, every table name here is a literal and
 * every payload is a schema document, so Convex's generic types fit as declared
 * and `ctx.db` is used exactly as typed.
 *
 * Baseline: [PROJECT_PLAN.md](../../PROJECT_PLAN.md) §6.1, §6.2, §7.4;
 * [ADR-0002](../../docs/adr/0002-convex-tenant-boundary-and-index-discipline.md);
 * [INT-01](../../docs/integration-contracts/clerk-identity.md).
 */
import type { GenericDatabaseReader } from "convex/server";

import type { DataModel } from "../schema";
import type {
  MembershipDocument,
  MembershipWarehouseDocument,
  OrganizationDocument,
  TenantContextLookups,
  UserDocument,
  WarehouseDocument,
} from "./tenantContext";
import { TenantDbError } from "./tenantDb";

/**
 * The row budget of every exact lookup: one more than the contract allows.
 *
 * Two rows is the smallest number that distinguishes "the unique key is unique"
 * from "it is not". Reading more would cost more and answer the same question.
 */
const EXACT_TAKE = 2;

/**
 * What this adapter needs from a Convex context: a read-only database.
 *
 * Structural rather than `GenericQueryCtx<DataModel>`, so a real `QueryCtx` or
 * `MutationCtx` can be passed without this module claiming to want `auth`,
 * `storage`, or `runQuery`. A `GenericDatabaseWriter` satisfies it too — it
 * extends the reader — and no write is reachable through the reader type.
 */
export interface TenantContextLookupContext {
  readonly db: GenericDatabaseReader<DataModel>;
}

/**
 * Bind the five lookups to one database and one request.
 *
 * The returned object is frozen: a caller that could replace
 * `findMembershipByOrganizationAndUser` after the fact could replace the tenant
 * check the resolver is about to perform.
 */
export function createConvexTenantContextLookups(
  ctx: TenantContextLookupContext,
  requestId: string,
): TenantContextLookups {
  const { db } = ctx;

  const invalidResult = (): TenantDbError =>
    new TenantDbError("INVALID_INDEX_RESULT", requestId);

  /**
   * Reduce a `take(EXACT_TAKE)` answer to at most one document.
   *
   * `null` for none and `null` for two or more: absence and ambiguity are the
   * same answer to a caller, and both deny. The shape checks are not dead code
   * despite the types — this function is the one place a database that is not
   * Convex would show up, and it is cheaper to check twice than to hand the
   * resolver a value it will treat as a document.
   */
  const atMostOne = <Document>(rows: readonly Document[]): Document | null => {
    if (!Array.isArray(rows)) throw invalidResult();
    if (rows.length !== 1) return null;
    const row = rows[0];
    if (row === null || typeof row !== "object") throw invalidResult();
    return row;
  };

  const findUserByClerkUserId = async (
    clerkUserId: string,
  ): Promise<UserDocument | null> => {
    const rows = await db
      .query("users")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", clerkUserId))
      .take(EXACT_TAKE);
    const user = atMostOne(rows);
    if (user === null) return null;
    // Re-verified: the index selected on this field, so a mismatch means the
    // answer did not come from the range that was asked for.
    return user.clerkUserId === clerkUserId ? user : null;
  };

  const findOrganizationByClerkOrganizationId = async (
    clerkOrganizationId: string,
  ): Promise<OrganizationDocument | null> => {
    const rows = await db
      .query("organizations")
      .withIndex("by_clerkOrganizationId", (q) =>
        q.eq("clerkOrganizationId", clerkOrganizationId),
      )
      .take(EXACT_TAKE);
    const organization = atMostOne(rows);
    if (organization === null) return null;
    return organization.clerkOrganizationId === clerkOrganizationId
      ? organization
      : null;
  };

  const findMembershipByOrganizationAndUser: TenantContextLookups["findMembershipByOrganizationAndUser"] =
    async ({ orgId, userId }): Promise<MembershipDocument | null> => {
      const rows = await db
        .query("memberships")
        // `["orgId", "userId"]`: the tenant first, then the actor. Reversing the
        // two would not compile — Convex checks the equality order against the
        // declared index — which is the property `INV-0002-02` wants held by the
        // type system rather than by review.
        .withIndex("by_orgId_userId", (q) =>
          q.eq("orgId", orgId).eq("userId", userId),
        )
        .take(EXACT_TAKE);
      const membership = atMostOne(rows);
      if (membership === null) return null;
      return membership.orgId === orgId && membership.userId === userId
        ? membership
        : null;
    };

  const findWarehouseByOrganizationAndId: TenantContextLookups["findWarehouseByOrganizationAndId"] =
    async ({ orgId, warehouseId }): Promise<WarehouseDocument | null> => {
      // A `GenericId` is a branded string, and the brand is a compile-time claim
      // about a value that arrives from a client. `normalizeId` is the only thing
      // that decides whether a string is an ID *of this table*, so a random
      // string, a truncated ID, and a well-formed ID of another table are one
      // answer here — the same answer as a document that does not exist.
      const normalized = db.normalizeId("warehouses", warehouseId);
      if (normalized === null) return null;

      // A document read needs no index, which is exactly why the tenant check
      // below is not optional: nothing about this read was scoped to `orgId`.
      const warehouse = await db.get("warehouses", normalized);
      if (warehouse === null) return null;
      if (warehouse._id !== normalized) throw invalidResult();
      // Foreign tenant, silently: the caller learns nothing about whether the ID
      // exists elsewhere (`INV-0002-03`).
      return warehouse.orgId === orgId ? warehouse : null;
    };

  const findMembershipWarehouse: TenantContextLookups["findMembershipWarehouse"] =
    async ({
      orgId,
      membershipId,
      warehouseId,
    }): Promise<MembershipWarehouseDocument | null> => {
      const rows = await db
        .query("membershipWarehouses")
        // `["orgId", "membershipId", "warehouseId"]` — the full triple, so this
        // is an exact read rather than a prefix that would need narrowing after
        // the fact.
        .withIndex("by_orgId_membershipId_warehouseId", (q) =>
          q
            .eq("orgId", orgId)
            .eq("membershipId", membershipId)
            .eq("warehouseId", warehouseId),
        )
        .take(EXACT_TAKE);
      const scope = atMostOne(rows);
      if (scope === null) return null;
      return scope.orgId === orgId &&
        scope.membershipId === membershipId &&
        scope.warehouseId === warehouseId
        ? scope
        : null;
    };

  return Object.freeze({
    findUserByClerkUserId,
    findOrganizationByClerkOrganizationId,
    findMembershipByOrganizationAndUser,
    findWarehouseByOrganizationAndId,
    findMembershipWarehouse,
  });
}
