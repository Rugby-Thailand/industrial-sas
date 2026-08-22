import { describe, expect, it } from "vitest";

import {
  previewBalancesFor,
  previewPage,
  previewTransactionsFor,
  PREVIEW_BALANCES,
  PREVIEW_ORG_ID,
  PREVIEW_TRANSACTIONS,
  PREVIEW_WAREHOUSES,
} from "./ledger";

import { decodeBucketKey } from "../../../convex/model/inventory/stockIdentity";
import {
  ASIA_BANGKOK,
  businessDateFromInstant,
  businessDateToIso,
} from "../../../convex/model/time/businessDate";

describe("preview dataset", () => {
  it("produces bucket keys the real decoder accepts", () => {
    /*
     * The point of building the fixture through `encodeBucketKey` rather than by
     * concatenation: a hand-written key that merely looks plausible hides
     * exactly the column-width and truncation defects the preview exists to
     * expose.
     */
    for (const row of PREVIEW_BALANCES) {
      const decoded = decodeBucketKey(row.bucketKey);
      expect(decoded.ok, row.bucketKey).toBe(true);
      if (!decoded.ok) continue;
      expect(decoded.value.orgId).toBe(PREVIEW_ORG_ID);
      expect(decoded.value.stockStatus).toBe(row.stockStatus);
    }
  });

  it("keeps every seeded row, so a refused encoding fails here rather than thinning a table", () => {
    expect(PREVIEW_BALANCES.length).toBe(8);
    expect(PREVIEW_TRANSACTIONS.length).toBe(7);
  });

  it("gives every declared warehouse both balances and transactions", () => {
    for (const warehouse of PREVIEW_WAREHOUSES) {
      expect(previewBalancesFor(warehouse.id).length).toBeGreaterThan(0);
      expect(previewTransactionsFor(warehouse.id).length).toBeGreaterThan(0);
    }
  });

  it("scopes rows to one warehouse, as the server's warehouse-scoped reads do", () => {
    const [first, second] = PREVIEW_WAREHOUSES;
    if (first === undefined || second === undefined) throw new Error("fixture");

    const firstKeys = previewBalancesFor(first.id).map((row) => row.bucketKey);
    const secondKeys = previewBalancesFor(second.id).map(
      (row) => row.bucketKey,
    );

    expect(firstKeys.some((key) => secondKeys.includes(key))).toBe(false);
  });

  it("orders transactions newest first, as the server's index does", () => {
    for (const warehouse of PREVIEW_WAREHOUSES) {
      const occurred = previewTransactionsFor(warehouse.id).map(
        (row) => row.occurredAt,
      );
      expect(occurred).toEqual([...occurred].sort((a, b) => b - a));
    }
  });

  it("contains a reversal that names the transaction it compensates", () => {
    const reversal = PREVIEW_TRANSACTIONS.find(
      (row) => row.reversalOfTransactionId !== undefined,
    );
    expect(reversal).toBeDefined();

    const original = PREVIEW_TRANSACTIONS.find(
      (row) => row.transactionId === reversal?.reversalOfTransactionId,
    );
    // The original is present and unmarked: a reversal never edits it
    // (`INV-0003-08`).
    expect(original).toBeDefined();
    expect(original?.reversalOfTransactionId).toBeUndefined();
  });

  it("gives every transaction the business date its instant falls on in Bangkok", () => {
    /*
     * The fixture contains rows on both sides of a Bangkok midnight, which is
     * the case the history screen has to render without looking broken (`D-05`).
     * Computing the expected value through the real kernel rather than
     * restating it is what makes the fixture wrong-proof when a seed moves.
     */
    for (const row of PREVIEW_TRANSACTIONS) {
      const date = businessDateFromInstant(row.occurredAt, ASIA_BANGKOK);
      expect(date.ok, row.transactionId).toBe(true);
      if (!date.ok) continue;
      const iso = businessDateToIso(date.value);
      expect(iso.ok && iso.value, row.transactionId).toBe(row.businessDate);
    }
  });

  it("posts a reversal after the transaction it compensates", () => {
    for (const row of PREVIEW_TRANSACTIONS) {
      if (row.reversalOfTransactionId === undefined) continue;
      const original = PREVIEW_TRANSACTIONS.find(
        (candidate) => candidate.transactionId === row.reversalOfTransactionId,
      );
      expect(original).toBeDefined();
      expect(row.occurredAt).toBeGreaterThan(original?.occurredAt ?? 0);
    }
  });

  it("is deterministic, so the server and client renders agree", () => {
    expect(previewBalancesFor("prv_wh_bangpoo")).toEqual(
      previewBalancesFor("prv_wh_bangpoo"),
    );
  });
});

describe("previewPage", () => {
  const rows = [1, 2, 3, 4, 5];

  it("returns the first page and a cursor when more remain", () => {
    const page = previewPage(rows, 2, undefined);

    expect(page.ok && page.items).toEqual([1, 2]);
    expect(page.ok && page.nextCursor).toBe("2");
    expect(page.ok && page.complete).toBe(false);
  });

  it("resumes from a cursor", () => {
    const page = previewPage(rows, 2, "2");
    expect(page.ok && page.items).toEqual([3, 4]);
  });

  it("reports completion on the last page, not merely a short one", () => {
    const page = previewPage(rows, 2, "4");

    expect(page.ok && page.items).toEqual([5]);
    expect(page.ok && page.nextCursor).toBeNull();
    expect(page.ok && page.complete).toBe(true);
  });

  it("refuses a malformed cursor instead of silently starting over", () => {
    for (const cursor of ["", "abc", "-1", "1.5", "99"]) {
      const page = previewPage(rows, 2, cursor);
      expect(page.ok, cursor).toBe(false);
    }
  });

  it("handles an empty collection", () => {
    const page = previewPage([], 2, undefined);

    expect(page.ok && page.items).toEqual([]);
    expect(page.ok && page.complete).toBe(true);
  });
});
