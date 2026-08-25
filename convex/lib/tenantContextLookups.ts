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
