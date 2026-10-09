import type { GenericQueryCtx } from "convex/server";
import { describe, expect, it } from "vitest";

import { readCurrent } from "../../convex/workspace/current";
import { NAVIGATION_PERMISSION_CODES } from "../../convex/model/authorization/navigationPermissions";
import { DEFAULT_ROLES } from "../../convex/lib/permissions";
import type { DataModel } from "../../convex/schema";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
} from "../fixtures/convex-tenant-world";

interface RuntimeQuery {
  readonly _handler: (
    ctx: GenericQueryCtx<DataModel>,
    args: Record<string, never>,
  ) => Promise<unknown>;
}

const runtimeQuery = readCurrent as unknown as RuntimeQuery;

function valueOf(outcome: unknown) {
  const envelope = outcome as {
    readonly ok: boolean;
    readonly value?: unknown;
  };
  if (!envelope.ok)
    throw new Error(`workspace denied: ${JSON.stringify(outcome)}`);
  return envelope.value as {
    readonly organization: { readonly id: string; readonly name: string };
    readonly warehouses: readonly {
      readonly id: string;
      readonly code: string;
      readonly name: string;
    }[];
    readonly navigationPermissions: readonly string[];
    readonly complete: boolean;
  };
}

describe("current workspace query", () => {
  it("returns only the explicitly scoped active warehouses", async () => {
    const world = await createConvexTenantWorld();
    await seedConvexAuthorization(world);

    const outcome = await world.t
      .withIdentity({ subject: "user_fixture_a", org_id: "org_fixture_a" })
      .run(async (ctx) => await runtimeQuery._handler(ctx, {}));

    const value = valueOf(outcome);
    expect(value).toEqual({
      organization: { id: world.orgA, name: "Tenant A" },
      warehouses: [
        {
          id: world.warehouses.alphaA,
          code: "ALPHA",
          name: "Warehouse ALPHA",
        },
      ],
      navigationPermissions: expect.any(Array),
      complete: true,
    });
    const supervisor = DEFAULT_ROLES.find(({ key }) => key === "SUPERVISOR");
    expect(value.navigationPermissions).toEqual(
      NAVIGATION_PERMISSION_CODES.filter((code) =>
        supervisor?.permissionCodes.includes(code),
      ),
    );
  });

  it("returns every active warehouse for an organization-wide membership", async () => {
    const world = await createConvexTenantWorld();
    await seedConvexAuthorization(world);

    const outcome = await world.t
      .withIdentity({ subject: "user_fixture_a", org_id: "org_fixture_b" })
      .run(async (ctx) => await runtimeQuery._handler(ctx, {}));

    const value = valueOf(outcome);
    expect(value.organization.id).toBe(world.orgB);
    expect(value.warehouses.map(({ id }) => id)).toEqual([
      world.warehouses.alphaB,
    ]);
    expect(value.warehouses.map(({ id }) => id)).not.toContain(
      world.warehouses.alphaA,
    );
    const administrator = DEFAULT_ROLES.find(({ key }) => key === "ORG_ADMIN");
    expect(value.navigationPermissions).toEqual(
      NAVIGATION_PERMISSION_CODES.filter((code) =>
        administrator?.permissionCodes.includes(code),
      ),
    );
  });
});
