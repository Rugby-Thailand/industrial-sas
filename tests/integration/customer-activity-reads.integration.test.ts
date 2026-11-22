import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  getCustomerActivity,
  listCustomerActivitySummaries,
  listCustomerProductsPage,
} from "../../convex/customers/linking";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTestModuleMap,
} from "../fixtures/convex-tenant-world";
import { measured } from "../fixtures/query-read-stats";

const MODULES: ConvexTestModuleMap = {
  "../convex/customers/linking.ts": () =>
    import("../../convex/customers/linking"),
  "../convex/customers/writes.ts": () =>
    import("../../convex/customers/writes"),
  "../convex/finishedGoods/jobScans.ts": () =>
    import("../../convex/finishedGoods/jobScans"),
};
const linking = api.customers.linking;

type Outcome<T> = { ok: true; value: T } | { ok: false };
function allowed<T>(outcome: Outcome<T>): T {
  if (!outcome.ok)
    throw new Error(
      `Expected allowed tenant outcome: ${JSON.stringify(outcome)}`,
    );
  return outcome.value;
}
type Summaries = {
  canViewWarehouseData: boolean;
  summaries: {
    customerId: Id<"customers">;
    linkedProductCount: number;
    latestJob?: { factoryOrder: string; createdAt: number };
  }[];
};
type Activity = {
  recentJobs: { factoryOrder: string; warehouseId: Id<"warehouses"> }[];
  hasMoreJobs: boolean;
  linkedProducts: { sku: string; warehouseId: Id<"warehouses"> }[];
  hasMoreProducts: boolean;
};
type ProductsPage = {
  items: { sku: string }[];
  isDone: boolean;
  continueCursor: string;
};

async function setup() {
  const world = await createConvexTenantWorld(MODULES);
  await seedConvexAuthorization(world, {
    roleA: "ORG_ADMIN",
    roleB: "ORG_ADMIN",
  });
  const actorA = world.t.withIdentity({
    subject: "user_fixture_a",
    org_id: "org_fixture_a",
  });
  const { t, orgA, userA } = world;

  const createCustomer = async (name: string, requestId: string) => {
    const res = allowed(
      await actorA.mutation(api.customers.writes.createCustomer, {
        requestId,
        name,
      }),
    ) as { ok: boolean; customerId?: string; code?: string };
    if (!res.ok) throw new Error(res.code);
    return res.customerId as Id<"customers">;
  };

  const insertWarehouses = (count: number, status: "ACTIVE" | "INACTIVE") =>
    t.run(async (ctx) => {
      const ids: Id<"warehouses">[] = [];
      for (let i = 0; i < count; i += 1) {
        ids.push(
          await ctx.db.insert("warehouses", {
            orgId: orgA,
            code: `${status}-${String(i).padStart(4, "0")}`,
            name: `Warehouse ${status} ${i}`,
            status,
          }),
        );
      }
      return ids;
    });

  const insertScans = (
    rows: readonly {
      warehouseId: Id<"warehouses">;
      customerId: Id<"customers">;
      factoryOrder: string;
      createdAt: number;
      voided?: true;
    }[],
  ) =>
    t.run(async (ctx) => {
      const ids: Id<"finishedGoodsJobScans">[] = [];
      for (const row of rows) {
        ids.push(
          await ctx.db.insert("finishedGoodsJobScans", {
            orgId: orgA,
            warehouseId: row.warehouseId,
            factoryOrder: row.factoryOrder,
            productBarcodeText: `BC-${row.factoryOrder}`,
            customer: "Activity Buyer",
            customerId: row.customerId,
            customerLinkSource: "MANUAL",
            locationText: "DOCK-1",
            mapped: false,
            source: "AI",
            version: 1,
            ...(row.voided ? { voided: true as const } : {}),
            createdAt: row.createdAt,
            createdByUserId: userA,
            updatedAt: row.createdAt,
            updatedByUserId: userA,
          }),
        );
      }
      return ids;
    });

  const insertProducts = (
    warehouseId: Id<"warehouses">,
    customerId: Id<"customers">,
    prefix: string,
    count: number,
  ) =>
    t.run(async (ctx) => {
      const now = Date.now();
      for (let i = 0; i < count; i += 1) {
        await ctx.db.insert("finishedGoodsProducts", {
          orgId: orgA,
          warehouseId,
          sku: `${prefix}-${String(i).padStart(3, "0")}`,
          name: `${prefix} product ${i}`,
          unit: "PCS",
          storageFormat: "BOX",
          storageCondition: "AMBIENT",
          customerId,
          customerLinkSource: "MANUAL",
          status: "ACTIVE",
          createdAt: now,
          createdByUserId: userA,
          updatedAt: now,
          updatedByUserId: userA,
        });
      }
    });

  /** Extend the fixture actor's orgA warehouse scope (it starts at alpha). */
  const grantActorWarehouses = (warehouseIds: readonly Id<"warehouses">[]) =>
    t.run(async (ctx) => {
      const memberships = await ctx.db
        .query("memberships")
        .filter((q) =>
          q.and(q.eq(q.field("orgId"), orgA), q.eq(q.field("userId"), userA)),
        )
        .collect();
      for (const membership of memberships) {
        if (membership.scopeMode !== "WAREHOUSE_SCOPED") continue;
        for (const warehouseId of warehouseIds) {
          await ctx.db.insert("membershipWarehouses", {
            orgId: orgA,
            membershipId: membership._id,
            warehouseId,
          });
        }
      }
    });

  /** A warehouse-scoped storage reader limited to `warehouseIds`. */
  const scopedReader = async (warehouseIds: readonly Id<"warehouses">[]) => {
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        clerkUserId: "user_scoped_reader",
        displayName: "Scoped Reader",
        status: "ACTIVE",
      });
      const roleId = await ctx.db.insert("roles", {
        orgId: orgA,
        key: "SCOPED_READER",
        name: "Scoped reader",
        status: "ACTIVE",
        seeded: false,
      });
      for (const permissionCode of [
        "masterData.customer.read",
        "masterData.storageLayout.read",
      ]) {
        await ctx.db.insert("rolePermissions", {
          orgId: orgA,
          roleId,
          permissionCode,
        });
      }
      const membershipId = await ctx.db.insert("memberships", {
        orgId: orgA,
        userId,
        clerkMembershipId: "mem_scoped_reader",
        status: "ACTIVE",
        scopeMode: "WAREHOUSE_SCOPED",
        effectiveFrom: 0,
      });
      for (const warehouseId of warehouseIds) {
        await ctx.db.insert("membershipWarehouses", {
          orgId: orgA,
          membershipId,
          warehouseId,
        });
      }
      await ctx.db.insert("membershipRoles", {
        orgId: orgA,
        membershipId,
        roleId,
        grantedAt: 0,
      });
    });
    return t.withIdentity({
      subject: "user_scoped_reader",
      org_id: "org_fixture_a",
    });
  };

  return {
    ...world,
    actorA,
    createCustomer,
    insertWarehouses,
    insertScans,
    insertProducts,
    grantActorWarehouses,
    scopedReader,
  };
}

describe("customer activity reads stay truthful at high cardinality", () => {
  it("counts an in-scope warehouse that sorts after 100+ out-of-scope activity rows", async () => {
    const world = await setup();
    const { t, orgA, warehouses } = world;
    const customerId = await world.createCustomer("Wide Buyer", "wide-1");
    const inactive = await world.insertWarehouses(150, "INACTIVE");
    const [scanId] = await world.insertScans([
      {
        warehouseId: warehouses.alphaA,
        customerId,
        factoryOrder: "FO-WIDE",
        createdAt: 5_000,
      },
    ]);

    // Make the LAST activity row in index order the only in-scope one, so a
    // read that stops at 100 rows before applying scope would report zero.
    const lastWarehouseId = await t.run(async (ctx) => {
      for (const warehouseId of inactive) {
        await ctx.db.insert("customerWarehouseActivity", {
          orgId: orgA,
          warehouseId,
          customerId,
          linkedProductCount: 1,
        });
      }
      const [last] = await ctx.db
        .query("customerWarehouseActivity")
        .withIndex("by_orgId_customerId_warehouseId", (q) =>
          q.eq("orgId", orgA).eq("customerId", customerId),
        )
        .order("desc")
        .take(1);
      await ctx.db.patch("warehouses", last!.warehouseId, {
        status: "ACTIVE",
      });
      await ctx.db.patch("customerWarehouseActivity", last!._id, {
        linkedProductCount: 7,
        latestJobScanId: scanId,
        latestJobFactoryOrder: "FO-WIDE",
        latestJobCreatedAt: 5_000,
      });
      return last!.warehouseId;
    });
    expect(inactive).toContain(lastWarehouseId);
    await world.grantActorWarehouses([lastWarehouseId]);

    const run = await measured<Summaries>(
      world,
      listCustomerActivitySummaries,
      { customerIds: [customerId] },
    );
    const value = run.value;
    expect(value.summaries).toEqual([
      {
        customerId,
        linkedProductCount: 7,
        latestJob: {
          jobScanId: scanId,
          factoryOrder: "FO-WIDE",
          createdAt: 5_000,
          warehouseId: lastWarehouseId,
        },
      },
    ]);
    // Every row is read in bounded batches; each continuation re-reads only
    // its inclusive boundary row (10-row first slice, then 100-row batches).
    expect(run.stats.rangeDocs.customerWarehouseActivity).toBe(152);
    expect(run.stats.ranges.customerWarehouseActivity).toBe(3);
  });

  it("omits a customer whose activity exceeds the request budget instead of reporting zero", async () => {
    const world = await setup();
    const { t, orgA, warehouses } = world;
    const busyA = await world.createCustomer("Busy A", "busy-a");
    const busyB = await world.createCustomer("Busy B", "busy-b");
    const quiet = await world.createCustomer("Quiet", "quiet");
    const inactive = await world.insertWarehouses(1_100, "INACTIVE");
    await t.run(async (ctx) => {
      for (const customerId of [busyA, busyB]) {
        for (const warehouseId of [warehouses.alphaA, ...inactive]) {
          await ctx.db.insert("customerWarehouseActivity", {
            orgId: orgA,
            warehouseId,
            customerId,
            linkedProductCount: warehouseId === warehouses.alphaA ? 4 : 1,
          });
        }
      }
    });

    const run = await measured<Summaries>(
      world,
      listCustomerActivitySummaries,
      { customerIds: [busyA, busyB, quiet] },
    );
    const { summaries } = run.value;
    // Busy A fits the budget and is exact; Busy B is unknown (omitted, so the
    // list shows a dash), never a misleading zero; Quiet is an exact zero.
    expect(summaries).toEqual([
      { customerId: busyA, linkedProductCount: 4 },
      { customerId: quiet, linkedProductCount: 0 },
    ]);
    expect(run.stats.rangeDocs.customerWarehouseActivity).toBeLessThanOrEqual(
      2_000,
    );
  });

  it("keeps a populated 100-customer summary page within one bounded range per customer", async () => {
    const world = await setup();
    const { t, orgA, warehouses } = world;
    const customerIds: Id<"customers">[] = [];
    for (let i = 0; i < 100; i += 1) {
      customerIds.push(
        await world.createCustomer(`Page Buyer ${i}`, `pb-${i}`),
      );
    }
    await t.run(async (ctx) => {
      for (const customerId of customerIds) {
        for (const warehouseId of [
          warehouses.alphaA,
          warehouses.bravoA,
          warehouses.charlieA,
        ]) {
          await ctx.db.insert("customerWarehouseActivity", {
            orgId: orgA,
            warehouseId,
            customerId,
            linkedProductCount: 2,
          });
        }
      }
    });
    await world.grantActorWarehouses([warehouses.bravoA, warehouses.charlieA]);
    const run = await measured<Summaries>(
      world,
      listCustomerActivitySummaries,
      { customerIds },
    );
    const { summaries } = run.value;
    expect(summaries).toHaveLength(100);
    expect(summaries.every((s) => s.linkedProductCount === 6)).toBe(true);
    expect(run.stats.rangeDocs.customerWarehouseActivity).toBe(300);
    expect(run.stats.ranges.customerWarehouseActivity).toBe(100);
    expect(run.stats.rangeDocs.finishedGoodsJobScans ?? 0).toBe(0);
    expect(run.stats.rangeDocs.finishedGoodsProducts ?? 0).toBe(0);
  });

  it("never lets newer voided scans hide the latest live job in refresh or detail", async () => {
    const world = await setup();
    const { t, warehouses, actorA } = world;
    const alpha = warehouses.alphaA;
    const customerId = await world.createCustomer("Void Buyer", "void-1");
    const [liveId, newerId] = await world.insertScans([
      {
        warehouseId: alpha,
        customerId,
        factoryOrder: "FO-LIVE",
        createdAt: 1_000,
      },
      {
        warehouseId: alpha,
        customerId,
        factoryOrder: "FO-NEWER",
        createdAt: 2_000,
      },
    ]);
    await world.insertScans(
      Array.from({ length: 30 }, (_, i) => ({
        warehouseId: alpha,
        customerId,
        factoryOrder: `FO-VOID-${i}`,
        createdAt: 3_000 + i,
        voided: true as const,
      })),
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("customerWarehouseActivity", {
        orgId: world.orgA,
        warehouseId: alpha,
        customerId,
        linkedProductCount: 0,
        latestJobScanId: newerId!,
        latestJobFactoryOrder: "FO-NEWER",
        latestJobCreatedAt: 2_000,
      });
    });

    // Deleting the newest live scan recomputes the latest job.
    allowed(
      await actorA.mutation(api.finishedGoods.jobScans.deleteJobScans, {
        warehouseId: alpha,
        requestId: "void-delete-newer",
        ids: [newerId!],
      }),
    );
    const activityRow = await t.run((ctx) =>
      ctx.db
        .query("customerWarehouseActivity")
        .withIndex("by_orgId_customerId_warehouseId", (q) =>
          q
            .eq("orgId", world.orgA)
            .eq("customerId", customerId)
            .eq("warehouseId", alpha),
        )
        .unique(),
    );
    expect(activityRow).toMatchObject({
      latestJobScanId: liveId,
      latestJobFactoryOrder: "FO-LIVE",
      latestJobCreatedAt: 1_000,
    });

    const run = await measured<Activity | null>(world, getCustomerActivity, {
      customerId,
    });
    const activity = run.value!;
    expect(activity.recentJobs.map((job) => job.factoryOrder)).toEqual([
      "FO-LIVE",
    ]);
    expect(activity.hasMoreJobs).toBe(false);
    // Voided rows are excluded by the index: nothing beyond live scans is read.
    expect(run.stats.rangeDocs.finishedGoodsJobScans ?? 0).toBe(1);
  });

  it("finds in-scope jobs and products behind many out-of-scope rows and pages them to the end", async () => {
    const world = await setup();
    const { warehouses } = world;
    const alpha = warehouses.alphaA;
    const bravo = warehouses.bravoA;
    const customerId = await world.createCustomer("Scoped Buyer", "scoped-1");
    // 21 readable warehouses exceed the old detail fan-out cutoff.
    const extra = await world.insertWarehouses(20, "ACTIVE");
    const reader = await world.scopedReader([bravo, ...extra]);

    await world.insertProducts(alpha, customerId, "ALPHA", 520);
    await world.insertProducts(bravo, customerId, "BRAVO", 3);
    await world.insertScans([
      {
        warehouseId: bravo,
        customerId,
        factoryOrder: "FO-BRAVO",
        createdAt: 100,
      },
      ...Array.from({ length: 320 }, (_, i) => ({
        warehouseId: alpha,
        customerId,
        factoryOrder: `FO-ALPHA-${i}`,
        createdAt: 1_000 + i,
      })),
    ]);

    const activity = allowed(
      (await reader.query(linking.getCustomerActivity, {
        customerId,
      })) as Outcome<Activity | null>,
    )!;
    expect(activity.recentJobs.map((job) => job.factoryOrder)).toEqual([
      "FO-BRAVO",
    ]);
    expect(activity.hasMoreJobs).toBe(false);
    expect(activity.linkedProducts.map((p) => p.sku).sort()).toEqual([
      "BRAVO-000",
      "BRAVO-001",
      "BRAVO-002",
    ]);
    expect(activity.hasMoreProducts).toBe(false);

    const hiddenProducts = await world.t.run((ctx) =>
      ctx.db
        .query("finishedGoodsProducts")
        .withIndex("by_orgId_warehouseId_customerId", (q) =>
          q
            .eq("orgId", world.orgA)
            .eq("warehouseId", alpha)
            .eq("customerId", customerId),
        )
        .collect(),
    );
    const skus: string[] = [];
    let cursor: string | undefined;
    for (let pages = 0; pages < 10; pages += 1) {
      const page = allowed(
        (await reader.query(linking.listCustomerProductsPage, {
          customerId,
          pageSize: 2,
          ...(cursor ? { cursor } : {}),
        })) as Outcome<ProductsPage | null>,
      )!;
      const position = JSON.parse(page.continueCursor || "{}");
      expect(position).not.toHaveProperty("k");
      expect(position).not.toHaveProperty("ids");
      // convex-test stores the native index values as JSON within its cursor.
      const nativeKeys: string[] = position.nativeCursor
        ? JSON.parse(position.nativeCursor)
        : [];
      for (const product of hiddenProducts) {
        expect(JSON.stringify(page)).not.toContain(product._id);
        expect(nativeKeys).not.toContain(JSON.stringify(product._id));
        expect(nativeKeys).not.toContain(JSON.stringify(product._creationTime));
      }
      if (position.nativeCursor) expect(position.warehouseId).toBe(bravo);
      skus.push(...page.items.map((item) => item.sku));
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    expect(skus).toEqual(["BRAVO-000", "BRAVO-001", "BRAVO-002"]);
  });

  it("pages tied older jobs beyond the warehouse inventory boundary within customer and warehouse scope", async () => {
    const world = await setup();
    const customerId = await world.createCustomer(
      "Large Scope Buyer",
      "large-scope",
    );
    const otherCustomerId = await world.createCustomer(
      "Other Buyer",
      "other-buyer",
    );
    const warehouses = (await world.insertWarehouses(105, "ACTIVE")).sort();
    const lastWarehouse = warehouses.at(-1)!;
    const reader = await world.scopedReader(warehouses);
    const [hiddenJob, otherJob, ...visibleJobs] = await world.insertScans([
      {
        warehouseId: world.warehouses.alphaA,
        customerId,
        factoryOrder: "HIDDEN",
        createdAt: 973412345678,
      },
      {
        warehouseId: lastWarehouse,
        customerId: otherCustomerId,
        factoryOrder: "OTHER",
        createdAt: 876512345678,
      },
      ...Array.from({ length: 23 }, (_, i) => ({
        warehouseId: lastWarehouse,
        customerId,
        factoryOrder: `TIED-${i}`,
        createdAt: 100,
      })),
    ]);
    const detail = allowed(
      await reader.query(linking.getCustomerActivity, { customerId }),
    )!;
    expect(detail.recentJobs).toEqual([]);
    expect(detail.hasMoreJobs).toBe(true);

    const found: string[] = [];
    let cursor: string | undefined;
    let done = false;
    for (let i = 0; i < 5 && !done; i += 1) {
      const page = allowed(
        await reader.query(linking.listCustomerJobsPage, {
          customerId,
          ...(cursor && { cursor }),
        }),
      )!;
      expect(JSON.stringify(page)).not.toMatch(
        new RegExp(`${hiddenJob}|${otherJob}|973412345678|876512345678`),
      );
      found.push(...page.items.map((job) => job.jobScanId));
      if (cursor) expect(page.continueCursor).not.toBe(cursor);
      cursor = page.continueCursor;
      done = page.isDone;
    }
    expect(done).toBe(true);
    expect(found.sort()).toEqual(visibleJobs.sort());
  });

  it("reads one product page plus one lookahead row and rejects foreign cursors", async () => {
    const world = await setup();
    const customerId = await world.createCustomer("Paged Buyer", "paged-1");
    await world.insertProducts(world.warehouses.alphaA, customerId, "P", 30);

    const first = await measured<ProductsPage | null>(
      world,
      listCustomerProductsPage,
      { customerId, pageSize: 10 },
    );
    const page = first.value!;
    expect(page.items).toHaveLength(10);
    expect(page.isDone).toBe(false);
    expect(first.stats.rangeDocs.finishedGoodsProducts).toBe(11);

    const otherCustomer = await world.createCustomer(
      "Other Buyer",
      "paged-other",
    );
    await expect(
      world.actorA.query(linking.listCustomerProductsPage, {
        customerId: otherCustomer,
        cursor: page.continueCursor,
      }),
    ).rejects.toThrow();

    const seen = new Set(page.items.map((item) => item.sku));
    let cursor = page.continueCursor;
    for (;;) {
      const next = allowed(
        (await world.actorA.query(linking.listCustomerProductsPage, {
          customerId,
          pageSize: 10,
          cursor,
        })) as Outcome<ProductsPage | null>,
      )!;
      for (const item of next.items) {
        expect(seen.has(item.sku)).toBe(false);
        seen.add(item.sku);
      }
      if (next.isDone) break;
      cursor = next.continueCursor;
    }
    expect(seen.size).toBe(30);

    await expect(
      world.actorA.query(linking.listCustomerProductsPage, {
        customerId,
        cursor: "not-a-cursor",
      }),
    ).rejects.toThrow();
  });
});
