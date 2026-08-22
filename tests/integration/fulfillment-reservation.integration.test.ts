import type { GenericMutationCtx } from "convex/server";
import type { GenericId } from "convex/values";
import { describe, expect, it } from "vitest";

import {
  addFulfillmentLine,
  createFulfillmentOrder,
  releaseFulfillmentOrder,
} from "../../convex/fulfillment/orders";
import {
  allocateFulfillmentLine,
  cancelFulfillmentLineRemainder,
  getAvailableToPromise,
  releaseFulfillmentReservation,
} from "../../convex/fulfillment/reservations";
import {
  checkPickTask,
  issuePickTask,
  packPickTask,
  recordPickEvent,
  reverseIssuedPickTask,
  stagePickTask,
  startPickTask,
  submitPickTask,
} from "../../convex/fulfillment/pickExecution";
import {
  createPickWave,
  releasePickWave,
} from "../../convex/fulfillment/pickPlanning";
import {
  captureProofOfDelivery,
  recordDocumentReturn,
  recordFailedDelivery,
  reviewProofOfDelivery,
  returnFailedShipmentToWarehouse,
} from "../../convex/fulfillment/delivery";
import {
  attachTransportFile,
  authorizeTransportFileUpload,
  redeemUploadThingTransportFileAccessGrant,
  requestTransportFileAccess,
} from "../../convex/fulfillment/transportFiles";
import {
  createShipment,
  listShipments,
  releaseShipment,
} from "../../convex/fulfillment/shipments";
import {
  departTrip,
  gateOut,
  scanPackageLoaded,
  sealTrip,
  startTripLoading,
} from "../../convex/fulfillment/tripExecution";
import {
  assignShipmentToTrip,
  createTrip,
  listTrips,
  releaseTrip,
} from "../../convex/fulfillment/tripPlanning";
import { postTransaction } from "../../convex/inventory/ledger";
import { completeUploadThingTransportFileGrant } from "../../convex/lib/transportFileComplete";
import type { DataModel } from "../../convex/schema";
import {
  createConvexInventoryWorld,
  FIXTURE_UOM,
  type ConvexInventoryWorld,
} from "../fixtures/convex-inventory-world";
import {
  recordStepUp,
  seedSecondActorForOrgA,
} from "../fixtures/convex-tenant-world";

interface RuntimeFunction {
  readonly _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
}

const identity = { subject: "user_fixture_a", org_id: "org_fixture_a" };

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

const requestId = (sequence: number) =>
  `0193f2c2-1000-7000-8000-${sequence.toString().padStart(12, "0")}`;

async function seedReleasedDemand(
  world: ConvexInventoryWorld,
  orderedQuantity: number,
) {
  return await world.t.run(async (ctx) => {
    const customerId = await ctx.db.insert("customers", {
      orgId: world.orgA,
      code: `CUST-${orderedQuantity}`,
      name: "Fulfillment fixture customer",
      status: "ACTIVE",
    });
    const customerOrderId = await ctx.db.insert("customerOrders", {
      orgId: world.orgA,
      orderNumber: `SO-${orderedQuantity}`,
      customerId,
      status: "RELEASED",
      orderedAt: 1,
    });
    const customerOrderLineId = await ctx.db.insert("customerOrderLines", {
      orgId: world.orgA,
      customerOrderId,
      lineNumber: 1,
      customerProductCode: `FG-${orderedQuantity}`,
      specification: {
        styleCode: "RSC",
        internalLengthMm: 300,
        internalWidthMm: 200,
        internalHeightMm: 150,
        boardGrade: "KA125/C/KA125",
        printColourCount: 2,
      },
      designKey: `RSC-${orderedQuantity}`,
      designSource: "EXISTING",
      status: "DESIGN_READY",
      orderedQuantity,
    });
    return { customerOrderId, customerOrderLineId };
  });
}

async function seedTwoLots(world: ConvexInventoryWorld) {
  const early = await world.t.run(async (ctx) => {
    return await ctx.db.insert("lots", {
      orgId: world.orgA,
      itemId: world.a.item,
      lotCode: "LOT-EARLY",
      expirationDate: "2026-09-01",
      status: "ACTIVE",
    });
  });
  value(
    await call(world, postTransaction, {
      warehouseId: world.warehouses.alphaA,
      requestId: requestId(1),
      type: "RECEIPT",
      source: { type: "TEST", id: "fulfillment-stock" },
      lines: [
        {
          itemId: world.a.item,
          locationKind: "PHYSICAL",
          locationId: world.a.rack,
          lotId: world.a.lot,
          stockStatus: "AVAILABLE",
          quantity: { uom: FIXTURE_UOM, minorUnits: 6_000 },
        },
        {
          itemId: world.a.item,
          locationKind: "VIRTUAL",
          virtualBoundary: "SUPPLIER_RECEIPT",
          lotId: world.a.lot,
          stockStatus: "AVAILABLE",
          quantity: { uom: FIXTURE_UOM, minorUnits: -6_000 },
        },
        {
          itemId: world.a.item,
          locationKind: "PHYSICAL",
          locationId: world.a.dock,
          lotId: early,
          stockStatus: "AVAILABLE",
          quantity: { uom: FIXTURE_UOM, minorUnits: 4_000 },
        },
        {
          itemId: world.a.item,
          locationKind: "VIRTUAL",
          virtualBoundary: "SUPPLIER_RECEIPT",
          lotId: early,
          stockStatus: "AVAILABLE",
          quantity: { uom: FIXTURE_UOM, minorUnits: -4_000 },
        },
      ],
    }),
  );
  return early;
}

async function setUpFulfillment(
  world: ConvexInventoryWorld,
  orderedQuantity: number,
  allowPartial: boolean,
  sequence: number,
) {
  const demand = await seedReleasedDemand(world, orderedQuantity);
  const fulfillmentOrderId = written(
    await call(world, createFulfillmentOrder, {
      requestId: requestId(sequence),
      warehouseId: world.warehouses.alphaA,
      fulfillmentNumber: `FF-${sequence}`,
      customerOrderId: demand.customerOrderId,
      allowPartial,
      shipTo: {
        name: "Gold Foods DC",
        addressLine1: "99 Industrial Road",
        province: "Bangkok",
        countryCode: "TH",
      },
    }),
  )["documentId"] as GenericId<"fulfillmentOrders">;
  const fulfillmentLineId = written(
    await call(world, addFulfillmentLine, {
      requestId: requestId(sequence + 1),
      warehouseId: world.warehouses.alphaA,
      fulfillmentOrderId,
      customerOrderLineId: demand.customerOrderLineId,
      itemId: world.a.item,
    }),
  )["documentId"] as GenericId<"fulfillmentLines">;
  written(
    await call(world, releaseFulfillmentOrder, {
      requestId: requestId(sequence + 2),
      warehouseId: world.warehouses.alphaA,
      fulfillmentOrderId,
    }),
  );
  return { fulfillmentOrderId, fulfillmentLineId };
}

describe("available-stock fulfillment allocation", () => {
  it("subtracts active reservations, allocates FEFO, conserves demand, and replays", async () => {
    const world = await createConvexInventoryWorld();
    const earlyLotId = await seedTwoLots(world);
    const { fulfillmentLineId } = await setUpFulfillment(world, 8, true, 10);

    const before = value(
      await call(world, getAvailableToPromise, {
        warehouseId: world.warehouses.alphaA,
        itemId: world.a.item,
      }),
    );
    expect(before).toMatchObject({
      available: true,
      atpBaseMinorUnits: 10_000,
    });

    const args = {
      requestId: requestId(20),
      warehouseId: world.warehouses.alphaA,
      fulfillmentLineId,
      strategy: "FEFO",
      asOfBusinessDate: "2026-08-17",
      requestedBaseMinorUnits: 8_000,
    };
    const first = written(await call(world, allocateFulfillmentLine, args));
    expect(first["replayed"]).toBe(false);
    expect(
      written(await call(world, allocateFulfillmentLine, args)),
    ).toMatchObject({ documentId: first["documentId"], replayed: true });

    const evidence = await world.t.run(async (ctx) => {
      const reservations = await ctx.db
        .query("inventoryReservations")
        .withIndex("by_orgId_fulfillmentLineId_status_bucketKey", (query) =>
          query
            .eq("orgId", world.orgA)
            .eq("fulfillmentLineId", fulfillmentLineId)
            .eq("status", "ACTIVE"),
        )
        .collect();
      const line = await ctx.db.get(fulfillmentLineId);
      return { reservations, line };
    });
    expect(evidence.reservations).toHaveLength(2);
    expect(evidence.reservations[0]?.lotId).toBe(earlyLotId);
    expect(evidence.reservations.map((row) => row.baseMinorUnits)).toEqual([
      4_000, 4_000,
    ]);
    expect(evidence.line).toMatchObject({
      status: "RESERVED",
      quantities: {
        DEMAND: 0,
        RESERVED: 8_000,
        BACKORDERED: 0,
      },
    });

    const after = value(
      await call(world, getAvailableToPromise, {
        warehouseId: world.warehouses.alphaA,
        itemId: world.a.item,
      }),
    );
    expect(after).toMatchObject({
      available: true,
      atpBaseMinorUnits: 2_000,
    });

    const earlyReservation = evidence.reservations.find(
      (row) => row.lotId === earlyLotId,
    );
    expect(earlyReservation).toBeDefined();
    const releaseArgs = {
      requestId: requestId(21),
      warehouseId: world.warehouses.alphaA,
      inventoryReservationId: earlyReservation!._id,
      reason: "BACKORDER",
    };
    const released = written(
      await call(world, releaseFulfillmentReservation, releaseArgs),
    );
    expect(
      written(await call(world, releaseFulfillmentReservation, releaseArgs)),
    ).toMatchObject({
      documentId: released["documentId"],
      replayed: true,
    });
    const afterRelease = value(
      await call(world, getAvailableToPromise, {
        warehouseId: world.warehouses.alphaA,
        itemId: world.a.item,
      }),
    );
    expect(afterRelease).toMatchObject({
      available: true,
      atpBaseMinorUnits: 6_000,
    });
  });

  it("does not create reservation crumbs for an all-or-nothing shortage", async () => {
    const world = await createConvexInventoryWorld();
    await seedTwoLots(world);
    const { fulfillmentLineId } = await setUpFulfillment(world, 12, false, 30);
    const result = value(
      await call(world, allocateFulfillmentLine, {
        requestId: requestId(40),
        warehouseId: world.warehouses.alphaA,
        fulfillmentLineId,
        strategy: "FIFO",
        asOfBusinessDate: "2026-08-17",
        requestedBaseMinorUnits: 12_000,
      }),
    );
    expect(result).toMatchObject({
      written: false,
      error: { code: "INSUFFICIENT_ATP" },
    });
    const reservationCount = await world.t.run(async (ctx) => {
      return (
        await ctx.db
          .query("inventoryReservations")
          .withIndex("by_orgId_fulfillmentLineId_status_bucketKey", (query) =>
            query
              .eq("orgId", world.orgA)
              .eq("fulfillmentLineId", fulfillmentLineId)
              .eq("status", "ACTIVE"),
          )
          .collect()
      ).length;
    });
    expect(reservationCount).toBe(0);
  });

  it("carries picked, short, checked, packed, staged, and issued quantities to the ledger", async () => {
    const world = await createConvexInventoryWorld();
    await seedTwoLots(world);
    const { fulfillmentOrderId, fulfillmentLineId } = await setUpFulfillment(
      world,
      8,
      true,
      50,
    );
    written(
      await call(world, allocateFulfillmentLine, {
        requestId: requestId(60),
        warehouseId: world.warehouses.alphaA,
        fulfillmentLineId,
        strategy: "FEFO",
        asOfBusinessDate: "2026-08-17",
        requestedBaseMinorUnits: 8_000,
      }),
    );
    const pickWaveId = written(
      await call(world, createPickWave, {
        requestId: requestId(61),
        warehouseId: world.warehouses.alphaA,
        fulfillmentOrderId,
        waveNumber: "WAVE-001",
      }),
    )["documentId"] as GenericId<"pickWaves">;
    written(
      await call(world, releasePickWave, {
        requestId: requestId(62),
        warehouseId: world.warehouses.alphaA,
        pickWaveId,
      }),
    );
    const work = await world.t.run(async (ctx) => {
      const task = await ctx.db
        .query("pickTasks")
        .withIndex("by_orgId_pickWaveId_taskNumber", (query) =>
          query.eq("orgId", world.orgA).eq("pickWaveId", pickWaveId),
        )
        .unique();
      if (task === null) throw new Error("missing pick task");
      const lines = await ctx.db
        .query("pickTaskLines")
        .withIndex("by_orgId_pickTaskId_lineNumber", (query) =>
          query.eq("orgId", world.orgA).eq("pickTaskId", task._id),
        )
        .collect();
      return { task, lines };
    });
    written(
      await call(world, startPickTask, {
        requestId: requestId(63),
        warehouseId: world.warehouses.alphaA,
        pickTaskId: work.task._id,
      }),
    );
    for (const [index, line] of work.lines.entries()) {
      const isFirst = index === 0;
      written(
        await call(world, recordPickEvent, {
          requestId: requestId(64 + index * 2),
          warehouseId: world.warehouses.alphaA,
          pickTaskId: work.task._id,
          pickTaskLineId: line._id,
          kind: "PICK",
          baseMinorUnits: isFirst ? 3_000 : line.plannedBaseMinorUnits,
          scannedLocationId: line.locationId,
          scannedItemId: line.itemId,
          ...(line.lotId === undefined ? {} : { scannedLotId: line.lotId }),
        }),
      );
      if (isFirst) {
        written(
          await call(world, recordPickEvent, {
            requestId: requestId(65),
            warehouseId: world.warehouses.alphaA,
            pickTaskId: work.task._id,
            pickTaskLineId: line._id,
            kind: "SHORT",
            baseMinorUnits: 1_000,
            reason: "Physical shortage confirmed",
          }),
        );
      }
    }
    written(
      await call(world, submitPickTask, {
        requestId: requestId(70),
        warehouseId: world.warehouses.alphaA,
        pickTaskId: work.task._id,
      }),
    );
    const checker = await seedSecondActorForOrgA(world, "WAREHOUSE_MANAGER");
    const checkerIdentity = {
      subject: checker.clerkUserId,
      org_id: "org_fixture_a",
    };
    written(
      await call(
        world,
        checkPickTask,
        {
          requestId: requestId(71),
          warehouseId: world.warehouses.alphaA,
          pickTaskId: work.task._id,
        },
        checkerIdentity,
      ),
    );
    written(
      await call(
        world,
        packPickTask,
        {
          requestId: requestId(72),
          warehouseId: world.warehouses.alphaA,
          pickTaskId: work.task._id,
          packageNumber: "PKG-001",
        },
        checkerIdentity,
      ),
    );
    const stagingLocationId = await world.t.run(async (ctx) => {
      return await ctx.db.insert("locations", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        code: "STAGE-OUT-01",
        locationType: "STAGING",
        status: "ACTIVE",
      });
    });
    written(
      await call(
        world,
        stagePickTask,
        {
          requestId: requestId(73),
          warehouseId: world.warehouses.alphaA,
          pickTaskId: work.task._id,
          stagingLocationId,
        },
        checkerIdentity,
      ),
    );
    const issued = written(
      await call(
        world,
        issuePickTask,
        {
          requestId: requestId(74),
          warehouseId: world.warehouses.alphaA,
          pickTaskId: work.task._id,
        },
        checkerIdentity,
      ),
    );
    expect(issued["replayed"]).toBe(false);
    expect(
      written(
        await call(
          world,
          issuePickTask,
          {
            requestId: requestId(74),
            warehouseId: world.warehouses.alphaA,
            pickTaskId: work.task._id,
          },
          checkerIdentity,
        ),
      ),
    ).toMatchObject({ replayed: true });
    expect(
      value(
        await call(
          world,
          issuePickTask,
          {
            requestId: requestId(174),
            warehouseId: world.warehouses.alphaA,
            pickTaskId: work.task._id,
          },
          checkerIdentity,
        ),
      ),
    ).toMatchObject({
      written: false,
      error: { code: "PRECONDITION_FAILED", reason: "TASK_ALREADY_ISSUED" },
    });
    expect(
      await world.t.run(
        async (ctx) =>
          (
            await ctx.db
              .query("inventoryTransactions")
              .withIndex("by_orgId_operation_requestId", (query) =>
                query
                  .eq("orgId", world.orgA)
                  .eq("operation", "fulfillment.pick.issue"),
              )
              .collect()
          ).length,
      ),
    ).toBe(1);

    const stepUpAt = Date.now();
    await recordStepUp(world, {
      orgId: world.orgA,
      userId: world.userA,
      occurredAt: stepUpAt,
      reverifiedAt: stepUpAt,
    });
    const reversed = written(
      await call(world, reverseIssuedPickTask, {
        requestId: requestId(274),
        warehouseId: world.warehouses.alphaA,
        pickTaskId: work.task._id,
        reasonCodeId: world.a.reversalReason,
      }),
    );
    expect(reversed["replayed"]).toBe(false);
    expect(
      written(
        await call(world, reverseIssuedPickTask, {
          requestId: requestId(274),
          warehouseId: world.warehouses.alphaA,
          pickTaskId: work.task._id,
          reasonCodeId: world.a.reversalReason,
        }),
      ),
    ).toMatchObject({ replayed: true });
    expect(
      value(
        await call(world, reverseIssuedPickTask, {
          requestId: requestId(374),
          warehouseId: world.warehouses.alphaA,
          pickTaskId: work.task._id,
          reasonCodeId: world.a.reversalReason,
        }),
      ),
    ).toMatchObject({
      written: false,
      error: { code: "PRECONDITION_FAILED", reason: "ISSUE_ALREADY_REVERSED" },
    });
    const restored = await world.t.run(async (ctx) => ({
      task: await ctx.db.get(work.task._id),
      line: await ctx.db.get(fulfillmentLineId),
      reservations: await ctx.db
        .query("inventoryReservations")
        .withIndex("by_orgId_fulfillmentLineId_status_bucketKey", (query) =>
          query
            .eq("orgId", world.orgA)
            .eq("fulfillmentLineId", fulfillmentLineId)
            .eq("status", "PICKING"),
        )
        .collect(),
      issueReversals: await ctx.db
        .query("inventoryTransactions")
        .withIndex("by_orgId_operation_requestId", (query) =>
          query
            .eq("orgId", world.orgA)
            .eq("operation", "fulfillment.pick.issue.reverse"),
        )
        .collect(),
    }));
    expect(restored.task).toMatchObject({ status: "STAGED" });
    expect(restored.line).toMatchObject({
      quantities: { STAGED: 7_000, ISSUED: 0 },
    });
    expect(restored.reservations).toHaveLength(2);
    expect(restored.issueReversals).toHaveLength(1);
    written(
      await call(
        world,
        issuePickTask,
        {
          requestId: requestId(275),
          warehouseId: world.warehouses.alphaA,
          pickTaskId: work.task._id,
        },
        checkerIdentity,
      ),
    );

    const shipmentId = written(
      await call(world, createShipment, {
        requestId: requestId(75),
        warehouseId: world.warehouses.alphaA,
        fulfillmentOrderId,
        shipmentNumber: "SHP-001",
      }),
    )["documentId"] as GenericId<"shipments">;
    written(
      await call(world, releaseShipment, {
        requestId: requestId(76),
        warehouseId: world.warehouses.alphaA,
        shipmentId,
      }),
    );
    const tripId = written(
      await call(world, createTrip, {
        requestId: requestId(77),
        warehouseId: world.warehouses.alphaA,
        tripNumber: "TRIP-001",
        vehicleRegistration: "70-1234",
        driverName: "Somchai Driver",
      }),
    )["documentId"] as GenericId<"trips">;
    written(
      await call(world, assignShipmentToTrip, {
        requestId: requestId(78),
        warehouseId: world.warehouses.alphaA,
        tripId,
        shipmentId,
      }),
    );
    written(
      await call(world, releaseTrip, {
        requestId: requestId(79),
        warehouseId: world.warehouses.alphaA,
        tripId,
      }),
    );
    written(
      await call(world, startTripLoading, {
        requestId: requestId(80),
        warehouseId: world.warehouses.alphaA,
        tripId,
      }),
    );
    written(
      await call(world, scanPackageLoaded, {
        requestId: requestId(81),
        warehouseId: world.warehouses.alphaA,
        tripId,
        packageNumber: "PKG-001",
      }),
    );
    written(
      await call(world, sealTrip, {
        requestId: requestId(82),
        warehouseId: world.warehouses.alphaA,
        tripId,
        sealNumber: "SEAL-001",
      }),
    );
    written(
      await call(
        world,
        gateOut,
        {
          requestId: requestId(83),
          warehouseId: world.warehouses.alphaA,
          tripId,
          gatePassNumber: "GATE-001",
        },
        checkerIdentity,
      ),
    );
    written(
      await call(
        world,
        departTrip,
        {
          requestId: requestId(84),
          warehouseId: world.warehouses.alphaA,
          tripId,
        },
        checkerIdentity,
      ),
    );
    const uploadGrantId = value(
      await call(world, authorizeTransportFileUpload, {
        warehouseId: world.warehouses.alphaA,
        shipmentId,
        kind: "POD",
      }),
    )["uploadGrantId"] as GenericId<"transportFileUploadGrants">;
    const uploadDigest = "a".repeat(64);
    const uploadCompleted = await world.t.run(async (ctx) =>
      (
        completeUploadThingTransportFileGrant as unknown as RuntimeFunction
      )._handler(ctx as GenericMutationCtx<DataModel>, {
        grantId: uploadGrantId,
        providerKey: "ut-pod-001",
        uploaderClerkUserId: "user_fixture_a",
        contentDigest: uploadDigest,
        contentType: "image/jpeg",
        byteSize: 1024,
      }),
    );
    expect(uploadCompleted).toBe(true);
    const transportFileId = written(
      await call(world, attachTransportFile, {
        requestId: requestId(85),
        warehouseId: world.warehouses.alphaA,
        shipmentId,
        uploadGrantId,
        fileName: "pod.jpg",
        kind: "POD",
        contentType: "image/jpeg",
        byteSize: 1024,
        contentDigest: uploadDigest,
        uploadThingKey: "ut-pod-001",
      }),
    )["documentId"] as GenericId<"transportFiles">;
    const fileAccess = value(
      await call(world, requestTransportFileAccess, {
        warehouseId: world.warehouses.alphaA,
        transportFileId,
      }),
    );
    expect(fileAccess).toMatchObject({ granted: true });
    const grantId = new URL(
      fileAccess["url"] as string,
      "https://local.invalid",
    ).searchParams.get("grantId") as GenericId<"transportFileAccessGrants">;
    expect(
      value(
        await call(world, redeemUploadThingTransportFileAccessGrant, {
          warehouseId: world.warehouses.alphaA,
          grantId,
        }),
      ),
    ).toEqual({ providerKey: "ut-pod-001", fileName: "pod.jpg" });
    expect(
      value(
        await call(world, redeemUploadThingTransportFileAccessGrant, {
          warehouseId: world.warehouses.alphaA,
          grantId,
        }),
      ),
    ).toBeNull();
    const proofOfDeliveryId = written(
      await call(world, captureProofOfDelivery, {
        requestId: requestId(86),
        warehouseId: world.warehouses.alphaA,
        shipmentId,
        transportFileId,
        recipientName: "Warehouse Recipient",
        capturedAt: Date.now(),
      }),
    )["documentId"] as GenericId<"proofOfDeliveries">;
    written(
      await call(
        world,
        reviewProofOfDelivery,
        {
          requestId: requestId(87),
          warehouseId: world.warehouses.alphaA,
          proofOfDeliveryId,
          accept: true,
        },
        checkerIdentity,
      ),
    );
    written(
      await call(
        world,
        recordDocumentReturn,
        {
          requestId: requestId(88),
          warehouseId: world.warehouses.alphaA,
          shipmentId,
          documentType: "SIGNED_DELIVERY_NOTE",
          transportFileId,
        },
        checkerIdentity,
      ),
    );

    const final = await world.t.run(async (ctx) => ({
      task: await ctx.db.get(work.task._id),
      line: await ctx.db.get(fulfillmentLineId),
      outboundShipment: await ctx.db.get(shipmentId),
      trip: await ctx.db.get(tripId),
      pod: await ctx.db.get(proofOfDeliveryId),
      reservations: await ctx.db
        .query("inventoryReservations")
        .withIndex("by_orgId_fulfillmentLineId_status_bucketKey", (query) =>
          query
            .eq("orgId", world.orgA)
            .eq("fulfillmentLineId", fulfillmentLineId)
            .eq("status", "CONSUMED"),
        )
        .collect(),
      shipment: await ctx.db
        .query("inventoryTransactions")
        .withIndex("by_orgId_operation_requestId", (query) =>
          query
            .eq("orgId", world.orgA)
            .eq("operation", "fulfillment.pick.issue")
            .eq("requestId", requestId(275)),
        )
        .unique(),
    }));
    expect(final.task?.status).toBe("ISSUED");
    expect(final.outboundShipment).toMatchObject({ status: "DELIVERED" });
    expect(final.trip).toMatchObject({ status: "COMPLETE" });
    expect(final.pod).toMatchObject({ status: "ACCEPTED" });
    expect(final.line).toMatchObject({
      status: "PARTIALLY_DELIVERED",
      quantities: { DELIVERED: 7_000, BACKORDERED: 1_000 },
    });
    expect(final.reservations).toHaveLength(2);
    expect(
      final.reservations.reduce(
        (sum, reservation) => sum + reservation.consumedBaseMinorUnits,
        0,
      ),
    ).toBe(7_000);
    expect(final.shipment).toMatchObject({ type: "SHIPMENT", lineCount: 4 });
    written(
      await call(world, cancelFulfillmentLineRemainder, {
        requestId: requestId(89),
        warehouseId: world.warehouses.alphaA,
        fulfillmentLineId,
        reason:
          "Customer accepted the delivered quantity and cancelled balance",
      }),
    );
    const cancelledRemainder = await world.t.run(async (ctx) => ({
      line: await ctx.db.get(fulfillmentLineId),
      order: await ctx.db.get(fulfillmentOrderId),
    }));
    expect(cancelledRemainder.line).toMatchObject({
      status: "PARTIALLY_DELIVERED",
      quantities: { DELIVERED: 7_000, CANCELLED: 1_000, BACKORDERED: 0 },
      cancellationReason:
        "Customer accepted the delivered quantity and cancelled balance",
    });
    expect(cancelledRemainder.order).toMatchObject({ status: "COMPLETE" });
  });

  it("refuses a corrupt delivery manifest before accepting its POD", async () => {
    const world = await createConvexInventoryWorld();
    const seeded = await world.t.run(async (ctx) => {
      const customerId = await ctx.db.insert("customers", {
        orgId: world.orgA,
        code: "CORRUPT-CUST",
        name: "Corrupt manifest fixture",
        status: "ACTIVE",
      });
      const customerOrderId = await ctx.db.insert("customerOrders", {
        orgId: world.orgA,
        orderNumber: "CORRUPT-SO",
        customerId,
        status: "RELEASED",
        orderedAt: 1,
      });
      const fulfillmentOrderId = await ctx.db.insert("fulfillmentOrders", {
        orgId: world.orgA,
        fulfillmentNumber: "CORRUPT-FF",
        customerOrderId,
        customerId,
        warehouseId: world.warehouses.alphaA,
        status: "IN_FULFILLMENT",
        routeDecision: "AVAILABLE_STOCK",
        routeVersion: 1,
        allowPartial: false,
        shipTo: {
          name: "Corrupt manifest fixture",
          addressLine1: "Private",
          province: "Bangkok",
          countryCode: "TH",
        },
        createdByUserId: world.userA,
      });
      const tripId = await ctx.db.insert("trips", {
        orgId: world.orgA,
        tripNumber: "CORRUPT-TRIP",
        warehouseId: world.warehouses.alphaA,
        status: "IN_TRANSIT",
        vehicleRegistration: "TEST-CORRUPT",
        driverName: "Fixture driver",
        expectedShipmentCount: 1,
        expectedPackageCount: 1,
        loadedPackageCount: 1,
        createdByUserId: world.userA,
        createdAt: 1,
      });
      const shipmentId = await ctx.db.insert("shipments", {
        orgId: world.orgA,
        shipmentNumber: "CORRUPT-SHP",
        fulfillmentOrderId,
        warehouseId: world.warehouses.alphaA,
        status: "IN_TRANSIT",
        expectedPackageCount: 1,
        loadedPackageCount: 1,
        tripId,
        createdByUserId: world.userA,
        createdAt: 1,
      });
      await ctx.db.insert("tripShipments", {
        orgId: world.orgA,
        tripId,
        shipmentId,
        warehouseId: world.warehouses.alphaA,
        sequence: 1,
      });
      const transportFileId = await ctx.db.insert("transportFiles", {
        orgId: world.orgA,
        shipmentId,
        warehouseId: world.warehouses.alphaA,
        kind: "POD",
        fileName: "corrupt-pod.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 1,
        digest: "b".repeat(64),
        storageObjectId: "ut-corrupt-pod",
        storageState: "AVAILABLE",
        createdByUserId: world.userA,
        createdAt: 1,
      });
      const proofOfDeliveryId = await ctx.db.insert("proofOfDeliveries", {
        orgId: world.orgA,
        shipmentId,
        tripId,
        warehouseId: world.warehouses.alphaA,
        status: "CAPTURED",
        recipientName: "Fixture recipient",
        transportFileId,
        capturedByUserId: world.userA,
        capturedAt: 1,
      });
      return { proofOfDeliveryId };
    });
    const checker = await seedSecondActorForOrgA(world, "WAREHOUSE_MANAGER");
    const outcome = value(
      await call(
        world,
        reviewProofOfDelivery,
        {
          requestId: requestId(300),
          warehouseId: world.warehouses.alphaA,
          proofOfDeliveryId: seeded.proofOfDeliveryId,
          accept: true,
        },
        { subject: checker.clerkUserId, org_id: "org_fixture_a" },
      ),
    );
    expect(outcome).toMatchObject({
      written: false,
      error: { code: "STORED_ROW_INVALID", field: "manifest" },
    });
    expect(
      await world.t.run(
        async (ctx) => (await ctx.db.get(seeded.proofOfDeliveryId))?.status,
      ),
    ).toBe("CAPTURED");
  });

  it("receives a failed delivery into QC hold and reconciles loaded quantity", async () => {
    const world = await createConvexInventoryWorld();
    value(
      await call(world, postTransaction, {
        warehouseId: world.warehouses.alphaA,
        requestId: requestId(400),
        type: "RECEIPT",
        source: { type: "TEST", id: "return-stock" },
        lines: [
          {
            itemId: world.a.item,
            locationKind: "PHYSICAL",
            locationId: world.a.rack,
            lotId: world.a.lot,
            stockStatus: "AVAILABLE",
            quantity: { uom: FIXTURE_UOM, minorUnits: 1_000 },
          },
          {
            itemId: world.a.item,
            locationKind: "VIRTUAL",
            virtualBoundary: "SUPPLIER_RECEIPT",
            lotId: world.a.lot,
            stockStatus: "AVAILABLE",
            quantity: { uom: FIXTURE_UOM, minorUnits: -1_000 },
          },
        ],
      }),
    );
    const issued = value(
      await call(world, postTransaction, {
        warehouseId: world.warehouses.alphaA,
        requestId: requestId(401),
        type: "SHIPMENT",
        source: { type: "TEST", id: "failed-delivery" },
        lines: [
          {
            itemId: world.a.item,
            locationKind: "PHYSICAL",
            locationId: world.a.rack,
            lotId: world.a.lot,
            stockStatus: "AVAILABLE",
            quantity: { uom: FIXTURE_UOM, minorUnits: -1_000 },
          },
          {
            itemId: world.a.item,
            locationKind: "VIRTUAL",
            virtualBoundary: "CUSTOMER_SHIPMENT",
            lotId: world.a.lot,
            stockStatus: "AVAILABLE",
            quantity: { uom: FIXTURE_UOM, minorUnits: 1_000 },
          },
        ],
      }),
    );
    const issueTransaction = issued["transaction"] as Record<string, unknown>;
    const issueLines = issueTransaction["lines"] as Record<string, unknown>[];
    const sourceBucketKey = issueLines.find(
      (line) => line["minorUnits"] === -1_000,
    )?.["bucketKey"] as string;
    const seeded = await world.t.run(async (ctx) => {
      const customerId = await ctx.db.insert("customers", {
        orgId: world.orgA,
        code: "RETURN-CUST",
        name: "Return fixture",
        status: "ACTIVE",
      });
      const customerOrderId = await ctx.db.insert("customerOrders", {
        orgId: world.orgA,
        orderNumber: "RETURN-SO",
        customerId,
        status: "RELEASED",
        orderedAt: 1,
      });
      const customerOrderLineId = await ctx.db.insert("customerOrderLines", {
        orgId: world.orgA,
        customerOrderId,
        lineNumber: 1,
        customerProductCode: "RETURN-FG",
        specification: {
          styleCode: "RSC",
          internalLengthMm: 1,
          internalWidthMm: 1,
          internalHeightMm: 1,
          boardGrade: "TEST",
          printColourCount: 0,
        },
        designKey: "RETURN",
        designSource: "EXISTING",
        status: "DESIGN_READY",
        orderedQuantity: 1,
      });
      const fulfillmentOrderId = await ctx.db.insert("fulfillmentOrders", {
        orgId: world.orgA,
        fulfillmentNumber: "RETURN-FF",
        customerOrderId,
        customerId,
        warehouseId: world.warehouses.alphaA,
        status: "IN_FULFILLMENT",
        routeDecision: "AVAILABLE_STOCK",
        routeVersion: 1,
        allowPartial: false,
        shipTo: {
          name: "Return fixture",
          addressLine1: "Private",
          province: "Bangkok",
          countryCode: "TH",
        },
        createdByUserId: world.userA,
      });
      const fulfillmentLineId = await ctx.db.insert("fulfillmentLines", {
        orgId: world.orgA,
        fulfillmentOrderId,
        customerOrderLineId,
        warehouseId: world.warehouses.alphaA,
        itemId: world.a.item,
        baseUom: FIXTURE_UOM,
        orderedBaseMinorUnits: 1_000,
        status: "LOADED",
        quantities: {
          DEMAND: 0,
          RESERVED: 0,
          PICKING: 0,
          STAGED: 0,
          ISSUED: 0,
          LOADED: 1_000,
          DELIVERED: 0,
          RETURNED: 0,
          BACKORDERED: 0,
          CANCELLED: 0,
        },
        createdByUserId: world.userA,
      });
      const allocationRunId = await ctx.db.insert("fulfillmentAllocationRuns", {
        orgId: world.orgA,
        fulfillmentLineId,
        warehouseId: world.warehouses.alphaA,
        itemId: world.a.item,
        strategy: "FIFO",
        allowPartial: false,
        asOfBusinessDate: "2026-08-17",
        requestedBaseMinorUnits: 1_000,
        atpBaseMinorUnits: 1_000,
        reservedBaseMinorUnits: 1_000,
        backorderedBaseMinorUnits: 0,
        reservationCount: 1,
        createdAt: 1,
        createdByUserId: world.userA,
      });
      const reservationId = await ctx.db.insert("inventoryReservations", {
        orgId: world.orgA,
        allocationRunId,
        fulfillmentOrderId,
        fulfillmentLineId,
        warehouseId: world.warehouses.alphaA,
        itemId: world.a.item,
        bucketKey: sourceBucketKey,
        locationId: world.a.rack,
        lotId: world.a.lot,
        baseUom: FIXTURE_UOM,
        baseMinorUnits: 1_000,
        status: "CONSUMED",
        expiresAt: 2,
        rotationRank: 1,
        rotationExplanation: [],
        consumedBaseMinorUnits: 1_000,
        releasedBaseMinorUnits: 0,
        createdAt: 1,
        createdByUserId: world.userA,
      });
      const pickWaveId = await ctx.db.insert("pickWaves", {
        orgId: world.orgA,
        waveNumber: "RETURN-WAVE",
        fulfillmentOrderId,
        warehouseId: world.warehouses.alphaA,
        status: "COMPLETE",
        taskCount: 1,
        completedTaskCount: 1,
        createdByUserId: world.userA,
        createdAt: 1,
      });
      const pickTaskId = await ctx.db.insert("pickTasks", {
        orgId: world.orgA,
        pickWaveId,
        taskNumber: 1,
        warehouseId: world.warehouses.alphaA,
        fulfillmentOrderId,
        fulfillmentLineId,
        status: "ISSUED",
        lineCount: 1,
        eventCount: 1,
      });
      await ctx.db.insert("pickTaskLines", {
        orgId: world.orgA,
        pickTaskId,
        lineNumber: 1,
        inventoryReservationId: reservationId,
        warehouseId: world.warehouses.alphaA,
        itemId: world.a.item,
        locationId: world.a.rack,
        lotId: world.a.lot,
        bucketKey: sourceBucketKey,
        baseUom: FIXTURE_UOM,
        plannedBaseMinorUnits: 1_000,
        pickedBaseMinorUnits: 1_000,
        shortBaseMinorUnits: 0,
        damagedBaseMinorUnits: 0,
        status: "COMPLETE",
      });
      const packageId = await ctx.db.insert("fulfillmentPackages", {
        orgId: world.orgA,
        packageNumber: "RETURN-PKG",
        pickTaskId,
        fulfillmentOrderId,
        warehouseId: world.warehouses.alphaA,
        status: "ISSUED",
        baseUom: FIXTURE_UOM,
        packedBaseMinorUnits: 1_000,
        packedByUserId: world.userA,
        packedAt: 1,
        issuedTransactionId: issueTransaction[
          "transactionId"
        ] as GenericId<"inventoryTransactions">,
      });
      const tripId = await ctx.db.insert("trips", {
        orgId: world.orgA,
        tripNumber: "RETURN-TRIP",
        warehouseId: world.warehouses.alphaA,
        status: "IN_TRANSIT",
        vehicleRegistration: "RETURN-01",
        driverName: "Return driver",
        expectedShipmentCount: 1,
        expectedPackageCount: 1,
        loadedPackageCount: 1,
        createdByUserId: world.userA,
        createdAt: 1,
      });
      const shipmentId = await ctx.db.insert("shipments", {
        orgId: world.orgA,
        shipmentNumber: "RETURN-SHP",
        fulfillmentOrderId,
        warehouseId: world.warehouses.alphaA,
        status: "IN_TRANSIT",
        expectedPackageCount: 1,
        loadedPackageCount: 1,
        tripId,
        createdByUserId: world.userA,
        createdAt: 1,
      });
      const shipmentPackageId = await ctx.db.insert("shipmentPackages", {
        orgId: world.orgA,
        shipmentId,
        fulfillmentPackageId: packageId,
        warehouseId: world.warehouses.alphaA,
        status: "LOADED",
      });
      await ctx.db.insert("tripShipments", {
        orgId: world.orgA,
        tripId,
        shipmentId,
        warehouseId: world.warehouses.alphaA,
        sequence: 1,
      });
      return { shipmentId, shipmentPackageId, fulfillmentLineId, tripId };
    });

    written(
      await call(world, recordFailedDelivery, {
        requestId: requestId(402),
        warehouseId: world.warehouses.alphaA,
        shipmentId: seeded.shipmentId,
        reason: "Recipient warehouse closed",
        capturedAt: 1_755_388_800_000,
      }),
    );
    const returned = written(
      await call(world, returnFailedShipmentToWarehouse, {
        requestId: requestId(403),
        warehouseId: world.warehouses.alphaA,
        shipmentId: seeded.shipmentId,
        returnLocationId: world.a.dock,
        reason: "Returned sealed package to receiving dock",
      }),
    );
    expect(returned["replayed"]).toBe(false);
    expect(
      written(
        await call(world, returnFailedShipmentToWarehouse, {
          requestId: requestId(403),
          warehouseId: world.warehouses.alphaA,
          shipmentId: seeded.shipmentId,
          returnLocationId: world.a.dock,
          reason: "Returned sealed package to receiving dock",
        }),
      ),
    ).toMatchObject({ replayed: true });
    expect(
      value(
        await call(world, returnFailedShipmentToWarehouse, {
          requestId: requestId(404),
          warehouseId: world.warehouses.alphaA,
          shipmentId: seeded.shipmentId,
          returnLocationId: world.a.dock,
          reason: "Returned sealed package to receiving dock",
        }),
      ),
    ).toMatchObject({
      written: false,
      error: {
        code: "PRECONDITION_FAILED",
        reason: "SHIPMENT_ALREADY_RETURNED",
      },
    });
    const final = await world.t.run(async (ctx) => ({
      shipment: await ctx.db.get(seeded.shipmentId),
      shipmentPackage: await ctx.db.get(seeded.shipmentPackageId),
      line: await ctx.db.get(seeded.fulfillmentLineId),
      trip: await ctx.db.get(seeded.tripId),
      qcBalances: await ctx.db
        .query("inventoryBalances")
        .withIndex("by_orgId_warehouseId_itemId_stockStatus", (query) =>
          query
            .eq("orgId", world.orgA)
            .eq("warehouseId", world.warehouses.alphaA)
            .eq("itemId", world.a.item)
            .eq("stockStatus", "QC_HOLD"),
        )
        .collect(),
      returnTransactions: await ctx.db
        .query("inventoryTransactions")
        .withIndex("by_orgId_operation_requestId", (query) =>
          query
            .eq("orgId", world.orgA)
            .eq("operation", "fulfillment.delivery.returnToWarehouse"),
        )
        .collect(),
    }));
    expect(final.shipment).toMatchObject({
      status: "RETURNED",
      returnLocationId: world.a.dock,
    });
    expect(final.shipmentPackage).toMatchObject({ status: "RETURNED" });
    expect(final.line).toMatchObject({
      status: "RETURNED",
      quantities: { LOADED: 0, RETURNED: 1_000 },
    });
    expect(final.trip).toMatchObject({ status: "COMPLETE" });
    expect(final.returnTransactions).toHaveLength(1);
    expect(final.qcBalances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          locationId: world.a.dock,
          quantity: { uom: FIXTURE_UOM, minorUnits: 1_000 },
        }),
      ]),
    );
  });

  it("returns shipment and trip queues as explicit resumable pages", async () => {
    const world = await createConvexInventoryWorld();
    await world.t.run(async (ctx) => {
      const customerId = await ctx.db.insert("customers", {
        orgId: world.orgA,
        code: "PAGE-CUST",
        name: "Page fixture",
        status: "ACTIVE",
      });
      const customerOrderId = await ctx.db.insert("customerOrders", {
        orgId: world.orgA,
        orderNumber: "PAGE-SO",
        customerId,
        status: "RELEASED",
        orderedAt: 1,
      });
      const fulfillmentOrderId = await ctx.db.insert("fulfillmentOrders", {
        orgId: world.orgA,
        fulfillmentNumber: "PAGE-FF",
        customerOrderId,
        customerId,
        warehouseId: world.warehouses.alphaA,
        status: "RELEASED",
        routeDecision: "AVAILABLE_STOCK",
        routeVersion: 1,
        allowPartial: true,
        shipTo: {
          name: "Page fixture",
          addressLine1: "Private",
          province: "Bangkok",
          countryCode: "TH",
        },
        createdByUserId: world.userA,
      });
      for (let index = 1; index <= 101; index += 1) {
        const suffix = index.toString().padStart(3, "0");
        await ctx.db.insert("shipments", {
          orgId: world.orgA,
          shipmentNumber: `PAGE-SHP-${suffix}`,
          fulfillmentOrderId,
          warehouseId: world.warehouses.alphaA,
          status: "READY_TO_LOAD",
          expectedPackageCount: 1,
          loadedPackageCount: 0,
          createdByUserId: world.userA,
          createdAt: index,
        });
        await ctx.db.insert("trips", {
          orgId: world.orgA,
          tripNumber: `PAGE-TRIP-${suffix}`,
          warehouseId: world.warehouses.alphaA,
          status: "DRAFT",
          vehicleRegistration: `TEST-${suffix}`,
          driverName: "Page driver",
          expectedShipmentCount: 0,
          expectedPackageCount: 0,
          loadedPackageCount: 0,
          createdByUserId: world.userA,
          createdAt: index,
        });
      }
    });

    const firstShipments = value(
      await call(world, listShipments, {
        warehouseId: world.warehouses.alphaA,
        maxPageSize: 100,
      }),
    );
    expect(firstShipments).toMatchObject({
      ok: true,
      complete: false,
      items: expect.arrayContaining([
        expect.objectContaining({ shipmentNumber: "PAGE-SHP-001" }),
      ]),
    });
    expect(firstShipments["items"]).toHaveLength(100);
    const finalShipments = value(
      await call(world, listShipments, {
        warehouseId: world.warehouses.alphaA,
        maxPageSize: 100,
        cursor: firstShipments["nextCursor"],
      }),
    );
    expect(finalShipments).toMatchObject({ ok: true, complete: true });
    expect(finalShipments["items"]).toHaveLength(1);

    const firstTrips = value(
      await call(world, listTrips, {
        warehouseId: world.warehouses.alphaA,
        maxPageSize: 100,
      }),
    );
    expect(firstTrips).toMatchObject({ ok: true, complete: false });
    expect(firstTrips["items"]).toHaveLength(100);
    const finalTrips = value(
      await call(world, listTrips, {
        warehouseId: world.warehouses.alphaA,
        maxPageSize: 100,
        cursor: firstTrips["nextCursor"],
      }),
    );
    expect(finalTrips).toMatchObject({ ok: true, complete: true });
    expect(finalTrips["items"]).toHaveLength(1);
  });
});
