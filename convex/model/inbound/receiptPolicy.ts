/**
 * What a delivery *is*, decided as arithmetic.
 *
 * Receiving is where messy reality meets the ledger (`ADR-0007` context), and
 * almost every hard case is the same question asked with different numbers: given
 * what was ordered, what has already arrived, and what is on the pallet in front
 * of the operator — is this normal, is this short, or is this more than the
 * organization agreed to accept?
 *
 * That question has exactly one right answer for a given set of numbers, so it is
 * computed here, once, with no clock, no database, and no Convex import (plan
 * §6.2, enforced by `pnpm verify:tenant-boundary`). The mutation layer decides
 * *who* may act on the answer; this module decides what the answer is.
 *
 * ### Everything is integer minor units of the item's base UOM
 *
 * Tolerance is a percentage, and a percentage of an integer is where a naive
 * implementation reaches for a float. `5%` of `1,000,003` base units is not
 * representable in binary floating point, and a receipt that rounded it the wrong
 * way would accept a unit the tenant did not agree to — or reject one it did.
 * The tolerance is therefore an exact `Ratio` (`ADR-0004`) and the allowance is
 * computed with integer multiplication and one floor, which is the only rounding
 * in the module and is documented where it happens.
 *
 * ### Why over-receipt rounds *down*
 *
 * `floor` means a tolerance can never admit more than the exact fraction allows.
 * Rounding up would let `2.5%` of `41` units admit `2` where the agreement says
 * `1.025` — the tenant's tolerance would silently become larger than the number
 * they configured, and it would be larger by a different amount for every order
 * quantity. Under-admitting by less than one unit is a rounding difference; over-
 * admitting is a policy change nobody approved.
 */
import { fail, ok, type Result } from "../result";
import { makeRatio, type Ratio } from "../uom/ratio";

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

export type ReceiptPolicyError =
  | { readonly code: "QUANTITY_NOT_AN_INTEGER"; readonly field: string }
  | { readonly code: "QUANTITY_NOT_POSITIVE"; readonly field: string }
  | { readonly code: "QUANTITY_NEGATIVE"; readonly field: string }
  | { readonly code: "QUANTITY_OUT_OF_RANGE"; readonly field: string }
  | { readonly code: "TOLERANCE_INVALID"; readonly field: string }
  | { readonly code: "REASON_REQUIRED"; readonly field: string }
  | { readonly code: "LINE_NOT_OPEN"; readonly status: string };

/**
 * The largest quantity any single figure here may carry.
 *
 * Mirrors `MAX_QUANTITY_MINOR_UNITS` in the quantity kernel rather than importing
 * it, because the bound this module needs is on the *product* `ordered × numerator`
 * staying inside the exact-integer range, which is a stricter statement than the
 * quantity kernel's own. Stated as a constant so the guard is testable.
 */
export const MAX_RECEIPT_MINOR_UNITS = 1_000_000_000_000;

/** Above this, `ordered × numerator` could leave the exact-integer range. */
const MAX_TOLERANCE_COMPONENT = 1_000_000;

const isCount = (value: number): boolean =>
  Number.isSafeInteger(value) && Number.isFinite(value);

/* -------------------------------------------------------------------------- */
/* Tolerance                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * How much more than the ordered quantity may be accepted, as an exact fraction.
 *
 * A `Ratio` rather than a percentage number: `2.5%` is `1/40` exactly and `0.025`
 * approximately, and the difference is a unit of stock at the quantities a
 * factory receives.
 *
 * The absent tolerance is `null`, not `0/1`, and the distinction is deliberate.
 * "No tolerance configured" and "a tolerance of zero" are the same *arithmetic*
 * today, and they are different *facts*: `OPS-0007-02` requires the pilot tenant
 * to confirm a tolerance, and a policy row that had never been configured must
 * not be indistinguishable from one deliberately set to refuse every extra unit.
 * The classification says which one applied.
 */
export type ReceiptTolerance =
  | { readonly kind: "NONE" }
  | { readonly kind: "FRACTION"; readonly fraction: Ratio };

export const NO_TOLERANCE: ReceiptTolerance = Object.freeze({
  kind: "NONE" as const,
});

/**
 * Build a tolerance from a percentage expressed as an exact fraction.
 *
 * `makeTolerance(5, 100)` is five percent. The kernel reduces it, so `5/100` and
 * `1/20` are the same stored tolerance and cannot disagree.
 */
export function makeTolerance(
  numerator: number,
  denominator: number,
): Result<ReceiptTolerance, ReceiptPolicyError> {
  if (numerator === 0) return ok(NO_TOLERANCE);

  const ratio = makeRatio(numerator, denominator);
  if (!ratio.ok) return fail({ code: "TOLERANCE_INVALID", field: "tolerance" });

  if (
    ratio.value.numerator > MAX_TOLERANCE_COMPONENT ||
    ratio.value.denominator > MAX_TOLERANCE_COMPONENT
  ) {
    return fail({ code: "TOLERANCE_INVALID", field: "tolerance" });
  }
  /*
   * A tolerance at or above 100% is refused rather than clamped. It would mean
   * "accept at least twice what was ordered without approval", which no
   * configuration screen should be able to express by a typo in a denominator.
   */
  if (ratio.value.numerator >= ratio.value.denominator) {
    return fail({ code: "TOLERANCE_INVALID", field: "tolerance" });
  }
  return ok(
    Object.freeze({ kind: "FRACTION" as const, fraction: ratio.value }),
  );
}

/**
 * The largest total this line may reach without an over-tolerance approval.
 *
 * The one floor in the module. See the header for why it rounds down.
 */
export function toleranceAllowance(
  orderedMinorUnits: number,
  tolerance: ReceiptTolerance,
): Result<number, ReceiptPolicyError> {
  if (!isCount(orderedMinorUnits)) {
    return fail({ code: "QUANTITY_NOT_AN_INTEGER", field: "ordered" });
  }
  if (orderedMinorUnits <= 0) {
    return fail({ code: "QUANTITY_NOT_POSITIVE", field: "ordered" });
  }
  if (orderedMinorUnits > MAX_RECEIPT_MINOR_UNITS) {
    return fail({ code: "QUANTITY_OUT_OF_RANGE", field: "ordered" });
  }
  if (tolerance.kind === "NONE") return ok(orderedMinorUnits);

  const extra = Math.floor(
    (orderedMinorUnits * tolerance.fraction.numerator) /
      tolerance.fraction.denominator,
  );
  return ok(orderedMinorUnits + extra);
}

/* -------------------------------------------------------------------------- */
/* Classification                                                              */
/* -------------------------------------------------------------------------- */

/**
 * What this posting does to the line.
 *
 * Five outcomes, and the split that matters is the last two: both are more than
 * was ordered, and only one of them may be posted without a second person
 * (`INV-0007-02`). Collapsing them into "over" would make the approval either
 * always required — pushing routine over-shipments off the system — or never.
 */
export type ReceiptClassification =
  "PARTIAL" | "COMPLETE" | "OVER_WITHIN_TOLERANCE" | "OVER_BEYOND_TOLERANCE";

export interface ReceiptAssessment {
  readonly classification: ReceiptClassification;
  /** What the line will have received once this posting commits. */
  readonly totalAfterMinorUnits: number;
  /** Still outstanding after this posting; zero once complete or over. */
  readonly remainingMinorUnits: number;
  /** How far past the ordered quantity this posting takes the line. */
  readonly overByMinorUnits: number;
  /** The ceiling the tolerance permitted, for the explanation and the audit row. */
  readonly allowanceMinorUnits: number;
  /** Whether a tolerance was configured at all. See `ReceiptTolerance`. */
  readonly toleranceConfigured: boolean;
  /** True when the posting needs `receiving.receipt.overTolerance`. */
  readonly requiresApproval: boolean;
}

export interface ReceiptAssessmentInput {
  readonly orderedMinorUnits: number;
  readonly alreadyReceivedMinorUnits: number;
  readonly incomingMinorUnits: number;
  readonly tolerance: ReceiptTolerance;
}

/**
 * Classify one incoming posting against its purchase-order line.
 *
 * Total-based rather than posting-based, and that is the load-bearing choice. An
 * operator who receives 60 of 100 twice has received 120, and a rule that asked
 * "is this posting over?" would answer "no" both times. The question is always
 * what the *line* will hold once this commits.
 */
export function assessReceipt(
  input: ReceiptAssessmentInput,
): Result<ReceiptAssessment, ReceiptPolicyError> {
  const { orderedMinorUnits, alreadyReceivedMinorUnits, incomingMinorUnits } =
    input;

  if (!isCount(incomingMinorUnits)) {
    return fail({ code: "QUANTITY_NOT_AN_INTEGER", field: "incoming" });
  }
  /*
   * A receipt is strictly positive. A zero-quantity posting is refused by the
   * ledger too (`INV-0003-03`), and a negative one is a correction — which is a
   * reversal, not a receipt, and has its own permission and its own maker.
   */
  if (incomingMinorUnits <= 0) {
    return fail({ code: "QUANTITY_NOT_POSITIVE", field: "incoming" });
  }
  if (incomingMinorUnits > MAX_RECEIPT_MINOR_UNITS) {
    return fail({ code: "QUANTITY_OUT_OF_RANGE", field: "incoming" });
  }
  if (!isCount(alreadyReceivedMinorUnits)) {
    return fail({ code: "QUANTITY_NOT_AN_INTEGER", field: "alreadyReceived" });
  }
  if (alreadyReceivedMinorUnits < 0) {
    return fail({ code: "QUANTITY_NEGATIVE", field: "alreadyReceived" });
  }

  const allowance = toleranceAllowance(orderedMinorUnits, input.tolerance);
  if (!allowance.ok) return allowance;

  const totalAfter = alreadyReceivedMinorUnits + incomingMinorUnits;
  if (!isCount(totalAfter) || totalAfter > MAX_RECEIPT_MINOR_UNITS) {
    return fail({ code: "QUANTITY_OUT_OF_RANGE", field: "incoming" });
  }

  const overBy = Math.max(0, totalAfter - orderedMinorUnits);
  const remaining = Math.max(0, orderedMinorUnits - totalAfter);

  const classification: ReceiptClassification =
    totalAfter < orderedMinorUnits
      ? "PARTIAL"
      : totalAfter === orderedMinorUnits
        ? "COMPLETE"
        : totalAfter <= allowance.value
          ? "OVER_WITHIN_TOLERANCE"
          : "OVER_BEYOND_TOLERANCE";

  return ok(
    Object.freeze({
      classification,
      totalAfterMinorUnits: totalAfter,
      remainingMinorUnits: remaining,
      overByMinorUnits: overBy,
      allowanceMinorUnits: allowance.value,
      toleranceConfigured: input.tolerance.kind === "FRACTION",
      requiresApproval: classification === "OVER_BEYOND_TOLERANCE",
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* Line lifecycle                                                              */
/* -------------------------------------------------------------------------- */

/**
 * A purchase-order line's state.
 *
 * `CLOSED_SHORT` is a distinct terminal state rather than `COMPLETE` with a note.
 * The two mean opposite things to a buyer — one says the supplier delivered, the
 * other says somebody decided to stop waiting — and a reconciliation that could
 * not tell them apart would report a fulfilment rate that is simply false.
 */
export type PurchaseOrderLineStatus =
  "OPEN" | "COMPLETE" | "CLOSED_SHORT" | "CANCELLED";

/** Whether a line may still receive stock. */
export const acceptsReceipt = (status: PurchaseOrderLineStatus): boolean =>
  status === "OPEN";

/**
 * The status a line reaches after a posting.
 *
 * A line that has met or exceeded its ordered quantity is `COMPLETE`. It does not
 * become `CLOSED_SHORT` and it does not stay `OPEN`: leaving it open would let an
 * over-received line accumulate indefinitely without ever crossing a threshold
 * anybody reviews.
 */
export function statusAfterReceipt(
  assessment: ReceiptAssessment,
): PurchaseOrderLineStatus {
  return assessment.classification === "PARTIAL" ? "OPEN" : "COMPLETE";
}

export interface UnderCloseInput {
  readonly status: PurchaseOrderLineStatus;
  readonly orderedMinorUnits: number;
  readonly receivedMinorUnits: number;
  /** The tenant's reason row. Absent is the case this function exists to refuse. */
  readonly reasonCodeId?: string | undefined;
}

export interface UnderClosePlan {
  readonly shortfallMinorUnits: number;
  readonly reasonCodeId: string;
}

/**
 * Close a line short of its ordered quantity (`INV-0007-03`).
 *
 * The reason is required and is checked here rather than at the mutation
 * boundary, because "closed short" is the row a buyer later reads to ask why the
 * supplier under-delivered. A close with no reason is a fact with its evidence
 * discarded, and no amount of later auditing recovers it.
 *
 * Closing a line that already received everything is refused: there is no
 * shortfall to explain, and recording one would put a fictional supplier failure
 * into the tenant's own reporting.
 */
export function planUnderClose(
  input: UnderCloseInput,
): Result<UnderClosePlan, ReceiptPolicyError> {
  if (!acceptsReceipt(input.status)) {
    return fail({ code: "LINE_NOT_OPEN", status: input.status });
  }
  if (!isCount(input.orderedMinorUnits) || input.orderedMinorUnits <= 0) {
    return fail({ code: "QUANTITY_NOT_POSITIVE", field: "ordered" });
  }
  if (!isCount(input.receivedMinorUnits) || input.receivedMinorUnits < 0) {
    return fail({ code: "QUANTITY_NEGATIVE", field: "received" });
  }

  const shortfall = input.orderedMinorUnits - input.receivedMinorUnits;
  if (shortfall <= 0) {
    return fail({ code: "LINE_NOT_OPEN", status: "COMPLETE" });
  }

  const reasonCodeId = (input.reasonCodeId ?? "").trim();
  if (reasonCodeId.length === 0) {
    return fail({ code: "REASON_REQUIRED", field: "reasonCodeId" });
  }

  return ok(Object.freeze({ shortfallMinorUnits: shortfall, reasonCodeId }));
}

/* -------------------------------------------------------------------------- */
/* Exception kinds                                                             */
/* -------------------------------------------------------------------------- */

/**
 * How this receipt line came to exist (`INV-0007-04`).
 *
 * Four kinds, all recorded on the line, none of them inferable afterwards from
 * the numbers alone:
 *
 * - `ORDERED` — against an open purchase-order line. The normal case.
 * - `UNEXPECTED` — an item the order did not include. Permitted, because a
 *   supplier really does ship the wrong thing and refusing the record does not
 *   make the pallet go away; it needs `receiving.receipt.unexpected`.
 * - `CANCELLED_LINE` — the order line was cancelled and stock arrived anyway.
 *   Distinct from `UNEXPECTED`: somebody on this side cancelled it, so the
 *   follow-up is a conversation rather than a supplier claim.
 * - `BLIND` — received with no order at all, under `receiving.receipt.blind`.
 *
 * They are a closed set here because the audit row cites them and a screen
 * translates them; an open string would eventually carry an operator's typo into
 * a reconciliation report.
 */
export type ReceiptLineKind =
  "ORDERED" | "UNEXPECTED" | "CANCELLED_LINE" | "BLIND";

export interface LineKindInput {
  /** Whether the posting names a purchase-order line at all. */
  readonly hasOrderLine: boolean;
  /** The named line's status, when there is one. */
  readonly lineStatus?: PurchaseOrderLineStatus | undefined;
  /** Whether the item posted is the item the named line ordered. */
  readonly itemMatchesLine?: boolean | undefined;
}

/**
 * Decide which exception kind a posting is, from facts the server already holds.
 *
 * Never from a client-supplied label. A handheld that could declare its own
 * posting `ORDERED` would be able to route an unexpected delivery around the
 * permission that exists to catch it (`INV-0007-04`).
 */
export function classifyLineKind(input: LineKindInput): ReceiptLineKind {
  if (!input.hasOrderLine) return "BLIND";
  if (input.lineStatus === "CANCELLED") return "CANCELLED_LINE";
  if (input.itemMatchesLine === false) return "UNEXPECTED";
  return "ORDERED";
}

/** The permission code a line kind demands beyond `receiving.receipt.post`. */
export function additionalPermissionFor(
  kind: ReceiptLineKind,
): string | undefined {
  switch (kind) {
    case "UNEXPECTED":
      return "receiving.receipt.unexpected";
    case "CANCELLED_LINE":
      return "receiving.receipt.unexpected";
    case "BLIND":
      return "receiving.receipt.blind";
    case "ORDERED":
      return undefined;
  }
}

/* -------------------------------------------------------------------------- */
/* Duplicate defence                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Whether a posting looks like an accidental repeat of a recent one.
 *
 * This is **not** the idempotency check. A retry of one intent carries the same
 * `requestId` and is caught exactly by `convex/lib/idempotency.ts`; a double
 * *scan* is a different intent with a different request ID and identical
 * contents, and no key can distinguish it from a genuine second pallet of the
 * same lot (`ADR-0007` §3).
 *
 * So this answers "warn" rather than "refuse", and the caller surfaces it. A hard
 * block would make the legitimate second pallet impossible to receive, which is
 * how a defence turns into a reason to work off the system.
 */
export const PLAUSIBLE_DUPLICATE_WINDOW_MS = 120_000;

export interface DuplicateProbe {
  readonly itemId: string;
  readonly lotCode?: string | undefined;
  readonly minorUnits: number;
  readonly occurredAt: number;
}

export function isPlausibleDuplicate(
  incoming: DuplicateProbe,
  recent: readonly DuplicateProbe[],
  windowMs: number = PLAUSIBLE_DUPLICATE_WINDOW_MS,
): boolean {
  return recent.some(
    (previous) =>
      previous.itemId === incoming.itemId &&
      (previous.lotCode ?? "") === (incoming.lotCode ?? "") &&
      previous.minorUnits === incoming.minorUnits &&
      incoming.occurredAt - previous.occurredAt >= 0 &&
      incoming.occurredAt - previous.occurredAt <= windowMs,
  );
}
