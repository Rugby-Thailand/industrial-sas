import { v } from "convex/values";

import {
  checkIdempotency,
  fingerprintArguments,
  sha256Hex,
  writeIdempotencyRecord,
} from "../lib/idempotency";
import { makeJobPageRequest } from "../model/inventory/jobPage";
import { pageResult } from "../lib/listEnvelope";
import type { TenantOrgId } from "../lib/tenantDb";
import { mutationWithOrg, queryWithOrg } from "../lib/tenantFunctions";
import { operatorTaskAttachmentKind } from "../lib/validators";
import { refusal, writeErrorValidator } from "../lib/writeEnvelope";

export const TASK_FILE_OPERATIONS = Object.freeze({
  authorizeUpload: "work.attachment.authorizeUpload",
  attach: "work.attachment.attach",
  requestAccess: "work.attachment.access",
});

export const TASK_UPLOAD_GRANT_LIFETIME_MS = 15 * 60 * 1_000;
export const TASK_FILE_ACCESS_LIFETIME_MS = 5 * 60 * 1_000;

interface TaskDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly warehouseId: string;
  readonly status: string;
  readonly claimedByUserId?: string;
  readonly leaseExpiresAt?: number;
}

interface UploadGrantDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly warehouseId: string;
  readonly operatorTaskId: string;
  readonly authorizedByUserId: string;
  readonly authorizedClerkUserId: string;
  readonly expiresAt: number;
  readonly uploadStartedAt: number;
  readonly consumedUploadThingKey?: string;
  readonly consumedContentDigest?: string;
  readonly consumedContentType?: string;
  readonly consumedByteSize?: number;
  readonly consumedAt?: number;
  readonly attachedAt?: number;
}

interface AttachmentDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly warehouseId: string;
  readonly operatorTaskId: string;
  readonly fileName: string;
  readonly kind: "PHOTO" | "DOCUMENT" | "OTHER";
  readonly contentType: string;
  readonly byteSize: number;
  readonly contentDigest: string;
  readonly uploadThingKey: string;
  readonly note?: string;
  readonly verifiedAt: number;
  readonly attachedByUserId: string;
  readonly attachedAt: number;
}

const writeOutcome = v.union(
  v.object({
    written: v.literal(true),
    documentId: v.string(),
    replayed: v.boolean(),
  }),
  v.object({ written: v.literal(false), error: writeErrorValidator }),
);

const validHeldTask = (
  task: TaskDocument | null,
  warehouseId: string,
  actorUserId: string,
  now: number,
): string | null => {
  if (task === null || task.warehouseId !== warehouseId) return "NOT_FOUND";
  if (task.status !== "CLAIMED") return "TASK_NOT_CLAIMED";
  if (task.claimedByUserId !== actorUserId) return "TASK_NOT_HELD_BY_ACTOR";
  if (task.leaseExpiresAt === undefined || task.leaseExpiresAt <= now) {
    return "TASK_LEASE_EXPIRED";
  }
  return null;
};

export const authorizeTaskFileUpload = mutationWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    operatorTaskId: v.id("operatorTasks"),
  },
  returns: v.union(
    v.object({
      uploadGrantId: v.id("operatorTaskUploadGrants"),
      expiresAt: v.number(),
    }),
    v.object({ written: v.literal(false), error: writeErrorValidator }),
  ),
  permissionCode: "work.attachment.attach",
  target: {
    table: "operatorTasks",
    id: ({ operatorTaskId }) => operatorTaskId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const task = await ctx.tenantDb.get<TaskDocument>(
      "operatorTasks",
      args.operatorTaskId,
    );
    const now = Date.now();
    const invalid = validHeldTask(
      task,
      args.warehouseId,
      ctx.tenant.actor._id,
      now,
    );
    if (invalid !== null) return refusal({ code: invalid });
    const expiresAt = now + TASK_UPLOAD_GRANT_LIFETIME_MS;
    const uploadGrantId = await ctx.tenantDb.insert(
      "operatorTaskUploadGrants",
      {
        warehouseId: args.warehouseId,
        operatorTaskId: args.operatorTaskId,
        authorizedByUserId: ctx.tenant.actor._id,
        authorizedClerkUserId: ctx.tenant.actor.clerkUserId,
        expiresAt,
        uploadStartedAt: now,
      },
    );
    return { uploadGrantId: uploadGrantId as never, expiresAt };
  },
});

/** Attach the verified object; retries replay before checking the current lease. */
export const attachTaskFile = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    operatorTaskId: v.id("operatorTasks"),
    uploadGrantId: v.id("operatorTaskUploadGrants"),
    fileName: v.string(),
    kind: operatorTaskAttachmentKind,
    contentType: v.string(),
    byteSize: v.number(),
    contentDigest: v.string(),
    uploadThingKey: v.string(),
    note: v.optional(v.string()),
  },
  returns: writeOutcome,
  permissionCode: "work.attachment.attach",
  target: {
    table: "operatorTasks",
    id: ({ operatorTaskId }) => operatorTaskId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const fileName = args.fileName.trim().normalize("NFC");
    const note = args.note?.trim().normalize("NFC");
    if (fileName.length === 0 || fileName.length > 200) {
      return refusal({ code: "FIELD_INVALID", field: "fileName" });
    }
    if (note !== undefined && (note.length === 0 || note.length > 1_000)) {
      return refusal({ code: "FIELD_INVALID", field: "note" });
    }
    const fingerprint = await fingerprintArguments({
      operatorTaskId: args.operatorTaskId,
      uploadGrantId: args.uploadGrantId,
      fileName,
      kind: args.kind,
      contentType: args.contentType,
      byteSize: args.byteSize,
      contentDigest: args.contentDigest,
      uploadThingKey: args.uploadThingKey,
      note: note ?? null,
    });
    if (!fingerprint.ok) return refusal({ code: fingerprint.error.code });
    const replay = await checkIdempotency({
      tenantDb: ctx.tenantDb,
      operation: TASK_FILE_OPERATIONS.attach,
      requestId: args.requestId,
      requestHash: fingerprint.value,
    });
    if (!replay.ok) return refusal({ code: replay.error.code });
    if (replay.value.kind === "REPLAY") {
      const original = replay.value.record.resultRef;
      const row =
        original === undefined
          ? null
          : await ctx.tenantDb.get<AttachmentDocument>(
              "operatorTaskAttachments",
              original,
            );
      if (
        row === null ||
        row.operatorTaskId !== args.operatorTaskId ||
        row.attachedByUserId !== ctx.tenant.actor._id
      ) {
        return refusal({ code: "REPLAY_UNRESOLVABLE" });
      }
      return { written: true as const, documentId: original!, replayed: true };
    }

    const now = Date.now();
    const task = await ctx.tenantDb.get<TaskDocument>(
      "operatorTasks",
      args.operatorTaskId,
    );
    const invalid = validHeldTask(
      task,
      args.warehouseId,
      ctx.tenant.actor._id,
      now,
    );
    if (invalid !== null) return refusal({ code: invalid });
    const grant = await ctx.tenantDb.get<UploadGrantDocument>(
      "operatorTaskUploadGrants",
      args.uploadGrantId,
    );
    if (
      grant === null ||
      grant.warehouseId !== args.warehouseId ||
      grant.operatorTaskId !== args.operatorTaskId ||
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
    const attachmentId = await ctx.tenantDb.insert("operatorTaskAttachments", {
      warehouseId: args.warehouseId,
      operatorTaskId: args.operatorTaskId,
      fileName,
      kind: args.kind,
      contentType: args.contentType,
      byteSize: args.byteSize,
      contentDigest: args.contentDigest,
      uploadThingKey: args.uploadThingKey,
      ...(note === undefined ? {} : { note }),
      verifiedAt: grant.consumedAt ?? now,
      attachedByUserId: ctx.tenant.actor._id,
      attachedAt: now,
    });
    await ctx.tenantDb.patch("operatorTaskUploadGrants", grant._id, {
      attachedAt: now,
    });
    await writeIdempotencyRecord({
      tenantDb: ctx.tenantDb,
      operation: TASK_FILE_OPERATIONS.attach,
      requestId: args.requestId,
      requestHash: fingerprint.value,
      resultRef: attachmentId,
      resultHash: await sha256Hex(attachmentId),
      actorUserId: ctx.tenant.actor._id,
      now,
    });
    return {
      written: true as const,
      documentId: attachmentId,
      replayed: false,
    };
  },
});

const attachmentRow = v.object({
  operatorTaskAttachmentId: v.id("operatorTaskAttachments"),
  operatorTaskId: v.id("operatorTasks"),
  warehouseId: v.id("warehouses"),
  fileName: v.string(),
  kind: operatorTaskAttachmentKind,
  contentType: v.string(),
  byteSize: v.number(),
  contentDigest: v.string(),
  note: v.optional(v.string()),
  verifiedAt: v.number(),
  attachedByUserId: v.id("users"),
  attachedAt: v.number(),
});

export const listTaskFiles = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    operatorTaskId: v.id("operatorTasks"),
    maxPageSize: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      items: v.array(attachmentRow),
      nextCursor: v.union(v.string(), v.null()),
      complete: v.boolean(),
    }),
    v.object({ ok: v.literal(false), error: v.object({ code: v.string() }) }),
  ),
  permissionCode: "work.attachment.read",
  target: {
    table: "operatorTasks",
    id: ({ operatorTaskId }) => operatorTaskId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const task = await ctx.tenantDb.get<TaskDocument>(
      "operatorTasks",
      args.operatorTaskId,
    );
    if (task === null || task.warehouseId !== args.warehouseId) {
      return { ok: false as const, error: { code: "NOT_FOUND" } };
    }
    const request = makeJobPageRequest({
      ...(args.maxPageSize === undefined
        ? {}
        : { maxPageSize: args.maxPageSize }),
      ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
    });
    if (!request.ok) {
      return { ok: false as const, error: { code: request.error.code } };
    }
    const page = await ctx.tenantDb
      .byIndex<AttachmentDocument>(
        "operatorTaskAttachments",
        "by_orgId_operatorTaskId_attachedAt",
        [{ field: "operatorTaskId", value: args.operatorTaskId }],
      )
      .page({
        limit: request.value.maxPageSize,
        ...(request.value.cursor === null
          ? {}
          : { cursor: request.value.cursor }),
      });
    return pageResult(
      page.page.map((row) => ({
        operatorTaskAttachmentId: row._id as never,
        operatorTaskId: row.operatorTaskId as never,
        warehouseId: row.warehouseId as never,
        fileName: row.fileName,
        kind: row.kind,
        contentType: row.contentType,
        byteSize: row.byteSize,
        contentDigest: row.contentDigest,
        ...(row.note === undefined ? {} : { note: row.note }),
        verifiedAt: row.verifiedAt,
        attachedByUserId: row.attachedByUserId as never,
        attachedAt: row.attachedAt,
      })),
      page,
    );
  },
});

const fileAccess = v.union(
  v.object({
    granted: v.literal(true),
    url: v.string(),
    expiresAt: v.number(),
  }),
  v.object({
    granted: v.literal(false),
    error: v.object({ code: v.string() }),
  }),
);

export const requestTaskFileAccess = mutationWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    operatorTaskAttachmentId: v.id("operatorTaskAttachments"),
  },
  returns: fileAccess,
  permissionCode: "work.attachment.read",
  target: {
    table: "operatorTaskAttachments",
    id: ({ operatorTaskAttachmentId }) => operatorTaskAttachmentId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const file = await ctx.tenantDb.get<AttachmentDocument>(
      "operatorTaskAttachments",
      args.operatorTaskAttachmentId,
    );
    if (file === null || file.warehouseId !== args.warehouseId) {
      return { granted: false as const, error: { code: "NOT_FOUND" } };
    }
    const expiresAt = Date.now() + TASK_FILE_ACCESS_LIFETIME_MS;
    const grantId = await ctx.tenantDb.insert("operatorTaskFileAccessGrants", {
      warehouseId: args.warehouseId,
      operatorTaskAttachmentId: args.operatorTaskAttachmentId,
      issuedToUserId: ctx.tenant.actor._id,
      expiresAt,
    });
    return {
      granted: true as const,
      url: `/api/private-files/uploadthing?scope=task&warehouseId=${encodeURIComponent(args.warehouseId)}&grantId=${encodeURIComponent(grantId)}`,
      expiresAt,
    };
  },
});

export const redeemUploadThingTaskFileAccessGrant = mutationWithOrg({
  args: {
    grantId: v.id("operatorTaskFileAccessGrants"),
    warehouseId: v.id("warehouses"),
  },
  returns: v.union(
    v.null(),
    v.object({ providerKey: v.string(), fileName: v.string() }),
  ),
  permissionCode: "work.attachment.read",
  target: {
    table: "operatorTaskFileAccessGrants",
    id: ({ grantId }) => grantId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const grant = await ctx.tenantDb.get<{
      readonly _id: string;
      readonly orgId: TenantOrgId;
      readonly warehouseId: string;
      readonly operatorTaskAttachmentId: string;
      readonly issuedToUserId: string;
      readonly expiresAt: number;
      readonly consumedAt?: number;
    }>("operatorTaskFileAccessGrants", args.grantId);
    if (
      grant === null ||
      grant.warehouseId !== args.warehouseId ||
      grant.issuedToUserId !== ctx.tenant.actor._id ||
      grant.consumedAt !== undefined ||
      grant.expiresAt < Date.now()
    ) {
      return null;
    }
    const file = await ctx.tenantDb.get<AttachmentDocument>(
      "operatorTaskAttachments",
      grant.operatorTaskAttachmentId,
    );
    if (file === null || file.warehouseId !== args.warehouseId) return null;
    await ctx.tenantDb.patch("operatorTaskFileAccessGrants", grant._id, {
      consumedAt: Date.now(),
    });
    return { providerKey: file.uploadThingKey, fileName: file.fileName };
  },
});
