/**
 * The Convex implementation of `AuthorizationFactLookups`
 * ([`authorization.ts`](./authorization.ts), `ADR-0002` §5, `ADR-0006` §1).
 *
 * Status: **adapter only.** It registers nothing, exports no Convex function,
 * reads no environment variable, constructs no `ConvexError`, and decides no
 * policy. It is the eight bounded reads the kernel declared, translated into
 * Convex, and nothing else: `resolveAuthorizationFacts` still owns every decision
 * — which roles count, what an archived role means, whether a reverification is
 * fresh, and which denial reason the audit row carries.
 *
 * Raw `ctx.db`, and allowlisted for it in `scripts/verify-tenant-boundary.mjs`,
 * for one privilege the tenant-bound accessor cannot express:
 * `TenantIndexReader` reads an index in ascending order only, and step-up
 * freshness needs the *newest* session events. `sessionsAudit` has no index on
 * `eventType`, so the alternatives were a descending bounded window (this file) or
 * an ascending scan of a shared handheld's entire session history (a tenant-table
 * scan, which is how cross-tenant reads happen, `INV-0002-04`). The other seven
 * reads stay here with it so that "what can authorization read?" is one file to
 * review rather than two.
 *
 * What the privilege is bounded by, per read:
 *
 * - **`orgId` first, always**, in the field order the index declares
 *   (`convex/lib/tenantIndexPolicy.ts`, `INV-0002-02`). Convex checks the equality
 *   order against the declared index, so a read that dropped the tenant would not
 *   compile.
 * - **No `filter`, no `collect`, no `unique`, no `paginate`, no `first`.** Every
 *   read is `withIndex(...).take(n)` with `n` bounded by the caller's contract, or
 *   a document read by ID followed by an `orgId` equality check.
 * - **`take(2)`, not `unique()`,** for every key that is unique *by contract*:
 *   Convex has no unique constraint, so two rows under such a key is a broken
 *   invariant that must deny rather than silently resolve to whichever row came
 *   first.
 * - **The answer is re-verified** against the arguments that were asked for, even
 *   though the index should make a mismatch impossible. The kernel re-verifies
 *   again; that is not redundant, because this adapter is one implementation of an
 *   interface and a mismatch here must not depend on the caller having looked.
 * - **One answer for every wrong ID.** A malformed role ID, an ID of another
 *   table, a deleted row, and another tenant's row all answer `null`, so this is
 *   not an existence oracle over other tenants' IDs (`INV-0002-03`).
 *
 * `requestId` is taken for one purpose: the `TenantDbError` raised when Convex
 * answers in a shape its own types say is impossible, or when a caller asks for an
 * unbounded page. Neither is a denial — the first means the database is not the one
 * this module was written against, the second is a bug in the kernel — so both fail
 * loudly with a coarse code and a request ID rather than quietly returning fewer
 * facts than the decision needed.
 *
 * Baseline: [PROJECT_PLAN.md](../../PROJECT_PLAN.md) §6.1, §6.2, §7.1;
 * [ADR-0002](../../docs/adr/0002-convex-tenant-boundary-and-index-discipline.md);
 * [ADR-0006](../../docs/adr/0006-authorization-and-support-access.md).
 */
import type { GenericDatabaseReader } from "convex/server";

import type { DataModel } from "../schema";
import {
  MEMBERSHIP_ROLE_LIMIT,
  STEP_UP_EVENT_LIMIT,
  type AuthorizationFactLookups,
  type DeviceDocument,
  type EntitlementDocument,
  type MembershipRoleDocument,
  type RoleDocument,
  type RolePermissionDocument,
  type SessionsAuditDocument,
} from "./authorization";
import type { MembershipDocument } from "./tenantContext";
import { TenantDbError } from "./tenantDb";

/** The row budget of an exact lookup: one more than the contract allows. */
const EXACT_TAKE = 2;

/**
 * What this adapter needs from a Convex context: a read-only database.
 *
 * Structural rather than `GenericQueryCtx<DataModel>`, so a real `QueryCtx` or
 * `MutationCtx` can be passed without this module claiming to want `auth`,
 * `storage`, or `runQuery`. A writer satisfies it too — it extends the reader —
 * and no write is reachable through the reader type.
 */
export interface AuthorizationLookupContext {
  readonly db: GenericDatabaseReader<DataModel>;
}

/**
 * Bind the eight authorization reads to one database and one request.
 *
 * Frozen: a caller that could replace `findRolePermission` after the fact could
 * replace the grant check the decision is about to make.
 */
export function createConvexAuthorizationLookups(
  ctx: AuthorizationLookupContext,
  requestId: string,
): AuthorizationFactLookups {
  const { db } = ctx;

  const invalidResult = (): TenantDbError =>
    new TenantDbError("INVALID_INDEX_RESULT", requestId);

  /**
   * Reduce a `take(EXACT_TAKE)` answer to at most one document.
   *
   * `null` for none and `null` for two or more: absence and ambiguity are the same
   * answer to the kernel, and both deny.
   */
  const atMostOne = <Document>(rows: readonly Document[]): Document | null => {
    if (!Array.isArray(rows)) throw invalidResult();
    if (rows.length !== 1) return null;
    const row = rows[0];
    if (row === null || typeof row !== "object") throw invalidResult();
    return row;
  };

  /**
   * Refuse a page size the kernel's own contract does not allow.
   *
   * A rejection rather than a clamp, matching `tenantDb.ts`: a caller that asked
   * for more rows than the bound has a plan a quietly truncated answer would
   * corrupt, and here that plan is an authorization decision.
   */
  const boundedLimit = (limit: number, maximum: number): number => {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximum) {
      throw new TenantDbError("INVALID_LIMIT", requestId);
    }
    return limit;
  };

  const findMembership: AuthorizationFactLookups["findMembership"] = async ({
    orgId,
    userId,
  }): Promise<MembershipDocument | null> => {
    const rows = await db
      .query("memberships")
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

  const listMembershipRoles: AuthorizationFactLookups["listMembershipRoles"] =
    async ({
      orgId,
      membershipId,
      limit,
    }): Promise<readonly MembershipRoleDocument[]> => {
      const rows = await db
        .query("membershipRoles")
        // The `["orgId", "membershipId"]` prefix of
        // `["orgId", "membershipId", "roleId"]`: every role of one membership,
        // bounded by `take`.
        .withIndex("by_orgId_membershipId_roleId", (q) =>
          q.eq("orgId", orgId).eq("membershipId", membershipId),
        )
        .take(boundedLimit(limit, MEMBERSHIP_ROLE_LIMIT));
      if (!Array.isArray(rows)) throw invalidResult();
      // A mismatching row is raised, never dropped: an index that answered
      // outside its range must not look like a membership with fewer roles.
      for (const row of rows) {
        if (row.orgId !== orgId || row.membershipId !== membershipId) {
          throw invalidResult();
        }
      }
      return rows;
    };

  const findRole: AuthorizationFactLookups["findRole"] = async ({
    orgId,
    roleId,
  }): Promise<RoleDocument | null> => {
    // A `GenericId` is a branded string, and the brand is a compile-time claim
    // about a value read out of a row. `normalizeId` is the only thing that
    // decides whether a string is an ID *of this table*.
    const normalized = db.normalizeId("roles", roleId);
    if (normalized === null) return null;
    const role = await db.get("roles", normalized);
    if (role === null) return null;
    if (role._id !== normalized) throw invalidResult();
    // A document read needs no index, which is exactly why this check is not
    // optional: nothing about the read above was scoped to `orgId`.
    return role.orgId === orgId ? role : null;
  };

  const findRolePermission: AuthorizationFactLookups["findRolePermission"] =
    async ({
      orgId,
      roleId,
      permissionCode,
    }): Promise<RolePermissionDocument | null> => {
      const rows = await db
        .query("rolePermissions")
        // The full triple, so this is an exact read: "does this role grant this
        // code" rather than "what does this role grant".
        .withIndex("by_orgId_roleId_permissionCode", (q) =>
          q
            .eq("orgId", orgId)
            .eq("roleId", roleId)
            .eq("permissionCode", permissionCode),
        )
        .take(EXACT_TAKE);
      const grant = atMostOne(rows);
      if (grant === null) return null;
      return grant.orgId === orgId &&
        grant.roleId === roleId &&
        grant.permissionCode === permissionCode
        ? grant
        : null;
    };

  const findMembershipWarehouse: AuthorizationFactLookups["findMembershipWarehouse"] =
    async ({ orgId, membershipId, warehouseId }) => {
      const rows = await db
        .query("membershipWarehouses")
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

  const findEntitlement: AuthorizationFactLookups["findEntitlement"] = async ({
    orgId,
    key,
  }): Promise<EntitlementDocument | null> => {
    const rows = await db
      .query("entitlements")
      .withIndex("by_orgId_key", (q) => q.eq("orgId", orgId).eq("key", key))
      .take(EXACT_TAKE);
    const entitlement = atMostOne(rows);
    if (entitlement === null) return null;
    return entitlement.orgId === orgId && entitlement.key === key
      ? entitlement
      : null;
  };

  const listRecentSessionEvents: AuthorizationFactLookups["listRecentSessionEvents"] =
    async ({
      orgId,
      userId,
      notBefore,
      limit,
    }): Promise<readonly SessionsAuditDocument[]> => {
      if (!Number.isFinite(notBefore)) {
        throw new TenantDbError("INVALID_INDEX_QUERY", requestId);
      }
      const rows = await db
        .query("sessionsAudit")
        // `["orgId", "userId"]` equality and an *indexed range* on the third
        // field: a range is part of the index read, not a `.filter()` over rows
        // the database already paid to load.
        .withIndex("by_orgId_userId_occurredAt", (q) =>
          q
            .eq("orgId", orgId)
            .eq("userId", userId)
            .gte("occurredAt", notBefore),
        )
        // Newest first: the only reason this adapter holds a raw database.
        .order("desc")
        .take(boundedLimit(limit, STEP_UP_EVENT_LIMIT));
      if (!Array.isArray(rows)) throw invalidResult();
      for (const row of rows) {
        if (row.orgId !== orgId || row.userId !== userId) {
          throw invalidResult();
        }
      }
      return rows;
    };

  const findDeviceByInstallationId: AuthorizationFactLookups["findDeviceByInstallationId"] =
    async ({ orgId, installationId }): Promise<DeviceDocument | null> => {
      const rows = await db
        .query("devices")
        .withIndex("by_orgId_installationId", (q) =>
          q.eq("orgId", orgId).eq("installationId", installationId),
        )
        .take(EXACT_TAKE);
      const device = atMostOne(rows);
      if (device === null) return null;
      // Unique per organization *when present*, by contract: a row whose value
      // does not match is not this installation's device.
      return device.orgId === orgId && device.installationId === installationId
        ? device
        : null;
    };

  return Object.freeze({
    findMembership,
    listMembershipRoles,
    findRole,
    findRolePermission,
    findMembershipWarehouse,
    findEntitlement,
    listRecentSessionEvents,
    findDeviceByInstallationId,
  });
}
