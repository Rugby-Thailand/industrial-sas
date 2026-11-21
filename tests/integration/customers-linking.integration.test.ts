import { describe, expect, it } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { compactCustomerStem } from "../../convex/model/customers/customers";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTestModuleMap,
} from "../fixtures/convex-tenant-world";

const MODULES: ConvexTestModuleMap = {
  "../convex/customers/backfill.ts": () =>
    import("../../convex/customers/backfill"),
  "../convex/customers/catalogue.ts": () =>
    import("../../convex/customers/catalogue"),
  "../convex/customers/linking.ts": () =>
    import("../../convex/customers/linking"),
  "../convex/customers/writes.ts": () =>
    import("../../convex/customers/writes"),
  "../convex/finishedGoods/jobScans.ts": () =>
    import("../../convex/finishedGoods/jobScans"),
  "../convex/finishedGoods/workflow.ts": () =>
    import("../../convex/finishedGoods/workflow"),
};
const catalogue = api.customers.catalogue;
const linking = api.customers.linking;
const writes = api.customers.writes;
const jobScans = api.finishedGoods.jobScans;
const workflow = api.finishedGoods.workflow;

function allowed<T>(outcome: { ok: true; value: T } | { ok: false }): T {
  if (!outcome.ok) throw new Error("Expected allowed tenant outcome");
  return outcome.value;
}

async function setup() {
  const world = await createConvexTenantWorld(MODULES);
  const auth = await seedConvexAuthorization(world, {
    roleA: "ORG_ADMIN",
    roleB: "ORG_ADMIN",
  });
  const actorA = world.t.withIdentity({
    subject: "user_fixture_a",
    org_id: "org_fixture_a",
  });
  const actorB = world.t.withIdentity({
    subject: "user_fixture_a",
    org_id: "org_fixture_b",
  });
  const createCustomer = async (
    actor: typeof actorA,
    name: string,
    requestId: string,
    extra: Record<string, unknown> = {},
  ) => {
    const res = allowed(
      await actor.mutation(writes.createCustomer, {
        requestId,
        name,
        ...extra,
      }),
    );
    if (!res.ok) throw new Error(res.code);
    return res.customerId as Id<"customers">;
  };
  const saveScan = async (
    actor: typeof actorA,
    warehouseId: Id<"warehouses">,
    requestId: string,
    factoryOrder: string,
    customer?: string,
  ) => {
    const res = allowed(
      await actor.mutation(jobScans.saveJobScans, {
        warehouseId,
        requestId,
        locationText: "DOCK-1",
        items: [
          {
            factoryOrder,
            productBarcodeText: `BC-${factoryOrder}`,
            ...(customer === undefined ? {} : { customer }),
            source: "AI",
          },
        ],
      }),
    );
    if (!res.written) throw new Error(res.error.code);
    return res.documentId as Id<"finishedGoodsJobScans">;
  };
  return { ...world, auth, actorA, actorB, createCustomer, saveScan };
}

describe("customer v2 linking model and backend", () => {
  it("normalizes compact Thai and English legal stems for suggestions without touching exact matching", () => {
    expect(compactCustomerStem("บริษัท ไทยรุ่งเรืองบรรจุภัณฑ์ จำกัด")).toBe(
      "ไทยรุ่งเรืองบรรจุภัณฑ์",
    );
    expect(compactCustomerStem("บจก.ไทยรุ่งเรือง บรรจุภัณฑ์")).toBe(
      "ไทยรุ่งเรืองบรรจุภัณฑ์",
    );
    expect(compactCustomerStem("Siam Box Co., Ltd.")).toBe("siambox");
  });

  it("auto-links exact active canonical names and approved aliases on scan save while keeping unmatched, ambiguous, archived and blank scans unlinked", async () => {
    const { t, actorA, warehouses, createCustomer, saveScan } = await setup();
    const alpha = warehouses.alphaA;

    const acmeId = await createCustomer(
      actorA,
      "บริษัท ไทยรุ่งเรืองบรรจุภัณฑ์ จำกัด",
      "cust-1",
      { deliveryAddress: { province: "ชลบุรี" } },
    );
    const archivedId = await createCustomer(
      actorA,
      "Old Archived Co",
      "cust-archived",
    );
    allowed(
      await actorA.mutation(writes.archiveCustomer, {
        requestId: "archive-old",
        customerId: archivedId,
        expectedVersion: 1,
      }),
    );

    // Duplicate-name active customers (ambiguous).
    const dup1 = await createCustomer(actorA, "Shared Name", "cust-dup-1");
    const dup2 = await createCustomer(actorA, "Shared Name", "cust-dup-2");

    // Approved alias on acme, plus a shared alias across two customers.
    const aliasAdd = allowed(
      await actorA.mutation(linking.addCustomerAlias, {
        requestId: "alias-1",
        customerId: acmeId,
        alias: "บจก.ไทยรุ่งเรือง",
      }),
    );
    expect(aliasAdd).toMatchObject({ ok: true, replayed: false });
    // Duplicate alias on same customer is refused.
    expect(
      allowed(
        await actorA.mutation(linking.addCustomerAlias, {
          requestId: "alias-1-dup",
          customerId: acmeId,
          alias: "  บจก.ไทยรุ่งเรือง  ",
        }),
      ),
    ).toEqual({ ok: false, code: "DUPLICATE_KEY", field: "alias" });

    // Shared alias across dup1 and dup2 must stay in review!
    allowed(
      await actorA.mutation(linking.addCustomerAlias, {
        requestId: "shared-alias-1",
        customerId: dup1,
        alias: "Nickname X",
      }),
    );
    allowed(
      await actorA.mutation(linking.addCustomerAlias, {
        requestId: "shared-alias-2",
        customerId: dup2,
        alias: "nickname x",
      }),
    );

    const scanCanonical = await saveScan(
      actorA,
      alpha,
      "scan-canonical",
      "FO-001",
      "  บริษัท  ไทยรุ่งเรืองบรรจุภัณฑ์ จำกัด ",
    );
    const scanAlias = await saveScan(
      actorA,
      alpha,
      "scan-alias",
      "FO-002",
      "บจก.ไทยรุ่งเรือง",
    );
    const scanUnmatched = await saveScan(
      actorA,
      alpha,
      "scan-unmatched",
      "FO-003",
      "Weird AI Text /// 999 ???",
    );
    const scanAmbiguousName = await saveScan(
      actorA,
      alpha,
      "scan-ambig-name",
      "FO-004",
      "Shared Name",
    );
    const scanAmbiguousAlias = await saveScan(
      actorA,
      alpha,
      "scan-ambig-alias",
      "FO-005",
      "NICKNAME X",
    );
    const scanArchived = await saveScan(
      actorA,
      alpha,
      "scan-archived",
      "FO-006",
      "Old Archived Co",
    );
    const scanBlank = await saveScan(actorA, alpha, "scan-blank", "FO-007");

    const loaded = await t.run(async (ctx) => ({
      canonical: await ctx.db.get(scanCanonical),
      alias: await ctx.db.get(scanAlias),
      unmatched: await ctx.db.get(scanUnmatched),
      ambigName: await ctx.db.get(scanAmbiguousName),
      ambigAlias: await ctx.db.get(scanAmbiguousAlias),
      archived: await ctx.db.get(scanArchived),
      blank: await ctx.db.get(scanBlank),
    }));

    expect(loaded.canonical).toMatchObject({
      customer: "บริษัท  ไทยรุ่งเรืองบรรจุภัณฑ์ จำกัด",
      customerId: acmeId,
      customerLinkSource: "AUTO",
    });
    expect(loaded.alias).toMatchObject({
      customer: "บจก.ไทยรุ่งเรือง",
      customerId: acmeId,
      customerLinkSource: "AUTO",
    });
    expect(loaded.unmatched?.customerId).toBeUndefined();
    expect(loaded.unmatched?.customerLinkSource).toBeUndefined();
    expect(loaded.unmatched?.customer).toBe("Weird AI Text /// 999 ???");
    expect(loaded.ambigName?.customerId).toBeUndefined();
    expect(loaded.ambigAlias?.customerId).toBeUndefined();
    expect(loaded.archived?.customerId).toBeUndefined();
    expect(loaded.blank?.customerId).toBeUndefined();

    // Alias search finds the customer in listCustomersPage and shows latest job.
    const searched = allowed(
      await actorA.query(catalogue.listCustomersPage, {
        search: "บจก.ไทยรุ่ง",
        pageSize: 20,
      }),
    );
    expect(searched.status).toBe("ready");
    expect(searched.page).toHaveLength(1);
    expect(searched.page[0]).toMatchObject({
      customerId: acmeId,
      latestJob: {
        jobScanId: scanAlias,
        factoryOrder: "FO-002",
        warehouseId: alpha,
      },
    });

    // Idempotency replay of scanUnmatched after a customer is created later still replays cleanly.
    await createCustomer(actorA, "Weird AI Text /// 999 ???", "cust-later");
    const replayed = allowed(
      await actorA.mutation(jobScans.saveJobScans, {
        warehouseId: alpha,
        requestId: "scan-unmatched",
        locationText: "DOCK-1",
        items: [
          {
            factoryOrder: "FO-003",
            productBarcodeText: "BC-FO-003",
            customer: "Weird AI Text /// 999 ???",
            source: "AI",
          },
        ],
      }),
    );
    expect(replayed).toMatchObject({
      written: true,
      documentId: scanUnmatched,
      replayed: true,
    });
  });

  it("never auto-links product customerReference, preserves links on unrelated edits, and supports explicit SET/CLEAR", async () => {
    const { t, actorA, actorB, warehouses, createCustomer } = await setup();
    const alpha = warehouses.alphaA;
    const customerId = await createCustomer(actorA, "PART-9988-X", "cust-part");
    const foreignCustomerId = await createCustomer(
      actorB,
      "Foreign Customer",
      "cust-foreign",
    );

    // Save product whose customerReference matches customer name — must NOT auto-link!
    const created = allowed(
      await actorA.mutation(workflow.saveProduct, {
        warehouseId: alpha,
        requestId: "prod-1",
        sku: "SKU-001",
        name: "Corrugated Box",
        unit: "PCS",
        storageCondition: "ANY",
        customerReference: "PART-9988-X",
        draft: false,
      }),
    );
    expect(created.written).toBe(true);
    const productId = (created as { written: true; documentId: string })
      .documentId as Id<"finishedGoodsProducts">;
    const before = await t.run((ctx) => ctx.db.get(productId));
    expect(before?.customerId).toBeUndefined();
    expect(before?.customerLinkSource).toBeUndefined();
    expect(before?.customerReference).toBe("PART-9988-X");

    // Cross-org customer link is refused.
    const crossOrg = allowed(
      await actorA.mutation(workflow.saveProduct, {
        warehouseId: alpha,
        productId,
        expectedUpdatedAt: before!.updatedAt,
        requestId: "prod-foreign",
        sku: "SKU-001",
        name: "Corrugated Box",
        unit: "PCS",
        storageCondition: "ANY",
        customerReference: "PART-9988-X",
        customerLink: { action: "SET", customerId: foreignCustomerId },
        draft: false,
      }),
    );
    expect(crossOrg).toMatchObject({
      written: false,
      error: { code: "NOT_FOUND", field: "customerId" },
    });

    // Explicit SET links product and keeps customerReference untouched.
    const linked = allowed(
      await actorA.mutation(workflow.saveProduct, {
        warehouseId: alpha,
        productId,
        expectedUpdatedAt: before!.updatedAt,
        requestId: "prod-link",
        sku: "SKU-001",
        name: "Corrugated Box",
        unit: "PCS",
        storageCondition: "ANY",
        customerReference: "PART-9988-X",
        customerLink: { action: "SET", customerId },
        draft: false,
      }),
    );
    expect(linked.written).toBe(true);
    const afterLink = await t.run((ctx) => ctx.db.get(productId));
    expect(afterLink).toMatchObject({
      customerId,
      customerLinkSource: "MANUAL",
      customerReference: "PART-9988-X",
    });

    // Unrelated edit without customerLink preserves the link.
    const edited = allowed(
      await actorA.mutation(workflow.saveProduct, {
        warehouseId: alpha,
        productId,
        expectedUpdatedAt: afterLink!.updatedAt,
        requestId: "prod-edit",
        sku: "SKU-001",
        name: "Corrugated Box v2",
        unit: "PCS",
        storageCondition: "ANY",
        customerReference: "PART-9988-X",
        draft: false,
      }),
    );
    expect(edited.written).toBe(true);
    const afterEdit = await t.run((ctx) => ctx.db.get(productId));
    expect(afterEdit).toMatchObject({
      customerId,
      customerLinkSource: "MANUAL",
      name: "Corrugated Box v2",
    });

    // Customer detail activity reports the linked product.
    const activity = allowed(
      await actorA.query(linking.getCustomerActivity, { customerId }),
    );
    expect(activity?.linkedProducts).toMatchObject([
      { productId, sku: "SKU-001", name: "Corrugated Box v2" },
    ]);

    // Explicit CLEAR unlinks product.
    const cleared = allowed(
      await actorA.mutation(workflow.saveProduct, {
        warehouseId: alpha,
        productId,
        expectedUpdatedAt: afterEdit!.updatedAt,
        requestId: "prod-clear",
        sku: "SKU-001",
        name: "Corrugated Box v2",
        unit: "PCS",
        storageCondition: "ANY",
        customerReference: "PART-9988-X",
        customerLink: { action: "CLEAR" },
        draft: false,
      }),
    );
    expect(cleared.written).toBe(true);
    const afterClear = await t.run((ctx) => ctx.db.get(productId));
    expect(afterClear?.customerId).toBeUndefined();
    expect(afterClear?.customerLinkSource).toBe("UNLINKED");
  });

  it("handles job-scan corrections: reevaluates AUTO links, preserves MANUAL links, and supports explicit SET/CLEAR", async () => {
    const { t, actorA, warehouses, createCustomer, saveScan } = await setup();
    const alpha = warehouses.alphaA;
    const cust1 = await createCustomer(actorA, "Alpha Co", "cust-a");
    const cust2 = await createCustomer(actorA, "Beta Co", "cust-b");

    const scanId = await saveScan(actorA, alpha, "scan-1", "FO-10", "Alpha Co");
    let doc = await t.run((ctx) => ctx.db.get(scanId));
    expect(doc).toMatchObject({
      customerId: cust1,
      customerLinkSource: "AUTO",
    });

    // Changing captured text on an AUTO link reevaluates to cust2.
    allowed(
      await actorA.mutation(jobScans.updateJobScan, {
        warehouseId: alpha,
        jobScanId: scanId,
        requestId: "corr-1",
        expectedVersion: doc!.version ?? 1,
        fields: {
          factoryOrder: "FO-10",
          productBarcodeText: "BC-FO-10",
          customer: "Beta Co",
        },
      }),
    );
    doc = await t.run((ctx) => ctx.db.get(scanId));
    expect(doc).toMatchObject({
      customer: "Beta Co",
      customerId: cust2,
      customerLinkSource: "AUTO",
    });

    // Explicit SET sets MANUAL; subsequent text edit preserves MANUAL link!
    allowed(
      await actorA.mutation(jobScans.updateJobScan, {
        warehouseId: alpha,
        jobScanId: scanId,
        requestId: "corr-2",
        expectedVersion: doc!.version ?? 1,
        fields: {
          factoryOrder: "FO-10",
          productBarcodeText: "BC-FO-10",
          customer: "Beta Co",
        },
        customerLink: { action: "SET", customerId: cust1 },
      }),
    );
    doc = await t.run((ctx) => ctx.db.get(scanId));
    expect(doc).toMatchObject({
      customerId: cust1,
      customerLinkSource: "MANUAL",
    });

    allowed(
      await actorA.mutation(jobScans.updateJobScan, {
        warehouseId: alpha,
        jobScanId: scanId,
        requestId: "corr-3",
        expectedVersion: doc!.version ?? 1,
        fields: {
          factoryOrder: "FO-10",
          productBarcodeText: "BC-FO-10",
          customer: "Beta Co (typo fixed)",
        },
      }),
    );
    doc = await t.run((ctx) => ctx.db.get(scanId));
    expect(doc).toMatchObject({
      customer: "Beta Co (typo fixed)",
      customerId: cust1,
      customerLinkSource: "MANUAL",
    });

    // Explicit CLEAR unlinks.
    allowed(
      await actorA.mutation(jobScans.updateJobScan, {
        warehouseId: alpha,
        jobScanId: scanId,
        requestId: "corr-4",
        expectedVersion: doc!.version ?? 1,
        fields: {
          factoryOrder: "FO-10",
          productBarcodeText: "BC-FO-10",
          customer: "Beta Co (typo fixed)",
        },
        customerLink: { action: "CLEAR" },
      }),
    );
    doc = await t.run((ctx) => ctx.db.get(scanId));
    expect(doc?.customerId).toBeUndefined();
    expect(doc?.customerLinkSource).toBe("UNLINKED");
  });

  it("groups unresolved names, links with optional alias remembrance, skips, enforces versions and warehouse scope", async () => {
    const { t, actorA, warehouses, createCustomer, saveScan } = await setup();
    const alpha = warehouses.alphaA;
    const customerId = await createCustomer(
      actorA,
      "บริษัท ไทยรุ่งเรืองบรรจุภัณฑ์ จำกัด",
      "cust-trr",
    );

    const scan1 = await saveScan(
      actorA,
      alpha,
      "rev-scan-1",
      "FO-201",
      "บจก.ไทยรุ่งเรือง บรรจุภัณฑ์",
    );
    const scan2 = await saveScan(
      actorA,
      alpha,
      "rev-scan-2",
      "FO-202",
      "บจก.ไทยรุ่งเรือง บรรจุภัณฑ์",
    );
    const scanSkip = await saveScan(
      actorA,
      alpha,
      "rev-scan-3",
      "FO-203",
      "Walk-in Cash",
    );

    const summary = allowed(await actorA.query(linking.reviewSummary, {}));
    expect(summary).toMatchObject({
      canViewWarehouseData: true,
      canReview: true,
      unresolvedNameCount: 2,
      unresolvedScanCount: 3,
    });

    const queue = allowed(await actorA.query(linking.listUnresolvedNames, {}));
    expect(queue.groups).toHaveLength(2);
    const trrGroup = queue.groups.find(
      (g) => g.displayName === "บจก.ไทยรุ่งเรือง บรรจุภัณฑ์",
    );
    expect(trrGroup).toMatchObject({
      scanCount: 2,
      matchKind: "SIMILAR",
      candidates: [{ customerId }],
    });

    // Stale version fails atomically without writing any scan.
    const stale = allowed(
      await actorA.mutation(linking.resolveUnresolvedScans, {
        requestId: "res-stale",
        action: "LINK",
        customerId,
        scans: [
          { jobScanId: scan1, expectedVersion: 1 },
          { jobScanId: scan2, expectedVersion: 99 },
        ],
      }),
    );
    expect(stale).toEqual({ ok: false, code: "STALE_REVISION" });

    // Link with rememberAlias: true updates scans, keeps captured text, and creates alias.
    const resolved = allowed(
      await actorA.mutation(linking.resolveUnresolvedScans, {
        requestId: "res-link",
        action: "LINK",
        customerId,
        rememberAlias: true,
        aliasText: "บจก.ไทยรุ่งเรือง บรรจุภัณฑ์",
        scans: [
          { jobScanId: scan1, expectedVersion: 1 },
          { jobScanId: scan2, expectedVersion: 1 },
        ],
      }),
    );
    expect(resolved).toMatchObject({
      ok: true,
      updatedCount: 2,
      replayed: false,
    });
    expect(resolved.ok && resolved.aliasId).toBeTruthy();

    // Future scan with that remembered alias auto-links!
    const futureScan = await saveScan(
      actorA,
      alpha,
      "rev-scan-future",
      "FO-204",
      "บจก.ไทยรุ่งเรือง บรรจุภัณฑ์",
    );
    const futureDoc = await t.run((ctx) => ctx.db.get(futureScan));
    expect(futureDoc).toMatchObject({
      customerId,
      customerLinkSource: "AUTO",
      customer: "บจก.ไทยรุ่งเรือง บรรจุภัณฑ์",
    });

    // Skip the walk-in scan removes it from the review queue.
    const skipped = allowed(
      await actorA.mutation(linking.resolveUnresolvedScans, {
        requestId: "res-skip",
        action: "SKIP",
        scans: [{ jobScanId: scanSkip, expectedVersion: 1 }],
      }),
    );
    expect(skipped).toMatchObject({ ok: true, updatedCount: 1 });
    const afterSummary = allowed(await actorA.query(linking.reviewSummary, {}));
    expect(afterSummary.unresolvedScanCount).toBe(0);

    // Retiring an alias stops future auto-link while keeping past linked scans intact.
    if (!resolved.ok || !resolved.aliasId) throw new Error("Expected aliasId");
    allowed(
      await actorA.mutation(linking.removeCustomerAlias, {
        requestId: "remove-alias",
        aliasId: resolved.aliasId as Id<"customerAliases">,
      }),
    );
    const afterRemoveScan = await saveScan(
      actorA,
      alpha,
      "rev-scan-after-remove",
      "FO-205",
      "บจก.ไทยรุ่งเรือง บรรจุภัณฑ์",
    );
    const [pastDoc, newDoc] = await t.run(async (ctx) => [
      await ctx.db.get(futureScan),
      await ctx.db.get(afterRemoveScan),
    ]);
    expect(pastDoc?.customerId).toBe(customerId);
    expect(newDoc?.customerId).toBeUndefined();
  });

  it("runs dry-run and resumable backfill per warehouse, skipping voided and already-decided scans", async () => {
    const { t, actorA, warehouses, createCustomer, saveScan } = await setup();
    const alpha = warehouses.alphaA;

    // Create historical scans BEFORE customers exist so none are auto-linked yet.
    const scanMatch1 = await saveScan(
      actorA,
      alpha,
      "bf-1",
      "FO-301",
      "Siam Packaging",
    );
    const scanMatch2 = await saveScan(
      actorA,
      alpha,
      "bf-2",
      "FO-302",
      "siam packaging",
    );
    const scanAmbig = await saveScan(
      actorA,
      alpha,
      "bf-3",
      "FO-303",
      "Twin Name",
    );
    const scanUnmatched = await saveScan(
      actorA,
      alpha,
      "bf-4",
      "FO-304",
      "Unknown Corp",
    );
    const scanVoided = await saveScan(
      actorA,
      alpha,
      "bf-5",
      "FO-305",
      "Siam Packaging",
    );
    const scanDecided = await saveScan(
      actorA,
      alpha,
      "bf-6",
      "FO-306",
      "Siam Packaging",
    );
    const scanBlank = await saveScan(actorA, alpha, "bf-7", "FO-307");

    // Mark scanVoided as voided and scanDecided as explicitly UNLINKED.
    await t.run(async (ctx) => {
      await ctx.db.patch(scanVoided, { voided: true });
      await ctx.db.patch(scanDecided, { customerLinkSource: "UNLINKED" });
    });

    // Now create customers.
    const siamId = await createCustomer(actorA, "Siam Packaging", "bf-c1");
    await createCustomer(actorA, "Twin Name", "bf-c2");
    await createCustomer(actorA, "Twin Name", "bf-c3");

    // Dry run first: reports exact counts and mutates nothing.
    const dry = await t.mutation(
      internal.customers.backfill.backfillJobScanCustomers,
      { warehouseId: alpha, dryRun: true, batchSize: 50 },
    );
    expect(dry).toMatchObject({
      dryRun: true,
      matched: 2,
      ambiguous: 1,
      archived: 0,
      unmatched: 1,
      skippedVoided: 1,
      skippedDecided: 1,
      skippedBlank: 1,
      updated: 0,
      isDone: true,
    });
    expect(
      (await t.run((ctx) => ctx.db.get(scanMatch1)))?.customerId,
    ).toBeUndefined();

    // Real resumable run with small batchSize=2 pages until isDone.
    let cursor: string | undefined;
    let totalUpdated = 0;
    let batches = 0;
    for (;;) {
      const step = await t.mutation(
        internal.customers.backfill.backfillJobScanCustomers,
        {
          warehouseId: alpha,
          dryRun: false,
          batchSize: 2,
          ...(cursor ? { cursor } : {}),
        },
      );
      totalUpdated += step.updated;
      batches += 1;
      if (step.isDone) break;
      cursor = step.continueCursor;
    }
    expect(batches).toBeGreaterThanOrEqual(4);
    expect(totalUpdated).toBe(2);

    const [m1, m2, amb, unm, voi, dec, blk, audits] = await t.run(
      async (ctx) => [
        await ctx.db.get(scanMatch1),
        await ctx.db.get(scanMatch2),
        await ctx.db.get(scanAmbig),
        await ctx.db.get(scanUnmatched),
        await ctx.db.get(scanVoided),
        await ctx.db.get(scanDecided),
        await ctx.db.get(scanBlank),
        await ctx.db
          .query("auditEvents")
          .filter((q) => q.eq(q.field("action"), "customer.backfill.link"))
          .collect(),
      ],
    );
    expect(m1).toMatchObject({
      customerId: siamId,
      customerLinkSource: "AUTO",
    });
    expect(m2).toMatchObject({
      customerId: siamId,
      customerLinkSource: "AUTO",
    });
    expect(amb?.customerId).toBeUndefined();
    expect(unm?.customerId).toBeUndefined();
    expect(voi?.customerId).toBeUndefined();
    expect(dec).toMatchObject({ customerLinkSource: "UNLINKED" });
    expect(dec?.customerId).toBeUndefined();
    expect(blk?.customerId).toBeUndefined();
    expect(audits).toHaveLength(2);
    expect((audits[0] as Doc<"auditEvents">).actorKind).toBe("SYSTEM");

    // Rerun is idempotent: skips already-linked rows and updates 0.
    const rerun = await t.mutation(
      internal.customers.backfill.backfillJobScanCustomers,
      { warehouseId: alpha, dryRun: false, batchSize: 50 },
    );
    expect(rerun).toMatchObject({
      matched: 0,
      updated: 0,
      skippedDecided: 3,
      isDone: true,
    });
  });

  it("hides warehouse activity for customer-only readers and denies unauthorized warehouse resolution", async () => {
    const { t, orgA, actorA, warehouses, createCustomer, saveScan } =
      await setup();
    const alpha = warehouses.alphaA;
    const customerId = await createCustomer(actorA, "Scoped Buyer", "sc-1");
    const scanId = await saveScan(
      actorA,
      alpha,
      "sc-scan-1",
      "FO-401",
      "Scoped Unmatched",
    );
    await saveScan(actorA, alpha, "sc-scan-2", "FO-402", "Scoped Buyer");

    // Create a customer-only manager (no storageLayout grants).
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        clerkUserId: "user_customer_only",
        displayName: "Customer Only",
        status: "ACTIVE",
      });
      const roleId = await ctx.db.insert("roles", {
        orgId: orgA,
        key: "CUSTOMER_ONLY",
        name: "Customer only",
        status: "ACTIVE",
        seeded: false,
      });
      await ctx.db.insert("rolePermissions", {
        orgId: orgA,
        roleId,
        permissionCode: "masterData.customer.read",
      });
      await ctx.db.insert("rolePermissions", {
        orgId: orgA,
        roleId,
        permissionCode: "masterData.customer.manage",
      });
      const membershipId = await ctx.db.insert("memberships", {
        orgId: orgA,
        userId,
        clerkMembershipId: "mem_customer_only",
        status: "ACTIVE",
        scopeMode: "ORG_WIDE",
        effectiveFrom: 0,
      });
      await ctx.db.insert("membershipRoles", {
        orgId: orgA,
        membershipId,
        roleId,
        grantedAt: 0,
      });
    });

    const customerOnly = t.withIdentity({
      subject: "user_customer_only",
      org_id: "org_fixture_a",
    });

    const activity = allowed(
      await customerOnly.query(linking.getCustomerActivity, { customerId }),
    );
    expect(activity).toMatchObject({
      canViewWarehouseData: false,
      recentJobs: [],
      linkedProducts: [],
    });

    const review = allowed(await customerOnly.query(linking.reviewSummary, {}));
    expect(review).toMatchObject({
      canViewWarehouseData: false,
      canReview: false,
      unresolvedScanCount: 0,
    });

    // Attempting to resolve warehouse scans without storageLayout.manage is denied.
    const denied = allowed(
      await customerOnly.mutation(linking.resolveUnresolvedScans, {
        requestId: "denied-resolve",
        action: "LINK",
        customerId,
        scans: [{ jobScanId: scanId, expectedVersion: 1 }],
      }),
    );
    expect(denied).toEqual({ ok: false, code: "ACCESS_DENIED" });
  });
});
