import { isSafeInt } from "../guards";
import { fail, ok, type Result } from "../result";

export type PickTaskStatus =
  | "AVAILABLE"
  | "IN_PROGRESS"
  | "PICKED"
  | "CHECKED"
  | "PACKED"
  | "STAGED"
  | "ISSUED"
  | "CANCELLED";

export type PickExceptionKind = "SHORT" | "DAMAGED";

export interface PickLineState {
  readonly plannedBaseMinorUnits: number;
  readonly pickedBaseMinorUnits: number;
  readonly shortBaseMinorUnits: number;
  readonly damagedBaseMinorUnits: number;
}

export type PickingError =
  | {
      readonly code: "INVALID_QUANTITY";
      readonly field: string;
      readonly value: number;
    }
  | {
      readonly code: "PICK_QUANTITY_EXCEEDED";
      readonly remainingBaseMinorUnits: number;
      readonly requestedBaseMinorUnits: number;
    }
  | {
      readonly code: "PICK_LINE_INCOMPLETE";
      readonly remainingBaseMinorUnits: number;
    }
  | {
      readonly code: "REASON_REQUIRED";
      readonly kind: PickExceptionKind;
    }
  | {
      readonly code: "ILLEGAL_TRANSITION";
      readonly status: PickTaskStatus;
      readonly action: string;
    }
  | { readonly code: "CHECKER_IS_PICKER" }
  | { readonly code: "SCAN_MISMATCH"; readonly field: string };

const positive = (value: number) => isSafeInt(value) && value > 0;
const nonNegative = (value: number) => isSafeInt(value) && value >= 0;

export function makePickLine(
  plannedBaseMinorUnits: number,
): Result<PickLineState, PickingError> {
  if (!positive(plannedBaseMinorUnits)) {
    return fail({
      code: "INVALID_QUANTITY",
      field: "plannedBaseMinorUnits",
      value: plannedBaseMinorUnits,
    });
  }
  return ok(
    Object.freeze({
      plannedBaseMinorUnits,
      pickedBaseMinorUnits: 0,
      shortBaseMinorUnits: 0,
      damagedBaseMinorUnits: 0,
    }),
  );
}

export const accountedPickQuantity = (line: PickLineState): number =>
  line.pickedBaseMinorUnits +
  line.shortBaseMinorUnits +
  line.damagedBaseMinorUnits;

export const remainingPickQuantity = (line: PickLineState): number =>
  line.plannedBaseMinorUnits - accountedPickQuantity(line);

function validateLine(line: PickLineState): Result<true, PickingError> {
  const quantities = [
    ["plannedBaseMinorUnits", line.plannedBaseMinorUnits],
    ["pickedBaseMinorUnits", line.pickedBaseMinorUnits],
    ["shortBaseMinorUnits", line.shortBaseMinorUnits],
    ["damagedBaseMinorUnits", line.damagedBaseMinorUnits],
  ] as const;
  for (const [field, value] of quantities) {
    if (!nonNegative(value)) {
      return fail({ code: "INVALID_QUANTITY", field, value });
    }
  }
  const remaining = remainingPickQuantity(line);
  if (remaining < 0) {
    return fail({
      code: "PICK_QUANTITY_EXCEEDED",
      remainingBaseMinorUnits: 0,
      requestedBaseMinorUnits: -remaining,
    });
  }
  return ok(true);
}

function addToLine(
  line: PickLineState,
  field:
    "pickedBaseMinorUnits" | "shortBaseMinorUnits" | "damagedBaseMinorUnits",
  baseMinorUnits: number,
): Result<PickLineState, PickingError> {
  const valid = validateLine(line);
  if (!valid.ok) return valid;
  if (!positive(baseMinorUnits)) {
    return fail({
      code: "INVALID_QUANTITY",
      field: "baseMinorUnits",
      value: baseMinorUnits,
    });
  }
  const remaining = remainingPickQuantity(line);
  if (baseMinorUnits > remaining) {
    return fail({
      code: "PICK_QUANTITY_EXCEEDED",
      remainingBaseMinorUnits: remaining,
      requestedBaseMinorUnits: baseMinorUnits,
    });
  }
  return ok(Object.freeze({ ...line, [field]: line[field] + baseMinorUnits }));
}

export function recordPickedQuantity(
  line: PickLineState,
  baseMinorUnits: number,
): Result<PickLineState, PickingError> {
  return addToLine(line, "pickedBaseMinorUnits", baseMinorUnits);
}

export function recordPickException(
  line: PickLineState,
  input: {
    readonly kind: PickExceptionKind;
    readonly baseMinorUnits: number;
    readonly reason: string;
  },
): Result<PickLineState, PickingError> {
  if (input.reason.trim().length === 0) {
    return fail({ code: "REASON_REQUIRED", kind: input.kind });
  }
  return addToLine(
    line,
    input.kind === "SHORT" ? "shortBaseMinorUnits" : "damagedBaseMinorUnits",
    input.baseMinorUnits,
  );
}

export function checkPickLineComplete(
  line: PickLineState,
): Result<true, PickingError> {
  const valid = validateLine(line);
  if (!valid.ok) return valid;
  const remaining = remainingPickQuantity(line);
  return remaining === 0
    ? ok(true)
    : fail({
        code: "PICK_LINE_INCOMPLETE",
        remainingBaseMinorUnits: remaining,
      });
}

export function checkPickScan(
  expected: {
    readonly itemId: string;
    readonly locationId: string;
    readonly lotId?: string;
  },
  scanned: {
    readonly itemId: string;
    readonly locationId: string;
    readonly lotId?: string;
  },
): Result<true, PickingError> {
  if (expected.locationId !== scanned.locationId) {
    return fail({ code: "SCAN_MISMATCH", field: "locationId" });
  }
  if (expected.itemId !== scanned.itemId) {
    return fail({ code: "SCAN_MISMATCH", field: "itemId" });
  }
  if (expected.lotId !== scanned.lotId) {
    return fail({ code: "SCAN_MISMATCH", field: "lotId" });
  }
  return ok(true);
}

export function startPickTask(
  status: PickTaskStatus,
): Result<PickTaskStatus, PickingError> {
  return status === "AVAILABLE"
    ? ok("IN_PROGRESS")
    : fail({ code: "ILLEGAL_TRANSITION", status, action: "START" });
}

export function submitPickedTask(
  status: PickTaskStatus,
  lines: readonly PickLineState[],
): Result<PickTaskStatus, PickingError> {
  if (status !== "IN_PROGRESS") {
    return fail({ code: "ILLEGAL_TRANSITION", status, action: "SUBMIT" });
  }
  for (const line of lines) {
    const complete = checkPickLineComplete(line);
    if (!complete.ok) return complete;
  }
  return ok("PICKED");
}

export function checkPickedTask(input: {
  readonly status: PickTaskStatus;
  readonly pickerUserId: string;
  readonly checkerUserId: string;
}): Result<PickTaskStatus, PickingError> {
  if (input.status !== "PICKED") {
    return fail({
      code: "ILLEGAL_TRANSITION",
      status: input.status,
      action: "CHECK",
    });
  }
  if (input.pickerUserId === input.checkerUserId) {
    return fail({ code: "CHECKER_IS_PICKER" });
  }
  return ok("CHECKED");
}

export function packCheckedTask(
  status: PickTaskStatus,
): Result<PickTaskStatus, PickingError> {
  return status === "CHECKED"
    ? ok("PACKED")
    : fail({ code: "ILLEGAL_TRANSITION", status, action: "PACK" });
}

export function stagePackedTask(
  status: PickTaskStatus,
): Result<PickTaskStatus, PickingError> {
  return status === "PACKED"
    ? ok("STAGED")
    : fail({ code: "ILLEGAL_TRANSITION", status, action: "STAGE" });
}
