import { fail, ok, type Result } from "../result";
import { makeRatio, type Ratio } from "../uom/ratio";

export type ReceiptPolicyError =
  | { readonly code: "QUANTITY_NOT_AN_INTEGER"; readonly field: string }
  | { readonly code: "QUANTITY_NOT_POSITIVE"; readonly field: string }
  | { readonly code: "QUANTITY_NEGATIVE"; readonly field: string }
  | { readonly code: "QUANTITY_OUT_OF_RANGE"; readonly field: string }
  | { readonly code: "TOLERANCE_INVALID"; readonly field: string }
  | { readonly code: "REASON_REQUIRED"; readonly field: string }
  | { readonly code: "LINE_NOT_OPEN"; readonly status: string };

export const MAX_RECEIPT_MINOR_UNITS = 1_000_000_000_000;

const MAX_TOLERANCE_COMPONENT = 1_000_000;

const isCount = (value: number): boolean =>
  Number.isSafeInteger(value) && Number.isFinite(value);

export type ReceiptTolerance =
  | { readonly kind: "NONE" }
  | { readonly kind: "FRACTION"; readonly fraction: Ratio };

export const NO_TOLERANCE: ReceiptTolerance = Object.freeze({
  kind: "NONE" as const,
});

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

  if (ratio.value.numerator >= ratio.value.denominator) {
    return fail({ code: "TOLERANCE_INVALID", field: "tolerance" });
  }
  return ok(
    Object.freeze({ kind: "FRACTION" as const, fraction: ratio.value }),
  );
}

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

export type ReceiptClassification =
  "PARTIAL" | "COMPLETE" | "OVER_WITHIN_TOLERANCE" | "OVER_BEYOND_TOLERANCE";

export interface ReceiptAssessment {
  readonly classification: ReceiptClassification;

  readonly totalAfterMinorUnits: number;

  readonly remainingMinorUnits: number;

  readonly overByMinorUnits: number;

  readonly allowanceMinorUnits: number;

  readonly toleranceConfigured: boolean;

  readonly requiresApproval: boolean;
}

export interface ReceiptAssessmentInput {
  readonly orderedMinorUnits: number;
  readonly alreadyReceivedMinorUnits: number;
  readonly incomingMinorUnits: number;
  readonly tolerance: ReceiptTolerance;
}

export function assessReceipt(
  input: ReceiptAssessmentInput,
): Result<ReceiptAssessment, ReceiptPolicyError> {
  const { orderedMinorUnits, alreadyReceivedMinorUnits, incomingMinorUnits } =
    input;

  if (!isCount(incomingMinorUnits)) {
    return fail({ code: "QUANTITY_NOT_AN_INTEGER", field: "incoming" });
  }

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

export type PurchaseOrderLineStatus =
  "OPEN" | "COMPLETE" | "CLOSED_SHORT" | "CANCELLED";

export const acceptsReceipt = (status: PurchaseOrderLineStatus): boolean =>
  status === "OPEN";

export function statusAfterReceipt(
  assessment: ReceiptAssessment,
): PurchaseOrderLineStatus {
  return assessment.classification === "PARTIAL" ? "OPEN" : "COMPLETE";
}

export interface UnderCloseInput {
  readonly status: PurchaseOrderLineStatus;
  readonly orderedMinorUnits: number;
  readonly receivedMinorUnits: number;

  readonly reasonCodeId?: string | undefined;
}

export interface UnderClosePlan {
  readonly shortfallMinorUnits: number;
  readonly reasonCodeId: string;
}

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

export type ReceiptLineKind =
  "ORDERED" | "UNEXPECTED" | "CANCELLED_LINE" | "BLIND";

export interface LineKindInput {
  readonly hasOrderLine: boolean;

  readonly lineStatus?: PurchaseOrderLineStatus | undefined;

  readonly itemMatchesLine?: boolean | undefined;
}

export function classifyLineKind(input: LineKindInput): ReceiptLineKind {
  if (!input.hasOrderLine) return "BLIND";
  if (input.lineStatus === "CANCELLED") return "CANCELLED_LINE";
  if (input.itemMatchesLine === false) return "UNEXPECTED";
  return "ORDERED";
}

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
