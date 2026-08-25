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

const EXACT_TAKE = 2;

export interface AuthorizationLookupContext {
  readonly db: GenericDatabaseReader<DataModel>;
}

export function createConvexAuthorizationLookups(
  ctx: AuthorizationLookupContext,
  requestId: string,
): AuthorizationFactLookups {
  const { db } = ctx;

  const invalidResult = (): TenantDbError =>
    new TenantDbError("INVALID_INDEX_RESULT", requestId);

  const atMostOne = <Document>(rows: readonly Document[]): Document | null => {
    if (!Array.isArray(rows)) throw invalidResult();
    if (rows.length !== 1) return null;
    const row = rows[0];
    if (row === null || typeof row !== "object") throw invalidResult();
    return row;
  };

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
    const normalized = db.normalizeId("roles", roleId);
    if (normalized === null) return null;
    const role = await db.get("roles", normalized);
    if (role === null) return null;
    if (role._id !== normalized) throw invalidResult();

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
