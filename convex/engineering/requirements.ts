/** Versioned requirement sign-off between Customer Service and Engineering. */
import { v } from "convex/values";

import {
  appendDomainAudit,
  createMasterDataRow,
  insertedFields,
} from "../lib/masterDataStore";
import {
  listArgs,
  pageOf,
  pageOptions,
  pageRefusal,
  pageRequestOf,
} from "../lib/listEnvelope";
import { mutationWithOrg, queryWithOrg } from "../lib/tenantFunctions";
import type { TenantOrgId } from "../lib/tenantDb";
import {
  refusal,
  writeContextOf,
  writeOutcomeValidator,
  written,
} from "../lib/writeEnvelope";
import {
  assessDesignReadiness,
  type DesignRequirementConfirmations,
  type DesignRequirementKey,
} from "../model/orderToShip/designReadiness";
import type { DesignSpecification } from "../model/orderToShip/designSpecification";

const requirementKey = v.union(
  v.literal("CUSTOMER_PRODUCT_IDENTITY"),
  v.literal("DIMENSIONS"),
  v.literal("CONSTRUCTION"),
  v.literal("PRINT"),
  v.literal("PACKING"),
  v.literal("ROUTE"),
  v.literal("MATERIALS"),
  v.literal("QUALITY"),
);

const confirmationsValidator = v.object({
  CUSTOMER_PRODUCT_IDENTITY: v.boolean(),
  DIMENSIONS: v.boolean(),
  CONSTRUCTION: v.boolean(),
  PRINT: v.boolean(),
  PACKING: v.boolean(),
  ROUTE: v.boolean(),
  MATERIALS: v.boolean(),
  QUALITY: v.boolean(),
});

interface RequestDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly status: string;
  readonly specification: DesignSpecification;
  readonly latestRequirementVersion?: number;
}

interface VersionDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly designRequestId: string;
  readonly version: number;
  readonly confirmations: DesignRequirementConfirmations;
  readonly status: "INCOMPLETE" | "READY";
  readonly missing: readonly DesignRequirementKey[];
  readonly note?: string;
  readonly recordedByUserId: string;
  readonly recordedAt: number;
}

const MAX_REQUIREMENT_VERSIONS = 99;
const MAX_NOTE_LENGTH = 1_000;

export const recordDesignRequirements = mutationWithOrg({
  args: {
    requestId: v.string(),
    designRequestId: v.id("designRequests"),
    confirmations: confirmationsValidator,
    note: v.optional(v.string()),
  },
  returns: writeOutcomeValidator,
  permissionCode: "engineering.request.assign",
  target: {
    table: "designRequests",
    id: ({ designRequestId }) => designRequestId,
  },
  handler: async (ctx, args) => {
    const request = await ctx.tenantDb.get<RequestDocument>(
      "designRequests",
      args.designRequestId,
    );
    if (request === null) {
      return refusal({ code: "NOT_FOUND", table: "designRequests" });
    }
    if (request.status === "FULFILLED" || request.status === "CANCELLED") {
      return refusal({
        code: "ILLEGAL_TRANSITION",
        field: "status",
        reason: "REQUEST_CLOSED",
        status: request.status,
      });
    }
    const note = args.note?.trim();
    if ((note?.length ?? 0) > MAX_NOTE_LENGTH) {
      return refusal({
        code: "FIELD_INVALID",
        field: "note",
        reason: "TOO_LONG",
      });
    }
    const existing = await ctx.tenantDb
      .byIndex<VersionDocument>(
        "designRequirementVersions",
        "by_orgId_designRequestId_version",
        [{ field: "designRequestId", value: args.designRequestId }],
      )
      .take(MAX_REQUIREMENT_VERSIONS + 1);
    if (existing.length > MAX_REQUIREMENT_VERSIONS) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "version",
        reason: "REQUIREMENT_HISTORY_TOO_LONG",
      });
    }
    const version =
      existing.reduce((highest, row) => Math.max(highest, row.version), 0) + 1;
    const assessment = assessDesignReadiness(
      request.specification,
      args.confirmations,
    );
    const context = writeContextOf(ctx, {
      table: "designRequirementVersions",
      operation: "engineering.requirements.record",
      requestId: args.requestId,
    });
    const document = {
      designRequestId: args.designRequestId,
      version,
      confirmations: { ...args.confirmations },
      status: assessment.status,
      missing: [...assessment.missing],
      ...(note === undefined || note.length === 0 ? {} : { note }),
      recordedByUserId: context.actorUserId,
      recordedAt: context.now,
    };
    const outcome = await createMasterDataRow({
      ...context,
      fingerprint: {
        operation: "engineering.requirements.record",
        requestId: args.requestId,
        designRequestId: args.designRequestId,
        confirmations: args.confirmations,
        note: note ?? null,
      },
      uniqueness: [
        {
          field: "version",
          index: "by_orgId_designRequestId_version",
          equality: [
            { field: "designRequestId", value: args.designRequestId },
            { field: "version", value: version },
          ],
        },
      ],
      document,
    });
    if (!outcome.ok) return refusal(outcome.error);
    if (!outcome.value.replayed) {
      await ctx.tenantDb.patch("designRequests", args.designRequestId, {
        latestRequirementVersion: version,
        requirementReadiness: assessment.status,
        missingRequirements: [...assessment.missing],
        requirementsRecordedByUserId: context.actorUserId,
        requirementsRecordedAt: context.now,
      });
      await appendDomainAudit(context, {
        entityTable: "designRequests",
        entityId: args.designRequestId,
        changes: insertedFields({
          latestRequirementVersion: version,
          requirementReadiness: assessment.status,
          missingRequirements: [...assessment.missing],
        }),
      });
    }
    return written(outcome.value);
  },
});

export const listDesignRequirementVersions = queryWithOrg({
  args: { designRequestId: v.id("designRequests"), ...listArgs },
  returns: pageOf(
    v.object({
      designRequirementVersionId: v.id("designRequirementVersions"),
      version: v.number(),
      confirmations: confirmationsValidator,
      status: v.union(v.literal("INCOMPLETE"), v.literal("READY")),
      missing: v.array(requirementKey),
      note: v.optional(v.string()),
      recordedByUserId: v.id("users"),
      recordedAt: v.number(),
    }),
  ),
  permissionCode: "engineering.request.read",
  target: {
    table: "designRequests",
    id: ({ designRequestId }) => designRequestId,
  },
  handler: async (ctx, args) => {
    const request = pageRequestOf(args);
    if (!request.ok) return pageRefusal(request.error.code);
    if (
      (await ctx.tenantDb.get("designRequests", args.designRequestId)) === null
    ) {
      return pageRefusal("REFERENCE_NOT_FOUND");
    }
    const page = await ctx.tenantDb
      .byIndex<VersionDocument>(
        "designRequirementVersions",
        "by_orgId_designRequestId_version",
        [{ field: "designRequestId", value: args.designRequestId }],
      )
      .page(pageOptions(request.value));
    return {
      ok: true as const,
      items: page.page.map((row) => ({
        designRequirementVersionId: row._id as never,
        version: row.version,
        confirmations: { ...row.confirmations },
        status: row.status,
        missing: [...row.missing],
        ...(row.note === undefined ? {} : { note: row.note }),
        recordedByUserId: row.recordedByUserId as never,
        recordedAt: row.recordedAt,
      })),
      nextCursor: page.isDone ? null : page.continueCursor,
      complete: page.isDone,
    };
  },
});
