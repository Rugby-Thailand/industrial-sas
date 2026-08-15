import { fail, ok, type Result } from "../result";
import {
  checkRevisionDecision,
  checkSupersede,
  type MasterCardRevisionError,
  type MasterCardRevisionState,
  type RevisionDecision,
} from "./masterCardRevision";

export interface ReleaseCardState {
  readonly customerId: string;
  readonly customerProductCode: string;
  readonly releasedRevisionId?: string;
}

export interface ReleaseRevisionState extends MasterCardRevisionState {
  readonly revisionId: string;
  readonly revisionNumber: number;
  readonly designKey: string;
}

export interface MasterCardDecisionPlan {
  readonly revisionPatch: Readonly<Record<string, unknown>>;
  readonly cardPatch?: Readonly<Record<string, unknown>>;
  readonly previousRevisionPatch?: Readonly<Record<string, unknown>>;
  readonly uniqueCustomerProduct?: {
    readonly customerId: string;
    readonly customerProductCode: string;
  };
}

/**
 * The complete release state change. Callers load rows and apply this plan in
 * one transaction; no public handler invents lifecycle patches of its own.
 */
export function planMasterCardDecision(input: {
  readonly revision: ReleaseRevisionState;
  readonly card: ReleaseCardState;
  readonly previousRevision?: ReleaseRevisionState;
  readonly deciderUserId: string;
  readonly decision: RevisionDecision;
  readonly decidedAt: number;
  readonly note?: string;
}): Result<MasterCardDecisionPlan, MasterCardRevisionError> {
  const decided = checkRevisionDecision(input.revision, {
    deciderUserId: input.deciderUserId,
    decision: input.decision,
  });
  if (!decided.ok) return fail(decided.error);

  const revisionPatch = Object.freeze({
    status: decided.value,
    decidedByUserId: input.deciderUserId,
    decidedAt: input.decidedAt,
    ...(input.note === undefined ? {} : { decisionNote: input.note }),
  });
  if (decided.value !== "RELEASED") return ok({ revisionPatch });

  if (input.previousRevision !== undefined) {
    const supersede = checkSupersede(input.previousRevision, {
      supersedingRevisionNumber: input.revision.revisionNumber,
      previousRevisionNumber: input.previousRevision.revisionNumber,
    });
    if (!supersede.ok) return fail(supersede.error);
  }

  return ok(
    Object.freeze({
      revisionPatch,
      cardPatch: Object.freeze({
        releasedRevisionId: input.revision.revisionId,
        designKey: input.revision.designKey,
      }),
      ...(input.previousRevision === undefined
        ? {}
        : {
            previousRevisionPatch: Object.freeze({
              supersededByRevisionId: input.revision.revisionId,
            }),
          }),
      uniqueCustomerProduct: Object.freeze({
        customerId: input.card.customerId,
        customerProductCode: input.card.customerProductCode,
      }),
    }),
  );
}
