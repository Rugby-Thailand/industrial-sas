import { fail, ok, type Result } from "../result";

export const PRODUCTION_ORDER_STATUSES = [
  "DRAFT",
  "RELEASED",
  "IN_PROGRESS",
  "QC_PENDING",
  "COMPLETE",
  "CLOSED_REJECTED",
  "CANCELLED",
] as const;

export type ProductionOrderStatus = (typeof PRODUCTION_ORDER_STATUSES)[number];

export interface ProductionQuantities {
  readonly target: number;
  readonly good: number;
  readonly scrap: number;
  readonly rework: number;
  readonly received: number;
  readonly qcReleased: number;
  readonly qcRejected: number;
}

export type ProductionPolicyError =
  | { readonly code: "INVALID_QUANTITY"; readonly field: string }
  | { readonly code: "QUANTITY_EXCEEDS_REMAINDER"; readonly field: string }
  | { readonly code: "PRODUCTION_QUANTITY_DRIFT" }
  | { readonly code: "NO_OUTPUT_TO_INSPECT" }
  | { readonly code: "OUTPUT_NOT_FULLY_DECIDED" };

const nonNegative = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0;
const positive = (value: number): boolean => nonNegative(value) && value > 0;

export function initialProductionQuantities(
  target: number,
): Result<ProductionQuantities, ProductionPolicyError> {
  if (!positive(target)) {
    return fail({ code: "INVALID_QUANTITY", field: "target" });
  }
  return ok({
    target,
    good: 0,
    scrap: 0,
    rework: 0,
    received: 0,
    qcReleased: 0,
    qcRejected: 0,
  });
}

export function reportProductionOutput(
  quantities: ProductionQuantities,
  report: {
    readonly good: number;
    readonly scrap: number;
    readonly rework: number;
  },
): Result<ProductionQuantities, ProductionPolicyError> {
  if (
    !nonNegative(report.good) ||
    !nonNegative(report.scrap) ||
    !nonNegative(report.rework) ||
    report.good + report.scrap + report.rework <= 0
  ) {
    return fail({ code: "INVALID_QUANTITY", field: "report" });
  }
  if (
    quantities.good +
      quantities.scrap +
      quantities.rework +
      report.good +
      report.scrap +
      report.rework >
    quantities.target
  ) {
    return fail({ code: "QUANTITY_EXCEEDS_REMAINDER", field: "report" });
  }
  return validateProductionQuantities({
    ...quantities,
    good: quantities.good + report.good,
    scrap: quantities.scrap + report.scrap,
    rework: quantities.rework + report.rework,
  });
}

export function receiveProductionOutput(
  quantities: ProductionQuantities,
  amount: number,
): Result<ProductionQuantities, ProductionPolicyError> {
  if (!positive(amount)) {
    return fail({ code: "INVALID_QUANTITY", field: "amount" });
  }
  if (quantities.received + amount > quantities.good) {
    return fail({
      code: "QUANTITY_EXCEEDS_REMAINDER",
      field: "received",
    });
  }
  return validateProductionQuantities({
    ...quantities,
    received: quantities.received + amount,
  });
}

export function decideProductionQuality(
  quantities: ProductionQuantities,
  decision: "RELEASE" | "REJECT",
  amount: number,
): Result<ProductionQuantities, ProductionPolicyError> {
  if (!positive(amount)) {
    return fail({ code: "INVALID_QUANTITY", field: "amount" });
  }
  if (quantities.received === 0) {
    return fail({ code: "NO_OUTPUT_TO_INSPECT" });
  }
  const pending =
    quantities.received - quantities.qcReleased - quantities.qcRejected;
  if (amount > pending) {
    return fail({ code: "QUANTITY_EXCEEDS_REMAINDER", field: "quality" });
  }
  return validateProductionQuantities({
    ...quantities,
    qcReleased: quantities.qcReleased + (decision === "RELEASE" ? amount : 0),
    qcRejected: quantities.qcRejected + (decision === "REJECT" ? amount : 0),
  });
}

export function validateProductionQuantities(
  quantities: ProductionQuantities,
): Result<ProductionQuantities, ProductionPolicyError> {
  if (Object.values(quantities).some((value) => !nonNegative(value))) {
    return fail({ code: "PRODUCTION_QUANTITY_DRIFT" });
  }
  if (
    quantities.good + quantities.scrap + quantities.rework >
      quantities.target ||
    quantities.received > quantities.good ||
    quantities.qcReleased + quantities.qcRejected > quantities.received
  ) {
    return fail({ code: "PRODUCTION_QUANTITY_DRIFT" });
  }
  return ok(Object.freeze({ ...quantities }));
}

export function deriveProductionStatus(
  quantities: ProductionQuantities,
): Result<ProductionOrderStatus, ProductionPolicyError> {
  const valid = validateProductionQuantities(quantities);
  if (!valid.ok) return valid;
  if (quantities.qcReleased + quantities.qcRejected === quantities.received) {
    if (quantities.received === 0) {
      return quantities.good + quantities.scrap + quantities.rework > 0
        ? ok("IN_PROGRESS")
        : ok("RELEASED");
    }
    const runAccounted =
      quantities.good + quantities.scrap + quantities.rework ===
      quantities.target;
    if (!runAccounted || quantities.received !== quantities.good) {
      return fail({ code: "OUTPUT_NOT_FULLY_DECIDED" });
    }
    return ok(quantities.qcReleased > 0 ? "COMPLETE" : "CLOSED_REJECTED");
  }
  if (quantities.received > 0) return ok("QC_PENDING");
  if (quantities.good + quantities.scrap + quantities.rework > 0) {
    return ok("IN_PROGRESS");
  }
  return ok("RELEASED");
}

export function issueMaterialQuantity(
  required: number,
  issued: number,
  amount: number,
): Result<number, ProductionPolicyError> {
  if (!positive(required) || !nonNegative(issued) || !positive(amount)) {
    return fail({ code: "INVALID_QUANTITY", field: "material" });
  }
  if (issued + amount > required) {
    return fail({ code: "QUANTITY_EXCEEDS_REMAINDER", field: "material" });
  }
  return ok(issued + amount);
}
