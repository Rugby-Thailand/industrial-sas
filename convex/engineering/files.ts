import { internalMutationGeneric } from "convex/server";
import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import {
  CODE_FIELD,
  appendDomainAudit,
  createMasterDataRow,
  insertedFields,
  normalizeDisplayName,
  normalizeField,
  replayTenantWriteIfPresent,
  type UniquenessCheck,
} from "../lib/masterDataStore";
import {
  listArgs,
  pageOf,
  pageOptions,
  pageRefusal,
  pageResult,
  pageRequestOf,
} from "../lib/listEnvelope";
import {
  mutationWithOrg,
  queryWithOrg,
  type TenantFunctionContext,
} from "../lib/tenantFunctions";
import type { TenantOrgId } from "../lib/tenantDb";
import {
  masterCardFileKind,
  masterCardFileStorageState,
} from "../lib/validators";
import {
  refusal,
  writeContextOf,
  writeOutcomeValidator,
  written,
} from "../lib/writeEnvelope";
import { checkFileAttachment } from "../model/orderToShip/masterCardRevision";
import { MAX_FILES_PER_REVISION } from "../model/orderToShip/masterCardFile";

export const ENGINEERING_FILE_OPERATIONS = Object.freeze({
  authorizeUpload: "engineering.file.authorizeUpload",
  attachFile: "engineering.file.attach",
  requestAccess: "engineering.file.access",
});

export const MAX_DECLARED_BYTE_SIZE = 512 * 1024 * 1024;
export const UPLOAD_GRANT_LIFETIME_MS = 15 * 60 * 1_000;
export const FILE_ACCESS_GRANT_LIFETIME_MS = 5 * 60 * 1_000;

const CONTENT_DIGEST_PATTERN = /^[0-9a-f]{64}$/;

export const storageDigestAsHex = (digest: string): string => {
  const normalized = digest.trim();
  if (CONTENT_DIGEST_PATTERN.test(normalized.toLowerCase())) {
    return normalized.toLowerCase();
  }
  try {
    const base64 = normalized.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    return [...atob(padded)]
      .map((character) => character.charCodeAt(0).toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return "";
  }
};

const CONTENT_TYPE_PATTERN =
  /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;

type RevisionDocument = Doc<"masterCardRevisions">;
type FileDocument = Doc<"masterCardFiles">;
type UploadGrantDocument = Doc<"masterCardUploadGrants">;

const EXPIRED_GRANT_CLEANUP_BATCH = 25;

export async function cleanupExpiredMasterCardUploadGrants(
  ctx: Pick<TenantFunctionContext, "tenantDb" | "privateFiles">,
  now = Date.now(),
): Promise<number> {
  const grants = await ctx.tenantDb
    .byIndex<UploadGrantDocument>(
      "masterCardUploadGrants",
      "by_orgId_expiresAt",
      [],
    )
    .take(EXPIRED_GRANT_CLEANUP_BATCH);
  let removed = 0;
  for (const grant of grants) {
    if (grant.expiresAt >= now) break;

    if (
      grant.attachedAt === undefined &&
      grant.consumedUploadThingKey !== undefined
    ) {
      continue;
    }
    if (
      grant.attachedAt === undefined &&
      grant.consumedStorageId !== undefined &&
      (await ctx.privateFiles.inspect(grant.consumedStorageId)) !== null
    ) {
      await ctx.privateFiles.delete(grant.consumedStorageId);
    }
    await ctx.tenantDb.delete("masterCardUploadGrants", grant._id);
    removed += 1;
  }
  return removed;
}

const fileUniqueness = (
  masterCardRevisionId: string,
  fileKey: string,
): readonly UniquenessCheck[] => [
  {
    field: "fileKey",
    index: "by_orgId_masterCardRevisionId_fileKey",
    equality: [
      { field: "masterCardRevisionId", value: masterCardRevisionId },
      { field: "fileKey", value: fileKey },
    ],
  },
];

export const authorizeMasterCardFileUpload = mutationWithOrg({
  args: {
    masterCardRevisionId: v.id("masterCardRevisions"),
    transport: v.optional(v.literal("UPLOADTHING")),
  },
  returns: v.union(
    v.object({
      uploadUrl: v.optional(v.string()),
      uploadGrantId: v.id("masterCardUploadGrants"),
      expiresAt: v.number(),
    }),
    writeOutcomeValidator,
  ),
  permissionCode: "engineering.file.attach",
  target: {
    table: "masterCardRevisions",
    id: ({ masterCardRevisionId }) => masterCardRevisionId,
  },
  handler: async (ctx, args) => {
    const revision = await ctx.tenantDb.get<RevisionDocument>(
      "masterCardRevisions",
      args.masterCardRevisionId,
    );
    if (revision === null) {
      return refusal({ code: "NOT_FOUND", table: "masterCardRevisions" });
    }
    const attachment = checkFileAttachment(revision);
    if (!attachment.ok) return refusal(attachment.error);
    await cleanupExpiredMasterCardUploadGrants(ctx);

    const context = writeContextOf(ctx, {
      table: "masterCardUploadGrants",
      operation: ENGINEERING_FILE_OPERATIONS.authorizeUpload,
      requestId: ctx.requestId,
    });
    const expiresAt = context.now + UPLOAD_GRANT_LIFETIME_MS;
    const document = {
      masterCardRevisionId: args.masterCardRevisionId,
      authorizedByUserId: context.actorUserId,
      expiresAt,
      ...(args.transport === "UPLOADTHING"
        ? {
            uploadStartedAt: context.now,
            authorizedClerkUserId: ctx.tenant.actor.clerkUserId,
          }
        : {}),
    };
    const uploadGrantId = await ctx.tenantDb.insert(
      "masterCardUploadGrants",
      document,
    );
    await appendDomainAudit(context, {
      entityTable: "masterCardUploadGrants",
      entityId: uploadGrantId,
      changes: insertedFields(document),
    });
    if (args.transport === "UPLOADTHING") {
      return { uploadGrantId: uploadGrantId as never, expiresAt };
    }
    const siteUrl = process.env.CONVEX_SITE_URL;
    if (siteUrl === undefined || siteUrl.trim().length === 0) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "uploadUrl",
        reason: "FILE_GATEWAY_NOT_CONFIGURED",
      });
    }
    const uploadUrl = `${siteUrl.replace(/\/$/, "")}/private-master-card-file-upload?grantId=${encodeURIComponent(uploadGrantId)}`;
    return { uploadUrl, uploadGrantId: uploadGrantId as never, expiresAt };
  },
});

/** Atomically claim a one-use upload capability before accepting any bytes. */
export const claimMasterCardUploadGrant = internalMutationGeneric({
  args: { grantId: v.id("masterCardUploadGrants") },
  returns: v.union(
    v.null(),
    v.object({ kind: v.literal("CLAIMED") }),
    v.object({ kind: v.literal("COMPLETE"), storageId: v.id("_storage") }),
  ),
  handler: async (ctx, args) => {
    const grant = await ctx.db.get(args.grantId);
    if (
      grant !== null &&
      grant.expiresAt >= Date.now() &&
      grant.consumedStorageId !== undefined &&
      grant.attachedAt === undefined
    ) {
      return { kind: "COMPLETE" as const, storageId: grant.consumedStorageId };
    }
    if (
      grant === null ||
      grant.uploadStartedAt !== undefined ||
      grant.consumedStorageId !== undefined ||
      grant.consumedUploadThingKey !== undefined ||
      grant.attachedAt !== undefined ||
      grant.expiresAt < Date.now()
    ) {
      return null;
    }
    await ctx.db.patch(grant._id, { uploadStartedAt: Date.now() });
    return { kind: "CLAIMED" as const };
  },
});

export const releaseMasterCardUploadGrant = internalMutationGeneric({
  args: { grantId: v.id("masterCardUploadGrants") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const grant = await ctx.db.get(args.grantId);
    if (
      grant === null ||
      grant.uploadStartedAt === undefined ||
      grant.consumedStorageId !== undefined ||
      grant.consumedUploadThingKey !== undefined ||
      grant.attachedAt !== undefined ||
      grant.expiresAt < Date.now()
    ) {
      return false;
    }
    await ctx.db.patch(grant._id, { uploadStartedAt: undefined });
    return true;
  },
});

export const completeMasterCardUploadGrant = internalMutationGeneric({
  args: {
    grantId: v.id("masterCardUploadGrants"),
    storageId: v.id("_storage"),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const grant = await ctx.db.get(args.grantId);
    if (
      grant === null ||
      grant.uploadStartedAt === undefined ||
      grant.consumedStorageId !== undefined ||
      grant.consumedUploadThingKey !== undefined ||
      grant.attachedAt !== undefined ||
      grant.expiresAt < Date.now()
    ) {
      return false;
    }
    await ctx.db.patch(grant._id, {
      consumedStorageId: args.storageId,
      consumedAt: Date.now(),
    });
    return true;
  },
});

export const completeUploadThingMasterCardUploadGrant = internalMutationGeneric(
  {
    args: {
      grantId: v.id("masterCardUploadGrants"),
      providerKey: v.string(),
      uploaderClerkUserId: v.string(),
      contentDigest: v.string(),
      contentType: v.string(),
      byteSize: v.number(),
    },
    returns: v.boolean(),
    handler: async (ctx, args) => {
      const grant = await ctx.db.get(args.grantId);
      if (
        grant === null ||
        grant.uploadStartedAt === undefined ||
        grant.authorizedClerkUserId !== args.uploaderClerkUserId ||
        grant.consumedStorageId !== undefined ||
        grant.consumedUploadThingKey !== undefined ||
        grant.attachedAt !== undefined ||
        grant.expiresAt < Date.now()
      ) {
        return false;
      }
      if (
        !CONTENT_DIGEST_PATTERN.test(args.contentDigest) ||
        !CONTENT_TYPE_PATTERN.test(args.contentType) ||
        !Number.isInteger(args.byteSize) ||
        args.byteSize <= 0 ||
        args.byteSize > MAX_DECLARED_BYTE_SIZE ||
        args.providerKey.length === 0 ||
        args.providerKey.length > 512
      ) {
        return false;
      }
      await ctx.db.patch(grant._id, {
        consumedUploadThingKey: args.providerKey,
        consumedContentDigest: args.contentDigest.toLowerCase(),
        consumedContentType: args.contentType,
        consumedByteSize: args.byteSize,
        consumedAt: Date.now(),
      });
      return true;
    },
  },
);

export const attachMasterCardFile = mutationWithOrg({
  args: {
    requestId: v.string(),
    masterCardRevisionId: v.id("masterCardRevisions"),
    fileKey: v.string(),
    fileName: v.string(),
    kind: masterCardFileKind,
    contentType: v.string(),
    byteSize: v.number(),
    contentDigest: v.string(),
    storageId: v.optional(v.id("_storage")),
    uploadThingKey: v.optional(v.string()),
    uploadGrantId: v.id("masterCardUploadGrants"),
  },
  returns: writeOutcomeValidator,
  permissionCode: "engineering.file.attach",
  target: {
    table: "masterCardRevisions",
    id: ({ masterCardRevisionId }) => masterCardRevisionId,
  },
  handler: async (ctx, args) => {
    const revision = await ctx.tenantDb.get<RevisionDocument>(
      "masterCardRevisions",
      args.masterCardRevisionId,
    );
    if (revision === null) {
      return refusal({ code: "NOT_FOUND", table: "masterCardRevisions" });
    }

    const fileKey = normalizeField("fileKey", args.fileKey, CODE_FIELD);
    if (!fileKey.ok) return refusal(fileKey.error);
    const fileName = normalizeDisplayName("fileName", args.fileName);
    if (!fileName.ok) return refusal(fileName.error);

    if (!CONTENT_TYPE_PATTERN.test(args.contentType)) {
      return refusal({
        code: "FIELD_INVALID",
        field: "contentType",
        reason: "NOT_A_MEDIA_TYPE",
      });
    }
    if (!CONTENT_DIGEST_PATTERN.test(args.contentDigest)) {
      return refusal({
        code: "FIELD_INVALID",
        field: "contentDigest",
        reason: "NOT_A_SHA256_HEX_DIGEST",
      });
    }
    if (
      !Number.isInteger(args.byteSize) ||
      args.byteSize <= 0 ||
      args.byteSize > MAX_DECLARED_BYTE_SIZE
    ) {
      return refusal({
        code: "FIELD_INVALID",
        field: "byteSize",
        reason:
          Number.isInteger(args.byteSize) && args.byteSize > 0
            ? "TOO_LARGE"
            : "NOT_A_POSITIVE_WHOLE_NUMBER",
      });
    }
    if (
      (args.storageId === undefined) ===
      (args.uploadThingKey === undefined)
    ) {
      return refusal({
        code: "FIELD_INVALID",
        field: "storageProvider",
        reason: "EXACTLY_ONE_STORAGE_REFERENCE_REQUIRED",
      });
    }

    const fingerprint = {
      operation: ENGINEERING_FILE_OPERATIONS.attachFile,
      requestId: args.requestId,
      masterCardRevisionId: args.masterCardRevisionId,
      fileKey: fileKey.value,
      fileName: fileName.value,
      kind: args.kind,
      contentType: args.contentType,
      byteSize: args.byteSize,
      contentDigest: args.contentDigest,
      ...(args.storageId === undefined ? {} : { storageId: args.storageId }),
      ...(args.uploadThingKey === undefined
        ? {}
        : { uploadThingKey: args.uploadThingKey }),
      uploadGrantId: args.uploadGrantId,
    };
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "masterCardFiles",
      operation: ENGINEERING_FILE_OPERATIONS.attachFile,
      requestId: args.requestId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);

    const attachment = checkFileAttachment(revision);
    if (!attachment.ok) return refusal(attachment.error);

    const grant = await ctx.tenantDb.get<UploadGrantDocument>(
      "masterCardUploadGrants",
      args.uploadGrantId,
    );
    const convexGrantMatches =
      args.storageId !== undefined &&
      grant?.consumedStorageId === args.storageId &&
      grant.consumedUploadThingKey === undefined;
    const uploadThingGrantMatches =
      args.uploadThingKey !== undefined &&
      grant?.consumedUploadThingKey === args.uploadThingKey &&
      grant.consumedStorageId === undefined;
    if (
      grant === null ||
      grant.masterCardRevisionId !== args.masterCardRevisionId ||
      (!convexGrantMatches && !uploadThingGrantMatches) ||
      grant.consumedAt === undefined ||
      grant.attachedAt !== undefined ||
      grant.expiresAt < Date.now()
    ) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "uploadGrantId",
        reason: "UPLOAD_GRANT_INVALID",
      });
    }

    const existingFiles = await ctx.tenantDb
      .byIndex<FileDocument>(
        "masterCardFiles",
        "by_orgId_masterCardRevisionId_fileKey",
        [{ field: "masterCardRevisionId", value: args.masterCardRevisionId }],
      )
      .take(MAX_FILES_PER_REVISION + 1);
    if (existingFiles.length >= MAX_FILES_PER_REVISION) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "masterCardRevisionId",
        reason: "FILE_LIMIT_REACHED",
      });
    }

    const metadata =
      args.storageId !== undefined
        ? await ctx.privateFiles.inspect(args.storageId)
        : grant.consumedUploadThingKey === args.uploadThingKey &&
            grant.consumedContentDigest !== undefined &&
            grant.consumedContentType !== undefined &&
            grant.consumedByteSize !== undefined
          ? {
              sha256: grant.consumedContentDigest,
              contentType: grant.consumedContentType,
              size: grant.consumedByteSize,
            }
          : null;
    if (metadata === null) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "storageProvider",
        reason: "FILE_NOT_RETRIEVABLE",
      });
    }
    if (
      storageDigestAsHex(metadata.sha256) !== args.contentDigest.toLowerCase()
    ) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "contentDigest",
        reason: "STORAGE_METADATA_MISMATCH",
      });
    }
    if (metadata.size !== args.byteSize) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "byteSize",
        reason: "STORAGE_METADATA_MISMATCH",
      });
    }
    if (
      (metadata.contentType ?? "application/octet-stream") !== args.contentType
    ) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "contentType",
        reason: "STORAGE_METADATA_MISMATCH",
      });
    }

    const context = writeContextOf(ctx, {
      table: "masterCardFiles",
      operation: ENGINEERING_FILE_OPERATIONS.attachFile,
      requestId: args.requestId,
    });
    const outcome = await createMasterDataRow({
      ...context,
      fingerprint,
      uniqueness: fileUniqueness(args.masterCardRevisionId, fileKey.value),
      document: {
        masterCardRevisionId: args.masterCardRevisionId,
        fileKey: fileKey.value,
        fileName: fileName.value,
        kind: args.kind,
        contentType: args.contentType,
        byteSize: args.byteSize,
        contentDigest: args.contentDigest,
        ...(args.storageId === undefined ? {} : { storageId: args.storageId }),
        ...(args.uploadThingKey === undefined
          ? {}
          : { uploadThingKey: args.uploadThingKey }),
        verifiedAt: context.now,
        storageState: "AVAILABLE",
        attachedByUserId: ctx.tenant.actor._id,
      },
    });
    if (!outcome.ok) return refusal(outcome.error);
    if (!outcome.value.replayed) {
      await ctx.tenantDb.patch("masterCardUploadGrants", grant._id, {
        attachedAt: context.now,
      });
      await appendDomainAudit(context, {
        entityTable: "masterCardUploadGrants",
        entityId: grant._id,
        changes: [{ field: "attachedAt", to: String(context.now) }],
      });
    }
    return written(outcome.value);
  },
});

const fileAccessValidator = v.union(
  v.object({
    granted: v.literal(true),
    url: v.string(),
    expiresAt: v.number(),
  }),
  v.object({
    granted: v.literal(false),
    error: v.object({
      code: v.string(),
      field: v.optional(v.string()),
      reason: v.optional(v.string()),
    }),
  }),
);

export const requestMasterCardFileAccess = mutationWithOrg({
  args: { masterCardFileId: v.id("masterCardFiles") },
  returns: fileAccessValidator,
  permissionCode: "engineering.file.read",
  target: {
    table: "masterCardFiles",
    id: ({ masterCardFileId }) => masterCardFileId,
  },
  handler: async (ctx, args) => {
    const file = await ctx.tenantDb.get<FileDocument>(
      "masterCardFiles",
      args.masterCardFileId,
    );
    if (file === null) {
      return {
        granted: false as const,
        error: { code: "NOT_FOUND", field: "masterCardFileId" },
      };
    }

    if (
      file.storageState !== "AVAILABLE" ||
      (file.storageId === undefined && file.uploadThingKey === undefined)
    ) {
      return {
        granted: false as const,
        error: { code: "FILE_NOT_AVAILABLE", field: "storageState" },
      };
    }
    const siteUrl = process.env.CONVEX_SITE_URL;
    if (file.storageId !== undefined) {
      const url = await ctx.privateFiles.createDownloadUrl(file.storageId);
      if (url === null) {
        return {
          granted: false as const,
          error: { code: "FILE_NOT_RETRIEVABLE", field: "storageId" },
        };
      }
    }
    if (
      file.storageId !== undefined &&
      (siteUrl === undefined || siteUrl.trim().length === 0)
    ) {
      return {
        granted: false as const,
        error: { code: "FILE_GATEWAY_NOT_CONFIGURED" },
      };
    }
    const context = writeContextOf(ctx, {
      table: "masterCardFileAccessGrants",
      operation: ENGINEERING_FILE_OPERATIONS.requestAccess,
      requestId: ctx.requestId,
    });
    const expiresAt = context.now + FILE_ACCESS_GRANT_LIFETIME_MS;
    const document = {
      masterCardFileId: args.masterCardFileId,
      issuedToUserId: context.actorUserId,
      expiresAt,
    };
    const grantId = await ctx.tenantDb.insert(
      "masterCardFileAccessGrants",
      document,
    );
    await appendDomainAudit(context, {
      entityTable: "masterCardFileAccessGrants",
      entityId: grantId,
      changes: insertedFields(document),
    });
    return {
      granted: true as const,
      url:
        file.uploadThingKey !== undefined
          ? `/api/private-files/uploadthing?grantId=${encodeURIComponent(grantId)}`
          : `${siteUrl!.replace(/\/$/, "")}/private-master-card-file?grantId=${encodeURIComponent(grantId)}`,
      expiresAt,
    };
  },
});

/** Internal, atomic one-use redemption called only by the HTTP file gateway. */
export const consumeMasterCardFileAccessGrant = internalMutationGeneric({
  args: { grantId: v.id("masterCardFileAccessGrants") },
  returns: v.union(
    v.null(),
    v.object({ storageId: v.id("_storage"), fileName: v.string() }),
  ),
  handler: async (ctx, args) => {
    const grant = await ctx.db.get(args.grantId);
    if (
      grant === null ||
      grant.consumedAt !== undefined ||
      grant.expiresAt < Date.now()
    ) {
      return null;
    }
    const file = await ctx.db.get(grant.masterCardFileId);
    if (
      file === null ||
      file.storageState !== "AVAILABLE" ||
      file.storageId === undefined
    ) {
      return null;
    }
    await ctx.db.patch(grant._id, { consumedAt: Date.now() });
    return { storageId: file.storageId, fileName: file.fileName };
  },
});

export const redeemUploadThingMasterCardFileAccessGrant = mutationWithOrg({
  args: { grantId: v.id("masterCardFileAccessGrants") },
  returns: v.union(
    v.null(),
    v.object({ providerKey: v.string(), fileName: v.string() }),
  ),
  permissionCode: "engineering.file.read",
  target: {
    table: "masterCardFileAccessGrants",
    id: ({ grantId }) => grantId,
  },
  handler: async (ctx, args) => {
    const grant = await ctx.tenantDb.get<{
      readonly _id: string;
      readonly orgId: TenantOrgId;
      readonly masterCardFileId: string;
      readonly issuedToUserId: string;
      readonly expiresAt: number;
      readonly consumedAt?: number;
    }>("masterCardFileAccessGrants", args.grantId);
    if (
      grant === null ||
      grant.issuedToUserId !== ctx.tenant.actor._id ||
      grant.consumedAt !== undefined ||
      grant.expiresAt < Date.now()
    ) {
      return null;
    }
    const file = await ctx.tenantDb.get<FileDocument>(
      "masterCardFiles",
      grant.masterCardFileId,
    );
    if (
      file === null ||
      file.storageState !== "AVAILABLE" ||
      file.uploadThingKey === undefined
    ) {
      return null;
    }
    await ctx.tenantDb.patch("masterCardFileAccessGrants", grant._id, {
      consumedAt: Date.now(),
    });
    return { providerKey: file.uploadThingKey, fileName: file.fileName };
  },
});

export const redeemUploadThingFactoryPacketFileAccessGrant = mutationWithOrg({
  args: {
    grantId: v.id("masterCardFileAccessGrants"),
    warehouseId: v.id("warehouses"),
  },
  returns: v.union(
    v.null(),
    v.object({ providerKey: v.string(), fileName: v.string() }),
  ),
  permissionCode: "production.packet.read",
  target: {
    table: "masterCardFileAccessGrants",
    id: ({ grantId }) => grantId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const grant = await ctx.tenantDb.get<{
      readonly _id: string;
      readonly orgId: TenantOrgId;
      readonly masterCardFileId: string;
      readonly warehouseId?: string;
      readonly issuedToUserId: string;
      readonly expiresAt: number;
      readonly consumedAt?: number;
    }>("masterCardFileAccessGrants", args.grantId);
    if (
      grant === null ||
      grant.warehouseId !== args.warehouseId ||
      grant.issuedToUserId !== ctx.tenant.actor._id ||
      grant.consumedAt !== undefined ||
      grant.expiresAt < Date.now()
    ) {
      return null;
    }
    const file = await ctx.tenantDb.get<FileDocument>(
      "masterCardFiles",
      grant.masterCardFileId,
    );
    if (
      file === null ||
      file.storageState !== "AVAILABLE" ||
      file.uploadThingKey === undefined
    ) {
      return null;
    }
    await ctx.tenantDb.patch("masterCardFileAccessGrants", grant._id, {
      consumedAt: Date.now(),
    });
    return { providerKey: file.uploadThingKey, fileName: file.fileName };
  },
});

const fileValidator = v.object({
  masterCardFileId: v.id("masterCardFiles"),
  masterCardRevisionId: v.id("masterCardRevisions"),
  fileKey: v.string(),
  fileName: v.string(),
  kind: masterCardFileKind,
  contentType: v.string(),
  byteSize: v.number(),
  contentDigest: v.string(),
  storageId: v.optional(v.id("_storage")),
  verifiedAt: v.optional(v.number()),
  storageState: masterCardFileStorageState,
  attachedByUserId: v.id("users"),
});

export const listMasterCardFiles = queryWithOrg({
  args: { masterCardRevisionId: v.id("masterCardRevisions"), ...listArgs },
  returns: pageOf(fileValidator),
  permissionCode: "engineering.file.read",
  target: {
    table: "masterCardRevisions",
    id: ({ masterCardRevisionId }) => masterCardRevisionId,
  },
  handler: async (ctx, args) => {
    const request = pageRequestOf(args);
    if (!request.ok) return pageRefusal(request.error.code);

    const revision = await ctx.tenantDb.get(
      "masterCardRevisions",
      args.masterCardRevisionId,
    );
    if (revision === null) return pageRefusal("REFERENCE_NOT_FOUND");

    const page = await ctx.tenantDb
      .byIndex<FileDocument>(
        "masterCardFiles",
        "by_orgId_masterCardRevisionId_fileKey",
        [
          {
            field: "masterCardRevisionId",
            value: args.masterCardRevisionId,
          },
        ],
      )
      .page(pageOptions(request.value));

    return pageResult(
      page.page.map((file) => ({
        masterCardFileId: file._id as never,
        masterCardRevisionId: file.masterCardRevisionId as never,
        fileKey: file.fileKey,
        fileName: file.fileName,
        kind: file.kind as never,
        contentType: file.contentType,
        byteSize: file.byteSize,
        contentDigest: file.contentDigest,
        ...(file.storageId === undefined
          ? {}
          : { storageId: file.storageId as never }),
        ...(file.verifiedAt === undefined
          ? {}
          : { verifiedAt: file.verifiedAt }),
        storageState: file.storageState as never,
        attachedByUserId: file.attachedByUserId as never,
      })),
      page,
    );
  },
});
