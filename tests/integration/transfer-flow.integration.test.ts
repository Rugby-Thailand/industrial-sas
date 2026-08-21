import type { GenericMutationCtx } from "convex/server";
import type { GenericId } from "convex/values";
import { describe, expect, it } from "vitest";

import { postTransaction } from "../../convex/inventory/ledger";
import { encodeBucketKey } from "../../convex/model/inventory/stockIdentity";
import type { DataModel } from "../../convex/schema";
import {
  addTransferLine,
  approveTransferRequest,
  createTransferRequest,
  dispatchTransferLine,
  listDestinationTransfers,
  receiveTransferLine,
  resolveTransferDiscrepancy,
} from "../../convex/transfers/requests";
import {
  createConvexInventoryWorld,
  FIXTURE_UOM,
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
  `0193f2c2-4000-7000-8000-${sequence.toString().padStart(12, "0")}`;

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

describe("two-leg warehouse transfer", () => {
  it("does not accept or reveal a destination from another tenant", async () => {
    const world = await createConvexInventoryWorld();
    expect(
      value(
        await call(world, createTransferRequest, {
          requestId: requestId(90),
          warehouseId: world.warehouses.alphaA,
          destinationWarehouseId: world.warehouses.alphaB,
          transferNumber: "TRF-FOREIGN",
          sourceKind: "OTHER",
          purpose: "Must not cross tenant boundary",
        }),
      ),
    ).toMatchObject({
      written: false,
      error: {
        code: "REFERENCE_NOT_FOUND",
        field: "destinationWarehouseId",
      },
    });
  });

  it("dispatches, partially receives, and owns the unexplained remainder", async () => {
    const world = await createConvexInventoryWorld();
    value(
      await call(world, postTransaction, {
        warehouseId: world.warehouses.alphaA,
        requestId: requestId(1),
        type: "RECEIPT",
        source: { type: "TEST", id: "transfer-stock" },
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
    const sourceBucketKey = encodeBucketKey({
      orgId: world.orgA,
      warehouseId: world.warehouses.alphaA,
      itemId: world.a.item,
      location: { kind: "PHYSICAL", locationId: world.a.rack },
      lotId: world.a.lot,
      stockStatus: "AVAILABLE",
    });
    expect(sourceBucketKey.ok).toBe(true);
    if (!sourceBucketKey.ok) return;

    const transferRequestId = written(
      await call(world, createTransferRequest, {
        requestId: requestId(2),
        warehouseId: world.warehouses.alphaA,
        destinationWarehouseId: world.warehouses.bravoA,
        transferNumber: "TRF-001",
        sourceKind: "REPLENISHMENT",
        purpose: "Replenish destination picking stock",
      }),
    )["documentId"] as GenericId<"transferRequests">;
    const transferLineId = written(
      await call(world, addTransferLine, {
        requestId: requestId(3),
        warehouseId: world.warehouses.alphaA,
        transferRequestId,
        itemId: world.a.item,
        requestedBaseMinorUnits: 10_000,
      }),
    )["documentId"] as GenericId<"transferLines">;

    const approver = await seedSecondActorForOrgA(world, "WAREHOUSE_MANAGER");
    const approverIdentity = {
      subject: approver.clerkUserId,
      org_id: "org_fixture_a",
    };
    written(
      await call(
        world,
        approveTransferRequest,
        {
          requestId: requestId(4),
          warehouseId: world.warehouses.alphaA,
          transferRequestId,
        },
        approverIdentity,
      ),
    );
    written(
      await call(
        world,
        dispatchTransferLine,
        {
          requestId: requestId(5),
          warehouseId: world.warehouses.alphaA,
          transferRequestId,
          transferLineId,
          sourceBucketKey: sourceBucketKey.value,
          baseMinorUnits: 10_000,
          sealNumber: "SEAL-TRF-001",
          carrierName: "Fixture Carrier",
        },
        approverIdentity,
      ),
    );
    const receiptArgs = {
      requestId: requestId(6),
      warehouseId: world.warehouses.bravoA,
      transferRequestId,
      transferLineId,
      destinationLocationId: world.a.otherWarehouseLocation,
      receivedBaseMinorUnits: 8_000,
      discrepancyBaseMinorUnits: 1_000,
      discrepancyKind: "MISSING",
      discrepancyNote: "Seal intact; two cases missing at destination count",
      stockStatus: "AVAILABLE",
    } as const;
    expect(
      written(
        await call(world, receiveTransferLine, receiptArgs, approverIdentity),
      )["replayed"],
    ).toBe(false);
    expect(
      written(
        await call(world, receiveTransferLine, receiptArgs, approverIdentity),
      )["replayed"],
    ).toBe(true);
    written(
      await call(
        world,
        receiveTransferLine,
        {
          requestId: requestId(8),
          warehouseId: world.warehouses.bravoA,
          transferRequestId,
          transferLineId,
          destinationLocationId: world.a.otherWarehouseLocation,
          receivedBaseMinorUnits: 0,
          discrepancyBaseMinorUnits: 1_000,
          discrepancyKind: "DAMAGED",
          discrepancyNote: "One case remained on the source vehicle",
          stockStatus: "QUARANTINE",
        },
        approverIdentity,
      ),
    );

    const destinationQueue = value(
      await call(
        world,
        listDestinationTransfers,
        { warehouseId: world.warehouses.bravoA, maxPageSize: 20 },
        approverIdentity,
      ),
    );
    expect(destinationQueue["items"]).toEqual([
      expect.objectContaining({
        transferNumber: "TRF-001",
        status: "DISCREPANCY",
      }),
    ]);

    const destinationBucketKey = encodeBucketKey({
      orgId: world.orgA,
      warehouseId: world.warehouses.bravoA,
      itemId: world.a.item,
      location: {
        kind: "PHYSICAL",
        locationId: world.a.otherWarehouseLocation,
      },
      lotId: world.a.lot,
      stockStatus: "AVAILABLE",
    });
    const sourceTransitBucketKey = encodeBucketKey({
      orgId: world.orgA,
      warehouseId: world.warehouses.alphaA,
      itemId: world.a.item,
      location: { kind: "VIRTUAL", boundary: "TRANSFER_IN_TRANSIT" },
      lotId: world.a.lot,
      stockStatus: "AVAILABLE",
    });
    const destinationTransitBucketKey = encodeBucketKey({
      orgId: world.orgA,
      warehouseId: world.warehouses.bravoA,
      itemId: world.a.item,
      location: { kind: "VIRTUAL", boundary: "TRANSFER_IN_TRANSIT" },
      lotId: world.a.lot,
      stockStatus: "AVAILABLE",
    });
    expect(destinationBucketKey.ok).toBe(true);
    expect(sourceTransitBucketKey.ok).toBe(true);
    expect(destinationTransitBucketKey.ok).toBe(true);
    if (
      !destinationBucketKey.ok ||
      !sourceTransitBucketKey.ok ||
      !destinationTransitBucketKey.ok
    ) {
      return;
    }

    const evidence = await world.t.run(async (ctx) => ({
      request: await ctx.db.get(transferRequestId),
      line: await ctx.db.get(transferLineId),
      discrepancies: await ctx.db
        .query("transferDiscrepancies")
        .withIndex("by_orgId_transferRequestId_status", (query) =>
          query
            .eq("orgId", world.orgA)
            .eq("transferRequestId", transferRequestId)
            .eq("status", "OPEN"),
        )
        .collect(),
      dispatchTransactions: await ctx.db
        .query("inventoryTransactions")
        .withIndex("by_orgId_operation_requestId", (query) =>
          query
            .eq("orgId", world.orgA)
            .eq("operation", "transfer.dispatch.ledger"),
        )
        .collect(),
      receiptTransactions: await ctx.db
        .query("inventoryTransactions")
        .withIndex("by_orgId_operation_requestId", (query) =>
          query
            .eq("orgId", world.orgA)
            .eq("operation", "transfer.receive.ledger"),
        )
        .collect(),
      sourceBalance: await ctx.db
        .query("inventoryBalances")
        .withIndex("by_orgId_bucketKey", (query) =>
          query.eq("orgId", world.orgA).eq("bucketKey", sourceBucketKey.value),
        )
        .unique(),
      destinationBalance: await ctx.db
        .query("inventoryBalances")
        .withIndex("by_orgId_bucketKey", (query) =>
          query
            .eq("orgId", world.orgA)
            .eq("bucketKey", destinationBucketKey.value),
        )
        .unique(),
      sourceTransitBalance: await ctx.db
        .query("inventoryBalances")
        .withIndex("by_orgId_bucketKey", (query) =>
          query
            .eq("orgId", world.orgA)
            .eq("bucketKey", sourceTransitBucketKey.value),
        )
        .unique(),
      destinationTransitBalance: await ctx.db
        .query("inventoryBalances")
        .withIndex("by_orgId_bucketKey", (query) =>
          query
            .eq("orgId", world.orgA)
            .eq("bucketKey", destinationTransitBucketKey.value),
        )
        .unique(),
    }));
    expect(evidence.request).toMatchObject({
      status: "DISCREPANCY",
      discrepancyOwnerUserId: approver.userId,
    });
    expect(evidence.line).toMatchObject({
      quantities: {
        REQUESTED: 10_000,
        DISPATCHED: 10_000,
        RECEIVED: 8_000,
        DISCREPANCY: 2_000,
      },
    });
    expect(evidence.discrepancies).toHaveLength(2);
    expect(evidence.discrepancies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "MISSING",
          baseMinorUnits: 1_000,
          ownerUserId: approver.userId,
        }),
        expect.objectContaining({
          kind: "DAMAGED",
          baseMinorUnits: 1_000,
          ownerUserId: approver.userId,
        }),
      ]),
    );
    expect(evidence.dispatchTransactions).toHaveLength(1);
    expect(evidence.receiptTransactions).toHaveLength(1);
    expect(evidence.sourceBalance?.quantity.minorUnits).toBe(0);
    expect(evidence.destinationBalance?.quantity.minorUnits).toBe(8_000);
    expect(evidence.sourceTransitBalance?.quantity.minorUnits).toBe(10_000);
    expect(evidence.destinationTransitBalance?.quantity.minorUnits).toBe(
      -8_000,
    );

    const missing = evidence.discrepancies.find(
      (row) => row.kind === "MISSING",
    )!;
    const returnedAtSource = evidence.discrepancies.find(
      (row) => row.kind === "DAMAGED",
    )!;
    written(
      await call(
        world,
        resolveTransferDiscrepancy,
        {
          requestId: requestId(7),
          warehouseId: world.warehouses.bravoA,
          transferDiscrepancyId: missing._id,
          resolution: "RECEIVED_AT_DESTINATION",
          destinationLocationId: world.a.otherWarehouseLocation,
          stockStatus: "AVAILABLE",
          resolutionNote: "Missing cases found behind the vehicle bulkhead",
        },
        approverIdentity,
      ),
    );
    written(
      await call(
        world,
        resolveTransferDiscrepancy,
        {
          requestId: requestId(9),
          warehouseId: world.warehouses.alphaA,
          transferDiscrepancyId: returnedAtSource._id,
          resolution: "RETURNED_TO_SOURCE",
          stockStatus: "AVAILABLE",
          resolutionNote: "Case unloaded and scanned back into the source rack",
        },
        approverIdentity,
      ),
    );
    const resolved = await world.t.run(async (ctx) => ({
      request: await ctx.db.get(transferRequestId),
      line: await ctx.db.get(transferLineId),
      missingDiscrepancy: await ctx.db.get(missing._id),
      returnedDiscrepancy: await ctx.db.get(returnedAtSource._id),
      destinationBalance: await ctx.db
        .query("inventoryBalances")
        .withIndex("by_orgId_bucketKey", (query) =>
          query
            .eq("orgId", world.orgA)
            .eq("bucketKey", destinationBucketKey.value),
        )
        .unique(),
      destinationTransitBalance: await ctx.db
        .query("inventoryBalances")
        .withIndex("by_orgId_bucketKey", (query) =>
          query
            .eq("orgId", world.orgA)
            .eq("bucketKey", destinationTransitBucketKey.value),
        )
        .unique(),
      sourceBalance: await ctx.db
        .query("inventoryBalances")
        .withIndex("by_orgId_bucketKey", (query) =>
          query.eq("orgId", world.orgA).eq("bucketKey", sourceBucketKey.value),
        )
        .unique(),
      sourceTransitBalance: await ctx.db
        .query("inventoryBalances")
        .withIndex("by_orgId_bucketKey", (query) =>
          query
            .eq("orgId", world.orgA)
            .eq("bucketKey", sourceTransitBucketKey.value),
        )
        .unique(),
    }));
    expect(resolved.request).toMatchObject({ status: "COMPLETE" });
    expect(resolved.line).toMatchObject({
      quantities: { RECEIVED: 9_000, RETURNED: 1_000, DISCREPANCY: 0 },
    });
    expect(resolved.missingDiscrepancy).toMatchObject({
      status: "RESOLVED_RECEIVED",
      resolutionNote: "Missing cases found behind the vehicle bulkhead",
      resolvedByUserId: approver.userId,
    });
    expect(resolved.returnedDiscrepancy).toMatchObject({
      status: "RESOLVED_RETURNED",
      resolutionNote: "Case unloaded and scanned back into the source rack",
      resolvedByUserId: approver.userId,
    });
    expect(resolved.destinationBalance?.quantity.minorUnits).toBe(9_000);
    expect(resolved.destinationTransitBalance?.quantity.minorUnits).toBe(
      -9_000,
    );
    expect(resolved.sourceBalance?.quantity.minorUnits).toBe(1_000);
    expect(resolved.sourceTransitBalance?.quantity.minorUnits).toBe(9_000);
  });
});
