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
      value: {
        filter: "ALL",
        search: "FO69070073",
        searchField: "factoryOrder",
      },
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
          building: "เหนือ",
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

  it("requires all Thai prototype filters and honors the records screen status labels", () => {
    for (const prompt of [
      "หางานที่ยังไม่ระบุตำแหน่ง",
      "หางานที่รอระบุตำแหน่ง",
      "Needs location",
    ]) {
      expect(
        parseJobScanSearchIntent({ ...base, filter: "UNMAPPED" }, prompt),
      ).toEqual({ kind: "OK", value: { filter: "UNMAPPED", search: "" } });
      expect(parseJobScanSearchIntent(base, prompt)).toEqual({
        kind: "UNREADABLE",
      });
    }
    const palletPrompt = "หางานพาเลทชั้น 2";
    expect(
      parseJobScanSearchIntent(
        { ...base, floor: 2, storageFormat: "PALLET" },
        palletPrompt,
      ),
    ).toEqual({
      kind: "OK",
      value: {
        filter: "ALL",
        search: "",
        facets: { floor: 2, storageFormat: "PALLET" },
      },
    });
    expect(
      parseJobScanSearchIntent({ ...base, floor: 2 }, palletPrompt),
    ).toEqual({ kind: "UNREADABLE" });
    const locationPrompt = "หาใบงานที่อยู่ F2-L12-1";
    expect(
      parseJobScanSearchIntent({ ...base, search: "F2-L12-1" }, locationPrompt),
    ).toEqual({
      kind: "OK",
      value: { filter: "ALL", search: "F2-L12-1", searchField: "location" },
    });
    expect(
      parseJobScanSearchIntent({ ...base, search: "F2-L12" }, locationPrompt),
    ).toEqual({ kind: "UNREADABLE" });
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
      kind: "UNREADABLE",
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

  it("requires the entire set of explicit building, floor, and storage filters", () => {
    const prompt = "find mapped pallet jobs at building A, floor 2";
    const complete = {
      ...base,
      filter: "MAPPED",
      building: "A",
      floor: 2,
      storageFormat: "PALLET",
    };
    for (const facet of ["building", "floor", "storageFormat"] as const) {
      expect(
        parseJobScanSearchIntent({ ...complete, [facet]: null }, prompt),
      ).toEqual({ kind: "UNREADABLE" });
    }
    expect(parseJobScanSearchIntent(complete, prompt)).toEqual({
      kind: "OK",
      value: {
        filter: "MAPPED",
        search: "",
        facets: { building: "A", floor: 2, storageFormat: "PALLET" },
      },
    });
  });

  it("rejects false format hints inside names and partial decimal floor matches", () => {
    for (const [prompt, search] of [
      ["หาใบงานหลังคาแดง", "หลังคาแดง"],
      ["find Box Industries", "Box Industries"],
    ] as const) {
      expect(
        parseJobScanSearchIntent(
          { ...base, search, storageFormat: "BOX" },
          prompt,
        ),
      ).toEqual({ kind: "UNREADABLE" });
      expect(parseJobScanSearchIntent({ ...base, search }, prompt)).toEqual({
        kind: "OK",
        value: { filter: "ALL", search },
      });
    }
    for (const floor of [null, 1, 5]) {
      expect(
        parseJobScanSearchIntent(
          { ...base, floor },
          "find tickets on 1.5 floor",
        ),
      ).toEqual({ kind: "UNREADABLE" });
    }
    expect(
      parseJobScanSearchIntent(
        { ...base, floor: 2, storageFormat: "BOX" },
        "หาใบงานที่เป็นลังชั้น ๒",
      ),
    ).toEqual({
      kind: "OK",
      value: {
        filter: "ALL",
        search: "",
        facets: { floor: 2, storageFormat: "BOX" },
      },
    });
  });

  it("keeps an explicitly requested keyword separate from storage format filters", () => {
    for (const [prompt, search] of [
      ["หาสินค้า กล่อง Outer 131", "กล่อง Outer 131"],
      ["ค้นหาสินค้า ลัง เหลือง", "ลัง เหลือง"],
      ["Find jobs for Blue Box", "Blue Box"],
    ] as const) {
      expect(parseJobScanSearchIntent({ ...base, search }, prompt)).toEqual({
        kind: "OK",
        value: { filter: "ALL", search },
      });
      for (const proposal of [
        { ...base, search, storageFormat: "BOX" },
        { ...base, search: search.slice(0, -1) },
      ]) {
        expect(parseJobScanSearchIntent(proposal, prompt)).toEqual({
          kind: "UNREADABLE",
        });
      }
    }
  });

  it("rejects alternative floors and preserves supported compound floor expressions", () => {
    for (const prompt of [
      "boxes on floor 2 or 3",
      "กล่องชั้น 2 หรือ 3",
      "boxes on 2–3 floors",
    ]) {
      expect(
        parseJobScanSearchIntent(
          { ...base, floor: 2, storageFormat: "BOX" },
          prompt,
        ),
      ).toEqual({ kind: "UNSUPPORTED" });
    }
    expect(
      parseJobScanSearchIntent({ ...base, floor: 10 }, "หาใบงานชั้นสิบสอง"),
    ).toEqual({ kind: "UNREADABLE" });
    expect(
      parseJobScanSearchIntent({ ...base, floor: 12 }, "หาใบงานชั้นสิบสอง"),
    ).toEqual({
      kind: "OK",
      value: { filter: "ALL", search: "", facets: { floor: 12 } },
    });
    const prompt = "boxes in Building A on the second floor";
    const proposed = {
      ...base,
      building: "Building A",
      floor: 2,
      storageFormat: "BOX",
    };
    expect(parseJobScanSearchIntent(proposed, prompt)).toMatchObject({
      kind: "OK",
      value: { facets: { building: "A", floor: 2 } },
    });
    expect(
      parseJobScanSearchIntent(
        { ...proposed, building: "Building A on the second" },
        prompt,
      ),
    ).toEqual({ kind: "UNREADABLE" });
  });

  it("keeps an explicitly named part literal separate from format and location filters", () => {
    const prompt = "find records for part name Gear Box";
    const proposed = { ...base, search: "Gear Box" };
    expect(parseJobScanSearchIntent(proposed, prompt)).toEqual({
      kind: "OK",
      value: { filter: "ALL", search: "Gear Box", searchField: "partName" },
    });
    expect(
      parseJobScanSearchIntent({ ...proposed, storageFormat: "BOX" }, prompt),
    ).toEqual({ kind: "UNREADABLE" });
    expect(
      parseJobScanSearchIntent({ ...base, storageFormat: "BOX" }, prompt),
    ).toEqual({ kind: "UNREADABLE" });
    expect(
      parseJobScanSearchIntent(
        {
          ...proposed,
          building: "Building A",
          floor: 2,
          storageFormat: "PALLET",
        },
        "find pallets for part name Gear Box in Building A on the second floor",
      ),
    ).toMatchObject({
      kind: "OK",
      value: {
        search: "Gear Box",
        searchField: "partName",
        facets: { building: "A", floor: 2, storageFormat: "PALLET" },
      },
    });
  });

  it("derives an explicit field from the requested label without letting the provider choose it", () => {
    for (const [prompt, searchField] of [
      ["find tickets at location F2-L12-1", "location"],
      ["Find jobs by location F2-L12-1", "location"],
      ["Find jobs at F2-L12-1", "location"],
      ['Find jobs at "F2-L12-1"', "location"],
      ["หาใบงานที่ตำแหน่ง F2-L12-1", "location"],
      ["find Job No. F2-L12-1", "factoryOrder"],
      ["find barcode F2-L12-1", "productBarcodeText"],
      ["หาชื่อลูกค้า F2-L12-1", "customer"],
    ] as const) {
      const search = "F2-L12-1";
      const proposed = { ...base, search };
      expect(parseJobScanSearchIntent(proposed, prompt)).toEqual({
        kind: "OK",
        value: { filter: "ALL", search, searchField },
      });
      expect(
        parseJobScanSearchIntent(
          { ...proposed, searchField: "customer" },
          prompt,
        ),
      ).toEqual({ kind: "UNREADABLE" });
    }
  });

  it("distinguishes visible location names ending in floor from actual floor criteria", () => {
    expect(
      parseJobScanSearchIntent(
        { ...base, search: "Trial floor" },
        "Find jobs at Trial floor",
      ),
    ).toEqual({
      kind: "OK",
      value: { filter: "ALL", search: "Trial floor", searchField: "location" },
    });
    for (const value of ["floor 2", "2nd floor", "the second floor"]) {
      expect(
        parseJobScanSearchIntent(
          { ...base, floor: 2 },
          `Find jobs at ${value}`,
        ),
      ).toEqual({
        kind: "OK",
        value: { filter: "ALL", search: "", facets: { floor: 2 } },
      });
    }
  });

  it("keeps Thai digits and internal spacing in literal search values", () => {
    for (const [prompt, search, changed, searchField] of [
      ["หาบาร์โค้ด FBN-๒", "FBN-๒", "FBN-2", "productBarcodeText"],
      [
        "Find records for part name Gear  Box",
        "Gear  Box",
        "Gear Box",
        "partName",
      ],
    ] as const) {
      expect(
        parseJobScanSearchIntent({ ...base, search: changed }, prompt),
      ).toEqual({ kind: "UNREADABLE" });
      expect(parseJobScanSearchIntent({ ...base, search }, prompt)).toEqual({
        kind: "OK",
        value: { filter: "ALL", search, searchField },
      });
    }
  });

  it("accounts for every location address without mistaking a status or floor for part of the code", () => {
    expect(
      parseJobScanSearchIntent(
        { ...base, search: "A1", floor: 2, filter: "MAPPED" },
        "Find mapped jobs at A1 and floor 2",
      ),
    ).toEqual({
      kind: "OK",
      value: {
        filter: "MAPPED",
        search: "A1",
        searchField: "location",
        facets: { floor: 2 },
      },
    });
    for (const [prompt, firstCode, list] of [
      [
        "Find jobs at F2-L12-1 and F2-L12-3",
        "F2-L12-1",
        "F2-L12-1 and F2-L12-3",
      ],
      ["Find jobs at A1, A2", "A1", "A1, A2"],
      ["Find jobs at A1/A2", "A1", "A1/A2"],
      ["Find jobs by location A1/A2", "A1", "A1/A2"],
      ["Find jobs at location A1 through A4", "A1", "A1 through A4"],
      ["Find jobs at location A1 and location A2", "A1", "A1 and location A2"],
      ["หาใบงานที่ตำแหน่ง A1 และ A2", "A1", "A1 และ A2"],
      ["หาใบงานที่อยู่ A1 กับ A2", "A1", "A1 กับ A2"],
    ] as const) {
      for (const search of [firstCode, list]) {
        expect(parseJobScanSearchIntent({ ...base, search }, prompt)).toEqual({
          kind: "UNSUPPORTED",
        });
      }
    }
  });

  it("treats negated statuses as unmapped and refuses conflicting statuses", () => {
    for (const prompt of [
      "Find jobs that are not mapped",
      "Find jobs that aren’t yet assigned",
      "Show jobs that have not been mapped",
      "หางานที่ไม่ได้ระบุตำแหน่งแล้ว",
      "หาใบงานที่ไม่ใช่งานที่ระบุตำแหน่งแล้ว",
    ]) {
      expect(
        parseJobScanSearchIntent({ ...base, filter: "MAPPED" }, prompt),
      ).toEqual({ kind: "UNREADABLE" });
      expect(
        parseJobScanSearchIntent({ ...base, filter: "UNMAPPED" }, prompt),
      ).toEqual({ kind: "OK", value: { filter: "UNMAPPED", search: "" } });
    }
    expect(
      parseJobScanSearchIntent(
        { ...base, filter: "MAPPED" },
        "Find jobs that are not unassigned",
      ),
    ).toEqual({ kind: "OK", value: { filter: "MAPPED", search: "" } });
    expect(
      parseJobScanSearchIntent(
        { ...base, filter: "UNMAPPED" },
        "Find mapped or not mapped jobs",
      ),
    ).toEqual({ kind: "UNSUPPORTED" });
  });

  it("keeps a trailing status outside the literal barcode in Thai and English", () => {
    for (const [prompt, search, overlong] of [
      [
        "Find jobs with barcode ABC-123 that are not mapped",
        "ABC-123",
        "ABC-123 that are not mapped",
      ],
      [
        "Find barcode ABC-123 that are currently unmapped",
        "ABC-123",
        "ABC-123 that are currently unmapped",
      ],
      [
        "Find barcode ABC-123 currently unmapped",
        "ABC-123",
        "ABC-123 currently unmapped",
      ],
      ["Find barcode ABC-123 unmapped", "ABC-123", "ABC-123 unmapped"],
      [
        "หาใบงานบาร์โค้ด FBN-๒ ที่ยังไม่ระบุตำแหน่ง",
        "FBN-๒",
        "FBN-๒ ที่ยังไม่ระบุตำแหน่ง",
      ],
    ] as const) {
      expect(
        parseJobScanSearchIntent(
          { ...base, search, filter: "UNMAPPED" },
          prompt,
        ),
      ).toEqual({
        kind: "OK",
        value: {
          filter: "UNMAPPED",
          search,
          searchField: "productBarcodeText",
        },
      });
      expect(
        parseJobScanSearchIntent({ ...base, search: overlong }, prompt),
      ).toEqual({ kind: "UNREADABLE" });
    }
    expect(
      parseJobScanSearchIntent(
        { ...base, search: "ABC 123 currently unmapped" },
        "Find barcode ABC 123 currently unmapped",
      ),
    ).toEqual({ kind: "UNSUPPORTED" });
    expect(
      parseJobScanSearchIntent(
        { ...base, search: "ABC 123", filter: "UNMAPPED" },
        'Find barcode "ABC 123" that are currently unmapped',
      ),
    ).toEqual({
      kind: "OK",
      value: {
        search: "ABC 123",
        filter: "UNMAPPED",
        searchField: "productBarcodeText",
      },
    });
  });

  it.each([
    ["Find barcode ABC-123 from floor 2", "ABC-123", "ABC-123 from floor 2"],
    ['Find barcode "ABC 123" from floor 2', "ABC 123", "ABC 123 from floor 2"],
    ["หาใบงานบาร์โค้ด FBN-๒ จากชั้น 2", "FBN-๒", "FBN-๒ จากชั้น 2"],
    ["Find barcode ABC-123 floor 2", "ABC-123", "ABC-123 floor 2"],
  ])(
    "keeps floor criteria outside the code in %s",
    (prompt, search, overlong) => {
      expect(
        parseJobScanSearchIntent({ ...base, search, floor: 2 }, prompt),
      ).toEqual({
        kind: "OK",
        value: {
          filter: "ALL",
          search,
          searchField: "productBarcodeText",
          facets: { floor: 2 },
        },
      });
      expect(
        parseJobScanSearchIntent({ ...base, search: overlong }, prompt),
      ).not.toMatchObject({ kind: "OK" });
      expect(
        parseJobScanSearchIntent({ ...base, search }, prompt),
      ).not.toMatchObject({
        kind: "OK",
      });
    },
  );

  it("refuses exclusions and alternatives that the records query cannot express", () => {
    for (const [prompt, proposal] of [
      ["หางานที่ไม่ได้อยู่ชั้น 2", { floor: 2 }],
      ["Find jobs not on floor 2", { floor: 2 }],
      ["Find jobs outside floor 2", { floor: 2 }],
      ["Find jobs on floors 2, 3", { floor: 2 }],
      ["Find jobs on floors 2/3", { floor: 2 }],
      ["Find jobs near floor 2", { floor: 2 }],
      ["Find jobs near floor 2", { search: "near", floor: 2 }],
      [
        "Find jobs within walking distance of floor 2",
        { search: "within walking distance", floor: 2 },
      ],
      ["หางานใกล้ชั้น 2", { search: "ใกล้", floor: 2 }],
      [
        "Find barcode ABC-123 not on floor 2",
        { search: "ABC-123 not", floor: 2 },
      ],
      ["Find barcode ABC-123 or XYZ-123", { search: "ABC-123 or XYZ-123" }],
      [
        "Show pallet jobs or unmapped jobs",
        { filter: "UNMAPPED", storageFormat: "PALLET" },
      ],
      [
        "Show pallets except those in building B",
        { storageFormat: "PALLET", building: "B" },
      ],
    ] as const) {
      expect(
        parseJobScanSearchIntent({ ...base, ...proposal }, prompt),
      ).toEqual({ kind: "UNSUPPORTED" });
    }
  });

  it("requires a recognizable unlabelled job number to remain whole alongside another filter", () => {
    const mapped = { ...base, filter: "UNMAPPED" };
    for (const code of ["FO1234", "FOM1234", "FO69070073", "F0M0010043"]) {
      const prompt = `Find unmapped jobs for ${code}`;
      for (const search of ["", code.slice(0, -1)]) {
        expect(parseJobScanSearchIntent({ ...mapped, search }, prompt)).toEqual(
          {
            kind: "UNREADABLE",
          },
        );
      }
      expect(
        parseJobScanSearchIntent({ ...mapped, search: code }, prompt),
      ).toEqual({
        kind: "OK",
        value: {
          filter: "UNMAPPED",
          search: code,
          searchField: "factoryOrder",
        },
      });
    }
  });

  it("declines unsupported filters even when a model absorbs them into a name", () => {
    for (const [lead, name, qualifier] of [
      ["Find product name ", "Widget", " with quantity greater than 20"],
      ["Find product name ", "Widget", " with quantity = 20"],
      ["Find product name ", "Widget", ", quantity 20"],
      ["Find product name ", "Widget", " and factory quantity 20"],
      ["Find product name ", "Widget", " shipped after 2026-11-26"],
      ["Find product name ", "Widget", " with priority high"],
      ["Find ", "Widget", " with priority high"],
      ["หาชื่อสินค้า ", "กล่อง Outer 131", " ที่มีจำนวนมากกว่า 20"],
      ["หาชื่อสินค้า ", "Widget", ", วันที่ส่ง 12/12/2569"],
    ] as const) {
      const prompt = lead + name + qualifier;
      for (const search of [name, name + qualifier]) {
        expect(parseJobScanSearchIntent({ ...base, search }, prompt)).toEqual({
          kind: "UNSUPPORTED",
        });
      }
    }
    expect(
      parseJobScanSearchIntent(
        { ...base, search: "Widget with Handle" },
        'Find product name "Widget with Handle"',
      ),
    ).toEqual({
      kind: "OK",
      value: {
        filter: "ALL",
        search: "Widget with Handle",
        searchField: "partName",
      },
    });
  });

  it("parses labelled storage format separately from the part name", () => {
    for (const prompt of [
      "Find product name Widget and storage format BOX",
      "Find product name Widget, storage format BOX",
      "Find product name Widget with storage format BOX",
      "หาชื่อสินค้า Widget และรูปแบบการจัดเก็บกล่อง",
    ]) {
      expect(
        parseJobScanSearchIntent(
          { ...base, search: "Widget", storageFormat: "BOX" },
          prompt,
        ),
      ).toEqual({
        kind: "OK",
        value: {
          filter: "ALL",
          search: "Widget",
          searchField: "partName",
          facets: { storageFormat: "BOX" },
        },
      });
      expect(
        parseJobScanSearchIntent(
          { ...base, search: prompt.slice(prompt.indexOf("Widget")) },
          prompt,
        ),
      ).not.toMatchObject({ kind: "OK" });
    }
  });

  it("declines a search with two named record fields instead of merging their values", () => {
    for (const [lead, combined] of [
      ["Find product name ", "Widget and customer name Acme"],
      ["Find product name ", "Widget with barcode ABC-123"],
      ["หาชื่อสินค้า ", "Widget และชื่อลูกค้า Acme"],
    ] as const) {
      for (const search of [combined, "Widget"]) {
        expect(
          parseJobScanSearchIntent({ ...base, search }, lead + combined),
        ).toEqual({ kind: "UNSUPPORTED" });
      }
    }
  });

  it("validates quoted names and keeps a named record field separate from status", () => {
    for (const [prompt, search] of [
      ['Find "Acme"', "Acme"],
      ['Find "Widget and export the results"', "Widget and export the results"],
      ["หา “กล่อง และส่งออกผลลัพธ์”", "กล่อง และส่งออกผลลัพธ์"],
    ] as const) {
      expect(parseJobScanSearchIntent({ ...base, search }, prompt)).toEqual({
        kind: "OK",
        value: { filter: "ALL", search },
      });
    }
    expect(
      parseJobScanSearchIntent(
        { ...base, search: "Widget", filter: "UNMAPPED" },
        "Find product name Widget without location",
      ),
    ).toEqual({
      kind: "OK",
      value: { filter: "UNMAPPED", search: "Widget", searchField: "partName" },
    });
  });

  it.each([
    "Find product name Widget and status is unmapped",
    "Find product name Widget and status: unmapped",
    "Find product name Widget and location is not set",
    "หาชื่อสินค้า Widget และสถานะเป็นยังไม่ระบุตำแหน่ง",
  ])("supports a named location-status criterion in %s", (prompt) => {
    expect(
      parseJobScanSearchIntent(
        { ...base, search: "Widget", filter: "UNMAPPED" },
        prompt,
      ),
    ).toEqual({
      kind: "OK",
      value: { filter: "UNMAPPED", search: "Widget", searchField: "partName" },
    });
  });

  it("keeps buildings separate from statuses and respects quoted building names", () => {
    for (const [prompt, supplied, building, filter] of [
      ["Find records in building A without location", "A", "A", "UNMAPPED"],
      [
        "Find records in Building A awaiting a location",
        "Building A",
        "A",
        "UNMAPPED",
      ],
      ["หาใบงานอาคารเหนือไม่มีตำแหน่ง", "เหนือ", "เหนือ", "UNMAPPED"],
      [
        'Find records in building "A without location"',
        "A without location",
        "A without location",
        "ALL",
      ],
      [
        'Find records in building "BOX part name FO1234" unmapped',
        "BOX part name FO1234",
        "BOX part name FO1234",
        "UNMAPPED",
      ],
    ] as const) {
      expect(
        parseJobScanSearchIntent(
          { ...base, filter, building: supplied },
          prompt,
        ),
      ).toEqual({
        kind: "OK",
        value: { filter, search: "", facets: { building } },
      });
    }
    expect(
      parseJobScanSearchIntent(
        { ...base, building: "A without location" },
        "Find records in building A without location",
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
    ).toEqual({ kind: "UNSUPPORTED" });
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
        'Set customer to ACME, Inc., and set part name to "Bolt and Nut"',
      ),
    ).toEqual({
      kind: "OK",
      value: { fields: { customer: "ACME, Inc.", partName: "Bolt and Nut" } },
    });
  });

  it("distinguishes a field name inside a literal from an explicit assignment", () => {
    expect(
      parseJobScanEditProposal(
        {
          ...emptyEdit,
          customer: "Acme, Location Services",
          partName: "Nuts and Format Washers",
          storageFormat: "BOX",
        },
        'set customer to Acme, Location Services and set part name to "Nuts and Format Washers", format to box',
      ),
    ).toEqual({
      kind: "OK",
      value: {
        fields: {
          customer: "Acme, Location Services",
          partName: "Nuts and Format Washers",
          storageFormat: "BOX",
        },
      },
    });
    expect(
      parseJobScanEditProposal(
        { ...emptyEdit, partName: "Red and Set Screws" },
        'set part name to "Red and Set Screws"',
      ),
    ).toEqual({
      kind: "OK",
      value: { fields: { partName: "Red and Set Screws" } },
    });
  });

  it("accepts a compound edit that names a typed quantity without an assignment word", () => {
    for (const [prompt, partName] of [
      ["Change product name to Outer 131 and set quantity 10", "Outer 131"],
      [
        "Change product name to Outer 131 and make the quantity 10",
        "Outer 131",
      ],
      ["Change product name to Outer 131 with quantity 10", "Outer 131"],
      [
        "Change product name to Outer 131 together with its quantity 10",
        "Outer 131",
      ],
      ["แก้ชื่อสินค้าเป็น กล่อง Outer 131 พร้อมกับจำนวน ๑๐", "กล่อง Outer 131"],
      [
        "Change product name to Outer 131 and set its quantity to 10",
        "Outer 131",
      ],
      [
        "Change product name to Outer 131 and set this record's quantity to 10",
        "Outer 131",
      ],
      [
        "Change product name to Outer 131 – also set quantity to 10",
        "Outer 131",
      ],
      ["Set product name to Outer 131 as well as quantity 10", "Outer 131"],
      [
        "แก้ชื่อสินค้าเป็น กล่อง Outer 131 รวมทั้งแก้จำนวน ๑๐",
        "กล่อง Outer 131",
      ],
      ["แก้ชื่อสินค้าเป็น กล่อง Outer 131 — แก้จำนวน๑๐", "กล่อง Outer 131"],
      [
        "แก้ชื่อสินค้าเป็น กล่อง Outer 131 — ก็ช่วยแก้จำนวน๑๐",
        "กล่อง Outer 131",
      ],
    ] as const) {
      expect(
        parseJobScanEditProposal(
          { ...emptyEdit, partName, quantity: 10 },
          prompt,
        ),
      ).toEqual({
        kind: "OK",
        value: { fields: { partName, quantity: 10 } },
      });
    }
    expect(
      parseJobScanEditProposal(
        { ...emptyEdit, partName: "Outer 131 and set quantity 10" },
        "Change product name to Outer 131 and set quantity 10",
      ),
    ).toEqual({ kind: "UNREADABLE" });
  });

  it("keeps punctuation in a literal name when no second command follows", () => {
    expect(
      parseJobScanEditProposal(
        { ...emptyEdit, partName: "Outer 131 – Blue" },
        "Change product name to Outer 131 – Blue",
      ),
    ).toEqual({
      kind: "OK",
      value: { fields: { partName: "Outer 131 – Blue" } },
    });
    expect(
      parseJobScanEditProposal(
        { ...emptyEdit, partName: "Outer 131 with Mark II" },
        "Change product name to Outer 131 with Mark II",
      ),
    ).toEqual({
      kind: "OK",
      value: { fields: { partName: "Outer 131 with Mark II" } },
    });
  });

  it("keeps supported compounds and rejects record actions across separator styles", () => {
    for (const separator of [
      " — ",
      "—",
      "–",
      "•",
      " | ",
      " / ",
      " and ",
      "，",
      "、",
      ".",
      "．",
      "。",
    ]) {
      for (const modifier of ["", "also ", "please also ", "and then "]) {
        for (const action of [
          "delete this record",
          "make a copy of this record",
          "email this record",
        ]) {
          const partName = "Outer 131" + separator + modifier + action;
          expect(
            parseJobScanEditProposal(
              { ...emptyEdit, partName },
              "Change product name to " + partName,
            ),
          ).toEqual({ kind: "UNSUPPORTED" });
        }
        expect(
          parseJobScanEditProposal(
            { ...emptyEdit, partName: "Outer 131", quantity: 10 },
            "Change product name to Outer 131" +
              separator +
              modifier +
              "set quantity to 10",
          ),
        ).toEqual({
          kind: "OK",
          value: { fields: { partName: "Outer 131", quantity: 10 } },
        });
      }
    }
    for (const separator of ["—", "｜", " และ ", "，", "、", ".", "．", "。"]) {
      const partName = "กล่อง" + separator + "ก็ช่วยทำสำเนาใบงานนี้";
      expect(
        parseJobScanEditProposal(
          { ...emptyEdit, partName },
          "แก้ชื่อสินค้าเป็น " + partName,
        ),
      ).toEqual({ kind: "UNSUPPORTED" });
    }
  });

  it("preserves ordinary periods, commas, and numeric punctuation inside values", () => {
    for (const partName of [
      "Widget.RevA",
      "Widget，Blue",
      "Widget 3.5",
      "Widget, Inc.",
    ]) {
      expect(
        parseJobScanEditProposal(
          { ...emptyEdit, partName },
          `Set part name to ${partName}`,
        ),
      ).toEqual({ kind: "OK", value: { fields: { partName } } });
    }
    expect(
      parseJobScanEditProposal(
        { ...emptyEdit, quantity: 1234.5 },
        "Set quantity to 1,234.5",
      ),
    ).toEqual({ kind: "OK", value: { fields: { quantity: 1234.5 } } });
  });

  it("does not strip negation or replacement from a follow-up edit", () => {
    for (const prompt of [
      "Change product name to Outer 131 – do not set quantity to 10",
      "Change product name to Outer 131 – instead set quantity to 10",
      "แก้ชื่อสินค้าเป็น กล่อง Outer 131 — อย่าแก้จำนวน๑๐",
    ]) {
      expect(
        parseJobScanEditProposal(
          { ...emptyEdit, partName: "Outer 131", quantity: 10 },
          prompt,
        ),
      ).toEqual({ kind: "UNSUPPORTED" });
    }
  });

  it("rejects an assignment to an unsupported field before comparing values", () => {
    for (const addition of [
      " and set the status to deleted",
      " and set status deleted",
      " and status: deleted",
      " and status to deleted",
      " and status deleted",
      " and review flag should be hold",
      " and review flag = hold",
      "— warehouse: different",
      " and change its owner to Alex",
      " — update priority: high",
      " และตั้งสถานะเป็นลบ",
      " และตั้งสถานะลบ",
      " และสถานะเป็นลบ",
      " และผู้รับผิดชอบ：สมชาย",
    ]) {
      const partName = "Blue Box" + addition;
      for (const proposed of [partName, "Blue Box"]) {
        expect(
          parseJobScanEditProposal(
            { ...emptyEdit, partName: proposed },
            "Change product name to " + partName,
          ),
        ).toEqual({ kind: "UNSUPPORTED" });
      }
    }
  });

  it("supports authorized shorthand fields and keeps explicitly quoted text literal", () => {
    expect(
      parseJobScanEditProposal(
        { ...emptyEdit, partName: "Blue Box", quantity: 10 },
        "Change product name to Blue Box and quantity: 10",
      ),
    ).toEqual({
      kind: "OK",
      value: { fields: { partName: "Blue Box", quantity: 10 } },
    });
    expect(
      parseJobScanEditProposal(
        { ...emptyEdit, partName: "Blue Box and status: deleted" },
        'Change product name to "Blue Box and status: deleted"',
      ),
    ).toEqual({
      kind: "OK",
      value: { fields: { partName: "Blue Box and status: deleted" } },
    });
  });

  it("accepts a compound edit that names a date without an assignment word", () => {
    expect(
      parseJobScanEditProposal(
        { ...emptyEdit, quantity: 15, deliveryDate: "6/7/2569" },
        "change quantity to 15 and change delivery date 6/7/2569",
      ),
    ).toEqual({
      kind: "OK",
      value: { fields: { quantity: 15, deliveryDate: "6/7/2569" } },
    });
  });

  it("accepts the prototype Thai edit examples", () => {
    expect(
      parseJobScanEditProposal(
        { ...emptyEdit, locationCode: "F2-L12-3" },
        "ย้ายไป F2-L12-3",
      ),
    ).toEqual({ kind: "OK", value: { locationCode: "F2-L12-3" } });
    expect(
      parseJobScanEditProposal(
        { ...emptyEdit, quantity: 40 },
        "แก้จำนวนเป็น 40",
      ),
    ).toEqual({ kind: "OK", value: { fields: { quantity: 40 } } });
    expect(
      parseJobScanEditProposal(
        { ...emptyEdit, partName: "กล่อง Outer 131" },
        "แก้ชื่อสินค้าเป็น กล่อง Outer 131",
      ),
    ).toEqual({
      kind: "OK",
      value: { fields: { partName: "กล่อง Outer 131" } },
    });
  });

  it("refuses conditional edits before comparing proposed values", () => {
    for (const [prompt, partName] of [
      [
        "Change part name to Gear only if the quantity is 40",
        "Gear only if the quantity is 40",
      ],
      [
        "Change part name to Gear unless it is already packed",
        "Gear unless it is already packed",
      ],
      [
        "Set part name to Widget once this record is mapped",
        "Widget once this record is mapped",
      ],
      ["Set part name to Widget only for pallets", "Widget only for pallets"],
      [
        "แก้ชื่อสินค้าเป็น กล่อง Outer 131 เฉพาะงานพาเลท",
        "กล่อง Outer 131 เฉพาะงานพาเลท",
      ],
      ["แก้ชื่อสินค้าเป็น Gear ถ้าจำนวนเป็น 40", "Gear ถ้าจำนวนเป็น 40"],
    ] as const) {
      expect(
        parseJobScanEditProposal({ ...emptyEdit, partName }, prompt),
      ).toEqual({ kind: "UNSUPPORTED" });
      expect(
        parseJobScanEditProposal({ ...emptyEdit, partName: "Gear" }, prompt),
      ).toEqual({ kind: "UNSUPPORTED" });
    }
  });

  it("allows a literal code or quoted text containing a conditional word", () => {
    expect(
      parseJobScanEditProposal(
        { ...emptyEdit, productBarcodeText: "IF-123" },
        "Change barcode to IF-123",
      ),
    ).toEqual({
      kind: "OK",
      value: { fields: { productBarcodeText: "IF-123" } },
    });
    expect(
      parseJobScanEditProposal(
        {
          ...emptyEdit,
          partName: "After Dark and format to box",
          quantity: 40,
        },
        'Set part name to "After Dark and format to box" and quantity to 40',
      ),
    ).toEqual({
      kind: "OK",
      value: {
        fields: { partName: "After Dark and format to box", quantity: 40 },
      },
    });
    expect(
      parseJobScanEditProposal(
        { ...emptyEdit, partName: "After Dark" },
        'Set part name to "After Dark" once it is mapped',
      ),
    ).toEqual({ kind: "UNSUPPORTED" });
  });

  it("declines record scope and unsupported secondary edits instead of storing them as names", () => {
    for (const [prompt, partName] of [
      ["Set part name to Widget for all records", "Widget for all records"],
      [
        "Set part name to Widget and clear the barcode",
        "Widget and clear the barcode",
      ],
      [
        "Set part name to Widget and delete this scan",
        "Widget and delete this scan",
      ],
      ["Set part name to Widget. Delete this scan", "Widget. Delete this scan"],
      [
        "Set part name to Widget! Could you export the records?",
        "Widget! Could you export the records?",
      ],
      [
        "Set part name to Widget and please export the shipment",
        "Widget and please export the shipment",
      ],
      ["Set part name to Widget; submit the job", "Widget; submit the job"],
      [
        "Set part name to Widget then increase the quantity",
        "Widget then increase the quantity",
      ],
      ["Change product name from Old to New", "from Old to New"],
      [
        "แก้ชื่อสินค้าเป็น กล่อง Outer 131 ทุกใบงาน",
        "กล่อง Outer 131 ทุกใบงาน",
      ],
      [
        "แก้ชื่อสินค้าเป็น กล่อง Outer 131 และลบบาร์โค้ด",
        "กล่อง Outer 131 และลบบาร์โค้ด",
      ],
      [
        "แก้ชื่อสินค้าเป็น กล่อง แล้วส่งออกใบงานนี้",
        "กล่อง แล้วส่งออกใบงานนี้",
      ],
      ["แก้ชื่อสินค้าเป็น กล่อง และส่งออกใบงานนี้", "กล่อง และส่งออกใบงานนี้"],
      [
        "แก้ชื่อสินค้าเป็น กล่อง กรุณาส่งออกใบงานนี้",
        "กล่อง กรุณาส่งออกใบงานนี้",
      ],
    ] as const) {
      for (const value of [partName, "Widget"]) {
        expect(
          parseJobScanEditProposal({ ...emptyEdit, partName: value }, prompt),
        ).toEqual({ kind: "UNSUPPORTED" });
      }
    }
  });

  it("distinguishes Thai record commands from quoted product names", () => {
    for (const command of [
      "ปิดใบงาน",
      "เปิดใหม่ใบงาน",
      "ล็อกรายการสแกน",
      "ทำการปิดใบงานนี้",
      "ช่วยดำเนินการเพื่อปิดใบงานนี้",
    ]) {
      const partName = `กล่อง Outer 131 และ${command}`;
      const proposal = { ...emptyEdit, partName };
      expect(
        parseJobScanEditProposal(proposal, `แก้ชื่อสินค้าเป็น ${partName}`),
      ).toEqual({ kind: "UNSUPPORTED" });
      expect(
        parseJobScanEditProposal(proposal, `แก้ชื่อสินค้าเป็น “${partName}”`),
      ).toEqual({ kind: "OK", value: { fields: { partName } } });
    }
  });

  it.each([
    "close",
    "close the dialog",
    "refresh the page",
    "quit this form",
    "log out",
    "end my session",
    "terminate my session",
    "lock me out",
    "switch warehouses",
    "scan the next ticket",
    "scan next ticket",
    "scan one more ticket",
    "start scanning one more ticket",
    "begin to scan the next QR",
    "start a new scan",
    "start a fresh barcode/QR scan",
    "have the scanner read the next ticket",
    "read the next barcode",
    "take another photo",
    "activate scanning",
    "recalculate the quantity",
    "verify incoming paperwork",
    "ช่วยใช้กล้องอ่านบาร์โค้ดใบงานถัดไป",
    "perform another warehouse barcode scan",
    "restart the scanner",
    "rescan both barcodes",
  ])(
    "requires quotes to treat follow-up command %s as literal text",
    (command) => {
      const partName = `Gear and ${command}`;
      const proposal = { ...emptyEdit, partName };
      expect(
        parseJobScanEditProposal(proposal, `Set part name to ${partName}`),
      ).toEqual({ kind: "UNSUPPORTED" });
      expect(
        parseJobScanEditProposal(proposal, `Set part name to "${partName}"`),
      ).toEqual({ kind: "OK", value: { fields: { partName } } });
    },
  );

  it("requires quotes around literal conjunctions and keeps compact code punctuation", () => {
    for (const [prefix, partName] of [
      ["Set part name to ", "Bolt and Nut"],
      ["Set part name to ", "Bolt ａｎｄ Nut"],
      ["Set part name to ", "Block & Pin"],
      ["แก้ชื่อสินค้าเป็น ", "ชุดน็อตและแหวน"],
    ] as const) {
      const proposal = { ...emptyEdit, partName };
      expect(parseJobScanEditProposal(proposal, prefix + partName)).toEqual({
        kind: "UNSUPPORTED",
      });
      expect(
        parseJobScanEditProposal(proposal, `${prefix}"${partName}"`),
      ).toEqual({ kind: "OK", value: { fields: { partName } } });
    }
    expect(
      parseJobScanEditProposal(
        { ...emptyEdit, partName: "R&D Gear A-640" },
        "Set part name to R&D Gear A-640",
      ),
    ).toEqual({
      kind: "OK",
      value: { fields: { partName: "R&D Gear A-640" } },
    });
  });

  it("declines vague or multiple destinations instead of treating them as a code", () => {
    for (const locationCode of [
      "near the door",
      "an empty spot",
      "the nearest available location",
      "whichever location is available",
      "any bay",
      "first free pallet position",
      "DOCK NORTH and DOCK SOUTH",
      "DOCK NORTH / DOCK SOUTH",
      "DOCK NORTH/DOCK SOUTH",
      "DOCK NORTH | DOCK SOUTH",
    ]) {
      expect(
        parseJobScanEditProposal(
          { ...emptyEdit, locationCode },
          `Move to ${locationCode}`,
        ),
      ).toEqual({ kind: "UNSUPPORTED" });
      expect(
        parseJobScanEditProposal(
          { ...emptyEdit, locationCode },
          `Move to "${locationCode}"`,
        ),
      ).toEqual({ kind: "OK", value: { locationCode } });
    }
  });
});
