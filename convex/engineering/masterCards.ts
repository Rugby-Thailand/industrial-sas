/**
 * Master cards and their revisions — the design authority.
 *
 * Status: **implemented** (Phase 5A).
 *
 * A master card is the stable name of a design; a revision is one version of it.
 * Everything downstream — a factory packet, a line's `DESIGN_READY` status, the
 * exact-match lookup a salesperson triggers — points at a *revision*, never at a
 * card, because the card holds no specification of its own to point at
 * (`ADR-0013`).
 *
 * ### Why a released revision is immutable
 *
 * A factory packet pins one exact revision (`INV-0013-04`) and gets printed. If
 * that revision could be edited afterwards, the paper on the shop floor and the
 * record in the system would describe different boxes, and there would be no way
 * to tell which one the operator built from. So `checkRevisionEdit` refuses
 * every edit to a `RELEASED` revision with `RELEASED_IS_IMMUTABLE`, and the only
 * patch this module ever applies to one is `supersededByRevisionId` — a pointer
 * to the newer revision that changes nothing about what the old one claimed.
 *
 * The way to change a released design is a new revision with its own number.
 * Numbers are never reused, including after a rejection: "rev 3" names one
 * document forever, including on paper.
 *
 * ### Why the author cannot approve their own revision, twice over
 *
 * `engineering.masterCard.release` carries `MAKER_CHECKER`, so the authorization
 * evaluator denies when the maker and the actor are the same person
 * (`INV-0006-05`). Independently, `checkRevisionDecision` refuses when the
 * decider is the author *or* the submitter (`INV-0013-03`). Two checks, because
 * they fail differently: the evaluator's is a permission denial recorded in the
 * authorization trail, the kernel's is a domain refusal that names which field —
 * `authoredByUserId` or `submittedByUserId` — made the actor the wrong person.
 * Neither is a substitute for the other.
 *
 * ### Why `ENGINEERING_APPROVER` cannot draft
 *
 * The default role that holds `engineering.masterCard.release` holds neither
 * `draft` nor `submit`. A checker who can become a maker is not a checker; they
 * are one person with two hats and a queue of their own work to sign off.
 */
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
  updateMasterDataRow,
  type UniquenessCheck,
} from "../lib/masterDataStore";
import {
  listArgs,
  pageOf,
  pageOptions,
  pageRefusal,
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
  type MasterCardRevisionState,
} from "../model/orderToShip/masterCardRevision";
import { planMasterCardDecision } from "../model/orderToShip/masterCardRelease";
import { MAX_FILES_PER_REVISION } from "../model/orderToShip/masterCardFile";

/* -------------------------------------------------------------------------- */
/* Operations                                                                  */
/* -------------------------------------------------------------------------- */

export const ENGINEERING_CARD_OPERATIONS = Object.freeze({
  createCard: "engineering.masterCard.create",
  draftRevision: "engineering.masterCard.draftRevision",
  submitRevision: "engineering.masterCard.submitRevision",
  decideRevision: "engineering.masterCard.decideRevision",
});

/* -------------------------------------------------------------------------- */
/* Documents                                                                   */
/* -------------------------------------------------------------------------- */

interface CardDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly cardNumber: string;
  readonly customerId: string;
  readonly customerProductCode: string;
  readonly designKey: string;
  readonly name: string;
  readonly status: string;
  readonly releasedRevisionId?: string;
}

interface RevisionDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly masterCardId: string;
  readonly revisionNumber: number;
  readonly status: MasterCardRevisionState["status"];
  readonly designKey: string;
  readonly authoredByUserId: string;
  readonly submittedByUserId?: string;
  readonly decidedByUserId?: string;
  readonly decidedAt?: number;
  readonly decisionNote?: string;
  readonly supersededByRevisionId?: string;
  readonly specification: {
    readonly styleCode: string;
    readonly internalLengthMm: number;
    readonly internalWidthMm: number;
    readonly internalHeightMm: number;
    readonly boardGrade: string;
    readonly printColourCount: number;
  };
}

/** `(orgId, cardNumber)`: a card number is unique per organization. */
const cardNumberUniqueness = (
  cardNumber: string,
): readonly UniquenessCheck[] => [
  {
    field: "cardNumber",
    index: "by_orgId_cardNumber",
    equality: [{ field: "cardNumber", value: cardNumber }],
  },
];

/**
 * `(orgId, customerId, customerProductCode)`: the customer's exact identity.
 *
 * Structural similarity is deliberately allowed across different customer
 * product codes. It may be suggested to a person, but can never choose a card
 * automatically.
 */
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

/** `(orgId, masterCardId, revisionNumber)`: revision numbers do not repeat. */
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

/** The longest reviewer note this repository will store. */
export const MAX_DECISION_NOTE = 500;

/**
 * The most revisions of one card this module will read to find the highest
 * number.
 *
 * The revision-number index reads forward from 1, so finding the top means
 * reading the history — and a read whose size is a property of the card rather
 * than of the request is exactly what `INV-0002-05` forbids. The cap is a bound,
 * and hitting it is a **refusal**, not a truncation: guessing a revision number
 * from a partial history would hand a new document a number an old one already
 * has, and "rev 3" would stop naming one thing. `MAX_REVISION_NUMBER` is 9 999
 * and a real card has single digits, so no card reaches this.
 */
const MAX_REVISIONS_SCANNED = 100;

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Open a master card with its first draft revision.
 *
 * The card and revision 1 are written together because a card with no revision
 * describes nothing: it has no specification of its own, so it would be a name
 * with no design behind it occupying the customer-product identity slot.
 *
 * `designKey` on the card starts as the *drafted* key and is repointed when a
 * revision is released. This remains an advisory structural fingerprint; the
 * customer-product uniqueness check above prevents competing draft authorities.
 */
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

/**
 * Draft the next revision of an existing card.
 *
 * Refused while another revision of the same card is still open — `DRAFT` or
 * `IN_REVIEW`. Two open revisions of one card is two answers to "what are we
 * about to release", and the reviewer of the first would be deciding about a
 * design that a second draft has already moved past.
 */
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

    /*
     * The highest existing number, from the last row of the number index rather
     * than a count: numbers are never reused after a rejection, so a count would
     * hand a rejected revision's number to a new document.
     */
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

/**
 * Put a draft revision up for review.
 *
 * Requires at least one attached file. A revision with no dieline and no artwork
 * is nothing to review, and approving one would produce a `RELEASED` revision a
 * factory packet could pin and a factory could not build from
 * (`INV-0013-05`).
 */
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

    /*
     * `take(1)` and not a count: the kernel asks whether *any* file is attached,
     * and reading the whole set to answer a boolean would read a revision's
     * entire file list on every submission.
     */
    const files = await ctx.tenantDb
      .byIndex<{
        readonly _id: string;
        readonly orgId: TenantOrgId;
        readonly storageState: string;
        readonly storageId?: string;
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
      if (
        file.storageId === undefined ||
        (await ctx.privateFiles.inspect(file.storageId)) === null
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

/**
 * Approve or reject a revision under review.
 *
 * Approval is the moment a design becomes buildable, and it does three things at
 * once, in one transaction: the revision becomes `RELEASED`, the card's
 * `releasedRevisionId` and `designKey` repoint to it, and the revision it
 * replaces receives only a `supersededByRevisionId` pointer. Splitting them across mutations would leave a
 * window where a card points at a revision that is not released, or two
 * revisions of one card both claim to be current.
 *
 * Rejection writes only the revision: nothing downstream ever pointed at it.
 */
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

    /*
     * The revision being replaced is read *before* the write, so an approval
     * that cannot legally supersede the current release — a stale draft whose
     * number is lower — is refused rather than half-applied.
     */
    const previous =
      card.releasedRevisionId === undefined
        ? null
        : await ctx.tenantDb.get<RevisionDocument>(
            "masterCardRevisions",
            card.releasedRevisionId,
          );

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
    }

    return written(outcome.value);
  },
});

/* -------------------------------------------------------------------------- */
/* Policy                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Who made this revision, read from the revision itself.
 *
 * The submitter when there is one, the author otherwise: submitting work for
 * review is an endorsement of it, so the submitter is the maker the evaluator
 * must keep away from the decision. `checkRevisionDecision` independently
 * refuses both people, so this fact being the submitter does not let the author
 * through.
 */
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

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

/** The card's open revision, if one exists. `DRAFT` and `IN_REVIEW` both count. */
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

/** Insert revision 1 alongside a freshly created card, and audit it. */
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

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

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

/** Cards, in card-number order. */
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

    return {
      ok: true as const,
      items: page.page.map((card) => ({
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
      nextCursor: page.isDone ? null : page.continueCursor,
      complete: page.isDone,
    };
  },
});

/** The revision history of one card, oldest number first. */
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

    return {
      ok: true as const,
      items: page.page.map((revision) => ({
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
      nextCursor: page.isDone ? null : page.continueCursor,
      complete: page.isDone,
    };
  },
});
