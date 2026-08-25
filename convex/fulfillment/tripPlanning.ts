import { v } from "convex/values";

import {
  listArgs,
  pageOf,
  pageOptions,
  pageRefusal,
  pageRequestOf,
  pageResult,
} from "../lib/listEnvelope";
import {
  CODE_FIELD,
  createMasterDataRow,
  normalizeField,
  replayTenantWriteIfPresent,
  updateMasterDataRow,
} from "../lib/masterDataStore";
import { mutationWithOrg, queryWithOrg } from "../lib/tenantFunctions";
import type { TenantOrgId } from "../lib/tenantDb";
import { tripStatus } from "../lib/validators";
import {
  refusal,
  writeContextOf,
  writeOutcomeValidator,
  written,
} from "../lib/writeEnvelope";

export const TRIP_PLANNING_OPERATIONS = Object.freeze({
  create: "fulfillment.trip.create",
  assign: "fulfillment.trip.shipment.assign",
  release: "fulfillment.trip.release",
});

const MAX_SHIPMENTS = 20;

export interface TripRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly tripNumber: string;
  readonly warehouseId: string;
  readonly status:
    | "DRAFT"
    | "READY_TO_LOAD"
    | "LOADING"
    | "SEALED"
    | "GATED_OUT"
    | "IN_TRANSIT"
    | "COMPLETE"
    | "CANCELLED";
  readonly vehicleRegistration: string;
  readonly driverName: string;
  readonly driverPhone?: string;
  readonly expectedShipmentCount: number;
  readonly expectedPackageCount: number;
  readonly loadedPackageCount: number;
  readonly sealNumber?: string;
  readonly createdByUserId: string;
}

export interface ShipmentRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly shipmentNumber: string;
  readonly warehouseId: string;
  readonly fulfillmentOrderId: string;
  readonly status: string;
  readonly expectedPackageCount: number;
  readonly loadedPackageCount: number;
  readonly tripId?: string;
  readonly returnLocationId?: string;
  readonly returnTransactionId?: string;
  readonly returnReason?: string;
}

interface TripShipmentRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly tripId: string;
  readonly shipmentId: string;
  readonly warehouseId: string;
  readonly sequence: number;
}

const tripSummaryValidator = v.object({
  found: v.boolean(),
  tripId: v.optional(v.id("trips")),
  tripNumber: v.optional(v.string()),
  warehouseId: v.optional(v.id("warehouses")),
  status: v.optional(tripStatus),
  vehicleRegistration: v.optional(v.string()),
  driverName: v.optional(v.string()),
  expectedShipmentCount: v.optional(v.number()),
  expectedPackageCount: v.optional(v.number()),
  loadedPackageCount: v.optional(v.number()),
  sealNumber: v.optional(v.string()),
});

export const createTrip = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    tripNumber: v.string(),
    vehicleRegistration: v.string(),
    driverName: v.string(),
    driverPhone: v.optional(v.string()),
  },
  returns: writeOutcomeValidator,
  permissionCode: "fulfillment.transport.plan",
  target: { table: "warehouses", id: ({ warehouseId }) => warehouseId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const tripNumber = normalizeField(
      "tripNumber",
      args.tripNumber,
      CODE_FIELD,
    );
    if (!tripNumber.ok) return refusal(tripNumber.error);
    const vehicleRegistration = normalizeField(
      "vehicleRegistration",
      args.vehicleRegistration,
      CODE_FIELD,
    );
    if (!vehicleRegistration.ok) return refusal(vehicleRegistration.error);
    const driverName = args.driverName.trim();
    if (driverName.length === 0 || driverName.length > 200) {
      return refusal({
        code: "FIELD_INVALID",
        field: "driverName",
        reason: "LENGTH",
      });
    }
    const driverPhone = args.driverPhone?.trim();
    if (driverPhone !== undefined && driverPhone.length > 40) {
      return refusal({
        code: "FIELD_INVALID",
        field: "driverPhone",
        reason: "LENGTH",
      });
    }
    const fingerprint = {
      operation: TRIP_PLANNING_OPERATIONS.create,
      requestId: args.requestId,
      warehouseId: args.warehouseId,
      tripNumber: tripNumber.value,
      vehicleRegistration: vehicleRegistration.value,
      driverName,
      driverPhone,
    };
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "trips",
      operation: TRIP_PLANNING_OPERATIONS.create,
      requestId: args.requestId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);
    const outcome = await createMasterDataRow({
      ...writeContextOf(ctx, {
        table: "trips",
        operation: TRIP_PLANNING_OPERATIONS.create,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      fingerprint,
      uniqueness: [
        {
          field: "tripNumber",
          index: "by_orgId_tripNumber",
          equality: [{ field: "tripNumber", value: tripNumber.value }],
        },
      ],
      document: {
        tripNumber: tripNumber.value,
        warehouseId: args.warehouseId,
        status: "DRAFT",
        vehicleRegistration: vehicleRegistration.value,
        driverName,
        ...(driverPhone === undefined || driverPhone.length === 0
          ? {}
          : { driverPhone }),
        expectedShipmentCount: 0,
        expectedPackageCount: 0,
        loadedPackageCount: 0,
        createdByUserId: ctx.tenant.actor._id,
        createdAt: Date.now(),
      },
    });
    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});

export const assignShipmentToTrip = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    tripId: v.id("trips"),
    shipmentId: v.id("shipments"),
  },
  returns: writeOutcomeValidator,
  permissionCode: "fulfillment.transport.plan",
  target: { table: "trips", id: ({ tripId }) => tripId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const trip = await ctx.tenantDb.get<TripRow>("trips", args.tripId);
    const shipment = await ctx.tenantDb.get<ShipmentRow>(
      "shipments",
      args.shipmentId,
    );
    if (
      trip === null ||
      shipment === null ||
      trip.warehouseId !== args.warehouseId ||
      shipment.warehouseId !== args.warehouseId
    ) {
      return refusal({ code: "NOT_FOUND", table: "trips" });
    }
    const fingerprint = {
      operation: TRIP_PLANNING_OPERATIONS.assign,
      requestId: args.requestId,
      warehouseId: args.warehouseId,
      tripId: args.tripId,
      shipmentId: args.shipmentId,
    };
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "tripShipments",
      operation: TRIP_PLANNING_OPERATIONS.assign,
      requestId: args.requestId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);
    if (
      trip.status !== "DRAFT" ||
      shipment.status !== "READY_TO_LOAD" ||
      shipment.tripId !== undefined ||
      trip.expectedShipmentCount >= MAX_SHIPMENTS
    ) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "status",
        reason: "SHIPMENT_NOT_ASSIGNABLE",
      });
    }
    const outcome = await createMasterDataRow({
      ...writeContextOf(ctx, {
        table: "tripShipments",
        operation: TRIP_PLANNING_OPERATIONS.assign,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      fingerprint,
      uniqueness: [
        {
          field: "shipmentId",
          index: "by_orgId_shipmentId",
          equality: [{ field: "shipmentId", value: args.shipmentId }],
        },
      ],
      document: {
        tripId: args.tripId,
        shipmentId: args.shipmentId,
        warehouseId: args.warehouseId,
        sequence: trip.expectedShipmentCount + 1,
      },
    });
    if (!outcome.ok) return refusal(outcome.error);
    await ctx.tenantDb.patch("shipments", args.shipmentId, {
      tripId: args.tripId,
    });
    await ctx.tenantDb.patch("trips", args.tripId, {
      expectedShipmentCount: trip.expectedShipmentCount + 1,
      expectedPackageCount:
        trip.expectedPackageCount + shipment.expectedPackageCount,
    });
    return written(outcome.value);
  },
});

export const releaseTrip = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    tripId: v.id("trips"),
  },
  returns: writeOutcomeValidator,
  permissionCode: "fulfillment.transport.plan",
  target: { table: "trips", id: ({ tripId }) => tripId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const trip = await ctx.tenantDb.get<TripRow>("trips", args.tripId);
    if (trip === null || trip.warehouseId !== args.warehouseId) {
      return refusal({ code: "NOT_FOUND", table: "trips" });
    }
    const fingerprint = {
      operation: TRIP_PLANNING_OPERATIONS.release,
      requestId: args.requestId,
      warehouseId: args.warehouseId,
      tripId: args.tripId,
    };
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "trips",
      operation: TRIP_PLANNING_OPERATIONS.release,
      requestId: args.requestId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);
    const assignments = await ctx.tenantDb
      .byIndex<TripShipmentRow>("tripShipments", "by_orgId_tripId_sequence", [
        { field: "tripId", value: args.tripId },
      ])
      .page({ limit: MAX_SHIPMENTS });
    if (
      trip.status !== "DRAFT" ||
      !assignments.isDone ||
      assignments.page.length !== trip.expectedShipmentCount ||
      trip.expectedShipmentCount === 0 ||
      trip.expectedPackageCount === 0
    ) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "manifest",
        reason: "TRIP_NOT_RELEASABLE",
      });
    }
    for (const assignment of assignments.page) {
      const shipment = await ctx.tenantDb.get<ShipmentRow>(
        "shipments",
        assignment.shipmentId,
      );
      if (
        shipment === null ||
        shipment.status !== "READY_TO_LOAD" ||
        shipment.tripId !== args.tripId
      ) {
        return refusal({ code: "STORED_ROW_INVALID", field: "shipment" });
      }
    }
    const outcome = await updateMasterDataRow({
      ...writeContextOf(ctx, {
        table: "trips",
        operation: TRIP_PLANNING_OPERATIONS.release,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      documentId: args.tripId,
      fingerprint,
      uniqueness: [],
      patch: { status: "READY_TO_LOAD", releasedAt: Date.now() },
    });
    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});

export const getTrip = queryWithOrg({
  args: { warehouseId: v.id("warehouses"), tripId: v.id("trips") },
  returns: tripSummaryValidator,
  permissionCode: "fulfillment.transport.read",
  target: { table: "trips", id: ({ tripId }) => tripId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const trip = await ctx.tenantDb.get<TripRow>("trips", args.tripId);
    if (trip === null || trip.warehouseId !== args.warehouseId) {
      return { found: false };
    }
    return {
      found: true,
      tripId: trip._id as never,
      tripNumber: trip.tripNumber,
      warehouseId: trip.warehouseId as never,
      status: trip.status,
      vehicleRegistration: trip.vehicleRegistration,
      driverName: trip.driverName,
      expectedShipmentCount: trip.expectedShipmentCount,
      expectedPackageCount: trip.expectedPackageCount,
      loadedPackageCount: trip.loadedPackageCount,
      ...(trip.sealNumber === undefined ? {} : { sealNumber: trip.sealNumber }),
    };
  },
});

export const listTrips = queryWithOrg({
  args: { warehouseId: v.id("warehouses"), ...listArgs },
  returns: pageOf(tripSummaryValidator),
  permissionCode: "fulfillment.transport.read",
  target: { table: "trips" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const request = pageRequestOf(args);
    if (!request.ok) return pageRefusal(request.error.code);
    const page = await ctx.tenantDb
      .byIndex<TripRow>("trips", "by_orgId_warehouseId_status_tripNumber", [
        { field: "warehouseId", value: args.warehouseId },
      ])
      .page(pageOptions(request.value));
    return pageResult(
      page.page.map((trip) => ({
        found: true,
        tripId: trip._id as never,
        tripNumber: trip.tripNumber,
        warehouseId: trip.warehouseId as never,
        status: trip.status,
        vehicleRegistration: trip.vehicleRegistration,
        driverName: trip.driverName,
        expectedShipmentCount: trip.expectedShipmentCount,
        expectedPackageCount: trip.expectedPackageCount,
        loadedPackageCount: trip.loadedPackageCount,
        ...(trip.sealNumber === undefined
          ? {}
          : { sealNumber: trip.sealNumber }),
      })),
      page,
    );
  },
});
