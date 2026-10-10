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

const EXACT_TAKE = 2;

export interface TenantContextLookupContext {
  readonly db: GenericDatabaseReader<DataModel>;
}

export function createConvexTenantContextLookups(
  ctx: TenantContextLookupContext,
  requestId: string,
): TenantContextLookups {
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

  const findUserByClerkUserId = async (
    clerkUserId: string,
  ): Promise<UserDocument | null> => {
    const rows = await db
      .query("users")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", clerkUserId))
      .take(EXACT_TAKE);
    const user = atMostOne(rows);
    if (user === null) return null;

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
      // A re-add has a new Clerk membership ID. Retain revoked tombstones, but
      // resolve only one current membership. Exact indexed status buckets keep
      // the read bounded even after many historical revocations.
      const readBucket = async (status: MembershipDocument["status"]) => {
        const rows = await db
          .query("memberships")
          .withIndex("by_orgId_status_userId", (q) =>
            q.eq("orgId", orgId).eq("status", status).eq("userId", userId),
          )
          .take(EXACT_TAKE);
        if (!Array.isArray(rows)) throw invalidResult();
        if (
          rows.some(
            (row) =>
              row === null ||
              typeof row !== "object" ||
              row.orgId !== orgId ||
              row.userId !== userId ||
              row.status !== status,
          )
        ) {
          throw invalidResult();
        }
        return rows;
      };
      const buckets = await Promise.all([
        readBucket("ACTIVE"),
        readBucket("SUSPENDED"),
      ]);
      const current = buckets.flat();
      // Preserve the public inactive denial for a revoked-only membership.
      // Historical rows must never rescue ambiguous current memberships or
      // mask the sole active re-add. The fallback is an exact, bounded read.
      const membership = atMostOne(
        current.length === 0 ? await readBucket("REVOKED") : current,
      );
      if (membership === null) return null;
      return membership.orgId === orgId && membership.userId === userId
        ? membership
        : null;
    };

  const findWarehouseByOrganizationAndId: TenantContextLookups["findWarehouseByOrganizationAndId"] =
    async ({ orgId, warehouseId }): Promise<WarehouseDocument | null> => {
      const normalized = db.normalizeId("warehouses", warehouseId);
      if (normalized === null) return null;

      const warehouse = await db.get("warehouses", normalized);
      if (warehouse === null) return null;
      if (warehouse._id !== normalized) throw invalidResult();

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
