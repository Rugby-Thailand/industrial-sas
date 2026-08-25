/** Available-stock fulfillment order setup and release (Path A, FF-P3-01). */
import { v } from "convex/values";

import {
  CODE_FIELD,
  createMasterDataRow,
  normalizeDisplayName,
  normalizeField,
  replayTenantWriteIfPresent,
  updateMasterDataRow,
} from "../lib/masterDataStore";
import {
  listArgs,
  pageOf,
  pageOptions,
  pageRefusal,
  pageRequestOf,
  pageResult,
} from "../lib/listEnvelope";
import { mutationWithOrg, queryWithOrg } from "../lib/tenantFunctions";
import type { TenantOrgId } from "../lib/tenantDb";
import {
  fulfillmentLineStatus,
  fulfillmentOrderRouteDecision,
  fulfillmentOrderStatus,
  fulfillmentRouteDecision,
} from "../lib/validators";
import {
  refusal,
  writeContextOf,
  writeOutcomeValidator,
  written,
} from "../lib/writeEnvelope";
import {
  decideDemandRoute,
  mergeRouteDecision,
} from "../model/fulfillment/demandRouting";
import {
  initialFulfillmentQuantities,
  type FulfillmentQuantities,
} from "../model/fulfillment/reservationPolicy";
import { readAvailableToPromise } from "./reservations";

export const FULFILLMENT_ORDER_OPERATIONS = Object.freeze({
  create: "fulfillment.order.create",
  addLine: "fulfillment.order.line.add",
  routeHeader: "fulfillment.order.route.header",
  routeLine: "fulfillment.order.route.line",
  release: "fulfillment.order.release",
});

const shipToValidator = v.object({
  name: v.string(),
  addressLine1: v.string(),
  addressLine2: v.optional(v.string()),
  district: v.optional(v.string()),
  province: v.string(),
  postalCode: v.optional(v.string()),
  countryCode: v.string(),
  recipientName: v.optional(v.string()),
  recipientPhone: v.optional(v.string()),
});

const quantitiesValidator = v.object({
  DEMAND: v.number(),
  RESERVED: v.number(),
  PICKING: v.number(),
  STAGED: v.number(),
  ISSUED: v.number(),
  LOADED: v.number(),
  DELIVERED: v.number(),
  RETURNED: v.number(),
  BACKORDERED: v.number(),
  CANCELLED: v.number(),
});

interface OrderRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly customerId: string;
  readonly status: string;
}

interface OrderLineRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly customerOrderId: string;
  readonly status: string;
  readonly orderedQuantity: number;
}

interface ItemRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly baseUom: string;
  readonly status: string;
}

interface FulfillmentOrderRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly fulfillmentNumber: string;
  readonly customerOrderId: string;
  readonly customerId: string;
  readonly warehouseId: string;
  readonly status:
    | "DRAFT"
    | "RELEASED"
    | "IN_FULFILLMENT"
    | "PARTIALLY_COMPLETE"
    | "COMPLETE"
    | "CANCELLED";
  readonly routeDecision: "AVAILABLE_STOCK" | "PRODUCTION" | "MIXED";
  readonly routeVersion: number;
  readonly allowPartial: boolean;
  readonly requestedDeliveryAt?: number;
  readonly shipTo: {
    readonly name: string;
    readonly addressLine1: string;
    readonly addressLine2?: string;
    readonly district?: string;
    readonly province: string;
    readonly postalCode?: string;
    readonly countryCode: string;
    readonly recipientName?: string;
    readonly recipientPhone?: string;
  };
  readonly releasedAt?: number;
}

interface FulfillmentLineRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly fulfillmentOrderId: string;
  readonly customerOrderLineId: string;
  readonly warehouseId: string;
  readonly itemId: string;
  readonly baseUom: string;
  readonly orderedBaseMinorUnits: number;
  readonly routeDecision?: "AVAILABLE_STOCK" | "PRODUCTION";
  readonly routeVersion?: number;
  readonly routedAt?: number;
  readonly productionShortageBaseMinorUnits?: number;
  readonly availableStockPlannedBaseMinorUnits?: number;
  readonly status: string;
  readonly quantities: FulfillmentQuantities;
}

const optionalText = (
  field: string,
  raw: string | undefined,
  limit: number,
) => {
  if (raw === undefined) return { ok: true as const, value: undefined };
  const value = raw.trim();
  return value.length === 0 || value.length > limit
    ? {
        ok: false as const,
        error: {
          code: "FIELD_INVALID" as const,
          field,
          reason: value.length === 0 ? "EMPTY" : "TOO_LONG",
        },
      }
    : { ok: true as const, value };
};

function normalizeShipTo(raw: {
  readonly name: string;
  readonly addressLine1: string;
  readonly addressLine2?: string;
  readonly district?: string;
  readonly province: string;
  readonly postalCode?: string;
  readonly countryCode: string;
  readonly recipientName?: string;
  readonly recipientPhone?: string;
}) {
  const name = normalizeDisplayName("shipTo.name", raw.name);
  if (!name.ok) return name;
  const addressLine1 = optionalText(
    "shipTo.addressLine1",
    raw.addressLine1,
    300,
  );
  if (!addressLine1.ok) return addressLine1;
  const province = normalizeDisplayName("shipTo.province", raw.province);
  if (!province.ok) return province;
  const optionals = {
    addressLine2: optionalText("shipTo.addressLine2", raw.addressLine2, 300),
    district: optionalText("shipTo.district", raw.district, 120),
    postalCode: optionalText("shipTo.postalCode", raw.postalCode, 20),
    recipientName: optionalText("shipTo.recipientName", raw.recipientName, 200),
    recipientPhone: optionalText(
      "shipTo.recipientPhone",
      raw.recipientPhone,
      40,
    ),
  };
  for (const value of Object.values(optionals)) {
    if (!value.ok) return value;
  }
  const countryCode = raw.countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) {
    return {
      ok: false as const,
      error: {
        code: "FIELD_INVALID" as const,
        field: "shipTo.countryCode",
        reason: "INVALID_COUNTRY_CODE",
      },
    };
  }
  return {
    ok: true as const,
    value: {
      name: name.value,
      addressLine1: addressLine1.value!,
      ...(optionals.addressLine2.value === undefined
        ? {}
        : { addressLine2: optionals.addressLine2.value }),
      ...(optionals.district.value === undefined
        ? {}
        : { district: optionals.district.value }),
      province: province.value,
      ...(optionals.postalCode.value === undefined
        ? {}
        : { postalCode: optionals.postalCode.value }),
      countryCode,
      ...(optionals.recipientName.value === undefined
        ? {}
        : { recipientName: optionals.recipientName.value }),
      ...(optionals.recipientPhone.value === undefined
        ? {}
        : { recipientPhone: optionals.recipientPhone.value }),
    },
  };
}

const sameShipTo = (
  left: FulfillmentOrderRow["shipTo"],
  right: FulfillmentOrderRow["shipTo"],
) =>
  left.name === right.name &&
  left.addressLine1 === right.addressLine1 &&
  left.addressLine2 === right.addressLine2 &&
  left.district === right.district &&
  left.province === right.province &&
  left.postalCode === right.postalCode &&
  left.countryCode === right.countryCode &&
  left.recipientName === right.recipientName &&
  left.recipientPhone === right.recipientPhone;

export const createFulfillmentOrder = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    fulfillmentNumber: v.string(),
    customerOrderId: v.id("customerOrders"),
    allowPartial: v.boolean(),
    requestedDeliveryAt: v.optional(v.number()),
    shipTo: shipToValidator,
  },
  returns: writeOutcomeValidator,
  permissionCode: "fulfillment.order.manage",
  target: {
    table: "fulfillmentOrders",
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const fulfillmentNumber = normalizeField(
      "fulfillmentNumber",
      args.fulfillmentNumber,
      CODE_FIELD,
    );
    if (!fulfillmentNumber.ok) return refusal(fulfillmentNumber.error);
    const shipTo = normalizeShipTo(args.shipTo);
    if (!shipTo.ok) return refusal(shipTo.error);
    if (
      args.requestedDeliveryAt !== undefined &&
      (!Number.isSafeInteger(args.requestedDeliveryAt) ||
        args.requestedDeliveryAt <= 0)
    ) {
      return refusal({
        code: "FIELD_INVALID",
        field: "requestedDeliveryAt",
        reason: "INVALID_INSTANT",
      });
    }
    const warehouse = await ctx.tenantDb.get("warehouses", args.warehouseId);
    if (warehouse === null) {
      return refusal({ code: "REFERENCE_NOT_FOUND", field: "warehouseId" });
    }
    const order = await ctx.tenantDb.get<OrderRow>(
      "customerOrders",
      args.customerOrderId,
    );
    if (order === null) {
      return refusal({
        code: "REFERENCE_NOT_FOUND",
        field: "customerOrderId",
      });
    }
    if (order.status !== "RELEASED") {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "customerOrderId",
        reason: "ORDER_NOT_RELEASED",
      });
    }
    const context = writeContextOf(ctx, {
      table: "fulfillmentOrders",
      operation: FULFILLMENT_ORDER_OPERATIONS.create,
      requestId: args.requestId,
      warehouseId: args.warehouseId,
    });
    const fingerprint = {
      operation: FULFILLMENT_ORDER_OPERATIONS.create,
      requestId: args.requestId,
      warehouseId: args.warehouseId,
      fulfillmentNumber: fulfillmentNumber.value,
      customerOrderId: args.customerOrderId,
      allowPartial: args.allowPartial,
      requestedDeliveryAt: args.requestedDeliveryAt,
      shipTo: shipTo.value,
    };
    const outcome = await createMasterDataRow({
      ...context,
      fingerprint,
      uniqueness: [
        {
          field: "fulfillmentNumber",
          index: "by_orgId_fulfillmentNumber",
          equality: [
            { field: "fulfillmentNumber", value: fulfillmentNumber.value },
          ],
        },
        {
          field: "customerOrderId",
          index: "by_orgId_customerOrderId_warehouseId",
          equality: [
            { field: "customerOrderId", value: args.customerOrderId },
            { field: "warehouseId", value: args.warehouseId },
          ],
        },
      ],
      document: {
        fulfillmentNumber: fulfillmentNumber.value,
        customerOrderId: args.customerOrderId,
        customerId: order.customerId,
        warehouseId: args.warehouseId,
        status: "DRAFT",
        routeDecision: "AVAILABLE_STOCK",
        routeVersion: 1,
        allowPartial: args.allowPartial,
        ...(args.requestedDeliveryAt === undefined
          ? {}
          : { requestedDeliveryAt: args.requestedDeliveryAt }),
        shipTo: shipTo.value,
        createdByUserId: ctx.tenant.actor._id,
      },
    });
    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});

export const addFulfillmentLine = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    fulfillmentOrderId: v.id("fulfillmentOrders"),
    customerOrderLineId: v.id("customerOrderLines"),
    itemId: v.id("items"),
  },
  returns: writeOutcomeValidator,
  permissionCode: "fulfillment.order.manage",
  target: {
    table: "fulfillmentOrders",
    id: ({ fulfillmentOrderId }) => fulfillmentOrderId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const fulfillment = await ctx.tenantDb.get<FulfillmentOrderRow>(
      "fulfillmentOrders",
      args.fulfillmentOrderId,
    );
    if (fulfillment === null) {
      return refusal({ code: "NOT_FOUND", table: "fulfillmentOrders" });
    }
    if (fulfillment.warehouseId !== args.warehouseId) {
      return refusal({ code: "REFERENCE_NOT_FOUND", field: "warehouseId" });
    }
    const fingerprint = {
      operation: FULFILLMENT_ORDER_OPERATIONS.addLine,
      requestId: args.requestId,
      warehouseId: args.warehouseId,
      fulfillmentOrderId: args.fulfillmentOrderId,
      customerOrderLineId: args.customerOrderLineId,
      itemId: args.itemId,
    };
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "fulfillmentLines",
      operation: FULFILLMENT_ORDER_OPERATIONS.addLine,
      requestId: args.requestId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);
    if (fulfillment.status !== "DRAFT") {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "status",
        reason: "FULFILLMENT_NOT_DRAFT",
      });
    }
    const line = await ctx.tenantDb.get<OrderLineRow>(
      "customerOrderLines",
      args.customerOrderLineId,
    );
    if (line === null || line.customerOrderId !== fulfillment.customerOrderId) {
      return refusal({
        code: "REFERENCE_NOT_FOUND",
        field: "customerOrderLineId",
      });
    }
    if (line.status !== "DESIGN_READY") {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "customerOrderLineId",
        reason: "LINE_NOT_DESIGN_READY",
      });
    }
    const item = await ctx.tenantDb.get<ItemRow>("items", args.itemId);
    if (item === null || item.status !== "ACTIVE") {
      return refusal({ code: "REFERENCE_NOT_FOUND", field: "itemId" });
    }
    const orderedBaseMinorUnits = line.orderedQuantity * 1_000;
    if (!Number.isSafeInteger(orderedBaseMinorUnits)) {
      return refusal({
        code: "FIELD_INVALID",
        field: "orderedQuantity",
        reason: "OUT_OF_RANGE",
      });
    }
    const quantities = initialFulfillmentQuantities(orderedBaseMinorUnits);
    if (!quantities.ok) return refusal(quantities.error);
    const outcome = await createMasterDataRow({
      ...writeContextOf(ctx, {
        table: "fulfillmentLines",
        operation: FULFILLMENT_ORDER_OPERATIONS.addLine,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      fingerprint,
      uniqueness: [
        {
          field: "customerOrderLineId",
          index: "by_orgId_fulfillmentOrderId_customerOrderLineId",
          equality: [
            { field: "fulfillmentOrderId", value: args.fulfillmentOrderId },
            {
              field: "customerOrderLineId",
              value: args.customerOrderLineId,
            },
          ],
        },
        {
          field: "customerOrderLineId",
          index: "by_orgId_customerOrderLineId",
          equality: [
            {
              field: "customerOrderLineId",
              value: args.customerOrderLineId,
            },
          ],
        },
      ],
      document: {
        fulfillmentOrderId: args.fulfillmentOrderId,
        customerOrderLineId: args.customerOrderLineId,
        warehouseId: args.warehouseId,
        itemId: args.itemId,
        baseUom: item.baseUom,
        orderedBaseMinorUnits,
        status: "UNPLANNED",
        quantities: { ...quantities.value },
        createdByUserId: ctx.tenant.actor._id,
      },
    });
    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});

/**
 * Create executable fulfillment demand and choose stock or production before
 * the customer line is handed to the factory. The command is atomic: callers
 * never get a routed header without its demand line, or a demand line without
 * the route evidence that explains it.
 */
export const routeCustomerOrderLine = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    fulfillmentNumber: v.string(),
    customerOrderLineId: v.id("customerOrderLines"),
    itemId: v.id("items"),
    allowPartial: v.boolean(),
    requestedDeliveryAt: v.optional(v.number()),
    shipTo: shipToValidator,
  },
  returns: writeOutcomeValidator,
  permissionCode: "fulfillment.order.manage",
  target: { table: "fulfillmentLines" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const fulfillmentNumber = normalizeField(
      "fulfillmentNumber",
      args.fulfillmentNumber,
      CODE_FIELD,
    );
    if (!fulfillmentNumber.ok) return refusal(fulfillmentNumber.error);
    const shipTo = normalizeShipTo(args.shipTo);
    if (!shipTo.ok) return refusal(shipTo.error);
    if (
      args.requestedDeliveryAt !== undefined &&
      (!Number.isSafeInteger(args.requestedDeliveryAt) ||
        args.requestedDeliveryAt <= 0)
    ) {
      return refusal({
        code: "FIELD_INVALID",
        field: "requestedDeliveryAt",
        reason: "INVALID_INSTANT",
      });
    }

    const fingerprint = {
      operation: FULFILLMENT_ORDER_OPERATIONS.routeLine,
      requestId: args.requestId,
      warehouseId: args.warehouseId,
      fulfillmentNumber: fulfillmentNumber.value,
      customerOrderLineId: args.customerOrderLineId,
      itemId: args.itemId,
      allowPartial: args.allowPartial,
      requestedDeliveryAt: args.requestedDeliveryAt,
      shipTo: shipTo.value,
    };
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "fulfillmentLines",
      operation: FULFILLMENT_ORDER_OPERATIONS.routeLine,
      requestId: args.requestId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);

    const warehouse = await ctx.tenantDb.get("warehouses", args.warehouseId);
    if (warehouse === null) {
      return refusal({ code: "REFERENCE_NOT_FOUND", field: "warehouseId" });
    }
    const line = await ctx.tenantDb.get<OrderLineRow>(
      "customerOrderLines",
      args.customerOrderLineId,
    );
    if (line === null) {
      return refusal({
        code: "REFERENCE_NOT_FOUND",
        field: "customerOrderLineId",
      });
    }
    if (line.status !== "DESIGN_READY") {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "customerOrderLineId",
        reason: "LINE_NOT_DESIGN_READY",
      });
    }
    const order = await ctx.tenantDb.get<OrderRow>(
      "customerOrders",
      line.customerOrderId,
    );
    if (order === null || order.status !== "RELEASED") {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "customerOrderLineId",
        reason: "ORDER_NOT_RELEASED",
      });
    }
    const item = await ctx.tenantDb.get<ItemRow>("items", args.itemId);
    if (item === null || item.status !== "ACTIVE") {
      return refusal({ code: "REFERENCE_NOT_FOUND", field: "itemId" });
    }
    const orderedBaseMinorUnits = line.orderedQuantity * 1_000;
    if (
      !Number.isSafeInteger(orderedBaseMinorUnits) ||
      orderedBaseMinorUnits <= 0
    ) {
      return refusal({
        code: "FIELD_INVALID",
        field: "orderedQuantity",
        reason: "OUT_OF_RANGE",
      });
    }
    const atp = await readAvailableToPromise({
      tenantDb: ctx.tenantDb,
      warehouseId: args.warehouseId,
      itemId: args.itemId,
      baseUom: item.baseUom,
    });
    if (!atp.ok) return refusal(atp);
    const priorCommitmentPage = await ctx.tenantDb
      .byIndex<FulfillmentLineRow>(
        "fulfillmentLines",
        "by_orgId_warehouseId_itemId_routedAt",
        [
          { field: "warehouseId", value: args.warehouseId },
          { field: "itemId", value: args.itemId },
        ],
      )
      .page({ limit: 100 });
    if (!priorCommitmentPage.isDone) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "itemId",
        reason: "ROUTING_COMMITMENT_LIMIT",
      });
    }
    const priorCommitments = priorCommitmentPage.page;
    const pendingAvailableCommitment = priorCommitments.reduce(
      (sum, committed) => {
        const planned = committed.availableStockPlannedBaseMinorUnits ?? 0;
        const stillUnallocated =
          committed.quantities.DEMAND + committed.quantities.BACKORDERED;
        return sum + Math.min(planned, stillUnallocated);
      },
      0,
    );
    if (!Number.isSafeInteger(pendingAvailableCommitment)) {
      return refusal({ code: "STORED_ROW_INVALID" });
    }
    const effectiveAtp = Math.max(
      0,
      atp.atpBaseMinorUnits - pendingAvailableCommitment,
    );
    const route = decideDemandRoute({
      orderedBaseMinorUnits,
      atpBaseMinorUnits: effectiveAtp,
    });
    if (!route.ok) return refusal(route.error);
    const quantities = initialFulfillmentQuantities(orderedBaseMinorUnits);
    if (!quantities.ok) return refusal(quantities.error);

    const existingOrder = await ctx.tenantDb
      .byIndex<FulfillmentOrderRow>(
        "fulfillmentOrders",
        "by_orgId_customerOrderId_warehouseId",
        [
          { field: "customerOrderId", value: line.customerOrderId },
          { field: "warehouseId", value: args.warehouseId },
        ],
      )
      .first();
    if (
      existingOrder !== null &&
      (existingOrder.status !== "DRAFT" ||
        existingOrder.fulfillmentNumber !== fulfillmentNumber.value ||
        existingOrder.allowPartial !== args.allowPartial ||
        existingOrder.requestedDeliveryAt !== args.requestedDeliveryAt ||
        !sameShipTo(existingOrder.shipTo, shipTo.value))
    ) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "fulfillmentNumber",
        reason: "FULFILLMENT_HEADER_CONFLICT",
      });
    }

    const headerFingerprint = {
      ...fingerprint,
      operation: FULFILLMENT_ORDER_OPERATIONS.routeHeader,
      routeDecision: route.value.decision,
    };
    let fulfillmentOrderId: string;
    let routeVersion: number;
    if (existingOrder === null) {
      const created = await createMasterDataRow({
        ...writeContextOf(ctx, {
          table: "fulfillmentOrders",
          operation: FULFILLMENT_ORDER_OPERATIONS.routeHeader,
          requestId: args.requestId,
          warehouseId: args.warehouseId,
        }),
        fingerprint: headerFingerprint,
        uniqueness: [
          {
            field: "fulfillmentNumber",
            index: "by_orgId_fulfillmentNumber",
            equality: [
              {
                field: "fulfillmentNumber",
                value: fulfillmentNumber.value,
              },
            ],
          },
          {
            field: "customerOrderId",
            index: "by_orgId_customerOrderId_warehouseId",
            equality: [
              { field: "customerOrderId", value: line.customerOrderId },
              { field: "warehouseId", value: args.warehouseId },
            ],
          },
        ],
        document: {
          fulfillmentNumber: fulfillmentNumber.value,
          customerOrderId: line.customerOrderId,
          customerId: order.customerId,
          warehouseId: args.warehouseId,
          status: "DRAFT",
          routeDecision: route.value.decision,
          routeVersion: 1,
          allowPartial: args.allowPartial,
          ...(args.requestedDeliveryAt === undefined
            ? {}
            : { requestedDeliveryAt: args.requestedDeliveryAt }),
          shipTo: shipTo.value,
          createdByUserId: ctx.tenant.actor._id,
        },
      });
      if (!created.ok) return refusal(created.error);
      fulfillmentOrderId = created.value.documentId;
      routeVersion = 1;
    } else {
      if (!Number.isSafeInteger(existingOrder.routeVersion)) {
        return refusal({ code: "STORED_ROW_INVALID" });
      }
      routeVersion = existingOrder.routeVersion + 1;
      const updated = await updateMasterDataRow({
        ...writeContextOf(ctx, {
          table: "fulfillmentOrders",
          operation: FULFILLMENT_ORDER_OPERATIONS.routeHeader,
          requestId: args.requestId,
          warehouseId: args.warehouseId,
        }),
        documentId: existingOrder._id,
        fingerprint: headerFingerprint,
        uniqueness: [],
        patch: {
          routeDecision: mergeRouteDecision(
            existingOrder.routeDecision,
            route.value.decision,
          ),
          routeVersion,
        },
      });
      if (!updated.ok) return refusal(updated.error);
      fulfillmentOrderId = existingOrder._id;
    }

    const routedAt = Date.now();
    const createdLine = await createMasterDataRow({
      ...writeContextOf(ctx, {
        table: "fulfillmentLines",
        operation: FULFILLMENT_ORDER_OPERATIONS.routeLine,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      fingerprint,
      uniqueness: [
        {
          field: "customerOrderLineId",
          index: "by_orgId_fulfillmentOrderId_customerOrderLineId",
          equality: [
            { field: "fulfillmentOrderId", value: fulfillmentOrderId },
            {
              field: "customerOrderLineId",
              value: args.customerOrderLineId,
            },
          ],
        },
        {
          field: "customerOrderLineId",
          index: "by_orgId_customerOrderLineId",
          equality: [
            {
              field: "customerOrderLineId",
              value: args.customerOrderLineId,
            },
          ],
        },
      ],
      document: {
        fulfillmentOrderId,
        customerOrderLineId: args.customerOrderLineId,
        warehouseId: args.warehouseId,
        itemId: args.itemId,
        baseUom: item.baseUom,
        orderedBaseMinorUnits,
        routeDecision: route.value.decision,
        routeVersion,
        routedAt,
        productionShortageBaseMinorUnits:
          route.value.productionShortageBaseMinorUnits,
        availableStockPlannedBaseMinorUnits:
          orderedBaseMinorUnits - route.value.productionShortageBaseMinorUnits,
        status: "UNPLANNED",
        quantities: { ...quantities.value },
        createdByUserId: ctx.tenant.actor._id,
      },
    });
    return createdLine.ok
      ? written(createdLine.value)
      : refusal(createdLine.error);
  },
});

export const releaseFulfillmentOrder = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    fulfillmentOrderId: v.id("fulfillmentOrders"),
  },
  returns: writeOutcomeValidator,
  permissionCode: "fulfillment.order.release",
  target: {
    table: "fulfillmentOrders",
    id: ({ fulfillmentOrderId }) => fulfillmentOrderId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const fulfillment = await ctx.tenantDb.get<FulfillmentOrderRow>(
      "fulfillmentOrders",
      args.fulfillmentOrderId,
    );
    if (fulfillment === null) {
      return refusal({ code: "NOT_FOUND", table: "fulfillmentOrders" });
    }
    if (fulfillment.warehouseId !== args.warehouseId) {
      return refusal({ code: "REFERENCE_NOT_FOUND", field: "warehouseId" });
    }
    const fingerprint = {
      operation: FULFILLMENT_ORDER_OPERATIONS.release,
      requestId: args.requestId,
      warehouseId: args.warehouseId,
      fulfillmentOrderId: args.fulfillmentOrderId,
    };
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "fulfillmentOrders",
      operation: FULFILLMENT_ORDER_OPERATIONS.release,
      requestId: args.requestId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);
    if (fulfillment.status !== "DRAFT") {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "status",
        reason: "FULFILLMENT_NOT_DRAFT",
      });
    }
    const firstLine = await ctx.tenantDb
      .byIndex<FulfillmentLineRow>(
        "fulfillmentLines",
        "by_orgId_fulfillmentOrderId_customerOrderLineId",
        [
          {
            field: "fulfillmentOrderId",
            value: args.fulfillmentOrderId,
          },
        ],
      )
      .first();
    if (firstLine === null) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "lines",
        reason: "NO_FULFILLMENT_LINES",
      });
    }
    const outcome = await updateMasterDataRow({
      ...writeContextOf(ctx, {
        table: "fulfillmentOrders",
        operation: FULFILLMENT_ORDER_OPERATIONS.release,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      documentId: args.fulfillmentOrderId,
      fingerprint,
      uniqueness: [],
      patch: { status: "RELEASED", releasedAt: Date.now() },
    });
    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});

const fulfillmentOrderValidator = v.object({
  fulfillmentOrderId: v.id("fulfillmentOrders"),
  fulfillmentNumber: v.string(),
  customerOrderId: v.id("customerOrders"),
  customerId: v.id("customers"),
  warehouseId: v.id("warehouses"),
  status: fulfillmentOrderStatus,
  routeDecision: fulfillmentOrderRouteDecision,
  routeVersion: v.number(),
  allowPartial: v.boolean(),
  requestedDeliveryAt: v.optional(v.number()),
  shipTo: shipToValidator,
  releasedAt: v.optional(v.number()),
});

const fulfillmentLineValidator = v.object({
  fulfillmentLineId: v.id("fulfillmentLines"),
  fulfillmentOrderId: v.id("fulfillmentOrders"),
  customerOrderLineId: v.id("customerOrderLines"),
  warehouseId: v.id("warehouses"),
  itemId: v.id("items"),
  baseUom: v.string(),
  orderedBaseMinorUnits: v.number(),
  routeDecision: v.optional(fulfillmentRouteDecision),
  routeVersion: v.optional(v.number()),
  routedAt: v.optional(v.number()),
  productionShortageBaseMinorUnits: v.optional(v.number()),
  availableStockPlannedBaseMinorUnits: v.optional(v.number()),
  status: fulfillmentLineStatus,
  quantities: quantitiesValidator,
});

export const listFulfillmentOrders = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    status: v.optional(fulfillmentOrderStatus),
    ...listArgs,
  },
  returns: pageOf(fulfillmentOrderValidator),
  permissionCode: "fulfillment.order.read",
  target: {
    table: "fulfillmentOrders",
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const request = pageRequestOf(args);
    if (!request.ok) return pageRefusal(request.error.code);
    const page = await ctx.tenantDb
      .byIndex<FulfillmentOrderRow>(
        "fulfillmentOrders",
        "by_orgId_warehouseId_status_fulfillmentNumber",
        [
          { field: "warehouseId", value: args.warehouseId },
          ...(args.status === undefined
            ? []
            : [{ field: "status", value: args.status }]),
        ],
      )
      .page(pageOptions(request.value));
    return pageResult(
      page.page.map((row) => ({
        fulfillmentOrderId: row._id as never,
        fulfillmentNumber: row.fulfillmentNumber,
        customerOrderId: row.customerOrderId as never,
        customerId: row.customerId as never,
        warehouseId: row.warehouseId as never,
        status: row.status,
        routeDecision: row.routeDecision,
        routeVersion: row.routeVersion,
        allowPartial: row.allowPartial,
        ...(row.requestedDeliveryAt === undefined
          ? {}
          : { requestedDeliveryAt: row.requestedDeliveryAt }),
        shipTo: { ...row.shipTo },
        ...(row.releasedAt === undefined ? {} : { releasedAt: row.releasedAt }),
      })),
      page,
    );
  },
});

export const listFulfillmentLines = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    fulfillmentOrderId: v.id("fulfillmentOrders"),
    ...listArgs,
  },
  returns: pageOf(fulfillmentLineValidator),
  permissionCode: "fulfillment.order.read",
  target: {
    table: "fulfillmentOrders",
    id: ({ fulfillmentOrderId }) => fulfillmentOrderId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const request = pageRequestOf(args);
    if (!request.ok) return pageRefusal(request.error.code);
    const order = await ctx.tenantDb.get<FulfillmentOrderRow>(
      "fulfillmentOrders",
      args.fulfillmentOrderId,
    );
    if (order === null || order.warehouseId !== args.warehouseId) {
      return pageRefusal("REFERENCE_NOT_FOUND");
    }
    const page = await ctx.tenantDb
      .byIndex<FulfillmentLineRow>(
        "fulfillmentLines",
        "by_orgId_fulfillmentOrderId_customerOrderLineId",
        [
          {
            field: "fulfillmentOrderId",
            value: args.fulfillmentOrderId,
          },
        ],
      )
      .page(pageOptions(request.value));
    return pageResult(
      page.page.map((row) => ({
        fulfillmentLineId: row._id as never,
        fulfillmentOrderId: row.fulfillmentOrderId as never,
        customerOrderLineId: row.customerOrderLineId as never,
        warehouseId: row.warehouseId as never,
        itemId: row.itemId as never,
        baseUom: row.baseUom,
        orderedBaseMinorUnits: row.orderedBaseMinorUnits,
        ...(row.routeDecision === undefined
          ? {}
          : { routeDecision: row.routeDecision }),
        ...(row.routeVersion === undefined
          ? {}
          : { routeVersion: row.routeVersion }),
        ...(row.routedAt === undefined ? {} : { routedAt: row.routedAt }),
        ...(row.productionShortageBaseMinorUnits === undefined
          ? {}
          : {
              productionShortageBaseMinorUnits:
                row.productionShortageBaseMinorUnits,
            }),
        ...(row.availableStockPlannedBaseMinorUnits === undefined
          ? {}
          : {
              availableStockPlannedBaseMinorUnits:
                row.availableStockPlannedBaseMinorUnits,
            }),
        status: row.status as never,
        quantities: { ...row.quantities },
      })),
      page,
    );
  },
});
