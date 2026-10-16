import { describe, expect, it } from "vitest";
import {
  MAX_JOB_SCAN_ITEMS,
  applyBarcode,
  duplicateTicketKeys,
  hasInvalidQuantity,
  newTicket,
  toPayload,
  ticketBarcodeError,
  applyImageBarcodes,
} from "./ticketDraft";

it("pairs a photographed FOM JOB number with its product barcode", () => {
  const next = applyImageBarcodes(
    [],
    ["FBN-010533ACA-BOX-F", "FOM6809001"],
  ).tickets;
  expect(next).toHaveLength(1);
  expect(next[0]!.values).toMatchObject({
    factoryOrder: "FOM6809001",
    productBarcodeText: "FBN-010533ACA-BOX-F",
  });
});
it("keeps a photographed JOB/product pair together instead of filling identities in different tickets", () => {
  const rows = [
    newTicket("MANUAL", { factoryOrder: "FO11111111" }),
    newTicket("MANUAL", { productBarcodeText: "OLD-SKU" }),
  ];
  const next = applyImageBarcodes(rows, ["FO22222222", "NEW-SKU"]).tickets;
  expect(next.slice(0, 2)).toEqual(rows);
  expect(next[2]!.values).toMatchObject({
    factoryOrder: "FO22222222",
    productBarcodeText: "NEW-SKU",
  });
});
it("fills compatible missing identities without overwriting optional fields", () => {
  const row = newTicket("MANUAL", {
    factoryOrder: "FO22222222",
    quantity: "150",
  });
  const next = applyImageBarcodes([row], ["FO22222222", "NEW-SKU"]).tickets;
  expect(next).toHaveLength(1);
  expect(next[0]!.values).toMatchObject({
    factoryOrder: "FO22222222",
    productBarcodeText: "NEW-SKU",
    quantity: "150",
  });
});

it("keeps repeated photographed pairs as separate physical units requiring duplicate review", () => {
  const pair = ["FO22222222", "NEW-SKU"];
  const first = applyImageBarcodes([], pair).tickets;
  const next = applyImageBarcodes(first, pair).tickets;
  expect(next).toHaveLength(2);
  expect(next[0]).toEqual(first[0]);
  expect(next[1]!.key).not.toBe(next[0]!.key);
  expect(next[1]!.values).toEqual(next[0]!.values);
  expect(duplicateTicketKeys(next)).toEqual(next.map((row) => row.key));
});

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
  it("routes FOM-prefixed JOB numbers to the Job field", () => {
    expect(ticketBarcodeError("factoryOrder", "FOM6908062")).toBeUndefined();
    expect(ticketBarcodeError("productBarcodeText", "FOM6909081")).toBe(
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

it("caps every barcode intake at fifty and still fills an existing incomplete ticket", () => {
  const tickets = Array.from({ length: MAX_JOB_SCAN_ITEMS }, (_, index) =>
    newTicket("MANUAL", {
      factoryOrder: `FO${100000 + index}`,
      productBarcodeText: `SKU-${index}`,
    }),
  );
  expect(applyBarcode(tickets, "FO999999").tickets).toBe(tickets);
  expect(applyImageBarcodes(tickets, ["FO999999", "NEW-SKU"]).tickets).toBe(
    tickets,
  );
  tickets[49] = newTicket("MANUAL", { factoryOrder: "FO999999" });
  const next = applyImageBarcodes(tickets, ["FO999999", "NEW-SKU"]).tickets;
  expect(next).toHaveLength(50);
  expect(next[49]!.values.productBarcodeText).toBe("NEW-SKU");
});

describe("written ticket report", () => {
  it("names the older ticket that received a scanned code, not the newest", () => {
    const older = newTicket("MANUAL", { productBarcodeText: "OLD-SKU" });
    const newer = newTicket("MANUAL", {
      factoryOrder: "FO11111111",
      productBarcodeText: "NEW-SKU",
    });
    const next = applyBarcode([older, newer], "FOM6909081");
    expect(next.written).toEqual({ key: older.key, field: "factoryOrder" });
    expect(next.tickets[0]!.values.factoryOrder).toBe("FOM6909081");
  });
  it("names a started ticket and reports nothing when capacity refuses the code", () => {
    const started = applyBarcode([], "PRODUCT-1");
    expect(started.written).toEqual({
      key: started.tickets[0]!.key,
      field: "productBarcodeText",
    });
    expect(applyBarcode(started.tickets, "FO123456", 1).written).toEqual({
      key: started.tickets[0]!.key,
      field: "factoryOrder",
    });
    expect(applyBarcode(started.tickets, "PRODUCT-2", 1).written).toBe(
      undefined,
    );
  });
  it("names the ticket that received an image pair, and nothing for an unmatched pair", () => {
    const row = newTicket("MANUAL", { factoryOrder: "FO22222222" });
    const filled = applyImageBarcodes([row], ["NEW-SKU", "FO22222222"]);
    expect(filled.written).toEqual({ key: row.key, field: "factoryOrder" });
    const unmatched = applyImageBarcodes([row], ["SKU-A", "SKU-B"]);
    expect(unmatched.tickets).toEqual([row]);
    expect(unmatched.written).toBe(undefined);
  });
  it("reports the last written code for a single image code", () => {
    const row = newTicket("MANUAL", { factoryOrder: "FO22222222" });
    expect(applyImageBarcodes([row], ["NEW-SKU"]).written).toEqual({
      key: row.key,
      field: "productBarcodeText",
    });
  });
});
