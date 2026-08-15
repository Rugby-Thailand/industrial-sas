/**
 * Deterministic in-memory tenant world for the tenant-context resolution suites.
 *
 * This is a fixture, not a test: it is imported by
 * `tests/integration/tenant-context-resolution.integration.test.ts` and
 * `tests/isolation/tenant-context-isolation.isolation.test.ts`, and it is
 * deliberately outside every Vitest project's `include` glob.
 *
 * What it is: five `Map` lookups over documents built from
 * [`convex/schema.ts`](../../convex/schema.ts)'s declared shapes, wired to the
 * `TenantContextLookups` port. Every lookup is an exact key `get` — there is no
 * iteration, no predicate, and no way for a fake lookup to answer a question the
 * production port cannot ask, because the fake's job is to make the production
 * algorithm's branches reachable, not to be lenient about which ones exist.
 *
 * What it is not: a Convex database. There is no transaction, no index, no
 * `convex-test`, and no deployment. Both suites therefore prove properties of the
 * resolution *algorithm*. Runtime isolation over a real Convex `ctx.db` arrives
 * with the tenant-bound accessor and its own suite (`RG-013`, `RG-031`).
 *
 * Two details are load-bearing for the suites:
 *
 * - **Document IDs are derived from a table and a caller-chosen key**, so a test
 *   can build two tenants whose warehouses have the *same key* and therefore
 *   ID-shaped near-collisions, and prove that resolution still separates them.
 * - **Every lookup call is recorded**, so a test can assert that a denial
 *   happened *before* a lookup (an anonymous caller must not cause a read) and
 *   that resolution never asks a question it has not earned.
 *
 * `FIXTURE_SENSITIVE_VALUES` is the corpus the leak test scans denials against:
 * synthetic Thai names, external Clerk references, claim values, warehouse codes,
 * and the generated document IDs. All of it is invented — no real customer,
 * supplier, or personal data (PDPA, see `tests/fixtures/README.md`).
 */
import type { UserIdentity } from "convex/server";
import type { GenericId, JSONValue } from "convex/values";

import { DEFAULT_ORGANIZATION_SETTINGS } from "../../convex/lib/organizationDefaults";
import type {
  MembershipDocument,
  MembershipId,
  MembershipWarehouseDocument,
  OrganizationDocument,
  OrganizationId,
  TenantContextLookups,
  UserDocument,
  UserId,
  WarehouseDocument,
  WarehouseId,
} from "../../convex/lib/tenantContext";
import type {
  MembershipScopeMode,
  MembershipStatus,
  OrganizationStatus,
  UserStatus,
  WarehouseStatus,
} from "../../convex/lib/validators";

/* -------------------------------------------------------------------------- */
/* Identifiers                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Build a document ID for a table from a stable key.
 *
 * `GenericId<T>` is a branded string, so producing one outside Convex needs one
 * assertion. It is confined to this function, it is the narrowest form available
 * (`string` to a branded `string`), and it exists only because there is no
 * generated code and no deployment to mint real IDs. Nothing in `convex/`
 * asserts anything of the kind.
 *
 * The `table:key` shape is what lets a test build `warehouses:north` in two
 * different tenants and confirm that similarity of *shape* buys an attacker
 * nothing: resolution compares documents, not strings that look alike.
 */
export function fixtureId<Table extends string>(
  table: Table,
  key: string,
): GenericId<Table> {
  return `${table}:${key}` as GenericId<Table>;
}

/** Creation timestamps are fixed: nothing here may depend on the wall clock. */
export const FIXTURE_CREATION_TIME = 1_767_225_600_000;

/* -------------------------------------------------------------------------- */
/* World specification                                                         */
/* -------------------------------------------------------------------------- */

export type OrganizationSpec = {
  /** Fixture-local key; also the document ID suffix. */
  readonly key: string;
  readonly clerkOrganizationId: string;
  readonly name: string;
  readonly status: OrganizationStatus;
};

export type UserSpec = {
  readonly key: string;
  readonly clerkUserId: string;
  readonly displayName: string;
  readonly status: UserStatus;
};

export type MembershipSpec = {
  readonly key: string;
  /** `OrganizationSpec.key` of the tenant this membership belongs to. */
  readonly organization: string;
  /** `UserSpec.key` of the member. */
  readonly user: string;
  readonly clerkMembershipId: string;
  readonly status: MembershipStatus;
  readonly scopeMode: MembershipScopeMode;
};

export type WarehouseSpec = {
  readonly key: string;
  readonly organization: string;
  /** The tenant's human identifier. Two tenants may legitimately reuse one. */
  readonly code: string;
  readonly name: string;
  readonly status: WarehouseStatus;
};

/** An explicit scope row: this membership may act in this warehouse. */
export type MembershipWarehouseSpec = {
  readonly membership: string;
  readonly warehouse: string;
};

export type WorldSpec = {
  readonly organizations: readonly OrganizationSpec[];
  readonly users: readonly UserSpec[];
  readonly memberships: readonly MembershipSpec[];
  readonly warehouses: readonly WarehouseSpec[];
  readonly membershipWarehouses?: readonly MembershipWarehouseSpec[];
};

/** Which lookup was called, for the ordering and no-read-before-denial assertions. */
export type LookupCall =
  | "findUserByClerkUserId"
  | "findOrganizationByClerkOrganizationId"
  | "findMembershipByOrganizationAndUser"
  | "findWarehouseByOrganizationAndId"
  | "findMembershipWarehouse";

export type FakeWorld = {
  readonly lookups: TenantContextLookups;
  /** Lookup names in call order. Mutable by design: the world records into it. */
  readonly calls: LookupCall[];
  readonly organization: (key: string) => OrganizationDocument;
  readonly user: (key: string) => UserDocument;
  readonly membership: (key: string) => MembershipDocument;
  readonly warehouse: (key: string) => WarehouseDocument;
  readonly organizationId: (key: string) => OrganizationId;
  readonly userId: (key: string) => UserId;
  readonly membershipId: (key: string) => MembershipId;
  readonly warehouseId: (key: string) => WarehouseId;
};

/* -------------------------------------------------------------------------- */
/* World construction                                                         */
/* -------------------------------------------------------------------------- */

function required<Value>(map: ReadonlyMap<string, Value>, key: string): Value {
  const value = map.get(key);
  if (value === undefined) {
    throw new Error(`Fixture key "${key}" is not in this world.`);
  }
  return value;
}

/**
 * Build a world and its lookup port.
 *
 * The port's implementations are exact-key reads, in the same shape the real
 * index-backed implementations will have: one argument set in, at most one
 * document out.
 */
export function createFakeWorld(spec: WorldSpec): FakeWorld {
  const calls: LookupCall[] = [];

  const organizationsByKey = new Map<string, OrganizationDocument>();
  const organizationsByClerkId = new Map<string, OrganizationDocument>();
  for (const org of spec.organizations) {
    const document: OrganizationDocument = {
      _id: fixtureId("organizations", org.key),
      _creationTime: FIXTURE_CREATION_TIME,
      clerkOrganizationId: org.clerkOrganizationId,
      name: org.name,
      status: org.status,
      settings: { ...DEFAULT_ORGANIZATION_SETTINGS },
    };
    organizationsByKey.set(org.key, document);
    organizationsByClerkId.set(org.clerkOrganizationId, document);
  }

  const usersByKey = new Map<string, UserDocument>();
  const usersByClerkId = new Map<string, UserDocument>();
  for (const user of spec.users) {
    const document: UserDocument = {
      _id: fixtureId("users", user.key),
      _creationTime: FIXTURE_CREATION_TIME,
      clerkUserId: user.clerkUserId,
      displayName: user.displayName,
      status: user.status,
    };
    usersByKey.set(user.key, document);
    usersByClerkId.set(user.clerkUserId, document);
  }

  const membershipsByKey = new Map<string, MembershipDocument>();
  const membershipsByOrgAndUser = new Map<string, MembershipDocument>();
  for (const membership of spec.memberships) {
    const org = required(organizationsByKey, membership.organization);
    const user = required(usersByKey, membership.user);
    const document: MembershipDocument = {
      _id: fixtureId("memberships", membership.key),
      _creationTime: FIXTURE_CREATION_TIME,
      orgId: org._id,
      userId: user._id,
      clerkMembershipId: membership.clerkMembershipId,
      status: membership.status,
      scopeMode: membership.scopeMode,
      effectiveFrom: FIXTURE_CREATION_TIME,
    };
    membershipsByKey.set(membership.key, document);
    membershipsByOrgAndUser.set(`${org._id}|${user._id}`, document);
  }

  const warehousesByKey = new Map<string, WarehouseDocument>();
  const warehousesByOrgAndId = new Map<string, WarehouseDocument>();
  for (const warehouse of spec.warehouses) {
    const org = required(organizationsByKey, warehouse.organization);
    const document: WarehouseDocument = {
      _id: fixtureId("warehouses", warehouse.key),
      _creationTime: FIXTURE_CREATION_TIME,
      orgId: org._id,
      code: warehouse.code,
      name: warehouse.name,
      status: warehouse.status,
    };
    warehousesByKey.set(warehouse.key, document);
    warehousesByOrgAndId.set(`${org._id}|${document._id}`, document);
  }

  const scopeRows = new Map<string, MembershipWarehouseDocument>();
  for (const row of spec.membershipWarehouses ?? []) {
    const membership = required(membershipsByKey, row.membership);
    const warehouse = required(warehousesByKey, row.warehouse);
    const document: MembershipWarehouseDocument = {
      _id: fixtureId(
        "membershipWarehouses",
        `${row.membership}-${row.warehouse}`,
      ),
      _creationTime: FIXTURE_CREATION_TIME,
      orgId: membership.orgId,
      membershipId: membership._id,
      warehouseId: warehouse._id,
    };
    scopeRows.set(
      `${membership.orgId}|${membership._id}|${warehouse._id}`,
      document,
    );
  }

  const lookups: TenantContextLookups = {
    findUserByClerkUserId: (clerkUserId) => {
      calls.push("findUserByClerkUserId");
      return Promise.resolve(usersByClerkId.get(clerkUserId) ?? null);
    },
    findOrganizationByClerkOrganizationId: (clerkOrganizationId) => {
      calls.push("findOrganizationByClerkOrganizationId");
      return Promise.resolve(
        organizationsByClerkId.get(clerkOrganizationId) ?? null,
      );
    },
    findMembershipByOrganizationAndUser: ({ orgId, userId }) => {
      calls.push("findMembershipByOrganizationAndUser");
      return Promise.resolve(
        membershipsByOrgAndUser.get(`${orgId}|${userId}`) ?? null,
      );
    },
    findWarehouseByOrganizationAndId: ({ orgId, warehouseId }) => {
      calls.push("findWarehouseByOrganizationAndId");
      return Promise.resolve(
        warehousesByOrgAndId.get(`${orgId}|${warehouseId}`) ?? null,
      );
    },
    findMembershipWarehouse: ({ orgId, membershipId, warehouseId }) => {
      calls.push("findMembershipWarehouse");
      return Promise.resolve(
        scopeRows.get(`${orgId}|${membershipId}|${warehouseId}`) ?? null,
      );
    },
  };

  return {
    lookups,
    calls,
    organization: (key) => required(organizationsByKey, key),
    user: (key) => required(usersByKey, key),
    membership: (key) => required(membershipsByKey, key),
    warehouse: (key) => required(warehousesByKey, key),
    organizationId: (key) => required(organizationsByKey, key)._id,
    userId: (key) => required(usersByKey, key)._id,
    membershipId: (key) => required(membershipsByKey, key)._id,
    warehouseId: (key) => required(warehousesByKey, key)._id,
  };
}

/* -------------------------------------------------------------------------- */
/* Verified identities                                                         */
/* -------------------------------------------------------------------------- */

/**
 * An email that only ever exists inside a token.
 *
 * Clerk session tokens routinely carry `email`, and `UserIdentity` exposes it.
 * The mirror deliberately stores none (`users` has no contact field, §14), so a
 * denial that mentioned this string could only have got it from the token — which
 * makes it the sharpest single probe in the leak test.
 */
export const FIXTURE_IDENTITY_EMAIL = "siriwan.t@example.com";

/**
 * The issuer these fixture tokens claim to come from.
 *
 * A reserved `example.com` host (RFC 2606), so no fixture value can ever be
 * mistaken for — or resolve to — a real identity provider. This repository
 * verifies no token, so the value's only job is to be unmistakably synthetic.
 */
export const FIXTURE_ISSUER = "https://clerk.example.com";

/**
 * A verified identity, as `ctx.auth.getUserIdentity()` would return one.
 *
 * "Verified" is the premise, not a claim this fixture proves: token verification
 * is Clerk's and Convex's, and this module never signs or checks anything. The
 * `claims` argument is deliberately as loose as the real index signature on
 * `UserIdentity`, so a suite can present a claim that is a number, an object, or
 * absent, without an assertion.
 */
export function fixtureIdentity(
  subject: string,
  claims: Readonly<Record<string, JSONValue>> = {},
): UserIdentity {
  return {
    tokenIdentifier: `${FIXTURE_ISSUER}|${subject}`,
    subject,
    issuer: FIXTURE_ISSUER,
    email: FIXTURE_IDENTITY_EMAIL,
    ...claims,
  };
}

/** A Clerk v2 active-organization claim. */
export function activeOrganizationClaim(
  value: JSONValue,
): Readonly<Record<string, JSONValue>> {
  return { o: { id: value } };
}

/* -------------------------------------------------------------------------- */
/* The two-tenant world both suites use                                        */
/* -------------------------------------------------------------------------- */

/**
 * Two tenants that are as similar as the domain allows, so that any separation
 * the resolver achieves is separation it earned:
 *
 * - both have a warehouse whose human `code` is `NORTH` (`warehouses.code` is
 *   unique *per organization*, never globally — §5 Q4);
 * - `siriwan` holds an active membership in both tenants, which is the multi-org
 *   person C-02 exists for;
 * - `siriwan`'s membership in tenant A is `ORG_WIDE` and in tenant B is
 *   `WAREHOUSE_SCOPED` to one warehouse only, so the same human is in and out of
 *   scope depending on which tenant is active.
 */
export const TWO_TENANT_WORLD: WorldSpec = {
  organizations: [
    {
      key: "alpha",
      clerkOrganizationId: "org_alpha_2f8c",
      name: "บริษัท อัลฟ่า แมนูแฟคเจอริ่ง จำกัด",
      status: "ACTIVE",
    },
    {
      key: "beta",
      clerkOrganizationId: "org_beta_7d31",
      name: "Beta Precision Parts Co., Ltd.",
      status: "ACTIVE",
    },
    {
      key: "suspended",
      clerkOrganizationId: "org_suspended_9a02",
      name: "Gamma Unpaid Industries",
      status: "SUSPENDED",
    },
    {
      key: "closed",
      clerkOrganizationId: "org_closed_4b55",
      name: "Delta Offboarded Industries",
      status: "CLOSED",
    },
  ],
  users: [
    {
      key: "siriwan",
      clerkUserId: "user_siriwan_1a2b",
      displayName: "ศิริวรรณ ธนกร",
      status: "ACTIVE",
    },
    {
      key: "chaiwat",
      clerkUserId: "user_chaiwat_3c4d",
      displayName: "ชัยวัฒน์ พงษ์ศรี",
      status: "ACTIVE",
    },
    {
      key: "deactivated",
      clerkUserId: "user_deactivated_5e6f",
      displayName: "Pornthip Leaver",
      status: "DEACTIVATED",
    },
    {
      key: "outsider",
      clerkUserId: "user_outsider_7a8b",
      displayName: "Outsider Nobody",
      status: "ACTIVE",
    },
  ],
  memberships: [
    {
      key: "siriwan-alpha",
      organization: "alpha",
      user: "siriwan",
      clerkMembershipId: "orgmem_siriwan_alpha_11",
      status: "ACTIVE",
      scopeMode: "ORG_WIDE",
    },
    {
      key: "siriwan-beta",
      organization: "beta",
      user: "siriwan",
      clerkMembershipId: "orgmem_siriwan_beta_22",
      status: "ACTIVE",
      scopeMode: "WAREHOUSE_SCOPED",
    },
    {
      key: "chaiwat-alpha-suspended",
      organization: "alpha",
      user: "chaiwat",
      clerkMembershipId: "orgmem_chaiwat_alpha_33",
      status: "SUSPENDED",
      scopeMode: "ORG_WIDE",
    },
    {
      key: "chaiwat-beta-revoked",
      organization: "beta",
      user: "chaiwat",
      clerkMembershipId: "orgmem_chaiwat_beta_44",
      status: "REVOKED",
      scopeMode: "ORG_WIDE",
    },
    {
      key: "deactivated-alpha",
      organization: "alpha",
      user: "deactivated",
      clerkMembershipId: "orgmem_deactivated_alpha_55",
      status: "ACTIVE",
      scopeMode: "ORG_WIDE",
    },
    {
      key: "siriwan-suspended-org",
      organization: "suspended",
      user: "siriwan",
      clerkMembershipId: "orgmem_siriwan_suspended_66",
      status: "ACTIVE",
      scopeMode: "ORG_WIDE",
    },
    {
      key: "siriwan-closed-org",
      organization: "closed",
      user: "siriwan",
      clerkMembershipId: "orgmem_siriwan_closed_77",
      status: "ACTIVE",
      scopeMode: "ORG_WIDE",
    },
  ],
  warehouses: [
    {
      key: "alpha-north",
      organization: "alpha",
      code: "NORTH",
      name: "คลังเหนือ",
      status: "ACTIVE",
    },
    {
      key: "alpha-retired",
      organization: "alpha",
      code: "ARCHIVE",
      name: "คลังเก่า",
      status: "INACTIVE",
    },
    {
      key: "beta-north",
      organization: "beta",
      code: "NORTH",
      name: "Beta North Site",
      status: "ACTIVE",
    },
    {
      key: "beta-south",
      organization: "beta",
      code: "SOUTH",
      name: "Beta South Site",
      status: "ACTIVE",
    },
  ],
  membershipWarehouses: [
    // Tenant B scopes Siriwan to NORTH only; SOUTH is deliberately not granted.
    { membership: "siriwan-beta", warehouse: "beta-north" },
  ],
};

/**
 * Every string in the fixture that a denial must never contain: display names,
 * organization names, external Clerk references, warehouse codes and names, and
 * the document IDs derived from the keys above.
 *
 * Assembled from the spec rather than hand-listed, so adding a fixture value
 * automatically widens the leak test instead of quietly escaping it.
 */
export const FIXTURE_SENSITIVE_VALUES: readonly string[] = [
  FIXTURE_IDENTITY_EMAIL,
  ...TWO_TENANT_WORLD.organizations.flatMap((org) => [
    org.clerkOrganizationId,
    org.name,
    fixtureId("organizations", org.key),
  ]),
  ...TWO_TENANT_WORLD.users.flatMap((user) => [
    user.clerkUserId,
    user.displayName,
    fixtureId("users", user.key),
  ]),
  ...TWO_TENANT_WORLD.memberships.flatMap((membership) => [
    membership.clerkMembershipId,
    fixtureId("memberships", membership.key),
  ]),
  ...TWO_TENANT_WORLD.warehouses.flatMap((warehouse) => [
    warehouse.code,
    warehouse.name,
    fixtureId("warehouses", warehouse.key),
  ]),
];
