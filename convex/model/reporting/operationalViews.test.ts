import { describe, expect, it } from "vitest";

import {
  prioritizeOperationalExceptions,
  summarizeStockByLot,
  summarizeStockBySku,
} from "./operationalViews";

const balances = [
  {
    itemId: "item-a",
    sku: "A",
    itemName: "Carton A",
    baseUom: "EA",
    stockStatus: "AVAILABLE",
    baseMinorUnits: 10_000,
    lotId: "lot-a",
    lotCode: "LOT-A",
    expirationDate: "2026-09-01",
  },
  {
    itemId: "item-a",
    sku: "A",
    itemName: "Carton A",
    baseUom: "EA",
    stockStatus: "QC_HOLD",
    baseMinorUnits: 2_000,
    lotId: "lot-a",
    lotCode: "LOT-A",
    expirationDate: "2026-09-01",
  },
] as const;

describe("operational stock views", () => {
  it("separates available, committed, ATP, and restricted stock", () => {
    expect(
      summarizeStockBySku(balances, [
        {
          itemId: "item-a",
          baseUom: "EA",
          baseMinorUnits: 4_000,
          consumedBaseMinorUnits: 1_000,
          releasedBaseMinorUnits: 0,
        },
      ]),
    ).toStrictEqual([
      expect.objectContaining({
        availableBaseMinorUnits: 10_000,
        committedBaseMinorUnits: 3_000,
        atpBaseMinorUnits: 7_000,
        qcHoldBaseMinorUnits: 2_000,
      }),
    ]);
  });

  it("groups lot stock and sorts expiring lots first", () => {
    expect(summarizeStockByLot(balances)).toStrictEqual([
      expect.objectContaining({
        lotCode: "LOT-A",
        availableBaseMinorUnits: 10_000,
        restrictedBaseMinorUnits: 2_000,
      }),
    ]);
  });
});

describe("exception priority", () => {
  it("sorts severity first and oldest obligations first", () => {
    const rows = prioritizeOperationalExceptions([
      {
        sourceType: "TASK",
        sourceId: "2",
        severity: "HIGH",
        titleCode: "TASK",
        detail: "b",
        occurredAt: 20,
      },
      {
        sourceType: "QC",
        sourceId: "1",
        severity: "CRITICAL",
        titleCode: "QC",
        detail: "a",
        occurredAt: 30,
      },
      {
        sourceType: "TASK",
        sourceId: "1",
        severity: "HIGH",
        titleCode: "TASK",
        detail: "a",
        occurredAt: 10,
      },
    ]);
    expect(rows.map((row) => row.sourceId)).toEqual(["1", "1", "2"]);
    expect(rows[0]?.severity).toBe("CRITICAL");
  });
});
