import { v, type Infer } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import { requireDesignReady } from "../model/orderToShip/designReadiness";
import {
  appendDomainAudit,
  replayTenantWriteIfPresent,
  updateMasterDataRow,
} from "../lib/masterDataStore";
import {
  listArgs,
  pageOf,
  pageOptions,
  pageRefusal,
  pageResult,
  pageRequestOf,
} from "../lib/listEnvelope";
import { mutationWithOrg, queryWithOrg } from "../lib/tenantFunctions";
import type { TenantOrgId } from "../lib/tenantDb";
import {
  boxSpecification,
  designRequirementKey,
  designRequestPriority,
  designRequestStatus,
  masterCardRevisionStatus,
} from "../lib/validators";
import {
  refusal,
  writeContextOf,
  writeOutcomeValidator,
  written,
} from "../lib/writeEnvelope";
import { checkDesignFulfilment } from "../model/orderToShip/customerOrder";
import {
  checkDesignRequestFulfilment,
  isDesignRequestOverdue,
  planDesignRequestAssignment,
  planDesignRequestProgress,
  planSimilarDesignConfirmation,
} from "../model/orderToShip/designRequest";
import {
  designSimilarityScore,
  type DesignSpecification,
} from "../model/orderToShip/designSpecification";

export const ENGINEERING_REQUEST_OPERATIONS = Object.freeze({
  assignRequest: "engineering.request.assign",
  progressRequest: "engineering.request.progress",
  fulfilRequest: "engineering.request.fulfil",
  confirmSimilar: "engineering.request.confirmSimilar",
});

type RequestDocument = Doc<"designRequests">;
type LineDocument = Doc<"customerOrderLines">;
type OrderDocument = Doc<"customerOrders">;
type RevisionDocument = Doc<"masterCardRevisions">;
type CardDocument = Doc<"masterCards">;

type MembershipRow = Doc<"memberships">;

export const assignDesignRequest = mutationWithOrg({
  args: {
    requestId: v.string(),
    designRequestId: v.id("designRequests"),
    assignedToUserId: v.optional(v.id("users")),
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
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "designRequests",
      operation: ENGINEERING_REQUEST_OPERATIONS.assignRequest,
      requestId: args.requestId,
      fingerprint: {
        operation: ENGINEERING_REQUEST_OPERATIONS.assignRequest,
        requestId: args.requestId,
        designRequestId: args.designRequestId,
        assignedToUserId: args.assignedToUserId ?? null,
      },
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);
    const assignment = planDesignRequestAssignment(
      request,
      args.assignedToUserId,
    );
    if (!assignment.ok) return refusal(assignment.error);

    if (args.assignedToUserId !== undefined) {
      const membership = await ctx.tenantDb
        .byIndex<MembershipRow>("memberships", "by_orgId_status_userId", [
          { field: "status", value: "ACTIVE" },
          { field: "userId", value: args.assignedToUserId },
        ])
        .first();
      if (membership === null) {
        return refusal({
          code: "REFERENCE_NOT_FOUND",
          field: "assignedToUserId",
        });
      }
    }

    const outcome = await updateMasterDataRow({
      ...writeContextOf(ctx, {
        table: "designRequests",
        operation: ENGINEERING_REQUEST_OPERATIONS.assignRequest,
        requestId: args.requestId,
      }),
      documentId: args.designRequestId,
      fingerprint: {
        operation: ENGINEERING_REQUEST_OPERATIONS.assignRequest,
        requestId: args.requestId,
        designRequestId: args.designRequestId,
        assignedToUserId: args.assignedToUserId ?? null,
      },
      uniqueness: [],
      patch: assignment.value,
    });

    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});

export const progressDesignRequest = mutationWithOrg({
  args: {
    requestId: v.string(),
    designRequestId: v.id("designRequests"),
    nextStatus: v.union(v.literal("IN_PROGRESS"), v.literal("IN_REVIEW")),
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
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "designRequests",
      operation: ENGINEERING_REQUEST_OPERATIONS.progressRequest,
      requestId: args.requestId,
      fingerprint: {
        operation: ENGINEERING_REQUEST_OPERATIONS.progressRequest,
        requestId: args.requestId,
        designRequestId: args.designRequestId,
        nextStatus: args.nextStatus,
      },
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);
    const progress = planDesignRequestProgress(request, args.nextStatus);
    if (!progress.ok) return refusal(progress.error);
    const outcome = await updateMasterDataRow({
      ...writeContextOf(ctx, {
        table: "designRequests",
        operation: ENGINEERING_REQUEST_OPERATIONS.progressRequest,
        requestId: args.requestId,
      }),
      documentId: args.designRequestId,
      fingerprint: {
        operation: ENGINEERING_REQUEST_OPERATIONS.progressRequest,
        requestId: args.requestId,
        designRequestId: args.designRequestId,
        nextStatus: args.nextStatus,
      },
      uniqueness: [],
      patch: { status: progress.value },
    });
    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});

export const fulfilDesignRequest = mutationWithOrg({
  args: {
    requestId: v.string(),
    designRequestId: v.id("designRequests"),
    masterCardRevisionId: v.id("masterCardRevisions"),
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
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "designRequests",
      operation: ENGINEERING_REQUEST_OPERATIONS.fulfilRequest,
      requestId: args.requestId,
      fingerprint: {
        operation: ENGINEERING_REQUEST_OPERATIONS.fulfilRequest,
        requestId: args.requestId,
        designRequestId: args.designRequestId,
        masterCardRevisionId: args.masterCardRevisionId,
      },
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);
    const revision = await ctx.tenantDb.get<RevisionDocument>(
      "masterCardRevisions",
      args.masterCardRevisionId,
    );
    if (revision === null) {
      return refusal({
        code: "REFERENCE_NOT_FOUND",
        field: "masterCardRevisionId",
      });
    }
    const card = await ctx.tenantDb.get<CardDocument>(
      "masterCards",
      revision.masterCardId,
    );
    if (card === null) {
      return refusal({ code: "REFERENCE_NOT_FOUND", field: "masterCardId" });
    }
    const line = await ctx.tenantDb.get<LineDocument>(
      "customerOrderLines",
      request.customerOrderLineId,
    );
    if (line === null) {
      return refusal({
        code: "REFERENCE_NOT_FOUND",
        field: "customerOrderLineId",
      });
    }
    const requestFulfilment = checkDesignRequestFulfilment({
      request,
      requestedCustomerProductCode: line.customerProductCode,
      revisionStatus: revision.status,
      revisionCustomerProductCode: card.customerProductCode,
    });
    if (!requestFulfilment.ok) return refusal(requestFulfilment.error);
    const readiness = requireDesignReady(request.requirementReadiness);
    if (!readiness.ok) return refusal(readiness.error);

    const fulfilment = checkDesignFulfilment(line, revision);
    if (!fulfilment.ok) return refusal(fulfilment.error);

    const context = writeContextOf(ctx, {
      table: "designRequests",
      operation: ENGINEERING_REQUEST_OPERATIONS.fulfilRequest,
      requestId: args.requestId,
    });

    const outcome = await updateMasterDataRow({
      ...context,
      documentId: args.designRequestId,
      fingerprint: {
        operation: ENGINEERING_REQUEST_OPERATIONS.fulfilRequest,
        requestId: args.requestId,
        designRequestId: args.designRequestId,
        masterCardRevisionId: args.masterCardRevisionId,
      },
      uniqueness: [],
      patch: {
        status: "FULFILLED",
        masterCardRevisionId: args.masterCardRevisionId,
      },
    });

    if (!outcome.ok) return refusal(outcome.error);

    if (!outcome.value.replayed) {
      await ctx.tenantDb.patch("customerOrderLines", line._id, {
        status: fulfilment.value,
        masterCardRevisionId: args.masterCardRevisionId,
      });
      await appendDomainAudit(context, {
        entityTable: "customerOrderLines",
        entityId: line._id,
        changes: [
          { field: "status", from: line.status, to: fulfilment.value },
          {
            field: "masterCardRevisionId",
            to: args.masterCardRevisionId,
          },
        ],
      });
    }

    return written(outcome.value);
  },
});

export const confirmSimilarDesign = mutationWithOrg({
  args: {
    requestId: v.string(),
    designRequestId: v.id("designRequests"),
    masterCardRevisionId: v.id("masterCardRevisions"),
    reason: v.string(),
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
    const reason = args.reason.trim();
    const fingerprint = {
      operation: ENGINEERING_REQUEST_OPERATIONS.confirmSimilar,
      requestId: args.requestId,
      designRequestId: args.designRequestId,
      masterCardRevisionId: args.masterCardRevisionId,
      reason,
    };
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "designRequests",
      operation: ENGINEERING_REQUEST_OPERATIONS.confirmSimilar,
      requestId: args.requestId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);

    const revision = await ctx.tenantDb.get<RevisionDocument>(
      "masterCardRevisions",
      args.masterCardRevisionId,
    );
    if (revision === null) {
      return refusal({
        code: "REFERENCE_NOT_FOUND",
        field: "masterCardRevisionId",
      });
    }
    const line = await ctx.tenantDb.get<LineDocument>(
      "customerOrderLines",
      request.customerOrderLineId,
    );
    if (line === null) {
      return refusal({
        code: "REFERENCE_NOT_FOUND",
        field: "customerOrderLineId",
      });
    }
    const order = await ctx.tenantDb.get<OrderDocument>(
      "customerOrders",
      line.customerOrderId,
    );
    if (order === null) {
      return refusal({ code: "REFERENCE_NOT_FOUND", field: "customerOrderId" });
    }
    const card = await ctx.tenantDb.get<CardDocument>(
      "masterCards",
      revision.masterCardId,
    );
    if (card === null || card.customerId !== order.customerId) {
      return refusal({ code: "REFERENCE_NOT_FOUND", field: "masterCardId" });
    }
    const confirmation = planSimilarDesignConfirmation({
      request,
      requestedSpecification: line.specification,
      candidateSpecification: revision.specification,
      candidateRevisionStatus: revision.status,
      lineStatus: line.status,
      reason,
    });
    if (!confirmation.ok) return refusal(confirmation.error);
    const readiness = requireDesignReady(request.requirementReadiness);
    if (!readiness.ok) return refusal(readiness.error);
    const context = writeContextOf(ctx, {
      table: "designRequests",
      operation: ENGINEERING_REQUEST_OPERATIONS.confirmSimilar,
      requestId: args.requestId,
    });
    const outcome = await updateMasterDataRow({
      ...context,
      documentId: args.designRequestId,
      fingerprint,
      uniqueness: [],
      patch: {
        status: "FULFILLED",
        masterCardRevisionId: args.masterCardRevisionId,
        similarityConfirmation: {
          score: confirmation.value.score,
          reason: confirmation.value.reason,
          confirmedByUserId: context.actorUserId,
          confirmedAt: context.now,
        },
      },
    });
    if (!outcome.ok) return refusal(outcome.error);
    if (!outcome.value.replayed) {
      await ctx.tenantDb.patch("customerOrderLines", line._id, {
        status: "DESIGN_READY",
        designSource: "EXISTING",
        masterCardRevisionId: args.masterCardRevisionId,
      });
      await appendDomainAudit(context, {
        entityTable: "customerOrderLines",
        entityId: line._id,
        changes: [
          { field: "status", from: line.status, to: "DESIGN_READY" },
          { field: "designSource", from: line.designSource, to: "EXISTING" },
          { field: "masterCardRevisionId", to: args.masterCardRevisionId },
        ],
      });
    }
    return written(outcome.value);
  },
});

const requestValidator = v.object({
  designRequestId: v.id("designRequests"),
  requestNumber: v.string(),
  customerOrderLineId: v.id("customerOrderLines"),
  customerId: v.id("customers"),
  customerProductCode: v.string(),
  designKey: v.string(),
  specification: boxSpecification,
  status: designRequestStatus,
  priority: designRequestPriority,
  dueAt: v.optional(v.number()),
  overdue: v.boolean(),
  assignedToUserId: v.optional(v.id("users")),
  masterCardRevisionId: v.optional(v.id("masterCardRevisions")),
  latestRequirementVersion: v.optional(v.number()),
  requirementReadiness: v.optional(
    v.union(v.literal("INCOMPLETE"), v.literal("READY")),
  ),
  missingRequirements: v.optional(v.array(designRequirementKey)),
  requirementsRecordedByUserId: v.optional(v.id("users")),
  requirementsRecordedAt: v.optional(v.number()),
  similarityConfirmation: v.optional(
    v.object({
      score: v.number(),
      reason: v.string(),
      confirmedByUserId: v.id("users"),
      confirmedAt: v.number(),
    }),
  ),
});

export const listDesignRequests = queryWithOrg({
  args: { status: v.optional(designRequestStatus), ...listArgs },
  returns: pageOf(requestValidator),
  permissionCode: "engineering.request.read",
  target: { table: "designRequests" },
  handler: async (ctx, args) => {
    const request = pageRequestOf(args);
    if (!request.ok) return pageRefusal(request.error.code);

    const page = await ctx.tenantDb
      .byIndex<RequestDocument>(
        "designRequests",
        args.status === undefined
          ? "by_orgId_requestNumber"
          : "by_orgId_status_requestNumber",
        args.status === undefined
          ? []
          : [{ field: "status", value: args.status }],
      )
      .page(pageOptions(request.value));

    const items = [];
    for (const row of page.page) {
      const line = await ctx.tenantDb.get<LineDocument>(
        "customerOrderLines",
        row.customerOrderLineId,
      );
      if (line === null) return pageRefusal("REFERENCE_NOT_FOUND");
      const order = await ctx.tenantDb.get<OrderDocument>(
        "customerOrders",
        line.customerOrderId,
      );
      if (order === null) return pageRefusal("REFERENCE_NOT_FOUND");
      items.push({
        designRequestId: row._id as never,
        requestNumber: row.requestNumber,
        customerOrderLineId: row.customerOrderLineId as never,
        customerId: order.customerId as never,
        customerProductCode: line.customerProductCode,
        designKey: line.designKey,
        specification: { ...line.specification } as never,
        status: row.status as never,
        priority: row.priority as never,
        ...(row.dueAt === undefined ? {} : { dueAt: row.dueAt }),
        overdue: isDesignRequestOverdue(row, Date.now()),
        ...(row.assignedToUserId === undefined
          ? {}
          : { assignedToUserId: row.assignedToUserId as never }),
        ...(row.masterCardRevisionId === undefined
          ? {}
          : { masterCardRevisionId: row.masterCardRevisionId as never }),
        ...(row.latestRequirementVersion === undefined
          ? {}
          : { latestRequirementVersion: row.latestRequirementVersion }),
        ...(row.requirementReadiness === undefined
          ? {}
          : { requirementReadiness: row.requirementReadiness }),
        ...(row.missingRequirements === undefined
          ? {}
          : { missingRequirements: [...row.missingRequirements] }),
        ...(row.requirementsRecordedByUserId === undefined
          ? {}
          : {
              requirementsRecordedByUserId:
                row.requirementsRecordedByUserId as never,
            }),
        ...(row.requirementsRecordedAt === undefined
          ? {}
          : { requirementsRecordedAt: row.requirementsRecordedAt }),
      });
    }

    return pageResult(items, page);
  },
});

export const listSimilarReleasedDesigns = queryWithOrg({
  args: { designRequestId: v.id("designRequests") },
  returns: v.array(
    v.object({
      masterCardId: v.id("masterCards"),
      masterCardRevisionId: v.id("masterCardRevisions"),
      cardNumber: v.string(),
      customerProductCode: v.string(),
      revisionNumber: v.number(),
      score: v.number(),
      specification: boxSpecification,
    }),
  ),
  permissionCode: "engineering.request.read",
  target: {
    table: "designRequests",
    id: ({ designRequestId }) => designRequestId,
  },
  handler: async (ctx, args) => {
    const request = await ctx.tenantDb.get<RequestDocument>(
      "designRequests",
      args.designRequestId,
    );
    if (request === null) return [];
    const line = await ctx.tenantDb.get<LineDocument>(
      "customerOrderLines",
      request.customerOrderLineId,
    );
    if (line === null) return [];
    const order = await ctx.tenantDb.get<OrderDocument>(
      "customerOrders",
      line.customerOrderId,
    );
    if (order === null) return [];

    const cards = await ctx.tenantDb
      .byIndex<CardDocument>("masterCards", "by_orgId_customerId_designKey", [
        { field: "customerId", value: order.customerId },
        { field: "designKey", value: line.designKey },
      ])
      .take(20);
    const candidates: Array<{
      masterCardId: Id<"masterCards">;
      masterCardRevisionId: Id<"masterCardRevisions">;
      cardNumber: string;
      customerProductCode: string;
      revisionNumber: number;
      score: number;
      specification: Infer<typeof boxSpecification>;
    }> = [];
    for (const card of cards) {
      if (
        card.status !== "ACTIVE" ||
        card.cardNumber === undefined ||
        card.releasedRevisionId === undefined
      ) {
        continue;
      }
      const revision = await ctx.tenantDb.get<
        RevisionDocument & { readonly revisionNumber: number }
      >("masterCardRevisions", card.releasedRevisionId);
      if (revision === null || revision.status !== "RELEASED") continue;
      const score = designSimilarityScore(
        line.specification,
        revision.specification,
      );
      if (score <= 0) continue;
      candidates.push({
        masterCardId: card._id as Id<"masterCards">,
        masterCardRevisionId: revision._id as Id<"masterCardRevisions">,
        cardNumber: card.cardNumber,
        customerProductCode: card.customerProductCode,
        revisionNumber: revision.revisionNumber,
        score,
        specification: revision.specification as Infer<typeof boxSpecification>,
      });
    }
    return candidates
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.cardNumber.localeCompare(right.cardNumber),
      )
      .slice(0, 20);
  },
});

export const listReleasedRevisions = queryWithOrg({
  args: { masterCardId: v.id("masterCards"), ...listArgs },
  returns: pageOf(
    v.object({
      masterCardRevisionId: v.id("masterCardRevisions"),
      revisionNumber: v.number(),
      designKey: v.string(),
      specification: boxSpecification,
      status: masterCardRevisionStatus,
    }),
  ),
  permissionCode: "engineering.masterCard.read",
  target: { table: "masterCards", id: ({ masterCardId }) => masterCardId },
  handler: async (ctx, args) => {
    const request = pageRequestOf(args);
    if (!request.ok) return pageRefusal(request.error.code);

    const card = await ctx.tenantDb.get("masterCards", args.masterCardId);
    if (card === null) return pageRefusal("REFERENCE_NOT_FOUND");

    const page = await ctx.tenantDb
      .byIndex<{
        readonly _id: string;
        readonly orgId: TenantOrgId;
        readonly revisionNumber: number;
        readonly designKey: string;
        readonly status: string;
        readonly specification: DesignSpecification;
      }>("masterCardRevisions", "by_orgId_masterCardId_status", [
        { field: "masterCardId", value: args.masterCardId },
        { field: "status", value: "RELEASED" },
      ])
      .page(pageOptions(request.value));

    return pageResult(
      page.page.map((revision) => ({
        masterCardRevisionId: revision._id as never,
        revisionNumber: revision.revisionNumber,
        designKey: revision.designKey,
        specification: { ...revision.specification } as never,
        status: revision.status as never,
      })),
      page,
    );
  },
});
