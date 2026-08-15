/**
 * The master-card revision lifecycle: draft, review, release, and the
 * immutability that makes a released revision worth pinning.
 *
 * Status: **implemented.** Pure; no clock, no database, no Convex import
 * (plan §6.2).
 *
 * ### Why released revisions are frozen rather than edited
 *
 * A factory packet pins one exact revision and carries its specification as a
 * snapshot. That pin is only worth anything if the thing pinned cannot change:
 * if a released revision could be edited, a packet printed on Monday and the
 * same packet reprinted on Friday would describe two different boxes, and
 * nobody on the shop floor would know which one they were holding. So a released
 * revision is never edited. A change means a *new* revision, reviewed and
 * released on its own merits, and the old one becomes `SUPERSEDED` — still
 * readable, still exactly what the packets that pinned it describe.
 *
 * ### Why the author cannot approve their own revision
 *
 * The review exists to catch what the author could not see. An author who can
 * approve their own work turns the review into a formality and the audit trail
 * into a record of one person agreeing with themselves. This module refuses the
 * self-approval outright; the permission catalogue independently flags
 * `engineering.masterCard.release` as `MAKER_CHECKER` so the boundary refuses it
 * too. Two checks, because the consequence — an unreviewed spec reaching a
 * converting machine — is expensive and physical.
 *
 * ### Why a revision cannot go to review with no files
 *
 * "Reviewed" has to mean somebody looked at a dieline. A revision with no
 * attachments offers a reviewer six numbers and asks them to approve a box;
 * approving it would be a signature on nothing.
 */
import { fail, ok, type Result } from "../result";

/* -------------------------------------------------------------------------- */
/* Statuses                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * `DRAFT` — engineering is still working; editable, invisible to production.
 * `IN_REVIEW` — submitted; frozen while somebody else decides.
 * `RELEASED` — approved; immutable and the only status a packet may pin.
 * `REJECTED` — terminal. The way forward is a new revision, not a reopened one.
 * `SUPERSEDED` — was released, a later revision has since been released.
 */
export type MasterCardRevisionStatus =
  "DRAFT" | "IN_REVIEW" | "RELEASED" | "REJECTED" | "SUPERSEDED";

export const MASTER_CARD_REVISION_STATUSES: readonly MasterCardRevisionStatus[] =
  Object.freeze([
    "DRAFT",
    "IN_REVIEW",
    "RELEASED",
    "REJECTED",
    "SUPERSEDED",
  ] as const);

/**
 * Whether production may see this revision at all.
 *
 * The one place the rule is written. Every production-facing read filters on
 * `RELEASED`, and a second definition of "visible" would be a second thing to
 * keep in step.
 */
export const isProductionVisible = (
  status: MasterCardRevisionStatus,
): boolean => status === "RELEASED";

/**
 * Whether a revision's contents may still change.
 *
 * `DRAFT` only. `IN_REVIEW` is excluded on purpose: a reviewer must decide about
 * the document they were shown, not a document that moved while they read it.
 */
export const isEditable = (status: MasterCardRevisionStatus): boolean =>
  status === "DRAFT";

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

export type MasterCardRevisionError =
  | {
      readonly code: "ILLEGAL_TRANSITION";
      readonly field: string;
      readonly reason: string;
      readonly status: string;
    }
  | {
      readonly code: "PRECONDITION_FAILED";
      readonly field: string;
      readonly reason: string;
    }
  /**
   * The actor is the wrong person for this step, not the wrong role. Named
   * separately so the boundary can answer "you may not approve your own work"
   * rather than the misleading "you lack permission".
   */
  | {
      readonly code: "SEPARATION_OF_DUTIES";
      readonly field: string;
      readonly reason: string;
    };

/* -------------------------------------------------------------------------- */
/* State                                                                       */
/* -------------------------------------------------------------------------- */

/** What this module needs to know about a revision. */
export interface MasterCardRevisionState {
  readonly status: MasterCardRevisionStatus;
  readonly authoredByUserId: string;
  readonly submittedByUserId?: string | undefined;
}

/** The decision a reviewer records. */
export type RevisionDecision = "APPROVE" | "REJECT";

/* -------------------------------------------------------------------------- */
/* Numbering                                                                   */
/* -------------------------------------------------------------------------- */

/** The most revisions one master card may carry. */
export const MAX_REVISION_NUMBER = 9_999;

/**
 * The number the next revision of a card takes.
 *
 * Monotonic and gap-free from 1. Numbers are never reused, including after a
 * rejection: revision 3 having been rejected is part of the card's history, and
 * a second, different revision 3 would make every reference to "rev 3" ambiguous
 * — including references written on paper on a factory floor.
 */
export function nextRevisionNumber(
  highestExisting: number | undefined,
): Result<number, MasterCardRevisionError> {
  const next = (highestExisting ?? 0) + 1;
  if (next > MAX_REVISION_NUMBER) {
    return fail({
      code: "PRECONDITION_FAILED",
      field: "revisionNumber",
      reason: "TOO_MANY_REVISIONS",
    });
  }
  return ok(next);
}

/* -------------------------------------------------------------------------- */
/* Transitions                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Whether a file may be attached to a revision.
 *
 * Draft only, for the same reason the specification is draft-only: the reviewer
 * decides about a fixed set of artwork, and a released revision whose file list
 * can grow is a released revision that can change.
 */
export function checkFileAttachment(
  revision: MasterCardRevisionState,
): Result<true, MasterCardRevisionError> {
  if (!isEditable(revision.status)) {
    return fail({
      code: "ILLEGAL_TRANSITION",
      field: "status",
      reason: "NOT_DRAFT",
      status: revision.status,
    });
  }
  return ok(true);
}

/**
 * Whether a revision's specification may be changed.
 *
 * The refusal for a released revision is the load-bearing one: it is what makes
 * a pinned revision mean the same thing forever.
 */
export function checkRevisionEdit(
  revision: MasterCardRevisionState,
): Result<true, MasterCardRevisionError> {
  if (!isEditable(revision.status)) {
    return fail({
      code: "ILLEGAL_TRANSITION",
      field: "status",
      reason:
        revision.status === "RELEASED" ? "RELEASED_IS_IMMUTABLE" : "NOT_DRAFT",
      status: revision.status,
    });
  }
  return ok(true);
}

/**
 * Whether a revision may be submitted for review.
 *
 * `attachedFileCount` is passed in rather than read here because this module
 * touches no database; the caller counts, this module decides.
 */
export function checkRevisionSubmission(
  revision: MasterCardRevisionState,
  input: {
    readonly attachedFileCount: number;
    readonly availableFileCount?: number;
    readonly missingSpecificationFields?: readonly string[];
  },
): Result<MasterCardRevisionStatus, MasterCardRevisionError> {
  if (revision.status !== "DRAFT") {
    return fail({
      code: "ILLEGAL_TRANSITION",
      field: "status",
      reason: "NOT_DRAFT",
      status: revision.status,
    });
  }
  if (input.attachedFileCount <= 0) {
    return fail({
      code: "PRECONDITION_FAILED",
      field: "files",
      reason: "NO_FILES_ATTACHED",
    });
  }
  if ((input.availableFileCount ?? 0) <= 0) {
    return fail({
      code: "PRECONDITION_FAILED",
      field: "files",
      reason: "NO_RETRIEVABLE_VERIFIED_FILES",
    });
  }
  if ((input.missingSpecificationFields?.length ?? 0) > 0) {
    return fail({
      code: "PRECONDITION_FAILED",
      field: input.missingSpecificationFields?.[0] ?? "specification",
      reason: "SPECIFICATION_INCOMPLETE",
    });
  }
  return ok("IN_REVIEW");
}

/**
 * Whether a reviewer may decide this revision, and what it becomes.
 *
 * Three refusals, in this order, because each is a different answer to the
 * caller: wrong status, then wrong person by authorship, then wrong person by
 * submission. Both people are checked — the author, because they wrote it, and
 * the submitter, because putting work up for review is an endorsement of it. In
 * the ordinary case they are the same person and the second check costs nothing;
 * in the case where an engineer drafts and a lead submits, neither may sign it
 * off.
 */
export function checkRevisionDecision(
  revision: MasterCardRevisionState,
  input: {
    readonly deciderUserId: string;
    readonly decision: RevisionDecision;
  },
): Result<MasterCardRevisionStatus, MasterCardRevisionError> {
  if (revision.status !== "IN_REVIEW") {
    return fail({
      code: "ILLEGAL_TRANSITION",
      field: "status",
      reason: "NOT_IN_REVIEW",
      status: revision.status,
    });
  }
  if (input.deciderUserId === revision.authoredByUserId) {
    return fail({
      code: "SEPARATION_OF_DUTIES",
      field: "authoredByUserId",
      reason: "AUTHOR_CANNOT_DECIDE",
    });
  }
  if (
    revision.submittedByUserId !== undefined &&
    input.deciderUserId === revision.submittedByUserId
  ) {
    return fail({
      code: "SEPARATION_OF_DUTIES",
      field: "submittedByUserId",
      reason: "SUBMITTER_CANNOT_DECIDE",
    });
  }
  return ok(input.decision === "APPROVE" ? "RELEASED" : "REJECTED");
}

/**
 * Whether a previously released revision may be superseded by a newly released
 * one.
 *
 * The only patch a released revision ever takes. It changes no specification and
 * no file — it records that a later revision now exists, so a reader of the old
 * one can find the current one without the old one lying about what it is.
 */
export function checkSupersede(
  previous: MasterCardRevisionState,
  input: {
    readonly supersedingRevisionNumber: number;
    readonly previousRevisionNumber: number;
  },
): Result<true, MasterCardRevisionError> {
  if (previous.status !== "RELEASED") {
    return fail({
      code: "ILLEGAL_TRANSITION",
      field: "status",
      reason: "NOT_RELEASED",
      status: previous.status,
    });
  }
  if (input.supersedingRevisionNumber <= input.previousRevisionNumber) {
    /*
     * An older revision cannot supersede a newer one. Without this, releasing a
     * long-stale draft would quietly demote the current spec.
     */
    return fail({
      code: "PRECONDITION_FAILED",
      field: "revisionNumber",
      reason: "NOT_NEWER",
    });
  }
  return ok(true);
}
