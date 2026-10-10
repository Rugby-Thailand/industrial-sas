import { describe, expect, it } from "vitest";
import {
  duplicateTicketKeys,
  hasInvalidQuantity,
  newTicket,
  toPayload,
  ticketBarcodeError,
} from "./ticketDraft";

it("finds all repeated complete identities after trimming, while retaining distinct tickets", () => {
  const a = newTicket("MANUAL", {
    factoryOrder: "FO1234",
    productBarcodeText: "DEMO",
  });
  const b = newTicket("AI", {
    factoryOrder: " FO1234 ",
    productBarcodeText: "DEMO",
  });
  const c = newTicket("BARCODE", {
    factoryOrder: "FO9999",
    productBarcodeText: "DEMO",
  });
  expect(duplicateTicketKeys([a, b, c, newTicket("MANUAL")])).toEqual([
    a.key,
    b.key,
  ]);
});
it.each(["garbage", "-1", "Infinity", "1.2.3", ",", ",,,", "1,2", "12,34"])(
  "rejects invalid quantity %s rather than silently omitting it",
  (value) => {
    expect(hasInvalidQuantity(newTicket("MANUAL", { quantity: value }))).toBe(
      true,
    );
  },
);
it.each(["", "0", "1,200.5", ".5", "1."])(
  "accepts optional or valid quantity %s",
  (value) => {
    expect(
      hasInvalidQuantity(newTicket("MANUAL", { factoryQuantity: value })),
    ).toBe(false);
  },
);
it("keeps entered quantities and exact identifiers in the save payload", () => {
  expect(
    toPayload(
      newTicket("MANUAL", {
        factoryOrder: " FO0123 ",
        productBarcodeText: " DEMO-01 ",
        quantity: "1,200.5",
      }),
    ),
  ).toEqual({
    source: "MANUAL",
    storageFormat: "PALLET",
    factoryOrder: "FO0123",
    productBarcodeText: "DEMO-01",
    quantity: 1200.5,
  });
});

describe("field barcode validation", () => {
  it("accepts trimmed Job and product labels only in the selected field", () => {
    expect(ticketBarcodeError("factoryOrder", " FO69070073 ")).toBeUndefined();
    expect(
      ticketBarcodeError("productBarcodeText", "0000012345"),
    ).toBeUndefined();
    expect(ticketBarcodeError("factoryOrder", "PRODUCT-BOX")).toBe(
      "wrongScanField",
    );
    expect(ticketBarcodeError("productBarcodeText", "FO69070073")).toBe(
      "wrongScanField",
    );
  });
  it("rejects blank, multiline, storage identities and oversized values without truncating", () => {
    for (const code of [
      "",
      "  ",
      "ISAS:PALLET:1:abc",
      "ISAS:LOCATION:1:abc",
      "A\nB",
    ]) {
      expect(ticketBarcodeError("productBarcodeText", code)).toBe(
        "invalidTicketBarcode",
      );
    }
    expect(ticketBarcodeError("factoryOrder", "FO" + "1".repeat(99))).toBe(
      "scanCodeTooLong",
    );
    expect(ticketBarcodeError("productBarcodeText", "A".repeat(201))).toBe(
      "scanCodeTooLong",
    );
  });
});
