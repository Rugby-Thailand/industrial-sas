/** Previewed, bounded, resumable legacy master-card migration. */
import { v } from "convex/values";

import {
  CODE_FIELD,
  appendDomainAudit,
  assertUnique,
  createMasterDataRow,
  insertedFields,
  normalizeDisplayName,
  normalizeField,
  replayTenantWriteIfPresent,
} from "../lib/masterDataStore";
import { mutationWithOrg, queryWithOrg } from "../lib/tenantFunctions";
import type { TenantOrgId } from "../lib/tenantDb";
import { boxSpecification, masterCardFileKind } from "../lib/validators";
import {
  refusal,
  writeContextOf,
  writeOutcomeValidator,
  written,
} from "../lib/writeEnvelope";
import {
  cleanupExpiredMasterCardUploadGrants,
  storageDigestAsHex,
} from "./files";
import { designKeyOf } from "../model/orderToShip/designSpecification";
import {
  previewMasterCardImport,
  type ReadyLegacyMasterCardRow,
} from "../model/orderToShip/masterCardImport";

export const MASTER_CARD_IMPORT_OPERATION =
  "engineering.masterCard.importLegacy";
export const MASTER_CARD_IMPORT_UPLOAD_OPERATION =
  "engineering.masterCard.importLegacy.authorizeUpload";
const IMPORT_UPLOAD_GRANT_LIFETIME_MS = 15 * 60 * 1_000;

const legacyFile = v.object({
  fileKey: v.string(),
  fileName: v.string(),
  kind: masterCardFileKind,
  contentType: v.string(),
  byteSize: v.number(),
  contentDigest: v.string(),
  storageId: v.id("_storage"),
  uploadGrantId: v.id("masterCardUploadGrants"),
});

const legacyApproval = v.object({
  authoredByUserId: v.id("users"),
  submittedByUserId: v.optional(v.id("users")),
  decidedByUserId: v.id("users"),
  decidedAt: v.number(),
  decisionNote: v.string(),
});

const legacyRow = v.object({
  sourceRow: v.number(),
  sourceReference: v.string(),
  cardNumber: v.string(),
  customerId: v.id("customers"),
  customerProductCode: v.string(),
  name: v.string(),
  verified: v.boolean(),
  legacyApproval: v.optional(legacyApproval),
  specification: boxSpecification,
  files: v.array(legacyFile),
});

const problem = v.object({
  sourceRow: v.optional(v.number()),
  field: v.optional(v.string()),
  code: v.string(),
  reason: v.optional(v.string()),
});

const previewResult = v.object({
  accepted: v.array(
    v.object({
      sourceRow: v.number(),
      sourceReference: v.string(),
      cardNumber: v.string(),
      customerId: v.id("customers"),
      customerProductCode: v.string(),
      name: v.string(),
      verified: v.boolean(),
      legacyApproval: v.optional(legacyApproval),
      specification: boxSpecification,
      files: v.array(legacyFile),
      revisionStatus: v.union(v.literal("DRAFT"), v.literal("RELEASED")),
      needsReviewReasons: v.array(v.string()),
    }),
  ),
  problems: v.array(problem),
  nextSourceRow: v.union(v.null(), v.number()),
});

export const previewLegacyMasterCardImport = queryWithOrg({
  args: { rows: v.array(legacyRow) },
  returns: previewResult,
  permissionCode: "masterData.import.execute",
  target: { table: "masterCardImportChunks" },
  handler: (_ctx, args) => previewMasterCardImport(args.rows) as never,
});

/** Authorize one gateway-bound file for one legacy batch row. */
export const authorizeLegacyMasterCardFileUpload = mutationWithOrg({
  args: { batchRef: v.string(), sourceRow: v.number() },
  returns: v.union(
    v.object({
      uploadUrl: v.string(),
      uploadGrantId: v.id("masterCardUploadGrants"),
      expiresAt: v.number(),
    }),
    writeOutcomeValidator,
  ),
  permissionCode: "masterData.import.execute",
  target: { table: "masterCardImportChunks" },
  handler: async (ctx, args) => {
    const batchRef = normalizeField("batchRef", args.batchRef, CODE_FIELD);
    if (!batchRef.ok) return refusal(batchRef.error);
    if (!Number.isInteger(args.sourceRow) || args.sourceRow < 1) {
      return refusal({
        code: "FIELD_INVALID",
        field: "sourceRow",
        reason: "NOT_A_POSITIVE_WHOLE_NUMBER",
      });
    }
    await cleanupExpiredMasterCardUploadGrants(ctx);
    const siteUrl = process.env.CONVEX_SITE_URL;
    if (siteUrl === undefined || siteUrl.trim().length === 0) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "uploadUrl",
        reason: "FILE_GATEWAY_NOT_CONFIGURED",
      });
    }
    const context = writeContextOf(ctx, {
      table: "masterCardUploadGrants",
      operation: MASTER_CARD_IMPORT_UPLOAD_OPERATION,
      requestId: ctx.requestId,
    });
    const expiresAt = context.now + IMPORT_UPLOAD_GRANT_LIFETIME_MS;
    const document = {
      batchRef: batchRef.value,
      sourceRow: args.sourceRow,
      authorizedByUserId: context.actorUserId,
      expiresAt,
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
    return {
      uploadUrl: `${siteUrl.replace(/\/$/, "")}/private-master-card-file-upload?grantId=${encodeURIComponent(uploadGrantId)}`,
      uploadGrantId: uploadGrantId as never,
      expiresAt,
    };
  },
});

interface PreparedRow {
  readonly row: ReadyLegacyMasterCardRow;
  readonly cardNumber: string;
  readonly name: string;
  readonly files: readonly {
    readonly fileKey: string;
    readonly fileName: string;
    readonly uploadGrantId: string;
  }[];
}

export const applyLegacyMasterCardImportChunk = mutationWithOrg({
  args: {
    requestId: v.string(),
    batchRef: v.string(),
    rows: v.array(legacyRow),
  },
  returns: writeOutcomeValidator,
  permissionCode: "masterData.import.execute",
  target: { table: "masterCardImportChunks" },
  handler: async (ctx, args) => {
    const batchRef = normalizeField("batchRef", args.batchRef, CODE_FIELD);
    if (!batchRef.ok) return refusal(batchRef.error);
    const preview = previewMasterCardImport(args.rows);
    if (preview.problems.length > 0 || preview.accepted.length === 0) {
      return refusal({
        code: "IMPORT_PREVIEW_REQUIRED",
        field: preview.problems[0]?.field ?? "rows",
        reason: preview.problems[0]?.code ?? "NO_ACCEPTED_ROWS",
      });
    }

    const startSourceRow = Math.min(
      ...preview.accepted.map((row) => row.sourceRow),
    );
    const fingerprint = {
      operation: MASTER_CARD_IMPORT_OPERATION,
      requestId: args.requestId,
      batchRef: batchRef.value,
      rows: args.rows,
    };
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "masterCardImportChunks",
      operation: MASTER_CARD_IMPORT_OPERATION,
      requestId: args.requestId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);

    const firstPrior = await ctx.tenantDb
      .byIndex<{
        readonly _id: string;
        readonly orgId: TenantOrgId;
        readonly nextSourceRow: number;
      }>("masterCardImportChunks", "by_orgId_batchRef_startSourceRow", [
        { field: "batchRef", value: batchRef.value },
      ])
      .first();
    const predecessor = await ctx.tenantDb
      .byIndex<{
        readonly _id: string;
        readonly orgId: TenantOrgId;
        readonly nextSourceRow: number;
      }>("masterCardImportChunks", "by_orgId_batchRef_nextSourceRow", [
        { field: "batchRef", value: batchRef.value },
        { field: "nextSourceRow", value: startSourceRow },
      ])
      .first();
    if (firstPrior !== null && predecessor === null) {
      return refusal({
        code: "IMPORT_CURSOR_MISMATCH",
        field: "sourceRow",
      });
    }

    const prepared: PreparedRow[] = [];
    for (const row of preview.accepted) {
      const customer = await ctx.tenantDb.get("customers", row.customerId);
      if (customer === null) {
        return refusal({ code: "REFERENCE_NOT_FOUND", field: "customerId" });
      }
      if (row.revisionStatus === "RELEASED") {
        const approval = row.legacyApproval!;
        for (const userId of [
          approval.authoredByUserId,
          approval.submittedByUserId,
          approval.decidedByUserId,
        ]) {
          if (userId === undefined) continue;
          const membership = await ctx.tenantDb
            .byIndex("memberships", "by_orgId_userId", [
              { field: "userId", value: userId },
            ])
            .first();
          if (membership === null) {
            return refusal({
              code: "REFERENCE_NOT_FOUND",
              field: "legacyApproval",
            });
          }
        }
      }
      const cardNumber = normalizeField(
        "cardNumber",
        row.cardNumber,
        CODE_FIELD,
      );
      if (!cardNumber.ok) return refusal(cardNumber.error);
      const name = normalizeDisplayName("name", row.name);
      if (!name.ok) return refusal(name.error);
      const unique = await assertUnique(ctx.tenantDb, "masterCards", [
        {
          field: "cardNumber",
          index: "by_orgId_cardNumber",
          equality: [{ field: "cardNumber", value: cardNumber.value }],
        },
        {
          field: "customerProductCode",
          index: "by_orgId_customerId_customerProductCode",
          equality: [
            { field: "customerId", value: row.customerId },
            {
              field: "customerProductCode",
              value: row.customerProductCode,
            },
          ],
        },
      ]);
      if (!unique.ok) return refusal(unique.error);

      const files: Array<{
        fileKey: string;
        fileName: string;
        uploadGrantId: string;
      }> = [];
      for (const file of row.files) {
        const fileKey = normalizeField("fileKey", file.fileKey, CODE_FIELD);
        if (!fileKey.ok) return refusal(fileKey.error);
        const fileName = normalizeDisplayName("fileName", file.fileName);
        if (!fileName.ok) return refusal(fileName.error);
        const grant = await ctx.tenantDb.get<{
          readonly _id: string;
          readonly orgId: TenantOrgId;
          readonly batchRef?: string;
          readonly sourceRow?: number;
          readonly expiresAt: number;
          readonly consumedStorageId?: string;
          readonly consumedAt?: number;
          readonly attachedAt?: number;
        }>("masterCardUploadGrants", file.uploadGrantId);
        if (
          grant === null ||
          grant.batchRef !== batchRef.value ||
          grant.sourceRow !== row.sourceRow ||
          grant.consumedStorageId !== file.storageId ||
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
        const metadata = await ctx.privateFiles.inspect(file.storageId);
        if (
          metadata === null ||
          storageDigestAsHex(metadata.sha256) !==
            file.contentDigest.toLowerCase() ||
          metadata.size !== file.byteSize ||
          (metadata.contentType ?? "application/octet-stream") !==
            file.contentType
        ) {
          return refusal({
            code: "PRECONDITION_FAILED",
            field: "files",
            reason: "STORAGE_METADATA_MISMATCH",
          });
        }
        files.push({
          fileKey: fileKey.value,
          fileName: fileName.value,
          uploadGrantId: grant._id,
        });
      }
      prepared.push({
        row,
        cardNumber: cardNumber.value,
        name: name.value,
        files,
      });
    }

    const context = writeContextOf(ctx, {
      table: "masterCardImportChunks",
      operation: MASTER_CARD_IMPORT_OPERATION,
      requestId: args.requestId,
    });
    const releasedCount = prepared.filter(
      ({ row }) => row.revisionStatus === "RELEASED",
    ).length;
    const chunk = await createMasterDataRow({
      ...context,
      fingerprint,
      uniqueness: [
        {
          field: "sourceRow",
          index: "by_orgId_batchRef_startSourceRow",
          equality: [
            { field: "batchRef", value: batchRef.value },
            { field: "startSourceRow", value: startSourceRow },
          ],
        },
      ],
      document: {
        batchRef: batchRef.value,
        startSourceRow,
        nextSourceRow: preview.nextSourceRow!,
        importedCount: prepared.length,
        releasedCount,
        draftCount: prepared.length - releasedCount,
        importedByUserId: context.actorUserId,
        completedAt: context.now,
      },
    });
    if (!chunk.ok) return refusal(chunk.error);
    if (chunk.value.replayed) return written(chunk.value);

    for (const preparedRow of prepared) {
      const { row } = preparedRow;
      const designKey = designKeyOf(row.specification);
      const cardDocument = {
        cardNumber: preparedRow.cardNumber,
        customerId: row.customerId,
        customerProductCode: row.customerProductCode,
        designKey,
        name: preparedRow.name,
        legacySourceReference: row.sourceReference,
        status: "ACTIVE",
      };
      const cardId = await ctx.tenantDb.insert("masterCards", cardDocument);
      const calculations = row.specification.calculations?.map((entry) => ({
        ...entry,
        verifiedByUserId: context.actorUserId,
        verifiedAt: context.now,
      }));
      const legacyApproval =
        row.revisionStatus === "RELEASED" ? row.legacyApproval! : undefined;
      const revisionDocument = {
        masterCardId: cardId,
        revisionNumber: 1,
        status: row.revisionStatus,
        specification: {
          ...row.specification,
          ...(calculations === undefined ? {} : { calculations }),
        },
        designKey,
        authoredByUserId:
          legacyApproval?.authoredByUserId ?? context.actorUserId,
        legacySourceReference: row.sourceReference,
        ...(row.revisionStatus === "RELEASED"
          ? {
              ...(legacyApproval?.submittedByUserId === undefined
                ? {}
                : { submittedByUserId: legacyApproval.submittedByUserId }),
              decidedByUserId: legacyApproval!.decidedByUserId,
              decidedAt: legacyApproval!.decidedAt,
              decisionNote: legacyApproval!.decisionNote.trim(),
            }
          : {}),
      };
      const revisionId = await ctx.tenantDb.insert(
        "masterCardRevisions",
        revisionDocument,
      );
      if (row.revisionStatus === "RELEASED") {
        await ctx.tenantDb.patch("masterCards", cardId, {
          releasedRevisionId: revisionId,
        });
      }
      await appendDomainAudit(context, {
        entityTable: "masterCards",
        entityId: cardId,
        changes: insertedFields(cardDocument),
      });
      await appendDomainAudit(context, {
        entityTable: "masterCardRevisions",
        entityId: revisionId,
        changes: insertedFields(revisionDocument),
      });
      for (const [index, file] of row.files.entries()) {
        const document = {
          masterCardRevisionId: revisionId,
          fileKey: preparedRow.files[index]!.fileKey,
          fileName: preparedRow.files[index]!.fileName,
          kind: file.kind,
          contentType: file.contentType,
          byteSize: file.byteSize,
          contentDigest: file.contentDigest.toLowerCase(),
          storageId: file.storageId,
          verifiedAt: context.now,
          storageState: "AVAILABLE",
          attachedByUserId: context.actorUserId,
        };
        const fileId = await ctx.tenantDb.insert("masterCardFiles", document);
        await ctx.tenantDb.patch(
          "masterCardUploadGrants",
          preparedRow.files[index]!.uploadGrantId,
          { attachedAt: context.now },
        );
        await appendDomainAudit(context, {
          entityTable: "masterCardFiles",
          entityId: fileId,
          changes: insertedFields(document),
        });
      }
    }
    return written(chunk.value);
  },
});
