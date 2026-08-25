/** Shipment manifests created from issued, traceable fulfillment packages. */
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
  insertedFields,
  appendDomainAudit,
  normalizeField,
  replayTenantWriteIfPresent,
  updateMasterDataRow,
} from "../lib/masterDataStore";
import { mutationWithOrg, queryWithOrg } from "../lib/tenantFunctions";
import type { TenantOrgId } from "../lib/tenantDb";
import { shipmentStatus } from "../lib/validators";
import {
  refusal,
  writeContextOf,
  writeOutcomeValidator,
  written,
} from "../lib/writeEnvelope";

export const SHIPMENT_OPERATIONS = Object.freeze({
  create: "fulfillment.shipment.create",
  release: "fulfillment.shipment.release",
});

const MAX_PACKAGES = 50;

interface FulfillmentOrderRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly warehouseId: string;
  readonly status: string;
  readonly requestedDeliveryAt?: number;
}

interface PackageRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly fulfillmentOrderId: string;
  readonly warehouseId: string;
  readonly status: string;
}

interface ShipmentRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly shipmentNumber: string;
  readonly fulfillmentOrderId: string;
  readonly warehouseId: string;
  readonly status:
    | "DRAFT"
    | "READY_TO_LOAD"
    | "LOADING"
    | "LOADED"
    | "GATED_OUT"
    | "IN_TRANSIT"
    | "DELIVERED"
    | "DELIVERY_FAILED"
    | "RETURNED"
    | "CANCELLED";
  readonly expectedPackageCount: number;
  readonly loadedPackageCount: number;
  readonly tripId?: string;
}

const shipmentSummaryValidator = v.object({
  found: v.boolean(),
  shipmentId: v.optional(v.id("shipments")),
  shipmentNumber: v.optional(v.string()),
  fulfillmentOrderId: v.optional(v.id("fulfillmentOrders")),
  warehouseId: v.optional(v.id("warehouses")),
  status: v.optional(shipmentStatus),
  expectedPackageCount: v.optional(v.number()),
  loadedPackageCount: v.optional(v.number()),
  tripId: v.optional(v.id("trips")),
});

export const createShipment = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    fulfillmentOrderId: v.id("fulfillmentOrders"),
    shipmentNumber: v.string(),
  },
  returns: writeOutcomeValidator,
  permissionCode: "fulfillment.shipment.manage",
  target: {
    table: "fulfillmentOrders",
    id: ({ fulfillmentOrderId }) => fulfillmentOrderId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const order = await ctx.tenantDb.get<FulfillmentOrderRow>(
      "fulfillmentOrders",
      args.fulfillmentOrderId,
    );
    if (order === null || order.warehouseId !== args.warehouseId) {
      return refusal({ code: "NOT_FOUND", table: "fulfillmentOrders" });
    }
    if (order.status !== "RELEASED" && order.status !== "IN_FULFILLMENT") {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "status",
        reason: "FULFILLMENT_NOT_RELEASED",
      });
    }
    const number = normalizeField(
      "shipmentNumber",
      args.shipmentNumber,
      CODE_FIELD,
    );
    if (!number.ok) return refusal(number.error);
    const fingerprint = {
      operation: SHIPMENT_OPERATIONS.create,
      requestId: args.requestId,
      warehouseId: args.warehouseId,
      fulfillmentOrderId: args.fulfillmentOrderId,
      shipmentNumber: number.value,
    };
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "shipments",
      operation: SHIPMENT_OPERATIONS.create,
      requestId: args.requestId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);

    const packagePage = await ctx.tenantDb
      .byIndex<PackageRow>(
        "fulfillmentPackages",
        "by_orgId_warehouseId_status_packageNumber",
        [
          { field: "warehouseId", value: args.warehouseId },
          { field: "status", value: "ISSUED" },
        ],
      )
      .page({ limit: MAX_PACKAGES });
    if (!packagePage.isDone) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "packages",
        reason: "PACKAGE_LIMIT_EXCEEDED",
      });
    }
    const packages = packagePage.page.filter(
      (row) => row.fulfillmentOrderId === args.fulfillmentOrderId,
    );
    if (packages.length === 0) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "packages",
        reason: "NO_ISSUED_PACKAGES",
      });
    }
    for (const packageRow of packages) {
      const assigned = await ctx.tenantDb
        .byIndex<{ readonly _id: string; readonly orgId: TenantOrgId }>(
          "shipmentPackages",
          "by_orgId_fulfillmentPackageId",
          [{ field: "fulfillmentPackageId", value: packageRow._id }],
        )
        .unique();
      if (assigned !== null) {
        return refusal({
          code: "PRECONDITION_FAILED",
          field: "packages",
          reason: "PACKAGE_ALREADY_ASSIGNED",
        });
      }
    }
    const now = Date.now();
    const outcome = await createMasterDataRow({
      ...writeContextOf(ctx, {
        table: "shipments",
        operation: SHIPMENT_OPERATIONS.create,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      fingerprint,
      uniqueness: [
        {
          field: "shipmentNumber",
          index: "by_orgId_shipmentNumber",
          equality: [{ field: "shipmentNumber", value: number.value }],
        },
      ],
      document: {
        shipmentNumber: number.value,
        fulfillmentOrderId: args.fulfillmentOrderId,
        warehouseId: args.warehouseId,
        status: "DRAFT",
        expectedPackageCount: packages.length,
        loadedPackageCount: 0,
        ...(order.requestedDeliveryAt === undefined
          ? {}
          : { requestedDeliveryAt: order.requestedDeliveryAt }),
        createdByUserId: ctx.tenant.actor._id,
        createdAt: now,
      },
    });
    if (!outcome.ok) return refusal(outcome.error);
    for (const packageRow of packages) {
      const manifest = {
        shipmentId: outcome.value.documentId,
        fulfillmentPackageId: packageRow._id,
        warehouseId: args.warehouseId,
        status: "EXPECTED",
      };
      const manifestId = await ctx.tenantDb.insert(
        "shipmentPackages",
        manifest,
      );
      await appendDomainAudit(
        writeContextOf(ctx, {
          table: "shipments",
          operation: SHIPMENT_OPERATIONS.create,
          requestId: args.requestId,
          warehouseId: args.warehouseId,
        }),
        {
          entityTable: "shipmentPackages",
          entityId: manifestId,
          changes: insertedFields(manifest),
        },
      );
    }
    const documentReturn = {
      shipmentId: outcome.value.documentId,
      warehouseId: args.warehouseId,
      status: "EXPECTED",
      documentType: "SIGNED_DELIVERY_NOTE",
    };
    const returnId = await ctx.tenantDb.insert(
      "documentReturns",
      documentReturn,
    );
    await appendDomainAudit(
      writeContextOf(ctx, {
        table: "shipments",
        operation: SHIPMENT_OPERATIONS.create,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      {
        entityTable: "documentReturns",
        entityId: returnId,
        changes: insertedFields(documentReturn),
      },
    );
    return written(outcome.value);
  },
});

export const releaseShipment = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    shipmentId: v.id("shipments"),
  },
  returns: writeOutcomeValidator,
  permissionCode: "fulfillment.shipment.manage",
  target: { table: "shipments", id: ({ shipmentId }) => shipmentId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const shipment = await ctx.tenantDb.get<ShipmentRow>(
      "shipments",
      args.shipmentId,
    );
    if (shipment === null || shipment.warehouseId !== args.warehouseId) {
      return refusal({ code: "NOT_FOUND", table: "shipments" });
    }
    const fingerprint = {
      operation: SHIPMENT_OPERATIONS.release,
      requestId: args.requestId,
      warehouseId: args.warehouseId,
      shipmentId: args.shipmentId,
    };
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "shipments",
      operation: SHIPMENT_OPERATIONS.release,
      requestId: args.requestId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);
    if (shipment.status !== "DRAFT" || shipment.expectedPackageCount <= 0) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "status",
        reason: "SHIPMENT_NOT_RELEASABLE",
      });
    }
    const outcome = await updateMasterDataRow({
      ...writeContextOf(ctx, {
        table: "shipments",
        operation: SHIPMENT_OPERATIONS.release,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      documentId: args.shipmentId,
      fingerprint,
      uniqueness: [],
      patch: { status: "READY_TO_LOAD", releasedAt: Date.now() },
    });
    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});

export const getShipment = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    shipmentId: v.id("shipments"),
  },
  returns: shipmentSummaryValidator,
  permissionCode: "fulfillment.shipment.read",
  target: { table: "shipments", id: ({ shipmentId }) => shipmentId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const shipment = await ctx.tenantDb.get<ShipmentRow>(
      "shipments",
      args.shipmentId,
    );
    if (shipment === null || shipment.warehouseId !== args.warehouseId) {
      return { found: false };
    }
    return {
      found: true,
      shipmentId: shipment._id as never,
      shipmentNumber: shipment.shipmentNumber,
      fulfillmentOrderId: shipment.fulfillmentOrderId as never,
      warehouseId: shipment.warehouseId as never,
      status: shipment.status,
      expectedPackageCount: shipment.expectedPackageCount,
      loadedPackageCount: shipment.loadedPackageCount,
      ...(shipment.tripId === undefined
        ? {}
        : { tripId: shipment.tripId as never }),
    };
  },
});

export const listShipments = queryWithOrg({
  args: { warehouseId: v.id("warehouses"), ...listArgs },
  returns: pageOf(shipmentSummaryValidator),
  permissionCode: "fulfillment.shipment.read",
  target: { table: "shipments" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const request = pageRequestOf(args);
    if (!request.ok) return pageRefusal(request.error.code);
    const page = await ctx.tenantDb
      .byIndex<ShipmentRow>(
        "shipments",
        "by_orgId_warehouseId_status_shipmentNumber",
        [{ field: "warehouseId", value: args.warehouseId }],
      )
      .page(pageOptions(request.value));
    return pageResult(
      page.page.map((shipment) => ({
        found: true,
        shipmentId: shipment._id as never,
        shipmentNumber: shipment.shipmentNumber,
        fulfillmentOrderId: shipment.fulfillmentOrderId as never,
        warehouseId: shipment.warehouseId as never,
        status: shipment.status,
        expectedPackageCount: shipment.expectedPackageCount,
        loadedPackageCount: shipment.loadedPackageCount,
        ...(shipment.tripId === undefined
          ? {}
          : { tripId: shipment.tripId as never }),
      })),
      page,
    );
  },
});
