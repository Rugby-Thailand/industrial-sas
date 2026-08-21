import type { GenericMutationCtx } from "convex/server";
import { describe, expect, it } from "vitest";

import {
  allocateFulfillmentLine,
  getAvailableToPromise,
} from "../../convex/fulfillment/reservations";
import { routeCustomerOrderLine } from "../../convex/fulfillment/orders";
import { getShipment } from "../../convex/fulfillment/shipments";
import type { DataModel } from "../../convex/schema";
import {
  createConvexInventoryWorld,
  type ConvexInventoryWorld,
} from "../fixtures/convex-inventory-world";

interface RuntimeFunction {
  readonly _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
}

async function call(
  world: ConvexInventoryWorld,
  fn: unknown,
  args: unknown,
  identity: { readonly subject: string; readonly org_id: string },
): Promise<Record<string, unknown>> {
  return (await world.t
    .withIdentity(identity)
    .run(async (ctx) =>
      (fn as RuntimeFunction)._handler(
        ctx as GenericMutationCtx<DataModel>,
        args,
      ),
    )) as Record<string, unknown>;
}

describe("fulfillment tenant isolation", () => {
  it("does not reveal whether a routed customer line belongs to another tenant", async () => {
    const world = await createConvexInventoryWorld();
    const ids = await world.t.run(async (ctx) => {
      const createLine = async (orgId: typeof world.orgA, code: string) => {
        const customerId = await ctx.db.insert("customers", {
          orgId,
          code: `${code}-C`,
          name: `${code} customer`,
          status: "ACTIVE",
        });
        const customerOrderId = await ctx.db.insert("customerOrders", {
          orgId,
          orderNumber: `${code}-SO`,
          customerId,
          status: "RELEASED",
          orderedAt: 1,
        });
        return await ctx.db.insert("customerOrderLines", {
          orgId,
          customerOrderId,
          lineNumber: 1,
          customerProductCode: `${code}-FG`,
          specification: {
            styleCode: "RSC",
            internalLengthMm: 1,
            internalWidthMm: 1,
            internalHeightMm: 1,
            boardGrade: "TEST",
            printColourCount: 0,
          },
          designKey: code,
          designSource: "EXISTING",
          status: "DESIGN_READY",
          orderedQuantity: 1,
        });
      };
      const foreign = await createLine(world.orgA, "ROUTE-FOREIGN");
      const missing = await createLine(world.orgB, "ROUTE-MISSING");
      await ctx.db.delete(missing);
      return { foreign, missing };
    });
    const actorB = { subject: "user_fixture_a", org_id: "org_fixture_b" };
    const base = {
      warehouseId: world.warehouses.alphaB,
      fulfillmentNumber: "FF-ISOLATED-ROUTE",
      itemId: world.b.item,
      allowPartial: true,
      shipTo: {
        name: "Tenant B",
        addressLine1: "Private",
        province: "Bangkok",
        countryCode: "TH",
      },
    };
    const foreign = await call(
      world,
      routeCustomerOrderLine,
      {
        ...base,
        requestId: "0193f2c3-1000-7000-8000-000000000090",
        customerOrderLineId: ids.foreign,
      },
      actorB,
    );
    const missing = await call(
      world,
      routeCustomerOrderLine,
      {
        ...base,
        requestId: "0193f2c3-1000-7000-8000-000000000091",
        customerOrderLineId: ids.missing,
      },
      actorB,
    );
    expect(foreign).toMatchObject({
      ok: true,
      value: {
        written: false,
        error: {
          code: "REFERENCE_NOT_FOUND",
          field: "customerOrderLineId",
        },
      },
    });
    expect(missing).toMatchObject({
      ok: true,
      value: {
        written: false,
        error: {
          code: "REFERENCE_NOT_FOUND",
          field: "customerOrderLineId",
        },
      },
    });
  });

  it("makes foreign and missing fulfillment demand indistinguishable", async () => {
    const world = await createConvexInventoryWorld();
    const foreignLineId = await world.t.run(async (ctx) => {
      const customerId = await ctx.db.insert("customers", {
        orgId: world.orgA,
        code: "ISO-CUSTOMER",
        name: "Isolation customer",
        status: "ACTIVE",
      });
      const orderId = await ctx.db.insert("customerOrders", {
        orgId: world.orgA,
        orderNumber: "ISO-SO",
        customerId,
        status: "RELEASED",
        orderedAt: 1,
      });
      const orderLineId = await ctx.db.insert("customerOrderLines", {
        orgId: world.orgA,
        customerOrderId: orderId,
        lineNumber: 1,
        customerProductCode: "ISO-FG",
        specification: {
          styleCode: "RSC",
          internalLengthMm: 1,
          internalWidthMm: 1,
          internalHeightMm: 1,
          boardGrade: "TEST",
          printColourCount: 0,
        },
        designKey: "ISO",
        designSource: "EXISTING",
        status: "DESIGN_READY",
        orderedQuantity: 1,
      });
      const fulfillmentOrderId = await ctx.db.insert("fulfillmentOrders", {
        orgId: world.orgA,
        fulfillmentNumber: "ISO-FF",
        customerOrderId: orderId,
        customerId,
        warehouseId: world.warehouses.alphaA,
        status: "RELEASED",
        routeDecision: "AVAILABLE_STOCK",
        routeVersion: 1,
        allowPartial: true,
        shipTo: {
          name: "Isolation",
          addressLine1: "Hidden",
          province: "Hidden",
          countryCode: "TH",
        },
        releasedAt: 1,
        createdByUserId: world.userA,
      });
      return await ctx.db.insert("fulfillmentLines", {
        orgId: world.orgA,
        fulfillmentOrderId,
        customerOrderLineId: orderLineId,
        warehouseId: world.warehouses.alphaA,
        itemId: world.a.item,
        baseUom: "PCS",
        orderedBaseMinorUnits: 1_000,
        status: "UNPLANNED",
        quantities: {
          DEMAND: 1_000,
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
    });
    const vanishedLineId = await world.t.run(async (ctx) => {
      const customerId = await ctx.db.insert("customers", {
        orgId: world.orgB,
        code: "VANISHED-CUSTOMER",
        name: "Vanished customer",
        status: "ACTIVE",
      });
      const orderId = await ctx.db.insert("customerOrders", {
        orgId: world.orgB,
        orderNumber: "VANISHED-SO",
        customerId,
        status: "RELEASED",
        orderedAt: 1,
      });
      const orderLineId = await ctx.db.insert("customerOrderLines", {
        orgId: world.orgB,
        customerOrderId: orderId,
        lineNumber: 1,
        customerProductCode: "VANISHED-FG",
        specification: {
          styleCode: "RSC",
          internalLengthMm: 1,
          internalWidthMm: 1,
          internalHeightMm: 1,
          boardGrade: "TEST",
          printColourCount: 0,
        },
        designKey: "VANISHED",
        designSource: "EXISTING",
        status: "DESIGN_READY",
        orderedQuantity: 1,
      });
      const fulfillmentOrderId = await ctx.db.insert("fulfillmentOrders", {
        orgId: world.orgB,
        fulfillmentNumber: "VANISHED-FF",
        customerOrderId: orderId,
        customerId,
        warehouseId: world.warehouses.alphaB,
        status: "RELEASED",
        routeDecision: "AVAILABLE_STOCK",
        routeVersion: 1,
        allowPartial: true,
        shipTo: {
          name: "Vanished",
          addressLine1: "Vanished",
          province: "Vanished",
          countryCode: "TH",
        },
        releasedAt: 1,
        createdByUserId: world.userA,
      });
      const id = await ctx.db.insert("fulfillmentLines", {
        orgId: world.orgB,
        fulfillmentOrderId,
        customerOrderLineId: orderLineId,
        warehouseId: world.warehouses.alphaB,
        itemId: world.b.item,
        baseUom: "PCS",
        orderedBaseMinorUnits: 1_000,
        status: "UNPLANNED",
        quantities: {
          DEMAND: 1_000,
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
      await ctx.db.delete(id);
      return id;
    });
    const actorB = { subject: "user_fixture_a", org_id: "org_fixture_b" };
    const args = {
      requestId: "0193f2c3-1000-7000-8000-000000000001",
      warehouseId: world.warehouses.alphaB,
      strategy: "FEFO",
      asOfBusinessDate: "2026-08-17",
      requestedBaseMinorUnits: 1_000,
    };
    const foreign = await call(
      world,
      allocateFulfillmentLine,
      { ...args, fulfillmentLineId: foreignLineId },
      actorB,
    );
    const missing = await call(
      world,
      allocateFulfillmentLine,
      {
        ...args,
        requestId: "0193f2c3-1000-7000-8000-000000000002",
        fulfillmentLineId: vanishedLineId,
      },
      actorB,
    );
    expect(foreign).toMatchObject({
      ok: true,
      value: {
        written: false,
        error: { code: "NOT_FOUND", table: "fulfillmentLines" },
      },
    });
    expect(missing).toMatchObject({
      ok: true,
      value: {
        written: false,
        error: { code: "NOT_FOUND", table: "fulfillmentLines" },
      },
    });
    expect(foreign["value"]).toEqual(missing["value"]);
  });

  it("does not expose another tenant's item through ATP", async () => {
    const world = await createConvexInventoryWorld();
    const actorB = { subject: "user_fixture_a", org_id: "org_fixture_b" };
    const foreign = await call(
      world,
      getAvailableToPromise,
      {
        warehouseId: world.warehouses.alphaB,
        itemId: world.a.item,
      },
      actorB,
    );
    expect(foreign).toMatchObject({
      ok: true,
      value: {
        available: false,
        error: { code: "REFERENCE_NOT_FOUND" },
      },
    });
    expect(JSON.stringify(foreign)).not.toContain(String(world.a.item));
  });

  it("makes a foreign shipment and a deleted shipment indistinguishable", async () => {
    const world = await createConvexInventoryWorld();
    const ids = await world.t.run(async (ctx) => {
      const seed = async (
        orgId: typeof world.orgA,
        warehouseId: typeof world.warehouses.alphaA,
        prefix: string,
      ) => {
        const customerId = await ctx.db.insert("customers", {
          orgId,
          code: `${prefix}-CUST`,
          name: `${prefix} customer`,
          status: "ACTIVE",
        });
        const customerOrderId = await ctx.db.insert("customerOrders", {
          orgId,
          orderNumber: `${prefix}-SO`,
          customerId,
          status: "RELEASED",
          orderedAt: 1,
        });
        const fulfillmentOrderId = await ctx.db.insert("fulfillmentOrders", {
          orgId,
          fulfillmentNumber: `${prefix}-FF`,
          customerOrderId,
          customerId,
          warehouseId,
          status: "RELEASED",
          routeDecision: "AVAILABLE_STOCK",
          routeVersion: 1,
          allowPartial: true,
          shipTo: {
            name: prefix,
            addressLine1: "Private",
            province: "Private",
            countryCode: "TH",
          },
          createdByUserId: world.userA,
        });
        return await ctx.db.insert("shipments", {
          orgId,
          shipmentNumber: `${prefix}-SHP`,
          fulfillmentOrderId,
          warehouseId,
          status: "READY_TO_LOAD",
          expectedPackageCount: 1,
          loadedPackageCount: 0,
          createdByUserId: world.userA,
          createdAt: 1,
        });
      };
      const foreign = await seed(
        world.orgA,
        world.warehouses.alphaA,
        "FOREIGN",
      );
      const missing = await seed(
        world.orgB,
        world.warehouses.alphaB,
        "MISSING",
      );
      await ctx.db.delete(missing);
      return { foreign, missing };
    });
    const actorB = { subject: "user_fixture_a", org_id: "org_fixture_b" };
    const foreign = await call(
      world,
      getShipment,
      { warehouseId: world.warehouses.alphaB, shipmentId: ids.foreign },
      actorB,
    );
    const missing = await call(
      world,
      getShipment,
      { warehouseId: world.warehouses.alphaB, shipmentId: ids.missing },
      actorB,
    );
    expect(foreign["value"]).toEqual(missing["value"]);
    expect(JSON.stringify(foreign)).not.toContain("FOREIGN-SHP");
  });
});
