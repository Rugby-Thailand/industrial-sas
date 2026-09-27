import { describe, expect, it } from "vitest";
import {
  classifyTicketBarcode,
  jobTicketError,
  parseJobTicket,
} from "./jobScans";

describe("parseJobTicket", () => {
  it("maps model output and parses formatted numbers", () => {
    expect(
      parseJobTicket({
        factory_order: " FO69070073 ",
        delivery_date: "6/7/2569",
        part_name: "VMI BOX TRAY BXVMI004 Rev.02",
        customer: null,
        quantity: "1,000",
        factory_quantity: 1000,
        customer_quantity: "1,000.00",
        product_barcode_text: "FBN-BXVMI004-BOX-00F",
      }),
    ).toEqual({
      factoryOrder: "FO69070073",
      deliveryDate: "6/7/2569",
      partName: "VMI BOX TRAY BXVMI004 Rev.02",
      quantity: 1000,
      factoryQuantity: 1000,
      customerQuantity: 1000,
      productBarcodeText: "FBN-BXVMI004-BOX-00F",
    });
  });

  it("ignores garbage", () => {
    expect(parseJobTicket("nope")).toEqual({});
    expect(parseJobTicket({ quantity: "abc", part_name: "  " })).toEqual({});
  });
});

describe("classifyTicketBarcode", () => {
  it("separates job numbers from product barcodes", () => {
    expect(classifyTicketBarcode("FO69070073")).toBe("factoryOrder");
    expect(classifyTicketBarcode("FBN-BXVMI004-BOX-00F")).toBe(
      "productBarcodeText",
    );
  });
});

describe("jobTicketError", () => {
  it("requires both identities", () => {
    expect(
      jobTicketError({ factoryOrder: "", productBarcodeText: "X" }),
    ).toBe("FACTORY_ORDER_REQUIRED");
    expect(
      jobTicketError({ factoryOrder: "FO1", productBarcodeText: " " }),
    ).toBe("PRODUCT_BARCODE_REQUIRED");
    expect(
      jobTicketError({ factoryOrder: "FO1", productBarcodeText: "X" }),
    ).toBeNull();
  });
});
