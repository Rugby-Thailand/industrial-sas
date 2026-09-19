import { describe, it, expect } from "vitest";
import {
  productPalletSummary,
  summaryFormatText,
  summaryStatusText,
} from "./productPalletSummary";
const en = (en: string) => en;
const th = (_en: string, th: string) => th;
describe("actual storage-unit summaries", () => {
  it("excludes retired and unrelated units and keeps mixed formats and moving status correct", () => {
    const summary = productPalletSummary("p", [
      {
        productId: "p",
        quantity: 50,
        storageFormat: "PALLET",
        status: "STORED",
      },
      {
        productId: "p",
        quantity: 25,
        storageFormat: "BOX",
        status: "AWAITING_PLACEMENT",
      },
      {
        productId: "p",
        quantity: 25,
        storageFormat: "OTHER",
        status: "STORED",
        moveStatus: "IN_TRANSIT",
      },
      { productId: "p", quantity: 999, storageFormat: "PALLET", retiredAt: 1 },
      { productId: "other", quantity: 999 },
    ]);
    expect(summary).toMatchObject({
      quantity: 100,
      count: 3,
      stored: 1,
      awaitingStorage: 1,
      moving: 1,
    });
    expect(summaryFormatText(summary, en)).toBe(
      "1 pallet · 1 box · 1 storage unit",
    );
    expect(summaryFormatText(summary, th)).toBe(
      "1 พาเลท · 1 กล่อง · 1 หน่วยจัดเก็บ",
    );
    expect(summaryStatusText(summary, en)).toBe(
      "Stored 1 · Awaiting storage 1 · Moving 1",
    );
  });
  it("uses recorded legacy format only as a fallback and sums supported fractional quantities precisely", () => {
    const summary = productPalletSummary(
      "p",
      [
        { productId: "p", quantity: 0.1 },
        { productId: "p", quantity: 0.2 },
      ],
      "BOX",
    );
    expect(summary.quantity).toBe(0.3);
    expect(summaryFormatText(summary, en)).toBe("2 boxes");
    expect(summaryFormatText(productPalletSummary("p", []), th)).toBe(
      "0 หน่วยจัดเก็บ",
    );
  });
});
