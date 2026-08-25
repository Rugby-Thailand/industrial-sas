import { describe, expect, it } from "vitest";

import { makeQuantity, type Quantity } from "../uom/quantity";
import {
  INVENTORY_TRANSACTION_TYPES,
  MAX_TRANSACTION_LINES,
  REASON_REQUIRED_TYPES,
  isInventoryTransactionType,
  validateLedgerHeader,
  validateLedgerTransaction,
  type InventoryTransactionType,
  type LedgerLineDraft,
  type LedgerTransactionDraft,
} from "./ledgerTransaction";
import type { InventoryBucket, StockStatus } from "./stockIdentity";

const REQUEST_ID = "0192f0a0-1111-7abc-8def-0123456789ab";

const quantity = (minorUnits: number, uom = "PCS"): Quantity => {
  const made = makeQuantity(minorUnits, uom);
  if (!made.ok) throw new Error("fixture quantity is invalid");
  return made.value;
};

const physical = (
  locationId: string,
  overrides: Partial<InventoryBucket> = {},
): InventoryBucket => ({
  orgId: "org1",
  warehouseId: "wh1",
  itemId: "item1",
  location: { kind: "PHYSICAL", locationId },
  stockStatus: "AVAILABLE",
  ...overrides,
});

const boundary = (
  code: string,
  overrides: Partial<InventoryBucket> = {},
): InventoryBucket => ({
  orgId: "org1",
  warehouseId: "wh1",
  itemId: "item1",
  location: { kind: "VIRTUAL", boundary: code as never },
  stockStatus: "AVAILABLE",
  ...overrides,
});

const draft = (
  lines: readonly LedgerLineDraft[],
  overrides: Partial<LedgerTransactionDraft> = {},
): LedgerTransactionDraft => ({
  orgId: "org1",
  warehouseId: "wh1",
  type: "RECEIPT",
  operation: "inventory.transaction.post",
  requestId: REQUEST_ID,
  actorUserId: "user1",
  occurredAt: 1_700_000_000_000,
  source: { type: "PURCHASE_ORDER", id: "po1" },
  lines,
  ...overrides,
});

const receipt = (units = 10_000): readonly LedgerLineDraft[] => [
  { bucket: physical("dock"), quantity: quantity(units) },
  { bucket: boundary("SUPPLIER_RECEIPT"), quantity: quantity(-units) },
];

describe("transaction types", () => {
  it("is a closed set, and the reason-required subset is the three corrections", () => {
    expect([...INVENTORY_TRANSACTION_TYPES]).toHaveLength(10);
    expect(isInventoryTransactionType("RECEIPT")).toBe(true);
    expect(isInventoryTransactionType("INVENTED")).toBe(false);
    expect([...REASON_REQUIRED_TYPES].sort()).toEqual([
      "ADJUSTMENT",
      "REVERSAL",
      "SCRAP",
    ]);
  });
});

describe("header validation", () => {
  it("accepts a well-formed header and freezes it with absent optionals omitted", () => {
    const header = validateLedgerHeader(draft(receipt()));
    expect(header.ok).toBe(true);
    if (!header.ok) return;
    expect(Object.isFrozen(header.value)).toBe(true);
    expect(Object.isFrozen(header.value.source)).toBe(true);
    expect("reasonCodeId" in header.value).toBe(false);
    expect("deviceId" in header.value).toBe(false);
  });

  it("refuses a request ID that is not a UUIDv7", () => {
    for (const forged of [
      "not-a-uuid",
      "0192f0a0-1111-4abc-8def-0123456789ab",
      "0192f0a0-1111-7abc-0def-0123456789ab",
      "",
    ]) {
      const refused = validateLedgerHeader(
        draft(receipt(), { requestId: forged }),
      );
      expect(refused.ok, forged).toBe(false);
      if (!refused.ok) {
        expect(refused.error.code).toBe("REQUEST_IDENTITY_INVALID");
      }
    }
  });

  it("refuses a malformed operation, source, actor, and clock", () => {
    const cases: readonly [Partial<LedgerTransactionDraft>, string][] = [
      [{ operation: "post" }, "REQUEST_IDENTITY_INVALID"],
      [{ operation: "Inventory.Post" }, "REQUEST_IDENTITY_INVALID"],
      [
        { source: { type: "purchase order", id: "po1" } },
        "HEADER_FIELD_INVALID",
      ],
      [{ source: { type: "PURCHASE_ORDER", id: "" } }, "HEADER_FIELD_INVALID"],
      [{ actorUserId: "" }, "HEADER_FIELD_INVALID"],
      [{ occurredAt: -1 }, "HEADER_FIELD_INVALID"],
      [{ occurredAt: 1.5 }, "HEADER_FIELD_INVALID"],
      [{ occurredAt: Number.NaN }, "HEADER_FIELD_INVALID"],
      [
        { type: "MOVED" as InventoryTransactionType },
        "TRANSACTION_TYPE_INVALID",
      ],
    ];
    for (const [overrides, code] of cases) {
      const refused = validateLedgerHeader(draft(receipt(), overrides));
      expect(refused.ok, JSON.stringify(overrides)).toBe(false);
      if (!refused.ok) {
        expect(refused.error.code, JSON.stringify(overrides)).toBe(code);
      }
    }
  });

  it("ties the reversal link to the type in both directions", () => {
    const missing = validateLedgerHeader(
      draft(receipt(), { type: "REVERSAL", reasonCodeId: "reason1" }),
    );
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe("REVERSAL_LINK_MISSING");

    const unexpected = validateLedgerHeader(
      draft(receipt(), { reversalOfTransactionId: "tx1" }),
    );
    expect(unexpected.ok).toBe(false);
    if (!unexpected.ok) {
      expect(unexpected.error.code).toBe("REVERSAL_LINK_UNEXPECTED");
    }
  });

  it("requires a reason code for an adjustment, a scrap, and a reversal", () => {
    for (const type of ["ADJUSTMENT", "SCRAP"] as const) {
      const refused = validateLedgerHeader(draft(receipt(), { type }));
      expect(refused.ok, type).toBe(false);
      if (!refused.ok) expect(refused.error.code).toBe("REASON_CODE_REQUIRED");
    }
    const reversal = validateLedgerHeader(
      draft(receipt(), {
        type: "REVERSAL",
        reversalOfTransactionId: "tx1",
      }),
    );
    expect(reversal.ok).toBe(false);
    if (!reversal.ok) expect(reversal.error.code).toBe("REASON_CODE_REQUIRED");
  });

  it("does not require a reason code for an ordinary movement", () => {
    expect(validateLedgerHeader(draft(receipt(), { type: "PUTAWAY" })).ok).toBe(
      true,
    );
  });
});

describe("line validation", () => {
  it("refuses a zero-quantity line (INV-0003-03)", () => {
    const refused = validateLedgerTransaction(
      draft([
        { bucket: physical("dock"), quantity: quantity(0) },
        { bucket: boundary("SUPPLIER_RECEIPT"), quantity: quantity(0) },
      ]),
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe("LINE_QUANTITY_INVALID");
      expect(refused.error).toMatchObject({
        index: 0,
        cause: { code: "ZERO_NOT_ALLOWED" },
      });
    }
  });

  it("refuses a forged quantity before it can reach any arithmetic", () => {
    const refused = validateLedgerTransaction(
      draft([
        {
          bucket: physical("dock"),
          quantity: { uom: "PCS", minorUnits: Number.NaN } as Quantity,
        },
        { bucket: boundary("SUPPLIER_RECEIPT"), quantity: quantity(-1) },
      ]),
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe("LINE_QUANTITY_INVALID");
    }
  });

  it("refuses a line naming another organization or another warehouse", () => {
    const foreignOrg = validateLedgerTransaction(
      draft([
        { bucket: physical("dock", { orgId: "org2" }), quantity: quantity(1) },
        { bucket: boundary("SUPPLIER_RECEIPT"), quantity: quantity(-1) },
      ]),
    );
    expect(foreignOrg.ok).toBe(false);
    if (!foreignOrg.ok) expect(foreignOrg.error.code).toBe("LINE_ORG_MISMATCH");

    const foreignWarehouse = validateLedgerTransaction(
      draft([
        {
          bucket: physical("dock", { warehouseId: "wh2" }),
          quantity: quantity(1),
        },
        { bucket: boundary("SUPPLIER_RECEIPT"), quantity: quantity(-1) },
      ]),
    );
    expect(foreignWarehouse.ok).toBe(false);
    if (!foreignWarehouse.ok) {
      expect(foreignWarehouse.error.code).toBe("LINE_WAREHOUSE_MISMATCH");
    }
  });

  it("reports a local fault before the balance check, not as an imbalance", () => {
    const refused = validateLedgerTransaction(
      draft([
        { bucket: physical("dock"), quantity: quantity(10) },
        {
          bucket: physical("rack", { warehouseId: "wh2" }),
          quantity: quantity(-3),
        },
      ]),
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe("LINE_WAREHOUSE_MISMATCH");
    }
  });

  it("refuses a boundary posted against its declared direction", () => {
    const intoSupplier = validateLedgerTransaction(
      draft([
        { bucket: boundary("SUPPLIER_RECEIPT"), quantity: quantity(10) },
        { bucket: physical("dock"), quantity: quantity(-10) },
      ]),
    );
    expect(intoSupplier.ok).toBe(false);
    if (!intoSupplier.ok) {
      expect(intoSupplier.error.code).toBe("BOUNDARY_DIRECTION_VIOLATION");
      expect(intoSupplier.error).toMatchObject({
        boundary: "SUPPLIER_RECEIPT",
        flow: "SOURCE",
        sign: "POSITIVE",
      });
    }

    const outOfScrap = validateLedgerTransaction(
      draft(
        [
          { bucket: boundary("SCRAP_DAMAGE"), quantity: quantity(-5) },
          { bucket: physical("dock"), quantity: quantity(5) },
        ],
        { type: "SCRAP", reasonCodeId: "reason1" },
      ),
    );
    expect(outOfScrap.ok).toBe(false);
    if (!outOfScrap.ok) {
      expect(outOfScrap.error.code).toBe("BOUNDARY_DIRECTION_VIOLATION");
    }
  });

  it("permits either direction on a BOTH boundary", () => {
    const found = validateLedgerTransaction(
      draft(
        [
          { bucket: physical("dock"), quantity: quantity(5) },
          { bucket: boundary("INVENTORY_ADJUSTMENT"), quantity: quantity(-5) },
        ],
        { type: "ADJUSTMENT", reasonCodeId: "reason1" },
      ),
    );
    expect(found.ok).toBe(true);

    const lost = validateLedgerTransaction(
      draft(
        [
          { bucket: physical("dock"), quantity: quantity(-5) },
          { bucket: boundary("INVENTORY_ADJUSTMENT"), quantity: quantity(5) },
        ],
        { type: "ADJUSTMENT", reasonCodeId: "reason1" },
      ),
    );
    expect(lost.ok).toBe(true);
  });

  it("exempts a reversal from the direction rule, because it runs one backwards", () => {
    const reversal = validateLedgerTransaction(
      draft(
        [
          { bucket: physical("dock"), quantity: quantity(-10) },
          { bucket: boundary("SUPPLIER_RECEIPT"), quantity: quantity(10) },
        ],
        {
          type: "REVERSAL",
          reversalOfTransactionId: "tx1",
          reasonCodeId: "reason1",
        },
      ),
    );
    expect(reversal.ok).toBe(true);
  });
});

describe("transaction shape", () => {
  it("refuses an empty line list and a non-array", () => {
    const empty = validateLedgerTransaction(draft([]));
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.code).toBe("NO_LINES");

    const forged = validateLedgerTransaction(
      draft(undefined as unknown as readonly LedgerLineDraft[]),
    );
    expect(forged.ok).toBe(false);
    if (!forged.ok) expect(forged.error.code).toBe("NOT_A_TRANSACTION");
  });

  it("caps the line count rather than truncating it", () => {
    const many: LedgerLineDraft[] = [];
    for (let index = 0; index <= MAX_TRANSACTION_LINES; index += 1) {
      many.push({
        bucket: physical(`loc${index}`),
        quantity: quantity(index + 1),
      });
    }
    const refused = validateLedgerTransaction(draft(many));
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe("TOO_MANY_LINES");
      expect(refused.error).toMatchObject({ limit: MAX_TRANSACTION_LINES });
    }
  });

  it("refuses a transaction with no physical line", () => {
    const refused = validateLedgerTransaction(
      draft(
        [
          { bucket: boundary("INVENTORY_ADJUSTMENT"), quantity: quantity(5) },
          { bucket: boundary("RECONCILIATION"), quantity: quantity(-5) },
        ],
        { type: "ADJUSTMENT", reasonCodeId: "reason1" },
      ),
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("NO_PHYSICAL_LINE");
  });
});

describe("canonicalization", () => {
  it("sums duplicate lines on one bucket and orders lines by bucket key", () => {
    const validated = validateLedgerTransaction(
      draft([
        { bucket: physical("dock"), quantity: quantity(3_000) },
        { bucket: boundary("SUPPLIER_RECEIPT"), quantity: quantity(-10_000) },
        { bucket: physical("dock"), quantity: quantity(7_000) },
      ]),
    );
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    expect(validated.value.lines).toHaveLength(2);
    const dock = validated.value.lines.find(
      (line) => line.bucket.location.kind === "PHYSICAL",
    );
    expect(dock?.quantity.minorUnits).toBe(10_000);

    const keys = validated.value.lines.map((line) => line.bucketKey);
    expect([...keys].sort()).toEqual(keys);
  });

  it("produces the same canonical lines whatever order the client sent", () => {
    const forward = validateLedgerTransaction(
      draft([
        { bucket: physical("dock"), quantity: quantity(4_000) },
        { bucket: physical("rack"), quantity: quantity(6_000) },
        { bucket: boundary("SUPPLIER_RECEIPT"), quantity: quantity(-10_000) },
      ]),
    );
    const shuffled = validateLedgerTransaction(
      draft([
        { bucket: boundary("SUPPLIER_RECEIPT"), quantity: quantity(-10_000) },
        { bucket: physical("rack"), quantity: quantity(6_000) },
        { bucket: physical("dock"), quantity: quantity(4_000) },
      ]),
    );
    expect(forward.ok && shuffled.ok).toBe(true);
    if (!forward.ok || !shuffled.ok) return;
    expect(shuffled.value.lines).toEqual(forward.value.lines);
    expect(shuffled.value.deltas).toEqual(forward.value.deltas);
  });

  it("refuses a merged pair that cancels to zero instead of dropping it", () => {
    const refused = validateLedgerTransaction(
      draft([
        { bucket: physical("dock"), quantity: quantity(5_000) },
        { bucket: physical("dock"), quantity: quantity(-5_000) },
      ]),
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe("CANONICALIZED_LINE_IS_ZERO");
    }
  });

  it("refuses two units of measure on one bucket", () => {
    const refused = validateLedgerTransaction(
      draft([
        { bucket: physical("dock"), quantity: quantity(5_000, "PCS") },
        { bucket: physical("dock"), quantity: quantity(5_000, "KG") },
      ]),
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("BUCKET_UOM_CONFLICT");
  });
});

describe("conservation", () => {
  it("accepts a balanced receipt and reports one zero conservation group", () => {
    const validated = validateLedgerTransaction(draft(receipt()));
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    expect(validated.value.conservation).toHaveLength(1);
    expect(validated.value.conservation[0]?.minorUnits).toBe(0);
    expect(Object.isFrozen(validated.value)).toBe(true);
    expect(Object.isFrozen(validated.value.lines)).toBe(true);
    expect(Object.isFrozen(validated.value.conservation)).toBe(true);
    expect(Object.isFrozen(validated.value.deltas)).toBe(true);
  });

  it("accepts a location move: same group, location changes", () => {
    const validated = validateLedgerTransaction(
      draft(
        [
          { bucket: physical("dock"), quantity: quantity(-10_000) },
          { bucket: physical("rack"), quantity: quantity(10_000) },
        ],
        { type: "PUTAWAY", source: { type: "PUTAWAY_TASK", id: "task1" } },
      ),
    );
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    expect(validated.value.conservation).toHaveLength(1);
  });

  it("accepts a status change: same group, stock status changes", () => {
    const validated = validateLedgerTransaction(
      draft(
        [
          {
            bucket: physical("rack", { stockStatus: "QC_HOLD" }),
            quantity: quantity(-10_000),
          },
          {
            bucket: physical("rack", { stockStatus: "AVAILABLE" }),
            quantity: quantity(10_000),
          },
        ],
        {
          type: "STATUS_CHANGE",
          source: { type: "QC_DISPOSITION", id: "qc1" },
        },
      ),
    );
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    expect(validated.value.conservation).toHaveLength(1);
  });

  it("accepts a handling-unit build: same group, handling unit changes", () => {
    const validated = validateLedgerTransaction(
      draft(
        [
          { bucket: physical("rack"), quantity: quantity(-10_000) },
          {
            bucket: physical("rack", { handlingUnitId: "hu1" }),
            quantity: quantity(10_000),
          },
        ],
        { type: "MOVE", source: { type: "HANDLING_UNIT", id: "hu1" } },
      ),
    );
    expect(validated.ok).toBe(true);
  });

  it("refuses an unbalanced transaction and names the group and the residual", () => {
    const refused = validateLedgerTransaction(
      draft([
        { bucket: physical("dock"), quantity: quantity(10_000) },
        { bucket: boundary("SUPPLIER_RECEIPT"), quantity: quantity(-9_000) },
      ]),
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe("UNBALANCED_TRANSACTION");
      expect(refused.error).toMatchObject({ residual: 1_000, uom: "PCS" });
    }
  });

  it("refuses a lot change disguised as a movement", () => {
    const refused = validateLedgerTransaction(
      draft([
        {
          bucket: physical("rack", { lotId: "lotA" }),
          quantity: quantity(-10_000),
        },
        {
          bucket: physical("rack", { lotId: "lotB" }),
          quantity: quantity(10_000),
        },
      ]),
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe("UNBALANCED_TRANSACTION");
    }
  });

  it("refuses an item change disguised as a movement", () => {
    const refused = validateLedgerTransaction(
      draft([
        { bucket: physical("rack"), quantity: quantity(-10_000) },
        {
          bucket: physical("rack", { itemId: "item2" }),
          quantity: quantity(10_000),
        },
      ]),
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe("UNBALANCED_TRANSACTION");
    }
  });

  it("refuses an owner change disguised as a movement", () => {
    const refused = validateLedgerTransaction(
      draft([
        {
          bucket: physical("rack", { ownerId: "own1" }),
          quantity: quantity(-10_000),
        },
        {
          bucket: physical("rack", { ownerId: "own2" }),
          quantity: quantity(10_000),
        },
      ]),
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe("UNBALANCED_TRANSACTION");
    }
  });

  it("refuses a merged magnitude beyond the bound instead of losing precision", () => {
    const refused = validateLedgerTransaction(
      draft([
        { bucket: physical("dock"), quantity: quantity(1_000_000_000_000) },
        { bucket: physical("dock"), quantity: quantity(1_000_000_000_000) },
        {
          bucket: boundary("SUPPLIER_RECEIPT"),
          quantity: quantity(-1_000_000_000_000),
        },
      ]),
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe("BALANCE_ARITHMETIC");
      expect(refused.error).toMatchObject({ cause: { code: "OUT_OF_RANGE" } });
    }
  });

  it("refuses a conservation total beyond the bound", () => {
    const refused = validateLedgerTransaction(
      draft([
        { bucket: physical("dockA"), quantity: quantity(1_000_000_000_000) },
        { bucket: physical("dockB"), quantity: quantity(1_000_000_000_000) },
        { bucket: physical("dockC"), quantity: quantity(-1_000_000_000_000) },
        { bucket: physical("dockD"), quantity: quantity(-1_000_000_000_000) },
      ]),
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe("BALANCE_ARITHMETIC");
      expect(refused.error).toMatchObject({ cause: { code: "OUT_OF_RANGE" } });
    }
  });

  it("keeps two items in one transaction as two independent groups", () => {
    const validated = validateLedgerTransaction(
      draft([
        { bucket: physical("dock"), quantity: quantity(10_000) },
        { bucket: boundary("SUPPLIER_RECEIPT"), quantity: quantity(-10_000) },
        {
          bucket: physical("dock", { itemId: "item2" }),
          quantity: quantity(4_000),
        },
        {
          bucket: boundary("SUPPLIER_RECEIPT", { itemId: "item2" }),
          quantity: quantity(-4_000),
        },
      ]),
    );
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    expect(validated.value.conservation).toHaveLength(2);
    for (const total of validated.value.conservation) {
      expect(total.minorUnits).toBe(0);
    }
  });

  it("refuses when one of two groups balances and the other does not", () => {
    const refused = validateLedgerTransaction(
      draft([
        { bucket: physical("dock"), quantity: quantity(10_000) },
        { bucket: boundary("SUPPLIER_RECEIPT"), quantity: quantity(-10_000) },
        {
          bucket: physical("dock", { itemId: "item2" }),
          quantity: quantity(4_000),
        },
      ]),
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe("UNBALANCED_TRANSACTION");
      expect(refused.error).toMatchObject({ residual: 4_000 });
    }
  });
});

describe("statuses in a bucket", () => {
  it("treats every stock status as a distinct bucket dimension", () => {
    const statuses: readonly StockStatus[] = [
      "AVAILABLE",
      "QC_HOLD",
      "QUARANTINE",
      "REJECTED",
      "SCRAP",
      "EXPIRED",
    ];
    for (const status of statuses) {
      const validated = validateLedgerTransaction(
        draft(
          [
            {
              bucket: physical("rack", { stockStatus: "AVAILABLE" }),
              quantity: quantity(-1_000),
            },
            {
              bucket: physical("rack", { stockStatus: status }),
              quantity: quantity(1_000),
            },
          ],
          { type: "STATUS_CHANGE", source: { type: "QC", id: "q1" } },
        ),
      );

      expect(validated.ok, status).toBe(status !== "AVAILABLE");
    }
  });
});
