import { describe, expect, it } from "vitest";
import {
  JOB_SCAN_AI_MAX_COMPLETION_TOKENS,
  JOB_SCAN_EDIT_JSON_SCHEMA,
  JOB_SCAN_SEARCH_JSON_SCHEMA,
  MAX_JOB_SCAN_AI_CONTENT_LENGTH,
  MAX_JOB_SCAN_AI_PROMPT_LENGTH,
  classifyTicketBarcode,
  jobScanEditRequestBody,
  jobScanSearchRequestBody,
  jobTicketError,
  parseJobScanEditContent,
  parseJobScanEditProposal,
  parseJobScanSearchContent,
  parseJobScanSearchIntent,
  parseJobTicket,
  validJobScanAiPrompt,
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

  it("treats FOM-prefixed JOB numbers as factory orders", () => {
    for (const code of ["FO69100219", "FOM6908062", " fom6809001 "])
      expect(classifyTicketBarcode(code)).toBe("factoryOrder");
    for (const code of ["FOMX123", "FOM12", "FBN-010533ACA-BOX-F"])
      expect(classifyTicketBarcode(code)).toBe("productBarcodeText");
  });
});

describe("jobTicketError", () => {
  it("requires both identities", () => {
    expect(jobTicketError({ factoryOrder: "", productBarcodeText: "X" })).toBe(
      "FACTORY_ORDER_REQUIRED",
    );
    expect(
      jobTicketError({ factoryOrder: "FO1", productBarcodeText: " " }),
    ).toBe("PRODUCT_BARCODE_REQUIRED");
    expect(
      jobTicketError({ factoryOrder: "FO1", productBarcodeText: "X" }),
    ).toBeNull();
  });
});

describe("job-scan AI prompt and request contracts", () => {
  it("validates bounded prompts and rejects empty, oversized or control-char inputs", () => {
    expect(validJobScanAiPrompt("unmapped")).toBe(true);
    expect(validJobScanAiPrompt("พาเลท ชั้น 2\nอาคารเหนือ")).toBe(true);
    expect(
      validJobScanAiPrompt("x".repeat(MAX_JOB_SCAN_AI_PROMPT_LENGTH)),
    ).toBe(true);
    expect(validJobScanAiPrompt("")).toBe(false);
    expect(validJobScanAiPrompt("   \n\t  ")).toBe(false);
    expect(
      validJobScanAiPrompt("x".repeat(MAX_JOB_SCAN_AI_PROMPT_LENGTH + 1)),
    ).toBe(false);
    expect(validJobScanAiPrompt("FO69070073\u0000")).toBe(false);
    expect(validJobScanAiPrompt("FO69070073\u001b[31m")).toBe(false);
  });

  it("builds strict OpenRouter request bodies with untrusted user prompt JSON only", () => {
    const searchBody = jobScanSearchRequestBody({
      model: "openai/gpt-6-luna",
      prompt: "  pallet on floor 2  ",
    });
    expect(searchBody).toMatchObject({
      model: "openai/gpt-6-luna",
      reasoning: { effort: "low" },
      max_completion_tokens: JOB_SCAN_AI_MAX_COMPLETION_TOKENS,
      provider: { require_parameters: true },
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "job_scan_search_intent",
          strict: true,
          schema: JOB_SCAN_SEARCH_JSON_SCHEMA,
        },
      },
    });
    expect("temperature" in searchBody).toBe(false);
    expect(searchBody.messages[1]).toEqual({
      role: "user",
      content: JSON.stringify({ prompt: "pallet on floor 2" }),
    });

    const editBody = jobScanEditRequestBody({
      model: "openai/gpt-6-luna",
      prompt: "move to FG1-F02-Z01",
    });
    expect(editBody.response_format.json_schema).toEqual({
      name: "job_scan_edit_proposal",
      strict: true,
      schema: JOB_SCAN_EDIT_JSON_SCHEMA,
    });
    expect(editBody.messages[1]).toEqual({
      role: "user",
      content: JSON.stringify({ prompt: "move to FG1-F02-Z01" }),
    });
  });
});

describe("parseJobScanSearchIntent", () => {
  const base = {
    supported: true,
    filter: "ALL",
    search: "",
    building: null,
    floor: null,
    storageFormat: null,
  };

  it("accepts Thai and English grounded search intents", () => {
    expect(
      parseJobScanSearchIntent(
        { ...base, filter: "UNMAPPED" },
        "ยังไม่ระบุตำแหน่ง",
      ),
    ).toEqual({
      kind: "OK",
      value: { filter: "UNMAPPED", search: "" },
    });

    expect(
      parseJobScanSearchIntent(
        { ...base, search: "FO69070073" },
        "หา FO69070073",
      ),
    ).toEqual({
      kind: "OK",
      value: { filter: "ALL", search: "FO69070073" },
    });

    expect(
      parseJobScanSearchIntent(
        {
          ...base,
          building: "อาคารเหนือ",
          floor: 2,
          storageFormat: "PALLET",
        },
        "พาเลท อาคารเหนือ ชั้น ๒",
      ),
    ).toEqual({
      kind: "OK",
      value: {
        filter: "ALL",
        search: "",
        facets: {
          building: "อาคารเหนือ",
          floor: 2,
          storageFormat: "PALLET",
        },
      },
    });

    expect(
      parseJobScanSearchContent(
        "```json\n" +
          JSON.stringify({ ...base, floor: 2, storageFormat: "PALLET" }) +
          "\n```",
        "pallet on second floor",
      ),
    ).toEqual({
      kind: "OK",
      value: {
        filter: "ALL",
        search: "",
        facets: { floor: 2, storageFormat: "PALLET" },
      },
    });
  });

  it("returns UNSUPPORTED when the model declines an out-of-scope prompt", () => {
    expect(
      parseJobScanSearchIntent(
        { ...base, supported: false },
        "delete all records",
      ),
    ).toEqual({ kind: "UNSUPPORTED" });
  });

  it("refuses to drop an explicit status or turn an unrecognized search into all records", () => {
    expect(parseJobScanSearchIntent(base, "Show unmapped records")).toEqual({
      kind: "UNREADABLE",
    });
    expect(parseJobScanSearchIntent(base, "find pallets on floor 2")).toEqual({
      kind: "UNSUPPORTED",
    });
    expect(parseJobScanSearchIntent(base, "Show all records")).toEqual({
      kind: "OK",
      value: { filter: "ALL", search: "" },
    });
  });

  it("does not interpret a job number or a product name fragment as a search facet", () => {
    expect(
      parseJobScanSearchIntent(
        { ...base, search: "PO-42", floor: 42 },
        "Find records for PO-42",
      ),
    ).toEqual({ kind: "UNREADABLE" });
    expect(
      parseJobScanSearchIntent(
        { ...base, search: "boxwood gasket", storageFormat: "BOX" },
        "Find boxwood gasket",
      ),
    ).toEqual({ kind: "UNREADABLE" });
  });

  it("rejects untrusted, ungrounded, extra-key, ID or truncated responses", () => {
    expect(
      parseJobScanSearchIntent({ ...base, jobScanId: "scan_123" }, "unmapped"),
    ).toEqual({ kind: "UNREADABLE" });
    expect(
      parseJobScanSearchIntent(
        { ...base, search: "FO999999" },
        "unmapped pallets",
      ),
    ).toEqual({ kind: "UNREADABLE" });
    expect(
      parseJobScanSearchIntent(
        { ...base, building: "FG1" },
        "pallet on floor 2",
      ),
    ).toEqual({ kind: "UNREADABLE" });
    expect(
      parseJobScanSearchIntent({ ...base, floor: 2 }, "unmapped boxes"),
    ).toEqual({ kind: "UNREADABLE" });
    expect(
      parseJobScanSearchIntent(
        { ...base, storageFormat: "PALLET" },
        "find FO69070073",
      ),
    ).toEqual({ kind: "UNREADABLE" });
    expect(
      parseJobScanSearchIntent(
        { ...base, building: "ISAS:LOCATION:1:abc" },
        "ISAS:LOCATION:1:abc",
      ),
    ).toEqual({ kind: "UNREADABLE" });
    expect(
      parseJobScanSearchIntent({ ...base, floor: 1.5 }, "floor 1.5"),
    ).toEqual({ kind: "UNREADABLE" });
    expect(parseJobScanSearchContent('{"supported":true', "unmapped")).toEqual({
      kind: "UNREADABLE",
    });
    expect(
      parseJobScanSearchContent(
        "x".repeat(MAX_JOB_SCAN_AI_CONTENT_LENGTH + 1),
        "unmapped",
      ),
    ).toEqual({ kind: "UNREADABLE" });
  });
});

describe("parseJobScanEditProposal", () => {
  const emptyEdit = {
    supported: true,
    locationCode: null,
    factoryOrder: null,
    productBarcodeText: null,
    partName: null,
    customer: null,
    deliveryDate: null,
    manufacturingDate: null,
    quantity: null,
    factoryQuantity: null,
    customerQuantity: null,
    storageFormat: null,
  };

  it("returns only explicitly requested and grounded edit fields", () => {
    expect(
      parseJobScanEditProposal(
        {
          ...emptyEdit,
          locationCode: "FG1-F02-Z01",
          quantity: 1000,
          storageFormat: "BOX",
        },
        "ย้ายไป FG1-F02-Z01 เปลี่ยนจำนวนเป็น 1,000 และเปลี่ยนรูปแบบเป็นกล่อง",
      ),
    ).toEqual({
      kind: "OK",
      value: {
        locationCode: "FG1-F02-Z01",
        fields: { quantity: 1000, storageFormat: "BOX" },
      },
    });

    expect(
      parseJobScanEditProposal(
        {
          ...emptyEdit,
          deliveryDate: "6/7/2569",
          customer: "Siam Packaging",
        },
        "set customer to Siam Packaging and delivery date ๖/๗/๒๕๖๙",
      ),
    ).toEqual({
      kind: "OK",
      value: {
        fields: { deliveryDate: "6/7/2569", customer: "Siam Packaging" },
      },
    });
  });

  it("returns UNSUPPORTED for declined or empty proposals", () => {
    expect(
      parseJobScanEditProposal(
        { ...emptyEdit, supported: false },
        "delete this record",
      ),
    ).toEqual({ kind: "UNSUPPORTED" });
    expect(parseJobScanEditProposal(emptyEdit, "make it nicer")).toEqual({
      kind: "UNSUPPORTED",
    });
  });

  it("rejects fake location guesses, ungrounded fields, IDs, and malformed payloads", () => {
    expect(
      parseJobScanEditProposal(
        { ...emptyEdit, locationCode: "FG1-F01-Z01" },
        "ย้ายไปที่ว่างใกล้ประตู",
      ),
    ).toEqual({ kind: "UNREADABLE" });
    expect(
      parseJobScanEditProposal(
        { ...emptyEdit, locationId: "loc_123" },
        "move to FG1-F01-Z01",
      ),
    ).toEqual({ kind: "UNREADABLE" });
    expect(
      parseJobScanEditProposal(
        { ...emptyEdit, locationCode: "ISAS:LOCATION:1:loc1" },
        "move to ISAS:LOCATION:1:loc1",
      ),
    ).toEqual({ kind: "UNREADABLE" });
    expect(
      parseJobScanEditProposal(
        { ...emptyEdit, customer: "Acme", quantity: 500 },
        "change customer to Acme",
      ),
    ).toEqual({ kind: "UNREADABLE" });
    expect(
      parseJobScanEditProposal(
        { ...emptyEdit, quantity: 73 },
        "change FO69070073 customer to Acme",
      ),
    ).toEqual({ kind: "UNSUPPORTED" });
    expect(
      parseJobScanEditProposal(
        { ...emptyEdit, quantity: -10 },
        "set quantity to -10",
      ),
    ).toEqual({ kind: "UNREADABLE" });
    expect(
      parseJobScanEditContent('{"supported":true,"locationCode":', "move A1"),
    ).toEqual({ kind: "UNREADABLE" });
  });

  it("requires every proposed field to match its own explicit clause and its full value", () => {
    expect(
      parseJobScanEditProposal(
        {
          ...emptyEdit,
          quantity: 25,
          factoryQuantity: 25,
          customerQuantity: 25,
          partName: "25",
        },
        "Set quantity to 25",
      ),
    ).toEqual({ kind: "UNREADABLE" });
    expect(
      parseJobScanEditProposal(
        { ...emptyEdit, locationCode: "A-01" },
        "Move to A-010",
      ),
    ).toEqual({ kind: "UNREADABLE" });
    expect(
      parseJobScanEditProposal(
        { ...emptyEdit, quantity: 40, storageFormat: "BOX" },
        "Set quantity to 40 boxes",
      ),
    ).toEqual({ kind: "UNREADABLE" });
    expect(
      parseJobScanEditProposal(
        { ...emptyEdit, quantity: 40, factoryQuantity: 25 },
        "set factory quantity to 25 and set quantity to 40",
      ),
    ).toEqual({
      kind: "OK",
      value: { fields: { quantity: 40, factoryQuantity: 25 } },
    });
    expect(
      parseJobScanEditProposal(
        { ...emptyEdit, quantity: 40 },
        "Do not set quantity to 40",
      ),
    ).toEqual({ kind: "UNSUPPORTED" });
  });

  it.each(["AbC123", "ＡＢＣ123"])(
    "rejects provider changes to the exact barcode %s",
    (barcode) => {
      const prompt = `Set barcode to ${barcode}`;
      expect(
        parseJobScanEditProposal(
          { ...emptyEdit, productBarcodeText: "ABC123" },
          prompt,
        ),
      ).toEqual({ kind: "UNREADABLE" });
      expect(
        parseJobScanEditProposal(
          { ...emptyEdit, productBarcodeText: barcode },
          prompt,
        ),
      ).toEqual({
        kind: "OK",
        value: { fields: { productBarcodeText: barcode } },
      });
    },
  );

  it("keeps punctuation and conjunctions in literal names", () => {
    expect(
      parseJobScanEditProposal(
        { ...emptyEdit, customer: "ACME, Inc.", partName: "Bolt and Nut" },
        "Set customer to ACME, Inc., and set part name to Bolt and Nut",
      ),
    ).toEqual({
      kind: "OK",
      value: { fields: { customer: "ACME, Inc.", partName: "Bolt and Nut" } },
    });
  });
});
