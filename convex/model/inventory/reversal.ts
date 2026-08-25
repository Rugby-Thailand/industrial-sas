import {
  negateQuantity,
  validateQuantity,
  type Quantity,
} from "../uom/quantity";
import { isArray, isRecord, isSafeInt, isString } from "../guards";
import { fail, ok, type Result } from "../result";
import {
  encodeBucketKey,
  validateBucket,
  type InventoryBucket,
} from "./stockIdentity";
import {
  isInventoryTransactionType,
  validateLedgerTransaction,
  type InventoryTransactionType,
  type LedgerError,
  type LedgerLineDraft,
  type LedgerTransactionDraft,
  type ValidatedLedgerTransaction,
} from "./ledgerTransaction";

export interface OriginalTransaction {
  readonly transactionId: string;
  readonly orgId: string;
  readonly warehouseId: string;
  readonly type: InventoryTransactionType;
  readonly reversalOfTransactionId?: string | undefined;
  readonly lines: readonly {
    readonly bucket: InventoryBucket;
    readonly quantity: Quantity;
  }[];
}

export interface ReversalRequest {
  readonly orgId: string;
  readonly operation: string;
  readonly requestId: string;
  readonly actorUserId: string;
  readonly occurredAt: number;
  readonly reasonCodeId: string;
  readonly deviceId?: string | undefined;
  readonly original: OriginalTransaction;

  readonly existingReversalId: string | null;
}

export function planReversal(
  request: ReversalRequest,
): Result<ValidatedLedgerTransaction, LedgerError> {
  if (!isRecord(request) || !isRecord(request.original)) {
    return fail({ code: "NOT_A_TRANSACTION", received: typeof request });
  }
  const original = request.original;

  if (
    !isString(original.transactionId) ||
    original.transactionId.length === 0
  ) {
    return fail({
      code: "HEADER_FIELD_INVALID",
      field: "original.transactionId",
      received: typeof original.transactionId,
    });
  }
  if (!isString(request.orgId) || request.orgId.length === 0) {
    return fail({
      code: "HEADER_FIELD_INVALID",
      field: "orgId",
      received: typeof request.orgId,
    });
  }
  if (original.orgId !== request.orgId) {
    return fail({
      code: "REVERSAL_CROSS_ORG",
      expected: request.orgId,
      received: isString(original.orgId)
        ? original.orgId
        : typeof original.orgId,
    });
  }
  if (!isInventoryTransactionType(original.type)) {
    return fail({
      code: "TRANSACTION_TYPE_INVALID",
      received: typeof original.type,
    });
  }
  if (
    original.type === "REVERSAL" ||
    (original.reversalOfTransactionId !== undefined &&
      original.reversalOfTransactionId !== null)
  ) {
    return fail({ code: "REVERSAL_OF_REVERSAL" });
  }
  if (request.existingReversalId !== null) {
    if (
      !isString(request.existingReversalId) ||
      request.existingReversalId.length === 0
    ) {
      return fail({
        code: "HEADER_FIELD_INVALID",
        field: "existingReversalId",
        received: typeof request.existingReversalId,
      });
    }
    return fail({
      code: "REVERSAL_ALREADY_EXISTS",
      transactionId: request.existingReversalId,
    });
  }
  if (!isString(request.reasonCodeId) || request.reasonCodeId.length === 0) {
    return fail({ code: "REASON_CODE_REQUIRED", type: "REVERSAL" });
  }
  if (!isSafeInt(request.occurredAt) || request.occurredAt < 0) {
    return fail({
      code: "HEADER_FIELD_INVALID",
      field: "occurredAt",
      received: typeof request.occurredAt,
    });
  }
  if (!isArray(original.lines) || original.lines.length === 0) {
    return fail({ code: "NO_LINES" });
  }

  const compensating: LedgerLineDraft[] = [];
  for (const [index, line] of original.lines.entries()) {
    if (!isRecord(line)) {
      return fail({ code: "LINE_NOT_A_RECORD", index, received: typeof line });
    }
    const bucket = validateBucket(line.bucket as InventoryBucket);
    if (!bucket.ok) {
      return fail({ code: "LINE_BUCKET_INVALID", index, cause: bucket.error });
    }
    const negated = negateQuantity(line.quantity as Quantity);
    if (!negated.ok) {
      return fail({
        code: "LINE_QUANTITY_INVALID",
        index,
        cause: negated.error,
      });
    }
    compensating.push({ bucket: bucket.value, quantity: negated.value });
  }

  const draft: LedgerTransactionDraft = {
    orgId: request.orgId,
    warehouseId: original.warehouseId,
    type: "REVERSAL",
    operation: request.operation,
    requestId: request.requestId,
    actorUserId: request.actorUserId,
    occurredAt: request.occurredAt,
    source: { type: "REVERSAL", id: original.transactionId },
    ...(request.deviceId === undefined ? {} : { deviceId: request.deviceId }),
    reasonCodeId: request.reasonCodeId,
    reversalOfTransactionId: original.transactionId,
    lines: compensating,
  };

  const validated = validateLedgerTransaction(draft);
  if (!validated.ok) return validated;

  const exact = verifyExactCompensation(original, validated.value);
  if (!exact.ok) return exact;
  return validated;
}

export function verifyExactCompensation(
  original: OriginalTransaction,
  reversal: ValidatedLedgerTransaction,
): Result<true, LedgerError> {
  if (!isRecord(original) || !isArray(original.lines)) {
    return fail({ code: "NOT_A_TRANSACTION", received: typeof original });
  }

  const expected = new Map<string, number>();
  for (const [index, line] of original.lines.entries()) {
    if (!isRecord(line)) {
      return fail({ code: "LINE_NOT_A_RECORD", index, received: typeof line });
    }
    const bucket = validateBucket(line.bucket as InventoryBucket);
    if (!bucket.ok) {
      return fail({ code: "LINE_BUCKET_INVALID", index, cause: bucket.error });
    }
    const quantity = validateQuantity(line.quantity as Quantity);
    if (!quantity.ok) {
      return fail({
        code: "LINE_QUANTITY_INVALID",
        index,
        cause: quantity.error,
      });
    }
    const key = encodeBucketKey(bucket.value);
    if (!key.ok) {
      return fail({ code: "LINE_BUCKET_INVALID", index, cause: key.error });
    }
    if (expected.has(key.value)) {
      return fail({ code: "REVERSAL_NOT_EXACT", reason: "BUCKET_SET" });
    }
    expected.set(key.value, quantity.value.minorUnits);
  }

  if (reversal.lines.length !== expected.size) {
    return fail({ code: "REVERSAL_NOT_EXACT", reason: "LINE_COUNT" });
  }
  for (const line of reversal.lines) {
    const originalUnits = expected.get(line.bucketKey);
    if (originalUnits === undefined) {
      return fail({ code: "REVERSAL_NOT_EXACT", reason: "BUCKET_SET" });
    }
    if (line.quantity.minorUnits !== -originalUnits) {
      return fail({ code: "REVERSAL_NOT_EXACT", reason: "QUANTITY" });
    }
  }
  return ok(true);
}
