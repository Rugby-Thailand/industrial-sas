import { expect, it } from "vitest";
import { createConvexAuthorizationLookups } from "../../convex/lib/authorizationLookupsConvex";
import {
  createPermissionGrants,
  grantedPermissionsAmong,
} from "../../convex/lib/navigationGrants";
import { createTenantDocumentAccess } from "../../convex/lib/tenantDb";
import { createMutationTenantStorage } from "../../convex/lib/tenantStorage";
import type { TenantFunctionContext } from "../../convex/lib/tenantFunctions";
import {
  createConvexTenantWorld,
  FIXTURE_REQUEST_ID,
} from "../fixtures/convex-tenant-world";
import { trackDocumentReads } from "../fixtures/document-reads";
import { seedFixtureAuthorization } from "../fixtures/policy-fixture-permissions";

it.each([true, false])(
  "stops permission reads at the first granting role (query memoization: %s)",
  async (memoize) => {
    const world = await createConvexTenantWorld();
    const seeded = await seedFixtureAuthorization(world);
    await world.t.run(async (ctx) => {
      for (const grant of await ctx.db.query("membershipRoles").collect()) {
        if (grant.membershipId === seeded.identities.membershipA)
          await ctx.db.delete("membershipRoles", grant._id);
      }
      for (let index = 0; index < 3; index++) {
        const roleId = await ctx.db.insert("roles", {
          orgId: world.orgA,
          key: `READ_COUNT_${index}`,
          name: `Read count ${index}`,
          status: "ACTIVE",
          seeded: false,
        });
        await ctx.db.insert("membershipRoles", {
          orgId: world.orgA,
          membershipId: seeded.identities.membershipA,
          grantedAt: 0,
          roleId,
        });
        await ctx.db.insert("rolePermissions", {
          orgId: world.orgA,
          roleId,
          permissionCode: "first",
        });
      }
      await ctx.db.insert("rolePermissions", {
        orgId: world.orgA,
        roleId: (
          await ctx.db
            .query("membershipRoles")
            .withIndex("by_orgId_membershipId_roleId", (q) =>
              q
                .eq("orgId", world.orgA)
                .eq("membershipId", seeded.identities.membershipA),
            )
            .collect()
        )[2]!.roleId,
        permissionCode: "last",
      });
      const tenant = {
        requestId: FIXTURE_REQUEST_ID,
        actor: (await ctx.db.get("users", world.userA))!,
        organization: (await ctx.db.get("organizations", world.orgA))!,
        membership: (await ctx.db.get(
          "memberships",
          seeded.identities.membershipA,
        ))!,
      };
      const { db, queries } = trackDocumentReads(ctx.db);
      const codes = ["first", "last", "missing", "first"];
      const result = memoize
        ? await createPermissionGrants(
            tenant,
            createConvexAuthorizationLookups(
              { db },
              FIXTURE_REQUEST_ID,
              undefined,
              true,
            ),
          )(codes)
        : await grantedPermissionsAmong(
            {
              tenant,
              tenantDb: createTenantDocumentAccess(
                { orgId: world.orgA, requestId: FIXTURE_REQUEST_ID },
                createMutationTenantStorage({ ...ctx, db }, FIXTURE_REQUEST_ID),
              ),
            } as TenantFunctionContext,
            codes,
          );
      expect(result).toEqual(["first", "last", "first"]);
      // First grants in one read; last and missing each need all three roles.
      // A repeated code reuses query facts but remains in the caller's result.
      expect(
        queries.filter((table) => table === "rolePermissions"),
      ).toHaveLength(memoize ? 7 : 8);
    });
  },
);
