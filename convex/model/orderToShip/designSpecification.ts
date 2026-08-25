import { fail, ok, type Result } from "../result";

export type DesignSpecificationError =
  | {
      readonly code: "FIELD_INVALID";
      readonly field: string;
      readonly reason: string;
    }
  /** A dimension or count was not a whole number in range. */
  | {
      readonly code: "MEASUREMENT_INVALID";
      readonly field: string;
      readonly reason: string;
    };

export const MAX_DESIGN_CODE_LENGTH = 64;

export const MAX_DIMENSION_MM = 10_000;

export const MAX_PRINT_COLOURS = 12;

export const MAX_SPEC_TEXT_LENGTH = 2_000;
export const MAX_FINISHING_ROWS = 50;

export const DESIGN_KEY_SEPARATOR = "|";

export const MAX_CUSTOMER_PRODUCT_CODE_LENGTH = 96;

export interface DesignSpecification {
  readonly styleCode: string;
  readonly internalLengthMm: number;
  readonly internalWidthMm: number;
  readonly internalHeightMm: number;
  readonly boardGrade: string;
  readonly printColourCount: number;
  readonly productNameEn?: string;
  readonly productNameTh?: string;
  readonly sheetLengthMm?: number;
  readonly sheetWidthMm?: number;
  readonly lengthToleranceMm?: number;
  readonly widthToleranceMm?: number;
  readonly heightToleranceMm?: number;
  readonly fluteCode?: string;
  readonly layers?: readonly PaperLayer[];
  readonly printMethod?: string;
  readonly printColours?: readonly string[];
  readonly finishing?: readonly string[];
  readonly bundleQuantity?: number;
  readonly palletQuantity?: number;
  readonly packingInstructions?: string;
  readonly route?: readonly RouteStep[];
  readonly materials?: readonly MaterialRequirement[];
  readonly qualityRequirements?: readonly QualityRequirement[];
  readonly calculations?: readonly CalculationEvidence[];
  readonly notes?: string;
}

export interface PaperLayer {
  readonly position: number;
  readonly paperCode: string;
  readonly grammageGsm: number;
}

export interface RouteStep {
  readonly sequence: number;
  readonly workCenterCode: string;
  readonly operationCode: string;
  readonly instruction?: string;
}

export interface MaterialRequirement {
  readonly itemCode: string;
  readonly description: string;
  readonly quantityPerUnit: number;
  readonly uom: string;
  readonly wastePercent?: number;
}

export interface QualityRequirement {
  readonly code: string;
  readonly description: string;
  readonly target: string;
  readonly tolerance?: string;
}

export interface CalculationEvidence {
  readonly name: string;
  readonly formulaVersion: string;
  readonly inputs: readonly CalculationInput[];
  readonly result: number;
  readonly unit: string;
  readonly passed: boolean;
  readonly verifiedByUserId: string;
  readonly verifiedAt: number;
}

export interface CalculationInput {
  readonly name: string;
  readonly value: number;
  readonly unit: string;
}

export interface DesignSpecificationInput {
  readonly styleCode: string;
  readonly internalLengthMm: number;
  readonly internalWidthMm: number;
  readonly internalHeightMm: number;
  readonly boardGrade: string;
  readonly printColourCount: number;
  readonly productNameEn?: string;
  readonly productNameTh?: string;
  readonly sheetLengthMm?: number;
  readonly sheetWidthMm?: number;
  readonly lengthToleranceMm?: number;
  readonly widthToleranceMm?: number;
  readonly heightToleranceMm?: number;
  readonly fluteCode?: string;
  readonly layers?: readonly PaperLayer[];
  readonly printMethod?: string;
  readonly printColours?: readonly string[];
  readonly finishing?: readonly string[];
  readonly bundleQuantity?: number;
  readonly palletQuantity?: number;
  readonly packingInstructions?: string;
  readonly route?: readonly RouteStep[];
  readonly materials?: readonly MaterialRequirement[];
  readonly qualityRequirements?: readonly QualityRequirement[];
  readonly calculations?: readonly CalculationEvidence[];
  readonly notes?: string;
}

function normalizeDesignCode(
  field: string,
  raw: string,
): Result<string, DesignSpecificationError> {
  if (typeof raw !== "string") {
    return fail({ code: "FIELD_INVALID", field, reason: "NOT_A_STRING" });
  }
  const collapsed = raw.trim().replace(/\s+/g, "").toUpperCase();
  if (collapsed.length === 0) {
    return fail({ code: "FIELD_INVALID", field, reason: "EMPTY" });
  }
  if (collapsed.length > MAX_DESIGN_CODE_LENGTH) {
    return fail({ code: "FIELD_INVALID", field, reason: "TOO_LONG" });
  }
  if (collapsed.includes(DESIGN_KEY_SEPARATOR)) {
    return fail({
      code: "FIELD_INVALID",
      field,
      reason: "SEPARATOR_NOT_ALLOWED",
    });
  }
  return ok(collapsed);
}

export function normalizeCustomerProductCode(
  raw: string,
): Result<string, DesignSpecificationError> {
  if (typeof raw !== "string") {
    return fail({
      code: "FIELD_INVALID",
      field: "customerProductCode",
      reason: "NOT_A_STRING",
    });
  }
  const normalized = raw.trim().replace(/\s+/g, " ").toUpperCase();
  if (normalized.length === 0) {
    return fail({
      code: "FIELD_INVALID",
      field: "customerProductCode",
      reason: "EMPTY",
    });
  }
  if (normalized.length > MAX_CUSTOMER_PRODUCT_CODE_LENGTH) {
    return fail({
      code: "FIELD_INVALID",
      field: "customerProductCode",
      reason: "TOO_LONG",
    });
  }
  return ok(normalized);
}

function requireWholeNumber(
  field: string,
  value: number,
  bounds: { readonly min: number; readonly max: number },
): Result<number, DesignSpecificationError> {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fail({ code: "MEASUREMENT_INVALID", field, reason: "NOT_A_NUMBER" });
  }
  if (!Number.isInteger(value)) {
    return fail({
      code: "MEASUREMENT_INVALID",
      field,
      reason: "NOT_A_WHOLE_NUMBER",
    });
  }
  if (value < bounds.min) {
    return fail({ code: "MEASUREMENT_INVALID", field, reason: "TOO_SMALL" });
  }
  if (value > bounds.max) {
    return fail({ code: "MEASUREMENT_INVALID", field, reason: "TOO_LARGE" });
  }
  return ok(value);
}

const requiredText = (
  field: string,
  value: unknown,
): Result<string, DesignSpecificationError> => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fail({ code: "FIELD_INVALID", field, reason: "EMPTY" });
  }
  if (value.trim().length > 500) {
    return fail({ code: "FIELD_INVALID", field, reason: "TOO_LONG" });
  }
  return ok(value.trim());
};

const optionalText = (
  field: string,
  value: unknown,
  max = MAX_SPEC_TEXT_LENGTH,
): Result<string | undefined, DesignSpecificationError> => {
  if (value === undefined) return ok(undefined);
  if (typeof value !== "string") {
    return fail({ code: "FIELD_INVALID", field, reason: "NOT_A_STRING" });
  }
  const normalized = value.trim();
  if (normalized.length === 0) return ok(undefined);
  if (normalized.length > max) {
    return fail({ code: "FIELD_INVALID", field, reason: "TOO_LONG" });
  }
  return ok(normalized);
};

const finiteNumber = (
  field: string,
  value: unknown,
  bounds: { readonly min: number; readonly max: number },
): Result<number, DesignSpecificationError> => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fail({ code: "MEASUREMENT_INVALID", field, reason: "NOT_A_NUMBER" });
  }
  if (value < bounds.min || value > bounds.max) {
    return fail({
      code: "MEASUREMENT_INVALID",
      field,
      reason: value < bounds.min ? "TOO_SMALL" : "TOO_LARGE",
    });
  }
  return ok(value);
};

const boundedRows = (
  field: string,
  rows: readonly unknown[] | undefined,
  max: number,
): Result<true, DesignSpecificationError> =>
  rows !== undefined && rows.length > max
    ? fail({ code: "FIELD_INVALID", field, reason: "TOO_MANY_ROWS" })
    : ok(true);

export function makeDesignSpecification(
  input: DesignSpecificationInput,
): Result<DesignSpecification, DesignSpecificationError> {
  const styleCode = normalizeDesignCode("styleCode", input.styleCode);
  if (!styleCode.ok) return styleCode;

  const boardGrade = normalizeDesignCode("boardGrade", input.boardGrade);
  if (!boardGrade.ok) return boardGrade;

  const length = requireWholeNumber(
    "internalLengthMm",
    input.internalLengthMm,
    {
      min: 1,
      max: MAX_DIMENSION_MM,
    },
  );
  if (!length.ok) return length;

  const width = requireWholeNumber("internalWidthMm", input.internalWidthMm, {
    min: 1,
    max: MAX_DIMENSION_MM,
  });
  if (!width.ok) return width;

  const height = requireWholeNumber(
    "internalHeightMm",
    input.internalHeightMm,
    {
      min: 1,
      max: MAX_DIMENSION_MM,
    },
  );
  if (!height.ok) return height;

  const colours = requireWholeNumber(
    "printColourCount",
    input.printColourCount,
    { min: 0, max: MAX_PRINT_COLOURS },
  );
  if (!colours.ok) return colours;

  for (const [field, value] of [
    ["sheetLengthMm", input.sheetLengthMm],
    ["sheetWidthMm", input.sheetWidthMm],
  ] as const) {
    if (value === undefined) continue;
    const checked = requireWholeNumber(field, value, {
      min: 1,
      max: MAX_DIMENSION_MM,
    });
    if (!checked.ok) return checked;
  }
  for (const [field, value] of [
    ["lengthToleranceMm", input.lengthToleranceMm],
    ["widthToleranceMm", input.widthToleranceMm],
    ["heightToleranceMm", input.heightToleranceMm],
  ] as const) {
    if (value === undefined) continue;
    const checked = finiteNumber(field, value, { min: 0, max: 1_000 });
    if (!checked.ok) return checked;
  }
  for (const [field, value] of [
    ["bundleQuantity", input.bundleQuantity],
    ["palletQuantity", input.palletQuantity],
  ] as const) {
    if (value === undefined) continue;
    const checked = requireWholeNumber(field, value, {
      min: 1,
      max: 1_000_000,
    });
    if (!checked.ok) return checked;
  }

  for (const [field, rows, max] of [
    ["layers", input.layers, 10],
    ["printColours", input.printColours, MAX_PRINT_COLOURS],
    ["finishing", input.finishing, MAX_FINISHING_ROWS],
    ["route", input.route, 100],
    ["materials", input.materials, 100],
    ["qualityRequirements", input.qualityRequirements, 100],
    ["calculations", input.calculations, 100],
  ] as const) {
    const checked = boundedRows(field, rows, max);
    if (!checked.ok) return checked;
  }

  let layers: PaperLayer[] | undefined;
  let route: RouteStep[] | undefined;
  let materials: MaterialRequirement[] | undefined;
  let qualityRequirements: QualityRequirement[] | undefined;
  let calculations: CalculationEvidence[] | undefined;
  let printColours: string[] | undefined;
  let finishing: string[] | undefined;
  const productNameEn = optionalText("productNameEn", input.productNameEn, 500);
  if (!productNameEn.ok) return productNameEn;
  const productNameTh = optionalText("productNameTh", input.productNameTh, 500);
  if (!productNameTh.ok) return productNameTh;
  const fluteCode = optionalText("fluteCode", input.fluteCode, 64);
  if (!fluteCode.ok) return fluteCode;
  const printMethod = optionalText("printMethod", input.printMethod, 500);
  if (!printMethod.ok) return printMethod;
  const packingInstructions = optionalText(
    "packingInstructions",
    input.packingInstructions,
  );
  if (!packingInstructions.ok) return packingInstructions;
  const notes = optionalText("notes", input.notes);
  if (!notes.ok) return notes;
  try {
    printColours = input.printColours?.map((value, index) => {
      const checked = requiredText(`printColours.${index}`, value);
      if (!checked.ok) throw checked.error;
      return checked.value;
    });
    finishing = input.finishing?.map((value, index) => {
      const checked = requiredText(`finishing.${index}`, value);
      if (!checked.ok) throw checked.error;
      return checked.value;
    });
    layers = input.layers?.map((row, index) => {
      const position = requireWholeNumber(
        `layers.${index}.position`,
        row.position,
        { min: 1, max: 10 },
      );
      if (!position.ok) throw position.error;
      const paperCode = requiredText(
        `layers.${index}.paperCode`,
        row.paperCode,
      );
      if (!paperCode.ok) throw paperCode.error;
      const grammage = requireWholeNumber(
        `layers.${index}.grammageGsm`,
        row.grammageGsm,
        { min: 1, max: 2_000 },
      );
      if (!grammage.ok) throw grammage.error;
      return {
        position: position.value,
        paperCode: paperCode.value.toUpperCase(),
        grammageGsm: grammage.value,
      };
    });
    route = input.route?.map((row, index) => {
      const sequence = requireWholeNumber(
        `route.${index}.sequence`,
        row.sequence,
        { min: 1, max: 100 },
      );
      if (!sequence.ok) throw sequence.error;
      const workCenter = requiredText(
        `route.${index}.workCenterCode`,
        row.workCenterCode,
      );
      if (!workCenter.ok) throw workCenter.error;
      const operation = requiredText(
        `route.${index}.operationCode`,
        row.operationCode,
      );
      if (!operation.ok) throw operation.error;
      const instruction = optionalText(
        `route.${index}.instruction`,
        row.instruction,
      );
      if (!instruction.ok) throw instruction.error;
      return {
        sequence: sequence.value,
        workCenterCode: workCenter.value.toUpperCase(),
        operationCode: operation.value.toUpperCase(),
        ...(instruction.value === undefined
          ? {}
          : { instruction: instruction.value }),
      };
    });
    materials = input.materials?.map((row, index) => {
      const itemCode = requiredText(
        `materials.${index}.itemCode`,
        row.itemCode,
      );
      if (!itemCode.ok) throw itemCode.error;
      const description = requiredText(
        `materials.${index}.description`,
        row.description,
      );
      if (!description.ok) throw description.error;
      const quantity = finiteNumber(
        `materials.${index}.quantityPerUnit`,
        row.quantityPerUnit,
        { min: Number.EPSILON, max: 1_000_000 },
      );
      if (!quantity.ok) throw quantity.error;
      const uom = requiredText(`materials.${index}.uom`, row.uom);
      if (!uom.ok) throw uom.error;
      if (row.wastePercent !== undefined) {
        const waste = finiteNumber(
          `materials.${index}.wastePercent`,
          row.wastePercent,
          { min: 0, max: 100 },
        );
        if (!waste.ok) throw waste.error;
      }
      return {
        itemCode: itemCode.value.toUpperCase(),
        description: description.value,
        quantityPerUnit: quantity.value,
        uom: uom.value.toUpperCase(),
        ...(row.wastePercent === undefined
          ? {}
          : { wastePercent: row.wastePercent }),
      };
    });
    qualityRequirements = input.qualityRequirements?.map((row, index) => {
      const code = requiredText(`qualityRequirements.${index}.code`, row.code);
      if (!code.ok) throw code.error;
      const description = requiredText(
        `qualityRequirements.${index}.description`,
        row.description,
      );
      if (!description.ok) throw description.error;
      const target = requiredText(
        `qualityRequirements.${index}.target`,
        row.target,
      );
      if (!target.ok) throw target.error;
      const tolerance = optionalText(
        `qualityRequirements.${index}.tolerance`,
        row.tolerance,
      );
      if (!tolerance.ok) throw tolerance.error;
      return {
        code: code.value.toUpperCase(),
        description: description.value,
        target: target.value,
        ...(tolerance.value === undefined
          ? {}
          : { tolerance: tolerance.value }),
      };
    });
    calculations = input.calculations?.map((row, index) => {
      const name = requiredText(`calculations.${index}.name`, row.name);
      if (!name.ok) throw name.error;
      const formula = requiredText(
        `calculations.${index}.formulaVersion`,
        row.formulaVersion,
      );
      if (!formula.ok) throw formula.error;
      const result = finiteNumber(`calculations.${index}.result`, row.result, {
        min: -1_000_000_000,
        max: 1_000_000_000,
      });
      if (!result.ok) throw result.error;
      const unit = requiredText(`calculations.${index}.unit`, row.unit);
      if (!unit.ok) throw unit.error;
      const verifier = requiredText(
        `calculations.${index}.verifiedByUserId`,
        row.verifiedByUserId,
      );
      if (!verifier.ok) throw verifier.error;
      const verifiedAt = finiteNumber(
        `calculations.${index}.verifiedAt`,
        row.verifiedAt,
        { min: 1, max: Number.MAX_SAFE_INTEGER },
      );
      if (!verifiedAt.ok) throw verifiedAt.error;
      if (typeof row.passed !== "boolean") {
        throw {
          code: "FIELD_INVALID",
          field: `calculations.${index}.passed`,
          reason: "NOT_A_BOOLEAN",
        } satisfies DesignSpecificationError;
      }
      const inputs = row.inputs.map((entry, inputIndex) => {
        const inputName = requiredText(
          `calculations.${index}.inputs.${inputIndex}.name`,
          entry.name,
        );
        if (!inputName.ok) throw inputName.error;
        const inputValue = finiteNumber(
          `calculations.${index}.inputs.${inputIndex}.value`,
          entry.value,
          { min: -1_000_000_000, max: 1_000_000_000 },
        );
        if (!inputValue.ok) throw inputValue.error;
        const inputUnit = requiredText(
          `calculations.${index}.inputs.${inputIndex}.unit`,
          entry.unit,
        );
        if (!inputUnit.ok) throw inputUnit.error;
        return {
          name: inputName.value,
          value: inputValue.value,
          unit: inputUnit.value,
        };
      });
      if (inputs.length === 0 || inputs.length > 20) {
        throw {
          code: "FIELD_INVALID",
          field: `calculations.${index}.inputs`,
          reason: inputs.length === 0 ? "EMPTY" : "TOO_MANY_ROWS",
        } satisfies DesignSpecificationError;
      }
      return {
        name: name.value,
        formulaVersion: formula.value,
        inputs,
        result: result.value,
        unit: unit.value,
        passed: row.passed,
        verifiedByUserId: verifier.value,
        verifiedAt: verifiedAt.value,
      };
    });
    for (const [field, values] of [
      ["layers", layers?.map((row) => row.position)],
      ["route", route?.map((row) => row.sequence)],
    ] as const) {
      if (values !== undefined && new Set(values).size !== values.length) {
        throw {
          code: "FIELD_INVALID",
          field,
          reason: "DUPLICATE_SEQUENCE",
        } satisfies DesignSpecificationError;
      }
    }
  } catch (error) {
    return fail(error as DesignSpecificationError);
  }

  return ok(
    Object.freeze({
      styleCode: styleCode.value,
      internalLengthMm: length.value,
      internalWidthMm: width.value,
      internalHeightMm: height.value,
      boardGrade: boardGrade.value,
      printColourCount: colours.value,
      ...(productNameEn.value === undefined
        ? {}
        : { productNameEn: productNameEn.value }),
      ...(productNameTh.value === undefined
        ? {}
        : { productNameTh: productNameTh.value }),
      ...(input.sheetLengthMm === undefined
        ? {}
        : { sheetLengthMm: input.sheetLengthMm }),
      ...(input.sheetWidthMm === undefined
        ? {}
        : { sheetWidthMm: input.sheetWidthMm }),
      ...(input.lengthToleranceMm === undefined
        ? {}
        : { lengthToleranceMm: input.lengthToleranceMm }),
      ...(input.widthToleranceMm === undefined
        ? {}
        : { widthToleranceMm: input.widthToleranceMm }),
      ...(input.heightToleranceMm === undefined
        ? {}
        : { heightToleranceMm: input.heightToleranceMm }),
      ...(fluteCode.value === undefined
        ? {}
        : { fluteCode: fluteCode.value.toUpperCase() }),
      ...(input.layers === undefined
        ? {}
        : { layers: Object.freeze(layers ?? []) }),
      ...(printMethod.value === undefined
        ? {}
        : { printMethod: printMethod.value }),
      ...(input.printColours === undefined
        ? {}
        : { printColours: Object.freeze(printColours ?? []) }),
      ...(input.finishing === undefined
        ? {}
        : { finishing: Object.freeze(finishing ?? []) }),
      ...(input.bundleQuantity === undefined
        ? {}
        : { bundleQuantity: input.bundleQuantity }),
      ...(input.palletQuantity === undefined
        ? {}
        : { palletQuantity: input.palletQuantity }),
      ...(packingInstructions.value === undefined
        ? {}
        : { packingInstructions: packingInstructions.value }),
      ...(input.route === undefined
        ? {}
        : { route: Object.freeze(route ?? []) }),
      ...(input.materials === undefined
        ? {}
        : {
            materials: Object.freeze(materials ?? []),
          }),
      ...(input.qualityRequirements === undefined
        ? {}
        : {
            qualityRequirements: Object.freeze(qualityRequirements ?? []),
          }),
      ...(input.calculations === undefined
        ? {}
        : {
            calculations: Object.freeze(calculations ?? []),
          }),
      ...(notes.value === undefined ? {} : { notes: notes.value }),
    }),
  );
}

export function missingReleaseFields(
  specification: DesignSpecification,
): readonly string[] {
  const missing: string[] = [];
  if (!specification.productNameEn) missing.push("productNameEn");
  if (!specification.productNameTh) missing.push("productNameTh");
  if (!specification.fluteCode) missing.push("fluteCode");
  if (!specification.sheetLengthMm) missing.push("sheetLengthMm");
  if (!specification.sheetWidthMm) missing.push("sheetWidthMm");
  if (!specification.layers?.length) missing.push("layers");
  if (!specification.route?.length) missing.push("route");
  if (!specification.materials?.length) missing.push("materials");
  if (!specification.qualityRequirements?.length)
    missing.push("qualityRequirements");
  if (!specification.calculations?.length) missing.push("calculations");
  return Object.freeze(missing);
}

export function designKeyOf(specification: DesignSpecification): string {
  return [
    specification.styleCode,
    `${specification.internalLengthMm}x${specification.internalWidthMm}x${specification.internalHeightMm}`,
    specification.boardGrade,
    `C${specification.printColourCount}`,
  ].join(DESIGN_KEY_SEPARATOR);
}

export const isSameDesign = (
  left: DesignSpecification,
  right: DesignSpecification,
): boolean => designKeyOf(left) === designKeyOf(right);

export type DesignSource = "EXISTING" | "NEW";

export interface DesignDecision {
  readonly source: DesignSource;
  readonly customerProductCode?: string;
  readonly designKey: string;

  readonly masterCardRevisionId?: string;
}

export function decideDesignSource(input: {
  readonly customerProductCode: string;
  readonly specification: DesignSpecification;
  readonly releasedCandidate?:
    | {
        readonly revisionId: string;
        readonly status: string;
        readonly customerProductCode: string;
      }
    | undefined;
}): Result<DesignDecision, DesignSpecificationError> {
  const productCode = normalizeCustomerProductCode(input.customerProductCode);
  if (!productCode.ok) return productCode;
  const designKey = designKeyOf(input.specification);
  const candidate = input.releasedCandidate;
  const candidateCode =
    candidate === undefined
      ? undefined
      : normalizeCustomerProductCode(candidate.customerProductCode);

  if (
    candidate === undefined ||
    candidate.status !== "RELEASED" ||
    candidateCode === undefined ||
    !candidateCode.ok ||
    candidateCode.value !== productCode.value
  ) {
    return ok(
      Object.freeze({
        source: "NEW" as const,
        customerProductCode: productCode.value,
        designKey,
      }),
    );
  }
  return ok(
    Object.freeze({
      source: "EXISTING" as const,
      customerProductCode: productCode.value,
      designKey,
      masterCardRevisionId: candidate.revisionId,
    }),
  );
}

export function designSimilarityScore(
  requested: DesignSpecification,
  candidate: DesignSpecification,
): number {
  const equal = [
    requested.styleCode === candidate.styleCode,
    requested.internalLengthMm === candidate.internalLengthMm,
    requested.internalWidthMm === candidate.internalWidthMm,
    requested.internalHeightMm === candidate.internalHeightMm,
    requested.boardGrade === candidate.boardGrade,
    requested.printColourCount === candidate.printColourCount,
  ].filter(Boolean).length;
  return equal / 6;
}
