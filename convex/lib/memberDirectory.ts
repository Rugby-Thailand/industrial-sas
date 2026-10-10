import type { GenericDatabaseReader } from "convex/server";
import type { GenericId } from "convex/values";

import type { DataModel } from "../schema";

export interface OrganizationMember {
  readonly userId: GenericId<"users">;
  readonly membershipId: GenericId<"memberships">;
  readonly displayName: string;
  readonly active: boolean;
}

/**
 * Read-only view of the active organization's members.
 *
 * `users` is a global table that the tenant accessor cannot read, so this port
 * resolves a user only through a membership of the current organization: a
 * user ID from another tenant answers exactly as an unknown one does.
 */
export interface MemberDirectoryPort {
  readonly get: (userId: string) => Promise<OrganizationMember | null>;
  /** Active members in user order; null when more than `limit` exist. */
  readonly listActive: (
    limit: number,
  ) => Promise<readonly OrganizationMember[] | null>;
}

export const MEMBER_DIRECTORY_MAX = 500;

export function createMemberDirectory(
  db: GenericDatabaseReader<DataModel>,
  orgId: GenericId<"organizations">,
): MemberDirectoryPort {
  const describe = async (
    membership: DataModel["memberships"]["document"],
  ): Promise<OrganizationMember | null> => {
    if (membership.orgId !== orgId) return null;
    const user = await db.get("users", membership.userId);
    if (user === null) return null;
    const now = Date.now();
    return Object.freeze({
      userId: user._id,
      membershipId: membership._id,
      displayName: user.displayName,
      active:
        membership.status === "ACTIVE" &&
        user.status === "ACTIVE" &&
        membership.effectiveFrom <= now &&
        (membership.effectiveTo === undefined || now < membership.effectiveTo),
    });
  };

  return Object.freeze({
    get: async (userId: string) => {
      const id = db.normalizeId("users", userId);
      if (id === null) return null;
      const membership = await db
        .query("memberships")
        .withIndex("by_orgId_userId", (query) =>
          query.eq("orgId", orgId).eq("userId", id),
        )
        .unique();
      return membership === null ? null : await describe(membership);
    },
    listActive: async (limit: number) => {
      const bounded = Math.min(
        Math.max(1, Math.floor(limit)),
        MEMBER_DIRECTORY_MAX,
      );
      const memberships = await db
        .query("memberships")
        .withIndex("by_orgId_status_userId", (query) =>
          query.eq("orgId", orgId).eq("status", "ACTIVE"),
        )
        .take(bounded + 1);
      if (memberships.length > bounded) return null;
      const members: OrganizationMember[] = [];
      for (const membership of memberships) {
        const member = await describe(membership);
        if (member?.active) members.push(member);
      }
      return Object.freeze(members);
    },
  });
}
