import { v } from "convex/values";

import {
  CODE_FIELD,
  appendDomainAudit,
  createMasterDataRow,
  insertedFields,
  normalizeField,
  replayTenantWriteIfPresent,
  updateMasterDataRow,
} from "../lib/masterDataStore";
import {
  mutationWithOrg,
  type TenantPolicyContext,
} from "../lib/tenantFunctions";
import type { TenantOrgId } from "../lib/tenantDb";
import {
  refusal,
  writeContextOf,
  writeOutcomeValidator,
  written,
} from "../lib/writeEnvelope";
import {
  departTrip as departTripState,
  gateOutTrip,
  recordLoadedPackage,
  sealLoadedTrip,
  startTripLoading as startTripLoadingState,
} from "../model/fulfillment/transportPolicy";
import {
  deriveFulfillmentLineStatus,
  moveFulfillmentQuantity,
  type FulfillmentQuantities,
} from "../model/fulfillment/reservationPolicy";
import type { ShipmentRow, TripRow } from "./tripPlanning";

export const TRIP_EXECUTION_OPERATIONS = Object.freeze({
  start: "fulfillment.trip.loading.start",
  load: "fulfillment.trip.package.load",
  seal: "fulfillment.trip.seal",
  gate: "fulfillment.trip.gateOut",
  depart: "fulfillment.trip.depart",
});

const MAX_SHIPMENTS = 20;

interface TripShipmentRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly tripId: string;
  readonly shipmentId: string;
  readonly warehouseId: string;
  readonly sequence: number;
}

interface FulfillmentPackageRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly packageNumber: string;
  readonly pickTaskId: string;
  readonly fulfillmentOrderId: string;
  readonly warehouseId: string;
  readonly status: string;
  readonly packedBaseMinorUnits: number;
}

interface ShipmentPackageRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly shipmentId: string;
  readonly fulfillmentPackageId: string;
  readonly warehouseId: string;
  readonly status: "EXPECTED" | "LOADED" | "DELIVERED" | "RETURNED";
}

interface PickTaskRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly fulfillmentLineId: string;
}

interface FulfillmentLineRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly orderedBaseMinorUnits: number;
  readonly quantities: FulfillmentQuantities;
}

async function loadTripManifest(
  ctx: { readonly tenantDb: TenantPolicyContext["tenantDb"] },
  trip: TripRow,
) {
  const assignments = await ctx.tenantDb
    .byIndex<TripShipmentRow>("tripShipments", "by_orgId_tripId_sequence", [
      { field: "tripId", value: trip._id },
    ])
    .page({ limit: MAX_SHIPMENTS });
  if (
    !assignments.isDone ||
    assignments.page.length !== trip.expectedShipmentCount
  ) {
    return null;
  }
  const shipments: ShipmentRow[] = [];
  for (const assignment of assignments.page) {
    const shipment = await ctx.tenantDb.get<ShipmentRow>(
      "shipments",
      assignment.shipmentId,
    );
    if (shipment === null || shipment.tripId !== trip._id) return null;
    shipments.push(shipment);
  }
  return shipments;
}

export const startTripLoading = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    tripId: v.id("trips"),
  },
  returns: writeOutcomeValidator,
  permissionCode: "fulfillment.transport.load",
  target: { table: "trips", id: ({ tripId }) => tripId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const trip = await ctx.tenantDb.get<TripRow>("trips", args.tripId);
    if (trip === null || trip.warehouseId !== args.warehouseId) {
      return refusal({ code: "NOT_FOUND", table: "trips" });
    }
    const fingerprint = {
      operation: TRIP_EXECUTION_OPERATIONS.start,
      requestId: args.requestId,
      warehouseId: args.warehouseId,
      tripId: args.tripId,
    };
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "trips",
      operation: TRIP_EXECUTION_OPERATIONS.start,
      requestId: args.requestId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);
    const shipments = await loadTripManifest(ctx, trip);
    if (shipments === null || shipments.length === 0) {
      return refusal({ code: "STORED_ROW_INVALID", field: "manifest" });
    }
    for (const shipment of shipments) {
      const transition = startTripLoadingState(
        trip.status,
        shipment.status as never,
      );
      if (!transition.ok) return refusal(transition.error);
    }
    const now = Date.now();
    const outcome = await updateMasterDataRow({
      ...writeContextOf(ctx, {
        table: "trips",
        operation: TRIP_EXECUTION_OPERATIONS.start,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      documentId: args.tripId,
      fingerprint,
      uniqueness: [],
      patch: { status: "LOADING", loadingStartedAt: now },
    });
    if (!outcome.ok) return refusal(outcome.error);
    for (const shipment of shipments) {
      await ctx.tenantDb.patch("shipments", shipment._id, {
        status: "LOADING",
      });
    }
    return written(outcome.value);
  },
});

export const scanPackageLoaded = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    tripId: v.id("trips"),
    packageNumber: v.string(),
  },
  returns: writeOutcomeValidator,
  permissionCode: "fulfillment.transport.load",
  target: { table: "trips", id: ({ tripId }) => tripId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const trip = await ctx.tenantDb.get<TripRow>("trips", args.tripId);
    if (trip === null || trip.warehouseId !== args.warehouseId) {
      return refusal({ code: "NOT_FOUND", table: "trips" });
    }
    const number = normalizeField(
      "packageNumber",
      args.packageNumber,
      CODE_FIELD,
    );
    if (!number.ok) return refusal(number.error);
    const packageRow = await ctx.tenantDb
      .byIndex<FulfillmentPackageRow>(
        "fulfillmentPackages",
        "by_orgId_packageNumber",
        [{ field: "packageNumber", value: number.value }],
      )
      .unique();
    if (packageRow === null || packageRow.warehouseId !== args.warehouseId) {
      return refusal({ code: "NOT_FOUND", table: "fulfillmentPackages" });
    }
    const manifest = await ctx.tenantDb
      .byIndex<ShipmentPackageRow>(
        "shipmentPackages",
        "by_orgId_fulfillmentPackageId",
        [{ field: "fulfillmentPackageId", value: packageRow._id }],
      )
      .unique();
    const shipment =
      manifest === null
        ? null
        : await ctx.tenantDb.get<ShipmentRow>("shipments", manifest.shipmentId);
    const expected = shipment !== null && shipment.tripId === args.tripId;
    const fingerprint = {
      operation: TRIP_EXECUTION_OPERATIONS.load,
      requestId: args.requestId,
      warehouseId: args.warehouseId,
      tripId: args.tripId,
      packageNumber: number.value,
    };
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "shipmentPackages",
      operation: TRIP_EXECUTION_OPERATIONS.load,
      requestId: args.requestId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);
    if (trip.status !== "LOADING" || shipment?.status !== "LOADING") {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "status",
        reason: "TRIP_NOT_LOADING",
      });
    }
    const progress = recordLoadedPackage({
      progress: {
        expectedPackages: trip.expectedPackageCount,
        loadedPackages: trip.loadedPackageCount,
      },
      expected,
      alreadyLoaded: manifest?.status === "LOADED",
    });
    if (!progress.ok) return refusal(progress.error);
    if (manifest === null) {
      return refusal({ code: "STORED_ROW_INVALID", field: "manifest" });
    }
    const pickTask = await ctx.tenantDb.get<PickTaskRow>(
      "pickTasks",
      packageRow.pickTaskId,
    );
    const line =
      pickTask === null
        ? null
        : await ctx.tenantDb.get<FulfillmentLineRow>(
            "fulfillmentLines",
            pickTask.fulfillmentLineId,
          );
    if (line === null) {
      return refusal({ code: "STORED_ROW_INVALID", field: "fulfillmentLine" });
    }
    const moved = moveFulfillmentQuantity(line.quantities, {
      from: "ISSUED",
      to: "LOADED",
      baseMinorUnits: packageRow.packedBaseMinorUnits,
    });
    if (!moved.ok) return refusal(moved.error);
    const status = deriveFulfillmentLineStatus(
      line.orderedBaseMinorUnits,
      moved.value,
    );
    if (!status.ok) return refusal(status.error);
    const now = Date.now();
    const outcome = await updateMasterDataRow({
      ...writeContextOf(ctx, {
        table: "shipmentPackages",
        operation: TRIP_EXECUTION_OPERATIONS.load,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      documentId: manifest._id,
      fingerprint,
      uniqueness: [],
      patch: {
        status: "LOADED",
        loadedByUserId: ctx.tenant.actor._id,
        loadedAt: now,
      },
    });
    if (!outcome.ok) return refusal(outcome.error);
    const event = {
      tripId: args.tripId,
      shipmentId: manifest.shipmentId,
      shipmentPackageId: manifest._id,
      sequence: trip.loadedPackageCount + 1,
      actorUserId: ctx.tenant.actor._id,
      occurredAt: now,
    };
    const eventId = await ctx.tenantDb.insert("loadEvents", event);
    await appendDomainAudit(
      writeContextOf(ctx, {
        table: "shipmentPackages",
        operation: TRIP_EXECUTION_OPERATIONS.load,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      {
        entityTable: "loadEvents",
        entityId: eventId,
        changes: insertedFields(event),
      },
    );
    await ctx.tenantDb.patch("trips", args.tripId, {
      loadedPackageCount: progress.value.loadedPackages,
    });
    const shipmentLoaded = shipment.loadedPackageCount + 1;
    await ctx.tenantDb.patch("shipments", shipment._id, {
      loadedPackageCount: shipmentLoaded,
      ...(shipmentLoaded === shipment.expectedPackageCount
        ? { status: "LOADED", loadedAt: now }
        : {}),
    });

    await ctx.tenantDb.patch("fulfillmentLines", line._id, {
      quantities: { ...moved.value },
      status: status.value,
    });
    return written(outcome.value);
  },
});

export const sealTrip = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    tripId: v.id("trips"),
    sealNumber: v.string(),
  },
  returns: writeOutcomeValidator,
  permissionCode: "fulfillment.transport.load",
  target: { table: "trips", id: ({ tripId }) => tripId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const trip = await ctx.tenantDb.get<TripRow>("trips", args.tripId);
    if (trip === null || trip.warehouseId !== args.warehouseId) {
      return refusal({ code: "NOT_FOUND", table: "trips" });
    }
    const seal = normalizeField("sealNumber", args.sealNumber, CODE_FIELD);
    if (!seal.ok) return refusal(seal.error);
    const fingerprint = {
      operation: TRIP_EXECUTION_OPERATIONS.seal,
      requestId: args.requestId,
      warehouseId: args.warehouseId,
      tripId: args.tripId,
      sealNumber: seal.value,
    };
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "trips",
      operation: TRIP_EXECUTION_OPERATIONS.seal,
      requestId: args.requestId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);
    const sealed = sealLoadedTrip(
      trip.status,
      {
        expectedPackages: trip.expectedPackageCount,
        loadedPackages: trip.loadedPackageCount,
      },
      seal.value,
    );
    if (!sealed.ok) return refusal(sealed.error);
    const shipments = await loadTripManifest(ctx, trip);
    if (
      shipments === null ||
      shipments.some((shipment) => shipment.status !== "LOADED")
    ) {
      return refusal({ code: "STORED_ROW_INVALID", field: "shipments" });
    }
    const outcome = await updateMasterDataRow({
      ...writeContextOf(ctx, {
        table: "trips",
        operation: TRIP_EXECUTION_OPERATIONS.seal,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      documentId: args.tripId,
      fingerprint,
      uniqueness: [],
      patch: {
        status: sealed.value,
        sealNumber: seal.value,
        sealedAt: Date.now(),
      },
    });
    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});

async function gatePolicy(
  ctx: TenantPolicyContext,
  args: { readonly tripId: string },
) {
  const trip = await ctx.tenantDb.get<TripRow>("trips", args.tripId);
  return {
    thresholdExceeded: false,
    approvalSatisfied: trip?.status === "SEALED",
    ...(trip === null ? {} : { makerUserId: trip.createdByUserId }),
  };
}

export const gateOut = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    tripId: v.id("trips"),
    gatePassNumber: v.string(),
  },
  returns: writeOutcomeValidator,
  permissionCode: "fulfillment.transport.gate",
  target: { table: "trips", id: ({ tripId }) => tripId },
  warehouseId: ({ warehouseId }) => warehouseId,
  policy: gatePolicy,
  handler: async (ctx, args) => {
    const trip = await ctx.tenantDb.get<TripRow>("trips", args.tripId);
    if (trip === null || trip.warehouseId !== args.warehouseId) {
      return refusal({ code: "NOT_FOUND", table: "trips" });
    }
    const passNumber = normalizeField(
      "gatePassNumber",
      args.gatePassNumber,
      CODE_FIELD,
    );
    if (!passNumber.ok) return refusal(passNumber.error);
    const shipments = await loadTripManifest(ctx, trip);
    if (shipments === null || trip.sealNumber === undefined) {
      return refusal({ code: "STORED_ROW_INVALID", field: "manifest" });
    }
    for (const shipment of shipments) {
      const gated = gateOutTrip({
        tripStatus: trip.status,
        shipmentStatus: shipment.status as never,
        sealNumber: trip.sealNumber,
      });
      if (!gated.ok) return refusal(gated.error);
    }
    const fingerprint = {
      operation: TRIP_EXECUTION_OPERATIONS.gate,
      requestId: args.requestId,
      warehouseId: args.warehouseId,
      tripId: args.tripId,
      gatePassNumber: passNumber.value,
    };
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "gatePasses",
      operation: TRIP_EXECUTION_OPERATIONS.gate,
      requestId: args.requestId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);
    const now = Date.now();
    const outcome = await createMasterDataRow({
      ...writeContextOf(ctx, {
        table: "gatePasses",
        operation: TRIP_EXECUTION_OPERATIONS.gate,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      fingerprint,
      uniqueness: [
        {
          field: "gatePassNumber",
          index: "by_orgId_gatePassNumber",
          equality: [{ field: "gatePassNumber", value: passNumber.value }],
        },
        {
          field: "tripId",
          index: "by_orgId_tripId",
          equality: [{ field: "tripId", value: args.tripId }],
        },
      ],
      document: {
        gatePassNumber: passNumber.value,
        tripId: args.tripId,
        warehouseId: args.warehouseId,
        sealNumber: trip.sealNumber,
        vehicleRegistration: trip.vehicleRegistration,
        releasedByUserId: ctx.tenant.actor._id,
        releasedAt: now,
      },
    });
    if (!outcome.ok) return refusal(outcome.error);
    await ctx.tenantDb.patch("trips", args.tripId, {
      status: "GATED_OUT",
      gatedOutAt: now,
    });
    for (const shipment of shipments) {
      await ctx.tenantDb.patch("shipments", shipment._id, {
        status: "GATED_OUT",
        gatedOutAt: now,
      });
    }
    return written(outcome.value);
  },
});

export const departTrip = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    tripId: v.id("trips"),
  },
  returns: writeOutcomeValidator,
  permissionCode: "fulfillment.transport.deliver",
  target: { table: "trips", id: ({ tripId }) => tripId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const trip = await ctx.tenantDb.get<TripRow>("trips", args.tripId);
    if (trip === null || trip.warehouseId !== args.warehouseId)
      return refusal({ code: "NOT_FOUND", table: "trips" });
    const fingerprint = {
      operation: TRIP_EXECUTION_OPERATIONS.depart,
      requestId: args.requestId,
      warehouseId: args.warehouseId,
      tripId: args.tripId,
    };
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "trips",
      operation: TRIP_EXECUTION_OPERATIONS.depart,
      requestId: args.requestId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);
    const shipments = await loadTripManifest(ctx, trip);
    if (shipments === null)
      return refusal({ code: "STORED_ROW_INVALID", field: "manifest" });
    for (const shipment of shipments) {
      const departed = departTripState(trip.status, shipment.status as never);
      if (!departed.ok) return refusal(departed.error);
    }
    const now = Date.now();
    const outcome = await updateMasterDataRow({
      ...writeContextOf(ctx, {
        table: "trips",
        operation: TRIP_EXECUTION_OPERATIONS.depart,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      documentId: args.tripId,
      fingerprint,
      uniqueness: [],
      patch: { status: "IN_TRANSIT", departedAt: now },
    });
    if (!outcome.ok) return refusal(outcome.error);
    for (const shipment of shipments) {
      await ctx.tenantDb.patch("shipments", shipment._id, {
        status: "IN_TRANSIT",
        departedAt: now,
      });
      const milestone = {
        tripId: args.tripId,
        shipmentId: shipment._id,
        sequence: 1,
        kind: "DEPARTED",
        actorUserId: ctx.tenant.actor._id,
        capturedAt: now,
        receivedAt: now,
      };
      const id = await ctx.tenantDb.insert("deliveryMilestones", milestone);
      await appendDomainAudit(
        writeContextOf(ctx, {
          table: "trips",
          operation: TRIP_EXECUTION_OPERATIONS.depart,
          requestId: args.requestId,
          warehouseId: args.warehouseId,
        }),
        {
          entityTable: "deliveryMilestones",
          entityId: id,
          changes: insertedFields(milestone),
        },
      );
    }
    return written(outcome.value);
  },
});
