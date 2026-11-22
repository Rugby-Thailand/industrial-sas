import { expect, it } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
} from "../fixtures/convex-tenant-world";

async function setup() {
  const world = await createConvexTenantWorld({
    "../convex/customers/linking.ts": () =>
      import("../../convex/customers/linking"),
    "../convex/customers/backfill.ts": () =>
      import("../../convex/customers/backfill"),
    "../convex/customers/writes.ts": () =>
      import("../../convex/customers/writes"),
    "../convex/finishedGoods/jobScans.ts": () =>
      import("../../convex/finishedGoods/jobScans"),
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

  async function saveBatch(
    requestId: string,
    customers: readonly (string | undefined)[],
  ) {
    const result = await actor.mutation(
      api.finishedGoods.jobScans.saveJobScans,
      {
        warehouseId: world.warehouses.alphaA,
        requestId,
        locationText: "DOCK-1",
        items: customers.map((customer, i) => ({
          factoryOrder: `FO-${requestId}-${i}`,
          productBarcodeText: `BC-${requestId}-${i}`,
          source: "AI" as const,
          ...(customer === undefined ? {} : { customer }),
        })),
      },
    );
    if (!result.ok || !result.value.written)
      throw new Error("Job scan save failed");
  }

  async function firstPage() {
    const result = await actor.query(
      api.customers.linking.listUnresolvedNames,
      {},
    );
    if (!result.ok) throw new Error("Queue access denied");
    return result.value;
  }

  async function legacyRemaining() {
    const page = await world.t.query(
      internal.customers.backfill.listCustomerBackfillWarehouses,
      {},
    );
    return page.warehouses.find(
      (row) => row.warehouseId === world.warehouses.alphaA,
    )?.legacyRemaining;
  }

  async function backfill(warehouseId: Id<"warehouses">) {
    let cursor: string | undefined;
    for (;;) {
      const step = await world.t.mutation(
        internal.customers.backfill.backfillJobScanCustomers,
        { warehouseId, dryRun: false, ...(cursor ? { cursor } : {}) },
      );
      if (step.isDone) return;
      cursor = step.continueCursor;
    }
  }

  return {
    world,
    auth,
    actor,
    insertScan,
    drainQueue,
    saveBatch,
    firstPage,
    legacyRemaining,
    backfill,
  };
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

it("keeps 150 newly saved blank tickets out of the review banner and queue", async () => {
  const { actor, saveBatch, firstPage, legacyRemaining, drainQueue } =
    await setup();
  await saveBatch("named", ["Unknown Buyer"]);
  for (let batch = 0; batch < 3; batch += 1) {
    await saveBatch(
      `blank-${batch}`,
      Array.from({ length: 50 }, () => "  "),
    );
  }

  expect(
    await actor.query(api.customers.linking.reviewSummary, {}),
  ).toMatchObject({
    ok: true,
    value: { unresolvedNameCount: 1, unresolvedScanCount: 1, hasMore: false },
  });
  const page = await firstPage();
  expect(page.hasMore).toBe(false);
  expect(page.groups.map((group) => group.displayName)).toEqual([
    "Unknown Buyer",
  ]);
  expect(await drainQueue()).toHaveLength(1);
  expect(await legacyRemaining()).toBe(false);
});

it("drains historical blank, voided and named tickets after backfill", async () => {
  const { world, actor, insertScan, firstPage, legacyRemaining, backfill } =
    await setup();
  const warehouse = world.warehouses.alphaA;
  const named = await insertScan(warehouse, 1, "Historic Buyer");
  const voided = await insertScan(warehouse, 2, "Voided Buyer");
  await world.t.run((ctx) => ctx.db.patch(voided, { voided: true }));
  for (let i = 3; i < 153; i += 1) {
    await insertScan(warehouse, i, i % 2 ? undefined : " ");
  }

  // Before backfill the legacy stream is still read so nothing is hidden.
  expect(await legacyRemaining()).toBe(true);
  expect((await firstPage()).hasMore).toBe(true);

  await backfill(warehouse);

  expect(await legacyRemaining()).toBe(false);
  const page = await firstPage();
  expect(page.hasMore).toBe(false);
  expect(
    page.groups.flatMap((group) => group.scans.map((s) => s.jobScanId)),
  ).toEqual([named]);
  expect(
    await actor.query(api.customers.linking.reviewSummary, {}),
  ).toMatchObject({
    ok: true,
    value: { unresolvedNameCount: 1, unresolvedScanCount: 1, hasMore: false },
  });
  const [namedDoc, voidedDoc] = await world.t.run(async (ctx) => [
    await ctx.db.get(named),
    await ctx.db.get(voided),
  ]);
  expect(namedDoc).toMatchObject({ customerReviewPending: true, version: 1 });
  expect(voidedDoc).toMatchObject({
    customer: "Voided Buyer",
    customerReviewPending: false,
    version: 1,
  });
});

it("lets a retired blank ticket be named later and auto-linked or reviewed", async () => {
  const { world, actor, saveBatch, firstPage } = await setup();
  await saveBatch("blanks", [undefined, undefined]);
  const created = await actor.mutation(api.customers.writes.createCustomer, {
    requestId: "customer-1",
    name: "Siam Packaging",
  });
  if (!created.ok || !created.value.ok) throw new Error("Customer not created");
  const [first, second] = await world.t.run((ctx) =>
    ctx.db.query("finishedGoodsJobScans").collect(),
  );
  expect(first?.customerReviewPending).toBe(false);

  const rename = async (
    scan: NonNullable<typeof first>,
    customer: string | undefined,
    requestId: string,
  ) => {
    const current = await world.t.run((ctx) => ctx.db.get(scan._id));
    const result = await actor.mutation(
      api.finishedGoods.jobScans.updateJobScan,
      {
        warehouseId: scan.warehouseId,
        jobScanId: scan._id,
        requestId,
        expectedVersion: current!.version ?? 1,
        fields: {
          factoryOrder: scan.factoryOrder,
          productBarcodeText: scan.productBarcodeText,
          ...(customer === undefined ? {} : { customer }),
        },
      },
    );
    if (!result.ok || !result.value.written) throw new Error("Update failed");
    return world.t.run((ctx) => ctx.db.get(scan._id));
  };

  expect(await rename(first!, "Siam Packaging", "rename-1")).toMatchObject({
    customerId: created.value.customerId,
    customerLinkSource: "AUTO",
  });
  expect(
    (await world.t.run((ctx) => ctx.db.get(first!._id)))?.customerReviewPending,
  ).toBeUndefined();
  expect(await rename(second!, "Someone New", "rename-2")).toMatchObject({
    customerReviewPending: true,
  });
  expect((await firstPage()).groups.map((group) => group.displayName)).toEqual([
    "Someone New",
  ]);
  expect(await rename(second!, undefined, "rename-3")).toMatchObject({
    customerReviewPending: false,
  });
  expect((await firstPage()).groups).toEqual([]);
});

it("classifies an unchanged legacy ticket without a correction", async () => {
  const { world, actor, insertScan } = await setup();
  const scan = await insertScan(world.warehouses.alphaA, 1);
  const result = await actor.mutation(
    api.finishedGoods.jobScans.updateJobScan,
    {
      warehouseId: world.warehouses.alphaA,
      jobScanId: scan,
      requestId: "noop",
      expectedVersion: 1,
      fields: { factoryOrder: "FO-1", productBarcodeText: "BC-1" },
    },
  );
  expect(result.ok).toBe(true);
  const doc = await world.t.run((ctx) => ctx.db.get(scan));
  expect(doc).toMatchObject({ customerReviewPending: false, version: 1 });
  expect(doc?.correctedAt).toBeUndefined();
});
