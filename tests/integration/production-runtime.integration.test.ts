import type { GenericMutationCtx } from "convex/server";
import type { GenericId } from "convex/values";
import { describe, expect, it } from "vitest";

import { decideMasterCardRevision } from "../../convex/engineering/masterCards";
import { postTransaction } from "../../convex/inventory/ledger";
import { encodeBucketKey } from "../../convex/model/inventory/stockIdentity";
import {
  createProductionOrder,
  decideProductionOutputQuality,
  issueProductionMaterial,
  receiveProductionOutput,
  releaseProductionOrder,
  reportProductionOperation,
} from "../../convex/production/orders";
import type { DataModel } from "../../convex/schema";
import {
  createConvexInventoryWorld,
  FIXTURE_UOM,
  storedBalances,
  type ConvexInventoryWorld,
} from "../fixtures/convex-inventory-world";
import { seedSecondActorForOrgA } from "../fixtures/convex-tenant-world";

interface RuntimeFunction {
  readonly _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
}

const identity = { subject: "user_fixture_a", org_id: "org_fixture_a" };
const requestId = (sequence: number) =>
  `0193f2c2-5000-7000-8000-${sequence.toString().padStart(12, "0")}`;

async function call(
  world: ConvexInventoryWorld,
  fn: unknown,
  args: unknown,
  actor: { readonly subject: string; readonly org_id: string } = identity,
): Promise<Record<string, unknown>> {
  return (await world.t
    .withIdentity(actor)
    .run(async (ctx) =>
      (fn as RuntimeFunction)._handler(
        ctx as GenericMutationCtx<DataModel>,
        args,
      ),
    )) as Record<string, unknown>;
}

const value = (outcome: Record<string, unknown>) => {
  expect(outcome["ok"], JSON.stringify(outcome)).toBe(true);
  return outcome["value"] as Record<string, unknown>;
};

const written = (outcome: Record<string, unknown>) => {
  const result = value(outcome);
  expect(result["written"], JSON.stringify(result)).toBe(true);
  return result;
};

describe("repeat production execution", () => {
  it("pins a released packet and reconciles material, output, and QC ledger facts", async () => {
    const world = await createConvexInventoryWorld();
    const seeded = await world.t.run(async (ctx) => {
      const outputItemId = await ctx.db.insert("items", {
        orgId: world.orgA,
        sku: "FG-BOX-001",
        name: "Finished carton",
        baseUom: FIXTURE_UOM,
        trackingMode: "LOT",
        status: "ACTIVE",
      });
      const outputLotId = await ctx.db.insert("lots", {
        orgId: world.orgA,
        itemId: outputItemId,
        lotCode: "FG-LOT-001",
        status: "ACTIVE",
      });
      const customerId = await ctx.db.insert("customers", {
        orgId: world.orgA,
        code: "PROD-CUSTOMER",
        name: "Production customer",
        status: "ACTIVE",
      });
      const customerOrderId = await ctx.db.insert("customerOrders", {
        orgId: world.orgA,
        orderNumber: "SO-PROD-001",
        customerId,
        status: "RELEASED",
        orderedAt: 1,
      });
      const specification = {
        styleCode: "RSC",
        internalLengthMm: 300,
        internalWidthMm: 200,
        internalHeightMm: 150,
        boardGrade: "TEST",
        printColourCount: 1,
        route: [
          {
            sequence: 10,
            workCenterCode: "GLU-01",
            operationCode: "GLUE",
          },
        ],
        materials: [
          {
            itemCode: "WIDGET-001",
            description: "Fixture board",
            quantityPerUnit: 1,
            uom: FIXTURE_UOM,
          },
        ],
      };
      const customerOrderLineId = await ctx.db.insert("customerOrderLines", {
        orgId: world.orgA,
        customerOrderId,
        lineNumber: 1,
        customerProductCode: "BOX-001",
        specification,
        designKey: "RSC|300|200|150",
        designSource: "EXISTING",
        status: "HANDED_OFF",
        orderedQuantity: 10,
      });
      const masterCardId = await ctx.db.insert("masterCards", {
        orgId: world.orgA,
        cardNumber: "MC-PROD-001",
        customerId,
        customerProductCode: "BOX-001",
        designKey: "RSC|300|200|150",
        name: "Fixture production card",
        status: "ACTIVE",
      });
      const masterCardRevisionId = await ctx.db.insert("masterCardRevisions", {
        orgId: world.orgA,
        masterCardId,
        revisionNumber: 1,
        designKey: "RSC|300|200|150",
        specification,
        status: "RELEASED",
        authoredByUserId: world.userA,
        submittedByUserId: world.userA,
        decidedByUserId: world.userA,
        decidedAt: 2,
      });
      await ctx.db.patch("masterCards", masterCardId, {
        releasedRevisionId: masterCardRevisionId,
      });
      await ctx.db.patch("customerOrderLines", customerOrderLineId, {
        masterCardRevisionId,
      });
      const factoryPacketId = await ctx.db.insert("factoryPackets", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        packetNumber: "SO-PROD-001-1",
        customerOrderLineId,
        customerId,
        customerOrderNumber: "SO-PROD-001",
        masterCardRevisionId,
        revisionNumber: 1,
        specification,
        approvedFileIds: [],
        releaseEvidence: { releasedByUserId: world.userA, releasedAt: 2 },
        quantity: 10,
        status: "ACKNOWLEDGED",
        issuedByUserId: world.userA,
        acknowledgedByUserId: world.userA,
        acknowledgedAt: 3,
      });
      const fulfillmentOrderId = await ctx.db.insert("fulfillmentOrders", {
        orgId: world.orgA,
        fulfillmentNumber: "FF-PROD-001",
        customerOrderId,
        customerId,
        warehouseId: world.warehouses.alphaA,
        status: "RELEASED",
        routeDecision: "PRODUCTION",
        routeVersion: 1,
        allowPartial: true,
        shipTo: {
          name: "Production customer DC",
          addressLine1: "99 Industrial Road",
          province: "Bangkok",
          countryCode: "TH",
        },
        releasedAt: 3,
        createdByUserId: world.userA,
      });
      const fulfillmentLineId = await ctx.db.insert("fulfillmentLines", {
        orgId: world.orgA,
        fulfillmentOrderId,
        customerOrderLineId,
        warehouseId: world.warehouses.alphaA,
        itemId: outputItemId,
        baseUom: "PCS",
        orderedBaseMinorUnits: 10_000,
        routeDecision: "PRODUCTION",
        routeVersion: 1,
        routedAt: 3,
        productionShortageBaseMinorUnits: 10_000,
        status: "UNPLANNED",
        quantities: {
          DEMAND: 10_000,
          RESERVED: 0,
          PICKING: 0,
          STAGED: 0,
          ISSUED: 0,
          LOADED: 0,
          DELIVERED: 0,
          RETURNED: 0,
          BACKORDERED: 0,
          CANCELLED: 0,
        },
        createdByUserId: world.userA,
      });
      return {
        outputItemId,
        outputLotId,
        factoryPacketId,
        fulfillmentLineId,
        masterCardId,
        masterCardRevisionId,
        specification,
      };
    });

    value(
      await call(world, postTransaction, {
        warehouseId: world.warehouses.alphaA,
        requestId: requestId(1),
        type: "RECEIPT",
        source: { type: "TEST", id: "production-material" },
        lines: [
          {
            itemId: world.a.item,
            locationKind: "PHYSICAL",
            locationId: world.a.rack,
            lotId: world.a.lot,
            stockStatus: "AVAILABLE",
            quantity: { uom: FIXTURE_UOM, minorUnits: 10_000 },
          },
          {
            itemId: world.a.item,
            locationKind: "VIRTUAL",
            virtualBoundary: "SUPPLIER_RECEIPT",
            lotId: world.a.lot,
            stockStatus: "AVAILABLE",
            quantity: { uom: FIXTURE_UOM, minorUnits: -10_000 },
          },
        ],
      }),
    );
    const sourceBucket = encodeBucketKey({
      orgId: world.orgA,
      warehouseId: world.warehouses.alphaA,
      itemId: world.a.item,
      lotId: world.a.lot,
      stockStatus: "AVAILABLE",
      location: { kind: "PHYSICAL", locationId: world.a.rack },
    });
    expect(sourceBucket.ok).toBe(true);
    if (!sourceBucket.ok) return;

    const productionOrderId = written(
      await call(world, createProductionOrder, {
        requestId: requestId(2),
        warehouseId: world.warehouses.alphaA,
        factoryPacketId: seeded.factoryPacketId,
        productionOrderNumber: "MO-001",
        outputItemId: seeded.outputItemId,
        dueAt: Date.UTC(2026, 7, 20),
      }),
    )["documentId"] as GenericId<"productionOrders">;
    const materialId = await world.t.run(async (ctx) => {
      const order = await ctx.db.get(productionOrderId);
      expect(order).toMatchObject({
        fulfillmentLineId: seeded.fulfillmentLineId,
        planningSource: "ROUTED_SHORTAGE",
        targetBaseMinorUnits: 10_000,
      });
      const row = await ctx.db
        .query("productionMaterialRequirements")
        .withIndex("by_orgId_productionOrderId_lineNumber", (query) =>
          query
            .eq("orgId", world.orgA)
            .eq("productionOrderId", productionOrderId),
        )
        .first();
      if (row === null) throw new Error("material requirement missing");
      return row._id;
    });
    const checker = await seedSecondActorForOrgA(world, "ORG_ADMIN");
    const checkerIdentity = {
      subject: checker.clerkUserId,
      org_id: "org_fixture_a",
    };
    written(
      await call(
        world,
        releaseProductionOrder,
        {
          requestId: requestId(3),
          warehouseId: world.warehouses.alphaA,
          productionOrderId,
        },
        checkerIdentity,
      ),
    );
    const nextRevisionId = await world.t.run(async (ctx) =>
      ctx.db.insert("masterCardRevisions", {
        orgId: world.orgA,
        masterCardId: seeded.masterCardId,
        revisionNumber: 2,
        designKey: "RSC|310|200|150",
        specification: {
          ...seeded.specification,
          internalLengthMm: 310,
        },
        status: "IN_REVIEW",
        authoredByUserId: world.userA,
        submittedByUserId: world.userA,
      }),
    );
    written(
      await call(
        world,
        decideMasterCardRevision,
        {
          requestId: requestId(30),
          masterCardRevisionId: nextRevisionId,
          decision: "APPROVE",
          note: "Release dimensional revision and notify active production.",
        },
        checkerIdentity,
      ),
    );
    const pinnedRevisionEvidence = await world.t.run(async (ctx) => ({
      order: await ctx.db.get(productionOrderId),
      impacts: await ctx.db
        .query("designChangeImpacts")
        .withIndex("by_orgId_productionOrderId_createdAt", (query) =>
          query
            .eq("orgId", world.orgA)
            .eq("productionOrderId", productionOrderId),
        )
        .collect(),
    }));
    expect(pinnedRevisionEvidence.order?.masterCardRevisionId).toBe(
      seeded.masterCardRevisionId,
    );
    expect(pinnedRevisionEvidence.impacts).toHaveLength(1);
    expect(pinnedRevisionEvidence.impacts[0]).toMatchObject({
      fromRevisionId: seeded.masterCardRevisionId,
      toRevisionId: nextRevisionId,
      severity: "BLOCKING",
      status: "OPEN",
      changedFields: ["internalLengthMm"],
    });
    const issueArgs = {
      requestId: requestId(4),
      warehouseId: world.warehouses.alphaA,
      productionOrderId,
      productionMaterialRequirementId: materialId,
      sourceBucketKey: sourceBucket.value,
      baseMinorUnits: 10_000,
    };
    expect(
      written(await call(world, issueProductionMaterial, issueArgs))[
        "replayed"
      ],
    ).toBe(false);
    expect(
      written(await call(world, issueProductionMaterial, issueArgs))[
        "replayed"
      ],
    ).toBe(true);
    written(
      await call(world, reportProductionOperation, {
        requestId: requestId(5),
        warehouseId: world.warehouses.alphaA,
        productionOrderId,
        operationSequence: 10,
        goodBaseMinorUnits: 8_000,
        scrapBaseMinorUnits: 1_000,
        reworkBaseMinorUnits: 1_000,
        downtimeMinutes: 12,
        downtimeReason: "Glue temperature recovery",
      }),
    );
    const outputReceiptId = written(
      await call(world, receiveProductionOutput, {
        requestId: requestId(6),
        warehouseId: world.warehouses.alphaA,
        productionOrderId,
        outputLotId: seeded.outputLotId,
        destinationLocationId: world.a.dock,
        baseMinorUnits: 8_000,
      }),
    )["documentId"] as GenericId<"productionOutputReceipts">;
    written(
      await call(
        world,
        decideProductionOutputQuality,
        {
          requestId: requestId(7),
          warehouseId: world.warehouses.alphaA,
          productionOutputReceiptId: outputReceiptId,
          decision: "RELEASE",
          note: "Final dimensions and glue bond passed",
        },
        checkerIdentity,
      ),
    );

    const final = await world.t.run(async (ctx) => ({
      order: await ctx.db.get(productionOrderId),
      receipt: await ctx.db.get(outputReceiptId),
      material: await ctx.db.get(materialId),
      issues: await ctx.db
        .query("productionMaterialIssues")
        .withIndex("by_orgId_productionOrderId_issuedAt", (query) =>
          query
            .eq("orgId", world.orgA)
            .eq("productionOrderId", productionOrderId),
        )
        .collect(),
    }));
    expect(final.order).toMatchObject({
      status: "COMPLETE",
      quantities: {
        target: 10_000,
        good: 8_000,
        scrap: 1_000,
        rework: 1_000,
        received: 8_000,
        qcReleased: 8_000,
        qcRejected: 0,
      },
    });
    expect(final.receipt).toMatchObject({ disposition: "AVAILABLE" });
    expect(final.material).toMatchObject({ issuedBaseMinorUnits: 10_000 });
    expect(final.issues).toHaveLength(1);
    expect(final.issues[0]).toMatchObject({
      sourceLotId: world.a.lot,
      baseMinorUnits: 10_000,
    });

    const recoveryOrderId = written(
      await call(world, createProductionOrder, {
        requestId: requestId(8),
        warehouseId: world.warehouses.alphaA,
        factoryPacketId: seeded.factoryPacketId,
        productionOrderNumber: "MO-002",
        outputItemId: seeded.outputItemId,
        dueAt: Date.UTC(2026, 7, 21),
      }),
    )["documentId"] as GenericId<"productionOrders">;
    const recovery = await world.t.run(async (ctx) => {
      const order = await ctx.db.get(recoveryOrderId);
      const material = await ctx.db
        .query("productionMaterialRequirements")
        .withIndex("by_orgId_productionOrderId_lineNumber", (query) =>
          query
            .eq("orgId", world.orgA)
            .eq("productionOrderId", recoveryOrderId),
        )
        .first();
      return { order, material };
    });
    expect(recovery.order).toMatchObject({
      fulfillmentLineId: seeded.fulfillmentLineId,
      planningSource: "ROUTED_SHORTAGE",
      targetBaseMinorUnits: 2_000,
      quantities: { target: 2_000 },
    });
    expect(recovery.material).toMatchObject({
      requiredBaseMinorUnits: 2_000,
    });

    const balances = await storedBalances(world, world.orgA);
    const outputAvailable = balances.find(
      (row) =>
        row["itemId"] === seeded.outputItemId &&
        row["stockStatus"] === "AVAILABLE" &&
        row["locationId"] === world.a.dock,
    );
    const outputHold = balances.find(
      (row) =>
        row["itemId"] === seeded.outputItemId &&
        row["stockStatus"] === "QC_HOLD" &&
        row["locationId"] === world.a.dock,
    );
    expect(outputAvailable).toMatchObject({
      quantity: { uom: FIXTURE_UOM, minorUnits: 8_000 },
    });
    expect(outputHold).toMatchObject({
      quantity: { uom: FIXTURE_UOM, minorUnits: 0 },
    });
  });
});
