import { expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
} from "../fixtures/convex-tenant-world";

async function setup() {
  const world = await createConvexTenantWorld({
    "../convex/customers/linking.ts": () =>
      import("../../convex/customers/linking"),
  });
  const auth = await seedConvexAuthorization(world, { roleA: "ORG_ADMIN" });
  const actor = world.t.withIdentity({
    subject: "user_fixture_a",
    org_id: "org_fixture_a",
  });

  function insertScan(
    warehouseId: Id<"warehouses">,
    createdAt: number,
    customer?: string,
    indexed = false,
  ) {
    return world.t.run((ctx) =>
      ctx.db.insert("finishedGoodsJobScans", {
        orgId:
          warehouseId === world.warehouses.alphaB ? world.orgB : world.orgA,
        warehouseId,
        factoryOrder: "FO-1",
        productBarcodeText: "BC-1",
        locationText: "DOCK-1",
        mapped: false,
        source: "AI",
        version: 1,
        createdAt,
        createdByUserId: world.userA,
        updatedAt: createdAt,
        updatedByUserId: world.userA,
        ...(customer === undefined ? {} : { customer }),
        ...(indexed ? { customerReviewPending: true as const } : {}),
      }),
    );
  }

  async function drainQueue() {
    const ids: Id<"finishedGoodsJobScans">[] = [];
    const cursors = new Set<string>();
    let scanCursor: string | undefined;
    for (let page = 0; page < 12; page += 1) {
      const result = await actor.query(
        api.customers.linking.listUnresolvedNames,
        scanCursor === undefined ? {} : { scanCursor },
      );
      if (!result.ok) throw new Error("Queue access denied");
      ids.push(
        ...result.value.groups.flatMap((group) =>
          group.scans.map((scan) => scan.jobScanId),
        ),
      );
      if (!result.value.hasMore) return ids;
      scanCursor = result.value.scanCursor;
      if (!scanCursor || cursors.has(scanCursor)) {
        throw new Error("Queue continuation did not advance");
      }
      cursors.add(scanCursor);
    }
    throw new Error("Queue did not finish");
  }

  return { world, auth, actor, insertScan, drainQueue };
}

it("counts and traverses mixed indexed and legacy tickets exactly once", async () => {
  const { world, actor, insertScan, drainQueue } = await setup();
  const warehouse = world.warehouses.alphaA;
  const legacy = await insertScan(warehouse, 1, "Legacy Buyer");
  const indexed = await insertScan(warehouse, 2, "Indexed Buyer", true);
  for (let i = 3; i < 65; i += 1) await insertScan(warehouse, i);
  await insertScan(world.warehouses.alphaB, 2, "Other Tenant");
  await insertScan(world.warehouses.bravoA, 2, "Out of Scope");

  const summary = await actor.query(api.customers.linking.reviewSummary, {});
  expect(summary).toMatchObject({
    ok: true,
    value: { unresolvedNameCount: 2, unresolvedScanCount: 2, hasMore: false },
  });
  expect((await drainQueue()).sort()).toEqual([legacy, indexed].sort());
});

it.each(["ORG_WIDE", "WAREHOUSE_SCOPED"] as const)(
  "continues through the full %s warehouse inventory",
  async (scopeMode) => {
    const { world, auth, actor, insertScan, drainQueue } = await setup();
    const last = await world.t.run(async (ctx) => {
      await ctx.db.patch(auth.identities.membershipA, { scopeMode });
      let warehouseId = world.warehouses.alphaA;
      for (let i = 0; i < 101; i += 1) {
        warehouseId = await ctx.db.insert("warehouses", {
          orgId: world.orgA,
          code: `ZZ-${String(i).padStart(3, "0")}`,
          name: `Warehouse ${i}`,
          status: "ACTIVE",
        });
        await ctx.db.insert("membershipWarehouses", {
          orgId: world.orgA,
          membershipId: auth.identities.membershipA,
          warehouseId,
        });
      }
      return warehouseId;
    });
    const scan = await insertScan(last, 1, "Later Warehouse Buyer", true);

    const summary = await actor.query(api.customers.linking.reviewSummary, {});
    expect(summary).toMatchObject({
      ok: true,
      value: { unresolvedNameCount: 0, unresolvedScanCount: 0, hasMore: true },
    });
    expect(await drainQueue()).toEqual([scan]);
  },
);
