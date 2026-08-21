/** Private UploadThing-backed POD and delivery-document lifecycle. */
import { v } from "convex/values";

import {
  createMasterDataRow,
  replayTenantWriteIfPresent,
} from "../lib/masterDataStore";
import { mutationWithOrg } from "../lib/tenantFunctions";
import type { TenantOrgId } from "../lib/tenantDb";
import { transportFileKind } from "../lib/validators";
import {
  refusal,
  writeContextOf,
  writeErrorValidator,
  writeOutcomeValidator,
  written,
} from "../lib/writeEnvelope";

export const TRANSPORT_FILE_OPERATIONS = Object.freeze({
  authorizeUpload: "fulfillment.transportFile.authorizeUpload",
  attach: "fulfillment.transportFile.attach",
  requestAccess: "fulfillment.transportFile.access",
});

const UPLOAD_LIFETIME_MS = 15 * 60 * 1_000;
const ACCESS_LIFETIME_MS = 5 * 60 * 1_000;
const DIGEST = /^[0-9a-f]{64}$/;

interface ShipmentRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly warehouseId: string;
  readonly status: string;
}

interface UploadGrantRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly shipmentId: string;
  readonly warehouseId: string;
  readonly kind: "POD" | "GATE_EVIDENCE" | "DELIVERY_NOTE" | "DOCUMENT_RETURN";
  readonly authorizedByUserId: string;
  readonly expiresAt: number;
  readonly consumedUploadThingKey?: string;
  readonly consumedContentDigest?: string;
  readonly consumedContentType?: string;
  readonly consumedByteSize?: number;
  readonly consumedAt?: number;
  readonly attachedAt?: number;
}

interface TransportFileRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly shipmentId: string;
  readonly warehouseId: string;
  readonly fileName: string;
  readonly storageObjectId: string;
  readonly storageState: string;
}

export const authorizeTransportFileUpload = mutationWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    shipmentId: v.id("shipments"),
    kind: transportFileKind,
  },
  returns: v.union(
    v.object({
      uploadGrantId: v.id("transportFileUploadGrants"),
      expiresAt: v.number(),
    }),
    v.object({ written: v.literal(false), error: writeErrorValidator }),
  ),
  permissionCode: "fulfillment.pod.capture",
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
    if (
      args.kind === "POD" &&
      shipment.status !== "IN_TRANSIT" &&
      shipment.status !== "DELIVERY_FAILED"
    ) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "status",
        reason: "SHIPMENT_NOT_DELIVERING",
      });
    }
    const now = Date.now();
    const expiresAt = now + UPLOAD_LIFETIME_MS;
    const uploadGrantId = await ctx.tenantDb.insert(
      "transportFileUploadGrants",
      {
        shipmentId: args.shipmentId,
        warehouseId: args.warehouseId,
        kind: args.kind,
        authorizedByUserId: ctx.tenant.actor._id,
        authorizedClerkUserId: ctx.tenant.actor.clerkUserId,
        expiresAt,
        uploadStartedAt: now,
      },
    );
    return { uploadGrantId: uploadGrantId as never, expiresAt };
  },
});

export const attachTransportFile = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    shipmentId: v.id("shipments"),
    uploadGrantId: v.id("transportFileUploadGrants"),
    fileName: v.string(),
    kind: transportFileKind,
    contentType: v.string(),
    byteSize: v.number(),
    contentDigest: v.string(),
    uploadThingKey: v.string(),
  },
  returns: writeOutcomeValidator,
  permissionCode: "fulfillment.pod.capture",
  target: { table: "shipments", id: ({ shipmentId }) => shipmentId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const fileName = args.fileName.trim().normalize("NFC");
    if (
      fileName.length === 0 ||
      fileName.length > 200 ||
      !DIGEST.test(args.contentDigest) ||
      !Number.isSafeInteger(args.byteSize) ||
      args.byteSize <= 0
    ) {
      return refusal({ code: "FIELD_INVALID", field: "file" });
    }
    const fingerprint = {
      operation: TRANSPORT_FILE_OPERATIONS.attach,
      requestId: args.requestId,
      warehouseId: args.warehouseId,
      shipmentId: args.shipmentId,
      uploadGrantId: args.uploadGrantId,
      fileName,
      kind: args.kind,
      contentType: args.contentType,
      byteSize: args.byteSize,
      contentDigest: args.contentDigest,
      uploadThingKey: args.uploadThingKey,
    };
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "transportFiles",
      operation: TRANSPORT_FILE_OPERATIONS.attach,
      requestId: args.requestId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);
    const shipment = await ctx.tenantDb.get<ShipmentRow>(
      "shipments",
      args.shipmentId,
    );
    const grant = await ctx.tenantDb.get<UploadGrantRow>(
      "transportFileUploadGrants",
      args.uploadGrantId,
    );
    const now = Date.now();
    if (
      shipment === null ||
      shipment.warehouseId !== args.warehouseId ||
      grant === null ||
      grant.shipmentId !== args.shipmentId ||
      grant.warehouseId !== args.warehouseId ||
      grant.kind !== args.kind ||
      grant.authorizedByUserId !== ctx.tenant.actor._id ||
      grant.expiresAt < now ||
      grant.attachedAt !== undefined ||
      grant.consumedUploadThingKey !== args.uploadThingKey ||
      grant.consumedContentDigest !== args.contentDigest ||
      grant.consumedContentType !== args.contentType ||
      grant.consumedByteSize !== args.byteSize
    ) {
      return refusal({
        code: "UPLOAD_GRANT_UNAVAILABLE",
        field: "uploadGrantId",
      });
    }
    const outcome = await createMasterDataRow({
      ...writeContextOf(ctx, {
        table: "transportFiles",
        operation: TRANSPORT_FILE_OPERATIONS.attach,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      fingerprint,
      uniqueness: [
        {
          field: "storageObjectId",
          index: "by_orgId_storageObjectId",
          equality: [{ field: "storageObjectId", value: args.uploadThingKey }],
        },
      ],
      document: {
        shipmentId: args.shipmentId,
        warehouseId: args.warehouseId,
        kind: args.kind,
        fileName,
        mimeType: args.contentType,
        sizeBytes: args.byteSize,
        digest: args.contentDigest,
        storageObjectId: args.uploadThingKey,
        storageState: "AVAILABLE",
        createdByUserId: ctx.tenant.actor._id,
        createdAt: grant.consumedAt ?? now,
      },
    });
    if (!outcome.ok) return refusal(outcome.error);
    await ctx.tenantDb.patch("transportFileUploadGrants", grant._id, {
      attachedAt: now,
    });
    return written(outcome.value);
  },
});

export const requestTransportFileAccess = mutationWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    transportFileId: v.id("transportFiles"),
  },
  returns: v.union(
    v.object({
      granted: v.literal(true),
      url: v.string(),
      expiresAt: v.number(),
    }),
    v.object({
      granted: v.literal(false),
      error: v.object({ code: v.string() }),
    }),
  ),
  permissionCode: "fulfillment.pod.read",
  target: {
    table: "transportFiles",
    id: ({ transportFileId }) => transportFileId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const file = await ctx.tenantDb.get<TransportFileRow>(
      "transportFiles",
      args.transportFileId,
    );
    if (
      file === null ||
      file.warehouseId !== args.warehouseId ||
      file.storageState !== "AVAILABLE"
    ) {
      return { granted: false as const, error: { code: "NOT_FOUND" } };
    }
    const expiresAt = Date.now() + ACCESS_LIFETIME_MS;
    const grantId = await ctx.tenantDb.insert("transportFileAccessGrants", {
      transportFileId: args.transportFileId,
      warehouseId: args.warehouseId,
      issuedToUserId: ctx.tenant.actor._id,
      expiresAt,
    });
    return {
      granted: true as const,
      url: `/api/private-files/uploadthing?scope=transport&warehouseId=${encodeURIComponent(args.warehouseId)}&grantId=${encodeURIComponent(grantId)}`,
      expiresAt,
    };
  },
});

export const redeemUploadThingTransportFileAccessGrant = mutationWithOrg({
  args: {
    grantId: v.id("transportFileAccessGrants"),
    warehouseId: v.id("warehouses"),
  },
  returns: v.union(
    v.null(),
    v.object({ providerKey: v.string(), fileName: v.string() }),
  ),
  permissionCode: "fulfillment.pod.read",
  target: {
    table: "transportFileAccessGrants",
    id: ({ grantId }) => grantId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const grant = await ctx.tenantDb.get<{
      readonly _id: string;
      readonly orgId: TenantOrgId;
      readonly warehouseId: string;
      readonly transportFileId: string;
      readonly issuedToUserId: string;
      readonly expiresAt: number;
      readonly consumedAt?: number;
    }>("transportFileAccessGrants", args.grantId);
    if (
      grant === null ||
      grant.warehouseId !== args.warehouseId ||
      grant.issuedToUserId !== ctx.tenant.actor._id ||
      grant.consumedAt !== undefined ||
      grant.expiresAt < Date.now()
    ) {
      return null;
    }
    const file = await ctx.tenantDb.get<TransportFileRow>(
      "transportFiles",
      grant.transportFileId,
    );
    if (
      file === null ||
      file.warehouseId !== args.warehouseId ||
      file.storageState !== "AVAILABLE"
    ) {
      return null;
    }
    await ctx.tenantDb.patch("transportFileAccessGrants", grant._id, {
      consumedAt: Date.now(),
    });
    return { providerKey: file.storageObjectId, fileName: file.fileName };
  },
});
