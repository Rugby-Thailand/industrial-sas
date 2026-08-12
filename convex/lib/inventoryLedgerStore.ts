/**
 * The inventory ledger's persistence seam.
 *
 * This is the **only** module that writes `inventoryTransactions`,
 * `inventoryLedgerLines`, or `inventoryBalances`. That is not a convention:
 * `scripts/verify-tenant-boundary.mjs` fails the build if any other production
 * Convex file inserts into a balance table, and if any file at all patches,
 * replaces, or deletes a ledger or audit row (`INV-0003-07`, `INV-0003-11`, plan
 * §12). `convex/inventory/ledger.ts` holds the public functions and calls in here;
 * it cannot write a balance even by accident.
 *
 * Everything below runs inside a caller's Convex transaction, through the
 * tenant-bound accessor it was handed (`TenantDocumentAccess`, `G-102`). It never
 * sees `ctx.db`, never resolves a tenant, and never decides a permission — those
 * happened in `mutationWithOrg` before the handler ran.
 *
 * ### What the posting path does, in order
 *
 * 1. **Idempotency first** (`INV-0003-01`). One bounded read of
 *    `idempotencyRecords.by_orgId_operation_requestId`. A record whose
 *    `requestHash` matches replays the original result and posts nothing; one whose
 *    hash differs is `REQUEST_ARGUMENT_CONFLICT`, because the same key with
 *    different arguments is a reused ID, not a retry.
 * 2. **Reference ownership** (`INV-0003-04`, `INV-0003-05`). Every item, location,
 *    lot, handling unit, owner, and reason code is read *through the accessor*, so
 *    an ID belonging to another tenant is indistinguishable from one that does not
 *    exist. Then the edges: a location belongs to the header's warehouse, a lot
 *    belongs to its line's item, the quantity's UOM is the item's base UOM, a
 *    reason code's scope matches the transaction type.
 * 3. **Pure validation.** `validateLedgerTransaction` decides balance,
 *    canonicalization, boundary direction, zero lines, and magnitude.
 * 4. **Prior balances**, one bounded read per touched bucket.
 * 5. **Project and check.** `applyPostingsChecked` folds the deltas and refuses a
 *    negative physical balance — `AVAILABLE` unconditionally (D-12,
 *    `INV-0003-06`). Nothing has been written at this point, so a refusal leaves
 *    the transaction untouched.
 * 6. **Write**, in one transaction: header, lines, balances, audit row, idempotency
 *    record (`INV-0003-09`, `INV-0003-12`).
 *
 * There is no application lock anywhere. Convex is serializable and retries a
 * conflicting mutation; a lock would add deadlock risk and latency to solve a
 * problem the platform already solves (`OPS-0003-01`, §5 Q30). The read of a
 * bucket's balance and the write of it happen in the same transaction, which is
 * what makes the read-modify-write safe under contention.
 *
 * ### Replay is reconstruction, not storage
 *
 * `idempotencyRecords` stores a reference and two digests, never the payloads —
 * an idempotency table holding requests and responses becomes a second, unaudited
 * copy of domain data and a place for PII to collect (§14). So a replay *rebuilds*
 * the original result from the immutable header and lines and then verifies it
 * against `resultHash`. Because the rows are immutable and the line order is
 * canonical, the rebuild is exact; because it is verified, a rebuild that somehow
 * differs is a named failure rather than a plausible-looking wrong answer.
 */
import {
  checkIdempotency,
  fingerprintArguments,
  sha256Hex,
  writeIdempotencyRecord,
  IDEMPOTENCY_RETENTION_MS as SHARED_IDEMPOTENCY_RETENTION_MS,
  type IdempotencyRecord,
} from "./idempotency";
import {
  balanceAt,
  balanceEntries,
  applyPostingsChecked,
  balanceSheetFromRows,
  reconcileBalances,
  type BalanceDrift,
  type BalanceSheet,
  type BucketBalance,
  type LedgerPosting,
} from "../model/inventory/balanceProjection";
import {
  MAX_TRANSACTION_LINES,
  validateLedgerTransaction,
  type LedgerError,
  type LedgerTransactionDraft,
  type ValidatedLedgerLine,
  type ValidatedLedgerTransaction,
} from "../model/inventory/ledgerTransaction";
import {
  makeJobPage,
  type JobPage,
  type JobPageRequest,
} from "../model/inventory/jobPage";
import {
  canonicalArgumentText,
  validateRequestId,
} from "../model/inventory/requestIdentity";
import {
  planReversal,
  type OriginalTransaction,
} from "../model/inventory/reversal";
import {
  decodeBucketKey,
  encodeBucketKey,
  isPhysicalLocation,
  validateBucket,
  type InventoryBucket,
  type LedgerLocation,
  type StockStatus,
} from "../model/inventory/stockIdentity";
import {
  businessDateFromInstant,
  businessDateToIso,
  zoneById,
} from "../model/time/businessDate";
import {
  makeQuantity,
  validateQuantity,
  type Quantity,
} from "../model/uom/quantity";
import { fail, ok, type Result } from "../model/result";
import { adjustRollup } from "./rollupStore";
import type { ActiveTenantContext } from "./tenantContext";
import {
  TENANT_INDEX_MAX_PAGE_SIZE,
  type TenantDocumentAccess,
  type TenantOrgId,
} from "./tenantDb";
import type {
  InventoryTransactionTypeValue,
  ReasonCodeScope,
} from "./validators";

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Everything the store can refuse that the pure kernel cannot see.
 *
 * Split from `LedgerError` rather than merged into it because the kernel is
 * portable domain algebra with no notion of a document: "this location belongs to
 * another warehouse" is only decidable with storage, and putting the code in the
 * pure union would imply the kernel could raise it.
 */
export type LedgerReferenceError =
  | {
      readonly code: "REFERENCE_NOT_FOUND";
      readonly table: string;
      readonly reference: string;
    }
  | {
      readonly code: "REFERENCE_INACTIVE";
      readonly table: string;
      readonly reference: string;
    }
  | {
      readonly code: "LOCATION_WAREHOUSE_MISMATCH";
      readonly locationId: string;
      readonly expected: string;
    }
  | {
      readonly code: "LOT_ITEM_MISMATCH";
      readonly lotId: string;
      readonly expected: string;
    }
  | {
      readonly code: "HANDLING_UNIT_WAREHOUSE_MISMATCH";
      readonly handlingUnitId: string;
      readonly expected: string;
    }
  | {
      readonly code: "HANDLING_UNIT_TWO_LOCATIONS";
      readonly handlingUnitId: string;
      readonly first: string;
      readonly second: string;
    }
  | {
      readonly code: "LINE_UOM_NOT_BASE_UOM";
      readonly itemId: string;
      readonly baseUom: string;
      readonly received: string;
    }
  | { readonly code: "LOT_REQUIRED"; readonly itemId: string }
  | { readonly code: "LOT_NOT_TRACKED"; readonly itemId: string }
  | { readonly code: "SERIAL_FLOWS_DISABLED" }
  | { readonly code: "CONSIGNED_STOCK_DISABLED" }
  | {
      readonly code: "REASON_CODE_SCOPE_MISMATCH";
      readonly reasonCodeId: string;
      readonly scope: string;
      readonly type: string;
    }
  | {
      readonly code: "REVERSAL_WAREHOUSE_MISMATCH";
      readonly expected: string;
      readonly received: string;
    }
  | {
      readonly code: "TRANSACTION_OUT_OF_WAREHOUSE_SCOPE";
      readonly expected: string;
      readonly received: string;
    }
  | {
      readonly code: "BUCKET_OUT_OF_WAREHOUSE_SCOPE";
      readonly expected: string;
      readonly received: string;
    }
  | { readonly code: "REQUEST_ARGUMENT_CONFLICT"; readonly requestId: string }
  | { readonly code: "REPLAY_RESULT_UNVERIFIABLE"; readonly requestId: string }
  | { readonly code: "REPLAY_TRANSACTION_MISSING"; readonly requestId: string }
  | {
      readonly code: "REQUEST_ID_ALREADY_USED";
      readonly requestId: string;
    }
  | {
      readonly code: "UNKNOWN_ORGANIZATION_TIMEZONE";
      readonly timezone: string;
    }
  | {
      readonly code: "STORED_ROW_INVALID";
      readonly table: string;
      readonly reference: string;
    }
  | {
      readonly code: "RECONCILIATION_UOM_UNKNOWN";
      readonly bucketKey: string;
    };

export type LedgerStoreError = LedgerError | LedgerReferenceError;

/**
 * The wire form of a refusal: the code, plus the diagnostic fields that actually
 * occur across both unions.
 *
 * A flat projection rather than the structured error itself, because a Convex
 * `returns` validator has to describe a fixed shape and a discriminated union of
 * thirty members would be unreadable and unmaintainable. `code` is the contract a
 * caller may switch on; everything else is diagnosis. A nested `cause` is
 * flattened to `causeCode` — one level, because that is how deep the unions nest.
 */
export interface PublicLedgerError {
  readonly code: string;
  readonly field?: string;
  readonly table?: string;
  readonly reference?: string;
  readonly index?: number;
  readonly bucketKey?: string;
  readonly conservationKey?: string;
  readonly stockStatus?: string;
  readonly uom?: string;
  readonly expected?: string;
  readonly received?: string;
  readonly reason?: string;
  readonly boundary?: string;
  readonly transactionId?: string;
  readonly amount?: number;
  readonly limit?: number;
  readonly causeCode?: string;
}

const NUMERIC_ERROR_FIELDS = [
  "residual",
  "resulting",
  "count",
  "returned",
  "length",
] as const;

/** Flatten a structured refusal into the wire shape. Never loses the `code`. */
export function toPublicLedgerError(
  error: LedgerStoreError,
): PublicLedgerError {
  const source = error as unknown as Record<string, unknown>;
  const text = (key: string): string | undefined => {
    const value = source[key];
    return typeof value === "string" ? value : undefined;
  };
  const amount = NUMERIC_ERROR_FIELDS.map((key) => source[key]).find(
    (value): value is number => typeof value === "number",
  );
  const cause = source["cause"];
  const causeCode =
    cause !== null && typeof cause === "object" && "code" in cause
      ? String((cause as { code: unknown }).code)
      : undefined;

  return Object.freeze({
    code: error.code,
    ...(text("field") === undefined ? {} : { field: text("field")! }),
    ...(text("table") === undefined ? {} : { table: text("table")! }),
    ...(text("reference") === undefined
      ? {}
      : { reference: text("reference")! }),
    ...(typeof source["index"] === "number" ? { index: source["index"] } : {}),
    ...(text("bucketKey") === undefined
      ? {}
      : { bucketKey: text("bucketKey")! }),
    ...(text("conservationKey") === undefined
      ? {}
      : { conservationKey: text("conservationKey")! }),
    ...(text("stockStatus") === undefined
      ? {}
      : { stockStatus: text("stockStatus")! }),
    ...(text("uom") === undefined ? {} : { uom: text("uom")! }),
    ...(text("expected") === undefined ? {} : { expected: text("expected")! }),
    ...(text("received") === undefined ? {} : { received: text("received")! }),
    ...(text("reason") === undefined ? {} : { reason: text("reason")! }),
    ...(text("boundary") === undefined ? {} : { boundary: text("boundary")! }),
    ...(text("transactionId") === undefined
      ? {}
      : { transactionId: text("transactionId")! }),
    ...(amount === undefined ? {} : { amount }),
    ...(typeof source["limit"] === "number" ? { limit: source["limit"] } : {}),
    ...(causeCode === undefined ? {} : { causeCode }),
  });
}

/* -------------------------------------------------------------------------- */
/* Stored shapes                                                               */
/* -------------------------------------------------------------------------- */

type ItemRow = {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly sku: string;
  readonly baseUom: string;
  readonly trackingMode: "NONE" | "LOT" | "LOT_SERIAL";
  readonly status: "ACTIVE" | "INACTIVE";
};

type LocationRow = {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly warehouseId: string;
  readonly code: string;
  readonly status: "ACTIVE" | "INACTIVE";
};

type LotRow = {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly itemId: string;
  readonly lotCode: string;
  readonly expirationDate?: string;
  readonly status: "ACTIVE" | "INACTIVE";
};

type HandlingUnitRow = {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly warehouseId: string;
  readonly lpn: string;
  readonly currentLocationId?: string;
  readonly status: "ACTIVE" | "INACTIVE";
};

type OwnerRow = {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly code: string;
  readonly status: "ACTIVE" | "INACTIVE";
};

type ReasonCodeRow = {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly code: string;
  readonly scope: ReasonCodeScope;
  readonly status: "ACTIVE" | "INACTIVE";
};

type DeviceRow = { readonly _id: string; readonly orgId: TenantOrgId };

type TransactionRow = {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly warehouseId: string;
  readonly type: InventoryTransactionTypeValue;
  readonly operation: string;
  readonly requestId: string;
  readonly actorUserId: string;
  readonly deviceId?: string;
  readonly occurredAt: number;
  readonly businessDate: string;
  readonly source: { readonly type: string; readonly id: string };
  readonly reversalOfTransactionId?: string;
  readonly reasonCodeId?: string;
  readonly lineCount: number;
  readonly conservationGroupCount: number;
};

type LineRow = {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly transactionId: string;
  readonly lineIndex: number;
  readonly warehouseId: string;
  readonly occurredAt: number;
  readonly itemId: string;
  readonly locationKind: "PHYSICAL" | "VIRTUAL";
  readonly locationId?: string;
  readonly virtualBoundary?: string;
  readonly lotId?: string;
  readonly serialId?: string;
  readonly handlingUnitId?: string;
  readonly ownerId?: string;
  readonly stockStatus: StockStatus;
  readonly bucketKey: string;
  readonly conservationKey: string;
  readonly quantity: Quantity;
};

type BalanceRow = {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly bucketKey: string;
  readonly warehouseId: string;
  readonly stockStatus: StockStatus;
  readonly quantity: Quantity;
};

/**
 * The replay index row, as `convex/lib/idempotency.ts` defines it.
 *
 * Aliased rather than redeclared: two structurally identical declarations of the
 * same table's shape is exactly how a field added in one place goes unread in the
 * other.
 */
type IdempotencyRow = IdempotencyRecord;

/* -------------------------------------------------------------------------- */
/* Results                                                                     */
/* -------------------------------------------------------------------------- */

/** One posted line, as a caller sees it. */
export interface PostedLine {
  readonly lineIndex: number;
  readonly bucketKey: string;
  readonly itemId: string;
  readonly stockStatus: StockStatus;
  readonly uom: string;
  readonly minorUnits: number;
}

/** One resulting balance, as a caller sees it. */
export interface PostedBalance {
  readonly bucketKey: string;
  readonly uom: string;
  readonly minorUnits: number;
}

/**
 * The result of a posting: the header and its lines, and nothing else.
 *
 * Two deliberate absences. There is no "was this a replay" flag — that is a fact
 * about the *call*, not about the transaction, and mixing it in would make a
 * replayed result structurally different from the original, which is exactly the
 * property `INV-0003-01` asks for. And there are no balances: a balance is current
 * state that later postings legitimately move, so including one would make a
 * replay's answer depend on when it was replayed. Both travel alongside, in
 * `PostOutcome`.
 *
 * What is left is derived entirely from immutable rows in a canonical order, which
 * is why a replay can rebuild it byte for byte and why `resultHash` can verify that
 * it did.
 */
export interface PostedTransaction {
  readonly transactionId: string;
  readonly requestId: string;
  readonly operation: string;
  readonly type: InventoryTransactionTypeValue;
  readonly warehouseId: string;
  readonly occurredAt: number;
  readonly businessDate: string;
  readonly lineCount: number;
  readonly conservationGroupCount: number;
  readonly reversalOfTransactionId?: string;
  readonly lines: readonly PostedLine[];
}

/**
 * A posting outcome: the replay-stable result, whether this call created it, and
 * the current balances of the buckets it touched.
 *
 * `balances` is what the transaction wrote on a fresh post and what the buckets hold
 * *now* on a replay. Both are true statements about the same buckets, and keeping
 * them out of `result` is what lets the caller compare a replay to an original
 * without a clock in the comparison.
 */
export interface PostOutcome {
  readonly result: PostedTransaction;
  readonly replayed: boolean;
  readonly balances: readonly PostedBalance[];
}

/* -------------------------------------------------------------------------- */
/* Digests                                                                     */
/* -------------------------------------------------------------------------- */

/*
 * `sha256Hex` is imported from `convex/lib/idempotency.ts`. The two canonical-text
 * builders below stay here: *what* a posting fingerprints is a ledger decision,
 * and the shared module deliberately takes no opinion on it.
 */

/**
 * What a posting fingerprints.
 *
 * Everything that decides what gets written, and nothing that does not: the
 * organization, warehouse, type, operation, request ID, source, reason, reversal
 * link, and the ordered lines. Not the actor, not the device, not the clock — a
 * retry from a second handheld under the same request ID is still the same intent,
 * and fingerprinting the device would turn a legitimate retry into
 * `REQUEST_ARGUMENT_CONFLICT`.
 *
 * Returns the payload rather than the digest, because the shared idempotency
 * module owns canonicalization and hashing while this file owns *which fields
 * count*. That split is what lets a second writer reuse the machinery without
 * inheriting the ledger's opinion about arguments.
 */
export function ledgerRequestPayload(
  transaction: ValidatedLedgerTransaction,
): unknown {
  const header = transaction.header;
  return {
    orgId: header.orgId,
    warehouseId: header.warehouseId,
    type: header.type,
    operation: header.operation,
    requestId: header.requestId,
    source: { type: header.source.type, id: header.source.id },
    ...(header.reasonCodeId === undefined
      ? {}
      : { reasonCodeId: header.reasonCodeId }),
    ...(header.reversalOfTransactionId === undefined
      ? {}
      : { reversalOfTransactionId: header.reversalOfTransactionId }),
    lines: transaction.lines.map((line) => ({
      bucketKey: line.bucketKey,
      uom: line.quantity.uom,
      minorUnits: line.quantity.minorUnits,
    })),
  };
}

/** The canonical text of a posting result, for the integrity digest. */
export function ledgerResultCanonicalText(
  result: PostedTransaction,
): Result<string, LedgerStoreError> {
  const text = canonicalArgumentText(result as unknown);
  if (!text.ok) {
    return fail({ code: "REQUEST_IDENTITY_INVALID", cause: text.error });
  }
  return ok(text.value);
}

/* -------------------------------------------------------------------------- */
/* Reference resolution                                                        */
/* -------------------------------------------------------------------------- */

interface ResolvedReferences {
  readonly items: ReadonlyMap<string, ItemRow>;
  readonly locations: ReadonlyMap<string, LocationRow>;
  readonly lots: ReadonlyMap<string, LotRow>;
  readonly handlingUnits: ReadonlyMap<string, HandlingUnitRow>;
  readonly owners: ReadonlyMap<string, OwnerRow>;
}

async function activeRow<
  Row extends { readonly status: "ACTIVE" | "INACTIVE" },
>(
  tenantDb: TenantDocumentAccess,
  table:
    "items" | "locations" | "lots" | "handlingUnits" | "owners" | "reasonCodes",
  id: string,
): Promise<Result<Row, LedgerReferenceError>> {
  const row = await tenantDb.get<Row & { orgId: TenantOrgId }>(table, id);
  if (row === null) {
    return fail({ code: "REFERENCE_NOT_FOUND", table, reference: id });
  }
  if (row.status !== "ACTIVE") {
    return fail({ code: "REFERENCE_INACTIVE", table, reference: id });
  }
  return ok(row);
}

/**
 * Read and cross-check every reference the transaction names.
 *
 * Every read goes through the tenant-bound accessor, so a foreign ID answers
 * `null` and is reported as `REFERENCE_NOT_FOUND` — the same answer as an ID that
 * never existed, which is what stops the error from confirming another tenant's
 * rows (`INV-0002-03`).
 *
 * The edges checked here are the ones plan §7.5 names and a document read can
 * decide: location-in-warehouse, lot-of-item, handling-unit-in-warehouse, the
 * quantity's UOM against the item's base UOM, the tracking mode against the
 * presence of a lot, and the two disabled capabilities (serial flows, consigned
 * stock) refused rather than silently accepted.
 */
async function resolveReferences(
  tenantDb: TenantDocumentAccess,
  tenant: ActiveTenantContext,
  transaction: ValidatedLedgerTransaction,
): Promise<Result<ResolvedReferences, LedgerStoreError>> {
  const items = new Map<string, ItemRow>();
  const locations = new Map<string, LocationRow>();
  const lots = new Map<string, LotRow>();
  const handlingUnits = new Map<string, HandlingUnitRow>();
  const owners = new Map<string, OwnerRow>();
  const settings = tenant.organization.settings;
  const warehouseId = transaction.header.warehouseId;

  for (const line of transaction.lines) {
    const bucket = line.bucket;

    if (bucket.serialId !== undefined) {
      return fail({ code: "SERIAL_FLOWS_DISABLED" });
    }

    let item = items.get(bucket.itemId);
    if (item === undefined) {
      const row = await activeRow<ItemRow>(tenantDb, "items", bucket.itemId);
      if (!row.ok) return row;
      item = row.value;
      items.set(bucket.itemId, item);
    }
    if (item.baseUom !== line.quantity.uom) {
      return fail({
        code: "LINE_UOM_NOT_BASE_UOM",
        itemId: bucket.itemId,
        baseUom: item.baseUom,
        received: line.quantity.uom,
      });
    }
    if (item.trackingMode === "LOT_SERIAL") {
      return fail({ code: "SERIAL_FLOWS_DISABLED" });
    }
    if (item.trackingMode === "LOT" && bucket.lotId === undefined) {
      return fail({ code: "LOT_REQUIRED", itemId: bucket.itemId });
    }
    if (item.trackingMode === "NONE" && bucket.lotId !== undefined) {
      return fail({ code: "LOT_NOT_TRACKED", itemId: bucket.itemId });
    }

    if (isPhysicalLocation(bucket.location)) {
      const locationId = bucket.location.locationId;
      let location = locations.get(locationId);
      if (location === undefined) {
        const row = await activeRow<LocationRow>(
          tenantDb,
          "locations",
          locationId,
        );
        if (!row.ok) return row;
        location = row.value;
        locations.set(locationId, location);
      }
      if (location.warehouseId !== warehouseId) {
        return fail({
          code: "LOCATION_WAREHOUSE_MISMATCH",
          locationId,
          expected: warehouseId,
        });
      }
    }

    if (bucket.lotId !== undefined) {
      let lot = lots.get(bucket.lotId);
      if (lot === undefined) {
        const row = await activeRow<LotRow>(tenantDb, "lots", bucket.lotId);
        if (!row.ok) return row;
        lot = row.value;
        lots.set(bucket.lotId, lot);
      }
      if (lot.itemId !== bucket.itemId) {
        return fail({
          code: "LOT_ITEM_MISMATCH",
          lotId: bucket.lotId,
          expected: bucket.itemId,
        });
      }
    }

    if (bucket.handlingUnitId !== undefined) {
      let unit = handlingUnits.get(bucket.handlingUnitId);
      if (unit === undefined) {
        const row = await activeRow<HandlingUnitRow>(
          tenantDb,
          "handlingUnits",
          bucket.handlingUnitId,
        );
        if (!row.ok) return row;
        unit = row.value;
        handlingUnits.set(bucket.handlingUnitId, unit);
      }
      if (unit.warehouseId !== warehouseId) {
        return fail({
          code: "HANDLING_UNIT_WAREHOUSE_MISMATCH",
          handlingUnitId: bucket.handlingUnitId,
          expected: warehouseId,
        });
      }
    }

    if (bucket.ownerId !== undefined) {
      if (!settings.consignedStockEnabled) {
        return fail({ code: "CONSIGNED_STOCK_DISABLED" });
      }
      if (!owners.has(bucket.ownerId)) {
        const row = await activeRow<OwnerRow>(
          tenantDb,
          "owners",
          bucket.ownerId,
        );
        if (!row.ok) return row;
        owners.set(bucket.ownerId, row.value);
      }
    }
  }

  const reasonCodeId = transaction.header.reasonCodeId;
  if (reasonCodeId !== undefined) {
    const row = await activeRow<ReasonCodeRow>(
      tenantDb,
      "reasonCodes",
      reasonCodeId,
    );
    if (!row.ok) return row;
    const expected = reasonScopeForType(transaction.header.type);
    if (expected !== null && row.value.scope !== expected) {
      return fail({
        code: "REASON_CODE_SCOPE_MISMATCH",
        reasonCodeId,
        scope: row.value.scope,
        type: transaction.header.type,
      });
    }
  }

  return ok(
    Object.freeze({
      items,
      locations,
      lots,
      handlingUnits,
      owners,
    }),
  );
}

/**
 * The reason-code scope a transaction type must cite.
 *
 * `null` means "any active code will do", which is the honest answer for types
 * that may optionally carry one. The three types that *require* a reason each
 * require a matching scope, so a code minted for scrap cannot become the
 * justification for a reversal.
 */
function reasonScopeForType(
  type: InventoryTransactionTypeValue,
): ReasonCodeScope | null {
  switch (type) {
    case "ADJUSTMENT":
      return "ADJUSTMENT";
    case "SCRAP":
      return "SCRAP";
    case "REVERSAL":
      return "REVERSAL";
    case "STATUS_CHANGE":
      return "STATUS_CHANGE";
    default:
      return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Balance reads and writes                                                    */
/* -------------------------------------------------------------------------- */

function bucketBalanceOfRow(
  row: BalanceRow,
): Result<BucketBalance, LedgerStoreError> {
  const bucket = decodeBucketKey(row.bucketKey);
  if (!bucket.ok) {
    return fail({
      code: "STORED_ROW_INVALID",
      table: "inventoryBalances",
      reference: row._id,
    });
  }
  const quantity = validateQuantity(row.quantity);
  if (!quantity.ok) {
    return fail({
      code: "STORED_ROW_INVALID",
      table: "inventoryBalances",
      reference: row._id,
    });
  }
  return ok(
    Object.freeze({
      bucketKey: row.bucketKey,
      bucket: bucket.value,
      quantity: quantity.value,
    }),
  );
}

/**
 * Read the current balance row of every bucket the transaction touches.
 *
 * One `unique()` per bucket, which is a two-row read on an `orgId`-first index —
 * bounded, and it is also where a broken uniqueness contract surfaces: a second
 * row under one bucket key throws `INVALID_INDEX_RESULT` from the accessor rather
 * than silently picking one.
 */
async function readTouchedBalances(
  tenantDb: TenantDocumentAccess,
  bucketKeys: readonly string[],
): Promise<
  Result<
    { sheet: BalanceSheet; rows: ReadonlyMap<string, BalanceRow> },
    LedgerStoreError
  >
> {
  const rows = new Map<string, BalanceRow>();
  const balances: BucketBalance[] = [];

  for (const bucketKey of [...new Set(bucketKeys)].sort()) {
    const row = await tenantDb
      .byIndex<BalanceRow>("inventoryBalances", "by_orgId_bucketKey", [
        { field: "bucketKey", value: bucketKey },
      ])
      .unique();
    if (row === null) continue;
    rows.set(bucketKey, row);
    const balance = bucketBalanceOfRow(row);
    if (!balance.ok) return balance;
    balances.push(balance.value);
  }

  const sheet = balanceSheetFromRows(balances);
  if (!sheet.ok) return sheet;
  return ok({ sheet: sheet.value, rows });
}

/** The dimension columns of a bucket, for a ledger line or a balance row. */
function bucketColumns(bucket: InventoryBucket): Record<string, unknown> {
  const location: LedgerLocation = bucket.location;
  return {
    itemId: bucket.itemId,
    locationKind: location.kind,
    ...(location.kind === "PHYSICAL"
      ? { locationId: location.locationId }
      : { virtualBoundary: location.boundary }),
    ...(bucket.lotId === undefined ? {} : { lotId: bucket.lotId }),
    ...(bucket.serialId === undefined ? {} : { serialId: bucket.serialId }),
    ...(bucket.handlingUnitId === undefined
      ? {}
      : { handlingUnitId: bucket.handlingUnitId }),
    ...(bucket.ownerId === undefined ? {} : { ownerId: bucket.ownerId }),
    stockStatus: bucket.stockStatus,
  };
}

/* -------------------------------------------------------------------------- */
/* Handling-unit occupancy                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The one occupancy rule this foundation can enforce (`INV-0005-04`).
 *
 * After the transaction, each handling unit it touched must hold non-zero stock in
 * at most one physical location — decided over the buckets this transaction read or
 * wrote, which is the bounded set it has in hand. A unit whose stored
 * `currentLocationId` names a location the transaction did not touch, and which
 * ends up holding stock somewhere else, is `HANDLING_UNIT_TWO_LOCATIONS`.
 *
 * Stated as a limitation rather than as a guarantee: this cannot see a unit's stock
 * in a bucket the transaction never mentions, because finding that would be an
 * unbounded read of every bucket naming the unit. Full containment accounting —
 * `handlingUnitContents`, split, merge, nest, unnest — is `ADR-0005` §9 and is not
 * in this task. What is guaranteed is that no *single* transaction can put one unit
 * in two places, and that `currentLocationId` is maintained by the ledger rather
 * than edited by hand.
 */
function resultingUnitLocation(
  sheet: BalanceSheet,
  handlingUnitId: string,
): Result<string | null, LedgerStoreError> {
  let found: string | null = null;
  for (const balance of balanceEntries(sheet)) {
    if (balance.bucket.handlingUnitId !== handlingUnitId) continue;
    if (balance.quantity.minorUnits === 0) continue;
    if (!isPhysicalLocation(balance.bucket.location)) continue;
    const locationId = balance.bucket.location.locationId;
    if (found === null) {
      found = locationId;
      continue;
    }
    if (found !== locationId) {
      return fail({
        code: "HANDLING_UNIT_TWO_LOCATIONS",
        handlingUnitId,
        first: found,
        second: locationId,
      });
    }
  }
  return ok(found);
}

/* -------------------------------------------------------------------------- */
/* Posting                                                                     */
/* -------------------------------------------------------------------------- */

/** What the caller hands the store: a draft, and the trusted context around it. */
export interface PostLedgerTransactionInput {
  readonly tenantDb: TenantDocumentAccess;
  readonly tenant: ActiveTenantContext;
  readonly permissionCode: string;
  /** Server clock. A client-supplied instant would let a device backdate stock. */
  readonly now: number;
  /** Opaque PWA installation value, for device correlation only. Never a device ID. */
  readonly installationId?: string | undefined;
  readonly draft: LedgerTransactionDraft;
}

/**
 * Post a transaction, or replay the one this request already produced.
 *
 * The whole of the write happens in the caller's transaction, so the header, the
 * lines, the balances, the audit row, and the idempotency record either all commit
 * or none do (`INV-0003-09`, `INV-0003-12`).
 */
export async function postLedgerTransaction(
  input: PostLedgerTransactionInput,
): Promise<Result<PostOutcome, LedgerStoreError>> {
  const { tenantDb, tenant, draft, now } = input;

  const transaction = validateLedgerTransaction(draft);
  if (!transaction.ok) return transaction;
  const header = transaction.value.header;

  const requestPayload = ledgerRequestPayload(transaction.value);
  const fingerprint = await fingerprintArguments(requestPayload);
  if (!fingerprint.ok) return fingerprint;
  const requestHash = fingerprint.value;

  // 1. Idempotency, before anything is read or written.
  const decision = await checkIdempotency({
    tenantDb,
    operation: header.operation,
    requestId: header.requestId,
    requestHash,
  });
  if (!decision.ok) return decision;
  if (decision.value.kind === "REPLAY") {
    return await replayPostedTransaction(tenantDb, decision.value.record);
  }

  // 2. References and their edges.
  const references = await resolveReferences(
    tenantDb,
    tenant,
    transaction.value,
  );
  if (!references.ok) return references;

  // 3. Business date, from the organization's timezone rather than the host's.
  const zone = zoneById(tenant.organization.settings.timezone);
  if (!zone.ok) {
    return fail({
      code: "UNKNOWN_ORGANIZATION_TIMEZONE",
      timezone: String(tenant.organization.settings.timezone),
    });
  }
  const businessDate = businessDateFromInstant(header.occurredAt, zone.value);
  if (!businessDate.ok) {
    return fail({
      code: "HEADER_FIELD_INVALID",
      field: "occurredAt",
      received: String(header.occurredAt),
    });
  }
  const businessDateIso = businessDateToIso(businessDate.value);
  if (!businessDateIso.ok) {
    return fail({
      code: "HEADER_FIELD_INVALID",
      field: "businessDate",
      received: "unrenderable",
    });
  }

  // 4. Prior balances for the touched buckets, then project and check.
  const bucketKeys = transaction.value.deltas.map((delta) => delta.bucketKey);
  const prior = await readTouchedBalances(tenantDb, bucketKeys);
  if (!prior.ok) return prior;

  const postings: readonly LedgerPosting[] = transaction.value.deltas;
  const projected = applyPostingsChecked(prior.value.sheet, postings);
  if (!projected.ok) return projected;

  // 5. Handling-unit occupancy over the resulting sheet.
  const touchedUnits = new Set<string>();
  for (const delta of transaction.value.deltas) {
    if (delta.bucket.handlingUnitId !== undefined) {
      touchedUnits.add(delta.bucket.handlingUnitId);
    }
  }
  const unitLocations = new Map<string, string | null>();
  for (const unitId of [...touchedUnits].sort()) {
    const resulting = resultingUnitLocation(projected.value, unitId);
    if (!resulting.ok) return resulting;
    const stored = references.value.handlingUnits.get(unitId);
    const storedLocation = stored?.currentLocationId;
    if (
      storedLocation !== undefined &&
      resulting.value !== null &&
      storedLocation !== resulting.value &&
      !bucketKeys.some((key) => keyNamesLocation(key, storedLocation))
    ) {
      return fail({
        code: "HANDLING_UNIT_TWO_LOCATIONS",
        handlingUnitId: unitId,
        first: storedLocation,
        second: resulting.value,
      });
    }
    unitLocations.set(unitId, resulting.value);
  }

  // 6. Device correlation: resolved from the opaque installation value through the
  // organization's own index, never taken as a document ID from the caller.
  let deviceId: string | undefined;
  if (input.installationId !== undefined && input.installationId.length > 0) {
    const device = await tenantDb
      .byIndex<DeviceRow>("devices", "by_orgId_installationId", [
        { field: "installationId", value: input.installationId },
      ])
      .first();
    if (device !== null) deviceId = device._id;
  }

  // 7. Write. Header first, so lines and balances can name it.
  const transactionId = await tenantDb.insert("inventoryTransactions", {
    warehouseId: header.warehouseId,
    type: header.type,
    operation: header.operation,
    requestId: header.requestId,
    actorUserId: header.actorUserId,
    ...(deviceId === undefined ? {} : { deviceId }),
    occurredAt: header.occurredAt,
    businessDate: businessDateIso.value,
    source: { type: header.source.type, id: header.source.id },
    ...(header.reversalOfTransactionId === undefined
      ? {}
      : { reversalOfTransactionId: header.reversalOfTransactionId }),
    ...(header.reasonCodeId === undefined
      ? {}
      : { reasonCodeId: header.reasonCodeId }),
    lineCount: transaction.value.lines.length,
    conservationGroupCount: transaction.value.conservation.length,
  });

  const postedLines: PostedLine[] = [];
  for (const [lineIndex, line] of transaction.value.lines.entries()) {
    await tenantDb.insert("inventoryLedgerLines", {
      transactionId,
      lineIndex,
      warehouseId: header.warehouseId,
      occurredAt: header.occurredAt,
      ...bucketColumns(line.bucket),
      bucketKey: line.bucketKey,
      conservationKey: line.conservationKey,
      quantity: {
        uom: line.quantity.uom,
        minorUnits: line.quantity.minorUnits,
      },
    });
    postedLines.push(
      Object.freeze({
        lineIndex,
        bucketKey: line.bucketKey,
        itemId: line.bucket.itemId,
        stockStatus: line.bucket.stockStatus,
        uom: line.quantity.uom,
        minorUnits: line.quantity.minorUnits,
      }),
    );
  }

  const postedBalances: PostedBalance[] = [];
  for (const bucketKey of [...new Set(bucketKeys)].sort()) {
    const resulting = balanceAt(projected.value, bucketKey);
    if (resulting === null) continue;
    const payload = {
      bucketKey,
      warehouseId: header.warehouseId,
      ...bucketColumns(resulting.bucket),
      quantity: {
        uom: resulting.quantity.uom,
        minorUnits: resulting.quantity.minorUnits,
      },
      lastTransactionId: transactionId,
      updatedAt: now,
    };
    const row = prior.value.rows.get(bucketKey);
    if (row === undefined) {
      await tenantDb.insert("inventoryBalances", payload);
    } else {
      await tenantDb.replace("inventoryBalances", row._id, payload);
    }

    /*
     * Occupancy, maintained here because here is where a location's contents
     * actually change (`ADR-0011` §6). The counter moves only when a bucket
     * *crosses* zero: a location holding stock that merely changed quantity is
     * no more or less occupied, and counting every posting would turn the map
     * into a measure of activity rather than of what is on the floor.
     *
     * Physical locations only. A virtual boundary — the supplier's side of a
     * receipt — is a counterparty, not a place anybody walks to.
     */
    const occupancyLocation =
      resulting.bucket.location.kind === "PHYSICAL"
        ? resulting.bucket.location.locationId
        : undefined;
    if (occupancyLocation !== undefined) {
      const wasHeld = (row?.quantity.minorUnits ?? 0) !== 0;
      const isHeld = resulting.quantity.minorUnits !== 0;
      if (wasHeld !== isHeld) {
        await adjustRollup({
          tenantDb,
          warehouseId: header.warehouseId,
          metric: "LOCATION_OCCUPANCY",
          subjectId: occupancyLocation,
          delta: isHeld ? 1 : -1,
          now,
        });
      }
    }

    postedBalances.push(
      Object.freeze({
        bucketKey,
        uom: resulting.quantity.uom,
        minorUnits: resulting.quantity.minorUnits,
      }),
    );
  }

  // 8. Handling-unit current location, maintained by the ledger rather than edited
  // by hand. `replace` rather than `patch`, because clearing the field when a unit
  // is emptied is a removal, and a patch that set it to `undefined` would depend on
  // the accessor's treatment of an absent value rather than saying what it means.
  for (const [unitId, locationId] of [...unitLocations.entries()].sort()) {
    const stored = references.value.handlingUnits.get(unitId);
    if (stored === undefined) continue;
    if ((stored.currentLocationId ?? null) === locationId) continue;
    await tenantDb.replace("handlingUnits", unitId, {
      warehouseId: stored.warehouseId,
      lpn: stored.lpn,
      status: stored.status,
      ...(locationId === null ? {} : { currentLocationId: locationId }),
    });
  }

  const result: PostedTransaction = Object.freeze({
    transactionId,
    requestId: header.requestId,
    operation: header.operation,
    type: header.type,
    warehouseId: header.warehouseId,
    occurredAt: header.occurredAt,
    businessDate: businessDateIso.value,
    lineCount: transaction.value.lines.length,
    conservationGroupCount: transaction.value.conservation.length,
    ...(header.reversalOfTransactionId === undefined
      ? {}
      : { reversalOfTransactionId: header.reversalOfTransactionId }),
    lines: Object.freeze(postedLines),
  });

  const resultText = ledgerResultCanonicalText(result);
  if (!resultText.ok) return resultText;
  const resultHash = await sha256Hex(resultText.value);

  // 9. Audit, in the same transaction as the write it describes.
  await tenantDb.insert("auditEvents", {
    occurredAt: now,
    actorKind: "USER" as const,
    actorUserId: header.actorUserId,
    action: header.operation,
    permissionCode: input.permissionCode,
    entityTable: "inventoryTransactions",
    entityId: transactionId,
    warehouseId: header.warehouseId,
    outcome: "ALLOWED" as const,
    requestId: header.requestId,
    ...(deviceId === undefined ? {} : { deviceId }),
    changes: [
      { field: "type", to: header.type },
      { field: "lineCount", to: String(transaction.value.lines.length) },
      {
        field: "conservationGroupCount",
        to: String(transaction.value.conservation.length),
      },
      ...(header.reversalOfTransactionId === undefined
        ? []
        : [
            {
              field: "reversalOfTransactionId",
              to: header.reversalOfTransactionId,
            },
          ]),
    ],
  });

  // 10. The replay index, last, so it only exists if everything above committed.
  await writeIdempotencyRecord({
    tenantDb,
    operation: header.operation,
    requestId: header.requestId,
    requestHash,
    resultRef: transactionId,
    resultHash,
    actorUserId: header.actorUserId,
    ...(deviceId === undefined ? {} : { deviceId }),
    now,
  });

  return ok(
    Object.freeze({
      result,
      replayed: false,
      balances: Object.freeze(postedBalances),
    }),
  );
}

/**
 * Whether a bucket key names a given physical location.
 *
 * Decodes rather than matches a substring: a location ID is a component of a
 * length-prefixed key, and `key.includes(id)` would also be true for a key whose
 * *item* ID happened to contain it.
 */
function keyNamesLocation(bucketKey: string, locationId: string): boolean {
  const bucket = decodeBucketKey(bucketKey);
  if (!bucket.ok) return false;
  const location = bucket.value.location;
  return location.kind === "PHYSICAL" && location.locationId === locationId;
}

/**
 * Idempotency retention, re-exported for the callers that already import it from
 * here. The value and its rationale live in `convex/lib/idempotency.ts`; a second
 * declaration would be a second answer to "how long does a replay window last".
 */
export const IDEMPOTENCY_RETENTION_MS = SHARED_IDEMPOTENCY_RETENTION_MS;

/**
 * Rebuild the original result of a completed request, verify it, and answer with
 * the buckets' current balances.
 *
 * The rebuild reads the immutable header and its lines and reconstructs exactly the
 * value the first call returned — possible because the rows never change and the
 * line order is canonical. It is then checked against `resultHash`: a mismatch is
 * `REPLAY_RESULT_UNVERIFIABLE`, because it means an immutable row is not what it
 * was, and answering with a plausible-looking value would hide that.
 *
 * Nothing is written. No transaction, no line, no balance, no audit row, and no
 * second idempotency record (`INV-0003-01`).
 */
async function replayPostedTransaction(
  tenantDb: TenantDocumentAccess,
  record: IdempotencyRow,
): Promise<Result<PostOutcome, LedgerStoreError>> {
  const reference = record.resultRef;
  if (reference === undefined || record.status !== "SUCCEEDED") {
    return fail({
      code: "REPLAY_TRANSACTION_MISSING",
      requestId: record.requestId,
    });
  }
  const detail = await readTransactionDetail(tenantDb, reference);
  if (!detail.ok) return detail;

  const resultText = ledgerResultCanonicalText(detail.value);
  if (!resultText.ok) return resultText;
  const resultHash = await sha256Hex(resultText.value);
  if (record.resultHash !== undefined && record.resultHash !== resultHash) {
    return fail({
      code: "REPLAY_RESULT_UNVERIFIABLE",
      requestId: record.requestId,
    });
  }

  const balances = await readCurrentBalances(
    tenantDb,
    detail.value.lines.map((line) => line.bucketKey),
  );
  if (!balances.ok) return balances;

  return ok(
    Object.freeze({
      result: detail.value,
      replayed: true,
      balances: balances.value,
    }),
  );
}

/**
 * The current balance of each named bucket, ordered by key.
 *
 * One bounded `unique()` per bucket, and a bucket with no row yet is omitted rather
 * than reported as zero: "no row" and "zero" are different facts, and the
 * reconciliation that exists to tell them apart should not be handed a fabricated
 * zero here.
 */
async function readCurrentBalances(
  tenantDb: TenantDocumentAccess,
  bucketKeys: readonly string[],
): Promise<Result<readonly PostedBalance[], LedgerStoreError>> {
  const balances: PostedBalance[] = [];
  for (const bucketKey of [...new Set(bucketKeys)].sort()) {
    const row = await tenantDb
      .byIndex<BalanceRow>("inventoryBalances", "by_orgId_bucketKey", [
        { field: "bucketKey", value: bucketKey },
      ])
      .unique();
    if (row === null) continue;
    const quantity = validateQuantity(row.quantity);
    if (!quantity.ok) {
      return fail({
        code: "STORED_ROW_INVALID",
        table: "inventoryBalances",
        reference: row._id,
      });
    }
    balances.push(
      Object.freeze({
        bucketKey,
        uom: quantity.value.uom,
        minorUnits: quantity.value.minorUnits,
      }),
    );
  }
  return ok(Object.freeze(balances));
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A transaction and its lines, in canonical order.
 *
 * Bounded by `MAX_TRANSACTION_LINES`, which is also the cap a transaction was
 * allowed to be written with, so the read can never be short. A row count that
 * disagrees with the stored `lineCount` is `STORED_ROW_INVALID` rather than a
 * silently partial transaction — that disagreement is real corruption of
 * append-only data, and reporting a shorter transaction would hide it.
 */
export async function readTransactionDetail(
  tenantDb: TenantDocumentAccess,
  transactionId: string,
): Promise<Result<PostedTransaction, LedgerStoreError>> {
  const header = await tenantDb.get<TransactionRow>(
    "inventoryTransactions",
    transactionId,
  );
  if (header === null) {
    return fail({
      code: "REFERENCE_NOT_FOUND",
      table: "inventoryTransactions",
      reference: transactionId,
    });
  }

  const rows = await tenantDb
    .byIndex<LineRow>(
      "inventoryLedgerLines",
      "by_orgId_transactionId_lineIndex",
      [{ field: "transactionId", value: transactionId }],
    )
    .take(MAX_TRANSACTION_LINES);

  if (rows.length !== header.lineCount) {
    return fail({
      code: "STORED_ROW_INVALID",
      table: "inventoryLedgerLines",
      reference: transactionId,
    });
  }

  const lines: PostedLine[] = [];
  for (const row of [...rows].sort(
    (left, right) => left.lineIndex - right.lineIndex,
  )) {
    const quantity = validateQuantity(row.quantity);
    if (!quantity.ok) {
      return fail({
        code: "STORED_ROW_INVALID",
        table: "inventoryLedgerLines",
        reference: row._id,
      });
    }
    lines.push(
      Object.freeze({
        lineIndex: row.lineIndex,
        bucketKey: row.bucketKey,
        itemId: row.itemId,
        stockStatus: row.stockStatus,
        uom: quantity.value.uom,
        minorUnits: quantity.value.minorUnits,
      }),
    );
  }

  return ok(
    Object.freeze({
      transactionId,
      requestId: header.requestId,
      operation: header.operation,
      type: header.type,
      warehouseId: header.warehouseId,
      occurredAt: header.occurredAt,
      businessDate: header.businessDate,
      lineCount: header.lineCount,
      conservationGroupCount: header.conservationGroupCount,
      ...(header.reversalOfTransactionId === undefined
        ? {}
        : { reversalOfTransactionId: header.reversalOfTransactionId }),
      lines: Object.freeze(lines),
    }),
  );
}

/** A transaction and its lines, plus the current balances of its buckets. */
export async function readTransactionWithBalances(
  tenantDb: TenantDocumentAccess,
  transactionId: string,
): Promise<Result<PostOutcome, LedgerStoreError>> {
  const detail = await readTransactionDetail(tenantDb, transactionId);
  if (!detail.ok) return detail;
  const balances = await readCurrentBalances(
    tenantDb,
    detail.value.lines.map((line) => line.bucketKey),
  );
  if (!balances.ok) return balances;
  return ok(
    Object.freeze({
      result: detail.value,
      replayed: false,
      balances: balances.value,
    }),
  );
}

/** One row of a transaction history page. */
export interface TransactionSummary {
  readonly transactionId: string;
  readonly type: InventoryTransactionTypeValue;
  readonly operation: string;
  readonly requestId: string;
  readonly occurredAt: number;
  readonly businessDate: string;
  readonly lineCount: number;
  readonly reversalOfTransactionId?: string;
}

/** A bounded, resumable page of one warehouse's transaction history. */
export async function readTransactionHistoryPage(
  tenantDb: TenantDocumentAccess,
  warehouseId: string,
  request: JobPageRequest,
): Promise<Result<JobPage<TransactionSummary>, LedgerStoreError>> {
  const page = await tenantDb
    .byIndex<TransactionRow>(
      "inventoryTransactions",
      "by_orgId_warehouseId_occurredAt",
      [{ field: "warehouseId", value: warehouseId }],
    )
    .page({
      limit: request.maxPageSize,
      ...(request.cursor === null ? {} : { cursor: request.cursor }),
    });

  const items = page.page.map((row) =>
    Object.freeze({
      transactionId: row._id,
      type: row.type,
      operation: row.operation,
      requestId: row.requestId,
      occurredAt: row.occurredAt,
      businessDate: row.businessDate,
      lineCount: row.lineCount,
      ...(row.reversalOfTransactionId === undefined
        ? {}
        : { reversalOfTransactionId: row.reversalOfTransactionId }),
    }),
  );

  const built = makeJobPage(request, items, {
    isDone: page.isDone,
    ...(page.isDone ? {} : { cursor: page.continueCursor }),
  });
  if (!built.ok) {
    return fail({
      code: "STORED_ROW_INVALID",
      table: "inventoryTransactions",
      reference: warehouseId,
    });
  }
  return ok(built.value);
}

/** One row of a balance page. */
export interface BalanceSummary {
  readonly bucketKey: string;
  readonly stockStatus: StockStatus;
  readonly uom: string;
  readonly minorUnits: number;
}

/** A bounded, resumable page of one warehouse's current balances. */
export async function readBalancePage(
  tenantDb: TenantDocumentAccess,
  warehouseId: string,
  request: JobPageRequest,
): Promise<Result<JobPage<BalanceSummary>, LedgerStoreError>> {
  const page = await tenantDb
    .byIndex<BalanceRow>(
      "inventoryBalances",
      "by_orgId_warehouseId_bucketKey",
      [{ field: "warehouseId", value: warehouseId }],
    )
    .page({
      limit: request.maxPageSize,
      ...(request.cursor === null ? {} : { cursor: request.cursor }),
    });

  const items: BalanceSummary[] = [];
  for (const row of page.page) {
    const quantity = validateQuantity(row.quantity);
    if (!quantity.ok) {
      return fail({
        code: "STORED_ROW_INVALID",
        table: "inventoryBalances",
        reference: row._id,
      });
    }
    items.push(
      Object.freeze({
        bucketKey: row.bucketKey,
        stockStatus: row.stockStatus,
        uom: quantity.value.uom,
        minorUnits: quantity.value.minorUnits,
      }),
    );
  }

  const built = makeJobPage(request, items, {
    isDone: page.isDone,
    ...(page.isDone ? {} : { cursor: page.continueCursor }),
  });
  if (!built.ok) {
    return fail({
      code: "STORED_ROW_INVALID",
      table: "inventoryBalances",
      reference: warehouseId,
    });
  }
  return ok(built.value);
}

/* -------------------------------------------------------------------------- */
/* Reconciliation                                                              */
/* -------------------------------------------------------------------------- */

/** The running total a resumable bucket reconciliation carries between pages. */
export interface ReconciliationCarry {
  readonly uom: string;
  readonly minorUnits: number;
}

/** What one page of a bucket reconciliation answers. */
export interface BucketReconciliationPage {
  readonly bucketKey: string;
  readonly page: JobPage<null>;
  readonly carry: ReconciliationCarry | null;
  /** Present only on the final page: the verdict for this bucket. */
  readonly drift?: readonly BalanceDrift[];
}

/**
 * Reconcile one bucket, one resumable page of its lines at a time.
 *
 * Per bucket rather than per tenant, and resumable rather than "read all the
 * lines", because a hot bucket accumulates lines forever and `RG-018` is a
 * seven-day soak over a whole tenant. Exactly one `paginate` happens per call,
 * which is also the platform's limit per function execution.
 *
 * The verdict arrives with the last page: only then is the replayed total complete,
 * and comparing a partial total against a stored balance would report drift on
 * every bucket with more lines than one page.
 */
export async function reconcileBucketPage(
  tenantDb: TenantDocumentAccess,
  bucketKey: string,
  request: JobPageRequest,
  carry: ReconciliationCarry | null,
): Promise<Result<BucketReconciliationPage, LedgerStoreError>> {
  const decoded = decodeBucketKey(bucketKey);
  if (!decoded.ok) {
    return fail({
      code: "LINE_BUCKET_INVALID",
      index: -1,
      cause: decoded.error,
    });
  }

  const page = await tenantDb
    .byIndex<LineRow>("inventoryLedgerLines", "by_orgId_bucketKey_occurredAt", [
      { field: "bucketKey", value: bucketKey },
    ])
    .page({
      limit: request.maxPageSize,
      ...(request.cursor === null ? {} : { cursor: request.cursor }),
    });

  let uom = carry?.uom ?? null;
  let total = carry?.minorUnits ?? 0;
  for (const row of page.page) {
    const quantity = validateQuantity(row.quantity);
    if (!quantity.ok) {
      return fail({
        code: "STORED_ROW_INVALID",
        table: "inventoryLedgerLines",
        reference: row._id,
      });
    }
    if (uom === null) uom = quantity.value.uom;
    if (uom !== quantity.value.uom) {
      return fail({
        code: "BUCKET_UOM_CONFLICT",
        bucketKey,
        first: uom,
        second: quantity.value.uom,
      });
    }
    total += quantity.value.minorUnits;
  }

  const built = makeJobPage<null>(
    { maxPageSize: request.maxPageSize, cursor: request.cursor },
    page.page.map(() => null),
    {
      isDone: page.isDone,
      ...(page.isDone ? {} : { cursor: page.continueCursor }),
    },
  );
  if (!built.ok) {
    return fail({
      code: "STORED_ROW_INVALID",
      table: "inventoryLedgerLines",
      reference: bucketKey,
    });
  }

  const nextCarry: ReconciliationCarry | null =
    uom === null ? null : Object.freeze({ uom, minorUnits: total });

  if (!page.isDone) {
    return ok(
      Object.freeze({ bucketKey, page: built.value, carry: nextCarry }),
    );
  }

  const storedRow = await tenantDb
    .byIndex<BalanceRow>("inventoryBalances", "by_orgId_bucketKey", [
      { field: "bucketKey", value: bucketKey },
    ])
    .unique();

  const projectedRows: BucketBalance[] = [];
  if (nextCarry !== null) {
    const quantity = makeQuantity(nextCarry.minorUnits, nextCarry.uom);
    if (!quantity.ok) {
      return fail({ code: "BALANCE_ARITHMETIC", cause: quantity.error });
    }
    projectedRows.push(
      Object.freeze({
        bucketKey,
        bucket: decoded.value,
        quantity: quantity.value,
      }),
    );
  }
  const projected = balanceSheetFromRows(projectedRows);
  if (!projected.ok) return projected;

  const storedRows: BucketBalance[] = [];
  if (storedRow !== null) {
    const balance = bucketBalanceOfRow(storedRow);
    if (!balance.ok) return balance;
    storedRows.push(balance.value);
  }
  const stored = balanceSheetFromRows(storedRows);
  if (!stored.ok) return stored;

  const drift = reconcileBalances(projected.value, stored.value);
  if (!drift.ok) return drift;

  return ok(
    Object.freeze({
      bucketKey,
      page: built.value,
      carry: nextCarry,
      drift: drift.value,
    }),
  );
}

/**
 * The most ledger lines one bounded reconciliation will fold for a single
 * bucket.
 *
 * `reconcileBucketPage` exists for the resumable, caller-driven fold. This is
 * its non-paginated sibling, and it exists because of a hard platform rule:
 * **Convex permits one paginated query per function execution.** A sweep that
 * pages balances has already spent that budget, so it cannot also page each
 * bucket's lines — it has to read them in one bounded `take`.
 *
 * The value is `TENANT_INDEX_MAX_PAGE_SIZE - 1` and the arithmetic matters: the
 * read asks for one *more* row than the cap so it can tell "exactly this many"
 * from "at least this many", and the accessor refuses a limit above its own cap
 * rather than clamping it.
 *
 * A bucket with more lines than this is reported as `RECONCILE_INCOMPLETE`
 * rather than folded partially. "We did not finish checking" and "we checked and
 * it agrees" are different facts, and a reconciliation that conflated them would
 * be worse than none. Such a bucket needs the resumable `reconcileBucketPage`
 * path, driven by a caller that spends its own pagination budget on it.
 */
export const MAX_BOUNDED_RECONCILE_LINES = TENANT_INDEX_MAX_PAGE_SIZE - 1;

/**
 * Reconcile one bucket in a single bounded read, with no pagination.
 *
 * Reads `MAX_BOUNDED_RECONCILE_LINES + 1` lines: the extra row is how the caller
 * learns the bucket is too deep for this path without a second query.
 */
export async function reconcileBucketBounded(
  tenantDb: TenantDocumentAccess,
  bucketKey: string,
): Promise<
  Result<
    { readonly complete: boolean; readonly drift: readonly BalanceDrift[] },
    LedgerStoreError
  >
> {
  const decoded = decodeBucketKey(bucketKey);
  if (!decoded.ok) {
    return fail({
      code: "LINE_BUCKET_INVALID",
      index: -1,
      cause: decoded.error,
    });
  }

  const rows = await tenantDb
    .byIndex<LineRow>("inventoryLedgerLines", "by_orgId_bucketKey_occurredAt", [
      { field: "bucketKey", value: bucketKey },
    ])
    .take(MAX_BOUNDED_RECONCILE_LINES + 1);

  if (rows.length > MAX_BOUNDED_RECONCILE_LINES) {
    return ok(Object.freeze({ complete: false, drift: Object.freeze([]) }));
  }

  let uom: string | null = null;
  let total = 0;
  for (const row of rows) {
    const quantity = validateQuantity(row.quantity);
    if (!quantity.ok) {
      return fail({
        code: "STORED_ROW_INVALID",
        table: "inventoryLedgerLines",
        reference: row._id,
      });
    }
    if (uom === null) uom = quantity.value.uom;
    if (uom !== quantity.value.uom) {
      return fail({
        code: "BUCKET_UOM_CONFLICT",
        bucketKey,
        first: uom,
        second: quantity.value.uom,
      });
    }
    total += quantity.value.minorUnits;
  }

  const projectedRows: BucketBalance[] = [];
  if (uom !== null) {
    const quantity = makeQuantity(total, uom);
    if (!quantity.ok) {
      return fail({ code: "BALANCE_ARITHMETIC", cause: quantity.error });
    }
    projectedRows.push(
      Object.freeze({
        bucketKey,
        bucket: decoded.value,
        quantity: quantity.value,
      }),
    );
  }
  const projected = balanceSheetFromRows(projectedRows);
  if (!projected.ok) return projected;

  const storedRow = await tenantDb
    .byIndex<BalanceRow>("inventoryBalances", "by_orgId_bucketKey", [
      { field: "bucketKey", value: bucketKey },
    ])
    .unique();

  const storedRows: BucketBalance[] = [];
  if (storedRow !== null) {
    const balance = bucketBalanceOfRow(storedRow);
    if (!balance.ok) return balance;
    storedRows.push(balance.value);
  }
  const stored = balanceSheetFromRows(storedRows);
  if (!stored.ok) return stored;

  const drift = reconcileBalances(projected.value, stored.value);
  if (!drift.ok) return drift;

  return ok(Object.freeze({ complete: true, drift: drift.value }));
}

/* -------------------------------------------------------------------------- */
/* Reversal                                                                    */
/* -------------------------------------------------------------------------- */

/** What the caller hands the store to reverse one transaction. */
export interface ReverseLedgerTransactionInput {
  readonly tenantDb: TenantDocumentAccess;
  readonly tenant: ActiveTenantContext;
  readonly permissionCode: string;
  readonly now: number;
  readonly installationId?: string | undefined;
  /** The warehouse the request was authorized against (`INV-0006-04`). */
  readonly warehouseId: string;
  readonly originalTransactionId: string;
  readonly requestId: string;
  readonly operation: string;
  readonly actorUserId: string;
  readonly reasonCodeId: string;
}

/**
 * Reverse a transaction (`INV-0003-08`).
 *
 * The original is read through the tenant-bound accessor, so another tenant's
 * transaction ID is `REFERENCE_NOT_FOUND` — the same answer as one that never
 * existed. `planReversal` then decides every reversal rule on values rather than on
 * documents, and the resulting transaction is posted through the ordinary path, so
 * it gets the same balance checks, the same audit row, and the same idempotency
 * record as any other posting.
 *
 * "Not twice" and "a retry is a no-op" both apply here, and they answer the same
 * observation — a reversal of this original already exists — differently. The
 * request ID separates them: the reversal this request itself wrote is a retry and
 * replays, any other one is `REVERSAL_ALREADY_EXISTS`.
 */
export async function reverseLedgerTransaction(
  input: ReverseLedgerTransactionInput,
): Promise<Result<PostOutcome, LedgerStoreError>> {
  const { tenantDb, tenant } = input;
  const orgId = tenant.organization._id;

  const requestId = validateRequestId(input.requestId);
  if (!requestId.ok) {
    return fail({ code: "REQUEST_IDENTITY_INVALID", cause: requestId.error });
  }

  const header = await tenantDb.get<TransactionRow>(
    "inventoryTransactions",
    input.originalTransactionId,
  );
  if (header === null) {
    return fail({
      code: "REFERENCE_NOT_FOUND",
      table: "inventoryTransactions",
      reference: input.originalTransactionId,
    });
  }

  const rows = await tenantDb
    .byIndex<LineRow>(
      "inventoryLedgerLines",
      "by_orgId_transactionId_lineIndex",
      [{ field: "transactionId", value: input.originalTransactionId }],
    )
    .take(MAX_TRANSACTION_LINES);
  if (rows.length !== header.lineCount) {
    return fail({
      code: "STORED_ROW_INVALID",
      table: "inventoryLedgerLines",
      reference: input.originalTransactionId,
    });
  }

  // The reversal posts where the original posted. If that is not the warehouse the
  // request was authorized against, refuse rather than post outside the scope the
  // permission was decided in (`INV-0006-04`) — and rather than post into the
  // caller's warehouse, which would be a cross-warehouse movement dressed as a
  // correction.
  if (header.warehouseId !== input.warehouseId) {
    return fail({
      code: "REVERSAL_WAREHOUSE_MISMATCH",
      expected: input.warehouseId,
      received: header.warehouseId,
    });
  }

  const lines: { bucket: InventoryBucket; quantity: Quantity }[] = [];
  for (const row of rows) {
    const bucket = decodeBucketKey(row.bucketKey);
    if (!bucket.ok) {
      return fail({
        code: "STORED_ROW_INVALID",
        table: "inventoryLedgerLines",
        reference: row._id,
      });
    }
    const quantity = validateQuantity(row.quantity);
    if (!quantity.ok) {
      return fail({
        code: "STORED_ROW_INVALID",
        table: "inventoryLedgerLines",
        reference: row._id,
      });
    }
    lines.push({ bucket: bucket.value, quantity: quantity.value });
  }

  const alreadyReversed = await tenantDb
    .byIndex<TransactionRow>(
      "inventoryTransactions",
      "by_orgId_reversalOfTransactionId",
      [
        {
          field: "reversalOfTransactionId",
          value: input.originalTransactionId,
        },
      ],
    )
    .first();

  // A reversal that already names this original ends the request — unless it is
  // the one *this* request produced. A client whose response was lost retries the
  // same request ID, and that retry is asking for the answer it did not receive,
  // not for a second reversal (`ADR-0003`: a duplicate `requestId` is a no-op
  // returning the original result; `RG-025`). Refusing it `REVERSAL_ALREADY_EXISTS`
  // would name the wrong reason and would make a retry look like an operator error.
  //
  // The decision is handed to `postLedgerTransaction` rather than made here,
  // because the fingerprint is what separates a retry from a reused ID: an exact
  // retry replays, and the same ID under different arguments is
  // `REQUEST_ARGUMENT_CONFLICT`. A *different* request ID against the same original
  // still stops here, which is `INV-0003-08` — one original, one reversal.
  const ownRetry =
    alreadyReversed !== null &&
    alreadyReversed.operation === input.operation &&
    alreadyReversed.requestId === requestId.value;

  const original: OriginalTransaction = {
    transactionId: input.originalTransactionId,
    orgId,
    warehouseId: header.warehouseId,
    type: header.type,
    ...(header.reversalOfTransactionId === undefined
      ? {}
      : { reversalOfTransactionId: header.reversalOfTransactionId }),
    lines,
  };

  const planned = planReversal({
    orgId,
    operation: input.operation,
    requestId: requestId.value,
    actorUserId: input.actorUserId,
    occurredAt: input.now,
    reasonCodeId: input.reasonCodeId,
    original,
    existingReversalId:
      alreadyReversed === null || ownRetry ? null : alreadyReversed._id,
  });
  if (!planned.ok) return planned;

  return await postLedgerTransaction({
    tenantDb,
    tenant,
    permissionCode: input.permissionCode,
    now: input.now,
    ...(input.installationId === undefined
      ? {}
      : { installationId: input.installationId }),
    draft: {
      orgId,
      warehouseId: planned.value.header.warehouseId,
      type: "REVERSAL",
      operation: planned.value.header.operation,
      requestId: planned.value.header.requestId,
      actorUserId: planned.value.header.actorUserId,
      occurredAt: planned.value.header.occurredAt,
      source: planned.value.header.source,
      reasonCodeId: input.reasonCodeId,
      reversalOfTransactionId: input.originalTransactionId,
      lines: planned.value.lines.map((line: ValidatedLedgerLine) => ({
        bucket: line.bucket,
        quantity: line.quantity,
      })),
    },
  });
}

/** The bucket key of a validated bucket, for callers assembling a draft. */
export const bucketKeyOf = (
  bucket: InventoryBucket,
): Result<string, LedgerError> => {
  const validated = validateBucket(bucket);
  if (!validated.ok) {
    return fail({
      code: "LINE_BUCKET_INVALID",
      index: -1,
      cause: validated.error,
    });
  }
  const key = encodeBucketKey(validated.value);
  if (!key.ok) {
    return fail({ code: "LINE_BUCKET_INVALID", index: -1, cause: key.error });
  }
  return ok(key.value);
};
