import { fail, ok, type Result } from "../result";
import {
  designSimilarityScore,
  type DesignSpecification,
} from "./designSpecification";

export type DesignRequestStatus =
  "OPEN" | "ASSIGNED" | "IN_PROGRESS" | "IN_REVIEW" | "FULFILLED" | "CANCELLED";

export type DesignRequestPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

export interface DesignRequestState {
  readonly status: DesignRequestStatus;
  readonly assignedToUserId?: string;
  readonly dueAt?: number;
}

export type DesignRequestError = {
  readonly code: "ILLEGAL_TRANSITION" | "PRECONDITION_FAILED" | "FIELD_INVALID";
  readonly field: string;
  readonly reason: string;
  readonly status?: string;
};

export function planDesignRequestAssignment(
  request: DesignRequestState,
  assignedToUserId: string | undefined,
): Result<
  Pick<DesignRequestState, "status" | "assignedToUserId">,
  DesignRequestError
> {
  if (request.status === "FULFILLED" || request.status === "CANCELLED") {
    return fail({
      code: "ILLEGAL_TRANSITION",
      field: "status",
      reason: "REQUEST_CLOSED",
      status: request.status,
    });
  }
  return ok(
    assignedToUserId === undefined
      ? Object.freeze({ status: "OPEN" as const })
      : Object.freeze({
          status: "ASSIGNED" as const,
          assignedToUserId,
        }),
  );
}

export function planDesignRequestProgress(
  request: DesignRequestState,
  next: "IN_PROGRESS" | "IN_REVIEW",
): Result<DesignRequestStatus, DesignRequestError> {
  const allowed =
    (next === "IN_PROGRESS" && request.status === "ASSIGNED") ||
    (next === "IN_REVIEW" && request.status === "IN_PROGRESS");
  if (!allowed) {
    return fail({
      code: "ILLEGAL_TRANSITION",
      field: "status",
      reason: "INVALID_REQUEST_PROGRESS",
      status: request.status,
    });
  }
  return ok(next);
}

export function checkDesignRequestFulfilment(input: {
  readonly request: DesignRequestState;
  readonly requestedCustomerProductCode: string;
  readonly revisionStatus: string;
  readonly revisionCustomerProductCode: string;
}): Result<"FULFILLED", DesignRequestError> {
  if (
    input.request.status === "FULFILLED" ||
    input.request.status === "CANCELLED"
  ) {
    return fail({
      code: "ILLEGAL_TRANSITION",
      field: "status",
      reason: "REQUEST_CLOSED",
      status: input.request.status,
    });
  }
  if (input.revisionStatus !== "RELEASED") {
    return fail({
      code: "PRECONDITION_FAILED",
      field: "masterCardRevisionId",
      reason: "REVISION_NOT_RELEASED",
    });
  }
  if (
    input.revisionCustomerProductCode !== input.requestedCustomerProductCode
  ) {
    return fail({
      code: "PRECONDITION_FAILED",
      field: "customerProductCode",
      reason: "REVISION_DOES_NOT_MATCH_REQUEST",
    });
  }
  return ok("FULFILLED");
}

export const isDesignRequestOverdue = (
  request: Pick<DesignRequestState, "status" | "dueAt">,
  now: number,
): boolean =>
  request.dueAt !== undefined &&
  request.dueAt < now &&
  request.status !== "FULFILLED" &&
  request.status !== "CANCELLED";

/** Explicit human confirmation is the only path from similarity to reuse. */
export function planSimilarDesignConfirmation(input: {
  readonly request: DesignRequestState;
  readonly requestedSpecification: DesignSpecification;
  readonly candidateSpecification: DesignSpecification;
  readonly candidateRevisionStatus: string;
  readonly lineStatus: string;
  readonly reason: string;
}): Result<
  { readonly score: number; readonly reason: string },
  DesignRequestError
> {
  if (
    input.request.status === "FULFILLED" ||
    input.request.status === "CANCELLED"
  ) {
    return fail({
      code: "ILLEGAL_TRANSITION",
      field: "status",
      reason: "REQUEST_CLOSED",
      status: input.request.status,
    });
  }
  if (input.candidateRevisionStatus !== "RELEASED") {
    return fail({
      code: "PRECONDITION_FAILED",
      field: "masterCardRevisionId",
      reason: "REVISION_NOT_RELEASED",
    });
  }
  if (input.lineStatus !== "AWAITING_DESIGN") {
    return fail({
      code: "ILLEGAL_TRANSITION",
      field: "status",
      reason: "LINE_NOT_AWAITING_DESIGN",
      status: input.lineStatus,
    });
  }
  const reason = input.reason.trim();
  if (reason.length < 10 || reason.length > 500) {
    return fail({
      code: "FIELD_INVALID",
      field: "reason",
      reason: reason.length < 10 ? "TOO_SHORT" : "TOO_LONG",
    });
  }
  const score = designSimilarityScore(
    input.requestedSpecification,
    input.candidateSpecification,
  );
  if (score <= 0) {
    return fail({
      code: "PRECONDITION_FAILED",
      field: "masterCardRevisionId",
      reason: "NO_STRUCTURAL_SIMILARITY",
    });
  }
  return ok(Object.freeze({ score, reason }));
}
