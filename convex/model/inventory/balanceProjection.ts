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

export interface LedgerPosting {
  readonly bucketKey: string;
  readonly bucket: InventoryBucket;
  readonly quantity: Quantity;
}

export interface BucketBalance {
  readonly bucketKey: string;
  readonly bucket: InventoryBucket;
  readonly quantity: Quantity;
}

export type BalanceSheet = Readonly<Record<string, BucketBalance>>;

export type BalanceDriftKind =
  "MISSING_BALANCE" | "EXTRA_BALANCE" | "QUANTITY_MISMATCH" | "UOM_MISMATCH";

export interface BalanceDrift {
  readonly bucketKey: string;
  readonly kind: BalanceDriftKind;

  readonly projectedMinorUnits?: number;

  readonly storedMinorUnits?: number;
  readonly projectedUom?: string;
  readonly storedUom?: string;
}

export const emptyBalanceSheet = (): BalanceSheet => frozenRecord([]);

export const balanceAt = (
  sheet: BalanceSheet,
  bucketKey: string,
): BucketBalance | null =>
  isRecord(sheet) && isString(bucketKey) ? recordValue(sheet, bucketKey) : null;

export const balanceEntries = (sheet: BalanceSheet): readonly BucketBalance[] =>
  frozenArray(
    Object.keys(sheet)
      .sort()
      .map((key) => recordValue(sheet, key)!)
      .filter((balance): balance is BucketBalance => balance !== null),
  );

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

export const projectBalances = (
  postings: readonly LedgerPosting[],
): Result<BalanceSheet, LedgerError> =>
  applyPostings(emptyBalanceSheet(), postings);

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
