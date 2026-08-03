/**
 * Integration tier — the authorization kernel against in-memory lookups.
 *
 * Two claims, and they are different from the isolation suite's:
 *
 * 1. **A declaration that cannot be enforced is refused at registration.** Every
 *    branch of `assertAuthorizationDeclaration` is exercised, because each one is a
 *    function that would otherwise deploy and either deny every call or check
 *    nothing.
 * 2. **Fact resolution is exact, bounded, and fails closed.** The fake lookup port
 *    can answer things a real database will not produce on demand — another
 *    tenant's row, a role that vanished between two reads, a reverification stamped
 *    in the future — which is exactly why the kernel takes its facts through a port
 *    instead of reading `ctx.db`.
 *
 * The port here enforces nothing; that is deliberate. What is under test is the
 * kernel's re-verification of every answer, so an honest fake would hide it. The
 * *Convex* adapter's own bounds are proved in
 * `tests/isolation/authorization-enforcement.isolation.test.ts` against
 * `convex-test`.
 *
 * All data is synthetic (`tests/fixtures/README.md`).
 */
import { describe, expect, it } from "vitest";

import {
  AUTHORIZATION_DENIAL_CODE,
  MEMBERSHIP_ROLE_LIMIT,
  STEP_UP_EVENT_LIMIT,
  STEP_UP_MAX_AGE_MS,
  appendAuthorizationAudit,
  assertAuthorizationDeclaration,
  authorizationAuditRow,
  decideAuthorization,
  resolveAuthorizationFacts,
  sanitizeAuthorizationPolicyFacts,
  toPublicAuthorizationDenial,
  usableInstallationId,
  type AuthorizationFactLookups,
  type AuthorizationFacts,
  type DeviceDocument,
  type EntitlementDocument,
  type MembershipRoleDocument,
  type RoleDocument,
  type RoleId,
  type RolePermissionDocument,
  type SessionsAuditDocument,
} from "../../convex/lib/authorization";
import { PERMISSIONS_BY_CODE } from "../../convex/lib/permissions";
import { createTenantDocumentAccess } from "../../convex/lib/tenantDb";
import type {
  MembershipDocument,
  MembershipId,
  MembershipWarehouseDocument,
  OrganizationId,
  UserId,
  WarehouseId,
} from "../../convex/lib/tenantContext";
import { createTenantStoragePortFixture } from "../fixtures/tenant-storage-port";

const ORG_A = "orgA" as OrganizationId;
const ORG_B = "orgB" as OrganizationId;
const USER = "userA" as UserId;
const MEMBERSHIP = "membershipA" as MembershipId;
const ROLE = "roleA" as RoleId;
const WAREHOUSE = "warehouseA" as WarehouseId;
const REQUEST_ID = "req_01JBZ0000000000000000000";
const NOW = 1_800_000_000_000;

const permission = (code: string) => {
  const definition = PERMISSIONS_BY_CODE.get(code);
  if (definition === undefined) throw new Error(`unknown fixture code ${code}`);
  return definition;
};

/** An ORG permission with no contextual policy, and a WAREHOUSE one. */
const AUDIT_READ = permission("admin.audit.read");
const RECEIPT_POST = permission("receiving.receipt.post");
const WAREHOUSE_MANAGE = permission("masterData.warehouse.manage");
const STATUS_APPROVE = permission("inventory.statusChange.approve");
const TASK_OVERRIDE = permission("putaway.task.override");

interface FakeWorld {
  membership: MembershipDocument | null;
  roleGrants: readonly MembershipRoleDocument[];
  roles: readonly RoleDocument[];
  rolePermissions: readonly RolePermissionDocument[];
  scope: MembershipWarehouseDocument | null;
  entitlement: EntitlementDocument | null;
  sessionEvents: readonly SessionsAuditDocument[];
  device: DeviceDocument | null;
}

/** A document with the two Convex-owned fields a stored row always carries. */
function stored<Document>(id: string, fields: object): Document {
  return { _id: id, _creationTime: 1, ...fields } as Document;
}

function membershipDocument(
  overrides: Partial<MembershipDocument> = {},
): MembershipDocument {
  return stored<MembershipDocument>(MEMBERSHIP, {
    orgId: ORG_A,
    userId: USER,
    clerkMembershipId: "orgmem_fixture",
    status: "ACTIVE",
    scopeMode: "WAREHOUSE_SCOPED",
    effectiveFrom: 0,
    ...overrides,
  });
}

function emptyWorld(): FakeWorld {
  return {
    membership: membershipDocument(),
    roleGrants: [],
    roles: [],
    rolePermissions: [],
    scope: null,
    entitlement: null,
    sessionEvents: [],
    device: null,
  };
}

/** A port that answers from `world` and records what it was asked. */
function fakeLookups(world: FakeWorld) {
  const calls: { readonly method: string; readonly input: unknown }[] = [];
  const log = <Result>(method: string, input: unknown, result: Result) => {
    calls.push({ method, input });
    return Promise.resolve(result);
  };

  const lookups: AuthorizationFactLookups = {
    findMembership: (input) => log("findMembership", input, world.membership),
    listMembershipRoles: (input) =>
      log("listMembershipRoles", input, world.roleGrants),
    findRole: (input) =>
      log(
        "findRole",
        input,
        world.roles.find((role) => role._id === input.roleId) ?? null,
      ),
    findRolePermission: (input) =>
      log(
        "findRolePermission",
        input,
        world.rolePermissions.find(
          (row) =>
            row.roleId === input.roleId &&
            row.permissionCode === input.permissionCode,
        ) ?? null,
      ),
    findMembershipWarehouse: (input) =>
      log("findMembershipWarehouse", input, world.scope),
    findEntitlement: (input) =>
      log("findEntitlement", input, world.entitlement),
    listRecentSessionEvents: (input) =>
      log(
        "listRecentSessionEvents",
        input,
        [...world.sessionEvents].sort((a, b) => b.occurredAt - a.occurredAt),
      ),
    findDeviceByInstallationId: (input) =>
      log("findDeviceByInstallationId", input, world.device),
  };
  return { lookups, calls };
}

async function facts(
  world: FakeWorld,
  overrides: {
    readonly permission?: typeof AUDIT_READ;
    readonly targetWarehouseId?: WarehouseId;
    readonly entitlementKey?: string;
    readonly membershipId?: MembershipId;
  } = {},
) {
  const { lookups, calls } = fakeLookups(world);
  const result = await resolveAuthorizationFacts({
    permission: overrides.permission ?? RECEIPT_POST,
    orgId: ORG_A,
    actorUserId: USER,
    membershipId: overrides.membershipId ?? MEMBERSHIP,
    ...(overrides.targetWarehouseId === undefined
      ? {}
      : { targetWarehouseId: overrides.targetWarehouseId }),
    ...(overrides.entitlementKey === undefined
      ? {}
      : { entitlementKey: overrides.entitlementKey }),
    now: NOW,
    lookups,
  });
  return { result, calls };
}

/** A world in which the actor's active role grants `code`. */
function grantingWorld(code: string): FakeWorld {
  return {
    ...emptyWorld(),
    roleGrants: [
      stored<MembershipRoleDocument>("grantA", {
        orgId: ORG_A,
        membershipId: MEMBERSHIP,
        roleId: ROLE,
        grantedAt: 0,
      }),
    ],
    roles: [
      stored<RoleDocument>(ROLE, {
        orgId: ORG_A,
        key: "SUPERVISOR",
        name: "Supervisor",
        status: "ACTIVE",
        seeded: true,
      }),
    ],
    rolePermissions: [
      stored<RolePermissionDocument>("rp", {
        orgId: ORG_A,
        roleId: ROLE,
        permissionCode: code,
      }),
    ],
  };
}

describe("authorization declarations", () => {
  it("accepts the declarations every enforceable shape needs", () => {
    expect(
      assertAuthorizationDeclaration("query", {
        permissionCode: "admin.audit.read",
        targetTable: "auditEvents",
        hasWarehouseSelector: false,
        hasPolicy: false,
      }).code,
    ).toBe("admin.audit.read");
    expect(
      assertAuthorizationDeclaration("mutation", {
        permissionCode: "receiving.receipt.post",
        targetTable: "warehouses",
        hasWarehouseSelector: true,
        hasPolicy: false,
        entitlementKey: "INBOUND_RECEIVING",
      }).scope,
    ).toBe("WAREHOUSE");
    expect(
      assertAuthorizationDeclaration("mutation", {
        permissionCode: "putaway.task.override",
        targetTable: "warehouses",
        hasWarehouseSelector: true,
        hasPolicy: true,
      }).requiresThreshold,
    ).toBe(true);
    expect(
      assertAuthorizationDeclaration("action", {
        permissionCode: "label.print.execute",
        targetTable: "warehouses",
        hasWarehouseSelector: true,
        hasPolicy: false,
      }).code,
    ).toBe("label.print.execute");
  });

  it.each([
    [
      "an unknown code",
      { permissionCode: "invented.permission.use" },
      /does not define it/,
    ],
    [
      "a platform code",
      { permissionCode: "platform.tenant.write" },
      /PLATFORM/,
    ],
    [
      "a warehouse permission with no selector",
      { permissionCode: "receiving.receipt.post", hasWarehouseSelector: false },
      /warehouseId selector/,
    ],
    [
      "a threshold permission with no policy",
      {
        permissionCode: "putaway.task.override",
        hasWarehouseSelector: true,
        hasPolicy: false,
      },
      /policy callback/,
    ],
    [
      "a maker-checker permission with no policy",
      {
        permissionCode: "inventory.statusChange.approve",
        hasWarehouseSelector: true,
        hasPolicy: false,
      },
      /policy callback/,
    ],
    [
      "a policy nothing would read",
      { permissionCode: "admin.audit.read", hasPolicy: true },
      /would never be read/,
    ],
    [
      "a target table that is not tenant-scoped",
      { permissionCode: "admin.audit.read", targetTable: "permissions" },
      /not a tenant table/,
    ],
    [
      "a padded entitlement key",
      { permissionCode: "admin.audit.read", entitlementKey: " KEY" },
      /entitlement key/,
    ],
    [
      "a blank entitlement key",
      { permissionCode: "admin.audit.read", entitlementKey: "" },
      /entitlement key/,
    ],
  ])("refuses %s", (_name, overrides, message) => {
    const base = {
      permissionCode: "admin.audit.read",
      targetTable: "auditEvents",
      hasWarehouseSelector: true,
      hasPolicy: false,
    };
    expect(() =>
      assertAuthorizationDeclaration("mutation", { ...base, ...overrides }),
    ).toThrow(message);
  });

  it("refuses a contextual policy on an action, whatever it declares", () => {
    for (const code of [
      "putaway.task.override",
      "inventory.statusChange.approve",
    ]) {
      expect(() =>
        assertAuthorizationDeclaration("action", {
          permissionCode: code,
          targetTable: "warehouses",
          hasWarehouseSelector: true,
          hasPolicy: true,
        }),
      ).toThrow(/register this operation as a mutation/);
    }
  });

  it("bounds the installation ID it will look a device up by", () => {
    expect(usableInstallationId("install-1")).toBe("install-1");
    expect(usableInstallationId(" install-1")).toBeNull();
    expect(usableInstallationId("")).toBeNull();
    expect(usableInstallationId("x".repeat(129))).toBeNull();
    expect(usableInstallationId(42)).toBeNull();
  });
});

describe("authorization fact resolution", () => {
  it("fails closed when the membership is absent, foreign, or not the one resolved", async () => {
    for (const world of [
      { ...emptyWorld(), membership: null },
      { ...emptyWorld(), membership: membershipDocument({ orgId: ORG_B }) },
      {
        ...emptyWorld(),
        membership: membershipDocument({ userId: "userB" as UserId }),
      },
    ]) {
      const { result } = await facts(world);
      expect(result).toEqual({ ok: false, reason: "INACTIVE_MEMBERSHIP" });
    }

    const { result } = await facts(emptyWorld(), {
      membershipId: "membershipB" as MembershipId,
    });
    expect(result).toEqual({ ok: false, reason: "INACTIVE_MEMBERSHIP" });
  });

  it("grants only through an active role of this tenant, read exactly", async () => {
    const world = grantingWorld("receiving.receipt.post");
    const { result, calls } = await facts(world, {
      targetWarehouseId: WAREHOUSE,
    });
    expect(result.ok && result.facts.granted).toBe(true);
    // The grant read is the exact triple, not an enumeration of the role.
    expect(
      calls.filter(({ method }) => method === "findRolePermission"),
    ).toEqual([
      {
        method: "findRolePermission",
        input: {
          orgId: ORG_A,
          roleId: ROLE,
          permissionCode: "receiving.receipt.post",
        },
      },
    ]);

    // No grant row for the declared code.
    const other = await facts(grantingWorld("admin.audit.read"), {
      targetWarehouseId: WAREHOUSE,
    });
    expect(other.result.ok && other.result.facts.granted).toBe(false);
  });

  it("ignores an archived role and a role that is not this tenant's", async () => {
    const archived = grantingWorld("receiving.receipt.post");
    const [role] = archived.roles;
    archived.roles = [{ ...role!, status: "ARCHIVED" }];
    expect((await facts(archived)).result).toMatchObject({
      ok: true,
      facts: { granted: false },
    });

    // The Convex adapter answers `null` for another tenant's role, because its
    // read is followed by an `orgId` equality check.
    const foreign = grantingWorld("receiving.receipt.post");
    foreign.roles = [];
    expect((await facts(foreign)).result).toMatchObject({
      ok: true,
      facts: { granted: false },
    });
  });

  it("denies the whole decision when a returned row belongs elsewhere", async () => {
    const foreignGrant = grantingWorld("receiving.receipt.post");
    const [grant] = foreignGrant.roleGrants;
    foreignGrant.roleGrants = [{ ...grant!, orgId: ORG_B }];
    expect((await facts(foreignGrant)).result).toEqual({
      ok: false,
      reason: "NO_PERMISSION",
    });

    const foreignMembership = grantingWorld("receiving.receipt.post");
    const [grantB] = foreignMembership.roleGrants;
    foreignMembership.roleGrants = [
      { ...grantB!, membershipId: "membershipB" as MembershipId },
    ];
    expect((await facts(foreignMembership)).result).toEqual({
      ok: false,
      reason: "NO_PERMISSION",
    });

    const foreignRole = grantingWorld("receiving.receipt.post");
    const [roleRow] = foreignRole.roles;
    foreignRole.roles = [{ ...roleRow!, orgId: ORG_B }];
    expect((await facts(foreignRole)).result).toEqual({
      ok: false,
      reason: "NO_PERMISSION",
    });

    const foreignPermission = grantingWorld("receiving.receipt.post");
    const [rp] = foreignPermission.rolePermissions;
    foreignPermission.rolePermissions = [{ ...rp!, orgId: ORG_B }];
    expect((await facts(foreignPermission)).result).toEqual({
      ok: false,
      reason: "NO_PERMISSION",
    });
  });

  it("refuses a role list longer than the bound rather than reading it", async () => {
    const world = grantingWorld("receiving.receipt.post");
    const [grant] = world.roleGrants;
    world.roleGrants = Array.from(
      { length: MEMBERSHIP_ROLE_LIMIT + 1 },
      (_unused, index) =>
        ({
          ...grant!,
          _id: `grant-${String(index)}`,
        }) as MembershipRoleDocument,
    );
    expect((await facts(world)).result).toEqual({
      ok: false,
      reason: "NO_PERMISSION",
    });
  });

  it("asks for warehouse scope only for a scoped membership, as an exact row", async () => {
    const scoped = grantingWorld("receiving.receipt.post");
    scoped.scope = stored<MembershipWarehouseDocument>("scopeA", {
      orgId: ORG_A,
      membershipId: MEMBERSHIP,
      warehouseId: WAREHOUSE,
    });
    const inScope = await facts(scoped, { targetWarehouseId: WAREHOUSE });
    expect(inScope.result.ok && [...inScope.result.facts.warehouseIds]).toEqual(
      [WAREHOUSE],
    );

    // A scope row belonging to another tenant is not this membership's scope.
    const foreign = grantingWorld("receiving.receipt.post");
    foreign.scope = stored<MembershipWarehouseDocument>("scopeB", {
      orgId: ORG_B,
      membershipId: MEMBERSHIP,
      warehouseId: WAREHOUSE,
    });
    const denied = await facts(foreign, { targetWarehouseId: WAREHOUSE });
    expect(denied.result.ok && [...denied.result.facts.warehouseIds]).toEqual(
      [],
    );

    // An organization-wide membership needs no scope row, and none is read.
    const orgWide = grantingWorld("receiving.receipt.post");
    orgWide.membership = membershipDocument({ scopeMode: "ORG_WIDE" });
    const wide = await facts(orgWide, { targetWarehouseId: WAREHOUSE });
    expect(
      wide.calls.some(({ method }) => method === "findMembershipWarehouse"),
    ).toBe(false);
  });

  it("treats an absent, disabled, or foreign entitlement row as disabled", async () => {
    const key = "SERIAL_TRACKING";
    const absent = await facts(grantingWorld("receiving.receipt.post"), {
      entitlementKey: key,
      targetWarehouseId: WAREHOUSE,
    });
    expect(absent.result).toMatchObject({
      ok: true,
      facts: { entitlementRequired: true, entitlementEnabled: false },
    });

    for (const overrides of [
      { enabled: false },
      { enabled: true, orgId: ORG_B },
      { enabled: true, key: "OTHER" },
    ]) {
      const world = grantingWorld("receiving.receipt.post");
      world.entitlement = stored<EntitlementDocument>("ent", {
        orgId: ORG_A,
        key,
        ...overrides,
      });
      const result = await facts(world, {
        entitlementKey: key,
        targetWarehouseId: WAREHOUSE,
      });
      expect(result.result).toMatchObject({
        ok: true,
        facts: { entitlementEnabled: false },
      });
    }

    const world = grantingWorld("receiving.receipt.post");
    world.entitlement = stored<EntitlementDocument>("ent", {
      orgId: ORG_A,
      key,
      enabled: true,
    });
    expect((await facts(world, { entitlementKey: key })).result).toMatchObject({
      ok: true,
      facts: { entitlementEnabled: true },
    });
  });

  it("reads step-up evidence only when the permission needs it", async () => {
    const world = grantingWorld("receiving.receipt.post");
    const { calls } = await facts(world, { targetWarehouseId: WAREHOUSE });
    expect(
      calls.some(({ method }) => method === "listRecentSessionEvents"),
    ).toBe(false);

    const stepUp = grantingWorld("masterData.warehouse.manage");
    const asked = await facts(stepUp, { permission: WAREHOUSE_MANAGE });
    expect(
      asked.calls.find(({ method }) => method === "listRecentSessionEvents")
        ?.input,
    ).toEqual({
      orgId: ORG_A,
      userId: USER,
      notBefore: NOW - STEP_UP_MAX_AGE_MS,
      limit: STEP_UP_EVENT_LIMIT,
    });
  });

  it("takes the freshest usable reverification and ignores the rest", async () => {
    const sessionEvent = (
      overrides: Partial<SessionsAuditDocument>,
    ): SessionsAuditDocument =>
      stored<SessionsAuditDocument>(`session-${String(Math.random())}`, {
        orgId: ORG_A,
        userId: USER,
        eventType: "STEP_UP_VERIFIED",
        occurredAt: NOW - 1_000,
        reverifiedAt: NOW - 1_000,
        outcome: "ALLOWED",
        ...overrides,
      });

    const world = grantingWorld("masterData.warehouse.manage");
    world.sessionEvents = [
      sessionEvent({ occurredAt: NOW - 5_000, reverifiedAt: NOW - 5_000 }),
      sessionEvent({ occurredAt: NOW - 2_000, reverifiedAt: NOW - 2_000 }),
      // Ignored: a future stamp, a denied step-up, another actor, another tenant,
      // an event that is not a step-up, and one outside the freshness window.
      sessionEvent({ occurredAt: NOW, reverifiedAt: NOW + 60_000 }),
      sessionEvent({ eventType: "STEP_UP_DENIED", reverifiedAt: NOW }),
      sessionEvent({ outcome: "DENIED", reverifiedAt: NOW }),
      sessionEvent({ userId: "userB" as UserId, reverifiedAt: NOW }),
      sessionEvent({ orgId: ORG_B, reverifiedAt: NOW }),
      sessionEvent({ eventType: "SIGN_IN", reverifiedAt: NOW }),
      sessionEvent({
        occurredAt: NOW - STEP_UP_MAX_AGE_MS - 1,
        reverifiedAt: NOW - STEP_UP_MAX_AGE_MS - 1,
      }),
    ];

    const { result } = await facts(world, { permission: WAREHOUSE_MANAGE });
    expect(result.ok && result.facts.reverifiedAt).toBe(NOW - 2_000);

    const none = grantingWorld("masterData.warehouse.manage");
    none.sessionEvents = [sessionEvent({ reverifiedAt: NOW + 1 })];
    const empty = await facts(none, { permission: WAREHOUSE_MANAGE });
    expect(empty.result.ok && empty.result.facts.reverifiedAt).toBeUndefined();
  });
});

describe("context policy facts", () => {
  it("keeps the four booleans and the maker, and drops everything else", () => {
    expect(
      sanitizeAuthorizationPolicyFacts({
        thresholdExceeded: true,
        thresholdApproved: false,
        approvalSatisfied: true,
        makerUserId: "userB",
        permissionCode: "admin.organization.update",
        extra: "ignored",
      }),
    ).toEqual({
      thresholdExceeded: true,
      thresholdApproved: false,
      approvalSatisfied: true,
      makerUserId: "userB",
    });
  });

  it("refuses truthy values, padded IDs, and anything that is not an object", () => {
    expect(
      sanitizeAuthorizationPolicyFacts({
        thresholdExceeded: "yes",
        approvalSatisfied: 1,
        makerUserId: " userB",
      }),
    ).toEqual({});
    for (const value of [null, undefined, 7, "facts", [], () => ({})]) {
      expect(sanitizeAuthorizationPolicyFacts(value)).toEqual({});
    }
  });
});

describe("the decision", () => {
  const baseFacts = (
    overrides: Partial<AuthorizationFacts> = {},
  ): AuthorizationFacts => ({
    membership: membershipDocument(),
    granted: true,
    warehouseIds: new Set([WAREHOUSE]),
    entitlementRequired: false,
    entitlementEnabled: false,
    ...overrides,
  });

  it("does not let a warehouse steer an organization-wide decision", () => {
    // `admin.audit.read` is ORG-scoped: the actor has no scope row for the
    // warehouse it named, and the decision is unaffected either way.
    expect(
      decideAuthorization({
        permission: AUDIT_READ,
        actorUserId: USER,
        facts: baseFacts({ warehouseIds: new Set() }),
        policy: {},
        targetWarehouseId: WAREHOUSE,
        now: NOW,
      }),
    ).toMatchObject({ allowed: true });
  });

  it("denies a warehouse permission with no server-revalidated warehouse", () => {
    expect(
      decideAuthorization({
        permission: RECEIPT_POST,
        actorUserId: USER,
        facts: baseFacts(),
        policy: {},
        now: NOW,
      }),
    ).toMatchObject({ allowed: false, reason: "OUT_OF_WAREHOUSE_SCOPE" });
  });

  it("passes threshold, maker-checker, and step-up facts to the evaluator", () => {
    const decide = (
      permissionDefinition: typeof TASK_OVERRIDE,
      policy: Parameters<typeof decideAuthorization>[0]["policy"],
      factOverrides: Partial<AuthorizationFacts> = {},
    ) =>
      decideAuthorization({
        permission: permissionDefinition,
        actorUserId: USER,
        facts: baseFacts(factOverrides),
        policy,
        targetWarehouseId: WAREHOUSE,
        now: NOW,
      });

    expect(decide(TASK_OVERRIDE, {})).toMatchObject({
      allowed: false,
      reason: "THRESHOLD_EXCEEDED",
    });
    expect(decide(TASK_OVERRIDE, { thresholdExceeded: false })).toMatchObject({
      allowed: true,
    });
    expect(
      decide(TASK_OVERRIDE, {
        thresholdExceeded: true,
        thresholdApproved: true,
      }),
    ).toMatchObject({ allowed: true });

    expect(
      decide(STATUS_APPROVE, {
        thresholdExceeded: false,
        approvalSatisfied: true,
        makerUserId: USER,
      }),
    ).toMatchObject({ allowed: false, reason: "APPROVAL_REQUIRED" });
    expect(
      decide(STATUS_APPROVE, { approvalSatisfied: true, makerUserId: "userB" }),
    ).toMatchObject({ allowed: true });

    expect(
      decideAuthorization({
        permission: WAREHOUSE_MANAGE,
        actorUserId: USER,
        facts: baseFacts({ reverifiedAt: NOW - STEP_UP_MAX_AGE_MS - 1 }),
        policy: {},
        now: NOW,
      }),
    ).toMatchObject({ allowed: false, reason: "REVERIFICATION_REQUIRED" });
    expect(
      decideAuthorization({
        permission: WAREHOUSE_MANAGE,
        actorUserId: USER,
        facts: baseFacts({ reverifiedAt: NOW - 1 }),
        policy: {},
        now: NOW,
      }),
    ).toMatchObject({ allowed: true });
  });

  it("denies outside the membership's effective period", () => {
    for (const membership of [
      membershipDocument({ effectiveFrom: NOW + 1 }),
      membershipDocument({ effectiveFrom: 0, effectiveTo: NOW }),
      membershipDocument({ status: "SUSPENDED" }),
    ]) {
      expect(
        decideAuthorization({
          permission: AUDIT_READ,
          actorUserId: USER,
          facts: baseFacts({ membership }),
          policy: {},
          now: NOW,
        }),
      ).toMatchObject({ allowed: false, reason: "INACTIVE_MEMBERSHIP" });
    }
  });

  it("denies a disabled entitlement even for a granted permission", () => {
    expect(
      decideAuthorization({
        permission: AUDIT_READ,
        actorUserId: USER,
        facts: baseFacts({
          entitlementRequired: true,
          entitlementEnabled: false,
        }),
        policy: {},
        now: NOW,
      }),
    ).toMatchObject({ allowed: false, reason: "ENTITLEMENT_DISABLED" });
  });
});

describe("authorization audit and denial payloads", () => {
  it("tells a caller nothing but the request to quote", () => {
    const denial = toPublicAuthorizationDenial(REQUEST_ID);
    expect(denial).toEqual({
      kind: "AUTHORIZATION_DENIED",
      code: AUTHORIZATION_DENIAL_CODE,
      requestId: REQUEST_ID,
      message: expect.stringContaining("request ID"),
    });
    // No reason, no permission, no warehouse, no actor: the closed reason is
    // audit-only (`INV-0002-07`).
    const serialized = JSON.stringify(denial);
    for (const leak of [
      "NO_PERMISSION",
      "OUT_OF_WAREHOUSE_SCOPE",
      "receiving.receipt.post",
      WAREHOUSE,
      USER,
      ORG_A,
    ]) {
      expect(serialized).not.toContain(leak);
    }
    expect(Object.isFrozen(denial)).toBe(true);
  });

  it("records the attempt, its reason, and no payload", () => {
    const row = authorizationAuditRow({
      requestId: REQUEST_ID,
      occurredAt: NOW,
      actorUserId: USER,
      permissionCode: "receiving.receipt.post",
      entityTable: "warehouses",
      entityId: WAREHOUSE,
      warehouseId: WAREHOUSE,
      outcome: "DENIED",
      denialReason: "OUT_OF_WAREHOUSE_SCOPE",
    });

    expect(row).toEqual({
      occurredAt: NOW,
      actorKind: "USER",
      actorUserId: USER,
      action: "receiving.receipt.post",
      permissionCode: "receiving.receipt.post",
      entityTable: "warehouses",
      entityId: WAREHOUSE,
      warehouseId: WAREHOUSE,
      outcome: "DENIED",
      denialReason: "OUT_OF_WAREHOUSE_SCOPE",
      requestId: REQUEST_ID,
    });
    expect(row).not.toHaveProperty("changes");
    expect(row).not.toHaveProperty("orgId");
    expect(
      authorizationAuditRow({
        requestId: REQUEST_ID,
        occurredAt: NOW,
        actorUserId: USER,
        permissionCode: "admin.audit.read",
        entityTable: "auditEvents",
        outcome: "ALLOWED",
      }),
    ).not.toHaveProperty("denialReason");
  });

  it("appends through the tenant accessor, and only appends", async () => {
    const fixture = createTenantStoragePortFixture();
    const tenantDb = createTenantDocumentAccess(
      { orgId: ORG_A, requestId: REQUEST_ID },
      fixture.port,
    );

    await appendAuthorizationAudit(tenantDb, {
      requestId: REQUEST_ID,
      occurredAt: NOW,
      actorUserId: USER,
      permissionCode: "admin.audit.read",
      entityTable: "auditEvents",
      outcome: "ALLOWED",
    });

    expect(fixture.mutationCalls().map(({ method }) => method)).toEqual([
      "insert",
    ]);
    expect(fixture.callsTo("insert")[0]).toMatchObject({
      table: "auditEvents",
      // The tenant is stamped by the accessor, never supplied by the caller.
      payload: { orgId: ORG_A, outcome: "ALLOWED" },
    });
  });
});
