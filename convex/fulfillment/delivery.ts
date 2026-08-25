/** Driver delivery evidence, independent POD review, and order completion. */
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
  postLedgerTransaction,
  toPublicLedgerError,
} from "../lib/inventoryLedgerStore";
import {
  appendDomainAudit,
  createMasterDataRow,
  insertedFields,
  replayTenantWriteIfPresent,
  updateMasterDataRow,
} from "../lib/masterDataStore";
import {
  mutationWithOrg,
  queryWithOrg,
  type TenantPolicyContext,
} from "../lib/tenantFunctions";
import type { TenantOrgId } from "../lib/tenantDb";
import {
  refusal,
  writeContextOf,
  writeOutcomeValidator,
  written,
} from "../lib/writeEnvelope";
import { completeDelivery } from "../model/fulfillment/transportPolicy";
import {
  deriveFulfillmentLineStatus,
  moveFulfillmentQuantity,
  type FulfillmentQuantities,
} from "../model/fulfillment/reservationPolicy";
import type { LedgerTransactionDraft } from "../model/inventory/ledgerTransaction";
import { decodeBucketKey } from "../model/inventory/stockIdentity";
import type { ShipmentRow, TripRow } from "./tripPlanning";

export const DELIVERY_OPERATIONS = Object.freeze({
  capturePod: "fulfillment.delivery.pod.capture",
  reviewPod: "fulfillment.delivery.pod.review",
  fail: "fulfillment.delivery.fail",
  returnToWarehouse: "fulfillment.delivery.returnToWarehouse",
  returnDocument: "fulfillment.delivery.document.return",
});

const MAX_PACKAGES = 50;
const MAX_SHIPMENTS = 20;
const MAX_LINES = 50;

interface TransportFileRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly shipmentId: string;
  readonly warehouseId: string;
  readonly kind: string;
  readonly storageState: string;
}

interface PodRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly shipmentId: string;
  readonly tripId: string;
  readonly warehouseId: string;
  readonly status: "CAPTURED" | "ACCEPTED" | "REJECTED";
  readonly capturedByUserId: string;
}

interface ShipmentPackageRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly shipmentId: string;
  readonly fulfillmentPackageId: string;
  readonly status: "EXPECTED" | "LOADED" | "DELIVERED" | "RETURNED";
}

interface FulfillmentPackageRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly pickTaskId: string;
  readonly packedBaseMinorUnits: number;
}

interface PickTaskRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly fulfillmentLineId: string;
}

interface PickTaskLineRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly pickTaskId: string;
  readonly bucketKey: string;
  readonly baseUom: string;
  readonly pickedBaseMinorUnits: number;
}

interface InventoryTransactionRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly requestId: string;
  readonly operation: string;
}

interface FulfillmentLineRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly fulfillmentOrderId: string;
  readonly orderedBaseMinorUnits: number;
  readonly status: string;
  readonly quantities: FulfillmentQuantities;
}

interface TripShipmentRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly tripId: string;
  readonly shipmentId: string;
}

interface DocumentReturnRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly shipmentId: string;
  readonly warehouseId: string;
  readonly status: "EXPECTED" | "RETURNED" | "WAIVED";
  readonly documentType: string;
}

async function shipmentPackages(
  ctx: { readonly tenantDb: TenantPolicyContext["tenantDb"] },
  shipmentId: string,
) {
  const page = await ctx.tenantDb
    .byIndex<ShipmentPackageRow>(
      "shipmentPackages",
      "by_orgId_shipmentId_fulfillmentPackageId",
      [{ field: "shipmentId", value: shipmentId }],
    )
    .page({ limit: MAX_PACKAGES });
  return page.isDone ? page.page : null;
}

export const captureProofOfDelivery = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    shipmentId: v.id("shipments"),
    transportFileId: v.id("transportFiles"),
    recipientName: v.string(),
    recipientNote: v.optional(v.string()),
    capturedAt: v.number(),
    latitudeE6: v.optional(v.number()),
    longitudeE6: v.optional(v.number()),
  },
  returns: writeOutcomeValidator,
  permissionCode: "fulfillment.pod.capture",
  target: { table: "shipments", id: ({ shipmentId }) => shipmentId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const shipment = await ctx.tenantDb.get<ShipmentRow>(
      "shipments",
      args.shipmentId,
    );
    const file = await ctx.tenantDb.get<TransportFileRow>(
      "transportFiles",
      args.transportFileId,
    );
    if (
      shipment === null ||
      file === null ||
      shipment.warehouseId !== args.warehouseId ||
      file.shipmentId !== args.shipmentId ||
      file.kind !== "POD" ||
      file.storageState !== "AVAILABLE" ||
      shipment.tripId === undefined
    ) {
      return refusal({ code: "NOT_FOUND", table: "shipments" });
    }
    const recipientName = args.recipientName.trim();
    if (recipientName.length === 0 || recipientName.length > 200) {
      return refusal({
        code: "FIELD_INVALID",
        field: "recipientName",
        reason: "LENGTH",
      });
    }
    if (!Number.isSafeInteger(args.capturedAt) || args.capturedAt <= 0) {
      return refusal({
        code: "FIELD_INVALID",
        field: "capturedAt",
        reason: "TIMESTAMP",
      });
    }
    const transition = completeDelivery({
      shipmentStatus: shipment.status as never,
      accepted: true,
      podEvidenceId: file._id,
    });
    if (!transition.ok) return refusal(transition.error);
    const fingerprint = {
      operation: DELIVERY_OPERATIONS.capturePod,
      requestId: args.requestId,
      warehouseId: args.warehouseId,
      shipmentId: args.shipmentId,
      transportFileId: args.transportFileId,
      recipientName,
      recipientNote: args.recipientNote?.trim(),
      capturedAt: args.capturedAt,
      latitudeE6: args.latitudeE6,
      longitudeE6: args.longitudeE6,
    };
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "proofOfDeliveries",
      operation: DELIVERY_OPERATIONS.capturePod,
      requestId: args.requestId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);
    const milestones = await ctx.tenantDb
      .byIndex<{ readonly _id: string; readonly orgId: TenantOrgId }>(
        "deliveryMilestones",
        "by_orgId_shipmentId_sequence",
        [{ field: "shipmentId", value: args.shipmentId }],
      )
      .page({ limit: 20 });
    if (!milestones.isDone) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "milestones",
        reason: "MILESTONE_LIMIT_EXCEEDED",
      });
    }
    const outcome = await createMasterDataRow({
      ...writeContextOf(ctx, {
        table: "proofOfDeliveries",
        operation: DELIVERY_OPERATIONS.capturePod,
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
        shipmentId: args.shipmentId,
        tripId: shipment.tripId,
        warehouseId: args.warehouseId,
        status: "CAPTURED",
        recipientName,
        ...(args.recipientNote === undefined ||
        args.recipientNote.trim().length === 0
          ? {}
          : { recipientNote: args.recipientNote.trim() }),
        transportFileId: args.transportFileId,
        capturedByUserId: ctx.tenant.actor._id,
        capturedAt: args.capturedAt,
      },
    });
    if (!outcome.ok) return refusal(outcome.error);
    const now = Date.now();
    const milestone = {
      tripId: shipment.tripId,
      shipmentId: args.shipmentId,
      sequence: milestones.page.length + 1,
      kind: "ARRIVED",
      ...(args.latitudeE6 === undefined ? {} : { latitudeE6: args.latitudeE6 }),
      ...(args.longitudeE6 === undefined
        ? {}
        : { longitudeE6: args.longitudeE6 }),
      actorUserId: ctx.tenant.actor._id,
      capturedAt: args.capturedAt,
      receivedAt: now,
    };
    const milestoneId = await ctx.tenantDb.insert(
      "deliveryMilestones",
      milestone,
    );
    await appendDomainAudit(
      writeContextOf(ctx, {
        table: "proofOfDeliveries",
        operation: DELIVERY_OPERATIONS.capturePod,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      {
        entityTable: "deliveryMilestones",
        entityId: milestoneId,
        changes: insertedFields(milestone),
      },
    );
    return written(outcome.value);
  },
});

async function podReviewPolicy(
  ctx: TenantPolicyContext,
  args: { readonly proofOfDeliveryId: string },
) {
  const pod = await ctx.tenantDb.get<PodRow>(
    "proofOfDeliveries",
    args.proofOfDeliveryId,
  );
  return {
    thresholdExceeded: false,
    approvalSatisfied: pod?.status === "CAPTURED",
    ...(pod === null ? {} : { makerUserId: pod.capturedByUserId }),
  };
}

async function prepareAcceptedDelivery(
  ctx: { readonly tenantDb: TenantPolicyContext["tenantDb"] },
  shipment: ShipmentRow,
  pod: PodRow,
) {
  const manifest = await shipmentPackages(ctx, shipment._id);
  if (
    manifest === null ||
    manifest.length === 0 ||
    manifest.some((entry) => entry.status !== "LOADED")
  ) {
    return {
      ok: false as const,
      error: { code: "STORED_ROW_INVALID", field: "manifest" },
    };
  }

  const lineUpdates = new Map<
    string,
    {
      readonly line: FulfillmentLineRow;
      readonly quantities: FulfillmentQuantities;
      readonly status: string;
    }
  >();
  for (const entry of manifest) {
    const packageRow = await ctx.tenantDb.get<FulfillmentPackageRow>(
      "fulfillmentPackages",
      entry.fulfillmentPackageId,
    );
    const task =
      packageRow === null
        ? null
        : await ctx.tenantDb.get<PickTaskRow>(
            "pickTasks",
            packageRow.pickTaskId,
          );
    const line =
      task === null
        ? null
        : await ctx.tenantDb.get<FulfillmentLineRow>(
            "fulfillmentLines",
            task.fulfillmentLineId,
          );
    if (packageRow === null || line === null) {
      return {
        ok: false as const,
        error: { code: "STORED_ROW_INVALID", field: "package" },
      };
    }
    const current = lineUpdates.get(line._id)?.quantities ?? line.quantities;
    const moved = moveFulfillmentQuantity(current, {
      from: "LOADED",
      to: "DELIVERED",
      baseMinorUnits: packageRow.packedBaseMinorUnits,
    });
    if (!moved.ok) return moved;
    const status = deriveFulfillmentLineStatus(
      line.orderedBaseMinorUnits,
      moved.value,
    );
    if (!status.ok) return status;
    lineUpdates.set(line._id, {
      line,
      quantities: moved.value,
      status: status.value,
    });
  }

  const lines = await ctx.tenantDb
    .byIndex<FulfillmentLineRow>(
      "fulfillmentLines",
      "by_orgId_fulfillmentOrderId_customerOrderLineId",
      [{ field: "fulfillmentOrderId", value: shipment.fulfillmentOrderId }],
    )
    .page({ limit: MAX_LINES });
  if (!lines.isDone || lines.page.length === 0) {
    return {
      ok: false as const,
      error: {
        code: "PRECONDITION_FAILED",
        field: "fulfillmentLines",
        reason: "LINE_LIMIT_EXCEEDED",
      },
    };
  }
  const allComplete = lines.page.every((line) => {
    const quantities = lineUpdates.get(line._id)?.quantities ?? line.quantities;
    return (
      quantities.DELIVERED + quantities.CANCELLED === line.orderedBaseMinorUnits
    );
  });

  const tripAssignments = await ctx.tenantDb
    .byIndex<TripShipmentRow>("tripShipments", "by_orgId_tripId_sequence", [
      { field: "tripId", value: pod.tripId },
    ])
    .page({ limit: MAX_SHIPMENTS });
  if (
    !tripAssignments.isDone ||
    !tripAssignments.page.some(
      (assignment) => assignment.shipmentId === shipment._id,
    )
  ) {
    return {
      ok: false as const,
      error: { code: "STORED_ROW_INVALID", field: "tripManifest" },
    };
  }
  let tripComplete = true;
  for (const assignment of tripAssignments.page) {
    if (assignment.shipmentId === shipment._id) continue;
    const sibling = await ctx.tenantDb.get<ShipmentRow>(
      "shipments",
      assignment.shipmentId,
    );
    if (sibling?.status !== "DELIVERED") tripComplete = false;
  }
  const trip = await ctx.tenantDb.get<TripRow>("trips", pod.tripId);
  if (trip === null) {
    return {
      ok: false as const,
      error: { code: "STORED_ROW_INVALID", field: "trip" },
    };
  }
  const milestones = await ctx.tenantDb
    .byIndex<{ readonly _id: string; readonly orgId: TenantOrgId }>(
      "deliveryMilestones",
      "by_orgId_shipmentId_sequence",
      [{ field: "shipmentId", value: shipment._id }],
    )
    .page({ limit: 20 });
  if (!milestones.isDone) {
    return {
      ok: false as const,
      error: { code: "STORED_ROW_INVALID", field: "milestones" },
    };
  }
  return {
    ok: true as const,
    value: {
      manifest,
      lineUpdates: [...lineUpdates.values()],
      allComplete,
      trip,
      tripComplete,
      milestoneSequence: milestones.page.length + 1,
    },
  };
}

export const reviewProofOfDelivery = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    proofOfDeliveryId: v.id("proofOfDeliveries"),
    accept: v.boolean(),
    rejectionReason: v.optional(v.string()),
  },
  returns: writeOutcomeValidator,
  permissionCode: "fulfillment.pod.review",
  target: {
    table: "proofOfDeliveries",
    id: ({ proofOfDeliveryId }) => proofOfDeliveryId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  policy: podReviewPolicy,
  handler: async (ctx, args) => {
    const pod = await ctx.tenantDb.get<PodRow>(
      "proofOfDeliveries",
      args.proofOfDeliveryId,
    );
    if (pod === null || pod.warehouseId !== args.warehouseId) {
      return refusal({ code: "NOT_FOUND", table: "proofOfDeliveries" });
    }
    if (
      !args.accept &&
      (args.rejectionReason === undefined ||
        args.rejectionReason.trim().length === 0)
    ) {
      return refusal({
        code: "FIELD_REQUIRED",
        field: "rejectionReason",
      });
    }
    const fingerprint = {
      operation: DELIVERY_OPERATIONS.reviewPod,
      requestId: args.requestId,
      warehouseId: args.warehouseId,
      proofOfDeliveryId: args.proofOfDeliveryId,
      accept: args.accept,
      rejectionReason: args.rejectionReason?.trim(),
    };
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "proofOfDeliveries",
      operation: DELIVERY_OPERATIONS.reviewPod,
      requestId: args.requestId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);
    if (pod.status !== "CAPTURED") {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "status",
        reason: "POD_NOT_CAPTURED",
      });
    }
    const shipment = await ctx.tenantDb.get<ShipmentRow>(
      "shipments",
      pod.shipmentId,
    );
    if (shipment === null || shipment.status !== "IN_TRANSIT") {
      return refusal({ code: "STORED_ROW_INVALID", field: "shipment" });
    }
    const accepted = args.accept
      ? await prepareAcceptedDelivery(ctx, shipment, pod)
      : null;
    if (accepted !== null && !accepted.ok) return refusal(accepted.error);
    const now = Date.now();
    const outcome = await updateMasterDataRow({
      ...writeContextOf(ctx, {
        table: "proofOfDeliveries",
        operation: DELIVERY_OPERATIONS.reviewPod,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      documentId: pod._id,
      fingerprint,
      uniqueness: [],
      patch: {
        status: args.accept ? "ACCEPTED" : "REJECTED",
        reviewedByUserId: ctx.tenant.actor._id,
        reviewedAt: now,
        ...(!args.accept && args.rejectionReason !== undefined
          ? { rejectionReason: args.rejectionReason.trim() }
          : {}),
      },
    });
    if (!outcome.ok) return refusal(outcome.error);
    if (!args.accept) return written(outcome.value);
    if (accepted === null || !accepted.ok) {
      throw new Error("accepted delivery preparation missing after validation");
    }
    const prepared = accepted.value;
    for (const update of prepared.lineUpdates) {
      await ctx.tenantDb.patch("fulfillmentLines", update.line._id, {
        quantities: { ...update.quantities },
        status: update.status,
      });
    }
    for (const entry of prepared.manifest) {
      await ctx.tenantDb.patch("shipmentPackages", entry._id, {
        status: "DELIVERED",
        deliveredAt: now,
      });
    }
    await ctx.tenantDb.patch("shipments", shipment._id, {
      status: "DELIVERED",
      deliveredAt: now,
    });

    await ctx.tenantDb.patch("fulfillmentOrders", shipment.fulfillmentOrderId, {
      status: prepared.allComplete ? "COMPLETE" : "PARTIALLY_COMPLETE",
      ...(prepared.allComplete ? { completedAt: now } : {}),
    });

    if (prepared.tripComplete) {
      await ctx.tenantDb.patch("trips", prepared.trip._id, {
        status: "COMPLETE",
        completedAt: now,
      });
    }
    const milestone = {
      tripId: pod.tripId,
      shipmentId: shipment._id,
      sequence: prepared.milestoneSequence,
      kind: "DELIVERED",
      actorUserId: ctx.tenant.actor._id,
      capturedAt: now,
      receivedAt: now,
    };
    const milestoneId = await ctx.tenantDb.insert(
      "deliveryMilestones",
      milestone,
    );
    await appendDomainAudit(
      writeContextOf(ctx, {
        table: "proofOfDeliveries",
        operation: DELIVERY_OPERATIONS.reviewPod,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      {
        entityTable: "deliveryMilestones",
        entityId: milestoneId,
        changes: insertedFields(milestone),
      },
    );
    return written(outcome.value);
  },
});

export const recordFailedDelivery = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    shipmentId: v.id("shipments"),
    reason: v.string(),
    capturedAt: v.number(),
  },
  returns: writeOutcomeValidator,
  permissionCode: "fulfillment.transport.deliver",
  target: { table: "shipments", id: ({ shipmentId }) => shipmentId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const shipment = await ctx.tenantDb.get<ShipmentRow>(
      "shipments",
      args.shipmentId,
    );
    if (
      shipment === null ||
      shipment.warehouseId !== args.warehouseId ||
      shipment.tripId === undefined
    )
      return refusal({ code: "NOT_FOUND", table: "shipments" });
    if (!Number.isSafeInteger(args.capturedAt) || args.capturedAt <= 0) {
      return refusal({
        code: "FIELD_INVALID",
        field: "capturedAt",
        reason: "TIMESTAMP",
      });
    }
    const transition = completeDelivery({
      shipmentStatus: shipment.status as never,
      accepted: false,
      failureReason: args.reason,
    });
    if (!transition.ok) return refusal(transition.error);
    const fingerprint = {
      operation: DELIVERY_OPERATIONS.fail,
      requestId: args.requestId,
      warehouseId: args.warehouseId,
      shipmentId: args.shipmentId,
      reason: args.reason.trim(),
      capturedAt: args.capturedAt,
    };
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "shipments",
      operation: DELIVERY_OPERATIONS.fail,
      requestId: args.requestId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);
    const milestones = await ctx.tenantDb
      .byIndex<{ readonly _id: string; readonly orgId: TenantOrgId }>(
        "deliveryMilestones",
        "by_orgId_shipmentId_sequence",
        [{ field: "shipmentId", value: shipment._id }],
      )
      .page({ limit: 20 });
    if (!milestones.isDone)
      return refusal({ code: "STORED_ROW_INVALID", field: "milestones" });
    const outcome = await updateMasterDataRow({
      ...writeContextOf(ctx, {
        table: "shipments",
        operation: DELIVERY_OPERATIONS.fail,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      documentId: shipment._id,
      fingerprint,
      uniqueness: [],
      patch: {
        status: transition.value,
        failedAt: Date.now(),
        failureReason: args.reason.trim(),
      },
    });
    if (!outcome.ok) return refusal(outcome.error);
    const milestone = {
      tripId: shipment.tripId,
      shipmentId: shipment._id,
      sequence: milestones.page.length + 1,
      kind: "FAILED",
      note: args.reason.trim(),
      actorUserId: ctx.tenant.actor._id,
      capturedAt: args.capturedAt,
      receivedAt: Date.now(),
    };
    const id = await ctx.tenantDb.insert("deliveryMilestones", milestone);
    await appendDomainAudit(
      writeContextOf(ctx, {
        table: "shipments",
        operation: DELIVERY_OPERATIONS.fail,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      {
        entityTable: "deliveryMilestones",
        entityId: id,
        changes: insertedFields(milestone),
      },
    );
    return written(outcome.value);
  },
});

/** Receive every failed-delivery package back into QC hold at one controlled location. */
export const returnFailedShipmentToWarehouse = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    shipmentId: v.id("shipments"),
    returnLocationId: v.id("locations"),
    reason: v.string(),
  },
  returns: writeOutcomeValidator,
  permissionCode: "fulfillment.transport.deliver",
  target: { table: "shipments", id: ({ shipmentId }) => shipmentId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const shipment = await ctx.tenantDb.get<ShipmentRow>(
      "shipments",
      args.shipmentId,
    );
    if (
      shipment === null ||
      shipment.warehouseId !== args.warehouseId ||
      shipment.tripId === undefined
    ) {
      return refusal({ code: "NOT_FOUND", table: "shipments" });
    }
    const reason = args.reason.trim().normalize("NFC");
    if (reason.length === 0 || reason.length > 500) {
      return refusal({ code: "FIELD_INVALID", field: "reason" });
    }
    if (shipment.status === "RETURNED") {
      const transaction =
        shipment.returnTransactionId === undefined
          ? null
          : await ctx.tenantDb.get<InventoryTransactionRow>(
              "inventoryTransactions",
              shipment.returnTransactionId,
            );
      if (
        transaction !== null &&
        transaction.requestId === args.requestId &&
        transaction.operation === DELIVERY_OPERATIONS.returnToWarehouse &&
        shipment.returnLocationId === args.returnLocationId &&
        shipment.returnReason === reason
      ) {
        return written({ documentId: shipment._id, replayed: true });
      }
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "status",
        reason: "SHIPMENT_ALREADY_RETURNED",
      });
    }
    if (shipment.status !== "DELIVERY_FAILED") {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "status",
        reason: "SHIPMENT_NOT_FAILED",
      });
    }
    const location = await ctx.tenantDb.get<{
      readonly _id: string;
      readonly orgId: TenantOrgId;
      readonly warehouseId: string;
      readonly locationType: string;
      readonly status: string;
    }>("locations", args.returnLocationId);
    if (
      location === null ||
      location.warehouseId !== args.warehouseId ||
      !["DOCK", "QUARANTINE"].includes(location.locationType) ||
      location.status !== "ACTIVE"
    ) {
      return refusal({
        code: "REFERENCE_NOT_FOUND",
        field: "returnLocationId",
      });
    }
    const manifest = await shipmentPackages(ctx, shipment._id);
    if (
      manifest === null ||
      manifest.length === 0 ||
      manifest.some((entry) => entry.status !== "LOADED")
    ) {
      return refusal({ code: "STORED_ROW_INVALID", field: "manifest" });
    }

    const ledgerLines: LedgerTransactionDraft["lines"][number][] = [];
    const lineUpdates = new Map<
      string,
      {
        readonly line: FulfillmentLineRow;
        readonly quantities: FulfillmentQuantities;
        readonly status: string;
      }
    >();
    for (const entry of manifest) {
      const packageRow = await ctx.tenantDb.get<FulfillmentPackageRow>(
        "fulfillmentPackages",
        entry.fulfillmentPackageId,
      );
      const task =
        packageRow === null
          ? null
          : await ctx.tenantDb.get<PickTaskRow>(
              "pickTasks",
              packageRow.pickTaskId,
            );
      const line =
        task === null
          ? null
          : await ctx.tenantDb.get<FulfillmentLineRow>(
              "fulfillmentLines",
              task.fulfillmentLineId,
            );
      if (packageRow === null || task === null || line === null) {
        return refusal({ code: "STORED_ROW_INVALID", field: "package" });
      }
      const taskLinePage = await ctx.tenantDb
        .byIndex<PickTaskLineRow>(
          "pickTaskLines",
          "by_orgId_pickTaskId_lineNumber",
          [{ field: "pickTaskId", value: task._id }],
        )
        .page({ limit: 50 });
      if (!taskLinePage.isDone || taskLinePage.page.length === 0) {
        return refusal({ code: "STORED_ROW_INVALID", field: "pickTaskLines" });
      }
      for (const taskLine of taskLinePage.page) {
        if (taskLine.pickedBaseMinorUnits === 0) continue;
        const decoded = decodeBucketKey(taskLine.bucketKey);
        if (!decoded.ok || decoded.value.location.kind !== "PHYSICAL") {
          return refusal({ code: "STORED_ROW_INVALID", field: "bucketKey" });
        }
        ledgerLines.push(
          {
            bucket: {
              ...decoded.value,
              location: {
                kind: "VIRTUAL",
                boundary: "CUSTOMER_RETURN",
              },
            },
            quantity: {
              uom: taskLine.baseUom,
              minorUnits: -taskLine.pickedBaseMinorUnits,
            },
          },
          {
            bucket: {
              ...decoded.value,
              stockStatus: "QC_HOLD",
              location: {
                kind: "PHYSICAL",
                locationId: args.returnLocationId,
              },
            },
            quantity: {
              uom: taskLine.baseUom,
              minorUnits: taskLine.pickedBaseMinorUnits,
            },
          },
        );
      }
      const current = lineUpdates.get(line._id)?.quantities ?? line.quantities;
      const moved = moveFulfillmentQuantity(current, {
        from: "LOADED",
        to: "RETURNED",
        baseMinorUnits: packageRow.packedBaseMinorUnits,
      });
      if (!moved.ok) return refusal(moved.error);
      const status = deriveFulfillmentLineStatus(
        line.orderedBaseMinorUnits,
        moved.value,
      );
      if (!status.ok) return refusal(status.error);
      lineUpdates.set(line._id, {
        line,
        quantities: moved.value,
        status: status.value,
      });
    }
    if (ledgerLines.length === 0 || ledgerLines.length > 100) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "returnLines",
        reason: "RETURN_LINE_LIMIT_EXCEEDED",
      });
    }
    const milestonePage = await ctx.tenantDb
      .byIndex<{ readonly _id: string; readonly orgId: TenantOrgId }>(
        "deliveryMilestones",
        "by_orgId_shipmentId_sequence",
        [{ field: "shipmentId", value: shipment._id }],
      )
      .page({ limit: 20 });
    if (!milestonePage.isDone) {
      return refusal({ code: "STORED_ROW_INVALID", field: "milestones" });
    }
    const tripAssignments = await ctx.tenantDb
      .byIndex<TripShipmentRow>("tripShipments", "by_orgId_tripId_sequence", [
        { field: "tripId", value: shipment.tripId },
      ])
      .page({ limit: MAX_SHIPMENTS });
    if (!tripAssignments.isDone) {
      return refusal({ code: "STORED_ROW_INVALID", field: "tripManifest" });
    }
    let tripComplete = true;
    for (const assignment of tripAssignments.page) {
      if (assignment.shipmentId === shipment._id) continue;
      const sibling = await ctx.tenantDb.get<ShipmentRow>(
        "shipments",
        assignment.shipmentId,
      );
      if (sibling?.status !== "DELIVERED" && sibling?.status !== "RETURNED") {
        tripComplete = false;
      }
    }
    const trip = await ctx.tenantDb.get<TripRow>("trips", shipment.tripId);
    if (trip === null) {
      return refusal({ code: "STORED_ROW_INVALID", field: "trip" });
    }

    const now = Date.now();
    const draft: LedgerTransactionDraft = {
      orgId: ctx.tenant.organization._id,
      warehouseId: args.warehouseId,
      type: "RECEIPT",
      operation: DELIVERY_OPERATIONS.returnToWarehouse,
      requestId: args.requestId,
      actorUserId: ctx.tenant.actor._id,
      occurredAt: now,
      source: { type: "DELIVERY_RETURN", id: shipment._id },
      lines: ledgerLines,
    };
    const posted = await postLedgerTransaction({
      tenantDb: ctx.tenantDb,
      tenant: ctx.tenant,
      permissionCode: ctx.permission.code,
      now,
      draft,
    });
    if (!posted.ok) return refusal(toPublicLedgerError(posted.error));
    await ctx.tenantDb.patch("shipments", shipment._id, {
      status: "RETURNED",
      returnedAt: now,
      returnLocationId: args.returnLocationId,
      returnTransactionId: posted.value.result.transactionId,
      returnReason: reason,
    });
    const context = writeContextOf(ctx, {
      table: "shipments",
      operation: DELIVERY_OPERATIONS.returnToWarehouse,
      requestId: args.requestId,
      warehouseId: args.warehouseId,
    });
    await appendDomainAudit(context, {
      entityTable: "shipments",
      entityId: shipment._id,
      changes: [
        { field: "status", from: shipment.status, to: "RETURNED" },
        { field: "returnLocationId", to: args.returnLocationId },
        { field: "returnReason", to: reason },
      ],
    });
    for (const update of lineUpdates.values()) {
      await ctx.tenantDb.patch("fulfillmentLines", update.line._id, {
        quantities: { ...update.quantities },
        status: update.status,
      });
    }
    for (const entry of manifest) {
      await ctx.tenantDb.patch("shipmentPackages", entry._id, {
        status: "RETURNED",
        returnedAt: now,
      });
    }
    if (tripComplete) {
      await ctx.tenantDb.patch("trips", trip._id, {
        status: "COMPLETE",
        completedAt: now,
      });
    }
    const milestone = {
      tripId: shipment.tripId,
      shipmentId: shipment._id,
      sequence: milestonePage.page.length + 1,
      kind: "RETURNED_TO_WAREHOUSE",
      note: reason,
      actorUserId: ctx.tenant.actor._id,
      capturedAt: now,
      receivedAt: now,
    };
    const milestoneId = await ctx.tenantDb.insert(
      "deliveryMilestones",
      milestone,
    );
    await appendDomainAudit(context, {
      entityTable: "deliveryMilestones",
      entityId: milestoneId,
      changes: insertedFields(milestone),
    });
    return written({
      documentId: shipment._id,
      replayed: posted.value.replayed,
    });
  },
});

export const recordDocumentReturn = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    shipmentId: v.id("shipments"),
    documentType: v.string(),
    transportFileId: v.optional(v.id("transportFiles")),
    note: v.optional(v.string()),
  },
  returns: writeOutcomeValidator,
  permissionCode: "fulfillment.documentReturn.manage",
  target: { table: "shipments", id: ({ shipmentId }) => shipmentId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const row = await ctx.tenantDb
      .byIndex<DocumentReturnRow>(
        "documentReturns",
        "by_orgId_shipmentId_documentType",
        [
          { field: "shipmentId", value: args.shipmentId },
          { field: "documentType", value: args.documentType.trim() },
        ],
      )
      .unique();
    if (row === null || row.warehouseId !== args.warehouseId)
      return refusal({ code: "NOT_FOUND", table: "documentReturns" });
    const fingerprint = {
      operation: DELIVERY_OPERATIONS.returnDocument,
      requestId: args.requestId,
      warehouseId: args.warehouseId,
      shipmentId: args.shipmentId,
      documentType: args.documentType.trim(),
      transportFileId: args.transportFileId,
      note: args.note?.trim(),
    };
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "documentReturns",
      operation: DELIVERY_OPERATIONS.returnDocument,
      requestId: args.requestId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);
    if (row.status !== "EXPECTED")
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "status",
        reason: "DOCUMENT_ALREADY_RESOLVED",
      });
    const outcome = await updateMasterDataRow({
      ...writeContextOf(ctx, {
        table: "documentReturns",
        operation: DELIVERY_OPERATIONS.returnDocument,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      documentId: row._id,
      fingerprint,
      uniqueness: [],
      patch: {
        status: "RETURNED",
        ...(args.transportFileId === undefined
          ? {}
          : { transportFileId: args.transportFileId }),
        receivedByUserId: ctx.tenant.actor._id,
        receivedAt: Date.now(),
        ...(args.note === undefined ? {} : { note: args.note.trim() }),
      },
    });
    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});

export const listCapturedProofsOfDelivery = queryWithOrg({
  args: { warehouseId: v.id("warehouses"), ...listArgs },
  returns: pageOf(
    v.object({
      proofOfDeliveryId: v.id("proofOfDeliveries"),
      shipmentId: v.id("shipments"),
      tripId: v.id("trips"),
      recipientName: v.string(),
      transportFileId: v.id("transportFiles"),
      capturedByUserId: v.id("users"),
      capturedAt: v.number(),
    }),
  ),
  permissionCode: "fulfillment.pod.read",
  target: { table: "proofOfDeliveries" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const request = pageRequestOf(args);
    if (!request.ok) return pageRefusal(request.error.code);
    const page = await ctx.tenantDb
      .byIndex<
        PodRow & {
          readonly recipientName: string;
          readonly transportFileId: string;
          readonly capturedAt: number;
        }
      >("proofOfDeliveries", "by_orgId_warehouseId_status_capturedAt", [
        { field: "warehouseId", value: args.warehouseId },
        { field: "status", value: "CAPTURED" },
      ])
      .page(pageOptions(request.value));
    return pageResult(
      page.page.map((pod) => ({
        proofOfDeliveryId: pod._id as never,
        shipmentId: pod.shipmentId as never,
        tripId: pod.tripId as never,
        recipientName: pod.recipientName,
        transportFileId: pod.transportFileId as never,
        capturedByUserId: pod.capturedByUserId as never,
        capturedAt: pod.capturedAt,
      })),
      page,
    );
  },
});
