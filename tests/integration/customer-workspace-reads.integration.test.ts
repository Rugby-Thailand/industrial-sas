import { type FunctionReference, type FunctionReturnType } from "convex/server";
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { getCustomerWorkspace } from "../../convex/customers/workspace";
import { measured } from "../fixtures/query-read-stats";
import { PRODUCT_SUMMARY_VERSION } from "../../convex/lib/finishedGoodsSummary";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTestModuleMap,
} from "../fixtures/convex-tenant-world";

const MODULES: ConvexTestModuleMap = {
  "../convex/customers/catalogue.ts": () =>
    import("../../convex/customers/catalogue"),
  "../convex/customers/linking.ts": () =>
    import("../../convex/customers/linking"),
  "../convex/customers/workspace.ts": () =>
    import("../../convex/customers/workspace"),
  "../convex/customers/writes.ts": () =>
    import("../../convex/customers/writes"),
};
const workspace = api.customers.workspace;

type Outcome<T> = { ok: true; value: T } | { ok: false };
function allowed<T>(outcome: Outcome<T>): T {
  if (!outcome.ok)
    throw new Error(
      `Expected allowed tenant outcome: ${JSON.stringify(outcome)}`,
    );
  return outcome.value;
}
/** Registered queries return a tenant outcome; tests read its allowed value. */
type Value<Ref extends FunctionReference<"query">> = NonNullable<
  Extract<FunctionReturnType<Ref>, { ok: true }>["value"]
>;
type Workspace = Value<typeof workspace.getCustomerWorkspace>;
type JobsPage = Value<typeof workspace.listCustomerWorkspaceJobs>;
type ProductsPage = Value<typeof workspace.listCustomerWorkspaceProducts>;

async function setup() {
  const world = await createConvexTenantWorld(MODULES);
  await seedConvexAuthorization(world, {
    roleA: "ORG_ADMIN",
    roleB: "ORG_ADMIN",
  });
  const { t, orgA, userA, warehouses } = world;
  const actorA = world.t.withIdentity({
    subject: "user_fixture_a",
    org_id: "org_fixture_a",
  });
  const actorB = world.t.withIdentity({
    subject: "user_fixture_a",
    org_id: "org_fixture_b",
  });
  const { alphaA: alpha, bravoA: bravo, charlieA: charlie } = warehouses;

  const created = allowed(
    await actorA.mutation(api.customers.writes.createCustomer, {
      requestId: "workspace-buyer",
      name: "Workspace Buyer",
      taxId: "0105553012341",
      deliveryAddress: { label: "Bang Phli gate 3", province: "Bangkok" },
      notes: "Mon-Sat 08:00-16:00. Show the job number at receiving.",
    }),
  ) as { ok: boolean; customerId?: Id<"customers"> };
  const customerId = created.customerId!;

  // The fixture actor is scoped to alpha; add bravo. Charlie stays forbidden.
  await t.run(async (ctx) => {
    const memberships = await ctx.db
      .query("memberships")
      .filter((q) =>
        q.and(q.eq(q.field("orgId"), orgA), q.eq(q.field("userId"), userA)),
      )
      .collect();
    for (const membership of memberships)
      await ctx.db.insert("membershipWarehouses", {
        orgId: orgA,
        membershipId: membership._id,
        warehouseId: bravo,
      });
  });

  const stamps = (at: number) => ({
    createdAt: at,
    createdByUserId: userA,
    updatedAt: at,
    updatedByUserId: userA,
  });
  const scans = await t.run(async (ctx) => {
    const insert = (
      warehouseId: Id<"warehouses">,
      factoryOrder: string,
      createdAt: number,
      extra: { mapped?: boolean; voided?: true; locationCode?: string } = {},
    ) =>
      ctx.db.insert("finishedGoodsJobScans", {
        orgId: orgA,
        warehouseId,
        factoryOrder,
        productBarcodeText: `BC-${factoryOrder}`,
        partName: `Part ${factoryOrder}`,
        customer: "Workspace Buyer",
        customerId,
        customerLinkSource: "AUTO",
        locationText: extra.locationCode ?? "DOCK",
        mapped: extra.mapped ?? false,
        ...(extra.locationCode ? { locationCode: extra.locationCode } : {}),
        ...(extra.voided ? { voided: true as const } : {}),
        source: "AI",
        version: 1,
        ...stamps(createdAt),
      });
    return {
      alphaOld: await insert(alpha, "FO-A1", 1_000),
      alphaMapped: await insert(alpha, "FO-A2", 2_000, {
        mapped: true,
        locationCode: "A-02-04",
      }),
      alphaNew: await insert(alpha, "FO-A3", 4_000),
      alphaVoided: await insert(alpha, "FO-AV", 9_000, { voided: true }),
      bravoMapped: await insert(bravo, "FO-B1", 3_000, {
        mapped: true,
        locationCode: "B-04-02",
      }),
      charlieHidden: await insert(charlie, "FO-C1", 8_000),
    };
  });

  const products = await t.run(async (ctx) => {
    const insert = (warehouseId: Id<"warehouses">, sku: string) =>
      ctx.db.insert("finishedGoodsProducts", {
        orgId: orgA,
        warehouseId,
        sku,
        name: `Product ${sku}`,
        unit: "BOX",
        storageFormat: "PALLET",
        storageCondition: "AMBIENT",
        customerId,
        customerLinkSource: "MANUAL",
        status: "ACTIVE",
        ...stamps(1),
      });
    return {
      boxes: await insert(alpha, "BX-42"),
      inserts: await insert(alpha, "IN-12"),
      hidden: await insert(charlie, "HID-1"),
    };
  });

  // Activity rows as the live writers maintain them.
  await t.run(async (ctx) => {
    const activity = (
      warehouseId: Id<"warehouses">,
      linkedProductCount: number,
      latest: Id<"finishedGoodsJobScans">,
      factoryOrder: string,
      createdAt: number,
    ) =>
      ctx.db.insert("customerWarehouseActivity", {
        orgId: orgA,
        warehouseId,
        customerId,
        linkedProductCount,
        latestJobScanId: latest,
        latestJobFactoryOrder: factoryOrder,
        latestJobCreatedAt: createdAt,
      });
    await activity(alpha, 2, scans.alphaNew, "FO-A3", 4_000);
    await activity(bravo, 0, scans.bravoMapped, "FO-B1", 3_000);
    await activity(charlie, 1, scans.charlieHidden, "FO-C1", 8_000);

    // Alpha's product summaries are ready: 3 + 2 stored pallets.
    await ctx.db.insert("finishedGoodsSummaryReadiness", {
      orgId: orgA,
      warehouseId: alpha,
      version: PRODUCT_SUMMARY_VERSION,
      ready: true,
    });
    for (const [productId, stored] of [
      [products.boxes, 3],
      [products.inserts, 2],
    ] as const)
      await ctx.db.insert("finishedGoodsProductSummaries", {
        orgId: orgA,
        warehouseId: alpha,
        productId,
        count: stored,
        quantityMinor: stored * 100_000,
        formatCounts: { PALLET: stored, BOX: 0, OTHER: 0, INHERITED: 0 },
        stored,
        awaitingMeasurement: 0,
        awaitingStorage: 0,
        moving: 0,
        version: PRODUCT_SUMMARY_VERSION,
      });
  });

  /** A warehouse-scoped member with exactly these permissions. */
  const member = async (
    key: string,
    permissionCodes: readonly string[],
    warehouseIds: readonly Id<"warehouses">[],
  ) => {
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        clerkUserId: `user_${key}`,
        displayName: key,
        status: "ACTIVE",
      });
      const roleId = await ctx.db.insert("roles", {
        orgId: orgA,
        key: key.toUpperCase(),
        name: key,
        status: "ACTIVE",
        seeded: false,
      });
      for (const permissionCode of permissionCodes)
        await ctx.db.insert("rolePermissions", {
          orgId: orgA,
          roleId,
          permissionCode,
        });
      const membershipId = await ctx.db.insert("memberships", {
        orgId: orgA,
        userId,
        clerkMembershipId: `mem_${key}`,
        status: "ACTIVE",
        scopeMode: "WAREHOUSE_SCOPED",
        effectiveFrom: 0,
      });
      for (const warehouseId of warehouseIds)
        await ctx.db.insert("membershipWarehouses", {
          orgId: orgA,
          membershipId,
          warehouseId,
        });
      await ctx.db.insert("membershipRoles", {
        orgId: orgA,
        membershipId,
        roleId,
        grantedAt: 0,
      });
    });
    return t.withIdentity({ subject: `user_${key}`, org_id: "org_fixture_a" });
  };

  return {
    ...world,
    actorA,
    actorB,
    customerId,
    scans,
    products,
    alpha,
    bravo,
    charlie,
    stamps,
    member,
  };
}

describe("customer workspace reads", () => {
  it("rolls up only permitted warehouses and hides the customer from other organizations", async () => {
    const world = await setup();
    const value = allowed(
      await world.actorA.query(workspace.getCustomerWorkspace, {
        customerId: world.customerId,
      }),
    ) as Workspace;

    expect(value.access).toEqual({
      canManage: true,
      canViewWarehouseData: true,
      canReview: true,
      canScan: true,
    });
    expect(value.warehouses.map(({ warehouseId }) => warehouseId)).toEqual([
      world.alpha,
      world.bravo,
    ]);
    expect(value.scopeAvailable).toBe(true);
    expect(value.rollup).toEqual({
      linkedJobs: { count: 4, complete: true },
      linkedProducts: { count: 2, complete: true },
      storedPallets: { count: 5, complete: true },
      unmappedJobs: { count: 2, complete: true },
      pendingReview: { names: 0, scans: 0, complete: true },
    });
    expect(value.latestJobs.map((job) => job.factoryOrder)).toEqual([
      "FO-A3",
      "FO-B1",
      "FO-A2",
    ]);
    expect(value.latestJobs[2]).toMatchObject({
      productCode: "BC-FO-A2",
      partName: "Part FO-A2",
      warehouseName: "Warehouse ALPHA",
      source: "AI",
      mapped: true,
      locationCode: "A-02-04",
    });
    expect(JSON.stringify(value)).not.toContain("FO-C1");

    expect(
      allowed(
        await world.actorB.query(workspace.getCustomerWorkspace, {
          customerId: world.customerId,
        }),
      ),
    ).toBeNull();
    expect(
      allowed(
        await world.actorB.query(workspace.listCustomerWorkspaceJobs, {
          customerId: world.customerId,
        }),
      ),
    ).toBeNull();
  });

  it("scopes the rollup to one warehouse and reports a forbidden warehouse as unavailable", async () => {
    const world = await setup();
    const bravo = allowed(
      await world.actorA.query(workspace.getCustomerWorkspace, {
        customerId: world.customerId,
        warehouseId: world.bravo,
      }),
    ) as Workspace;
    expect(bravo.rollup).toMatchObject({
      linkedJobs: { count: 1, complete: true },
      linkedProducts: { count: 0, complete: true },
      storedPallets: { count: 0, complete: true },
      unmappedJobs: { count: 0, complete: true },
    });
    expect(bravo.latestJobs.map((job) => job.factoryOrder)).toEqual(["FO-B1"]);

    const forbidden = allowed(
      await world.actorA.query(workspace.getCustomerWorkspace, {
        customerId: world.customerId,
        warehouseId: world.charlie,
      }),
    ) as Workspace;
    expect(forbidden.scopeAvailable).toBe(false);
    expect(forbidden.rollup).toBeUndefined();
    expect(forbidden.latestJobs).toEqual([]);
    expect(forbidden.warehouses).toHaveLength(2);
  });

  it("reads a directly selected warehouse beyond the directory window and marks partial totals", async () => {
    const world = await setup();
    const lastWarehouse = await world.t.run(async (ctx) => {
      const membership = await ctx.db
        .query("memberships")
        .filter((q) =>
          q.and(
            q.eq(q.field("orgId"), world.orgA),
            q.eq(q.field("userId"), world.userA),
          ),
        )
        .unique();
      await ctx.db.patch(membership!._id, { scopeMode: "ORG_WIDE" });
      for (let i = 0; i < 24; i++) {
        const warehouseId = await ctx.db.insert("warehouses", {
          orgId: world.orgA,
          code: `WH-${i}`,
          name: `Warehouse ${i}`,
          status: "ACTIVE",
        });
        await ctx.db.insert("customerWarehouseActivity", {
          orgId: world.orgA,
          customerId: world.customerId,
          warehouseId,
          linkedProductCount: 0,
        });
      }
      const row = await ctx.db
        .query("customerWarehouseActivity")
        .withIndex("by_orgId_customerId_warehouseId", (q) =>
          q.eq("orgId", world.orgA).eq("customerId", world.customerId),
        )
        .order("desc")
        .first();
      const warehouseId = row!.warehouseId;
      const scanId = await ctx.db.insert("finishedGoodsJobScans", {
        orgId: world.orgA,
        warehouseId,
        customerId: world.customerId,
        factoryOrder: "LAST-WH",
        mapped: false,
        productBarcodeText: "LAST",
        locationText: "DOCK",
        source: "MANUAL",
        version: 1,
        ...world.stamps(10000),
      });
      await ctx.db.patch(row!._id, {
        latestJobScanId: scanId,
        latestJobCreatedAt: 10000,
        latestJobFactoryOrder: "LAST-WH",
      });
      return warehouseId;
    });
    const read = async (warehouseId?: string) =>
      allowed(
        await world.actorA.query(workspace.getCustomerWorkspace, {
          customerId: world.customerId,
          ...(warehouseId ? { warehouseId } : {}),
        }),
      ) as Workspace;
    const all = await read();
    expect(all.warehousesComplete).toBe(false);
    expect(all.rollup?.linkedJobs.complete).toBe(false);
    expect(all.rollup?.unmappedJobs.complete).toBe(false);
    expect(all.warehouses.map((w) => w.warehouseId)).not.toContain(
      lastWarehouse,
    );
    const selected = await read(lastWarehouse);
    expect(selected.warehouses.map((w) => w.warehouseId)).toContain(
      lastWarehouse,
    );
    expect(selected.rollup?.linkedJobs.complete).toBe(true);
    expect(selected.latestJobs[0]?.factoryOrder).toBe("LAST-WH");
    expect((await read("malformed")).scopeAvailable).toBe(false);

    const scoped = await world.member(
      "last_only",
      ["masterData.customer.read", "masterData.storageLayout.read"],
      [lastWarehouse],
    );
    const scopedAll = allowed(
      await scoped.query(workspace.getCustomerWorkspace, {
        customerId: world.customerId,
      }),
    ) as Workspace;
    expect(scopedAll.warehouses.map((w) => w.warehouseId)).toEqual([
      lastWarehouse,
    ]);
    expect(scopedAll.rollup?.linkedJobs.complete).toBe(true);
    expect(scopedAll.latestJobs[0]?.factoryOrder).toBe("LAST-WH");
  });

  it("marks stored pallets incomplete when the first warehouse exactly consumes the product budget", async () => {
    const world = await setup();
    await world.t.run(async (ctx) => {
      for (let i = 2; i < 100; i++) {
        const warehouseId = i === 99 ? world.bravo : world.alpha;
        await ctx.db.insert("finishedGoodsProducts", {
          orgId: world.orgA,
          warehouseId,
          sku: `SKU-${i}`,
          name: `Product ${i}`,
          unit: "BOX",
          storageFormat: "PALLET",
          storageCondition: "AMBIENT",
          customerId: world.customerId,
          status: "ACTIVE",
          ...world.stamps(1),
        });
      }
      for (const [warehouseId, linkedProductCount] of [
        [world.alpha, 99],
        [world.bravo, 1],
      ] as const) {
        const row = await ctx.db
          .query("customerWarehouseActivity")
          .withIndex("by_orgId_customerId_warehouseId", (q) =>
            q
              .eq("orgId", world.orgA)
              .eq("customerId", world.customerId)
              .eq("warehouseId", warehouseId),
          )
          .unique();
        await ctx.db.patch(row!._id, { linkedProductCount });
      }
    });
    const all = allowed(
      await world.actorA.query(workspace.getCustomerWorkspace, {
        customerId: world.customerId,
      }),
    ) as Workspace;
    expect(all.rollup?.storedPallets).toEqual({ count: 5, complete: false });
    const alpha = allowed(
      await world.actorA.query(workspace.getCustomerWorkspace, {
        customerId: world.customerId,
        warehouseId: world.alpha,
      }),
    ) as Workspace;
    expect(alpha.rollup?.storedPallets).toEqual({ count: 5, complete: true });
  });

  it("loads the shell for non-overview sections without reading job, stock or review rows", async () => {
    const world = await setup();
    const { value, stats } = await measured<Workspace>(
      world,
      getCustomerWorkspace,
      { customerId: world.customerId, includeOverview: false },
    );
    expect(value.scopeAvailable).toBe(true);
    expect(value.warehouses).toHaveLength(2);
    expect(value.rollup).toBeUndefined();
    for (const table of [
      "finishedGoodsJobScans",
      "finishedGoodsProducts",
      "finishedGoodsProductSummaries",
      "finishedGoodsPallets",
    ]) {
      expect(stats.ranges[table] ?? 0).toBe(0);
      expect(stats.gets[table] ?? 0).toBe(0);
    }
  });

  it("pages linked jobs by mapped and unmapped location within the warehouse scope", async () => {
    const world = await setup();
    const jobs = async (args: {
      filter?: "all" | "mapped" | "unmapped";
      warehouseId?: Id<"warehouses">;
    }) => {
      const orders: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 10; page += 1) {
        const value = allowed(
          await world.actorA.query(workspace.listCustomerWorkspaceJobs, {
            customerId: world.customerId,
            pageSize: 1,
            ...args,
            ...(cursor ? { cursor } : {}),
          }),
        ) as JobsPage;
        orders.push(...value.items.map((job) => job.factoryOrder));
        if (value.isDone) return orders;
        cursor = value.continueCursor;
      }
      throw new Error("jobs did not finish");
    };

    expect((await jobs({})).sort()).toEqual([
      "FO-A1",
      "FO-A2",
      "FO-A3",
      "FO-B1",
    ]);
    expect(await jobs({ filter: "unmapped" })).toEqual(["FO-A3", "FO-A1"]);
    expect((await jobs({ filter: "mapped" })).sort()).toEqual([
      "FO-A2",
      "FO-B1",
    ]);
    expect(await jobs({ filter: "mapped", warehouseId: world.bravo })).toEqual([
      "FO-B1",
    ]);
    expect(await jobs({ warehouseId: world.charlie })).toEqual([]);
  });

  it("lists linked products with stored pallets, positions and zone labels", async () => {
    const world = await setup();
    const palletId = await world.t.run(async (ctx) => {
      const orgId = world.orgA;
      const warehouseId = world.alpha;
      const buildingId = await ctx.db.insert("storageBuildings", {
        orgId,
        warehouseId,
        code: "BLDG-A",
        name: "Building A",
        widthMm: 10000,
        depthMm: 10000,
        defaultFloorHeightMm: 3000,
        floorCount: 1,
        totalHeightMm: 3000,
        grossAreaSqMm: 100000000,
        reservedAreaSqMm: 0,
        usableAreaSqMm: 100000000,
        status: "ACTIVE",
        version: 1,
        ...world.stamps(1),
      });
      const floorId = await ctx.db.insert("storageFloors", {
        orgId,
        warehouseId,
        buildingId,
        floorNumber: 1,
        widthMm: 10000,
        depthMm: 10000,
        heightMm: 3000,
        grossAreaSqMm: 100000000,
        reservedAreaSqMm: 0,
        usableAreaSqMm: 100000000,
        version: 1,
        updatedAt: 1,
        updatedByUserId: world.userA,
      });
      const locationId = await ctx.db.insert("locations", {
        orgId,
        warehouseId,
        code: "BLDG-A-F01-Z01",
        locationType: "FLOOR_BLOCK",
        status: "ACTIVE",
      });
      const zoneId = await ctx.db.insert("storageZones", {
        orgId,
        warehouseId,
        buildingId,
        floorId,
        locationId,
        code: "BLDG-A-F01-Z01",
        label: "A-02",
        qrValue: `ISAS:LOCATION:1:${locationId}`,
        xMm: 1000,
        yMm: 2000,
        widthMm: 2000,
        depthMm: 2000,
        maxStackHeightMm: 3000,
        status: "ACTIVE",
        ...world.stamps(1),
      });
      const pallet = (code: string, status: "STORED" | "AWAITING_PLACEMENT") =>
        ctx.db.insert("finishedGoodsPallets", {
          orgId,
          warehouseId,
          productId: world.products.boxes,
          code,
          quantity: 100,
          status,
          ...world.stamps(1),
        });
      const stored = await pallet("PL-1", "STORED");
      await pallet("PL-2", "AWAITING_PLACEMENT");
      const placementId = await ctx.db.insert("finishedGoodsPlacements", {
        orgId,
        warehouseId,
        palletId: stored,
        buildingId,
        floorId,
        zoneId,
        locationId,
        positionCode: "A-02-04",
        qrValue: "A-02-04",
        xMm: 0,
        yMm: 0,
        zMm: 0,
        widthMm: 1000,
        depthMm: 1200,
        heightMm: 1400,
        rotation: 0,
        status: "STORED",
        ...world.stamps(1),
      });
      await ctx.db.patch(stored, { placementId });
      return stored;
    });

    const value = allowed(
      await world.actorA.query(workspace.listCustomerWorkspaceProducts, {
        customerId: world.customerId,
      }),
    ) as ProductsPage;
    expect(value.isDone).toBe(true);
    expect(value.items.map((product) => product.sku).sort()).toEqual([
      "BX-42",
      "IN-12",
    ]);
    const boxes = value.items.find((product) => product.sku === "BX-42")!;
    expect(boxes).toMatchObject({
      warehouseId: world.alpha,
      warehouseName: "Warehouse ALPHA",
      storedCount: 3,
      hasMorePallets: false,
      zones: ["A-02"],
      pallets: [
        {
          palletId,
          code: "PL-1",
          quantity: 100,
          positionCode: "A-02-04",
          zoneLabel: "A-02",
        },
      ],
    });

    const forbidden = allowed(
      await world.actorA.query(workspace.listCustomerWorkspaceProducts, {
        customerId: world.customerId,
        warehouseId: world.charlie,
      }),
    ) as ProductsPage;
    expect(forbidden.items).toEqual([]);
  });

  it("counts names proposed for this customer only for members who may review them", async () => {
    const world = await setup();
    await world.t.run(async (ctx) => {
      for (const [factoryOrder, customer] of [
        ["FO-R1", "Workspace Buyer"],
        ["FO-R2", "WORKSPACE  buyer"],
        ["FO-R3", "Unrelated Trading"],
      ] as const)
        await ctx.db.insert("finishedGoodsJobScans", {
          orgId: world.orgA,
          warehouseId: world.alpha,
          factoryOrder,
          productBarcodeText: `BC-${factoryOrder}`,
          customer,
          customerReviewPending: true,
          locationText: "DOCK",
          mapped: false,
          source: "AI",
          version: 1,
          ...world.stamps(5_000),
        });
    });
    const manager = allowed(
      await world.actorA.query(workspace.getCustomerWorkspace, {
        customerId: world.customerId,
      }),
    ) as Workspace;
    expect(manager.rollup?.pendingReview).toEqual({
      names: 1,
      scans: 2,
      complete: true,
    });
    const otherScope = allowed(
      await world.actorA.query(workspace.getCustomerWorkspace, {
        customerId: world.customerId,
        warehouseId: world.bravo,
      }),
    ) as Workspace;
    expect(otherScope.rollup?.pendingReview).toEqual({
      names: 0,
      scans: 0,
      complete: true,
    });

    const readOnly = await world.member(
      "read_only",
      ["masterData.customer.read", "masterData.storageLayout.read"],
      [world.alpha],
    );
    const value = allowed(
      await readOnly.query(workspace.getCustomerWorkspace, {
        customerId: world.customerId,
      }),
    ) as Workspace;
    expect(value.access).toEqual({
      canManage: false,
      canViewWarehouseData: true,
      canReview: false,
      canScan: false,
    });
    expect(value.rollup).toBeDefined();
    expect(value.rollup?.pendingReview).toBeUndefined();

    const customer = allowed(
      await readOnly.query(api.customers.catalogue.getCustomer, {
        customerId: world.customerId,
      }),
    ) as Record<string, unknown>;
    expect(customer).toMatchObject({
      name: "Workspace Buyer",
      deliveryAddress: { label: "Bang Phli gate 3", province: "Bangkok" },
    });
    expect(customer).not.toHaveProperty("taxId");
    expect(customer).not.toHaveProperty("taxIdChecksumValid");
    expect(
      allowed(
        await world.actorA.query(api.customers.catalogue.getCustomer, {
          customerId: world.customerId,
        }),
      ),
    ).toMatchObject({ taxId: "0105553012341", taxIdChecksumValid: true });
  });

  it("gives catalogue-only members identity but no warehouse data", async () => {
    const world = await setup();
    const catalogueOnly = await world.member(
      "catalogue_only",
      ["masterData.customer.read"],
      [world.alpha],
    );
    const value = allowed(
      await catalogueOnly.query(workspace.getCustomerWorkspace, {
        customerId: world.customerId,
      }),
    ) as Workspace;
    expect(value).toEqual({
      access: {
        canManage: false,
        canViewWarehouseData: false,
        canReview: false,
        canScan: false,
      },
      warehouses: [],
      warehousesComplete: true,
      scopeAvailable: true,
      latestJobs: [],
    });
    await world.t.run((ctx) =>
      ctx.db.insert("customerAliases", {
        orgId: world.orgA,
        customerId: world.customerId,
        alias: "Ticket name",
        normalizedAlias: "ticket name",
        approvedAt: 1,
        approvedByUserId: world.userA,
      }),
    );
    const aliases = await catalogueOnly.query(
      api.customers.linking.listCustomerAliasesPage,
      { customerId: world.customerId },
    );
    expect(allowed(aliases)).toEqual({
      items: [],
      isDone: true,
      continueCursor: "",
    });
    const oldActivity = await catalogueOnly.query(
      api.customers.linking.getCustomerActivity,
      { customerId: world.customerId },
    );
    expect(allowed(oldActivity)).toMatchObject({
      aliases: [],
      hasMoreAliases: false,
    });
    const noWarehouseData = {
      canViewWarehouseData: false,
      items: [],
      isDone: true,
      continueCursor: "",
    };
    const args = { customerId: world.customerId };
    expect(
      allowed(
        await catalogueOnly.query(workspace.listCustomerWorkspaceJobs, args),
      ),
    ).toEqual(noWarehouseData);
    expect(
      allowed(
        await catalogueOnly.query(
          workspace.listCustomerWorkspaceProducts,
          args,
        ),
      ),
    ).toEqual(noWarehouseData);
    expect(
      allowed(
        await catalogueOnly.query(api.customers.catalogue.getCustomer, {
          customerId: world.customerId,
        }),
      ),
    ).toMatchObject({ name: "Workspace Buyer" });
  });
});
