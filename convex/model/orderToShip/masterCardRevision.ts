import { fail, ok, type Result } from "../result";

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

export const isProductionVisible = (
  status: MasterCardRevisionStatus,
): boolean => status === "RELEASED";

export const isEditable = (status: MasterCardRevisionStatus): boolean =>
  status === "DRAFT";

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

export interface MasterCardRevisionState {
  readonly status: MasterCardRevisionStatus;
  readonly authoredByUserId: string;
  readonly submittedByUserId?: string | undefined;
}

export type RevisionDecision = "APPROVE" | "REJECT";

export const MAX_REVISION_NUMBER = 9_999;

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
    return fail({
      code: "PRECONDITION_FAILED",
      field: "revisionNumber",
      reason: "NOT_NEWER",
    });
  }
  return ok(true);
}
