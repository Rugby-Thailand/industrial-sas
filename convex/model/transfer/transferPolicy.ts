import { fail, ok, type Result } from "../result";

export const TRANSFER_STATUSES = [
  "DRAFT",
  "APPROVED",
  "DISPATCHING",
  "DISPATCHED",
  "PARTIALLY_RECEIVED",
  "DISCREPANCY",
  "COMPLETE",
  "CANCELLED",
] as const;

export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

export interface TransferQuantities {
  readonly REQUESTED: number;
  readonly DISPATCHED: number;
  readonly RECEIVED: number;
  readonly RETURNED: number;
  readonly DISCREPANCY: number;
  readonly CANCELLED: number;
}

export type TransferPolicyError =
  | { readonly code: "INVALID_QUANTITY"; readonly field: string }
  | { readonly code: "QUANTITY_EXCEEDS_REMAINDER"; readonly field: string }
  | { readonly code: "TRANSFER_QUANTITY_DRIFT" }
  | { readonly code: "ILLEGAL_TRANSFER_STATUS"; readonly status: string };

const positive = (value: number): boolean =>
  Number.isSafeInteger(value) && value > 0;

export function initialTransferQuantities(
  requested: number,
): Result<TransferQuantities, TransferPolicyError> {
  if (!positive(requested)) {
    return fail({ code: "INVALID_QUANTITY", field: "requested" });
  }
  return ok({
    REQUESTED: requested,
    DISPATCHED: 0,
    RECEIVED: 0,
    RETURNED: 0,
    DISCREPANCY: 0,
    CANCELLED: 0,
  });
}

export function dispatchTransferQuantity(
  quantities: TransferQuantities,
  amount: number,
): Result<TransferQuantities, TransferPolicyError> {
  if (!positive(amount)) {
    return fail({ code: "INVALID_QUANTITY", field: "amount" });
  }
  const available =
    quantities.REQUESTED - quantities.DISPATCHED - quantities.CANCELLED;
  if (amount > available) {
    return fail({ code: "QUANTITY_EXCEEDS_REMAINDER", field: "dispatch" });
  }
  return validateTransferConservation({
    ...quantities,
    DISPATCHED: quantities.DISPATCHED + amount,
  });
}

export function receiveTransferQuantity(
  quantities: TransferQuantities,
  input: { readonly received: number; readonly discrepancy: number },
): Result<TransferQuantities, TransferPolicyError> {
  if (
    !Number.isSafeInteger(input.received) ||
    input.received < 0 ||
    !Number.isSafeInteger(input.discrepancy) ||
    input.discrepancy < 0 ||
    input.received + input.discrepancy <= 0
  ) {
    return fail({ code: "INVALID_QUANTITY", field: "receipt" });
  }
  const inTransit =
    quantities.DISPATCHED -
    quantities.RECEIVED -
    quantities.RETURNED -
    quantities.DISCREPANCY;
  if (input.received + input.discrepancy > inTransit) {
    return fail({ code: "QUANTITY_EXCEEDS_REMAINDER", field: "receipt" });
  }
  return validateTransferConservation({
    ...quantities,
    RECEIVED: quantities.RECEIVED + input.received,
    DISCREPANCY: quantities.DISCREPANCY + input.discrepancy,
  });
}

export function returnTransferQuantity(
  quantities: TransferQuantities,
  amount: number,
): Result<TransferQuantities, TransferPolicyError> {
  if (!positive(amount)) {
    return fail({ code: "INVALID_QUANTITY", field: "amount" });
  }
  const inTransit =
    quantities.DISPATCHED -
    quantities.RECEIVED -
    quantities.RETURNED -
    quantities.DISCREPANCY;
  if (amount > inTransit) {
    return fail({ code: "QUANTITY_EXCEEDS_REMAINDER", field: "return" });
  }
  return validateTransferConservation({
    ...quantities,
    RETURNED: quantities.RETURNED + amount,
  });
}

export function resolveTransferDiscrepancyQuantity(
  quantities: TransferQuantities,
  input: {
    readonly amount: number;
    readonly resolution: "RECEIVED" | "RETURNED";
  },
): Result<TransferQuantities, TransferPolicyError> {
  if (!positive(input.amount)) {
    return fail({ code: "INVALID_QUANTITY", field: "amount" });
  }
  if (input.amount > quantities.DISCREPANCY) {
    return fail({
      code: "QUANTITY_EXCEEDS_REMAINDER",
      field: "discrepancy",
    });
  }
  return validateTransferConservation({
    ...quantities,
    DISCREPANCY: quantities.DISCREPANCY - input.amount,
    [input.resolution]: quantities[input.resolution] + input.amount,
  });
}

export function validateTransferConservation(
  quantities: TransferQuantities,
): Result<TransferQuantities, TransferPolicyError> {
  const values = Object.values(quantities);
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    return fail({ code: "TRANSFER_QUANTITY_DRIFT" });
  }
  if (quantities.DISPATCHED + quantities.CANCELLED > quantities.REQUESTED) {
    return fail({ code: "TRANSFER_QUANTITY_DRIFT" });
  }
  if (
    quantities.RECEIVED + quantities.RETURNED + quantities.DISCREPANCY >
    quantities.DISPATCHED
  ) {
    return fail({ code: "TRANSFER_QUANTITY_DRIFT" });
  }
  return ok(Object.freeze({ ...quantities }));
}

export function deriveTransferStatus(
  lines: readonly TransferQuantities[],
): Result<TransferStatus, TransferPolicyError> {
  if (lines.length === 0) {
    return fail({ code: "ILLEGAL_TRANSFER_STATUS", status: "NO_LINES" });
  }
  for (const line of lines) {
    const valid = validateTransferConservation(line);
    if (!valid.ok) return valid;
  }
  const hasDiscrepancy = lines.some((line) => line.DISCREPANCY > 0);
  if (hasDiscrepancy) return ok("DISCREPANCY");
  const complete = lines.every(
    (line) => line.RECEIVED + line.RETURNED + line.CANCELLED === line.REQUESTED,
  );
  if (complete) return ok("COMPLETE");
  if (lines.some((line) => line.RECEIVED > 0 || line.RETURNED > 0)) {
    return ok("PARTIALLY_RECEIVED");
  }
  if (lines.some((line) => line.DISPATCHED > 0)) {
    return ok(
      lines.every((line) => line.DISPATCHED + line.CANCELLED === line.REQUESTED)
        ? "DISPATCHED"
        : "DISPATCHING",
    );
  }
  return ok("APPROVED");
}
