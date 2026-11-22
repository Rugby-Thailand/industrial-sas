import { describe, expect, it, vi } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { listCustomersPage } from "../../convex/customers/catalogue";
import { listCustomerActivitySummaries } from "../../convex/customers/linking";
import { compactCustomerStem } from "../../convex/model/customers/customers";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTestModuleMap,
} from "../fixtures/convex-tenant-world";
import { measured } from "../fixtures/query-read-stats";

const MODULES: ConvexTestModuleMap = {
  "../convex/customers/backfill.ts": () =>
    import("../../convex/customers/backfill"),
  "../convex/customers/catalogue.ts": () =>
    import("../../convex/customers/catalogue"),
  "../convex/customers/linking.ts": () =>
    import("../../convex/customers/linking"),
  "../convex/customers/writes.ts": () =>
    import("../../convex/customers/writes"),
  "../convex/finishedGoods/batches.ts": () =>
    import("../../convex/finishedGoods/batches"),
  "../convex/finishedGoods/batchManagement.ts": () =>
    import("../../convex/finishedGoods/batchManagement"),
  "../convex/finishedGoods/catalogue.ts": () =>
    import("../../convex/finishedGoods/catalogue"),
  "../convex/finishedGoods/jobScans.ts": () =>
    import("../../convex/finishedGoods/jobScans"),
  "../convex/finishedGoods/summaryMaintenance.ts": () =>
    import("../../convex/finishedGoods/summaryMaintenance"),
  "../convex/finishedGoods/workflow.ts": () =>
    import("../../convex/finishedGoods/workflow"),
};
const catalogue = api.customers.catalogue;
const linking = api.customers.linking;
const writes = api.customers.writes;
const fgCatalogue = api.finishedGoods.catalogue;
const fgBatches = api.finishedGoods.batches;
const fgBatchMgmt = api.finishedGoods.batchManagement;
const fgSummaryMaint = api.finishedGoods.summaryMaintenance;
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

  it("refuses an alias beyond capacity before changing the scan or its searchable names", async () => {
    const { actorA, warehouses, createCustomer, saveScan } = await setup();
    const customerId = await createCustomer(
      actorA,
      "At capacity",
      "capacity-customer",
    );
    let firstAlias: string | undefined;
    for (let i = 0; i < 79; i++) {
      const result = allowed(
        await actorA.mutation(linking.addCustomerAlias, {
          customerId,
          requestId: `capacity-fill-${i}`,
          alias: String(i).padEnd(200, "a"),
        }),
      );
      expect(result.ok).toBe(true);
      if (result.ok && !firstAlias) firstAlias = result.aliasId;
    }
    const alias = "remaining".padEnd(200, "z");
    const add = { customerId, alias, requestId: "beyond-capacity" };
    expect(
      allowed(await actorA.mutation(linking.addCustomerAlias, add)),
    ).toMatchObject({ ok: false, code: "ALIAS_CAPACITY" });
    const jobScanId = await saveScan(
      actorA,
      warehouses.alphaA,
      "capacity-intake",
      "FO-CAP",
      alias,
    );
    const decision = {
      action: "LINK" as const,
      customerId,
      requestId: "capacity-review",
      rememberAlias: true,
      scans: [{ jobScanId, expectedVersion: 1 }],
    };
    expect(
      allowed(await actorA.mutation(linking.resolveUnresolvedScans, decision)),
    ).toMatchObject({ ok: false, code: "ALIAS_CAPACITY" });
    expect(
      allowed(
        await actorA.mutation(linking.removeCustomerAlias, {
          aliasId: firstAlias as Id<"customerAliases">,
          requestId: "capacity-release",
        }),
      ).ok,
    ).toBe(true);
    expect(
      allowed(await actorA.mutation(linking.resolveUnresolvedScans, decision)),
    ).toMatchObject({ ok: true, updatedCount: 1 });
    expect(
      allowed(
        await actorA.query(catalogue.listCustomersPage, {
          search: alias.slice(0, 10),
          pageSize: 20,
        }),
      ).page.map((row) => row.customerId),
    ).toEqual([customerId]);
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
      customer: "  บริษัท  ไทยรุ่งเรืองบรรจุภัณฑ์ จำกัด ",
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
    expect(loaded.unmatched?.customerReviewPending).toBe(true);
    expect(loaded.unmatched?.customer).toBe("Weird AI Text /// 999 ???");
    expect(loaded.ambigName?.customerId).toBeUndefined();
    expect(loaded.ambigName?.customerReviewPending).toBe(true);
    expect(loaded.ambigAlias?.customerId).toBeUndefined();
    expect(loaded.ambigAlias?.customerReviewPending).toBe(true);
    expect(loaded.archived?.customerId).toBeUndefined();
    expect(loaded.archived?.customerReviewPending).toBe(true);
    expect(loaded.blank?.customerId).toBeUndefined();
    expect(loaded.blank?.customerReviewPending).toBeUndefined();

    // Alias search finds the customer in listCustomersPage (v1 summary fields only)
    // and listCustomerActivitySummaries reports its latest job.
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
    });
    expect(searched.page[0]).not.toHaveProperty("latestJob");
    const summaries = allowed(
      await actorA.query(linking.listCustomerActivitySummaries, {
        customerIds: [acmeId],
      }),
    );
    expect(summaries).toMatchObject({
      canViewWarehouseData: true,
      summaries: [
        {
          customerId: acmeId,
          linkedProductCount: 0,
          latestJob: {
            jobScanId: scanAlias,
            factoryOrder: "FO-002",
            warehouseId: alpha,
          },
        },
      ],
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
      for (const id of [scanMatch1, scanMatch2, scanAmbig, scanUnmatched])
        await ctx.db.patch(id, { customerReviewPending: undefined });
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
    expect(totalUpdated).toBe(4);

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

    // Customer-only user cannot attach an exampleJobScanId to an alias.
    const deniedExample = allowed(
      await customerOnly.mutation(linking.addCustomerAlias, {
        requestId: "denied-example-scan",
        customerId,
        alias: "Scoped Alias",
        exampleJobScanId: scanId,
      }),
    );
    expect(deniedExample).toEqual({
      ok: false,
      code: "ACCESS_DENIED",
      field: "exampleJobScanId",
    });
  });

  it("enforces reverse permissions: warehouse-only staff cannot read or clear customer links across finished-goods queries and mutations", async () => {
    const { t, orgA, actorA, warehouses, createCustomer, saveScan } =
      await setup();
    const alpha = warehouses.alphaA;
    const customerId = await createCustomer(
      actorA,
      "Confidential Buyer Co",
      "rev-cust-1",
    );

    // Seed a linked product, batch, pallet, and linked job scan with correction history.
    const prodWrite = allowed(
      await actorA.mutation(workflow.saveProduct, {
        warehouseId: alpha,
        requestId: "rev-prod-1",
        sku: "SKU-REV-1",
        name: "Confidential Box",
        unit: "PCS",
        storageFormat: "PALLET",
        defaultQuantity: 10,
        storageCondition: "ANY",
        customerReference: "PART-REF-42",
        customerLink: { action: "SET", customerId },
        draft: false,
      }),
    );
    expect(prodWrite.written).toBe(true);
    const productId = (prodWrite as { written: true; documentId: string })
      .documentId as Id<"finishedGoodsProducts">;

    const batchWrite = allowed(
      await actorA.mutation(fgBatches.saveBatchDraft, {
        warehouseId: alpha,
        productId,
        requestId: "rev-batch-1",
        storageFormat: "PALLET",
        totalQuantity: 10,
        packages: [
          {
            quantity: 10,
            dimensionsChecked: true,
            lengthMm: 1000,
            widthMm: 1000,
            heightMm: 1000,
          },
        ],
      }),
    );
    const batchId = (batchWrite as { written: true; documentId: string })
      .documentId as Id<"finishedGoodsBatches">;

    const palletWrite = allowed(
      await actorA.mutation(workflow.createPallet, {
        warehouseId: alpha,
        productId,
        requestId: "rev-pallet-1",
      }),
    );
    const palletId = (palletWrite as { written: true; documentId: string })
      .documentId as Id<"finishedGoodsPallets">;

    allowed(
      await actorA.mutation(fgSummaryMaint.prepare, { warehouseId: alpha }),
    );

    const scanId = await saveScan(
      actorA,
      alpha,
      "rev-scan-1",
      "FO-REV-1",
      "Confidential Buyer Co",
    );
    const scanBefore = await t.run((ctx) => ctx.db.get(scanId));
    allowed(
      await actorA.mutation(jobScans.updateJobScan, {
        warehouseId: alpha,
        jobScanId: scanId,
        requestId: "rev-scan-corr",
        expectedVersion: scanBefore!.version ?? 1,
        fields: {
          factoryOrder: "FO-REV-1",
          productBarcodeText: "BC-FO-REV-1",
          customer: "Confidential Buyer Co",
          partName: "Box Updated",
        },
        customerLink: { action: "SET", customerId },
      }),
    );

    // Create a warehouse-only manager (storageLayout.read + manage, NO customer grants).
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        clerkUserId: "user_warehouse_only",
        displayName: "Warehouse Only",
        status: "ACTIVE",
      });
      const roleId = await ctx.db.insert("roles", {
        orgId: orgA,
        key: "WAREHOUSE_ONLY",
        name: "Warehouse only",
        status: "ACTIVE",
        seeded: false,
      });
      await ctx.db.insert("rolePermissions", {
        orgId: orgA,
        roleId,
        permissionCode: "masterData.storageLayout.read",
      });
      await ctx.db.insert("rolePermissions", {
        orgId: orgA,
        roleId,
        permissionCode: "masterData.storageLayout.manage",
      });
      const membershipId = await ctx.db.insert("memberships", {
        orgId: orgA,
        userId,
        clerkMembershipId: "mem_warehouse_only",
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

    const whOnly = t.withIdentity({
      subject: "user_warehouse_only",
      org_id: "org_fixture_a",
    });

    // All product read surfaces strip customerId & customerLinkSource while keeping customerReference.
    const gotProduct = allowed(
      await whOnly.query(workflow.getProduct, {
        warehouseId: alpha,
        productId,
      }),
    );
    expect(gotProduct).toMatchObject({ customerReference: "PART-REF-42" });
    expect(gotProduct).not.toHaveProperty("customerId");
    expect(gotProduct).not.toHaveProperty("customerLinkSource");

    const gotPallet = allowed(
      await whOnly.query(workflow.getPallet, { warehouseId: alpha, palletId }),
    );
    expect(gotPallet?.product).not.toHaveProperty("customerId");
    expect(gotPallet?.product).not.toHaveProperty("customerLinkSource");

    const foundSku = allowed(
      await whOnly.query(fgCatalogue.findSku, {
        warehouseId: alpha,
        sku: "SKU-REV-1",
      }),
    );
    expect(foundSku).not.toHaveProperty("customerId");
    expect(foundSku).not.toHaveProperty("customerLinkSource");

    const cataloguePage = allowed(
      await whOnly.query(fgCatalogue.page, {
        warehouseId: alpha,
        tab: "products",
        pageSize: 20,
        search: "",
        locale: "en",
        filters: {
          record: "",
          unit: "",
          quantity: { min: "", max: "" },
          formats: [],
          progress: [],
          statuses: [],
          lot: "",
          measurement: "",
          length: { min: "", max: "" },
          width: { min: "", max: "" },
          height: { min: "", max: "" },
          sort: "",
        },
      }),
    );
    expect(cataloguePage.products).toHaveLength(1);
    expect(cataloguePage.products[0]).not.toHaveProperty("customerId");
    expect(cataloguePage.products[0]).not.toHaveProperty("customerLinkSource");

    const gotBatch = allowed(
      await whOnly.query(fgBatches.getBatch, { warehouseId: alpha, batchId }),
    );
    expect(gotBatch?.product).not.toHaveProperty("customerId");
    const gotBatchMgmt = allowed(
      await whOnly.query(fgBatchMgmt.get, { warehouseId: alpha, batchId }),
    );
    expect(gotBatchMgmt?.product).not.toHaveProperty("customerId");

    // Job-scan list and correction history strip customer link metadata & history diffs.
    const listedScans = allowed(
      await whOnly.query(jobScans.listJobScans, {
        warehouseId: alpha,
        filter: "ALL",
        pageSize: 20,
      }),
    );
    expect(listedScans.items).toHaveLength(1);
    expect(listedScans.items[0]).not.toHaveProperty("customerId");
    expect(listedScans.items[0]).not.toHaveProperty("customerLinkSource");
    expect(listedScans.items[0]).not.toHaveProperty("customerName");
    expect(listedScans.items[0]).not.toHaveProperty("customerCode");

    const corrections = allowed(
      await whOnly.query(jobScans.listJobScanCorrections, {
        warehouseId: alpha,
        jobScanId: scanId,
      }),
    );
    expect(corrections?.current).not.toHaveProperty("customerId");
    expect(corrections?.current).not.toHaveProperty("customerLinkSource");
    const leakedDiffFields = (corrections?.items ?? []).flatMap((item) =>
      item.changes.map((c) => c.field),
    );
    expect(leakedDiffFields).not.toContain("customerId");
    expect(leakedDiffFields).not.toContain("customerLinkSource");
    expect(leakedDiffFields).toContain("partName");

    // Warehouse-only staff are DENIED CLEAR on both saveProduct and updateJobScan.
    const prodDoc = await t.run((ctx) => ctx.db.get(productId));
    expect(
      allowed(
        await whOnly.mutation(workflow.saveProduct, {
          warehouseId: alpha,
          productId,
          expectedUpdatedAt: prodDoc!.updatedAt,
          requestId: "wh-clear-prod",
          sku: "SKU-REV-1",
          name: "Confidential Box",
          unit: "PCS",
          storageCondition: "ANY",
          customerLink: { action: "CLEAR" },
          draft: false,
        }),
      ),
    ).toMatchObject({
      written: false,
      error: { code: "ACCESS_DENIED", field: "customerId" },
    });

    const scanDoc = await t.run((ctx) => ctx.db.get(scanId));
    expect(
      allowed(
        await whOnly.mutation(jobScans.updateJobScan, {
          warehouseId: alpha,
          jobScanId: scanId,
          requestId: "wh-clear-scan",
          expectedVersion: scanDoc!.version ?? 1,
          fields: {
            factoryOrder: "FO-REV-1",
            productBarcodeText: "BC-FO-REV-1",
            customer: "Confidential Buyer Co",
          },
          customerLink: { action: "CLEAR" },
        }),
      ),
    ).toMatchObject({
      written: false,
      error: { code: "ACCESS_DENIED", field: "customerId" },
    });

    // Unrelated edits by warehouse-only staff preserve existing customer links.
    expect(
      allowed(
        await whOnly.mutation(workflow.saveProduct, {
          warehouseId: alpha,
          productId,
          expectedUpdatedAt: prodDoc!.updatedAt,
          requestId: "wh-edit-prod",
          sku: "SKU-REV-1",
          name: "Confidential Box Renamed",
          unit: "PCS",
          storageCondition: "ANY",
          draft: false,
        }),
      ).written,
    ).toBe(true);
    expect((await t.run((ctx) => ctx.db.get(productId)))?.customerId).toBe(
      customerId,
    );
  });

  it("hardens alias redaction, deletion replay, review validation, per-scan audits, and replay authorization", async () => {
    const { t, orgA, actorA, warehouses, createCustomer, saveScan } =
      await setup();
    const alpha = warehouses.alphaA;
    const bravo = warehouses.bravoA;
    const customerId = await createCustomer(actorA, "Audit Target Co", "at-1");

    // Seed a scan in bravo (which actorA does NOT have access to if scoped, or create a scoped user).
    const alphaScan1 = await saveScan(
      actorA,
      alpha,
      "aud-s1",
      "FO-A1",
      "Group Alpha",
    );
    const alphaScan2 = await saveScan(
      actorA,
      alpha,
      "aud-s2",
      "FO-A2",
      "Group Alpha",
    );
    const otherNameScan = await saveScan(
      actorA,
      alpha,
      "aud-s3",
      "FO-A3",
      "Different Name",
    );

    // Alias add + remove redact raw alias text in auditEvents, and remove replays cleanly!
    const added = allowed(
      await actorA.mutation(linking.addCustomerAlias, {
        requestId: "alias-redact-add",
        customerId,
        alias: "Secret OCR Nickname 123",
        exampleJobScanId: alphaScan1,
      }),
    );
    expect(added.ok).toBe(true);
    if (!added.ok) throw new Error(added.code);
    const aliasId = added.aliasId as Id<"customerAliases">;

    // getCustomerActivity omits exampleJobScanId from public aliases.
    const activity = allowed(
      await actorA.query(linking.getCustomerActivity, { customerId }),
    );
    expect(activity?.aliases).toEqual([
      {
        aliasId,
        alias: "Secret OCR Nickname 123",
        approvedAt: expect.any(Number),
      },
    ]);
    expect(activity?.aliases[0]).not.toHaveProperty("exampleJobScanId");

    // Delete alias and replay the exact same requestId — must succeed with replayed: true!
    const removed1 = allowed(
      await actorA.mutation(linking.removeCustomerAlias, {
        requestId: "alias-redact-remove",
        aliasId,
      }),
    );
    expect(removed1).toEqual({ ok: true, aliasId, replayed: false });
    const removed2 = allowed(
      await actorA.mutation(linking.removeCustomerAlias, {
        requestId: "alias-redact-remove",
        aliasId,
      }),
    );
    expect(removed2).toEqual({ ok: true, aliasId, replayed: true });

    const aliasAudits = await t.run((ctx) =>
      ctx.db
        .query("auditEvents")
        .filter((q) =>
          q.or(
            q.eq(q.field("action"), "customer.alias.add"),
            q.eq(q.field("action"), "customer.alias.remove"),
          ),
        )
        .collect(),
    );
    expect(aliasAudits).toHaveLength(2);
    expect(JSON.stringify(aliasAudits)).not.toContain(
      "Secret OCR Nickname 123",
    );

    // resolveUnresolvedScans rejects mixed-name batches and unrelated aliasText.
    expect(
      allowed(
        await actorA.mutation(linking.resolveUnresolvedScans, {
          requestId: "res-mixed",
          action: "LINK",
          customerId,
          scans: [
            { jobScanId: alphaScan1, expectedVersion: 1 },
            { jobScanId: otherNameScan, expectedVersion: 1 },
          ],
        }),
      ),
    ).toEqual({ ok: false, code: "MIXED_NAME_GROUP" });

    expect(
      allowed(
        await actorA.mutation(linking.resolveUnresolvedScans, {
          requestId: "res-bad-alias",
          action: "LINK",
          customerId,
          rememberAlias: true,
          aliasText: "Completely Unrelated Alias",
          scans: [{ jobScanId: alphaScan1, expectedVersion: 1 }],
        }),
      ),
    ).toEqual({ ok: false, code: "FIELD_INVALID", field: "aliasText" });

    // Resolving a valid 2-scan group writes per-ticket audit events and returns aliasId on replay.
    const res1 = allowed(
      await actorA.mutation(linking.resolveUnresolvedScans, {
        requestId: "res-valid-group",
        action: "LINK",
        customerId,
        rememberAlias: true,
        aliasText: "Group Alpha",
        scans: [
          { jobScanId: alphaScan1, expectedVersion: 1 },
          { jobScanId: alphaScan2, expectedVersion: 1 },
        ],
      }),
    );
    expect(res1).toMatchObject({
      ok: true,
      updatedCount: 2,
      aliasId: expect.any(String),
      replayed: false,
    });
    if (!res1.ok || !res1.aliasId) throw new Error("missing original alias");
    await actorA.mutation(linking.removeCustomerAlias, {
      aliasId: res1.aliasId as Id<"customerAliases">,
      requestId: "retire-before-replay",
    });
    const resReplay = allowed(
      await actorA.mutation(linking.resolveUnresolvedScans, {
        requestId: "res-valid-group",
        action: "LINK",
        customerId,
        rememberAlias: true,
        aliasText: "Group Alpha",
        scans: [
          { jobScanId: alphaScan1, expectedVersion: 1 },
          { jobScanId: alphaScan2, expectedVersion: 1 },
        ],
      }),
    );
    expect(resReplay).toEqual({
      ok: true,
      updatedCount: 2,
      aliasId: res1.ok ? res1.aliasId : undefined,
      replayed: true,
    });

    const reviewAudits = await t.run((ctx) =>
      ctx.db
        .query("auditEvents")
        .filter((q) => q.eq(q.field("action"), "customer.review.link"))
        .collect(),
    );
    expect(reviewAudits.map((e) => e.entityId).sort()).toEqual(
      [alphaScan1, alphaScan2].sort(),
    );

    // Attempting to resolve an already-resolved scan fails with ALREADY_RESOLVED.
    expect(
      allowed(
        await actorA.mutation(linking.resolveUnresolvedScans, {
          requestId: "res-already",
          action: "SKIP",
          scans: [{ jobScanId: alphaScan1, expectedVersion: 2 }],
        }),
      ),
    ).toEqual({ ok: false, code: "ALREADY_RESOLVED" });

    // Warehouse-scoped manager (only bravo) is denied resolving alpha scans AND denied exampleJobScanId from alpha.
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        clerkUserId: "user_bravo_only",
        displayName: "Bravo Only",
        status: "ACTIVE",
      });
      const roleId = await ctx.db.insert("roles", {
        orgId: orgA,
        key: "BRAVO_MANAGER",
        name: "Bravo manager",
        status: "ACTIVE",
        seeded: false,
      });
      for (const permissionCode of [
        "masterData.customer.read",
        "masterData.customer.manage",
        "masterData.storageLayout.read",
        "masterData.storageLayout.manage",
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
        clerkMembershipId: "mem_bravo_only",
        status: "ACTIVE",
        scopeMode: "WAREHOUSE_SCOPED",
        effectiveFrom: 0,
      });
      await ctx.db.insert("membershipWarehouses", {
        orgId: orgA,
        membershipId,
        warehouseId: bravo,
      });
      await ctx.db.insert("membershipRoles", {
        orgId: orgA,
        membershipId,
        roleId,
        grantedAt: 0,
      });
    });
    const bravoOnly = t.withIdentity({
      subject: "user_bravo_only",
      org_id: "org_fixture_a",
    });

    // Even replaying an existing requestId for alpha scans is refused for bravoOnly!
    expect(
      allowed(
        await bravoOnly.mutation(linking.resolveUnresolvedScans, {
          requestId: "res-valid-group",
          action: "LINK",
          customerId,
          rememberAlias: true,
          aliasText: "Group Alpha",
          scans: [
            { jobScanId: alphaScan1, expectedVersion: 1 },
            { jobScanId: alphaScan2, expectedVersion: 1 },
          ],
        }),
      ),
    ).toEqual({ ok: false, code: "ACCESS_DENIED" });

    expect(
      allowed(
        await bravoOnly.mutation(linking.addCustomerAlias, {
          requestId: "bravo-cross-wh-alias",
          customerId,
          alias: "Cross WH Alias",
          exampleJobScanId: alphaScan1,
        }),
      ),
    ).toEqual({ ok: false, code: "ACCESS_DENIED", field: "exampleJobScanId" });
  });

  it.each(["masterData.customer.read", "masterData.storageLayout.read"])(
    "requires %s to resolve a ticket even when the actor keeps both manage grants",
    async (permissionCode) => {
      const { t, actorA, orgA, warehouses, createCustomer, saveScan } =
        await setup();
      const customerId = await createCustomer(
        actorA,
        "Chosen customer",
        "manage-only-customer",
      );
      const jobScanId = await saveScan(
        actorA,
        warehouses.alphaA,
        "manage-only-ticket",
        "FO-MANAGE",
        "Unmatched name",
      );
      await t.run(async (ctx) => {
        const role = await ctx.db
          .query("roles")
          .withIndex("by_orgId_key", (q) =>
            q.eq("orgId", orgA).eq("key", "ORG_ADMIN"),
          )
          .unique();
        const grant = await ctx.db
          .query("rolePermissions")
          .withIndex("by_orgId_roleId_permissionCode", (q) =>
            q
              .eq("orgId", orgA)
              .eq("roleId", role!._id)
              .eq("permissionCode", permissionCode),
          )
          .unique();
        await ctx.db.delete(grant!._id);
      });
      expect(
        allowed(
          await actorA.mutation(linking.resolveUnresolvedScans, {
            requestId: "manage-only-resolve",
            customerId,
            action: "LINK",
            scans: [{ jobScanId, expectedVersion: 1 }],
          }),
        ),
      ).toMatchObject({ ok: false, code: "ACCESS_DENIED" });
      expect(
        (await t.run((ctx) => ctx.db.get(jobScanId)))?.customerId,
      ).toBeUndefined();
    },
  );

  it("retains accurate activity through a pause, deletion and resumption of automatic linking", async () => {
    const { t, actorA, warehouses, createCustomer, saveScan } = await setup();
    const warehouseId = warehouses.alphaA;
    const name = "Rollback Customer";
    const customerId = await createCustomer(actorA, name, "rollback-customer");
    const original = await saveScan(
      actorA,
      warehouseId,
      "before-pause",
      "FO-BEFORE",
      name,
    );
    try {
      vi.stubEnv("CUSTOMER_AUTO_LINK_PAUSED", "true");
      const paused = await saveScan(
        actorA,
        warehouseId,
        "during-pause",
        "FO-PAUSED",
        name,
      );
      expect(
        (await t.run((ctx) => ctx.db.get(paused)))?.customerId,
      ).toBeUndefined();
      const removed = allowed(
        await actorA.mutation(jobScans.deleteJobScans, {
          warehouseId,
          requestId: "during-pause-delete",
          ids: [original],
        }),
      );
      expect(removed.written).toBe(true);
      await expect(
        t.mutation(internal.customers.backfill.backfillJobScanCustomers, {
          warehouseId,
          dryRun: false,
        }),
      ).rejects.toThrow("CUSTOMER_AUTO_LINK_PAUSED");
      const activity = allowed(
        await actorA.query(linking.listCustomerActivitySummaries, {
          customerIds: [customerId],
        }),
      );
      expect(activity.summaries[0]?.latestJob).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
    const resumed = await saveScan(
      actorA,
      warehouseId,
      "after-pause",
      "FO-RESUMED",
      name,
    );
    const activity = allowed(
      await actorA.query(linking.listCustomerActivitySummaries, {
        customerIds: [customerId],
      }),
    );
    expect(activity.summaries[0]?.latestJob?.jobScanId).toBe(resumed);
  });

  it("preserves UNLINKED decisions across text edits, refreshes activity on delete, and keeps repeated CLEAR as UNLINKED", async () => {
    const { t, actorA, warehouses, createCustomer, saveScan } = await setup();
    const alpha = warehouses.alphaA;
    const cust = await createCustomer(actorA, "Preserve Co", "pres-c1");
    const scanId = await saveScan(
      actorA,
      alpha,
      "pres-scan-1",
      "FO-PRES-1",
      "Preserve Co",
    );

    // Explicit CLEAR sets UNLINKED and clears activity latestJob.
    let doc = await t.run((ctx) => ctx.db.get(scanId));
    allowed(
      await actorA.mutation(jobScans.updateJobScan, {
        warehouseId: alpha,
        jobScanId: scanId,
        requestId: "pres-clear",
        expectedVersion: doc!.version ?? 1,
        fields: {
          factoryOrder: "FO-PRES-1",
          productBarcodeText: "BC-FO-PRES-1",
          customer: "Preserve Co",
        },
        customerLink: { action: "CLEAR" },
      }),
    );
    doc = await t.run((ctx) => ctx.db.get(scanId));
    expect(doc?.customerId).toBeUndefined();
    expect(doc?.customerLinkSource).toBe("UNLINKED");
    expect(doc?.customerReviewPending).toBeUndefined();

    // Changing text on an UNLINKED scan under KEEP/omitted must NOT auto-relink!
    allowed(
      await actorA.mutation(jobScans.updateJobScan, {
        warehouseId: alpha,
        jobScanId: scanId,
        requestId: "pres-keep-unlinked",
        expectedVersion: doc!.version ?? 1,
        fields: {
          factoryOrder: "FO-PRES-1",
          productBarcodeText: "BC-FO-PRES-1",
          customer: "  Preserve Co  ",
        },
      }),
    );
    doc = await t.run((ctx) => ctx.db.get(scanId));
    expect(doc?.customerId).toBeUndefined();
    expect(doc?.customerLinkSource).toBe("UNLINKED");

    // Re-linking and then deleting the scan refreshes customerWarehouseActivity.
    allowed(
      await actorA.mutation(jobScans.updateJobScan, {
        warehouseId: alpha,
        jobScanId: scanId,
        requestId: "pres-relink",
        expectedVersion: doc!.version ?? 1,
        fields: {
          factoryOrder: "FO-PRES-1",
          productBarcodeText: "BC-FO-PRES-1",
          customer: "Preserve Co",
        },
        customerLink: { action: "SET", customerId: cust },
      }),
    );
    let summary = allowed(
      await actorA.query(linking.listCustomerActivitySummaries, {
        customerIds: [cust],
      }),
    );
    expect(summary.summaries[0]?.latestJob?.jobScanId).toBe(scanId);

    allowed(
      await actorA.mutation(jobScans.deleteJobScans, {
        warehouseId: alpha,
        requestId: "pres-delete",
        ids: [scanId],
      }),
    );
    summary = allowed(
      await actorA.query(linking.listCustomerActivitySummaries, {
        customerIds: [cust],
      }),
    );
    expect(summary.summaries[0]?.latestJob).toBeUndefined();

    // Repeated CLEAR on saveProduct retains customerLinkSource: "UNLINKED".
    const p1 = allowed(
      await actorA.mutation(workflow.saveProduct, {
        warehouseId: alpha,
        requestId: "pres-p-create",
        sku: "SKU-PRES-1",
        name: "Pres Product",
        unit: "PCS",
        storageCondition: "ANY",
        customerLink: { action: "SET", customerId: cust },
        draft: false,
      }),
    );
    const productId = (p1 as { written: true; documentId: string })
      .documentId as Id<"finishedGoodsProducts">;
    let pDoc = await t.run((ctx) => ctx.db.get(productId));
    for (let i = 1; i <= 2; i += 1) {
      allowed(
        await actorA.mutation(workflow.saveProduct, {
          warehouseId: alpha,
          productId,
          expectedUpdatedAt: pDoc!.updatedAt,
          requestId: `pres-p-clear-${i}`,
          sku: "SKU-PRES-1",
          name: "Pres Product",
          unit: "PCS",
          storageCondition: "ANY",
          customerLink: { action: "CLEAR" },
          draft: false,
        }),
      );
      pDoc = await t.run((ctx) => ctx.db.get(productId));
      expect(pDoc?.customerId).toBeUndefined();
      expect(pDoc?.customerLinkSource).toBe("UNLINKED");
    }
  });

  it("handles scale cleanly: 105+ blank scans never hide pending tickets, 105+ customers & aliases stay searchable and paginated, and listCustomersPage keeps zero extra reads", async () => {
    const world = await setup();
    const { t, orgA, actorA, warehouses, createCustomer, saveScan } = world;
    const alpha = warehouses.alphaA;

    // 1. Seed 1 older unresolved scan followed by 105 blank scans.
    const olderPendingId = await saveScan(
      actorA,
      alpha,
      "scale-pending-old",
      "FO-OLD-PENDING",
      "Older Unresolved Buyer",
    );
    await t.run(async (ctx) => {
      const now = Date.now();
      for (let i = 0; i < 105; i += 1) {
        await ctx.db.insert("finishedGoodsJobScans", {
          orgId: orgA,
          warehouseId: alpha,
          factoryOrder: `FO-BLANK-${i}`,
          productBarcodeText: `BC-BLANK-${i}`,
          locationText: "DOCK-1",
          mapped: false,
          source: "AI",
          version: 1,
          createdAt: now + 1000 + i,
          createdByUserId: world.userA,
          updatedAt: now + 1000 + i,
          updatedByUserId: world.userA,
        });
      }
    });

    const summary = allowed(await actorA.query(linking.reviewSummary, {}));
    expect(summary.unresolvedScanCount).toBe(1);
    const queue = allowed(await actorA.query(linking.listUnresolvedNames, {}));
    expect(queue.groups).toHaveLength(1);
    expect(queue.groups[0]?.scans[0]?.jobScanId).toBe(olderPendingId);

    // 2. Seed 105 active customers; verify customer #105 is found by exact code immediately and by substring via scanCursor.
    const customerIds: Id<"customers">[] = [];
    for (let i = 1; i <= 105; i += 1) {
      const id = await createCustomer(
        actorA,
        `Scale Customer ${String(i).padStart(3, "0")}`,
        `scale-cust-${i}`,
        { code: `SC-${String(i).padStart(4, "0")}` },
      );
      customerIds.push(id);
    }
    const target105 = customerIds[104]!;

    const exactCodeHit = allowed(
      await actorA.query(linking.searchCustomerOptions, { search: "SC-0105" }),
    );
    expect(exactCodeHit.items.some((c) => c.customerId === target105)).toBe(
      true,
    );

    // Substring search continues past 100 via scanCursor.
    const subPage1 = allowed(
      await actorA.query(linking.searchCustomerOptions, { search: "0105" }),
    );
    let foundBySub = subPage1.items.some((c) => c.customerId === target105);
    let nextCursor = subPage1.scanCursor;
    while (!foundBySub && nextCursor) {
      const next = allowed(
        await actorA.query(linking.searchCustomerOptions, {
          search: "0105",
          scanCursor: nextCursor,
        }),
      );
      foundBySub = next.items.some((c) => c.customerId === target105);
      nextCursor = next.scanCursor;
    }
    expect(foundBySub).toBe(true);

    // 3. Seed 105 aliases on customer #1 and verify alias #105 matches listCustomersPage AND paginates via listCustomerAliasesPage.
    const firstCustomer = customerIds[0]!;
    for (let i = 1; i <= 105; i += 1) {
      expect(
        allowed(
          await actorA.mutation(linking.addCustomerAlias, {
            requestId: `scale-alias-${i}`,
            customerId: firstCustomer,
            alias: `Shared Prefix Alias ${String(i).padStart(3, "0")}`,
          }),
        ).ok,
      ).toBe(true);
    }
    allowed(
      await actorA.mutation(linking.addCustomerAlias, {
        requestId: "scale-alias-106",
        customerId: firstCustomer,
        alias: "Needle Tail Alias 106",
      }),
    );
    let aliasScanCursor: string | undefined;
    let aliasSearchPage = allowed(
      await actorA.query(catalogue.listCustomersPage, {
        search: "needle tail alias 106",
        pageSize: 20,
      }),
    );
    while (
      aliasSearchPage.status === "scanning" &&
      aliasSearchPage.scanCursor
    ) {
      aliasScanCursor = aliasSearchPage.scanCursor;
      aliasSearchPage = allowed(
        await actorA.query(catalogue.listCustomersPage, {
          search: "needle tail alias 106",
          pageSize: 20,
          scanCursor: aliasScanCursor,
        }),
      );
    }
    expect(aliasSearchPage.status).toBe("ready");
    expect(aliasSearchPage.page.map((c) => c.customerId)).toEqual([
      firstCustomer,
    ]);

    const aliasPage1 = allowed(
      await actorA.query(linking.listCustomerAliasesPage, {
        customerId: firstCustomer,
        pageSize: 60,
      }),
    );
    expect(aliasPage1?.items).toHaveLength(60);
    expect(aliasPage1?.isDone).toBe(false);
    const aliasPage2 = allowed(
      await actorA.query(linking.listCustomerAliasesPage, {
        customerId: firstCustomer,
        pageSize: 60,
        cursor: aliasPage1!.continueCursor,
      }),
    );
    expect(aliasPage2?.items).toHaveLength(46);
    expect(aliasPage2?.isDone).toBe(true);

    // 4. Whole-query read budget across ALL tables: listCustomersPage reads ZERO warehouse/product/scan/alias tables!
    const page20 = await measured(world, listCustomersPage, {
      pageSize: 20,
      status: "ACTIVE",
    });
    expect(page20.value).toMatchObject({ status: "ready" });
    expect(page20.stats.rangeDocs.customers).toBe(20);
    expect(page20.stats.rangeDocs.customerAliases ?? 0).toBe(0);
    expect(page20.stats.rangeDocs.finishedGoodsProducts ?? 0).toBe(0);
    expect(page20.stats.rangeDocs.finishedGoodsJobScans ?? 0).toBe(0);
    expect(page20.stats.rangeDocs.customerWarehouseActivity ?? 0).toBe(0);
    expect(page20.stats.rangeDocs.warehouses ?? 0).toBe(0);

    // Separate batched activity summary reads 0 docs for 20 zero-activity customers.
    const summary20 = await measured(world, listCustomerActivitySummaries, {
      customerIds: customerIds.slice(0, 20),
    });
    expect(summary20.value).toMatchObject({ canViewWarehouseData: true });
    expect(summary20.stats.rangeDocs.customerWarehouseActivity ?? 0).toBe(0);
    expect(summary20.stats.rangeDocs.finishedGoodsProducts ?? 0).toBe(0);
    expect(summary20.stats.rangeDocs.finishedGoodsJobScans ?? 0).toBe(0);
  });
});
