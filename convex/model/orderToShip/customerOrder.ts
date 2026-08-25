import { fail, ok, type Result } from "../result";
import type { DesignDecision } from "./designSpecification";

export type CustomerOrderStatus = "DRAFT" | "RELEASED" | "CANCELLED";

export type CustomerOrderLineStatus =
  "AWAITING_DESIGN" | "DESIGN_READY" | "HANDED_OFF" | "CANCELLED";

export const CUSTOMER_ORDER_STATUSES: readonly CustomerOrderStatus[] =
  Object.freeze(["DRAFT", "RELEASED", "CANCELLED"] as const);

export const CUSTOMER_ORDER_LINE_STATUSES: readonly CustomerOrderLineStatus[] =
  Object.freeze([
    "AWAITING_DESIGN",
    "DESIGN_READY",
    "HANDED_OFF",
    "CANCELLED",
  ] as const);

export type CustomerOrderError =
  | {
      readonly code: "ILLEGAL_TRANSITION";
      readonly field: string;
      readonly reason: string;
      readonly status: string;
    }
  /** The operation is legal for the status but not for the document's contents. */
  | {
      readonly code: "PRECONDITION_FAILED";
      readonly field: string;
      readonly reason: string;
    }
  /** A submitted value was not usable. */
  | {
      readonly code: "FIELD_INVALID";
      readonly field: string;
      readonly reason: string;
    };

export const MAX_ORDER_QUANTITY = 10_000_000;

export function checkOrderedQuantity(
  quantity: number,
): Result<number, CustomerOrderError> {
  if (typeof quantity !== "number" || !Number.isFinite(quantity)) {
    return fail({
      code: "FIELD_INVALID",
      field: "orderedQuantity",
      reason: "NOT_A_NUMBER",
    });
  }
  if (!Number.isInteger(quantity)) {
    return fail({
      code: "FIELD_INVALID",
      field: "orderedQuantity",
      reason: "NOT_A_WHOLE_NUMBER",
    });
  }
  if (quantity <= 0) {
    return fail({
      code: "FIELD_INVALID",
      field: "orderedQuantity",
      reason: "NOT_POSITIVE",
    });
  }
  if (quantity > MAX_ORDER_QUANTITY) {
    return fail({
      code: "FIELD_INVALID",
      field: "orderedQuantity",
      reason: "TOO_LARGE",
    });
  }
  return ok(quantity);
}

export interface CustomerOrderState {
  readonly status: CustomerOrderStatus;
}

export interface CustomerOrderLineState {
  readonly status: CustomerOrderLineStatus;
  readonly masterCardRevisionId?: string | undefined;
}

export function checkOrderRelease(
  order: CustomerOrderState,
  lines: readonly CustomerOrderLineState[],
): Result<CustomerOrderStatus, CustomerOrderError> {
  if (order.status !== "DRAFT") {
    return fail({
      code: "ILLEGAL_TRANSITION",
      field: "status",
      reason: "NOT_DRAFT",
      status: order.status,
    });
  }
  const live = lines.filter((line) => line.status !== "CANCELLED");
  if (live.length === 0) {
    return fail({
      code: "PRECONDITION_FAILED",
      field: "lines",
      reason: "NO_LIVE_LINES",
    });
  }
  return ok("RELEASED");
}

export function checkOrderCancellation(
  order: CustomerOrderState,
  lines: readonly CustomerOrderLineState[],
): Result<CustomerOrderStatus, CustomerOrderError> {
  if (order.status === "CANCELLED") {
    return fail({
      code: "ILLEGAL_TRANSITION",
      field: "status",
      reason: "ALREADY_CANCELLED",
      status: order.status,
    });
  }
  if (lines.some((line) => line.status === "HANDED_OFF")) {
    return fail({
      code: "PRECONDITION_FAILED",
      field: "lines",
      reason: "LINE_HANDED_OFF",
    });
  }
  return ok("CANCELLED");
}

export function checkLineAddition(
  order: CustomerOrderState,
): Result<true, CustomerOrderError> {
  if (order.status !== "DRAFT") {
    return fail({
      code: "ILLEGAL_TRANSITION",
      field: "status",
      reason: "ORDER_NOT_DRAFT",
      status: order.status,
    });
  }
  return ok(true);
}

export const initialLineStatus = (
  decision: DesignDecision,
): CustomerOrderLineStatus =>
  decision.source === "EXISTING" ? "DESIGN_READY" : "AWAITING_DESIGN";

export function checkDesignFulfilment(
  line: CustomerOrderLineState,
  revision: { readonly status: string },
): Result<CustomerOrderLineStatus, CustomerOrderError> {
  if (line.status !== "AWAITING_DESIGN") {
    return fail({
      code: "ILLEGAL_TRANSITION",
      field: "status",
      reason: "NOT_AWAITING_DESIGN",
      status: line.status,
    });
  }
  if (revision.status !== "RELEASED") {
    return fail({
      code: "PRECONDITION_FAILED",
      field: "masterCardRevisionId",
      reason: "REVISION_NOT_RELEASED",
    });
  }
  return ok("DESIGN_READY");
}

export function checkLineHandoff(
  order: CustomerOrderState,
  line: CustomerOrderLineState,
): Result<CustomerOrderLineStatus, CustomerOrderError> {
  if (order.status !== "RELEASED") {
    return fail({
      code: "ILLEGAL_TRANSITION",
      field: "status",
      reason: "ORDER_NOT_RELEASED",
      status: order.status,
    });
  }
  if (line.status !== "DESIGN_READY") {
    return fail({
      code: "ILLEGAL_TRANSITION",
      field: "status",
      reason: "LINE_NOT_DESIGN_READY",
      status: line.status,
    });
  }
  if (
    line.masterCardRevisionId === undefined ||
    line.masterCardRevisionId.length === 0
  ) {
    return fail({
      code: "PRECONDITION_FAILED",
      field: "masterCardRevisionId",
      reason: "NOT_PINNED",
    });
  }
  return ok("HANDED_OFF");
}

export function checkLineCancellation(
  line: CustomerOrderLineState,
): Result<CustomerOrderLineStatus, CustomerOrderError> {
  if (line.status === "CANCELLED") {
    return fail({
      code: "ILLEGAL_TRANSITION",
      field: "status",
      reason: "ALREADY_CANCELLED",
      status: line.status,
    });
  }
  if (line.status === "HANDED_OFF") {
    return fail({
      code: "ILLEGAL_TRANSITION",
      field: "status",
      reason: "LINE_HANDED_OFF",
      status: line.status,
    });
  }
  return ok("CANCELLED");
}
