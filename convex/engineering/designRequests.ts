/**
 * The engineering queue: what design work is owed, and to which order line.
 *
 * Status: **implemented** (Phase 5A).
 *
 * A design request is raised by `addCustomerOrderLine` when the exact-match
 * lookup finds no released revision (`INV-0013-01`). It is never created by
 * hand: a request with no line behind it would be a drawing nobody ordered, and
 * fulfilling it would pin a revision to nothing.
 *
 * ### Why fulfilment writes a sales row under an engineering permission
 *
 * `fulfilDesignRequest` patches `customerOrderLines` — a sales table — while the
 * caller holds `engineering.request.assign`. That is the point of the step: the
 * line is `AWAITING_DESIGN` precisely because engineering owes it something, and
 * the moment engineering delivers, the line is ready. Requiring a sales
 * permission as well would mean an engineer cannot finish their own work without
 * a salesperson at their shoulder; requiring sales to do it would mean sales
 * choosing which revision a factory builds from.
 *
 * What the permission does *not* let an engineer do is decide what "delivered"
 * means. The revision must already be `RELEASED`, which took
 * `engineering.masterCard.release` and a second pair of eyes, and its design key
 * must equal the key the request was raised for — so fulfilment cannot quietly
 * substitute a different box for the one the customer ordered
 * (`INV-0013-02`).
 */
import { v } from "convex/values";

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
  pageRequestOf,
} from "../lib/listEnvelope";
import { mutationWithOrg, queryWithOrg } from "../lib/tenantFunctions";
import type { TenantOrgId } from "../lib/tenantDb";
import {
  boxSpecification,
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
import type { CustomerOrderLineState } from "../model/orderToShip/customerOrder";
import {
  checkDesignRequestFulfilment,
  isDesignRequestOverdue,
  planDesignRequestAssignment,
  planDesignRequestProgress,
  planSimilarDesignConfirmation,
  type DesignRequestState,
} from "../model/orderToShip/designRequest";
import {
  designSimilarityScore,
  type DesignSpecification,
} from "../model/orderToShip/designSpecification";

/* -------------------------------------------------------------------------- */
/* Operations                                                                  */
/* -------------------------------------------------------------------------- */

export const ENGINEERING_REQUEST_OPERATIONS = Object.freeze({
  assignRequest: "engineering.request.assign",
  progressRequest: "engineering.request.progress",
  fulfilRequest: "engineering.request.fulfil",
  confirmSimilar: "engineering.request.confirmSimilar",
});

/* -------------------------------------------------------------------------- */
/* Documents                                                                   */
/* -------------------------------------------------------------------------- */

interface RequestDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly requestNumber: string;
  readonly customerOrderLineId: string;
  readonly status: DesignRequestState["status"];
  readonly priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  readonly dueAt?: number;
  readonly assignedToUserId?: string;
  readonly masterCardRevisionId?: string;
}

interface LineDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly customerOrderId: string;
  readonly customerProductCode: string;
  readonly designKey: string;
  readonly status: CustomerOrderLineState["status"];
  readonly masterCardRevisionId?: string;
  readonly specification: DesignSpecification;
  readonly designSource: string;
}

interface OrderDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly customerId: string;
}

interface RevisionDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly status: string;
  readonly designKey: string;
  readonly masterCardId: string;
  readonly specification: DesignSpecification;
}

interface CardDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly customerProductCode: string;
  readonly customerId: string;
  readonly status?: string;
  readonly cardNumber?: string;
  readonly releasedRevisionId?: string;
}

/** Only enough of a membership to answer "is this person a member here". */
interface MembershipRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly userId: string;
  readonly status: string;
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Put a name against an open request, or take it off one.
 *
 * `ASSIGNED` and `OPEN` are distinct because "nobody has picked this up" and
 * "someone owes it" are different answers for a salesperson chasing a date.
 * Passing no `assignedToUserId` returns the request to the unclaimed queue.
 *
 * Refused once the request is `FULFILLED` or `CANCELLED`: assigning finished
 * work to somebody puts a task in their queue that has nothing left to do.
 */
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

    // Checked against `memberships`, not `users`. `users` is the cross-org
    // identity mirror and has no `orgId`, so "does this user exist" is not a
    // question this tenant is entitled to ask — a stranger's ID would answer
    // yes and leak that they exist somewhere. "Is this person an active member
    // here" is the question that actually matters, and it is tenant-scoped.
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

/** Advance assigned engineering work through visible execution/review states. */
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

/**
 * Close a request with a released revision, and pin the line to it.
 *
 * Four things are checked, and each rules out a different way of getting the
 * wrong box onto a factory floor:
 *
 * 1. The request is still open — a fulfilled request already has an answer.
 * 2. The revision is `RELEASED` — a draft describes a design nobody approved.
 * 3. The revision's design key equals the request's — otherwise this is a
 *    different box than the one the customer ordered, and nothing downstream
 *    would ever notice (`INV-0013-02`).
 * 4. The line is still `AWAITING_DESIGN` — re-pinning a ready line would
 *    silently change what a packet is about to be cut from, and a handed-off
 *    line has already been sent.
 */
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

    /*
     * The line and the request move together. A `FULFILLED` request whose line
     * is still `AWAITING_DESIGN` would be a drawing nobody can use and a queue
     * that says the work is done.
     */
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

/** Human-authorized reuse of a similar released design, with reason evidence. */
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

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

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
  similarityConfirmation: v.optional(
    v.object({
      score: v.number(),
      reason: v.string(),
      confirmedByUserId: v.id("users"),
      confirmedAt: v.number(),
    }),
  ),
});

/**
 * The engineering queue, in request-number order.
 *
 * `status` narrows through `by_orgId_status_requestNumber`, which is how the
 * screen shows only what is still owed without paging through years of
 * fulfilled requests to find it.
 */
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
      });
    }

    return {
      ok: true as const,
      items,
      nextCursor: page.isDone ? null : page.continueCursor,
      complete: page.isDone,
    };
  },
});

/** Bounded customer candidates ranked for a person; never an automatic match. */
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
    /*
     * Suggestions are deliberately the structurally identical design key under
     * a different customer product code. This indexed definition is complete:
     * it cannot lose the best candidate behind an arbitrary lexical or score
     * bucket, and it keeps the reactive read set to at most twenty cards.
     * Approximate geometry remains a human search concern, never an authority
     * the server silently widens.
     */
    const cards = await ctx.tenantDb
      .byIndex<CardDocument>("masterCards", "by_orgId_customerId_designKey", [
        { field: "customerId", value: order.customerId },
        { field: "designKey", value: line.designKey },
      ])
      .take(20);
    const candidates: Array<{
      masterCardId: never;
      masterCardRevisionId: never;
      cardNumber: string;
      customerProductCode: string;
      revisionNumber: number;
      score: number;
      specification: DesignSpecification;
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
        masterCardId: card._id as never,
        masterCardRevisionId: revision._id as never,
        cardNumber: card.cardNumber,
        customerProductCode: card.customerProductCode,
        revisionNumber: revision.revisionNumber,
        score,
        specification: revision.specification,
      });
    }
    return candidates
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.cardNumber.localeCompare(right.cardNumber),
      )
      .slice(0, 20) as never;
  },
});

/**
 * The released revisions an engineer may fulfil a request with.
 *
 * Narrowed to `RELEASED` at the index, not filtered after the fact: offering a
 * draft in a picker would be offering a choice `fulfilDesignRequest` refuses,
 * and a filtered page would return fewer rows than asked for and break the
 * caller's "am I done" test.
 */
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

    return {
      ok: true as const,
      items: page.page.map((revision) => ({
        masterCardRevisionId: revision._id as never,
        revisionNumber: revision.revisionNumber,
        designKey: revision.designKey,
        specification: { ...revision.specification } as never,
        status: revision.status as never,
      })),
      nextCursor: page.isDone ? null : page.continueCursor,
      complete: page.isDone,
    };
  },
});
