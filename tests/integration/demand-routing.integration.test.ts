import type { GenericMutationCtx } from "convex/server";
import type { GenericId } from "convex/values";
import { describe, expect, it } from "vitest";

import {
  releaseFulfillmentOrder,
  routeCustomerOrderLine,
} from "../../convex/fulfillment/orders";
import { allocateFulfillmentLine } from "../../convex/fulfillment/reservations";
import { postTransaction } from "../../convex/inventory/ledger";
import { createProductionOrder } from "../../convex/production/orders";
import type { DataModel } from "../../convex/schema";
import {
  createConvexInventoryWorld,
  FIXTURE_UOM,
  type ConvexInventoryWorld,
} from "../fixtures/convex-inventory-world";

interface RuntimeFunction {
  readonly _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
}

const identity = { subject: "user_fixture_a", org_id: "org_fixture_a" };
const requestId = (sequence: number) =>
  `0193f2ca-1000-7000-8000-${sequence.toString().padStart(12, "0")}`;

async function call(
  world: ConvexInventoryWorld,
  fn: unknown,
  args: unknown,
  actor = identity,
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

const written = (outcome: Record<string, unknown>) => {
  expect(outcome["ok"], JSON.stringify(outcome)).toBe(true);
  const result = outcome["value"] as Record<string, unknown>;
  expect(result["written"], JSON.stringify(result)).toBe(true);
  return result;
};

const value = (outcome: Record<string, unknown>) => {
  expect(outcome["ok"], JSON.stringify(outcome)).toBe(true);
  return outcome["value"] as Record<string, unknown>;
};

async function seedDemand(world: ConvexInventoryWorld) {
  return await world.t.run(async (ctx) => {
    const customerId = await ctx.db.insert("customers", {
      orgId: world.orgA,
      code: "ROUTE-CUSTOMER",
      name: "Route customer",
      status: "ACTIVE",
    });
    const customerOrderId = await ctx.db.insert("customerOrders", {
      orgId: world.orgA,
      orderNumber: "SO-ROUTE-001",
      customerId,
      status: "RELEASED",
      orderedAt: 1,
    });
    const customerOrderLineId = await ctx.db.insert("customerOrderLines", {
      orgId: world.orgA,
      customerOrderId,
      lineNumber: 1,
      customerProductCode: "ROUTE-FG",
      specification: {
        styleCode: "RSC",
        internalLengthMm: 300,
        internalWidthMm: 200,
        internalHeightMm: 150,
        boardGrade: "KA125/C/KA125",
        printColourCount: 2,
      },
      designKey: "ROUTE-RSC",
      designSource: "EXISTING",
      status: "DESIGN_READY",
      orderedQuantity: 8,
    });
    return { customerOrderId, customerOrderLineId };
  });
}

describe("customer demand routing", () => {
  it("keeps production-routed demand executable after factory handoff and QC availability", async () => {
    const world = await createConvexInventoryWorld();
    const demand = await seedDemand(world);
    value(
      await call(world, postTransaction, {
        requestId: requestId(20),
        warehouseId: world.warehouses.alphaA,
        type: "RECEIPT",
        source: { type: "TEST", id: "stock-before-routing" },
        lines: [
          {
            itemId: world.a.item,
            locationKind: "PHYSICAL",
            locationId: world.a.rack,
            lotId: world.a.lot,
            stockStatus: "AVAILABLE",
            quantity: { uom: FIXTURE_UOM, minorUnits: 3_000 },
          },
          {
            itemId: world.a.item,
            locationKind: "VIRTUAL",
            virtualBoundary: "SUPPLIER_RECEIPT",
            lotId: world.a.lot,
            stockStatus: "AVAILABLE",
            quantity: { uom: FIXTURE_UOM, minorUnits: -3_000 },
          },
        ],
      }),
    );
    const routeArgs = {
      requestId: requestId(1),
      warehouseId: world.warehouses.alphaA,
      fulfillmentNumber: "FF-ROUTE-001",
      customerOrderLineId: demand.customerOrderLineId,
      itemId: world.a.item,
      allowPartial: true,
      shipTo: {
        name: "Route customer DC",
        addressLine1: "99 Industrial Road",
        province: "Bangkok",
        countryCode: "TH",
      },
    };
    const first = written(await call(world, routeCustomerOrderLine, routeArgs));
    expect(first["replayed"]).toBe(false);
    expect(
      written(await call(world, routeCustomerOrderLine, routeArgs)),
    ).toEqual({
      ...first,
      replayed: true,
    });

    const routed = await world.t.run(async (ctx) => {
      const line = await ctx.db.get(
        first["documentId"] as GenericId<"fulfillmentLines">,
      );
      const order =
        line === null ? null : await ctx.db.get(line.fulfillmentOrderId);
      return { line, order };
    });
    expect(routed.line).toMatchObject({
      routeDecision: "PRODUCTION",
      productionShortageBaseMinorUnits: 5_000,
      quantities: { DEMAND: 8_000 },
    });
    expect(routed.order).toMatchObject({
      routeDecision: "PRODUCTION",
      routeVersion: 1,
      status: "DRAFT",
    });

    written(
      await call(world, releaseFulfillmentOrder, {
        requestId: requestId(2),
        warehouseId: world.warehouses.alphaA,
        fulfillmentOrderId: routed.order!._id,
      }),
    );
    await world.t.run(async (ctx) => {
      await ctx.db.patch(demand.customerOrderLineId, { status: "HANDED_OFF" });
    });

    const factoryPacketId = await world.t.run(async (ctx) => {
      const masterCardId = await ctx.db.insert("masterCards", {
        orgId: world.orgA,
        cardNumber: "MC-ROUTE-001",
        customerId: routed.order!.customerId,
        customerProductCode: "ROUTE-FG",
        designKey: "ROUTE-RSC",
        name: "Routed production card",
        status: "ACTIVE",
      });
      const specification = {
        styleCode: "RSC",
        internalLengthMm: 300,
        internalWidthMm: 200,
        internalHeightMm: 150,
        boardGrade: "KA125/C/KA125",
        printColourCount: 2,
        route: [
          {
            sequence: 10,
            workCenterCode: "CONV-01",
            operationCode: "CONVERT",
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
      const masterCardRevisionId = await ctx.db.insert("masterCardRevisions", {
        orgId: world.orgA,
        masterCardId,
        revisionNumber: 1,
        designKey: "ROUTE-RSC",
        specification,
        status: "RELEASED",
        authoredByUserId: world.userA,
        submittedByUserId: world.userA,
        decidedByUserId: world.userA,
        decidedAt: 2,
      });
      return await ctx.db.insert("factoryPackets", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        packetNumber: "SO-ROUTE-001-1",
        customerOrderLineId: demand.customerOrderLineId,
        fulfillmentLineId: routed.line!._id,
        masterCardRevisionId,
        status: "ACKNOWLEDGED",
        issuedByUserId: world.userA,
        acknowledgedByUserId: world.userA,
        acknowledgedAt: 3,
      });
    });
    const productionOrderId = written(
      await call(world, createProductionOrder, {
        requestId: requestId(21),
        warehouseId: world.warehouses.alphaA,
        factoryPacketId,
        productionOrderNumber: "MO-ROUTE-001",
        outputItemId: world.a.item,
        dueAt: Date.UTC(2026, 7, 20),
      }),
    )["documentId"] as GenericId<"productionOrders">;
    const planned = await world.t.run(async (ctx) => {
      const order = await ctx.db.get(productionOrderId);
      const material = await ctx.db
        .query("productionMaterialRequirements")
        .withIndex("by_orgId_productionOrderId_lineNumber", (query) =>
          query
            .eq("orgId", world.orgA)
            .eq("productionOrderId", productionOrderId),
        )
        .first();
      return { order, material };
    });
    expect(planned.order).toMatchObject({
      fulfillmentLineId: routed.line!._id,
      planningSource: "ROUTED_SHORTAGE",
      targetBaseMinorUnits: 5_000,
    });
    expect(planned.material).toMatchObject({ requiredBaseMinorUnits: 5_000 });

    value(
      await call(world, postTransaction, {
        requestId: requestId(3),
        warehouseId: world.warehouses.alphaA,
        type: "RECEIPT",
        source: { type: "TEST", id: "qc-release-for-route" },
        lines: [
          {
            itemId: world.a.item,
            locationKind: "PHYSICAL",
            locationId: world.a.rack,
            lotId: world.a.lot,
            stockStatus: "AVAILABLE",
            quantity: { uom: FIXTURE_UOM, minorUnits: 5_000 },
          },
          {
            itemId: world.a.item,
            locationKind: "VIRTUAL",
            virtualBoundary: "SUPPLIER_RECEIPT",
            lotId: world.a.lot,
            stockStatus: "AVAILABLE",
            quantity: { uom: FIXTURE_UOM, minorUnits: -5_000 },
          },
        ],
      }),
    );
    written(
      await call(world, allocateFulfillmentLine, {
        requestId: requestId(4),
        warehouseId: world.warehouses.alphaA,
        fulfillmentLineId: first["documentId"],
        strategy: "FEFO",
        asOfBusinessDate: "2026-08-17",
        requestedBaseMinorUnits: 8_000,
      }),
    );
    const after = await world.t.run(async (ctx) =>
      ctx.db.get(first["documentId"] as GenericId<"fulfillmentLines">),
    );
    expect(after).toMatchObject({
      status: "RESERVED",
      routeDecision: "PRODUCTION",
      quantities: { DEMAND: 0, RESERVED: 8_000 },
    });
  });

  it("routes fully covered demand to available stock", async () => {
    const world = await createConvexInventoryWorld();
    const demand = await seedDemand(world);
    value(
      await call(world, postTransaction, {
        requestId: requestId(10),
        warehouseId: world.warehouses.alphaA,
        type: "RECEIPT",
        source: { type: "TEST", id: "available-route" },
        lines: [
          {
            itemId: world.a.item,
            locationKind: "PHYSICAL",
            locationId: world.a.rack,
            lotId: world.a.lot,
            stockStatus: "AVAILABLE",
            quantity: { uom: FIXTURE_UOM, minorUnits: 8_000 },
          },
          {
            itemId: world.a.item,
            locationKind: "VIRTUAL",
            virtualBoundary: "SUPPLIER_RECEIPT",
            lotId: world.a.lot,
            stockStatus: "AVAILABLE",
            quantity: { uom: FIXTURE_UOM, minorUnits: -8_000 },
          },
        ],
      }),
    );
    const routed = written(
      await call(world, routeCustomerOrderLine, {
        requestId: requestId(11),
        warehouseId: world.warehouses.alphaA,
        fulfillmentNumber: "FF-ROUTE-STOCK",
        customerOrderLineId: demand.customerOrderLineId,
        itemId: world.a.item,
        allowPartial: false,
        shipTo: {
          name: "Route customer DC",
          addressLine1: "99 Industrial Road",
          province: "Bangkok",
          countryCode: "TH",
        },
      }),
    );
    const line = await world.t.run(async (ctx) =>
      ctx.db.get(routed["documentId"] as GenericId<"fulfillmentLines">),
    );
    expect(line).toMatchObject({
      routeDecision: "AVAILABLE_STOCK",
      productionShortageBaseMinorUnits: 0,
    });
  });

  it("subtracts earlier unallocated route commitments and derives a mixed order", async () => {
    const world = await createConvexInventoryWorld();
    const demand = await seedDemand(world);
    const secondLineId = await world.t.run(async (ctx) => {
      await ctx.db.patch(demand.customerOrderLineId, { orderedQuantity: 4 });
      return await ctx.db.insert("customerOrderLines", {
        orgId: world.orgA,
        customerOrderId: demand.customerOrderId,
        lineNumber: 2,
        customerProductCode: "ROUTE-FG-2",
        specification: {
          styleCode: "RSC",
          internalLengthMm: 200,
          internalWidthMm: 150,
          internalHeightMm: 100,
          boardGrade: "KA125/C/KA125",
          printColourCount: 1,
        },
        designKey: "ROUTE-RSC-2",
        designSource: "EXISTING",
        status: "DESIGN_READY",
        orderedQuantity: 6,
      });
    });
    value(
      await call(world, postTransaction, {
        requestId: requestId(30),
        warehouseId: world.warehouses.alphaA,
        type: "RECEIPT",
        source: { type: "TEST", id: "mixed-route-stock" },
        lines: [
          {
            itemId: world.a.item,
            locationKind: "PHYSICAL",
            locationId: world.a.rack,
            lotId: world.a.lot,
            stockStatus: "AVAILABLE",
            quantity: { uom: FIXTURE_UOM, minorUnits: 5_000 },
          },
          {
            itemId: world.a.item,
            locationKind: "VIRTUAL",
            virtualBoundary: "SUPPLIER_RECEIPT",
            lotId: world.a.lot,
            stockStatus: "AVAILABLE",
            quantity: { uom: FIXTURE_UOM, minorUnits: -5_000 },
          },
        ],
      }),
    );
    const header = {
      warehouseId: world.warehouses.alphaA,
      fulfillmentNumber: "FF-ROUTE-MIXED",
      itemId: world.a.item,
      allowPartial: true,
      shipTo: {
        name: "Mixed route DC",
        addressLine1: "99 Industrial Road",
        province: "Bangkok",
        countryCode: "TH",
      },
    };
    const first = written(
      await call(world, routeCustomerOrderLine, {
        ...header,
        requestId: requestId(31),
        customerOrderLineId: demand.customerOrderLineId,
      }),
    );
    const second = written(
      await call(world, routeCustomerOrderLine, {
        ...header,
        requestId: requestId(32),
        customerOrderLineId: secondLineId,
      }),
    );
    const evidence = await world.t.run(async (ctx) => {
      const firstLine = await ctx.db.get(
        first["documentId"] as GenericId<"fulfillmentLines">,
      );
      const secondLine = await ctx.db.get(
        second["documentId"] as GenericId<"fulfillmentLines">,
      );
      const order =
        secondLine === null
          ? null
          : await ctx.db.get(secondLine.fulfillmentOrderId);
      return { firstLine, secondLine, order };
    });
    expect(evidence.firstLine).toMatchObject({
      routeDecision: "AVAILABLE_STOCK",
      availableStockPlannedBaseMinorUnits: 4_000,
      productionShortageBaseMinorUnits: 0,
    });
    expect(evidence.secondLine).toMatchObject({
      routeDecision: "PRODUCTION",
      availableStockPlannedBaseMinorUnits: 1_000,
      productionShortageBaseMinorUnits: 5_000,
    });
    expect(evidence.order).toMatchObject({
      routeDecision: "MIXED",
      routeVersion: 2,
    });
  });
});
