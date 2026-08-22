/**
 * Count variance classification, approval policy, and ledger adjustment planning.
 *
 * A reconciliation compares the ledger snapshot plus movements that occurred
 * during the count with the accepted physical count. It never changes a balance
 * directly: an approved, non-zero variance becomes a balanced `ADJUSTMENT`
 * transaction against the `RECONCILIATION` virtual boundary.
 *
 * Pure module: no Convex imports.
 */
import { frozenArray, isArray, isRecord, isSafeInt, isString } from "../guards";
import {
  validateLedgerTransaction,
  type LedgerError,
  type LedgerTransactionDraft,
} from "../inventory/ledgerTransaction";
import {
  validateBucket,
  type BucketError,
  type InventoryBucket,
} from "../inventory/stockIdentity";
import { fail, ok, type Result } from "../result";
import { makeQuantity } from "../uom/quantity";

export const MAX_ROOT_CAUSE_CODE_LENGTH = 64;
export const MAX_HIGH_RISK_ITEM_CLASSES = 32;

export interface VariancePolicy {
  /** A variance larger than this absolute base-minor quantity is high risk. */
  readonly quantityThresholdBaseMinorUnits: number;
  /** A variance value larger than this amount in currency minor units is high risk. */
  readonly valueThresholdMinorUnits: number;
  /** Item classes that are high risk regardless of quantity or value. */
  readonly highRiskItemClasses: readonly string[];
}

export type VarianceRisk = "MATCH" | "STANDARD" | "HIGH";

export interface VarianceAssessment {
  readonly systemSnapshotBaseMinorUnits: number;
  readonly inCountMovementBaseMinorUnits: number;
  readonly expectedBaseMinorUnits: number;
  readonly physicalBaseMinorUnits: number;
  readonly varianceBaseMinorUnits: number;
  readonly absoluteVarianceBaseMinorUnits: number;
  readonly unitValueMinorUnits: number;
  readonly absoluteVarianceValueMinorUnits: number;
  readonly itemClass: string;
  readonly risk: VarianceRisk;
  readonly highRiskReasons: readonly (
    "QUANTITY_THRESHOLD" | "VALUE_THRESHOLD" | "ITEM_CLASS"
  )[];
  readonly rootCauseRequired: boolean;
  readonly approvalRequired: boolean;
  readonly stepUpRequired: boolean;
}

export type ReconciliationError =
  | { readonly code: "INPUT_INVALID"; readonly field: string }
  | { readonly code: "ARITHMETIC_OVERFLOW"; readonly field: string }
  | { readonly code: "ROOT_CAUSE_REQUIRED" }
  | { readonly code: "APPROVER_REQUIRED" }
  | { readonly code: "MAKER_CHECKER_REQUIRED" }
  | { readonly code: "STEP_UP_REQUIRED" }
  | { readonly code: "NO_VARIANCE" }
  | { readonly code: "BUCKET_INVALID"; readonly cause: BucketError }
  | { readonly code: "LOCATION_NOT_PHYSICAL" }
  | { readonly code: "LEDGER_DRAFT_INVALID"; readonly cause: LedgerError }
  | { readonly code: "PAPER_CAPTURES_DIFFER" }
  | { readonly code: "PAPER_DUAL_KEY_REQUIRED" };

/** Matches the master-data code contract, including human-readable hyphens. */
const CODE_PATTERN = /^[A-Z][A-Z0-9_-]{0,63}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_.-]+$/;
const validIdentifier = (value: unknown): value is string =>
  isString(value) &&
  value.length > 0 &&
  value.length <= 128 &&
  IDENTIFIER_PATTERN.test(value);

function checkedAdd(
  left: number,
  right: number,
  field: string,
): Result<number, ReconciliationError> {
  const value = left + right;
  return Number.isSafeInteger(value)
    ? ok(value)
    : fail({ code: "ARITHMETIC_OVERFLOW", field });
}

function checkedAbs(
  value: number,
  field: string,
): Result<number, ReconciliationError> {
  if (!Number.isSafeInteger(value) || value === Number.MIN_SAFE_INTEGER) {
    return fail({ code: "ARITHMETIC_OVERFLOW", field });
  }
  return ok(Math.abs(value));
}

function validatePolicy(
  policy: VariancePolicy,
): Result<VariancePolicy, ReconciliationError> {
  if (!isRecord(policy))
    return fail({ code: "INPUT_INVALID", field: "policy" });
  if (
    !isSafeInt(policy.quantityThresholdBaseMinorUnits) ||
    policy.quantityThresholdBaseMinorUnits < 0
  ) {
    return fail({
      code: "INPUT_INVALID",
      field: "quantityThresholdBaseMinorUnits",
    });
  }
  if (
    !isSafeInt(policy.valueThresholdMinorUnits) ||
    policy.valueThresholdMinorUnits < 0
  ) {
    return fail({ code: "INPUT_INVALID", field: "valueThresholdMinorUnits" });
  }
  if (
    !isArray(policy.highRiskItemClasses) ||
    policy.highRiskItemClasses.length > MAX_HIGH_RISK_ITEM_CLASSES
  ) {
    return fail({ code: "INPUT_INVALID", field: "highRiskItemClasses" });
  }
  const classes: string[] = [];
  const seen = new Set<string>();
  for (const raw of policy.highRiskItemClasses) {
    if (!isString(raw) || !CODE_PATTERN.test(raw)) {
      return fail({ code: "INPUT_INVALID", field: "highRiskItemClasses" });
    }
    if (!seen.has(raw)) {
      seen.add(raw);
      classes.push(raw);
    }
  }
  return ok(
    Object.freeze({
      quantityThresholdBaseMinorUnits: policy.quantityThresholdBaseMinorUnits,
      valueThresholdMinorUnits: policy.valueThresholdMinorUnits,
      highRiskItemClasses: frozenArray(classes),
    }),
  );
}

export function assessCountVariance(input: {
  readonly systemSnapshotBaseMinorUnits: number;
  readonly inCountMovementBaseMinorUnits: number;
  readonly physicalBaseMinorUnits: number;
  /** Currency minor units per one inventory base minor unit. */
  readonly unitValueMinorUnits: number;
  readonly itemClass: string;
  readonly policy: VariancePolicy;
}): Result<VarianceAssessment, ReconciliationError> {
  const numericFields = [
    "systemSnapshotBaseMinorUnits",
    "inCountMovementBaseMinorUnits",
    "physicalBaseMinorUnits",
    "unitValueMinorUnits",
  ] as const;
  for (const field of numericFields) {
    if (!isSafeInt(input[field])) return fail({ code: "INPUT_INVALID", field });
  }
  if (input.physicalBaseMinorUnits < 0) {
    return fail({ code: "INPUT_INVALID", field: "physicalBaseMinorUnits" });
  }
  if (input.unitValueMinorUnits < 0) {
    return fail({ code: "INPUT_INVALID", field: "unitValueMinorUnits" });
  }
  if (!isString(input.itemClass) || !CODE_PATTERN.test(input.itemClass)) {
    return fail({ code: "INPUT_INVALID", field: "itemClass" });
  }
  const policy = validatePolicy(input.policy);
  if (!policy.ok) return policy;
  const expected = checkedAdd(
    input.systemSnapshotBaseMinorUnits,
    input.inCountMovementBaseMinorUnits,
    "expectedBaseMinorUnits",
  );
  if (!expected.ok) return expected;
  const variance = checkedAdd(
    input.physicalBaseMinorUnits,
    -expected.value,
    "varianceBaseMinorUnits",
  );
  if (!variance.ok) return variance;
  const absolute = checkedAbs(variance.value, "absoluteVarianceBaseMinorUnits");
  if (!absolute.ok) return absolute;
  const value = absolute.value * input.unitValueMinorUnits;
  if (!Number.isSafeInteger(value)) {
    return fail({
      code: "ARITHMETIC_OVERFLOW",
      field: "absoluteVarianceValueMinorUnits",
    });
  }

  const highRiskReasons: VarianceAssessment["highRiskReasons"][number][] = [];
  if (absolute.value > policy.value.quantityThresholdBaseMinorUnits) {
    highRiskReasons.push("QUANTITY_THRESHOLD");
  }
  if (value > policy.value.valueThresholdMinorUnits) {
    highRiskReasons.push("VALUE_THRESHOLD");
  }
  if (policy.value.highRiskItemClasses.includes(input.itemClass)) {
    highRiskReasons.push("ITEM_CLASS");
  }
  const risk: VarianceRisk =
    variance.value === 0
      ? "MATCH"
      : highRiskReasons.length > 0
        ? "HIGH"
        : "STANDARD";
  return ok(
    Object.freeze({
      systemSnapshotBaseMinorUnits: input.systemSnapshotBaseMinorUnits,
      inCountMovementBaseMinorUnits: input.inCountMovementBaseMinorUnits,
      expectedBaseMinorUnits: expected.value,
      physicalBaseMinorUnits: input.physicalBaseMinorUnits,
      varianceBaseMinorUnits: variance.value,
      absoluteVarianceBaseMinorUnits: absolute.value,
      unitValueMinorUnits: input.unitValueMinorUnits,
      absoluteVarianceValueMinorUnits: value,
      itemClass: input.itemClass,
      risk,
      highRiskReasons: frozenArray(highRiskReasons),
      rootCauseRequired: variance.value !== 0,
      approvalRequired: variance.value !== 0,
      stepUpRequired: risk === "HIGH",
    }),
  );
}

export type ReconciliationDecision =
  | {
      readonly kind: "NO_ADJUSTMENT";
      readonly decidedByUserId: string;
      readonly decidedAt: number;
    }
  | {
      readonly kind: "ADJUSTMENT_APPROVED";
      readonly varianceBaseMinorUnits: number;
      readonly rootCauseCode: string;
      readonly counterUserId: string;
      readonly approvedByUserId: string;
      readonly approvedAt: number;
      readonly risk: "STANDARD" | "HIGH";
      readonly stepUpVerified: boolean;
    };

export function decideReconciliation(input: {
  readonly assessment: VarianceAssessment;
  readonly counterUserId: string;
  readonly approverUserId?: string;
  readonly rootCauseCode?: string;
  readonly stepUpVerified?: boolean;
  readonly now: number;
}): Result<ReconciliationDecision, ReconciliationError> {
  if (!validIdentifier(input.counterUserId)) {
    return fail({ code: "INPUT_INVALID", field: "counterUserId" });
  }
  if (!isSafeInt(input.now) || input.now < 0) {
    return fail({ code: "INPUT_INVALID", field: "now" });
  }
  if (input.assessment.varianceBaseMinorUnits === 0) {
    return ok(
      Object.freeze({
        kind: "NO_ADJUSTMENT" as const,
        decidedByUserId: input.counterUserId,
        decidedAt: input.now,
      }),
    );
  }
  if (
    !isString(input.rootCauseCode) ||
    !CODE_PATTERN.test(input.rootCauseCode)
  ) {
    return fail({ code: "ROOT_CAUSE_REQUIRED" });
  }
  if (!validIdentifier(input.approverUserId)) {
    return fail({ code: "APPROVER_REQUIRED" });
  }
  if (
    input.assessment.risk === "HIGH" &&
    input.approverUserId === input.counterUserId
  ) {
    return fail({ code: "MAKER_CHECKER_REQUIRED" });
  }
  if (input.assessment.risk === "HIGH" && input.stepUpVerified !== true) {
    return fail({ code: "STEP_UP_REQUIRED" });
  }
  return ok(
    Object.freeze({
      kind: "ADJUSTMENT_APPROVED" as const,
      varianceBaseMinorUnits: input.assessment.varianceBaseMinorUnits,
      rootCauseCode: input.rootCauseCode,
      counterUserId: input.counterUserId,
      approvedByUserId: input.approverUserId,
      approvedAt: input.now,
      risk: input.assessment.risk as "STANDARD" | "HIGH",
      stepUpVerified: input.stepUpVerified === true,
    }),
  );
}

/** Plan the balanced adjustment after `decideReconciliation` has approved it. */
export function buildCountAdjustmentTransaction(input: {
  readonly orgId: string;
  readonly warehouseId: string;
  readonly reconciliationId: string;
  readonly requestId: string;
  readonly actorUserId: string;
  readonly occurredAt: number;
  readonly bucket: InventoryBucket;
  readonly baseUom: string;
  /** Trusted reason-code document ID resolved from the decision's root-cause code. */
  readonly reasonCodeId: string;
  readonly decision: ReconciliationDecision;
}): Result<LedgerTransactionDraft, ReconciliationError> {
  if (input.decision.kind !== "ADJUSTMENT_APPROVED") {
    return fail({ code: "NO_VARIANCE" });
  }
  const bucket = validateBucket(input.bucket);
  if (!bucket.ok) return fail({ code: "BUCKET_INVALID", cause: bucket.error });
  if (bucket.value.location.kind !== "PHYSICAL") {
    return fail({ code: "LOCATION_NOT_PHYSICAL" });
  }
  const physicalQuantity = makeQuantity(
    input.decision.varianceBaseMinorUnits,
    input.baseUom,
  );
  const counterpartyQuantity = makeQuantity(
    -input.decision.varianceBaseMinorUnits,
    input.baseUom,
  );
  if (!physicalQuantity.ok) {
    return fail({
      code: "LEDGER_DRAFT_INVALID",
      cause: { code: "BALANCE_ARITHMETIC", cause: physicalQuantity.error },
    });
  }
  if (!counterpartyQuantity.ok) {
    return fail({
      code: "LEDGER_DRAFT_INVALID",
      cause: { code: "BALANCE_ARITHMETIC", cause: counterpartyQuantity.error },
    });
  }
  const draft: LedgerTransactionDraft = Object.freeze({
    orgId: input.orgId,
    warehouseId: input.warehouseId,
    type: "ADJUSTMENT" as const,
    operation: "inventory.count.adjust",
    requestId: input.requestId,
    actorUserId: input.actorUserId,
    occurredAt: input.occurredAt,
    source: Object.freeze({
      type: "COUNT_RECONCILIATION",
      id: input.reconciliationId,
    }),
    reasonCodeId: input.reasonCodeId,
    lines: frozenArray([
      Object.freeze({ bucket: bucket.value, quantity: physicalQuantity.value }),
      Object.freeze({
        bucket: Object.freeze({
          ...bucket.value,
          location: Object.freeze({
            kind: "VIRTUAL" as const,
            boundary: "RECONCILIATION" as const,
          }),
        }),
        quantity: counterpartyQuantity.value,
      }),
    ]),
  });
  const validated = validateLedgerTransaction(draft);
  return validated.ok
    ? ok(draft)
    : fail({ code: "LEDGER_DRAFT_INVALID", cause: validated.error });
}

export interface PaperCountCapture {
  readonly sheetHash: string;
  readonly lineCount: number;
  readonly enteredByUserId: string;
  readonly evidenceId: string;
}

/** Dual-key verification for sanctioned paper fallback re-entry. */
export function verifyPaperCountReentry(input: {
  readonly first: PaperCountCapture;
  readonly second: PaperCountCapture;
  readonly verifiedAt: number;
}): Result<
  Readonly<{
    sheetHash: string;
    lineCount: number;
    verifiedAt: number;
    enteredBy: readonly [string, string];
    evidenceIds: readonly [string, string];
  }>,
  ReconciliationError
> {
  if (
    !validIdentifier(input.first.enteredByUserId) ||
    !validIdentifier(input.second.enteredByUserId) ||
    !validIdentifier(input.first.evidenceId) ||
    !validIdentifier(input.second.evidenceId) ||
    !isSafeInt(input.verifiedAt) ||
    input.verifiedAt < 0
  ) {
    return fail({ code: "INPUT_INVALID", field: "paperCapture" });
  }
  if (input.first.enteredByUserId === input.second.enteredByUserId) {
    return fail({ code: "PAPER_DUAL_KEY_REQUIRED" });
  }
  if (
    input.first.sheetHash !== input.second.sheetHash ||
    input.first.lineCount !== input.second.lineCount
  ) {
    return fail({ code: "PAPER_CAPTURES_DIFFER" });
  }
  return ok(
    Object.freeze({
      sheetHash: input.first.sheetHash,
      lineCount: input.first.lineCount,
      verifiedAt: input.verifiedAt,
      enteredBy: Object.freeze([
        input.first.enteredByUserId,
        input.second.enteredByUserId,
      ]) as readonly [string, string],
      evidenceIds: Object.freeze([
        input.first.evidenceId,
        input.second.evidenceId,
      ]) as readonly [string, string],
    }),
  );
}
