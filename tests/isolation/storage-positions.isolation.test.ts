import type { GenericMutationCtx } from "convex/server";
import { describe, expect, it } from "vitest";

import type { DataModel } from "../../convex/schema";
import { createStorageBuilding } from "../../convex/storageLayouts/writes";
import {
  createStoragePosition,
  createStorageZone,
  resolveStorageAddress,
  updateStoragePosition,
} from "../../convex/storageLayouts/zones";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";
async function createPlannerWorld() {
  const world = await createConvexTenantWorld();
  await seedConvexAuthorization(world, { roleA: "ORG_ADMIN" });
  return world;
}

interface RuntimeFunction {
  readonly _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
}

const identity = (org: "a" | "b") => ({
  subject: "user_fixture_a",
  org_id: `org_fixture_${org}`,
});

async function callAs(
  world: ConvexTenantWorld,
  org: "a" | "b",
  fn: unknown,
  args: unknown,
): Promise<Record<string, unknown>> {
  return (await world.t
    .withIdentity(identity(org))
    .run(async (ctx) =>
      (fn as RuntimeFunction)._handler(
        ctx as GenericMutationCtx<DataModel>,
        args,
      ),
    )) as Record<string, unknown>;
}

function value(outcome: Record<string, unknown>): Record<string, unknown> {
  expect(outcome["ok"], JSON.stringify(outcome)).toBe(true);
  return outcome["value"] as Record<string, unknown>;
}

describe("storage positions are tenant and warehouse confined", () => {
  it("does not resolve or mutate another tenant's leaf identity", async () => {
    const world = await createPlannerWorld();
    const building = value(
      await callAs(world, "a", createStorageBuilding, {
        warehouseId: world.warehouses.alphaA,
        requestId: "isolation-building-a",
        code: "ISOLATED",
        name: "Tenant A storage",
        widthMm: 12_000,
        depthMm: 10_000,
        defaultFloorHeightMm: 4_000,
        floorCount: 1,
      }),
    );
    const area = value(
      await callAs(world, "a", createStorageZone, {
        warehouseId: world.warehouses.alphaA,
        buildingId: building["documentId"],
        floorNumber: 1,
        requestId: "isolation-area-a",
        label: "BULK-A",
        mode: "FLOOR_POSITIONS",
        xMm: 0,
        yMm: 0,
        widthMm: 8_000,
        depthMm: 6_000,
        maxStackHeightMm: 4_000,
      }),
    );
    const position = value(
      await callAs(world, "a", createStoragePosition, {
        warehouseId: world.warehouses.alphaA,
        zoneId: area["documentId"],
        requestId: "isolation-position-a",
        code: "P-12",
        label: "P-12",
        xMm: 1_000,
        yMm: 1_000,
        widthMm: 2_000,
        depthMm: 2_000,
      }),
    );

    const foreignRead = value(
      await callAs(world, "b", resolveStorageAddress, {
        warehouseId: world.warehouses.alphaB,
        scan: "ISOLATED-F01-Z01-P-12",
      }),
    );
    expect(foreignRead).toEqual({ found: false });

    const foreignWrite = value(
      await callAs(world, "b", updateStoragePosition, {
        warehouseId: world.warehouses.alphaB,
        positionId: position["documentId"],
        requestId: "isolation-position-b",
        label: "stolen",
        xMm: 2_000,
        yMm: 2_000,
        widthMm: 2_000,
        depthMm: 2_000,
      }),
    );
    expect(foreignWrite).toMatchObject({
      written: false,
      error: { code: "NOT_FOUND" },
    });
  });
  it("refuses unauthenticated planner writes", async () => {
    const world = await createPlannerWorld();
    await expect(
      world.t.run(async (ctx) =>
        (createStorageBuilding as unknown as RuntimeFunction)._handler(ctx, {
          warehouseId: world.warehouses.alphaA,
          requestId: "anonymous-create",
          code: "NO-AUTH",
          name: "Unauthorized",
          widthMm: 12000,
          depthMm: 10000,
          defaultFloorHeightMm: 4000,
          floorCount: 1,
        }),
      ),
    ).rejects.toMatchObject({ data: { code: "ANONYMOUS" } });
    const buildings = await world.t.run((ctx) =>
      ctx.db.query("storageBuildings").collect(),
    );
    expect(buildings).toEqual([]);
  });
});
