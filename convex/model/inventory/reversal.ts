/**
 * Correction by reversal, and only by reversal.
 *
 * Status: **implemented.** Pure module (plan §6.2): no Convex imports, and no
 * imports outside `convex/model/**`.
 *
 * There is no "fix the number" path in this system (`ADR-0003` §5, plan §7.5). A
 * wrong transaction is corrected by a second transaction that posts the exact
 * negation of the first, names it, carries a reason, and leaves it untouched. This
 * module builds that second transaction and proves it is exact.
 *
 * The five rules, and why each is here rather than in the mutation:
 *
 * - **Exactly one original** (`INV-0003-08`). The draft names one
 *   `reversalOfTransactionId`, and `validateLedgerHeader` already refuses a
 *   `REVERSAL` without one and a non-reversal with one.
 * - **Exact compensation.** Every line negated, same bucket, same UOM, nothing
 *   added, nothing dropped. `verifyExactCompensation` checks it as a separate
 *   function so the store can re-check what it is about to write rather than
 *   trusting that this module built it.
 * - **No reversal of a reversal.** Refused two ways, because a stored row can be
 *   inconsistent: by `type === "REVERSAL"` and by the presence of the original's
 *   own `reversalOfTransactionId`. A compensating chain would make "what is the
 *   current state of this receipt" a graph traversal instead of a lookup.
 * - **Not twice.** An original that already has a reversal is refused. Two
 *   reversals of one original compensate it twice, which is not compensation; the
 *   caller passes what a bounded `by_orgId_reversalOfTransactionId` read found, and
 *   a non-`null` answer ends it here. `ADR-0003` §5 says "references exactly one
 *   original"; this is the other half of that sentence, made mechanical.
 * - **Never across organizations.** The original's `orgId` must equal the active
 *   tenant's. The store also reads the original through the tenant-bound accessor,
 *   so a foreign ID resolves to nothing long before this check — which is exactly
 *   why the check is stated here too: two independent refusals, and this one works
 *   on a value that was handed over rather than read.
 *
 * A reason code is required, and it is required by `validateLedgerHeader`'s
 * `REASON_REQUIRED_TYPES` rather than by a second rule here, so "which types need a
 * reason" has one answer in one place.
 */
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

/**
 * The original, as the store read it back.
 *
 * A plain structural record rather than a document type: this module never sees a
 * Convex document, and the store is what turns rows into this. `lines` are the
 * stored postings, which are re-validated here — a stored line is a document field
 * and is exactly as forgeable as any other.
 */
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

/** What the caller supplies to reverse one transaction. */
export interface ReversalRequest {
  readonly orgId: string;
  readonly operation: string;
  readonly requestId: string;
  readonly actorUserId: string;
  readonly occurredAt: number;
  readonly reasonCodeId: string;
  readonly deviceId?: string | undefined;
  readonly original: OriginalTransaction;
  /**
   * The ID of a reversal that already names this original, if a bounded read found
   * one. `null` means the read ran and found nothing — not "we did not look".
   */
  readonly existingReversalId: string | null;
}

/**
 * Build and validate the compensating transaction.
 *
 * Answers a fully validated `ValidatedLedgerTransaction`, not a draft: a reversal
 * that cannot pass the ordinary rules is not a reversal, and returning a draft
 * would let a caller post one without checking. The warehouse comes from the
 * original, never from the request — a reversal happens where the original
 * happened, and letting a caller name a different site would be a cross-warehouse
 * movement dressed as a correction.
 */
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

  // Belt and braces: the negation above is per line, and `validateLedgerTransaction`
  // canonicalizes duplicates. If the original itself carried two lines on one
  // bucket — it cannot, because it was canonicalized when it posted, but a stored
  // row is a stored row — the merge would change the line count and the result
  // would no longer be an exact compensation. Prove it rather than assume it.
  const exact = verifyExactCompensation(original, validated.value);
  if (!exact.ok) return exact;
  return validated;
}

/**
 * Prove a candidate reversal is the exact negation of an original.
 *
 * Compares bucket-key sets and per-bucket quantities, not line order: the stored
 * order is canonical (`bucketKey` ascending) on both sides, but comparing by key
 * makes the check independent of that and therefore still correct if the ordering
 * rule ever changes.
 */
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
