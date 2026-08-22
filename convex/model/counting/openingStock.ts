/**
 * Opening-stock lifecycle and ledger planning.
 *
 * An opening balance is not a mutable balance seed. It is a reviewed import that
 * posts ordinary, balanced `ADJUSTMENT` transactions through the inventory
 * ledger. That preserves replay, audit, business-date, and non-negative-balance
 * checks in the one store that already owns them.
 *
 * Pure module: no Convex imports.
 */
import { frozenArray, isArray, isRecord, isSafeInt, isString } from "../guards";
import {
  validateLedgerTransaction,
  type LedgerError,
  type LedgerLineDraft,
  type LedgerTransactionDraft,
} from "../inventory/ledgerTransaction";
import {
  validateBucket,
  type BucketError,
  type InventoryBucket,
} from "../inventory/stockIdentity";
import { fail, ok, type Result } from "../result";
import {
  convertToBase,
  type ItemUomError,
  type ItemUomProfile,
} from "../uom/itemUom";
import { makeQuantity, type UomCode } from "../uom/quantity";

export const MAX_OPENING_BATCH_ROWS = 100_000;
/** Two ledger lines per row and a ledger transaction is capped at 100 lines. */
export const MAX_OPENING_ROWS_PER_TRANSACTION = 50;
export const MAX_OPENING_REJECTION_REASON_LENGTH = 240;

export type OpeningStockStatus =
  "DRAFT" | "READY_FOR_REVIEW" | "APPROVED" | "POSTED" | "REJECTED";

export interface OpeningStockBatchState {
  readonly status: OpeningStockStatus;
  readonly createdByUserId: string;
  /** Lower-case SHA-256 of the exact source bytes. */
  readonly sourceHash: string;
  readonly cutoffAt: number;
  readonly rowCount: number;
  readonly validRowCount: number;
  readonly validationErrorCount: number;
  readonly submittedByUserId?: string;
  readonly submittedAt?: number;
  readonly approvedByUserId?: string;
  readonly approvedAt?: number;
  readonly postedByUserId?: string;
  readonly postedAt?: number;
  readonly transactionIds?: readonly string[];
  readonly rejectedByUserId?: string;
  readonly rejectedAt?: number;
  readonly rejectionReason?: string;
}

export type OpeningStockError =
  | { readonly code: "BATCH_INVALID"; readonly field: string }
  | { readonly code: "SOURCE_HASH_INVALID" }
  | { readonly code: "ROW_COUNT_INVALID"; readonly count: number }
  | {
      readonly code: "VALIDATION_COUNTS_INCONSISTENT";
      readonly rowCount: number;
      readonly validRowCount: number;
      readonly validationErrorCount: number;
    }
  | { readonly code: "BATCH_NOT_READY"; readonly status: string }
  | { readonly code: "VALIDATION_ERRORS_REMAIN"; readonly count: number }
  | { readonly code: "MAKER_CHECKER_REQUIRED" }
  | { readonly code: "REASON_REQUIRED" }
  | { readonly code: "REASON_TOO_LONG"; readonly limit: number }
  | { readonly code: "TRANSACTION_IDS_REQUIRED" }
  | { readonly code: "TRANSACTION_ID_INVALID"; readonly index: number }
  | { readonly code: "ROWS_REQUIRED" }
  | {
      readonly code: "TOO_MANY_ROWS";
      readonly count: number;
      readonly limit: number;
    }
  | {
      readonly code: "ROW_BUCKET_INVALID";
      readonly index: number;
      readonly cause: BucketError;
    }
  | { readonly code: "ROW_LOCATION_NOT_PHYSICAL"; readonly index: number }
  | { readonly code: "ROW_ITEM_MISMATCH"; readonly index: number }
  | { readonly code: "ROW_QUANTITY_NOT_POSITIVE"; readonly index: number }
  | {
      readonly code: "ROW_UOM_REJECTED";
      readonly index: number;
      readonly cause: ItemUomError;
    }
  | {
      readonly code: "ROW_UOM_INEXACT";
      readonly index: number;
      readonly numerator: number;
      readonly denominator: number;
      readonly uom: string;
    }
  | { readonly code: "LEDGER_DRAFT_INVALID"; readonly cause: LedgerError };

const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_.-]+$/;

const validIdentifier = (value: unknown): value is string =>
  isString(value) &&
  value.length > 0 &&
  value.length <= 128 &&
  IDENTIFIER_PATTERN.test(value);

const validClock = (value: unknown): value is number =>
  isSafeInt(value) && value >= 0;

function validateCounts(input: {
  readonly rowCount: number;
  readonly validRowCount: number;
  readonly validationErrorCount: number;
}): Result<true, OpeningStockError> {
  if (
    !isSafeInt(input.rowCount) ||
    input.rowCount <= 0 ||
    input.rowCount > MAX_OPENING_BATCH_ROWS
  ) {
    return fail({ code: "ROW_COUNT_INVALID", count: input.rowCount });
  }
  if (
    !isSafeInt(input.validRowCount) ||
    !isSafeInt(input.validationErrorCount) ||
    input.validRowCount < 0 ||
    input.validationErrorCount < 0 ||
    input.validRowCount + input.validationErrorCount !== input.rowCount
  ) {
    return fail({
      code: "VALIDATION_COUNTS_INCONSISTENT",
      rowCount: input.rowCount,
      validRowCount: input.validRowCount,
      validationErrorCount: input.validationErrorCount,
    });
  }
  return ok(true);
}

/** Construct the immutable identity and latest validation summary of an import. */
export function makeOpeningStockBatch(input: {
  readonly createdByUserId: string;
  readonly sourceHash: string;
  readonly cutoffAt: number;
  readonly rowCount: number;
  readonly validRowCount: number;
  readonly validationErrorCount: number;
}): Result<OpeningStockBatchState, OpeningStockError> {
  if (!isRecord(input)) return fail({ code: "BATCH_INVALID", field: "input" });
  if (!validIdentifier(input.createdByUserId)) {
    return fail({ code: "BATCH_INVALID", field: "createdByUserId" });
  }
  if (!isString(input.sourceHash) || !SHA256_PATTERN.test(input.sourceHash)) {
    return fail({ code: "SOURCE_HASH_INVALID" });
  }
  if (!validClock(input.cutoffAt)) {
    return fail({ code: "BATCH_INVALID", field: "cutoffAt" });
  }
  const counts = validateCounts(input);
  if (!counts.ok) return counts;
  return ok(
    Object.freeze({
      status: "DRAFT" as const,
      createdByUserId: input.createdByUserId,
      sourceHash: input.sourceHash.toLowerCase(),
      cutoffAt: input.cutoffAt,
      rowCount: input.rowCount,
      validRowCount: input.validRowCount,
      validationErrorCount: input.validationErrorCount,
    }),
  );
}

function validateState(
  state: OpeningStockBatchState,
): Result<OpeningStockBatchState, OpeningStockError> {
  if (!isRecord(state)) return fail({ code: "BATCH_INVALID", field: "state" });
  if (!validIdentifier(state.createdByUserId)) {
    return fail({ code: "BATCH_INVALID", field: "createdByUserId" });
  }
  if (!isString(state.sourceHash) || !SHA256_PATTERN.test(state.sourceHash)) {
    return fail({ code: "SOURCE_HASH_INVALID" });
  }
  if (!validClock(state.cutoffAt)) {
    return fail({ code: "BATCH_INVALID", field: "cutoffAt" });
  }
  const counts = validateCounts(state);
  if (!counts.ok) return counts;
  if (
    !["DRAFT", "READY_FOR_REVIEW", "APPROVED", "POSTED", "REJECTED"].includes(
      state.status,
    )
  ) {
    return fail({ code: "BATCH_INVALID", field: "status" });
  }
  return ok(state);
}

/** Submit only a fully valid import; row errors never become approval warnings. */
export function decideOpeningStockSubmission(input: {
  readonly state: OpeningStockBatchState;
  readonly actorUserId: string;
  readonly now: number;
}): Result<OpeningStockBatchState, OpeningStockError> {
  const state = validateState(input.state);
  if (!state.ok) return state;
  if (!validIdentifier(input.actorUserId))
    return fail({ code: "BATCH_INVALID", field: "actorUserId" });
  if (!validClock(input.now))
    return fail({ code: "BATCH_INVALID", field: "now" });
  if (state.value.status !== "DRAFT") {
    return fail({ code: "BATCH_NOT_READY", status: state.value.status });
  }
  if (state.value.validationErrorCount !== 0) {
    return fail({
      code: "VALIDATION_ERRORS_REMAIN",
      count: state.value.validationErrorCount,
    });
  }
  return ok(
    Object.freeze({
      ...state.value,
      status: "READY_FOR_REVIEW" as const,
      submittedByUserId: input.actorUserId,
      submittedAt: input.now,
    }),
  );
}

/** Approval is always a second-person decision because posting is irreversible. */
export function decideOpeningStockApproval(input: {
  readonly state: OpeningStockBatchState;
  readonly actorUserId: string;
  readonly now: number;
}): Result<OpeningStockBatchState, OpeningStockError> {
  const state = validateState(input.state);
  if (!state.ok) return state;
  if (!validIdentifier(input.actorUserId))
    return fail({ code: "BATCH_INVALID", field: "actorUserId" });
  if (!validClock(input.now))
    return fail({ code: "BATCH_INVALID", field: "now" });
  if (state.value.status !== "READY_FOR_REVIEW") {
    return fail({ code: "BATCH_NOT_READY", status: state.value.status });
  }
  if (
    input.actorUserId === state.value.createdByUserId ||
    input.actorUserId === state.value.submittedByUserId
  ) {
    return fail({ code: "MAKER_CHECKER_REQUIRED" });
  }
  return ok(
    Object.freeze({
      ...state.value,
      status: "APPROVED" as const,
      approvedByUserId: input.actorUserId,
      approvedAt: input.now,
    }),
  );
}

export function decideOpeningStockRejection(input: {
  readonly state: OpeningStockBatchState;
  readonly actorUserId: string;
  readonly reason: string;
  readonly now: number;
}): Result<OpeningStockBatchState, OpeningStockError> {
  const state = validateState(input.state);
  if (!state.ok) return state;
  if (!validIdentifier(input.actorUserId))
    return fail({ code: "BATCH_INVALID", field: "actorUserId" });
  if (!validClock(input.now))
    return fail({ code: "BATCH_INVALID", field: "now" });
  if (state.value.status !== "READY_FOR_REVIEW") {
    return fail({ code: "BATCH_NOT_READY", status: state.value.status });
  }
  const reason = isString(input.reason) ? input.reason.trim() : "";
  if (reason.length === 0) return fail({ code: "REASON_REQUIRED" });
  if (reason.length > MAX_OPENING_REJECTION_REASON_LENGTH) {
    return fail({
      code: "REASON_TOO_LONG",
      limit: MAX_OPENING_REJECTION_REASON_LENGTH,
    });
  }
  return ok(
    Object.freeze({
      ...state.value,
      status: "REJECTED" as const,
      rejectedByUserId: input.actorUserId,
      rejectedAt: input.now,
      rejectionReason: reason,
    }),
  );
}

/** Record the ledger transaction links after the store has posted every chunk. */
export function decideOpeningStockPosted(input: {
  readonly state: OpeningStockBatchState;
  readonly actorUserId: string;
  readonly transactionIds: readonly string[];
  readonly now: number;
}): Result<OpeningStockBatchState, OpeningStockError> {
  const state = validateState(input.state);
  if (!state.ok) return state;
  if (!validIdentifier(input.actorUserId))
    return fail({ code: "BATCH_INVALID", field: "actorUserId" });
  if (!validClock(input.now))
    return fail({ code: "BATCH_INVALID", field: "now" });
  if (state.value.status !== "APPROVED") {
    return fail({ code: "BATCH_NOT_READY", status: state.value.status });
  }
  if (!isArray(input.transactionIds) || input.transactionIds.length === 0) {
    return fail({ code: "TRANSACTION_IDS_REQUIRED" });
  }
  const transactionIds: string[] = [];
  for (const [index, transactionId] of input.transactionIds.entries()) {
    if (!validIdentifier(transactionId)) {
      return fail({ code: "TRANSACTION_ID_INVALID", index });
    }
    transactionIds.push(transactionId);
  }
  return ok(
    Object.freeze({
      ...state.value,
      status: "POSTED" as const,
      postedByUserId: input.actorUserId,
      postedAt: input.now,
      transactionIds: frozenArray(transactionIds),
    }),
  );
}

export interface OpeningStockRowDraft {
  readonly bucket: InventoryBucket;
  readonly profile: ItemUomProfile;
  readonly entryUom: UomCode;
  /** Thousandths of the entry UOM, before exact conversion to base UOM. */
  readonly entryMinorUnits: number;
}

/**
 * Plan one bounded opening-stock posting. The caller chunks larger imports and
 * gives every chunk its own stable request ID.
 */
export function buildOpeningStockTransactionChunk(input: {
  readonly orgId: string;
  readonly warehouseId: string;
  readonly batchId: string;
  readonly requestId: string;
  readonly actorUserId: string;
  readonly occurredAt: number;
  readonly reasonCodeId: string;
  readonly rows: readonly OpeningStockRowDraft[];
}): Result<LedgerTransactionDraft, OpeningStockError> {
  if (!isArray(input.rows) || input.rows.length === 0)
    return fail({ code: "ROWS_REQUIRED" });
  if (input.rows.length > MAX_OPENING_ROWS_PER_TRANSACTION) {
    return fail({
      code: "TOO_MANY_ROWS",
      count: input.rows.length,
      limit: MAX_OPENING_ROWS_PER_TRANSACTION,
    });
  }

  const lines: LedgerLineDraft[] = [];
  for (const [index, row] of input.rows.entries()) {
    const bucket = validateBucket(row.bucket);
    if (!bucket.ok)
      return fail({ code: "ROW_BUCKET_INVALID", index, cause: bucket.error });
    if (bucket.value.location.kind !== "PHYSICAL") {
      return fail({ code: "ROW_LOCATION_NOT_PHYSICAL", index });
    }
    if (row.profile.itemKey !== bucket.value.itemId) {
      return fail({ code: "ROW_ITEM_MISMATCH", index });
    }
    if (!isSafeInt(row.entryMinorUnits) || row.entryMinorUnits <= 0) {
      return fail({ code: "ROW_QUANTITY_NOT_POSITIVE", index });
    }
    const converted = convertToBase(
      row.profile,
      row.entryUom,
      row.entryMinorUnits,
    );
    if (converted.kind === "REJECTED") {
      return fail({ code: "ROW_UOM_REJECTED", index, cause: converted.error });
    }
    if (converted.kind === "INEXACT") {
      return fail({
        code: "ROW_UOM_INEXACT",
        index,
        numerator: converted.exact.numerator,
        denominator: converted.exact.denominator,
        uom: converted.uom,
      });
    }
    if (converted.quantity.minorUnits <= 0) {
      return fail({ code: "ROW_QUANTITY_NOT_POSITIVE", index });
    }
    const counterpartyQuantity = makeQuantity(
      -converted.quantity.minorUnits,
      converted.quantity.uom,
    );
    if (!counterpartyQuantity.ok) {
      return fail({
        code: "LEDGER_DRAFT_INVALID",
        cause: {
          code: "BALANCE_ARITHMETIC",
          cause: counterpartyQuantity.error,
        },
      });
    }
    lines.push(
      Object.freeze({ bucket: bucket.value, quantity: converted.quantity }),
      Object.freeze({
        bucket: Object.freeze({
          ...bucket.value,
          location: Object.freeze({
            kind: "VIRTUAL" as const,
            boundary: "INVENTORY_ADJUSTMENT" as const,
          }),
        }),
        quantity: counterpartyQuantity.value,
      }),
    );
  }

  const draft: LedgerTransactionDraft = Object.freeze({
    orgId: input.orgId,
    warehouseId: input.warehouseId,
    type: "ADJUSTMENT" as const,
    operation: "inventory.opening.post",
    requestId: input.requestId,
    actorUserId: input.actorUserId,
    occurredAt: input.occurredAt,
    source: Object.freeze({ type: "OPENING_STOCK_BATCH", id: input.batchId }),
    reasonCodeId: input.reasonCodeId,
    lines: frozenArray(lines),
  });
  const validated = validateLedgerTransaction(draft);
  return validated.ok
    ? ok(draft)
    : fail({ code: "LEDGER_DRAFT_INVALID", cause: validated.error });
}
