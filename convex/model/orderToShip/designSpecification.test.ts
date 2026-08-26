import { describe, expect, it } from "vitest";

import {
  DESIGN_KEY_SEPARATOR,
  MAX_DESIGN_CODE_LENGTH,
  MAX_DIMENSION_MM,
  MAX_FINISHING_ROWS,
  MAX_PRINT_COLOURS,
  MAX_SPEC_TEXT_LENGTH,
  decideDesignSource,
  designSimilarityScore,
  designKeyOf,
  isSameDesign,
  makeDesignSpecification,
  normalizeCustomerProductCode,
  type DesignSpecification,
  type DesignSpecificationInput,
} from "./designSpecification";

const VALID: DesignSpecificationInput = Object.freeze({
  styleCode: "RSC",
  internalLengthMm: 300,
  internalWidthMm: 200,
  internalHeightMm: 150,
  boardGrade: "KA125/C/KA125",
  printColourCount: 2,
});

function specificationOf(
  overrides: Partial<DesignSpecificationInput> = {},
): DesignSpecification {
  const built = makeDesignSpecification({ ...VALID, ...overrides });
  if (!built.ok) {
    throw new Error(
      `fixture is not a valid specification: ${built.error.code}`,
    );
  }
  return built.value;
}

describe("makeDesignSpecification", () => {
  it("normalizes codes to upper case with internal whitespace removed", () => {
    const built = makeDesignSpecification({
      ...VALID,
      styleCode: " rsc ",
      boardGrade: "KA125 / C / KA125",
    });

    expect(built).toStrictEqual({
      ok: true,
      value: {
        styleCode: "RSC",
        internalLengthMm: 300,
        internalWidthMm: 200,
        internalHeightMm: 150,
        boardGrade: "KA125/C/KA125",
        printColourCount: 2,
      },
    });
  });

  it("accepts an unprinted box: zero colours is a real answer, not a missing one", () => {
    const built = makeDesignSpecification({ ...VALID, printColourCount: 0 });

    expect(built.ok).toBe(true);
    expect(built.ok && built.value.printColourCount).toBe(0);
  });

  it("returns a frozen value so a caller cannot mutate a validated specification", () => {
    expect(Object.isFrozen(specificationOf())).toBe(true);
  });

  it("normalizes and preserves the complete production hand-off details", () => {
    const built = makeDesignSpecification({
      ...VALID,
      finishedGoodItemCode: " fg-box-01 ",
      boxType: "Die cut",
      piecesPerSheet: 2,
      piecesPerSet: 1,
      printSide: "Outside",
      coatingSide: "Outside",
      creaseSide: "Inside",
      dieBlockCode: " die-17 ",
      dieBlockStorageLocation: "Rack D-04",
      printingPlateCode: " plate-8505 ",
      printingPlateStorageLocation: "Plate room P-03",
      jointType: "Glue joint",
      glueType: "PVA",
      wirePerCarton: 0,
      unitsPerCarton: 10,
    });

    expect(built).toMatchObject({
      ok: true,
      value: {
        finishedGoodItemCode: "FG-BOX-01",
        boxType: "Die cut",
        piecesPerSheet: 2,
        piecesPerSet: 1,
        printSide: "Outside",
        coatingSide: "Outside",
        creaseSide: "Inside",
        dieBlockCode: "DIE-17",
        dieBlockStorageLocation: "Rack D-04",
        printingPlateCode: "PLATE-8505",
        printingPlateStorageLocation: "Plate room P-03",
        jointType: "Glue joint",
        glueType: "PVA",
        wirePerCarton: 0,
        unitsPerCarton: 10,
      },
    });
  });

  it.each([
    ["piecesPerSheet", { piecesPerSheet: 0 }, "TOO_SMALL"],
    ["piecesPerSet", { piecesPerSet: 1.5 }, "NOT_A_WHOLE_NUMBER"],
    ["wirePerCarton", { wirePerCarton: -1 }, "TOO_SMALL"],
    ["unitsPerCarton", { unitsPerCarton: 0 }, "TOO_SMALL"],
  ])("validates production quantity %s", (field, override, reason) => {
    expect(
      makeDesignSpecification({
        ...VALID,
        ...(override as Partial<DesignSpecificationInput>),
      }),
    ).toStrictEqual({
      ok: false,
      error: { code: "MEASUREMENT_INVALID", field, reason },
    });
  });

  it.each([
    ["styleCode", { styleCode: "   " }, "FIELD_INVALID", "EMPTY"],
    [
      "styleCode",
      { styleCode: "A".repeat(MAX_DESIGN_CODE_LENGTH + 1) },
      "FIELD_INVALID",
      "TOO_LONG",
    ],
    [
      "styleCode",
      { styleCode: `RSC${DESIGN_KEY_SEPARATOR}B` },
      "FIELD_INVALID",
      "SEPARATOR_NOT_ALLOWED",
    ],
    ["boardGrade", { boardGrade: "" }, "FIELD_INVALID", "EMPTY"],
    [
      "internalLengthMm",
      { internalLengthMm: 300.5 },
      "MEASUREMENT_INVALID",
      "NOT_A_WHOLE_NUMBER",
    ],
    [
      "internalWidthMm",
      { internalWidthMm: 0 },
      "MEASUREMENT_INVALID",
      "TOO_SMALL",
    ],
    [
      "internalHeightMm",
      { internalHeightMm: MAX_DIMENSION_MM + 1 },
      "MEASUREMENT_INVALID",
      "TOO_LARGE",
    ],
    [
      "internalLengthMm",
      { internalLengthMm: Number.NaN },
      "MEASUREMENT_INVALID",
      "NOT_A_NUMBER",
    ],
    [
      "printColourCount",
      { printColourCount: -1 },
      "MEASUREMENT_INVALID",
      "TOO_SMALL",
    ],
    [
      "printColourCount",
      { printColourCount: MAX_PRINT_COLOURS + 1 },
      "MEASUREMENT_INVALID",
      "TOO_LARGE",
    ],
  ])("refuses %s by name (%o)", (field, override, code, reason) => {
    const built = makeDesignSpecification({
      ...VALID,
      ...(override as Partial<DesignSpecificationInput>),
    });

    expect(built).toStrictEqual({
      ok: false,
      error: { code, field, reason },
    });
  });

  it("names a field and never echoes the offending value", () => {
    const built = makeDesignSpecification({
      ...VALID,
      styleCode: "SECRET-LOOKING-VALUE|X",
    });

    expect(built.ok).toBe(false);

    expect(JSON.stringify(built)).not.toContain("SECRET-LOOKING-VALUE");
  });

  it("refuses a fractional dimension rather than rounding it", () => {
    // Rounding an *internal* dimension down is how a box ends up too small for
    // what the customer puts in it, so the refusal is the safe answer.
    const built = makeDesignSpecification({ ...VALID, internalWidthMm: 199.9 });

    expect(built.ok).toBe(false);
  });

  it.each([
    ["notes", { notes: "x".repeat(MAX_SPEC_TEXT_LENGTH + 1) }],
    [
      "route.0.instruction",
      {
        route: [
          {
            sequence: 1,
            workCenterCode: "PRINT",
            operationCode: "PRINT",
            instruction: "x".repeat(MAX_SPEC_TEXT_LENGTH + 1),
          },
        ],
      },
    ],
    [
      "qualityRequirements.0.tolerance",
      {
        qualityRequirements: [
          {
            code: "BURST",
            description: "Burst strength",
            target: "100",
            tolerance: "x".repeat(MAX_SPEC_TEXT_LENGTH + 1),
          },
        ],
      },
    ],
    [
      "printColours",
      {
        printColours: Array.from(
          { length: MAX_PRINT_COLOURS + 1 },
          () => "INK",
        ),
      },
    ],
    [
      "finishing",
      {
        finishing: Array.from({ length: MAX_FINISHING_ROWS + 1 }, () => "GLUE"),
      },
    ],
  ])("bounds optional structured field %s", (field, override) => {
    const built = makeDesignSpecification({
      ...VALID,
      ...(override as Partial<DesignSpecificationInput>),
    });
    expect(built).toStrictEqual({
      ok: false,
      error: {
        code: "FIELD_INVALID",
        field,
        reason:
          field.includes(".") || field === "notes"
            ? "TOO_LONG"
            : "TOO_MANY_ROWS",
      },
    });
  });

  it.each([
    [
      "layers.0.paperCode",
      { layers: [{ position: 1, paperCode: "", grammageGsm: 125 }] },
    ],
    [
      "route.0.sequence",
      {
        route: [
          { sequence: 1.5, workCenterCode: "PRN", operationCode: "PRINT" },
        ],
      },
    ],
    [
      "materials.0.quantityPerUnit",
      {
        materials: [
          {
            itemCode: "BOARD",
            description: "Board",
            quantityPerUnit: 0,
            uom: "SHEET",
          },
        ],
      },
    ],
    [
      "qualityRequirements.0.target",
      {
        qualityRequirements: [
          { code: "BCT", description: "Compression", target: "" },
        ],
      },
    ],
    [
      "calculations.0.inputs",
      {
        calculations: [
          {
            name: "BCT",
            formulaVersion: "1",
            inputs: [],
            result: 4_680,
            unit: "N",
            passed: true,
            verifiedByUserId: "user_1",
            verifiedAt: 1,
          },
        ],
      },
    ],
  ])("validates nested release evidence at %s", (field, override) => {
    const built = makeDesignSpecification({
      ...VALID,
      ...(override as Partial<DesignSpecificationInput>),
    });
    expect(built.ok).toBe(false);
    expect(!built.ok && built.error.field).toBe(field);
  });
});

describe("designKeyOf", () => {
  it("composes the key from style, dimensions, grade, and colour count", () => {
    expect(designKeyOf(specificationOf())).toBe(
      "RSC|300x200x150|KA125/C/KA125|C2",
    );
  });

  it("is stable: the same specification always yields the same key", () => {
    expect(designKeyOf(specificationOf())).toBe(designKeyOf(specificationOf()));
  });

  it("does not sort dimensions — a rotated box is a different dieline", () => {
    const upright = specificationOf();
    const rotated = specificationOf({
      internalLengthMm: 200,
      internalWidthMm: 300,
    });

    expect(designKeyOf(upright)).not.toBe(designKeyOf(rotated));
  });

  it.each([
    ["style", { styleCode: "HSC" }],
    ["length", { internalLengthMm: 305 }],
    ["board grade", { boardGrade: "KA150/C/KA150" }],
    ["colour count", { printColourCount: 3 }],
  ])("changes when the %s changes", (_label, override) => {
    expect(designKeyOf(specificationOf(override))).not.toBe(
      designKeyOf(specificationOf()),
    );
  });

  it("treats a near miss as a different design (`WF-04` stays open)", () => {
    expect(
      isSameDesign(
        specificationOf(),
        specificationOf({ internalLengthMm: 305 }),
      ),
    ).toBe(false);
  });

  it("matches two specifications written with different casing and spacing", () => {
    expect(
      isSameDesign(
        specificationOf(),
        specificationOf({ styleCode: "rsc", boardGrade: "ka125 / c / ka125" }),
      ),
    ).toBe(true);
  });
});

describe("decideDesignSource", () => {
  const specification = specificationOf();
  const designKey = designKeyOf(specification);

  it("chooses NEW when no candidate exists", () => {
    expect(
      decideDesignSource({
        customerProductCode: "cust-001",
        specification,
      }),
    ).toStrictEqual({
      ok: true,
      value: {
        source: "NEW",
        customerProductCode: "CUST-001",
        designKey,
      },
    });
  });

  it("pins only a released revision with the same customer product code", () => {
    expect(
      decideDesignSource({
        customerProductCode: "cust-001",
        specification,
        releasedCandidate: {
          revisionId: "rev_1",
          status: "RELEASED",
          customerProductCode: "CUST-001",
        },
      }),
    ).toStrictEqual({
      ok: true,
      value: {
        source: "EXISTING",
        customerProductCode: "CUST-001",
        designKey,
        masterCardRevisionId: "rev_1",
      },
    });
  });

  it("never auto-pins the same geometry under a different product code", () => {
    expect(
      decideDesignSource({
        customerProductCode: "CUST-002",
        specification,
        releasedCandidate: {
          revisionId: "rev_1",
          status: "RELEASED",
          customerProductCode: "CUST-001",
        },
      }),
    ).toStrictEqual({
      ok: true,
      value: {
        source: "NEW",
        customerProductCode: "CUST-002",
        designKey,
      },
    });
  });

  it.each(["DRAFT", "IN_REVIEW", "REJECTED", "SUPERSEDED"])(
    "treats a %s candidate as absent and asks engineering for a new design",
    (status) => {
      expect(
        decideDesignSource({
          customerProductCode: "CUST-001",
          specification,
          releasedCandidate: {
            revisionId: "rev_1",
            status,
            customerProductCode: "CUST-001",
          },
        }),
      ).toStrictEqual({
        ok: true,
        value: {
          source: "NEW",
          customerProductCode: "CUST-001",
          designKey,
        },
      });
    },
  );

  it("never carries a revision id on a NEW decision", () => {
    const decision = decideDesignSource({
      customerProductCode: "CUST-001",
      specification,
      releasedCandidate: {
        revisionId: "rev_1",
        status: "DRAFT",
        customerProductCode: "CUST-001",
      },
    });

    expect(decision.ok).toBe(true);
    expect(decision.ok && decision.value.masterCardRevisionId).toBeUndefined();
    expect(
      decision.ok && Object.hasOwn(decision.value, "masterCardRevisionId"),
    ).toBe(false);
  });
});

describe("customer product identity and similarity", () => {
  it("normalizes the customer product code used for exact matching", () => {
    expect(normalizeCustomerProductCode("  fg  001 ")).toStrictEqual({
      ok: true,
      value: "FG 001",
    });
  });

  it("keeps a high similarity score advisory only", () => {
    const requested = specificationOf();
    const candidate = specificationOf({ internalLengthMm: 301 });
    expect(designSimilarityScore(requested, candidate)).toBeCloseTo(5 / 6);
    expect(
      decideDesignSource({
        customerProductCode: "NEW-SKU",
        specification: requested,
        releasedCandidate: {
          revisionId: "rev_1",
          status: "RELEASED",
          customerProductCode: "OLD-SKU",
        },
      }),
    ).toMatchObject({ ok: true, value: { source: "NEW" } });
  });
});
