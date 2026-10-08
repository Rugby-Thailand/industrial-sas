import { expect, it } from "vitest";
import {
  duplicateTicketKeys,
  hasInvalidQuantity,
  newTicket,
  toPayload,
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
it.each(["garbage", "-1", "Infinity", "1.2.3"])(
  "rejects invalid quantity %s rather than silently omitting it",
  (value) => {
    expect(hasInvalidQuantity(newTicket("MANUAL", { quantity: value }))).toBe(
      true,
    );
  },
);
it.each(["", "0", "1,200.5"])(
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
    factoryOrder: "FO0123",
    productBarcodeText: "DEMO-01",
    quantity: 1200.5,
  });
});
