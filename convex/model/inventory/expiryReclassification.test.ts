/**
 * Unit tier — expiry reclassification as planned intents.
 *
 * The rule under test is narrow and easy to get wrong: expiry is the **expiration
 * date** against an explicit `asOf`, strictly before, and it produces a *balanced
 * pair* rather than a status edit.
 */
import { describe, expect, it } from "vitest";

import { makeBusinessDate, type BusinessDate } from "../time/businessDate";
import { makeQuantity, type Quantity } from "../uom/quantity";
import {
  EXPIRY_SOURCE_STATUSES,
  EXPIRY_TARGET_STATUS,
  isExpiredAsOf,
  planExpiryReclassification,
  type ExpiryCandidate,
} from "./expiryReclassification";
import {
  encodeBucketKey,
  type InventoryBucket,
  type StockStatus,
} from "./stockIdentity";

const date = (year: number, month: number, day: number): BusinessDate => {
  const made = makeBusinessDate(year, month, day);
  if (!made.ok) throw new Error("fixture date is invalid");
  return made.value;
};

const quantity = (minorUnits: number): Quantity => {
  const made = makeQuantity(minorUnits, "PCS");
  if (!made.ok) throw new Error("fixture quantity is invalid");
  return made.value;
};

const bucket = (overrides: Partial<InventoryBucket> = {}): InventoryBucket => ({
  orgId: "org1",
  warehouseId: "wh1",
  itemId: "item1",
  location: { kind: "PHYSICAL", locationId: "rack1" },
  lotId: "lot1",
  stockStatus: "AVAILABLE",
  ...overrides,
});

const candidate = (
  overrides: Partial<ExpiryCandidate> = {},
): ExpiryCandidate => {
  const input = overrides.bucket ?? bucket();
  const key = encodeBucketKey(input);
  if (!key.ok) throw new Error("fixture bucket is invalid");
  return {
    bucketKey: key.value,
    bucket: input,
    quantity: quantity(10_000),
    expirationDate: date(2027, 1, 31),
    ...overrides,
  };
};

const plan = (candidates: readonly ExpiryCandidate[], asOf: BusinessDate) => {
  const planned = planExpiryReclassification({ asOf, candidates });
  if (!planned.ok) throw new Error(`expected a plan: ${planned.error.code}`);
  return planned.value;
};

describe("the expiry rule", () => {
  it("is the expiration date, strictly before asOf", () => {
    const expiry = date(2027, 1, 31);
    expect(isExpiredAsOf(expiry, date(2027, 1, 30))).toEqual({
      ok: true,
      value: false,
    });
    // Usable through the 31st.
    expect(isExpiredAsOf(expiry, date(2027, 1, 31))).toEqual({
      ok: true,
      value: false,
    });
    expect(isExpiredAsOf(expiry, date(2027, 2, 1))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("treats a lot with no expiration date as never expired", () => {
    expect(isExpiredAsOf(null, date(2099, 12, 31))).toEqual({
      ok: true,
      value: false,
    });
  });

  it("refuses a forged date rather than sorting it", () => {
    const refused = isExpiredAsOf(
      { year: 2027, month: 13, day: 40 } as BusinessDate,
      date(2027, 1, 1),
    );
    expect(refused.ok).toBe(false);
    const reference = isExpiredAsOf(date(2027, 1, 1), null as never);
    expect(reference.ok).toBe(false);
    if (!reference.ok) expect(reference.error.code).toBe("INVALID_AS_OF_DATE");
  });
});

describe("planning", () => {
  it("moves expired AVAILABLE stock into EXPIRED as a balanced pair", () => {
    const planned = plan([candidate()], date(2027, 2, 1));
    expect(planned.skipped).toEqual([]);
    expect(planned.intents).toHaveLength(1);

    const intent = planned.intents[0]!;
    expect(intent.fromStatus).toBe("AVAILABLE");
    expect(intent.toStatus).toBe(EXPIRY_TARGET_STATUS);
    expect(intent.minorUnits).toBe(10_000);
    expect(intent.uom).toBe("PCS");
    expect(intent.lines).toHaveLength(2);

    const [out, into] = intent.lines;
    expect(out!.quantity.minorUnits).toBe(-10_000);
    expect(into!.quantity.minorUnits).toBe(10_000);
    expect(out!.bucket.stockStatus).toBe("AVAILABLE");
    expect(into!.bucket.stockStatus).toBe("EXPIRED");
    // Only the status changes: same location, same lot, same item.
    expect({ ...into!.bucket, stockStatus: "AVAILABLE" }).toEqual({
      ...out!.bucket,
    });
    expect(out!.quantity.minorUnits + into!.quantity.minorUnits).toBe(0);
  });

  it("freezes the plan, its intents, and their line arrays", () => {
    const planned = plan([candidate()], date(2027, 2, 1));
    expect(Object.isFrozen(planned)).toBe(true);
    expect(Object.isFrozen(planned.intents)).toBe(true);
    expect(Object.isFrozen(planned.intents[0])).toBe(true);
    expect(Object.isFrozen(planned.intents[0]!.lines)).toBe(true);
    expect(Object.isFrozen(planned.skipped)).toBe(true);
  });

  it("skips, and says why, rather than silently dropping a candidate", () => {
    const cases: readonly [ExpiryCandidate, string][] = [
      [candidate({ expirationDate: date(2099, 1, 1) }), "NOT_EXPIRED"],
      [candidate({ expirationDate: null }), "NO_EXPIRATION_DATE"],
      [
        candidate({
          bucket: bucket({ stockStatus: "QUARANTINE" }),
        }),
        "STATUS_NOT_ELIGIBLE",
      ],
      [
        candidate({
          bucket: bucket({
            location: { kind: "VIRTUAL", boundary: "SUPPLIER_RECEIPT" },
          }),
        }),
        "NOT_PHYSICAL",
      ],
      [candidate({ quantity: quantity(0) }), "NON_POSITIVE_BALANCE"],
      [candidate({ quantity: quantity(-5) }), "NON_POSITIVE_BALANCE"],
    ];
    for (const [input, reason] of cases) {
      const planned = plan([input], date(2027, 2, 1));
      expect(planned.intents, reason).toEqual([]);
      expect(planned.skipped, reason).toHaveLength(1);
      expect(planned.skipped[0]).toMatchObject({ reason });
    }
  });

  it("never reclassifies stock that is already EXPIRED", () => {
    const planned = plan(
      [candidate({ bucket: bucket({ stockStatus: "EXPIRED" }) })],
      date(2027, 2, 1),
    );
    expect(planned.intents).toEqual([]);
    expect(planned.skipped[0]).toMatchObject({
      reason: "STATUS_NOT_ELIGIBLE",
    });
  });

  it("only moves out of AVAILABLE, which is the documented source set", () => {
    expect([...EXPIRY_SOURCE_STATUSES]).toEqual(["AVAILABLE"]);
    const statuses: readonly StockStatus[] = [
      "QC_HOLD",
      "QUARANTINE",
      "REJECTED",
      "SCRAP",
      "EXPIRED",
    ];
    for (const stockStatus of statuses) {
      const planned = plan(
        [candidate({ bucket: bucket({ stockStatus }) })],
        date(2027, 2, 1),
      );
      expect(planned.intents, stockStatus).toEqual([]);
    }
  });

  it("is deterministic and ordered by bucket key, whatever order it was given", () => {
    const first = candidate({
      bucket: bucket({ location: { kind: "PHYSICAL", locationId: "aaa" } }),
    });
    const second = candidate({
      bucket: bucket({ location: { kind: "PHYSICAL", locationId: "zzz" } }),
    });
    const forward = plan([first, second], date(2027, 2, 1));
    const backward = plan([second, first], date(2027, 2, 1));
    expect(backward).toEqual(forward);
    expect(forward.intents.map((intent) => intent.bucketKey)).toEqual(
      [...forward.intents.map((intent) => intent.bucketKey)].sort(),
    );
  });

  it("refuses a forged candidate rather than skipping it", () => {
    const forged = planExpiryReclassification({
      asOf: date(2027, 2, 1),
      candidates: [null as never],
    });
    expect(forged.ok).toBe(false);
    if (!forged.ok) expect(forged.error.code).toBe("LINE_NOT_A_RECORD");

    const badBucket = planExpiryReclassification({
      asOf: date(2027, 2, 1),
      candidates: [
        {
          bucketKey: "IB1|forged",
          bucket: bucket({ itemId: "a|b" }),
          quantity: quantity(10_000),
          expirationDate: date(2027, 1, 1),
        },
      ],
    });
    expect(badBucket.ok).toBe(false);
    if (!badBucket.ok) {
      expect(badBucket.error.code).toBe("LINE_BUCKET_INVALID");
    }
  });

  it("refuses a forged asOf and a forged input", () => {
    const asOf = planExpiryReclassification({
      asOf: { year: 0, month: 0, day: 0 } as BusinessDate,
      candidates: [],
    });
    expect(asOf.ok).toBe(false);
    if (!asOf.ok) expect(asOf.error.code).toBe("INVALID_AS_OF_DATE");

    expect(planExpiryReclassification(null as never).ok).toBe(false);
  });

  it("plans nothing for an empty page, without failing", () => {
    const planned = plan([], date(2027, 2, 1));
    expect(planned).toEqual({ intents: [], skipped: [] });
  });
});
