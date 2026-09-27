import { describe, expect, it } from "vitest";
import type { GenericMutationCtx } from "convex/server";
import type { DataModel } from "../../convex/schema";
import {
  apply,
  preflight,
  rollback,
} from "../../convex/storageLayouts/pdImport";
import {
  pdApprovedPlan,
  PD_REVISION,
} from "../../convex/model/storageLayout/pdApprovedPlan";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
} from "../fixtures/convex-tenant-world";

async function setup() {
  const world = await createConvexTenantWorld();
  await seedConvexAuthorization(world, { roleA: "ORG_ADMIN" });
  const target = await world.t.run(async (ctx) => {
    await ctx.db.patch("organizations", world.orgA, {
      clerkOrganizationId: "org_3Je6JpUXsjAZcHyLD5lodjFdLmQ",
    });
    await ctx.db.patch("warehouses", world.warehouses.alphaA, {
      code: "TG-OPT",
    });
    const warehouseId = world.warehouses.alphaA;
    const stamps = {
      createdAt: 1,
      updatedAt: 1,
      createdByUserId: world.userA,
      updatedByUserId: world.userA,
    };
    const buildingId = await ctx.db.insert("storageBuildings", {
      orgId: world.orgA,
      warehouseId,
      code: "PD",
      name: "PD",
      widthMm: 60000,
      depthMm: 12000,
      defaultFloorHeightMm: 5000,
      floorCount: 1,
      totalHeightMm: 5000,
      grossAreaSqMm: 720000000,
      usableAreaSqMm: 720000000,
      reservedAreaSqMm: 0,
      version: 4,
      status: "DRAFT",
      ...stamps,
    });
    const floorId = await ctx.db.insert("storageFloors", {
      orgId: world.orgA,
      warehouseId,
      buildingId,
      floorNumber: 1,
      version: 2,
      grossAreaSqMm: 720000000,
      usableAreaSqMm: 720000000,
      reservedAreaSqMm: 0,
      updatedAt: 1,
      updatedByUserId: world.userA,
    });
    for (const cell of pdApprovedPlan().cells) {
      const locationId = await ctx.db.insert("locations", {
        orgId: world.orgA,
        warehouseId,
        code: cell.code,
        locationType: "FLOOR_BLOCK",
        status: "ACTIVE",
      });
      const zoneId = await ctx.db.insert("storageZones", {
        ...cell,
        orgId: world.orgA,
        warehouseId,
        buildingId,
        floorId,
        locationId,
        label: cell.code,
        qrValue: `qr:${locationId}`,
        maxStackHeightMm: 650,
        status: "ACTIVE",
        ...stamps,
      });
      await ctx.db.insert("storagePositions", {
        orgId: world.orgA,
        warehouseId,
        buildingId,
        floorId,
        locationId,
        zoneId,
        code: cell.code,
        label: cell.code,
        qrValue: `qr:${locationId}`,
        kind: "DEFAULT",
        isDefault: true,
        status: "ACTIVE",
        ...stamps,
      });
    }
    return { warehouseId, buildingId };
  });
  const identity = {
    subject: "user_fixture_a",
    org_id: "org_3Je6JpUXsjAZcHyLD5lodjFdLmQ",
  };
  async function call<T>(
    fn: unknown,
    args: unknown,
    otherIdentity = identity,
  ): Promise<T> {
    const result = await world.t.withIdentity(otherIdentity).run((ctx) =>
      (
        fn as {
          _handler: (
            ctx: GenericMutationCtx<DataModel>,
            args: unknown,
          ) => Promise<{ ok: boolean; value: T }>;
        }
      )._handler(ctx as GenericMutationCtx<DataModel>, args),
    );
    if (!result.ok) throw new Error("DENIED");
    return result.value;
  }
  const read = () =>
    call<{
      blocked: boolean;
      digest: string;
      backup: {
        legacyZones: { _id: string; code: string }[];
        legacyPositions: { _id: string }[];
        legacyLocations: { _id: string }[];
        building: { version: number };
        zones: {
          _id: string;
          code: string;
          qrValue: string;
          xMm: number;
          yMm: number;
          widthMm: number;
          depthMm: number;
        }[];
        positions: {
          zoneId: string;
          xMm: number;
          yMm: number;
          widthMm: number;
          depthMm: number;
        }[];
        locations: { _id: string }[];
      };
      plan: { usableAreaSqMm: number };
    }>(preflight, target);
  return { world, target, call, read };
}

async function addLegacy(w: Awaited<ReturnType<typeof setup>>) {
  await w.world.t.run(async (ctx) => {
    const zone = (await ctx.db.query("storageZones").collect())[0]!;
    const position = (await ctx.db.query("storagePositions").collect())[0]!;
    for (let i = 1; i <= 12; i++) {
      const code = `PD-L${i}`;
      const locationId = await ctx.db.insert("locations", {
        orgId: w.world.orgA,
        warehouseId: w.target.warehouseId,
        code,
        locationType: "FLOOR_BLOCK",
        status: "INACTIVE",
      });
      const { _id, _creationTime, ...zoneFields } = zone;
      void _id;
      void _creationTime;
      const zoneId = await ctx.db.insert("storageZones", {
        ...zoneFields,
        code,
        locationId,
        status: "INACTIVE",
        mode: "FLOOR_POSITIONS",
      });
      const { _id: pid, _creationTime: pt, ...positionFields } = position;
      void pid;
      void pt;
      await ctx.db.insert("storagePositions", {
        ...positionFields,
        code,
        locationId,
        zoneId,
        status: "INACTIVE",
      });
    }
  });
}

describe("PD guarded import", () => {
  it("preserves all approved inactive groups and their relationships on import and rollback", async () => {
    const w = await setup();
    await addLegacy(w);
    const before = await w.read();
    expect(before.backup.legacyZones).toHaveLength(12);
    expect(before.backup.legacyPositions).toHaveLength(12);
    const result = await w.call<{ afterDigest: string }>(apply, {
      ...w.target,
      revision: PD_REVISION,
      expectedDigest: before.digest,
    });
    const after = await w.read();
    for (const key of [
      "legacyZones",
      "legacyPositions",
      "legacyLocations",
    ] as const)
      expect(after.backup[key]).toEqual(before.backup[key]);
    await w.call(rollback, {
      ...w.target,
      expectedAfterDigest: result.afterDigest,
      backup: before.backup,
    });
    expect((await w.read()).digest).toBe(before.digest);
  });
  it("refuses unknown inactive groups and active positions inside inactive groups", async () => {
    const w = await setup();
    await addLegacy(w);
    const before = await w.read();
    const id = before.backup.legacyZones[0]!._id;
    await w.world.t.run((ctx) =>
      ctx.db.patch("storageZones", id as never, { code: "PD-UNKNOWN" }),
    );
    await expect(w.read()).rejects.toThrow("INTERNAL_ERROR");
    await w.world.t.run((ctx) =>
      ctx.db.patch("storageZones", id as never, {
        code: before.backup.legacyZones[0]!.code,
      }),
    );
    await w.world.t.run((ctx) =>
      ctx.db.patch(
        "storagePositions",
        before.backup.legacyPositions[0]!._id as never,
        { status: "ACTIVE" },
      ),
    );
    await expect(w.read()).rejects.toThrow("INTERNAL_ERROR");
  });
  it("includes legacy changes in the transaction digest", async () => {
    const w = await setup();
    await addLegacy(w);
    const before = await w.read();
    await w.world.t.run((ctx) =>
      ctx.db.patch("storageZones", before.backup.legacyZones[0]!._id as never, {
        label: "Changed after backup",
      }),
    );
    await expect(
      w.call(apply, {
        ...w.target,
        revision: PD_REVISION,
        expectedDigest: before.digest,
      }),
    ).rejects.toThrow("INTERNAL_ERROR");
  });
  it("imports once, preserves IDs/QR/status/height and safely rolls back", async () => {
    const w = await setup(),
      before = await w.read();
    expect(before.blocked).toBe(false);
    const applied = await w.call<{ afterDigest: string }>(apply, {
      ...w.target,
      revision: PD_REVISION,
      expectedDigest: before.digest,
    });
    const after = await w.read();
    expect(after.digest).toBe(applied.afterDigest);
    expect(after.backup.zones.map((z) => [z._id, z.qrValue])).toEqual(
      before.backup.zones.map((z) => [z._id, z.qrValue]),
    );
    expect(after.backup.locations).toEqual(before.backup.locations);
    for (const zone of after.backup.zones) {
      const position = after.backup.positions.find(
        (p) => p.zoneId === zone._id,
      )!;
      for (const field of ["xMm", "yMm", "widthMm", "depthMm"] as const)
        expect(position[field]).toBe(zone[field]);
    }
    expect(after.backup.building).toMatchObject({
      widthMm: 61500,
      depthMm: 11960,
      defaultFloorHeightMm: 5000,
      status: "DRAFT",
      version: 5,
      usableAreaSqMm: after.plan.usableAreaSqMm,
    });
    // The tenant boundary intentionally sanitizes handler exceptions.
    await expect(
      w.call(apply, {
        ...w.target,
        revision: PD_REVISION,
        expectedDigest: before.digest,
      }),
    ).rejects.toThrow("INTERNAL_ERROR");
    expect((await w.read()).digest).toBe(after.digest);
    await w.call(rollback, {
      ...w.target,
      expectedAfterDigest: applied.afterDigest,
      backup: before.backup,
    });
    expect((await w.read()).digest).toBe(before.digest);
  });
  it("rejects stale snapshots and does not partially write", async () => {
    const w = await setup(),
      before = await w.read();
    await w.world.t.run((ctx) =>
      ctx.db.patch("storageBuildings", w.target.buildingId, { version: 9 }),
    );
    const changed = await w.read();
    await expect(
      w.call(apply, {
        ...w.target,
        revision: PD_REVISION,
        expectedDigest: before.digest,
      }),
    ).rejects.toThrow("INTERNAL_ERROR");
    expect((await w.read()).digest).toBe(changed.digest);
  });
  it("rejects changed backup and later activity on rollback", async () => {
    const w = await setup(),
      before = await w.read();
    const result = await w.call<{ afterDigest: string }>(apply, {
      ...w.target,
      revision: PD_REVISION,
      expectedDigest: before.digest,
    });
    await expect(
      w.call(rollback, {
        ...w.target,
        expectedAfterDigest: result.afterDigest,
        backup: {
          ...before.backup,
          building: { ...before.backup.building, version: 999 },
        },
      }),
    ).rejects.toThrow("INTERNAL_ERROR");
    expect((await w.read()).digest).toBe(result.afterDigest);
    await w.world.t.run((ctx) =>
      ctx.db.patch("storageBuildings", w.target.buildingId, { version: 6 }),
    );
    await expect(
      w.call(rollback, {
        ...w.target,
        expectedAfterDigest: result.afterDigest,
        backup: before.backup,
      }),
    ).rejects.toThrow("INTERNAL_ERROR");
  });
  it("rejects a foreign tenant", async () => {
    const w = await setup();
    await expect(
      w.call(preflight, w.target, {
        subject: "user_fixture_a",
        org_id: "org_fixture_b",
      }),
    ).rejects.toThrow();
  });
  it("refuses missing/duplicate/unexpected codes", async () => {
    const w = await setup();
    await w.world.t.run(async (ctx) => {
      const zone = (await ctx.db.query("storageZones").collect())[0]!;
      await ctx.db.patch("storageZones", zone._id, { code: "PD-UNKNOWN" });
    });
    await expect(w.read()).rejects.toThrow("INTERNAL_ERROR");
  });
  it.each(["STORED", "RESERVED", "IN_TRANSIT"] as const)(
    "stops for %s stock before mutation",
    async (status) => {
      const w = await setup();
      await addLegacy(w);
      await w.world.t.run(async (ctx) => {
        const zone = (await ctx.db.query("storageZones").collect()).find((z) => z.status === "INACTIVE")!;
        const productId = await ctx.db.insert("finishedGoodsProducts", {
          orgId: w.world.orgA,
          warehouseId: w.target.warehouseId,
          sku: "TEST",
          name: "Test",
          unit: "piece",
          storageFormat: "PALLET",
          storageCondition: "dry",
          status: "ACTIVE",
          createdAt: 1,
          updatedAt: 1,
          createdByUserId: w.world.userA,
          updatedByUserId: w.world.userA,
        });
        const palletId = await ctx.db.insert("finishedGoodsPallets", {
          orgId: w.world.orgA,
          warehouseId: w.target.warehouseId,
          productId,
          code: "TEST",
          quantity: 1,
          status: status === "IN_TRANSIT" ? "AWAITING_PLACEMENT" : status,
          createdAt: 1,
          updatedAt: 1,
          createdByUserId: w.world.userA,
          updatedByUserId: w.world.userA,
        });
        const placementId = await ctx.db.insert("finishedGoodsPlacements", {
          orgId: w.world.orgA,
          warehouseId: w.target.warehouseId,
          buildingId: w.target.buildingId,
          floorId: zone.floorId,
          zoneId: zone._id,
          locationId: zone.locationId,
          positionCode: zone.code,
          qrValue: zone.qrValue,
          palletId,
          status: status === "IN_TRANSIT" ? "RELEASED" : status,
          xMm: 0,
          yMm: 0,
          zMm: 0,
          widthMm: 10,
          depthMm: 10,
          heightMm: 10,
          rotation: 0,
          createdAt: 1,
          updatedAt: 1,
          createdByUserId: w.world.userA,
          updatedByUserId: w.world.userA,
        });
        if (status === "IN_TRANSIT")
          await ctx.db.insert("finishedGoodsMoves", {
            orgId: w.world.orgA,
            warehouseId: w.target.warehouseId,
            palletId,
            sourcePlacementId: placementId,
            targetPlacementId: placementId,
            sourceUpdatedAt: 1,
            targetUpdatedAt: 1,
            palletUpdatedAt: 1,
            ownerUserId: w.world.userA,
            status: "IN_TRANSIT",
            createdAt: 1,
            updatedAt: 1,
            createdByUserId: w.world.userA,
            updatedByUserId: w.world.userA,
          });
      });
      const before = await w.read();
      expect(before.blocked).toBe(true);
      await expect(
        w.call(apply, {
          ...w.target,
          revision: PD_REVISION,
          expectedDigest: before.digest,
        }),
      ).rejects.toThrow("INTERNAL_ERROR");
      expect((await w.read()).digest).toBe(before.digest);
    },
  );
  it("rolls back all writes if a late transaction validation fails", async () => {
    const w = await setup();
    await w.world.t.run(async (ctx) => {
      const floor = (await ctx.db.query("storageFloors").collect())[0]!;
      for (let i = 0; i < 40; i++)
        await ctx.db.insert("storageFloorReservedBlocks", {
          orgId: w.world.orgA,
          warehouseId: w.target.warehouseId,
          buildingId: w.target.buildingId,
          floorId: floor._id,
          label: `old-${i}`,
          xMm: i * 10,
          yMm: 0,
          widthMm: 10,
          depthMm: 10,
          createdAt: 1,
          updatedAt: 1,
        });
    });
    const before = await w.read();
    await expect(
      w.call(apply, {
        ...w.target,
        revision: PD_REVISION,
        expectedDigest: before.digest,
      }),
    ).rejects.toThrow("INTERNAL_ERROR");
    expect((await w.read()).digest).toBe(before.digest);
  });
});
