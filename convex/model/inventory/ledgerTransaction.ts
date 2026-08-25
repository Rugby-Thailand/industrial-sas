import {
  MAX_QUANTITY_MINOR_UNITS,
  addQuantities,
  makeQuantity,
  requireNonZeroQuantity,
  validateQuantity,
  type Quantity,
  type QuantityError,
} from "../uom/quantity";
import { isArray, isRecord, isSafeInt, isString } from "../guards";
import { fail, ok, type Result } from "../result";
import {
  conservationKeyOfBucket,
  encodeBucketKey,
  isPhysicalLocation,
  validateBucket,
  virtualBoundaryByCode,
  type BucketError,
  type InventoryBucket,
} from "./stockIdentity";
import {
  validateOperation,
  validateRequestId,
  type RequestIdentityError,
} from "./requestIdentity";

export const INVENTORY_TRANSACTION_TYPES = [
  "RECEIPT",
  "PUTAWAY",
  "MOVE",
  "STATUS_CHANGE",
  "ADJUSTMENT",
  "SCRAP",
  "SHIPMENT",
  "PRODUCTION_ISSUE",
  "PRODUCTION_RECEIPT",
  "REVERSAL",
] as const;

export type InventoryTransactionType =
  (typeof INVENTORY_TRANSACTION_TYPES)[number];

export const isInventoryTransactionType = (
  value: unknown,
): value is InventoryTransactionType =>
  isString(value) &&
  (INVENTORY_TRANSACTION_TYPES as readonly string[]).includes(value);

export const REASON_REQUIRED_TYPES: ReadonlySet<InventoryTransactionType> =
  new Set(["ADJUSTMENT", "SCRAP", "REVERSAL"]);

export const MAX_TRANSACTION_LINES = 100;

const MAX_SOURCE_FIELD_LENGTH = 128;

const SOURCE_TYPE_PATTERN = /^[A-Z][A-Z0-9_]{0,62}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_.-]+$/;

export type LedgerError =
  | { readonly code: "NOT_A_TRANSACTION"; readonly received: string }
  | {
      readonly code: "HEADER_FIELD_INVALID";
      readonly field: string;
      readonly received: string;
    }
  | { readonly code: "TRANSACTION_TYPE_INVALID"; readonly received: string }
  | { readonly code: "NO_LINES" }
  | {
      readonly code: "TOO_MANY_LINES";
      readonly count: number;
      readonly limit: number;
    }
  | {
      readonly code: "LINE_NOT_A_RECORD";
      readonly index: number;
      readonly received: string;
    }
  | {
      readonly code: "LINE_BUCKET_INVALID";
      readonly index: number;
      readonly cause: BucketError;
    }
  | {
      readonly code: "LINE_QUANTITY_INVALID";
      readonly index: number;
      readonly cause: QuantityError;
    }
  | {
      readonly code: "LINE_ORG_MISMATCH";
      readonly index: number;
      readonly expected: string;
      readonly received: string;
    }
  | {
      readonly code: "LINE_WAREHOUSE_MISMATCH";
      readonly index: number;
      readonly expected: string;
      readonly received: string;
    }
  | {
      readonly code: "BOUNDARY_DIRECTION_VIOLATION";
      readonly index: number;
      readonly boundary: string;
      readonly flow: string;
      readonly sign: "POSITIVE" | "NEGATIVE";
    }
  | {
      readonly code: "BUCKET_UOM_CONFLICT";
      readonly bucketKey: string;
      readonly first: string;
      readonly second: string;
    }
  | { readonly code: "CANONICALIZED_LINE_IS_ZERO"; readonly bucketKey: string }
  | { readonly code: "NO_PHYSICAL_LINE" }
  | {
      readonly code: "UNBALANCED_TRANSACTION";
      readonly conservationKey: string;
      readonly residual: number;
      readonly uom: string;
    }
  | { readonly code: "REASON_CODE_REQUIRED"; readonly type: string }
  | { readonly code: "REVERSAL_LINK_MISSING" }
  | { readonly code: "REVERSAL_LINK_UNEXPECTED"; readonly type: string }
  | { readonly code: "REVERSAL_OF_REVERSAL" }
  | { readonly code: "REVERSAL_ALREADY_EXISTS"; readonly transactionId: string }
  | {
      readonly code: "REVERSAL_CROSS_ORG";
      readonly expected: string;
      readonly received: string;
    }
  | {
      readonly code: "REVERSAL_NOT_EXACT";
      readonly reason: "LINE_COUNT" | "BUCKET_SET" | "QUANTITY";
    }
  | {
      readonly code: "NEGATIVE_AVAILABLE_BALANCE";
      readonly bucketKey: string;
      readonly resulting: number;
      readonly uom: string;
    }
  | {
      readonly code: "NEGATIVE_PHYSICAL_BALANCE";
      readonly bucketKey: string;
      readonly stockStatus: string;
      readonly resulting: number;
      readonly uom: string;
    }
  | {
      readonly code: "REQUEST_IDENTITY_INVALID";
      readonly cause: RequestIdentityError;
    }
  | { readonly code: "BALANCE_ARITHMETIC"; readonly cause: QuantityError };

function describe(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (isString(value)) {
    return value.length > 80 ? `${value.slice(0, 80)}…` : value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "non-finite";
  }
  if (typeof value === "boolean") return String(value);
  if (isArray(value)) return "array";
  return typeof value;
}

export interface LedgerLineDraft {
  readonly bucket: InventoryBucket;
  readonly quantity: Quantity;
}

export interface ValidatedLedgerLine {
  readonly bucket: InventoryBucket;
  readonly bucketKey: string;
  readonly conservationKey: string;
  readonly quantity: Quantity;
}

/** The header a caller writes. `lines` travels with it because neither is valid alone. */
export interface LedgerTransactionDraft {
  readonly orgId: string;
  readonly warehouseId: string;
  readonly type: InventoryTransactionType;
  readonly operation: string;
  readonly requestId: string;
  readonly actorUserId: string;
  readonly occurredAt: number;
  readonly source: { readonly type: string; readonly id: string };
  readonly deviceId?: string | undefined;
  readonly reasonCodeId?: string | undefined;
  readonly reversalOfTransactionId?: string | undefined;
  readonly lines: readonly LedgerLineDraft[];
}

export interface ValidatedLedgerHeader {
  readonly orgId: string;
  readonly warehouseId: string;
  readonly type: InventoryTransactionType;
  readonly operation: string;
  readonly requestId: string;
  readonly actorUserId: string;
  readonly occurredAt: number;
  readonly source: { readonly type: string; readonly id: string };
  readonly deviceId?: string;
  readonly reasonCodeId?: string;
  readonly reversalOfTransactionId?: string;
}

export interface ConservationTotal {
  readonly conservationKey: string;
  readonly uom: string;
  readonly minorUnits: number;
}

export interface BucketDelta {
  readonly bucketKey: string;
  readonly bucket: InventoryBucket;
  readonly quantity: Quantity;
}

export interface ValidatedLedgerTransaction {
  readonly header: ValidatedLedgerHeader;
  readonly lines: readonly ValidatedLedgerLine[];
  readonly conservation: readonly ConservationTotal[];
  readonly deltas: readonly BucketDelta[];
}

function validateIdentifier(
  field: string,
  value: unknown,
  limit = 64,
): Result<string, LedgerError> {
  if (
    !isString(value) ||
    value.length === 0 ||
    value.length > limit ||
    !IDENTIFIER_PATTERN.test(value)
  ) {
    return fail({
      code: "HEADER_FIELD_INVALID",
      field,
      received: describe(value),
    });
  }
  return ok(value);
}

function validateOptionalIdentifier(
  field: string,
  value: unknown,
): Result<string | undefined, LedgerError> {
  if (value === undefined || value === null) return ok(undefined);
  const validated = validateIdentifier(field, value);
  return validated.ok ? ok(validated.value) : validated;
}

export function validateLedgerHeader(
  draft: LedgerTransactionDraft,
): Result<ValidatedLedgerHeader, LedgerError> {
  if (!isRecord(draft)) {
    return fail({ code: "NOT_A_TRANSACTION", received: describe(draft) });
  }

  const orgId = validateIdentifier("orgId", draft.orgId);
  if (!orgId.ok) return orgId;
  const warehouseId = validateIdentifier("warehouseId", draft.warehouseId);
  if (!warehouseId.ok) return warehouseId;
  if (!isInventoryTransactionType(draft.type)) {
    return fail({
      code: "TRANSACTION_TYPE_INVALID",
      received: describe(draft.type),
    });
  }
  const operation = validateOperation(draft.operation);
  if (!operation.ok) {
    return fail({ code: "REQUEST_IDENTITY_INVALID", cause: operation.error });
  }
  const requestId = validateRequestId(draft.requestId);
  if (!requestId.ok) {
    return fail({ code: "REQUEST_IDENTITY_INVALID", cause: requestId.error });
  }
  const actorUserId = validateIdentifier("actorUserId", draft.actorUserId);
  if (!actorUserId.ok) return actorUserId;
  if (!isSafeInt(draft.occurredAt) || draft.occurredAt < 0) {
    return fail({
      code: "HEADER_FIELD_INVALID",
      field: "occurredAt",
      received: describe(draft.occurredAt),
    });
  }
  if (!isRecord(draft.source)) {
    return fail({
      code: "HEADER_FIELD_INVALID",
      field: "source",
      received: describe(draft.source),
    });
  }
  const sourceType = draft.source.type;
  if (
    !isString(sourceType) ||
    sourceType.length > MAX_SOURCE_FIELD_LENGTH ||
    !SOURCE_TYPE_PATTERN.test(sourceType)
  ) {
    return fail({
      code: "HEADER_FIELD_INVALID",
      field: "source.type",
      received: describe(sourceType),
    });
  }
  const sourceId = validateIdentifier(
    "source.id",
    draft.source.id,
    MAX_SOURCE_FIELD_LENGTH,
  );
  if (!sourceId.ok) return sourceId;

  const deviceId = validateOptionalIdentifier("deviceId", draft.deviceId);
  if (!deviceId.ok) return deviceId;
  const reasonCodeId = validateOptionalIdentifier(
    "reasonCodeId",
    draft.reasonCodeId,
  );
  if (!reasonCodeId.ok) return reasonCodeId;
  const reversalOf = validateOptionalIdentifier(
    "reversalOfTransactionId",
    draft.reversalOfTransactionId,
  );
  if (!reversalOf.ok) return reversalOf;

  if (draft.type === "REVERSAL" && reversalOf.value === undefined) {
    return fail({ code: "REVERSAL_LINK_MISSING" });
  }
  if (draft.type !== "REVERSAL" && reversalOf.value !== undefined) {
    return fail({ code: "REVERSAL_LINK_UNEXPECTED", type: draft.type });
  }
  if (
    REASON_REQUIRED_TYPES.has(draft.type) &&
    reasonCodeId.value === undefined
  ) {
    return fail({ code: "REASON_CODE_REQUIRED", type: draft.type });
  }

  return ok(
    Object.freeze({
      orgId: orgId.value,
      warehouseId: warehouseId.value,
      type: draft.type,
      operation: operation.value,
      requestId: requestId.value,
      actorUserId: actorUserId.value,
      occurredAt: draft.occurredAt,
      source: Object.freeze({ type: sourceType, id: sourceId.value }),
      ...(deviceId.value === undefined ? {} : { deviceId: deviceId.value }),
      ...(reasonCodeId.value === undefined
        ? {}
        : { reasonCodeId: reasonCodeId.value }),
      ...(reversalOf.value === undefined
        ? {}
        : { reversalOfTransactionId: reversalOf.value }),
    }),
  );
}

function boundaryDirectionViolation(
  index: number,
  location: InventoryBucket["location"],
  minorUnits: number,
): LedgerError | null {
  if (location.kind !== "VIRTUAL") return null;
  const boundary = virtualBoundaryByCode(location.boundary);
  if (boundary === null) return null;
  const sign = minorUnits > 0 ? "POSITIVE" : "NEGATIVE";
  if (boundary.flow === "SOURCE" && minorUnits > 0) {
    return {
      code: "BOUNDARY_DIRECTION_VIOLATION",
      index,
      boundary: boundary.code,
      flow: boundary.flow,
      sign,
    };
  }
  if (boundary.flow === "SINK" && minorUnits < 0) {
    return {
      code: "BOUNDARY_DIRECTION_VIOLATION",
      index,
      boundary: boundary.code,
      flow: boundary.flow,
      sign,
    };
  }
  return null;
}

function validateLine(
  index: number,
  draft: LedgerLineDraft,
  header: ValidatedLedgerHeader,
): Result<ValidatedLedgerLine, LedgerError> {
  if (!isRecord(draft)) {
    return fail({
      code: "LINE_NOT_A_RECORD",
      index,
      received: describe(draft),
    });
  }
  const bucket = validateBucket(draft.bucket as InventoryBucket);
  if (!bucket.ok) {
    return fail({ code: "LINE_BUCKET_INVALID", index, cause: bucket.error });
  }
  const quantity = requireNonZeroQuantity(draft.quantity as Quantity);
  if (!quantity.ok) {
    return fail({
      code: "LINE_QUANTITY_INVALID",
      index,
      cause: quantity.error,
    });
  }
  if (bucket.value.orgId !== header.orgId) {
    return fail({
      code: "LINE_ORG_MISMATCH",
      index,
      expected: header.orgId,
      received: bucket.value.orgId,
    });
  }
  if (bucket.value.warehouseId !== header.warehouseId) {
    return fail({
      code: "LINE_WAREHOUSE_MISMATCH",
      index,
      expected: header.warehouseId,
      received: bucket.value.warehouseId,
    });
  }

  const direction =
    header.type === "REVERSAL"
      ? null
      : boundaryDirectionViolation(
          index,
          bucket.value.location,
          quantity.value.minorUnits,
        );
  if (direction !== null) return fail(direction);

  const bucketKey = encodeBucketKey(bucket.value);
  if (!bucketKey.ok) {
    return fail({ code: "LINE_BUCKET_INVALID", index, cause: bucketKey.error });
  }
  const conservationKey = conservationKeyOfBucket(
    bucket.value,
    quantity.value.uom,
  );
  if (!conservationKey.ok) {
    return fail({
      code: "LINE_BUCKET_INVALID",
      index,
      cause: conservationKey.error,
    });
  }

  return ok(
    Object.freeze({
      bucket: bucket.value,
      bucketKey: bucketKey.value,
      conservationKey: conservationKey.value,
      quantity: quantity.value,
    }),
  );
}

export function validateLedgerTransaction(
  draft: LedgerTransactionDraft,
): Result<ValidatedLedgerTransaction, LedgerError> {
  const header = validateLedgerHeader(draft);
  if (!header.ok) return header;

  const drafts = (draft as { lines?: unknown }).lines;
  if (!isArray(drafts)) {
    return fail({ code: "NOT_A_TRANSACTION", received: describe(drafts) });
  }
  if (drafts.length === 0) return fail({ code: "NO_LINES" });
  if (drafts.length > MAX_TRANSACTION_LINES) {
    return fail({
      code: "TOO_MANY_LINES",
      count: drafts.length,
      limit: MAX_TRANSACTION_LINES,
    });
  }

  const validated: ValidatedLedgerLine[] = [];
  for (const [index, line] of drafts.entries()) {
    const checked = validateLine(index, line as LedgerLineDraft, header.value);
    if (!checked.ok) return checked;
    validated.push(checked.value);
  }

  const canonical = canonicalizeLines(validated);
  if (!canonical.ok) return canonical;

  if (
    !canonical.value.some((line) => isPhysicalLocation(line.bucket.location))
  ) {
    return fail({ code: "NO_PHYSICAL_LINE" });
  }

  const conservation = conservationTotals(canonical.value);
  if (!conservation.ok) return conservation;
  for (const total of conservation.value) {
    if (total.minorUnits !== 0) {
      return fail({
        code: "UNBALANCED_TRANSACTION",
        conservationKey: total.conservationKey,
        residual: total.minorUnits,
        uom: total.uom,
      });
    }
  }

  return ok(
    Object.freeze({
      header: header.value,
      lines: Object.freeze(canonical.value),
      conservation: Object.freeze(conservation.value),
      deltas: Object.freeze(
        canonical.value.map((line) =>
          Object.freeze({
            bucketKey: line.bucketKey,
            bucket: line.bucket,
            quantity: line.quantity,
          }),
        ),
      ),
    }),
  );
}

function canonicalizeLines(
  lines: readonly ValidatedLedgerLine[],
): Result<ValidatedLedgerLine[], LedgerError> {
  const merged = new Map<string, ValidatedLedgerLine>();

  for (const line of lines) {
    const existing = merged.get(line.bucketKey);
    if (existing === undefined) {
      merged.set(line.bucketKey, line);
      continue;
    }
    if (existing.quantity.uom !== line.quantity.uom) {
      return fail({
        code: "BUCKET_UOM_CONFLICT",
        bucketKey: line.bucketKey,
        first: existing.quantity.uom,
        second: line.quantity.uom,
      });
    }
    const total = addQuantities(existing.quantity, line.quantity);
    if (!total.ok) {
      return fail({ code: "BALANCE_ARITHMETIC", cause: total.error });
    }
    merged.set(
      line.bucketKey,
      Object.freeze({ ...existing, quantity: total.value }),
    );
  }

  const canonical: ValidatedLedgerLine[] = [];
  for (const key of [...merged.keys()].sort()) {
    const line = merged.get(key)!;
    if (line.quantity.minorUnits === 0) {
      return fail({ code: "CANONICALIZED_LINE_IS_ZERO", bucketKey: key });
    }
    canonical.push(line);
  }
  return ok(canonical);
}

function conservationTotals(
  lines: readonly ValidatedLedgerLine[],
): Result<ConservationTotal[], LedgerError> {
  const totals = new Map<string, Quantity>();
  for (const line of lines) {
    const existing = totals.get(line.conservationKey);
    if (existing === undefined) {
      totals.set(line.conservationKey, line.quantity);
      continue;
    }
    const sum = addQuantities(existing, line.quantity);
    if (!sum.ok) return fail({ code: "BALANCE_ARITHMETIC", cause: sum.error });
    totals.set(line.conservationKey, sum.value);
  }

  const ordered: ConservationTotal[] = [];
  for (const key of [...totals.keys()].sort()) {
    const total = totals.get(key)!;
    ordered.push(
      Object.freeze({
        conservationKey: key,
        uom: total.uom,
        minorUnits: total.minorUnits,
      }),
    );
  }
  return ok(ordered);
}

export const MAX_LEDGER_MINOR_UNITS = MAX_QUANTITY_MINOR_UNITS;

export const ledgerQuantity = (
  minorUnits: number,
  uom: string,
): Result<Quantity, QuantityError> => makeQuantity(minorUnits, uom);

export const ledgerStoredQuantity = (
  quantity: Quantity,
): Result<Quantity, QuantityError> => validateQuantity(quantity);
