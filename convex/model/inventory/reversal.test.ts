/**
 * Unit tier — correction by reversal, and only by reversal.
 *
 * Every rule in `ADR-0003` §5 and `INV-0003-08` has a case here, including the two
 * that a stored row can break independently of the type field: a reversal chain and
 * a second reversal of one original.
 */
import { describe, expect, it } from "vitest";

import { makeQuantity, type Quantity } from "../uom/quantity";
import {
  planReversal,
  verifyExactCompensation,
  type OriginalTransaction,
  type ReversalRequest,
} from "./reversal";
import { validateLedgerTransaction } from "./ledgerTransaction";
import type { InventoryBucket } from "./stockIdentity";

const REQUEST_ID = "0192f0a0-2222-7abc-8def-0123456789ab";

const quantity = (minorUnits: number, uom = "PCS"): Quantity => {
  const made = makeQuantity(minorUnits, uom);
  if (!made.ok) throw new Error("fixture quantity is invalid");
  return made.value;
};

const physical = (locationId: string): InventoryBucket => ({
  orgId: "org1",
  warehouseId: "wh1",
  itemId: "item1",
  location: { kind: "PHYSICAL", locationId },
  stockStatus: "AVAILABLE",
});

const supplier: InventoryBucket = {
  orgId: "org1",
  warehouseId: "wh1",
  itemId: "item1",
  location: { kind: "VIRTUAL", boundary: "SUPPLIER_RECEIPT" },
  stockStatus: "AVAILABLE",
};

const original = (
  overrides: Partial<OriginalTransaction> = {},
): OriginalTransaction => ({
  transactionId: "tx1",
  orgId: "org1",
  warehouseId: "wh1",
  type: "RECEIPT",
  lines: [
    { bucket: physical("dock"), quantity: quantity(10_000) },
    { bucket: supplier, quantity: quantity(-10_000) },
  ],
  ...overrides,
});

const reversal = (
  overrides: Partial<ReversalRequest> = {},
): ReversalRequest => ({
  orgId: "org1",
  operation: "inventory.transaction.reverse",
  requestId: REQUEST_ID,
  actorUserId: "user2",
  occurredAt: 1_700_000_100_000,
  reasonCodeId: "reason1",
  original: original(),
  existingReversalId: null,
  ...overrides,
});

describe("planning a reversal", () => {
  it("negates every line, keeps the buckets, and names the original", () => {
    const planned = planReversal(reversal());
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;

    expect(planned.value.header.type).toBe("REVERSAL");
    expect(planned.value.header.reversalOfTransactionId).toBe("tx1");
    expect(planned.value.header.reasonCodeId).toBe("reason1");
    expect(planned.value.header.source).toEqual({
      type: "REVERSAL",
      id: "tx1",
    });
    expect(planned.value.lines).toHaveLength(2);
    for (const line of planned.value.lines) {
      const source = original().lines.find(
        (candidate) =>
          candidate.bucket.location.kind === line.bucket.location.kind,
      );
      expect(line.quantity.minorUnits).toBe(-source!.quantity.minorUnits);
    }
    for (const total of planned.value.conservation) {
      expect(total.minorUnits).toBe(0);
    }
  });

  it("takes the warehouse from the original, never from the request", () => {
    const planned = planReversal(
      reversal({ original: original({ warehouseId: "wh1" }) }),
    );
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.value.header.warehouseId).toBe("wh1");
  });

  it("refuses a reversal of a reversal, by type and by link", () => {
    const byType = planReversal(
      reversal({ original: original({ type: "REVERSAL" }) }),
    );
    expect(byType.ok).toBe(false);
    if (!byType.ok) expect(byType.error.code).toBe("REVERSAL_OF_REVERSAL");

    const byLink = planReversal(
      reversal({
        original: original({ reversalOfTransactionId: "tx0" }),
      }),
    );
    expect(byLink.ok).toBe(false);
    if (!byLink.ok) expect(byLink.error.code).toBe("REVERSAL_OF_REVERSAL");
  });

  it("refuses a second reversal of one original", () => {
    const refused = planReversal(reversal({ existingReversalId: "tx2" }));
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe("REVERSAL_ALREADY_EXISTS");
      expect(refused.error).toMatchObject({ transactionId: "tx2" });
    }
  });

  it("refuses an original belonging to another organization", () => {
    const refused = planReversal(
      reversal({ original: original({ orgId: "org2" }) }),
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe("REVERSAL_CROSS_ORG");
      expect(refused.error).toMatchObject({
        expected: "org1",
        received: "org2",
      });
    }
  });

  it("requires a reason code", () => {
    for (const forged of ["", undefined, null, 7]) {
      const refused = planReversal(reversal({ reasonCodeId: forged as never }));
      expect(refused.ok, String(forged)).toBe(false);
      if (!refused.ok) expect(refused.error.code).toBe("REASON_CODE_REQUIRED");
    }
  });

  it("refuses an original with no lines, or a forged line", () => {
    const empty = planReversal(reversal({ original: original({ lines: [] }) }));
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.code).toBe("NO_LINES");

    const forged = planReversal(
      reversal({
        original: original({
          lines: [
            {
              bucket: physical("dock"),
              quantity: { uom: "PCS", minorUnits: Number.NaN } as Quantity,
            },
          ],
        }),
      }),
    );
    expect(forged.ok).toBe(false);
    if (!forged.ok) expect(forged.error.code).toBe("LINE_QUANTITY_INVALID");
  });

  it("refuses a forged request and a forged clock", () => {
    expect(planReversal(null as never).ok).toBe(false);
    const clock = planReversal(reversal({ occurredAt: -1 }));
    expect(clock.ok).toBe(false);
    if (!clock.ok) expect(clock.error.code).toBe("HEADER_FIELD_INVALID");
  });

  it("refuses an original whose lines collide on one bucket", () => {
    const refused = planReversal(
      reversal({
        original: original({
          lines: [
            { bucket: physical("dock"), quantity: quantity(5_000) },
            { bucket: physical("dock"), quantity: quantity(5_000) },
            { bucket: supplier, quantity: quantity(-10_000) },
          ],
        }),
      }),
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe("REVERSAL_NOT_EXACT");
      expect(refused.error).toMatchObject({ reason: "BUCKET_SET" });
    }
  });

  it("produces a reversal the ordinary rules accept", () => {
    const planned = planReversal(reversal());
    if (!planned.ok) throw new Error("expected a plan");
    const revalidated = validateLedgerTransaction({
      orgId: "org1",
      warehouseId: "wh1",
      type: "REVERSAL",
      operation: planned.value.header.operation,
      requestId: planned.value.header.requestId,
      actorUserId: planned.value.header.actorUserId,
      occurredAt: planned.value.header.occurredAt,
      source: planned.value.header.source,
      reasonCodeId: "reason1",
      reversalOfTransactionId: "tx1",
      lines: planned.value.lines.map((line) => ({
        bucket: line.bucket,
        quantity: line.quantity,
      })),
    });
    expect(revalidated.ok).toBe(true);
  });
});

describe("exact compensation", () => {
  it("accepts the plan it produced", () => {
    const planned = planReversal(reversal());
    if (!planned.ok) throw new Error("expected a plan");
    expect(verifyExactCompensation(original(), planned.value)).toEqual({
      ok: true,
      value: true,
    });
  });

  it("refuses a plan with a line removed", () => {
    const planned = planReversal(reversal());
    if (!planned.ok) throw new Error("expected a plan");
    const short = { ...planned.value, lines: planned.value.lines.slice(1) };
    const refused = verifyExactCompensation(original(), short);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error).toMatchObject({ reason: "LINE_COUNT" });
    }
  });

  it("refuses a plan whose quantity is not the exact negation", () => {
    const planned = planReversal(reversal());
    if (!planned.ok) throw new Error("expected a plan");
    const tampered = {
      ...planned.value,
      lines: planned.value.lines.map((line, index) =>
        index === 0
          ? { ...line, quantity: quantity(line.quantity.minorUnits + 1) }
          : line,
      ),
    };
    const refused = verifyExactCompensation(original(), tampered);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error).toMatchObject({ reason: "QUANTITY" });
    }
  });

  it("refuses a plan naming a bucket the original never touched", () => {
    const planned = planReversal(reversal());
    if (!planned.ok) throw new Error("expected a plan");
    const swapped = {
      ...planned.value,
      lines: planned.value.lines.map((line, index) =>
        index === 0 ? { ...line, bucketKey: `${line.bucketKey}x` } : line,
      ),
    };
    const refused = verifyExactCompensation(original(), swapped);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error).toMatchObject({ reason: "BUCKET_SET" });
    }
  });

  it("refuses a forged original", () => {
    const planned = planReversal(reversal());
    if (!planned.ok) throw new Error("expected a plan");
    expect(verifyExactCompensation(null as never, planned.value).ok).toBe(
      false,
    );
  });
});
