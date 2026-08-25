import { fail, ok, type Result } from "../result";
import type { DesignSpecification } from "./designSpecification";

export const DESIGN_REQUIREMENT_KEYS = [
  "CUSTOMER_PRODUCT_IDENTITY",
  "DIMENSIONS",
  "CONSTRUCTION",
  "PRINT",
  "PACKING",
  "ROUTE",
  "MATERIALS",
  "QUALITY",
] as const;

export type DesignRequirementKey = (typeof DESIGN_REQUIREMENT_KEYS)[number];
export type DesignReadinessStatus = "INCOMPLETE" | "READY";

export type DesignRequirementConfirmations = Readonly<
  Record<DesignRequirementKey, boolean>
>;

export interface DesignReadinessAssessment {
  readonly status: DesignReadinessStatus;
  readonly missing: readonly DesignRequirementKey[];
}

export function assessDesignReadiness(
  specification: DesignSpecification,
  confirmations: DesignRequirementConfirmations,
): DesignReadinessAssessment {
  const structurallyPresent: DesignRequirementConfirmations = {
    CUSTOMER_PRODUCT_IDENTITY: true,
    DIMENSIONS:
      specification.internalLengthMm > 0 &&
      specification.internalWidthMm > 0 &&
      specification.internalHeightMm > 0,
    CONSTRUCTION:
      specification.styleCode.length > 0 && specification.boardGrade.length > 0,
    PRINT:
      specification.printColourCount === 0 ||
      (specification.printColours?.length ?? 0) > 0,
    PACKING:
      (specification.bundleQuantity ?? 0) > 0 ||
      (specification.palletQuantity ?? 0) > 0 ||
      (specification.packingInstructions?.trim().length ?? 0) > 0,
    ROUTE: (specification.route?.length ?? 0) > 0,
    MATERIALS: (specification.materials?.length ?? 0) > 0,
    QUALITY: (specification.qualityRequirements?.length ?? 0) > 0,
  };
  const missing = DESIGN_REQUIREMENT_KEYS.filter(
    (key) => !confirmations[key] || !structurallyPresent[key],
  );
  return Object.freeze({
    status: missing.length === 0 ? "READY" : "INCOMPLETE",
    missing: Object.freeze(missing),
  });
}

export type DesignChangeSeverity = "NO_IMPACT" | "REVIEW_REQUIRED" | "BLOCKING";

export interface DesignChangeSummary {
  readonly severity: DesignChangeSeverity;
  readonly changedFields: readonly string[];
  readonly categories: readonly DesignRequirementKey[];
}

const FIELD_CATEGORY: Readonly<
  Record<keyof DesignSpecification, DesignRequirementKey>
> = {
  styleCode: "CONSTRUCTION",
  internalLengthMm: "DIMENSIONS",
  internalWidthMm: "DIMENSIONS",
  internalHeightMm: "DIMENSIONS",
  boardGrade: "CONSTRUCTION",
  printColourCount: "PRINT",
  productNameEn: "CUSTOMER_PRODUCT_IDENTITY",
  productNameTh: "CUSTOMER_PRODUCT_IDENTITY",
  sheetLengthMm: "CONSTRUCTION",
  sheetWidthMm: "CONSTRUCTION",
  lengthToleranceMm: "DIMENSIONS",
  widthToleranceMm: "DIMENSIONS",
  heightToleranceMm: "DIMENSIONS",
  fluteCode: "CONSTRUCTION",
  layers: "CONSTRUCTION",
  printMethod: "PRINT",
  printColours: "PRINT",
  finishing: "CONSTRUCTION",
  bundleQuantity: "PACKING",
  palletQuantity: "PACKING",
  packingInstructions: "PACKING",
  route: "ROUTE",
  materials: "MATERIALS",
  qualityRequirements: "QUALITY",
  calculations: "QUALITY",
  notes: "CUSTOMER_PRODUCT_IDENTITY",
};

const BLOCKING_CATEGORIES = new Set<DesignRequirementKey>([
  "DIMENSIONS",
  "CONSTRUCTION",
  "ROUTE",
  "MATERIALS",
  "QUALITY",
]);

export function summarizeDesignChange(
  before: DesignSpecification,
  after: DesignSpecification,
): DesignChangeSummary {
  const changedFields = (
    Object.keys(FIELD_CATEGORY) as (keyof DesignSpecification)[]
  )
    .filter(
      (field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]),
    )
    .sort();
  const categories = DESIGN_REQUIREMENT_KEYS.filter((category) =>
    changedFields.some((field) => FIELD_CATEGORY[field] === category),
  );
  const severity: DesignChangeSeverity =
    changedFields.length === 0
      ? "NO_IMPACT"
      : categories.some((category) => BLOCKING_CATEGORIES.has(category))
        ? "BLOCKING"
        : "REVIEW_REQUIRED";
  return Object.freeze({
    severity,
    changedFields: Object.freeze(changedFields),
    categories: Object.freeze(categories),
  });
}

export type DesignReadinessError = {
  readonly code: "PRECONDITION_FAILED";
  readonly field: "requirements";
  readonly reason: "REQUIREMENTS_INCOMPLETE";
};

export function requireDesignReady(
  status: DesignReadinessStatus | undefined,
): Result<true, DesignReadinessError> {
  if (status === undefined || status === "READY") return ok(true);
  return fail({
    code: "PRECONDITION_FAILED",
    field: "requirements",
    reason: "REQUIREMENTS_INCOMPLETE",
  });
}
