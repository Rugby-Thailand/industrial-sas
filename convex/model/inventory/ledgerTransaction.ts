/**
 * The ledger transaction: a header, immutable non-zero lines, and the invariants
 * that make the lines a double entry rather than a list of wishes.
 *
 * Status: **implemented.** Pure module (plan §6.2): no Convex imports, and no
 * imports outside `convex/model/**`.
 *
 * This module answers one question — *is this a postable transaction?* — and it
 * answers it without a database, which is why every rule it can enforce is
 * enforced here and every rule it cannot is named in the doc comment of the thing
 * that owes it. What needs storage (does this item belong to this organization,
 * does this location belong to this warehouse, is the resulting balance negative)
 * lives in `convex/lib/inventoryLedgerStore.ts` and `convex/model/inventory/balanceProjection.ts`.
 *
 * The invariants decided here, from plan §7.5 and `ADR-0003`:
 *
 * - `INV-0003-02` **Balanced.** Lines sum to zero within every *conservation
 *   group* — organization, warehouse, item, lot, serial, owner, UOM — while
 *   location, handling unit, and stock status are free to change. That is the
 *   whole of double entry here: putaway moves a location, a QC release moves a
 *   status, a receipt moves stock across a virtual boundary, and each is balanced.
 * - `INV-0003-03` **No zero line.** Including a line that only becomes zero after
 *   duplicate canonicalization, which is refused rather than dropped: a
 *   disappearing line is an intent nobody can see afterwards.
 * - Cross-warehouse movement is **not** silently expressible. A line whose
 *   warehouse differs from the header's is `LINE_WAREHOUSE_MISMATCH` — its own
 *   error, before the balance check, because "unbalanced" would be a misleading
 *   diagnosis of a transfer someone tried to write as a move.
 * - External flow crosses an explicit **virtual boundary** (`ADR-0003` §2), and
 *   the boundary's declared direction is checked: stock cannot be received *into*
 *   a supplier or scrapped *out of* the scrap sink.
 * - A transaction touches at least one **physical** location. Two virtual
 *   boundaries balancing against each other move nothing real.
 * - A **reason code** is required exactly where a reason is the only explanation:
 *   a reversal, an adjustment, and a scrap.
 *
 * Everything is total and returns a `Result`. Arithmetic goes through
 * `convex/model/uom/quantity.ts`, so the magnitude bound and the safe-integer
 * check are the ones `ADR-0004` already settled — a sum that would exceed
 * 10^12 thousandths is `OUT_OF_RANGE` from there, not a silently wrong total here.
 */
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

/* -------------------------------------------------------------------------- */
/* Closed value sets and bounds                                                */
/* -------------------------------------------------------------------------- */

/**
 * What kind of movement a transaction records.
 *
 * The type is documentation and a reporting dimension, not an authorization
 * decision — the permission code guards that — and not a licence to skip a rule:
 * every type balances, and every type's lines are immutable.
 */
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

/**
 * Types whose only explanation is a reason code.
 *
 * A receipt explains itself through its purchase order and a putaway through its
 * task. An adjustment, a scrap, and a reversal do not: something was wrong, and
 * the reason is the record of what (§7.5, `ADR-0003` §5).
 */
export const REASON_REQUIRED_TYPES: ReadonlySet<InventoryTransactionType> =
  new Set(["ADJUSTMENT", "SCRAP", "REVERSAL"]);

/**
 * The most lines one transaction may carry.
 *
 * A cap, not a default, and a rejection rather than a truncation. Large inbound
 * batches are chunked and resumable by design (§5 Q26, `ADR-0011`); a
 * thousand-line transaction is a client that skipped the chunking, and letting it
 * through would put an unbounded write set in one Convex transaction — the
 * contention failure plan §13 names.
 */
export const MAX_TRANSACTION_LINES = 200;

/** Longest a `source.type` or `source.id` may be. */
const MAX_SOURCE_FIELD_LENGTH = 128;

/** `PURCHASE_ORDER`, `PUTAWAY_TASK`, `CYCLE_COUNT`: an upper-snake provenance tag. */
const SOURCE_TYPE_PATTERN = /^[A-Z][A-Z0-9_]{0,62}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_.-]+$/;

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Every way a transaction can be refused, named.
 *
 * Structured, never prose: the UI owns translation (D-06), and a caller that has
 * to match on a message string is a caller that breaks when the message improves.
 * `bucket` and `line` errors nest the underlying value error so the reason a
 * quantity was rejected is not flattened into "invalid line".
 */
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

/* -------------------------------------------------------------------------- */
/* Values                                                                      */
/* -------------------------------------------------------------------------- */

/** One posting, as a caller writes it: a bucket and a signed quantity. */
export interface LedgerLineDraft {
  readonly bucket: InventoryBucket;
  readonly quantity: Quantity;
}

/** A posting that has been validated, keyed, and grouped. Frozen. */
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

/** The validated header. Frozen; absent optionals are omitted, not `undefined`. */
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

/** One conservation group's total, which a valid transaction proves is zero. */
export interface ConservationTotal {
  readonly conservationKey: string;
  readonly uom: string;
  readonly minorUnits: number;
}

/** The net effect on one bucket: what the projection applies. */
export interface BucketDelta {
  readonly bucketKey: string;
  readonly bucket: InventoryBucket;
  readonly quantity: Quantity;
}

/**
 * A transaction that satisfies every rule this module can decide.
 *
 * `lines` is canonical: duplicates on one bucket are summed, and the result is
 * ordered by `bucketKey`. That ordering is not cosmetic — it makes the stored
 * `lineIndex` a function of the transaction's content rather than of the order a
 * client happened to send, so a replay reconstructs byte-identical lines and two
 * clients expressing the same intent produce the same rows.
 */
export interface ValidatedLedgerTransaction {
  readonly header: ValidatedLedgerHeader;
  readonly lines: readonly ValidatedLedgerLine[];
  readonly conservation: readonly ConservationTotal[];
  readonly deltas: readonly BucketDelta[];
}

/* -------------------------------------------------------------------------- */
/* Header validation                                                           */
/* -------------------------------------------------------------------------- */

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

/**
 * Validate the header, including the reversal link's consistency with the type.
 *
 * The link and the type must agree in both directions. A `REVERSAL` with no
 * original is a compensating posting with nothing to compensate; a `RECEIPT` that
 * names an original is a transaction claiming a relationship its type does not
 * have, and either would make the reversal index a lie.
 */
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

/* -------------------------------------------------------------------------- */
/* Line validation                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The direction rule for a virtual boundary.
 *
 * A `SOURCE` boundary supplies stock, so its own line is negative — receiving ten
 * cases is `+10` at the dock and `-10` at `SUPPLIER_RECEIPT`. A positive line
 * there says stock was put *into* the supplier, which is a shipment wearing a
 * receipt's clothes.
 */
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
  // A reversal runs the boundary backwards on purpose: undoing a receipt puts
  // stock back on the supplier's side of a `SOURCE`. Its direction is justified by
  // the original transaction, whose own direction was checked when it posted, and
  // `planReversal` proves the lines are that original's exact negation. Applying
  // the rule here would make every reversal of an external flow unpostable —
  // which would leave a wrong receipt with no correction path at all, the outcome
  // `ADR-0003` §5 exists to prevent.
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

/* -------------------------------------------------------------------------- */
/* Transaction validation                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Validate a whole transaction: header, lines, canonicalization, boundaries, and
 * conservation.
 *
 * Order matters and is deliberate. Every *local* fault — a forged quantity, a
 * foreign warehouse, a boundary posted backwards — is reported as itself before
 * the global balance check runs, because "unbalanced" is a true but useless
 * diagnosis of a transaction whose third line names another tenant's item.
 *
 * The answer is a whole new value; the draft is never mutated, and every record
 * and array in the answer is shallow-frozen.
 */
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

/**
 * Sum duplicate lines on one bucket, and order the result by `bucketKey`.
 *
 * Two lines on the same bucket are a safe canonicalization — `+3` and `+2` on one
 * bin is `+5` there, and no information is lost — but only when they share a UOM.
 * They cannot legitimately differ: a bucket names one item, and an item has one
 * base UOM (`ADR-0004`). A pair that does differ is `BUCKET_UOM_CONFLICT` rather
 * than two rows, because storing both would make the bucket's balance a value with
 * two units.
 *
 * A merged total of zero is refused, not dropped. `+5` and `-5` on one bin is a
 * caller who has expressed something — probably a movement they meant to route
 * through two different buckets — and a silently vanished pair is the version of
 * that mistake nobody finds later (`INV-0003-03`).
 */
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

/**
 * Total every conservation group, in a deterministic order.
 *
 * Each running total goes through `addQuantities`, so an intermediate beyond
 * `MAX_QUANTITY_MINOR_UNITS` is `OUT_OF_RANGE` from the quantity module rather
 * than a double that silently stopped being an integer. That is the overflow
 * rejection: it fires before any balance is written, so an over-large transaction
 * leaves nothing behind.
 */
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

/**
 * The magnitude bound, restated for callers that need to reject an input before
 * building a quantity. Re-exported rather than duplicated (`ADR-0004`).
 */
export const MAX_LEDGER_MINOR_UNITS = MAX_QUANTITY_MINOR_UNITS;

/**
 * A quantity from signed minor units, for callers assembling a draft.
 *
 * A thin re-export of `makeQuantity`, present so a feature module building a
 * ledger line does not have to import two modules to build one line, and so the
 * bound it is checked against is unambiguously the ledger's.
 */
export const ledgerQuantity = (
  minorUnits: number,
  uom: string,
): Result<Quantity, QuantityError> => makeQuantity(minorUnits, uom);

/** Re-check a quantity read back out of a stored line. */
export const ledgerStoredQuantity = (
  quantity: Quantity,
): Result<Quantity, QuantityError> => validateQuantity(quantity);
