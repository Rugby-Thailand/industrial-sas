import { describe, expect, it } from "vitest";

import { makeQuantity, type Quantity } from "../uom/quantity";
import {
  applyPostings,
  applyPostingsChecked,
  balanceAt,
  balanceEntries,
  balanceSheetFromRows,
  checkNonNegativeBalances,
  emptyBalanceSheet,
  projectBalances,
  reconcileBalances,
  validateBucketBalance,
  zeroBalance,
  type BucketBalance,
  type LedgerPosting,
} from "./balanceProjection";
import {
  encodeBucketKey,
  type InventoryBucket,
  type StockStatus,
} from "./stockIdentity";

const quantity = (minorUnits: number, uom = "PCS"): Quantity => {
  const made = makeQuantity(minorUnits, uom);
  if (!made.ok) throw new Error("fixture quantity is invalid");
  return made.value;
};

const bucket = (overrides: Partial<InventoryBucket> = {}): InventoryBucket => ({
  orgId: "org1",
  warehouseId: "wh1",
  itemId: "item1",
  location: { kind: "PHYSICAL", locationId: "loc1" },
  stockStatus: "AVAILABLE",
  ...overrides,
});

const posting = (
  input: InventoryBucket,
  minorUnits: number,
  uom = "PCS",
): LedgerPosting => {
  const key = encodeBucketKey(input);
  if (!key.ok) throw new Error("fixture bucket is invalid");
  return {
    bucketKey: key.value,
    bucket: input,
    quantity: quantity(minorUnits, uom),
  };
};

const keyOf = (input: InventoryBucket): string => {
  const key = encodeBucketKey(input);
  if (!key.ok) throw new Error("fixture bucket is invalid");
  return key.value;
};

describe("balance sheet construction", () => {
  it("starts empty, frozen, and with a null prototype", () => {
    const sheet = emptyBalanceSheet();
    expect(balanceEntries(sheet)).toEqual([]);
    expect(Object.isFrozen(sheet)).toBe(true);
    expect(Object.getPrototypeOf(sheet)).toBeNull();
  });

  it("answers null for an absent key and for a prototype key", () => {
    const sheet = emptyBalanceSheet();
    expect(balanceAt(sheet, "missing")).toBeNull();
    expect(balanceAt(sheet, "toString")).toBeNull();
    expect(balanceAt(sheet, "constructor")).toBeNull();
  });

  it("orders entries by bucket key, deterministically", () => {
    const applied = applyPostings(emptyBalanceSheet(), [
      posting(bucket({ location: { kind: "PHYSICAL", locationId: "z" } }), 1),
      posting(bucket({ location: { kind: "PHYSICAL", locationId: "a" } }), 2),
      posting(bucket({ location: { kind: "PHYSICAL", locationId: "m" } }), 3),
    ]);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const keys = balanceEntries(applied.value).map((entry) => entry.bucketKey);
    expect([...keys].sort()).toEqual(keys);
  });

  it("refuses a duplicate balance row instead of letting the last one win", () => {
    const row: BucketBalance = {
      bucketKey: keyOf(bucket()),
      bucket: bucket(),
      quantity: quantity(5),
    };
    const refused = balanceSheetFromRows([row, row]);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("BUCKET_UOM_CONFLICT");
  });

  it("re-validates a stored row, because a document field is forgeable", () => {
    const forged = validateBucketBalance({
      bucketKey: keyOf(bucket()),
      bucket: bucket(),
      quantity: { uom: "PCS", minorUnits: Number.NaN } as Quantity,
    });
    expect(forged.ok).toBe(false);
    if (!forged.ok) expect(forged.error.code).toBe("LINE_QUANTITY_INVALID");

    const noKey = validateBucketBalance({
      bucketKey: "",
      bucket: bucket(),
      quantity: quantity(1),
    });
    expect(noKey.ok).toBe(false);
    if (!noKey.ok) expect(noKey.error.code).toBe("HEADER_FIELD_INVALID");
  });
});

describe("folding postings", () => {
  it("never mutates the sheet it was given", () => {
    const first = applyPostings(emptyBalanceSheet(), [posting(bucket(), 10)]);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const before = balanceEntries(first.value).map((entry) => ({
      ...entry.quantity,
    }));

    const second = applyPostings(first.value, [posting(bucket(), 5)]);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(
      balanceEntries(first.value).map((entry) => ({ ...entry.quantity })),
    ).toEqual(before);
    expect(balanceAt(second.value, keyOf(bucket()))?.quantity.minorUnits).toBe(
      15,
    );
  });

  it("keeps a bucket emptied to zero rather than dropping the row", () => {
    const applied = applyPostings(emptyBalanceSheet(), [
      posting(bucket(), 10),
      posting(bucket(), -10),
    ]);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const balance = balanceAt(applied.value, keyOf(bucket()));
    expect(balance).not.toBeNull();
    expect(balance?.quantity.minorUnits).toBe(0);
  });

  it("refuses a UOM change on a bucket that already holds stock", () => {
    const applied = applyPostings(emptyBalanceSheet(), [
      posting(bucket(), 10, "PCS"),
    ]);
    if (!applied.ok) throw new Error("expected a sheet");
    const refused = applyPostings(applied.value, [posting(bucket(), 10, "KG")]);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("BUCKET_UOM_CONFLICT");
  });

  it("refuses a total beyond the magnitude bound", () => {
    const applied = applyPostings(emptyBalanceSheet(), [
      posting(bucket(), 1_000_000_000_000),
      posting(bucket(), 1_000_000_000_000),
    ]);
    expect(applied.ok).toBe(false);
    if (!applied.ok) {
      expect(applied.error.code).toBe("BALANCE_ARITHMETIC");
    }
  });

  it("replays from nothing exactly as it folds incrementally", () => {
    const postings = [
      posting(bucket(), 10_000),
      posting(
        bucket({ location: { kind: "PHYSICAL", locationId: "loc2" } }),
        4_000,
      ),
      posting(bucket(), -3_000),
    ];
    const replayed = projectBalances(postings);

    let incremental = applyPostings(emptyBalanceSheet(), []);
    for (const single of postings) {
      if (!incremental.ok) throw new Error("expected a sheet");
      incremental = applyPostings(incremental.value, [single]);
    }
    expect(replayed.ok && incremental.ok).toBe(true);
    if (!replayed.ok || !incremental.ok) return;
    expect(balanceEntries(incremental.value)).toEqual(
      balanceEntries(replayed.value),
    );
  });
});

describe("non-negativity", () => {
  it("refuses a negative AVAILABLE balance by its own name", () => {
    const refused = applyPostingsChecked(emptyBalanceSheet(), [
      posting(bucket(), -1),
    ]);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe("NEGATIVE_AVAILABLE_BALANCE");
      expect(refused.error).toMatchObject({ resulting: -1, uom: "PCS" });
    }
  });

  it("refuses every other physical status too, reported separately", () => {
    const statuses: readonly StockStatus[] = [
      "QC_HOLD",
      "QUARANTINE",
      "REJECTED",
      "SCRAP",
      "EXPIRED",
    ];
    for (const stockStatus of statuses) {
      const refused = applyPostingsChecked(emptyBalanceSheet(), [
        posting(bucket({ stockStatus }), -1),
      ]);
      expect(refused.ok, stockStatus).toBe(false);
      if (!refused.ok) {
        expect(refused.error.code).toBe("NEGATIVE_PHYSICAL_BALANCE");
        expect(refused.error).toMatchObject({ stockStatus });
      }
    }
  });

  it("permits a virtual boundary to run arbitrarily negative", () => {
    const supplier = bucket({
      location: { kind: "VIRTUAL", boundary: "SUPPLIER_RECEIPT" },
    });
    const applied = applyPostingsChecked(emptyBalanceSheet(), [
      posting(supplier, -1_000_000),
      posting(bucket(), 1_000_000),
    ]);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(balanceAt(applied.value, keyOf(supplier))?.quantity.minorUnits).toBe(
      -1_000_000,
    );
  });

  it("permits a zero result, which is not negative", () => {
    const applied = applyPostingsChecked(emptyBalanceSheet(), [
      posting(bucket(), 10),
      posting(bucket(), -10),
    ]);
    expect(applied.ok).toBe(true);
  });

  it("checks only the buckets it was told were touched", () => {
    const sheet = applyPostings(emptyBalanceSheet(), [
      posting(bucket({ location: { kind: "PHYSICAL", locationId: "bad" } }), 1),
    ]);
    if (!sheet.ok) throw new Error("expected a sheet");
    // A pre-existing anomaly at an untouched bucket must not refuse unrelated work.
    expect(checkNonNegativeBalances(sheet.value, []).ok).toBe(true);
  });
});

describe("reconciliation", () => {
  const key = keyOf(bucket());

  const sheetOf = (rows: readonly BucketBalance[]) => {
    const sheet = balanceSheetFromRows(rows);
    if (!sheet.ok) throw new Error("expected a sheet");
    return sheet.value;
  };

  const row = (minorUnits: number, uom = "PCS"): BucketBalance => ({
    bucketKey: key,
    bucket: bucket(),
    quantity: quantity(minorUnits, uom),
  });

  it("says nothing when the projection and the stored balance agree", () => {
    const drift = reconcileBalances(sheetOf([row(10)]), sheetOf([row(10)]));
    expect(drift.ok).toBe(true);
    if (!drift.ok) return;
    expect(drift.value).toEqual([]);
    expect(Object.isFrozen(drift.value)).toBe(true);
  });

  it("reports a quantity mismatch with both sides", () => {
    const drift = reconcileBalances(sheetOf([row(10)]), sheetOf([row(7)]));
    expect(drift.ok).toBe(true);
    if (!drift.ok) return;
    expect(drift.value).toEqual([
      {
        bucketKey: key,
        kind: "QUANTITY_MISMATCH",
        projectedMinorUnits: 10,
        storedMinorUnits: 7,
        projectedUom: "PCS",
        storedUom: "PCS",
      },
    ]);
  });

  it("distinguishes a missing balance row from an extra one", () => {
    const missing = reconcileBalances(sheetOf([row(10)]), sheetOf([]));
    if (!missing.ok) throw new Error("expected drift");
    expect(missing.value[0]).toMatchObject({
      kind: "MISSING_BALANCE",
      projectedMinorUnits: 10,
    });
    expect("storedMinorUnits" in (missing.value[0] ?? {})).toBe(false);

    const extra = reconcileBalances(sheetOf([]), sheetOf([row(10)]));
    if (!extra.ok) throw new Error("expected drift");
    expect(extra.value[0]).toMatchObject({
      kind: "EXTRA_BALANCE",
      storedMinorUnits: 10,
    });
  });

  it("reports a unit-of-measure mismatch as its own kind", () => {
    const drift = reconcileBalances(
      sheetOf([row(10, "PCS")]),
      sheetOf([row(10, "KG")]),
    );
    if (!drift.ok) throw new Error("expected drift");
    expect(drift.value[0]).toMatchObject({ kind: "UOM_MISMATCH" });
  });

  it("is deterministic: the union of keys, sorted", () => {
    const left = sheetOf([
      { bucketKey: "IB1|z", bucket: bucket(), quantity: quantity(1) },
      { bucketKey: "IB1|a", bucket: bucket(), quantity: quantity(1) },
    ]);
    const drift = reconcileBalances(left, sheetOf([]));
    if (!drift.ok) throw new Error("expected drift");
    expect(drift.value.map((record) => record.bucketKey)).toEqual([
      "IB1|a",
      "IB1|z",
    ]);
  });
});

describe("zero balance", () => {
  it("builds a validated zero for a bucket", () => {
    const zero = zeroBalance(keyOf(bucket()), bucket(), "PCS");
    expect(zero.ok).toBe(true);
    if (!zero.ok) return;
    expect(zero.value.quantity.minorUnits).toBe(0);
    expect(Object.isFrozen(zero.value)).toBe(true);
  });

  it("refuses an invalid UOM rather than inventing one", () => {
    expect(zeroBalance(keyOf(bucket()), bucket(), "p c s").ok).toBe(false);
  });
});
