import type {
  IdentityMirrorPort,
  MirroredMembership,
  MirroredOrganization,
  MirroredUser,
} from "../../convex/lib/identityWebhook";

/** Deliberately policy-free storage for proving the pure identity mirror kernel. */
export function createIdentityMirrorPortFixture() {
  const organizations = new Map<string, MirroredOrganization>();
  const users = new Map<string, MirroredUser>();
  const memberships = new Map<string, MirroredMembership>();
  let writes = 0;

  const membershipKey = (orgId: string, membershipId: string) =>
    `${orgId}\u0000${membershipId}`;

  const port: IdentityMirrorPort = {
    findOrganization: (id) => Promise.resolve(organizations.get(id) ?? null),
    putOrganization: (value) => {
      writes += 1;
      organizations.set(value.clerkOrganizationId, { ...value });
      return Promise.resolve();
    },
    findUser: (id) => Promise.resolve(users.get(id) ?? null),
    putUser: (value) => {
      writes += 1;
      users.set(value.clerkUserId, { ...value });
      return Promise.resolve();
    },
    findMembership: ({ clerkOrganizationId, clerkMembershipId }) =>
      Promise.resolve(
        memberships.get(
          membershipKey(clerkOrganizationId, clerkMembershipId),
        ) ?? null,
      ),
    putMembership: (value) => {
      writes += 1;
      memberships.set(
        membershipKey(value.clerkOrganizationId, value.clerkMembershipId),
        { ...value },
      );
      return Promise.resolve();
    },
  };

  return {
    port,
    writes: () => writes,
    organization: (id: string) => organizations.get(id),
    user: (id: string) => users.get(id),
    membership: (orgId: string, membershipId: string) =>
      memberships.get(membershipKey(orgId, membershipId)),
    seedOrganization: (value: MirroredOrganization) =>
      organizations.set(value.clerkOrganizationId, { ...value }),
    seedUser: (value: MirroredUser) =>
      users.set(value.clerkUserId, { ...value }),
    seedMembership: (value: MirroredMembership) =>
      memberships.set(
        membershipKey(value.clerkOrganizationId, value.clerkMembershipId),
        { ...value },
      ),
  } as const;
}
