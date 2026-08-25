import { convexTest } from "convex-test";
import type { GenericId } from "convex/values";

import { seedAuthorizationForOrganization } from "../../convex/lib/authorizationSeedConvex";
import { DEFAULT_ORGANIZATION_SETTINGS } from "../../convex/lib/organizationDefaults";
import { DEFAULT_ROLES } from "../../convex/lib/permissions";
import schema from "../../convex/schema";

const CONVEX_MODULE_ROOT: Record<string, () => Promise<unknown>> = {
  "../convex/_generated/server.js": () => Promise.resolve({}),
};

export type ConvexTestModuleMap = Record<string, () => Promise<unknown>>;

function harness(extraModules: ConvexTestModuleMap = {}) {
  return convexTest(schema, { ...CONVEX_MODULE_ROOT, ...extraModules });
}

export type ConvexTenantHarness = ReturnType<typeof harness>;

export const FIXTURE_REQUEST_ID = "req_01JBZ0000000000000000000";

export interface ConvexTenantWorld {
  readonly t: ConvexTenantHarness;
  readonly orgA: GenericId<"organizations">;
  readonly orgB: GenericId<"organizations">;

  readonly userA: GenericId<"users">;
  readonly warehouses: {
    readonly alphaA: GenericId<"warehouses">;
    readonly bravoA: GenericId<"warehouses">;
    readonly charlieA: GenericId<"warehouses">;
    readonly deltaA: GenericId<"warehouses">;
    readonly alphaB: GenericId<"warehouses">;
  };

  readonly vanishedWarehouse: GenericId<"warehouses">;
}

export async function createConvexTenantWorld(
  modules: ConvexTestModuleMap = {},
): Promise<ConvexTenantWorld> {
  const t = harness(modules);

  const seeded = await t.run(async (ctx) => {
    const orgA = await ctx.db.insert("organizations", {
      clerkOrganizationId: "org_fixture_a",
      name: "Tenant A",
      status: "ACTIVE",
      settings: DEFAULT_ORGANIZATION_SETTINGS,
    });
    const orgB = await ctx.db.insert("organizations", {
      clerkOrganizationId: "org_fixture_b",
      name: "Tenant B",
      status: "ACTIVE",
      settings: DEFAULT_ORGANIZATION_SETTINGS,
    });
    const userA = await ctx.db.insert("users", {
      clerkUserId: "user_fixture_a",
      displayName: "Fixture A",
      status: "ACTIVE",
    });

    const warehouse = async (
      orgId: GenericId<"organizations">,
      code: string,
      status: "ACTIVE" | "INACTIVE",
    ): Promise<GenericId<"warehouses">> =>
      await ctx.db.insert("warehouses", {
        orgId,
        code,
        name: `Warehouse ${code}`,
        status,
      });

    const alphaA = await warehouse(orgA, "ALPHA", "ACTIVE");
    const bravoA = await warehouse(orgA, "BRAVO", "ACTIVE");
    const charlieA = await warehouse(orgA, "CHARLIE", "ACTIVE");
    const deltaA = await warehouse(orgA, "DELTA", "INACTIVE");
    const alphaB = await warehouse(orgB, "ALPHA", "ACTIVE");

    const vanishedWarehouse = await warehouse(orgA, "GONE", "INACTIVE");
    await ctx.db.delete("warehouses", vanishedWarehouse);

    return {
      orgA,
      orgB,
      userA,
      warehouses: { alphaA, bravoA, charlieA, deltaA, alphaB },
      vanishedWarehouse,
    };
  });

  return { t, ...seeded };
}

export interface ConvexTenantIdentities {
  readonly membershipA: GenericId<"memberships">;
  readonly membershipB: GenericId<"memberships">;
  readonly scopeA: GenericId<"membershipWarehouses">;
  readonly scopeB: GenericId<"membershipWarehouses">;

  readonly sharedClerkMembershipId: string;
}

export async function seedConvexTenantIdentities(
  world: ConvexTenantWorld,
): Promise<ConvexTenantIdentities> {
  const sharedClerkMembershipId = "orgmem_fixture_shared";

  return await world.t.run(async (ctx) => {
    const membership = async (
      orgId: GenericId<"organizations">,
      scopeMode: "ORG_WIDE" | "WAREHOUSE_SCOPED",
    ): Promise<GenericId<"memberships">> =>
      await ctx.db.insert("memberships", {
        orgId,
        userId: world.userA,
        clerkMembershipId: sharedClerkMembershipId,
        status: "ACTIVE",
        scopeMode,
        effectiveFrom: 0,
      });

    const membershipA = await membership(world.orgA, "WAREHOUSE_SCOPED");
    const membershipB = await membership(world.orgB, "ORG_WIDE");

    const scopeA = await ctx.db.insert("membershipWarehouses", {
      orgId: world.orgA,
      membershipId: membershipA,
      warehouseId: world.warehouses.alphaA,
    });
    const scopeB = await ctx.db.insert("membershipWarehouses", {
      orgId: world.orgB,
      membershipId: membershipA,
      warehouseId: world.warehouses.alphaA,
    });

    return {
      membershipA,
      membershipB,
      scopeA,
      scopeB,
      sharedClerkMembershipId,
    };
  });
}

export async function storedWarehouse(
  world: ConvexTenantWorld,
  id: GenericId<"warehouses">,
): Promise<Record<string, unknown> | null> {
  return await world.t.run(async (ctx) => await ctx.db.get("warehouses", id));
}

export async function storedWarehouses(
  world: ConvexTenantWorld,
): Promise<readonly Record<string, unknown>[]> {
  return await world.t.run(
    async (ctx) => await ctx.db.query("warehouses").collect(),
  );
}

export interface ConvexAuthorizationWorld {
  readonly identities: ConvexTenantIdentities;
  readonly rolesA: ReadonlyMap<string, GenericId<"roles">>;
  readonly rolesB: ReadonlyMap<string, GenericId<"roles">>;
  readonly membershipRoleA: GenericId<"membershipRoles">;
  readonly membershipRoleB: GenericId<"membershipRoles">;
  readonly roleKeyA: string;
  readonly roleKeyB: string;
}

export async function seedConvexAuthorization(
  world: ConvexTenantWorld,
  options: { readonly roleA?: string; readonly roleB?: string } = {},
): Promise<ConvexAuthorizationWorld> {
  const roleKeyA = options.roleA ?? "SUPERVISOR";
  const roleKeyB = options.roleB ?? "ORG_ADMIN";
  const identities = await seedConvexTenantIdentities(world);

  const seeded = await world.t.run(async (ctx) => {
    await seedAuthorizationForOrganization(ctx, world.orgA);
    await seedAuthorizationForOrganization(ctx, world.orgB);

    const rolesOf = async (
      orgId: GenericId<"organizations">,
    ): Promise<Record<string, GenericId<"roles">>> => {
      const entries: Record<string, GenericId<"roles">> = {};
      for (const role of DEFAULT_ROLES) {
        const row = await ctx.db
          .query("roles")
          .withIndex("by_orgId_key", (query) =>
            query.eq("orgId", orgId).eq("key", role.key),
          )
          .unique();
        if (row === null) throw new Error(`missing seeded role ${role.key}`);
        entries[role.key] = row._id;
      }
      return entries;
    };

    const rolesA = await rolesOf(world.orgA);
    const rolesB = await rolesOf(world.orgB);
    const grant = async (
      orgId: GenericId<"organizations">,
      membershipId: GenericId<"memberships">,
      roleId: GenericId<"roles">,
    ): Promise<GenericId<"membershipRoles">> =>
      await ctx.db.insert("membershipRoles", {
        orgId,
        membershipId,
        roleId,
        grantedAt: 0,
      });

    return {
      rolesA,
      rolesB,
      membershipRoleA: await grant(
        world.orgA,
        identities.membershipA,
        rolesA[roleKeyA]!,
      ),
      membershipRoleB: await grant(
        world.orgB,
        identities.membershipB,
        rolesB[roleKeyB]!,
      ),
    };
  });

  return {
    identities,
    roleKeyA,
    roleKeyB,
    rolesA: new Map(Object.entries(seeded.rolesA)),
    rolesB: new Map(Object.entries(seeded.rolesB)),
    membershipRoleA: seeded.membershipRoleA,
    membershipRoleB: seeded.membershipRoleB,
  };
}

export async function recordStepUp(
  world: ConvexTenantWorld,
  input: {
    readonly orgId: GenericId<"organizations">;
    readonly userId: GenericId<"users">;
    readonly occurredAt: number;
    readonly reverifiedAt: number;
    readonly eventType?:
      | "STEP_UP_VERIFIED"
      | "STEP_UP_DENIED"
      | "SIGN_IN"
      | "SIGN_OUT"
      | "ORGANIZATION_SWITCH"
      | "SESSION_REVOKED";
    readonly outcome?: "ALLOWED" | "DENIED";
  },
): Promise<GenericId<"sessionsAudit">> {
  return await world.t.run(
    async (ctx) =>
      await ctx.db.insert("sessionsAudit", {
        orgId: input.orgId,
        userId: input.userId,
        eventType: input.eventType ?? "STEP_UP_VERIFIED",
        occurredAt: input.occurredAt,
        reverifiedAt: input.reverifiedAt,
        outcome: input.outcome ?? "ALLOWED",
      }),
  );
}

export async function recordEntitlement(
  world: ConvexTenantWorld,
  input: {
    readonly orgId: GenericId<"organizations">;
    readonly key: string;
    readonly enabled: boolean;
  },
): Promise<GenericId<"entitlements">> {
  return await world.t.run(
    async (ctx) =>
      await ctx.db.insert("entitlements", {
        orgId: input.orgId,
        key: input.key,
        enabled: input.enabled,
      }),
  );
}

export async function recordDevice(
  world: ConvexTenantWorld,
  input: {
    readonly orgId: GenericId<"organizations">;
    readonly installationId: string;
    readonly label?: string;
  },
): Promise<GenericId<"devices">> {
  return await world.t.run(
    async (ctx) =>
      await ctx.db.insert("devices", {
        orgId: input.orgId,
        label: input.label ?? "Fixture handheld",
        deviceType: "HANDHELD",
        status: "ACTIVE",
        installationId: input.installationId,
      }),
  );
}

export async function storedAuditEvents(
  world: ConvexTenantWorld,
  orgId: GenericId<"organizations">,
): Promise<readonly Record<string, unknown>[]> {
  return await world.t.run(
    async (ctx) =>
      await ctx.db
        .query("auditEvents")
        .withIndex("by_orgId_occurredAt", (query) => query.eq("orgId", orgId))
        .order("desc")
        .take(50),
  );
}

export interface ConvexSecondActor {
  readonly userId: GenericId<"users">;
  readonly membershipId: GenericId<"memberships">;
  readonly clerkUserId: string;
}

export async function seedSecondActorForOrgA(
  world: ConvexTenantWorld,
  roleKey: string,
): Promise<ConvexSecondActor> {
  const clerkUserId = "user_fixture_a2";

  return await world.t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      clerkUserId,
      displayName: "Fixture A2",
      status: "ACTIVE",
    });
    const membershipId = await ctx.db.insert("memberships", {
      orgId: world.orgA,
      userId,
      clerkMembershipId: "orgmem_fixture_a2",
      status: "ACTIVE",

      scopeMode: "ORG_WIDE",
      effectiveFrom: 0,
    });

    const role = await ctx.db
      .query("roles")
      .withIndex("by_orgId_key", (query) =>
        query.eq("orgId", world.orgA).eq("key", roleKey),
      )
      .unique();
    if (role === null) throw new Error(`missing seeded role ${roleKey}`);

    await ctx.db.insert("membershipRoles", {
      orgId: world.orgA,
      membershipId,
      roleId: role._id,
      grantedAt: 0,
    });

    return { userId, membershipId, clerkUserId };
  });
}
