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
  /**
   * The member's display name only, for labels. It does not evaluate the
   * membership's effective window, so it never reads the clock; a former
   * (revoked) member keeps their name on historical records.
   */
  readonly displayName: (userId: string) => Promise<string | null>;
  /** Active members in user order; null when more than `limit` exist. */
  readonly listActive: (
    limit: number,
  ) => Promise<readonly OrganizationMember[] | null>;
}

export const MEMBER_DIRECTORY_MAX = 500;

type Membership = DataModel["memberships"]["document"];

/** Rows read per status bucket: enough to detect an ambiguous duplicate. */
const BUCKET_TAKE = 2;

export function createMemberDirectory(
  db: GenericDatabaseReader<DataModel>,
  orgId: GenericId<"organizations">,
): MemberDirectoryPort {
  const bucket = async (
    userId: GenericId<"users">,
    status: Membership["status"],
  ): Promise<readonly Membership[]> => {
    const rows = await db
      .query("memberships")
      .withIndex("by_orgId_status_userId", (query) =>
        query.eq("orgId", orgId).eq("status", status).eq("userId", userId),
      )
      .order("desc")
      .take(BUCKET_TAKE);
    return rows.filter(
      (row) =>
        row.orgId === orgId && row.userId === userId && row.status === status,
    );
  };

  /**
   * The member's membership in this organization. A re-add creates a new
   * row and keeps the revoked tombstone, so (as tenant context does) the
   * current ACTIVE/SUSPENDED membership wins and tombstones only answer
   * when nothing current exists; the newest tombstone then stands for the
   * former member. Ambiguous current rows resolve as `ambiguous`.
   */
  const membershipOf = async (
    userId: GenericId<"users">,
  ): Promise<Membership | "ambiguous" | null> => {
    const [active, suspended] = await Promise.all([
      bucket(userId, "ACTIVE"),
      bucket(userId, "SUSPENDED"),
    ]);
    const current = [...active, ...suspended];
    if (current.length > 1) return "ambiguous";
    if (current.length === 1) return current[0]!;
    return (await bucket(userId, "REVOKED"))[0] ?? null;
  };

  const describe = async (
    membership: Membership,
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
      const membership = await membershipOf(id);
      // Duplicate current memberships are refused, never guessed between.
      if (membership === null || membership === "ambiguous") return null;
      return await describe(membership);
    },
    displayName: async (userId: string) => {
      const id = db.normalizeId("users", userId);
      if (id === null) return null;
      // Any membership of this organization (current or tombstone) proves
      // the user belongs to it; the name lives on the user, not the row.
      const membership = await membershipOf(id);
      if (membership === null) return null;
      const user = await db.get("users", id);
      return user?.displayName ?? null;
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
