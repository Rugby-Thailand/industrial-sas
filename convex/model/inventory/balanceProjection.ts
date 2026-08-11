/**
 * Balance projection, replay, the non-negativity rule, and reconciliation drift.
 *
 * Status: **implemented.** Pure module (plan §6.2): no Convex imports, and no
 * imports outside `convex/model/**`.
 *
 * The ledger lines are the truth; a balance is a *projection* of them, written in
 * the same transaction so a reader never sees lines without the balance they imply
 * (`INV-0003-09`, §5 Q21). Two computations therefore have to agree exactly, and
 * this module is where both live so they cannot drift apart in review:
 *
 * - **Incremental.** `applyPostings` folds one transaction's postings into the
 *   balances that already exist. This is what the mutation does.
 * - **Replay.** `projectBalances` folds *every* line of a bucket from nothing.
 *   This is what reconciliation does (`INV-0003-10`).
 *
 * Their equality is the property the soak gate measures (`RG-016`, `RG-018`), and
 * it is a property test here: replaying a randomized sequence equals applying it
 * one transaction at a time. That only holds if the fold is associative and
 * order-independent, which integer addition is — which is the real reason
 * quantities are integers (`ADR-0004`).
 *
 * ### Zero balances are kept
 *
 * A bucket emptied by a movement keeps a row with `minorUnits: 0`. It is not
 * deleted and not omitted. Deleting would need a delete path into
 * `inventoryBalances`, and `INV-0003-11` is that no such path exists; omitting
 * would make "never touched" and "emptied" the same observation, so a
 * reconciliation could not tell a missing projection from an empty bucket. The
 * cost is one row per bucket ever used, which is bounded by the warehouse's real
 * shape.
 *
 * ### The non-negativity rule, stated exactly
 *
 * - A **physical** bucket may not go negative in *any* status. `AVAILABLE` is the
 *   invariant D-12 and `INV-0003-06` name, and it is refused unconditionally: this
 *   module does not read `organizations.settings.negativeAvailableAllowed`, and
 *   neither does its caller. The remaining five statuses are refused by the same
 *   rule and reported separately (`NEGATIVE_PHYSICAL_BALANCE`) because negative
 *   `QC_HOLD` is equally impossible — you cannot release quarantined stock you
 *   never quarantined — and a policy that permitted it would silently paper over a
 *   missed inbound posting.
 * - A **virtual boundary** bucket is unbounded in sign, by construction.
 *   `SUPPLIER_RECEIPT` grows more negative with every receipt forever; that number
 *   is a cumulative flow, not stock on a shelf. Applying a stock rule to it would
 *   make the first receipt in a tenant's life impossible.
 *
 * Every function is total, returns a `Result`, and freezes what it hands back.
 */
import {
  addQuantities,
  makeQuantity,
  validateQuantity,
  type Quantity,
} from "../uom/quantity";
import {
  frozenArray,
  frozenRecord,
  isRecord,
  isString,
  recordValue,
} from "../guards";
import { fail, ok, type Result } from "../result";
import {
  isAvailableStatus,
  isPhysicalLocation,
  validateBucket,
  type InventoryBucket,
} from "./stockIdentity";
import type { LedgerError } from "./ledgerTransaction";

/* -------------------------------------------------------------------------- */
/* Values                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * One posting, reduced to what a projection needs.
 *
 * Structurally satisfied by `ValidatedLedgerLine` and by `BucketDelta`, so a
 * caller passes either without a conversion, and satisfied by a row read back out
 * of `inventoryLedgerLines` once its bucket and quantity have been re-validated.
 */
export interface LedgerPosting {
  readonly bucketKey: string;
  readonly bucket: InventoryBucket;
  readonly quantity: Quantity;
}

/** The balance of one bucket. Frozen. */
export interface BucketBalance {
  readonly bucketKey: string;
  readonly bucket: InventoryBucket;
  readonly quantity: Quantity;
}

/**
 * A set of balances, keyed by bucket key.
 *
 * A frozen null-prototype record rather than a `Map`, for the reason
 * `convex/model/guards.ts` states: a `ReadonlyMap` is an ordinary `Map` at run
 * time, so a signature promising immutability would be a claim a cast erases. The
 * null prototype also means a forged bucket key such as `"toString"` cannot
 * resolve to a function where the type says `BucketBalance`.
 */
export type BalanceSheet = Readonly<Record<string, BucketBalance>>;

/** Why a projection and a stored balance disagree. */
export type BalanceDriftKind =
  "MISSING_BALANCE" | "EXTRA_BALANCE" | "QUANTITY_MISMATCH" | "UOM_MISMATCH";

/**
 * One deterministic drift record.
 *
 * Reporting, never repair. Reconciliation can prove a number is wrong; it cannot
 * know which posting was missed or duplicated, so it must not invent a correcting
 * transaction (`OPS-0003-02`, [runbook](../../../docs/runbooks/ledger-drift.md)).
 * A human decides, and the correction they authorize is an ordinary reasoned
 * posting through `RECONCILIATION`.
 */
export interface BalanceDrift {
  readonly bucketKey: string;
  readonly kind: BalanceDriftKind;
  /** Absent when the ledger has no lines for this bucket at all. */
  readonly projectedMinorUnits?: number;
  /** Absent when no balance row exists. */
  readonly storedMinorUnits?: number;
  readonly projectedUom?: string;
  readonly storedUom?: string;
}

/* -------------------------------------------------------------------------- */
/* Construction and reading                                                    */
/* -------------------------------------------------------------------------- */

/** The empty sheet. Frozen; a fresh call each time, so no caller shares one. */
export const emptyBalanceSheet = (): BalanceSheet => frozenRecord([]);

/** The balance at a key, or `null`. Never a prototype hit; never `undefined`. */
export const balanceAt = (
  sheet: BalanceSheet,
  bucketKey: string,
): BucketBalance | null =>
  isRecord(sheet) && isString(bucketKey) ? recordValue(sheet, bucketKey) : null;

/** Every balance, ordered by bucket key. Deterministic, frozen. */
export const balanceEntries = (sheet: BalanceSheet): readonly BucketBalance[] =>
  frozenArray(
    Object.keys(sheet)
      .sort()
      .map((key) => recordValue(sheet, key)!)
      .filter((balance): balance is BucketBalance => balance !== null),
  );

/**
 * Re-check a value that claims to be a `BucketBalance`.
 *
 * Used on every row read back from storage. A balance row is a document, so its
 * `bucket` and `quantity` are exactly as forgeable as any other document field,
 * and a reconciliation that trusted them would compare the ledger against a value
 * it never validated.
 */
export function validateBucketBalance(
  balance: BucketBalance,
): Result<BucketBalance, LedgerError> {
  if (!isRecord(balance)) {
    return fail({ code: "NOT_A_TRANSACTION", received: typeof balance });
  }
  const bucket = validateBucket(balance.bucket as InventoryBucket);
  if (!bucket.ok) {
    return fail({
      code: "LINE_BUCKET_INVALID",
      index: -1,
      cause: bucket.error,
    });
  }
  const quantity = validateQuantity(balance.quantity as Quantity);
  if (!quantity.ok) {
    return fail({
      code: "LINE_QUANTITY_INVALID",
      index: -1,
      cause: quantity.error,
    });
  }
  if (!isString(balance.bucketKey) || balance.bucketKey.length === 0) {
    return fail({
      code: "HEADER_FIELD_INVALID",
      field: "bucketKey",
      received: typeof balance.bucketKey,
    });
  }
  return ok(
    Object.freeze({
      bucketKey: balance.bucketKey,
      bucket: bucket.value,
      quantity: quantity.value,
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* Folding                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Fold postings into a sheet, answering a new frozen sheet.
 *
 * The input sheet is never mutated: the mutation calls this with the balances it
 * read and writes what comes back, so a rejected transaction leaves no partial
 * state anywhere — including in memory, which is what makes "fail without partial
 * results" a property a test can assert rather than a claim about control flow.
 *
 * A posting whose UOM differs from the balance already at that bucket is
 * `BUCKET_UOM_CONFLICT`. It means the item's base UOM changed under a bucket that
 * already holds stock, which is a master-data migration, not a posting.
 */
export function applyPostings(
  sheet: BalanceSheet,
  postings: readonly LedgerPosting[],
): Result<BalanceSheet, LedgerError> {
  if (!isRecord(sheet)) {
    return fail({ code: "NOT_A_TRANSACTION", received: typeof sheet });
  }
  const next = new Map<string, BucketBalance>();
  for (const key of Object.keys(sheet)) {
    const existing = recordValue(sheet, key);
    if (existing === null) continue;
    const validated = validateBucketBalance(existing);
    if (!validated.ok) return validated;
    next.set(key, validated.value);
  }

  for (const posting of postings) {
    if (!isRecord(posting)) {
      return fail({ code: "NOT_A_TRANSACTION", received: typeof posting });
    }
    const bucket = validateBucket(posting.bucket as InventoryBucket);
    if (!bucket.ok) {
      return fail({
        code: "LINE_BUCKET_INVALID",
        index: -1,
        cause: bucket.error,
      });
    }
    const quantity = validateQuantity(posting.quantity as Quantity);
    if (!quantity.ok) {
      return fail({
        code: "LINE_QUANTITY_INVALID",
        index: -1,
        cause: quantity.error,
      });
    }
    if (!isString(posting.bucketKey) || posting.bucketKey.length === 0) {
      return fail({
        code: "HEADER_FIELD_INVALID",
        field: "bucketKey",
        received: typeof posting.bucketKey,
      });
    }

    const current = next.get(posting.bucketKey);
    if (current === undefined) {
      next.set(
        posting.bucketKey,
        Object.freeze({
          bucketKey: posting.bucketKey,
          bucket: bucket.value,
          quantity: quantity.value,
        }),
      );
      continue;
    }
    if (current.quantity.uom !== quantity.value.uom) {
      return fail({
        code: "BUCKET_UOM_CONFLICT",
        bucketKey: posting.bucketKey,
        first: current.quantity.uom,
        second: quantity.value.uom,
      });
    }
    const total = addQuantities(current.quantity, quantity.value);
    if (!total.ok) {
      return fail({ code: "BALANCE_ARITHMETIC", cause: total.error });
    }
    next.set(
      posting.bucketKey,
      Object.freeze({ ...current, quantity: total.value }),
    );
  }

  return ok(frozenRecord([...next.entries()]));
}

/**
 * Replay postings from nothing.
 *
 * Exactly `applyPostings` over the empty sheet, written as its own function
 * because reconciliation's contract is "recompute from the lines alone" and a
 * caller passing a non-empty starting sheet by accident would produce a
 * reconciliation that agreed with the projection it was meant to check.
 */
export const projectBalances = (
  postings: readonly LedgerPosting[],
): Result<BalanceSheet, LedgerError> =>
  applyPostings(emptyBalanceSheet(), postings);

/* -------------------------------------------------------------------------- */
/* Non-negativity                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Refuse a sheet in which any physical bucket is negative.
 *
 * `touched` narrows the check to the buckets a transaction affected, which is what
 * keeps the check bounded: a warehouse has hundreds of thousands of buckets and a
 * transaction touches a handful, and re-checking the rest would both cost a scan
 * and turn a pre-existing anomaly into a refusal of unrelated work. Passing an
 * empty list checks nothing, which is why the caller passes the transaction's own
 * delta keys.
 *
 * `AVAILABLE` is reported as `NEGATIVE_AVAILABLE_BALANCE` and every other status
 * as `NEGATIVE_PHYSICAL_BALANCE`. Both are refusals; the distinction exists because
 * the first is the invariant with a name in the plan and the audit trail should say
 * which rule fired.
 */
export function checkNonNegativeBalances(
  sheet: BalanceSheet,
  touched: readonly string[],
): Result<BalanceSheet, LedgerError> {
  if (!isRecord(sheet)) {
    return fail({ code: "NOT_A_TRANSACTION", received: typeof sheet });
  }
  for (const key of [...touched].sort()) {
    const balance = balanceAt(sheet, key);
    if (balance === null) continue;
    if (!isPhysicalLocation(balance.bucket.location)) continue;
    if (balance.quantity.minorUnits >= 0) continue;
    if (isAvailableStatus(balance.bucket.stockStatus)) {
      return fail({
        code: "NEGATIVE_AVAILABLE_BALANCE",
        bucketKey: key,
        resulting: balance.quantity.minorUnits,
        uom: balance.quantity.uom,
      });
    }
    return fail({
      code: "NEGATIVE_PHYSICAL_BALANCE",
      bucketKey: key,
      stockStatus: balance.bucket.stockStatus,
      resulting: balance.quantity.minorUnits,
      uom: balance.quantity.uom,
    });
  }
  return ok(sheet);
}

/**
 * Apply postings and enforce the balance policy in one step.
 *
 * The two are separable and are separately tested, but every real caller needs
 * both and needs them in this order; a helper is cheaper than a comment asking
 * each caller to remember.
 */
export function applyPostingsChecked(
  sheet: BalanceSheet,
  postings: readonly LedgerPosting[],
): Result<BalanceSheet, LedgerError> {
  const applied = applyPostings(sheet, postings);
  if (!applied.ok) return applied;
  return checkNonNegativeBalances(
    applied.value,
    postings.map((posting) => posting.bucketKey),
  );
}

/* -------------------------------------------------------------------------- */
/* Reconciliation                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Compare a replayed projection against the stored balances, and report.
 *
 * Deterministic: the union of both key sets, sorted, one record per disagreement.
 * Bounded: the answer is at most as long as that union, and callers page the
 * union (see `jobPage.ts`) rather than asking for a whole tenant at once.
 *
 * A bucket present on both sides with equal quantity and UOM produces nothing —
 * silence is the healthy answer, and `RG-018` measures the length of this array
 * over seven days.
 */
export function reconcileBalances(
  projected: BalanceSheet,
  stored: BalanceSheet,
): Result<readonly BalanceDrift[], LedgerError> {
  if (!isRecord(projected) || !isRecord(stored)) {
    return fail({ code: "NOT_A_TRANSACTION", received: "balance sheet" });
  }
  const keys = [
    ...new Set([...Object.keys(projected), ...Object.keys(stored)]),
  ].sort();

  const drift: BalanceDrift[] = [];
  for (const key of keys) {
    const left = balanceAt(projected, key);
    const right = balanceAt(stored, key);
    if (left !== null) {
      const validated = validateBucketBalance(left);
      if (!validated.ok) return validated;
    }
    if (right !== null) {
      const validated = validateBucketBalance(right);
      if (!validated.ok) return validated;
    }

    if (left === null && right === null) continue;
    if (left === null && right !== null) {
      drift.push(
        Object.freeze({
          bucketKey: key,
          kind: "EXTRA_BALANCE" as const,
          storedMinorUnits: right.quantity.minorUnits,
          storedUom: right.quantity.uom,
        }),
      );
      continue;
    }
    if (left !== null && right === null) {
      drift.push(
        Object.freeze({
          bucketKey: key,
          kind: "MISSING_BALANCE" as const,
          projectedMinorUnits: left.quantity.minorUnits,
          projectedUom: left.quantity.uom,
        }),
      );
      continue;
    }
    if (left!.quantity.uom !== right!.quantity.uom) {
      drift.push(
        Object.freeze({
          bucketKey: key,
          kind: "UOM_MISMATCH" as const,
          projectedMinorUnits: left!.quantity.minorUnits,
          storedMinorUnits: right!.quantity.minorUnits,
          projectedUom: left!.quantity.uom,
          storedUom: right!.quantity.uom,
        }),
      );
      continue;
    }
    if (left!.quantity.minorUnits !== right!.quantity.minorUnits) {
      drift.push(
        Object.freeze({
          bucketKey: key,
          kind: "QUANTITY_MISMATCH" as const,
          projectedMinorUnits: left!.quantity.minorUnits,
          storedMinorUnits: right!.quantity.minorUnits,
          projectedUom: left!.quantity.uom,
          storedUom: right!.quantity.uom,
        }),
      );
    }
  }

  return ok(frozenArray(drift));
}

/**
 * A balance sheet from validated rows, for a caller holding stored documents.
 *
 * Rejects a duplicate `bucketKey` rather than letting the last row win: two
 * balance rows for one bucket is the uniqueness contract broken, and picking one
 * of them would hide it from the very reconciliation that exists to find it.
 */
export function balanceSheetFromRows(
  rows: readonly BucketBalance[],
): Result<BalanceSheet, LedgerError> {
  const entries = new Map<string, BucketBalance>();
  for (const row of rows) {
    const validated = validateBucketBalance(row);
    if (!validated.ok) return validated;
    if (entries.has(validated.value.bucketKey)) {
      return fail({
        code: "BUCKET_UOM_CONFLICT",
        bucketKey: validated.value.bucketKey,
        first: "duplicate balance row",
        second: "duplicate balance row",
      });
    }
    entries.set(validated.value.bucketKey, validated.value);
  }
  return ok(frozenRecord([...entries.entries()]));
}

/** A zero balance for a bucket, for a caller seeding a sheet before a movement. */
export function zeroBalance(
  bucketKey: string,
  bucket: InventoryBucket,
  uom: string,
): Result<BucketBalance, LedgerError> {
  const quantity = makeQuantity(0, uom);
  if (!quantity.ok) {
    return fail({
      code: "LINE_QUANTITY_INVALID",
      index: -1,
      cause: quantity.error,
    });
  }
  return validateBucketBalance({ bucketKey, bucket, quantity: quantity.value });
}
