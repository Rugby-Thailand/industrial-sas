/**
 * What a customer is actually ordering, plus an advisory structural fingerprint.
 *
 * Status: **implemented.** Pure; no clock, no database, no Convex import
 * (plan §6.2).
 *
 * Automatic reuse is customer + normalized customer product code. `designKeyOf`
 * is deliberately separate: it fingerprints structure so the UI can rank
 * possible near-matches for a person, never so the server can auto-pin one.
 *
 * ### Exact matching only, and the refusal to approximate
 *
 * `WF-04` asks whether near-matches should be suggested. It is open, and nothing
 * here guesses: a 305 mm box does not match a 300 mm box, and a module that
 * decided it "probably" did would put a wrong dieline on a factory floor. When
 * the decision lands, similarity belongs in a *separate* function that ranks
 * candidates for a human — never in the key.
 *
 * ### Why dimensions are whole millimetres
 *
 * The dimension a converting machine is set to is a whole millimetre; a
 * specification carrying `300.5` would be a number nobody can set a machine to
 * and a number that makes two keys differ for a difference nobody can cut. A
 * fractional dimension is refused by name rather than rounded, because rounding
 * an internal dimension is how a box ends up too small for what goes in it.
 *
 * ### What is deliberately *not* here
 *
 * Blank size, board consumption, and any other computed geometry. `WF-11` says
 * the calculation formulas must be confirmed with Engineering and QA before they
 * are coded, and a formula invented here would be an authoritative-looking
 * number with no author. The specification records what was *asked for*; it does
 * not compute what it would take to make.
 */
import { fail, ok, type Result } from "../result";

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

export type DesignSpecificationError =
  /** A text field was empty, over-long, or carried a character the key reserves. */
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

/* -------------------------------------------------------------------------- */
/* Bounds                                                                      */
/* -------------------------------------------------------------------------- */

/** The longest a style code or board grade may be. Matches `MAX_CODE_LENGTH`. */
export const MAX_DESIGN_CODE_LENGTH = 64;

/**
 * The largest internal dimension a line may state, in millimetres.
 *
 * Ten metres. Not a converting limit — this repository knows none — but a bound
 * that keeps a mistyped `3000000` out of the database while leaving every real
 * carton, crate, and sheet comfortably inside.
 */
export const MAX_DIMENSION_MM = 10_000;

/** The most print colours a specification may state. */
export const MAX_PRINT_COLOURS = 12;

/** Bounds for human-authored detail that is stored on every immutable revision. */
export const MAX_SPEC_TEXT_LENGTH = 2_000;
export const MAX_FINISHING_ROWS = 50;

/**
 * The separator between key segments.
 *
 * Reserved: a style code or board grade containing it is refused rather than
 * escaped, because two specifications whose segments merely *concatenate* the
 * same way are not the same specification, and an escaping scheme is one more
 * thing that has to agree on both sides of a comparison forever.
 */
export const DESIGN_KEY_SEPARATOR = "|";

/** Customer-owned product codes are the authoritative exact-match identity. */
export const MAX_CUSTOMER_PRODUCT_CODE_LENGTH = 96;

/* -------------------------------------------------------------------------- */
/* The specification                                                           */
/* -------------------------------------------------------------------------- */

/**
 * One packaging specification, normalized.
 *
 * `styleCode` and `boardGrade` are the tenant's own vocabulary — `RSC`, `HSC`,
 * `KA125/C/KA125` — deliberately not a closed union. This repository does not own
 * the catalogue of box styles or board grades any Thai converter uses, and a
 * closed union would be a claim it does.
 */
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

/** The raw shape a caller submits, before any of it is trusted. */
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

/**
 * Normalize one code-like field: trimmed, upper-cased, bounded, separator-free.
 *
 * Upper-cased for the same reason a SKU is: `rsc` and `RSC` are one style, and a
 * key that distinguished them would make the factory re-engineer a box over a
 * shift key. Internal whitespace is collapsed rather than rejected, because
 * `KA125 / C / KA125` and `KA125/C/KA125` are one grade written by two people.
 */
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

/**
 * Normalize the customer's own product code without deriving identity from
 * geometry. Customer + this value is the only automatic-reuse key.
 */
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

/** A whole-number measurement in an inclusive range, or a named refusal. */
function requireWholeNumber(
  field: string,
  value: number,
  bounds: { readonly min: number; readonly max: number },
): Result<number, DesignSpecificationError> {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fail({ code: "MEASUREMENT_INVALID", field, reason: "NOT_A_NUMBER" });
  }
  if (!Number.isInteger(value)) {
    /*
     * Refused, never rounded. A machine is set to a whole millimetre, and
     * rounding an *internal* dimension down is how a box ends up too small for
     * what the customer puts in it.
     */
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

/**
 * Build a specification, or refuse it by naming the field at fault.
 *
 * Every refusal names a field and never the value that failed, which is the same
 * rule the write envelope enforces at the boundary (`INV-0002-07`): the caller
 * sent the value and can already see it.
 */
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

  /*
   * Zero is legal and one is not a default: a plain brown box with no print is
   * the ordinary case, and defaulting it to one colour would put an ink setup on
   * a job that has none.
   */
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

/** Fields required before a revision may leave draft. */
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

/* -------------------------------------------------------------------------- */
/* The key                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The structural fingerprint for one specification.
 *
 * Total over `DesignSpecification`, which is the point of taking the *validated*
 * type rather than the input: every field is already normalized, so the key is a
 * pure function of the value and two equal specifications cannot produce two
 * keys. Dimensions are ordered L, W, H and never sorted — a 300×200×150 box and a
 * 200×300×150 box have different dielines, and sorting would silently declare
 * them one design.
 */
export function designKeyOf(specification: DesignSpecification): string {
  return [
    specification.styleCode,
    `${specification.internalLengthMm}x${specification.internalWidthMm}x${specification.internalHeightMm}`,
    specification.boardGrade,
    `C${specification.printColourCount}`,
  ].join(DESIGN_KEY_SEPARATOR);
}

/**
 * Whether two specifications have the same core structure.
 *
 * This is suitable for similarity hints only. Exact automatic reuse is decided
 * by customer plus normalized customer product code in `decideDesignSource`.
 */
export const isSameDesign = (
  left: DesignSpecification,
  right: DesignSpecification,
): boolean => designKeyOf(left) === designKeyOf(right);

/* -------------------------------------------------------------------------- */
/* The decision                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Where a line's design comes from.
 *
 * `EXISTING` means a released master-card revision was found for this exact key;
 * `NEW` means none was, and engineering has to draw one. There is no third value
 * for "close enough" (`WF-04`).
 */
export type DesignSource = "EXISTING" | "NEW";

export interface DesignDecision {
  readonly source: DesignSource;
  readonly customerProductCode?: string;
  readonly designKey: string;
  /** The released revision this line pins. Present exactly when `EXISTING`. */
  readonly masterCardRevisionId?: string;
}

/**
 * Decide where a line's design comes from, given whatever the exact-key lookup
 * found.
 *
 * A candidate is only usable if it is `RELEASED`. A draft or in-review revision
 * describes a design nobody has approved, and pinning one would let a factory
 * cut to a spec that is still being argued about — which is the same failure
 * `RELEASED`-only visibility exists to prevent (operating plan §5.2).
 *
 * A `REJECTED` or `SUPERSEDED` candidate is treated as absent rather than as an
 * error: the master card exists, this revision is simply not the one to build
 * from, and the honest consequence is a new design request.
 */
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

/**
 * Rank a possible visual/structural near-match for a person to confirm. This
 * value never enters `decideDesignSource`, so similarity cannot auto-pin work.
 */
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
