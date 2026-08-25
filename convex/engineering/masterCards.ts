import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import {
  summarizeDesignChange,
  type DesignChangeSummary,
} from "../model/orderToShip/designReadiness";
import {
  CODE_FIELD,
  appendDomainAudit,
  assertUnique,
  createMasterDataRow,
  insertedFields,
  normalizeDisplayName,
  normalizeField,
  replayTenantWriteIfPresent,
  updateMasterDataRow,
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
  type TenantPolicyContext,
} from "../lib/tenantFunctions";
import type { TenantDocumentAccess, TenantOrgId } from "../lib/tenantDb";
import {
  boxSpecification,
  masterCardRevisionStatus,
  masterDataStatus,
} from "../lib/validators";
import {
  refusal,
  writeContextOf,
  writeOutcomeValidator,
  written,
} from "../lib/writeEnvelope";
import {
  designKeyOf,
  makeDesignSpecification,
  missingReleaseFields,
  normalizeCustomerProductCode,
  type DesignSpecification,
} from "../model/orderToShip/designSpecification";
import {
  checkRevisionSubmission,
  nextRevisionNumber,
} from "../model/orderToShip/masterCardRevision";
import { planMasterCardDecision } from "../model/orderToShip/masterCardRelease";
import { MAX_FILES_PER_REVISION } from "../model/orderToShip/masterCardFile";

export const ENGINEERING_CARD_OPERATIONS = Object.freeze({
  createCard: "engineering.masterCard.create",
  draftRevision: "engineering.masterCard.draftRevision",
  submitRevision: "engineering.masterCard.submitRevision",
  decideRevision: "engineering.masterCard.decideRevision",
});

type CardDocument = Doc<"masterCards">;
type RevisionDocument = Doc<"masterCardRevisions">;

interface ProductionOrderDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly productionOrderNumber: string;
  readonly warehouseId: string;
  readonly status: string;
}

const cardNumberUniqueness = (
  cardNumber: string,
): readonly UniquenessCheck[] => [
  {
    field: "cardNumber",
    index: "by_orgId_cardNumber",
    equality: [{ field: "cardNumber", value: cardNumber }],
  },
];

const customerProductUniqueness = (
  customerId: string,
  customerProductCode: string,
): readonly UniquenessCheck[] => [
  {
    field: "customerProductCode",
    index: "by_orgId_customerId_customerProductCode",
    equality: [
      { field: "customerId", value: customerId },
      { field: "customerProductCode", value: customerProductCode },
    ],
  },
];

const revisionUniqueness = (
  masterCardId: string,
  revisionNumber: number,
): readonly UniquenessCheck[] => [
  {
    field: "revisionNumber",
    index: "by_orgId_masterCardId_revisionNumber",
    equality: [
      { field: "masterCardId", value: masterCardId },
      { field: "revisionNumber", value: revisionNumber },
    ],
  },
];

export const MAX_DECISION_NOTE = 500;

const MAX_REVISIONS_SCANNED = 100;

export const createMasterCard = mutationWithOrg({
  args: {
    requestId: v.string(),
    cardNumber: v.string(),
    customerId: v.id("customers"),
    customerProductCode: v.string(),
    name: v.string(),
    specification: boxSpecification,
  },
  returns: writeOutcomeValidator,
  permissionCode: "engineering.masterCard.draft",
  target: { table: "masterCards" },
  handler: async (ctx, args) => {
    const cardNumber = normalizeField(
      "cardNumber",
      args.cardNumber,
      CODE_FIELD,
    );
    if (!cardNumber.ok) return refusal(cardNumber.error);
    const name = normalizeDisplayName("name", args.name);
    if (!name.ok) return refusal(name.error);
    const customerProductCode = normalizeCustomerProductCode(
      args.customerProductCode,
    );
    if (!customerProductCode.ok) return refusal(customerProductCode.error);

    const specification = makeDesignSpecification({
      ...args.specification,
      ...(args.specification.calculations === undefined
        ? {}
        : {
            calculations: args.specification.calculations.map((row) => ({
              ...row,
              verifiedByUserId: ctx.tenant.actor._id,
              verifiedAt: Date.now(),
            })),
          }),
    });
    if (!specification.ok) return refusal(specification.error);

    const customer = await ctx.tenantDb.get("customers", args.customerId);
    if (customer === null) {
      return refusal({ code: "REFERENCE_NOT_FOUND", field: "customerId" });
    }

    const designKey = designKeyOf(specification.value);
    const context = writeContextOf(ctx, {
      table: "masterCards",
      operation: ENGINEERING_CARD_OPERATIONS.createCard,
      requestId: args.requestId,
    });

    const outcome = await createMasterDataRow({
      ...context,
      fingerprint: {
        operation: ENGINEERING_CARD_OPERATIONS.createCard,
        requestId: args.requestId,
        cardNumber: cardNumber.value,
        customerId: args.customerId,
        customerProductCode: customerProductCode.value,
        name: name.value,
        specification: args.specification,
        designKey,
      },
      uniqueness: [
        ...cardNumberUniqueness(cardNumber.value),
        ...customerProductUniqueness(
          args.customerId,
          customerProductCode.value,
        ),
      ],
      document: {
        cardNumber: cardNumber.value,
        customerId: args.customerId,
        customerProductCode: customerProductCode.value,
        designKey,
        name: name.value,
        status: "ACTIVE",
      },
    });

    if (!outcome.ok) return refusal(outcome.error);

    if (!outcome.value.replayed) {
      await insertRevision(ctx.tenantDb, context, {
        masterCardId: outcome.value.documentId,
        revisionNumber: 1,
        designKey,
        specification: specification.value,
        authoredByUserId: context.actorUserId,
      });
    }

    return written(outcome.value);
  },
});

export const draftMasterCardRevision = mutationWithOrg({
  args: {
    requestId: v.string(),
    masterCardId: v.id("masterCards"),
    specification: boxSpecification,
  },
  returns: writeOutcomeValidator,
  permissionCode: "engineering.masterCard.draft",
  target: { table: "masterCards", id: ({ masterCardId }) => masterCardId },
  handler: async (ctx, args) => {
    const card = await ctx.tenantDb.get<CardDocument>(
      "masterCards",
      args.masterCardId,
    );
    if (card === null) {
      return refusal({ code: "NOT_FOUND", table: "masterCards" });
    }

    const specification = makeDesignSpecification({
      ...args.specification,
      ...(args.specification.calculations === undefined
        ? {}
        : {
            calculations: args.specification.calculations.map((row) => ({
              ...row,
              verifiedByUserId: ctx.tenant.actor._id,
              verifiedAt: Date.now(),
            })),
          }),
    });
    if (!specification.ok) return refusal(specification.error);
    const designKey = designKeyOf(specification.value);
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "masterCardRevisions",
      operation: ENGINEERING_CARD_OPERATIONS.draftRevision,
      requestId: args.requestId,
      fingerprint: {
        operation: ENGINEERING_CARD_OPERATIONS.draftRevision,
        requestId: args.requestId,
        masterCardId: args.masterCardId,
        specification: args.specification,
        designKey,
      },
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);

    const open = await openRevisionOf(ctx.tenantDb, args.masterCardId);
    if (open !== null) {
      return refusal({
        code: "ILLEGAL_TRANSITION",
        field: "status",
        reason: "REVISION_ALREADY_OPEN",
        status: open.status,
      });
    }

    const highest = await ctx.tenantDb
      .byIndex<RevisionDocument>(
        "masterCardRevisions",
        "by_orgId_masterCardId_revisionNumber",
        [{ field: "masterCardId", value: args.masterCardId }],
      )
      .take(MAX_REVISIONS_SCANNED);

    if (highest.length >= MAX_REVISIONS_SCANNED) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "revisionNumber",
        reason: "HISTORY_TOO_LONG_TO_NUMBER",
      });
    }

    const next = nextRevisionNumber(
      highest.reduce<number | undefined>(
        (top, revision) =>
          top === undefined || revision.revisionNumber > top
            ? revision.revisionNumber
            : top,
        undefined,
      ),
    );
    if (!next.ok) return refusal(next.error);

    const context = writeContextOf(ctx, {
      table: "masterCardRevisions",
      operation: ENGINEERING_CARD_OPERATIONS.draftRevision,
      requestId: args.requestId,
    });

    const outcome = await createMasterDataRow({
      ...context,
      fingerprint: {
        operation: ENGINEERING_CARD_OPERATIONS.draftRevision,
        requestId: args.requestId,
        masterCardId: args.masterCardId,
        specification: args.specification,
        designKey,
      },
      uniqueness: revisionUniqueness(args.masterCardId, next.value),
      document: {
        masterCardId: args.masterCardId,
        revisionNumber: next.value,
        status: "DRAFT",
        specification: { ...specification.value },
        designKey,
        authoredByUserId: context.actorUserId,
      },
    });

    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});

export const submitMasterCardRevision = mutationWithOrg({
  args: {
    requestId: v.string(),
    masterCardRevisionId: v.id("masterCardRevisions"),
  },
  returns: writeOutcomeValidator,
  permissionCode: "engineering.masterCard.submit",
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

    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "masterCardRevisions",
      operation: ENGINEERING_CARD_OPERATIONS.submitRevision,
      requestId: args.requestId,
      fingerprint: {
        operation: ENGINEERING_CARD_OPERATIONS.submitRevision,
        requestId: args.requestId,
        masterCardRevisionId: args.masterCardRevisionId,
      },
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);

    const files = await ctx.tenantDb
      .byIndex<{
        readonly _id: string;
        readonly orgId: TenantOrgId;
        readonly storageState: string;
        readonly storageId?: string;
        readonly uploadThingKey?: string;
        readonly verifiedAt?: number;
      }>("masterCardFiles", "by_orgId_masterCardRevisionId_fileKey", [
        {
          field: "masterCardRevisionId",
          value: args.masterCardRevisionId,
        },
      ])
      .take(MAX_FILES_PER_REVISION + 1);
    if (files.length > MAX_FILES_PER_REVISION) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "masterCardRevisionId",
        reason: "FILE_LIMIT_EXCEEDED",
      });
    }

    const available = await ctx.tenantDb
      .byIndex<{
        readonly _id: string;
        readonly orgId: TenantOrgId;
        readonly storageState: string;
        readonly storageId?: string;
        readonly uploadThingKey?: string;
        readonly verifiedAt?: number;
      }>("masterCardFiles", "by_orgId_masterCardRevisionId_storageState", [
        {
          field: "masterCardRevisionId",
          value: args.masterCardRevisionId,
        },
        { field: "storageState", value: "AVAILABLE" },
      ])
      .take(MAX_FILES_PER_REVISION + 1);

    let retrievableFileCount = 0;
    for (const file of available) {
      const uploadThingVerified =
        file.uploadThingKey !== undefined && file.verifiedAt !== undefined;
      if (
        !uploadThingVerified &&
        (file.storageId === undefined ||
          (await ctx.privateFiles.inspect(file.storageId)) === null)
      ) {
        return refusal({
          code: "PRECONDITION_FAILED",
          field: "storageId",
          reason: "FILE_NOT_RETRIEVABLE",
        });
      }
      retrievableFileCount += 1;
    }

    const submission = checkRevisionSubmission(revision, {
      attachedFileCount: files.length,
      availableFileCount: retrievableFileCount,
      missingSpecificationFields: missingReleaseFields(revision.specification),
    });
    if (!submission.ok) return refusal(submission.error);

    const context = writeContextOf(ctx, {
      table: "masterCardRevisions",
      operation: ENGINEERING_CARD_OPERATIONS.submitRevision,
      requestId: args.requestId,
    });

    const outcome = await updateMasterDataRow({
      ...context,
      documentId: args.masterCardRevisionId,
      fingerprint: {
        operation: ENGINEERING_CARD_OPERATIONS.submitRevision,
        requestId: args.requestId,
        masterCardRevisionId: args.masterCardRevisionId,
      },
      uniqueness: [],
      patch: {
        status: submission.value,
        submittedByUserId: context.actorUserId,
      },
    });

    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});

export const decideMasterCardRevision = mutationWithOrg({
  args: {
    requestId: v.string(),
    masterCardRevisionId: v.id("masterCardRevisions"),
    decision: v.union(v.literal("APPROVE"), v.literal("REJECT")),
    note: v.optional(v.string()),
  },
  returns: writeOutcomeValidator,
  permissionCode: "engineering.masterCard.release",
  target: {
    table: "masterCardRevisions",
    id: ({ masterCardRevisionId }) => masterCardRevisionId,
  },
  policy: revisionMakerPolicy,
  handler: async (ctx, args) => {
    const revision = await ctx.tenantDb.get<RevisionDocument>(
      "masterCardRevisions",
      args.masterCardRevisionId,
    );
    if (revision === null) {
      return refusal({ code: "NOT_FOUND", table: "masterCardRevisions" });
    }

    let note: string | undefined;
    if (args.note !== undefined) {
      const trimmed = args.note.trim();
      if (trimmed.length > MAX_DECISION_NOTE) {
        return refusal({
          code: "FIELD_INVALID",
          field: "decisionNote",
          reason: "TOO_LONG",
        });
      }
      if (trimmed.length > 0) note = trimmed;
    }

    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "masterCardRevisions",
      operation: ENGINEERING_CARD_OPERATIONS.decideRevision,
      requestId: args.requestId,
      fingerprint: {
        operation: ENGINEERING_CARD_OPERATIONS.decideRevision,
        requestId: args.requestId,
        masterCardRevisionId: args.masterCardRevisionId,
        decision: args.decision,
        note: note ?? null,
      },
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);

    const card = await ctx.tenantDb.get<CardDocument>(
      "masterCards",
      revision.masterCardId,
    );
    if (card === null) {
      return refusal({ code: "REFERENCE_NOT_FOUND", field: "masterCardId" });
    }
    const context = writeContextOf(ctx, {
      table: "masterCardRevisions",
      operation: ENGINEERING_CARD_OPERATIONS.decideRevision,
      requestId: args.requestId,
    });

    const previous =
      card.releasedRevisionId === undefined
        ? null
        : await ctx.tenantDb.get<RevisionDocument>(
            "masterCardRevisions",
            card.releasedRevisionId,
          );

    let changeSummary: DesignChangeSummary | undefined;
    let pinnedOrders: readonly ProductionOrderDocument[] = [];
    if (args.decision === "APPROVE" && previous !== null) {
      changeSummary = summarizeDesignChange(
        previous.specification,
        revision.specification,
      );
      const candidates = await ctx.tenantDb
        .byIndex<ProductionOrderDocument>(
          "productionOrders",
          "by_orgId_masterCardRevisionId_dueAt",
          [{ field: "masterCardRevisionId", value: previous._id }],
        )
        .take(100);
      if (candidates.length > 99) {
        return refusal({
          code: "PRECONDITION_FAILED",
          field: "masterCardRevisionId",
          reason: "CHANGE_IMPACT_SET_TOO_LARGE",
        });
      }
      pinnedOrders = candidates.filter(
        (order) =>
          order.status !== "COMPLETE" &&
          order.status !== "CANCELLED" &&
          order.status !== "CLOSED_REJECTED",
      );
    }

    const plan = planMasterCardDecision({
      revision: {
        ...revision,
        revisionId: revision._id,
      },
      card,
      ...(previous === null
        ? {}
        : {
            previousRevision: {
              ...previous,
              revisionId: previous._id,
            },
          }),
      deciderUserId: ctx.tenant.actor._id,
      decision: args.decision,
      decidedAt: context.now,
      ...(note === undefined ? {} : { note }),
    });
    if (!plan.ok) return refusal(plan.error);

    if (plan.value.uniqueCustomerProduct !== undefined) {
      const unique = await assertUnique(
        ctx.tenantDb,
        "masterCards",
        customerProductUniqueness(
          plan.value.uniqueCustomerProduct.customerId,
          plan.value.uniqueCustomerProduct.customerProductCode,
        ),
        card._id,
      );
      if (!unique.ok) return refusal(unique.error);
    }

    const outcome = await updateMasterDataRow({
      ...context,
      documentId: args.masterCardRevisionId,
      fingerprint: {
        operation: ENGINEERING_CARD_OPERATIONS.decideRevision,
        requestId: args.requestId,
        masterCardRevisionId: args.masterCardRevisionId,
        decision: args.decision,
        note: note ?? null,
      },
      uniqueness: [],
      patch: plan.value.revisionPatch,
    });

    if (!outcome.ok) return refusal(outcome.error);

    if (!outcome.value.replayed && plan.value.cardPatch !== undefined) {
      if (previous !== null && plan.value.previousRevisionPatch !== undefined) {
        await ctx.tenantDb.patch("masterCardRevisions", previous._id, {
          ...plan.value.previousRevisionPatch,
        });
        await appendDomainAudit(context, {
          entityTable: "masterCardRevisions",
          entityId: previous._id,
          changes: [
            {
              field: "supersededByRevisionId",
              to: args.masterCardRevisionId,
            },
          ],
        });
      }

      await ctx.tenantDb.patch("masterCards", card._id, {
        ...plan.value.cardPatch,
      });
      await appendDomainAudit(context, {
        entityTable: "masterCards",
        entityId: card._id,
        changes: [
          {
            field: "releasedRevisionId",
            ...(card.releasedRevisionId === undefined
              ? {}
              : { from: card.releasedRevisionId }),
            to: args.masterCardRevisionId,
          },
          {
            field: "designKey",
            from: card.designKey,
            to: revision.designKey,
          },
        ],
      });

      if (previous !== null && changeSummary !== undefined) {
        for (const order of pinnedOrders) {
          const document = {
            warehouseId: order.warehouseId,
            masterCardId: card._id,
            fromRevisionId: previous._id,
            toRevisionId: args.masterCardRevisionId,
            productionOrderId: order._id,
            productionOrderNumber: order.productionOrderNumber,
            productionOrderStatus: order.status,
            severity: changeSummary.severity,
            changedFields: [...changeSummary.changedFields],
            categories: [...changeSummary.categories],
            status: "OPEN",
            createdByUserId: context.actorUserId,
            createdAt: context.now,
          };
          const impactId = await ctx.tenantDb.insert(
            "designChangeImpacts",
            document,
          );
          await appendDomainAudit(context, {
            entityTable: "designChangeImpacts",
            entityId: impactId,
            changes: insertedFields(document),
          });
        }
      }
    }

    return written(outcome.value);
  },
});

async function revisionMakerPolicy(
  ctx: TenantPolicyContext,
  args: { readonly masterCardRevisionId: string },
): Promise<{
  readonly thresholdExceeded: boolean;
  readonly approvalSatisfied: boolean;
  readonly makerUserId?: string;
}> {
  const revision = await ctx.tenantDb.get<RevisionDocument>(
    "masterCardRevisions",
    args.masterCardRevisionId,
  );
  const maker = revision?.submittedByUserId ?? revision?.authoredByUserId;

  if (maker === undefined) {
    return Object.freeze({
      thresholdExceeded: false,
      approvalSatisfied: false,
    });
  }
  return Object.freeze({
    thresholdExceeded: false,
    approvalSatisfied: true,
    makerUserId: maker,
  });
}

async function openRevisionOf(
  tenantDb: TenantDocumentAccess,
  masterCardId: string,
): Promise<RevisionDocument | null> {
  for (const status of ["DRAFT", "IN_REVIEW"] as const) {
    const found = await tenantDb
      .byIndex<RevisionDocument>(
        "masterCardRevisions",
        "by_orgId_masterCardId_status",
        [
          { field: "masterCardId", value: masterCardId },
          { field: "status", value: status },
        ],
      )
      .first();
    if (found !== null) return found;
  }
  return null;
}

async function insertRevision(
  tenantDb: TenantDocumentAccess,
  context: Parameters<typeof appendDomainAudit>[0],
  input: {
    readonly masterCardId: string;
    readonly revisionNumber: number;
    readonly designKey: string;
    readonly specification: DesignSpecification;
    readonly authoredByUserId: string;
  },
): Promise<string> {
  const document = {
    masterCardId: input.masterCardId,
    revisionNumber: input.revisionNumber,
    status: "DRAFT",
    specification: { ...input.specification },
    designKey: input.designKey,
    authoredByUserId: input.authoredByUserId,
  };
  const revisionId = await tenantDb.insert("masterCardRevisions", document);
  await appendDomainAudit(context, {
    entityTable: "masterCardRevisions",
    entityId: revisionId,
    changes: insertedFields(document),
  });
  return revisionId;
}

const cardValidator = v.object({
  masterCardId: v.id("masterCards"),
  cardNumber: v.string(),
  customerId: v.id("customers"),
  customerProductCode: v.string(),
  designKey: v.string(),
  name: v.string(),
  status: masterDataStatus,
  releasedRevisionId: v.optional(v.id("masterCardRevisions")),
});

const revisionValidator = v.object({
  masterCardRevisionId: v.id("masterCardRevisions"),
  masterCardId: v.id("masterCards"),
  revisionNumber: v.number(),
  status: masterCardRevisionStatus,
  specification: boxSpecification,
  designKey: v.string(),
  authoredByUserId: v.id("users"),
  submittedByUserId: v.optional(v.id("users")),
  decidedByUserId: v.optional(v.id("users")),
  decidedAt: v.optional(v.number()),
  decisionNote: v.optional(v.string()),
  supersededByRevisionId: v.optional(v.id("masterCardRevisions")),
});

export const listMasterCards = queryWithOrg({
  args: { status: v.optional(masterDataStatus), ...listArgs },
  returns: pageOf(cardValidator),
  permissionCode: "engineering.masterCard.read",
  target: { table: "masterCards" },
  handler: async (ctx, args) => {
    const request = pageRequestOf(args);
    if (!request.ok) return pageRefusal(request.error.code);

    const page = await ctx.tenantDb
      .byIndex<CardDocument>(
        "masterCards",
        args.status === undefined
          ? "by_orgId_cardNumber"
          : "by_orgId_status_cardNumber",
        args.status === undefined
          ? []
          : [{ field: "status", value: args.status }],
      )
      .page(pageOptions(request.value));

    return pageResult(
      page.page.map((card) => ({
        masterCardId: card._id as never,
        cardNumber: card.cardNumber,
        customerId: card.customerId as never,
        customerProductCode: card.customerProductCode,
        designKey: card.designKey,
        name: card.name,
        status: card.status as never,
        ...(card.releasedRevisionId === undefined
          ? {}
          : { releasedRevisionId: card.releasedRevisionId as never }),
      })),
      page,
    );
  },
});

export const listMasterCardRevisions = queryWithOrg({
  args: {
    masterCardId: v.id("masterCards"),
    status: v.optional(masterCardRevisionStatus),
    ...listArgs,
  },
  returns: pageOf(revisionValidator),
  permissionCode: "engineering.masterCard.read",
  target: { table: "masterCards", id: ({ masterCardId }) => masterCardId },
  handler: async (ctx, args) => {
    const request = pageRequestOf(args);
    if (!request.ok) return pageRefusal(request.error.code);

    const card = await ctx.tenantDb.get("masterCards", args.masterCardId);
    if (card === null) return pageRefusal("REFERENCE_NOT_FOUND");

    const page = await ctx.tenantDb
      .byIndex<RevisionDocument>(
        "masterCardRevisions",
        args.status === undefined
          ? "by_orgId_masterCardId_revisionNumber"
          : "by_orgId_masterCardId_status",
        [
          { field: "masterCardId", value: args.masterCardId },
          ...(args.status === undefined
            ? []
            : [{ field: "status", value: args.status }]),
        ],
      )
      .page(pageOptions(request.value));

    return pageResult(
      page.page.map((revision) => ({
        masterCardRevisionId: revision._id as never,
        masterCardId: revision.masterCardId as never,
        revisionNumber: revision.revisionNumber,
        status: revision.status as never,
        specification: { ...revision.specification },
        designKey: revision.designKey,
        authoredByUserId: revision.authoredByUserId as never,
        ...(revision.submittedByUserId === undefined
          ? {}
          : { submittedByUserId: revision.submittedByUserId as never }),
        ...(revision.decidedByUserId === undefined
          ? {}
          : { decidedByUserId: revision.decidedByUserId as never }),
        ...(revision.decidedAt === undefined
          ? {}
          : { decidedAt: revision.decidedAt }),
        ...(revision.decisionNote === undefined
          ? {}
          : { decisionNote: revision.decisionNote }),
        ...(revision.supersededByRevisionId === undefined
          ? {}
          : {
              supersededByRevisionId: revision.supersededByRevisionId as never,
            }),
      })),
      page,
    );
  },
});
