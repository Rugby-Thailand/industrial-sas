/**
 * The lifecycle of a customer order and its lines.
 *
 * Status: **implemented.** Pure; no clock, no database, no Convex import
 * (plan §6.2).
 *
 * ### Why this is not a supplier purchase order
 *
 * `purchaseOrders` in this repository is what the tenant sends *to a supplier*
 * so goods arrive at a dock (`convex/purchasing/orders.ts`). A customer order is
 * what a customer sends *to the tenant* so a box gets made. They share the words
 * "order", "line", and "quantity" and nothing else: different counterparty,
 * opposite direction of goods, different lifecycle, different permissions. Reusing
 * the supplier table would make every receiving query silently include sales
 * demand, so the two never meet — a rule the domain glossary states and this
 * module's existence enforces.
 *
 * ### Why a line's status is derived, not chosen
 *
 * A salesperson does not get to declare that a line's design is ready. The line
 * starts in the status its *design decision* implies — pinned to a released
 * revision, or waiting on engineering — because the alternative is a line marked
 * ready with nothing released behind it, which is a factory packet with no
 * dieline (operating plan §5.1).
 *
 * ### Why release does not wait for design
 *
 * An order is released when the tenant commits to it commercially; engineering
 * may still be drawing. Blocking release on design would mean the customer is
 * told "not yet accepted" for work the tenant has in fact accepted. What *is*
 * blocked is the next step: a line cannot be handed to a factory until it has a
 * released revision pinned to it.
 */
import { fail, ok, type Result } from "../result";
import type { DesignDecision } from "./designSpecification";

/* -------------------------------------------------------------------------- */
/* Statuses                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * `DRAFT` — being written by sales, not yet committed.
 * `RELEASED` — committed to the customer; lines may be handed to a factory.
 * `CANCELLED` — terminal; nothing further happens to it.
 */
export type CustomerOrderStatus = "DRAFT" | "RELEASED" | "CANCELLED";

/**
 * `AWAITING_DESIGN` — no released revision matches; engineering has to draw one.
 * `DESIGN_READY` — a released master-card revision is pinned to this line.
 * `HANDED_OFF` — a factory packet has been issued for it.
 * `CANCELLED` — terminal.
 */
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

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

export type CustomerOrderError =
  /** The document is not in a status this operation can act on. */
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

/* -------------------------------------------------------------------------- */
/* Quantities                                                                  */
/* -------------------------------------------------------------------------- */

/** The largest quantity one order line may state. */
export const MAX_ORDER_QUANTITY = 10_000_000;

/**
 * Validate an ordered quantity.
 *
 * Whole pieces only. A customer orders 5 000 boxes, never 5 000.4, and a
 * fractional demand quantity would flow into a factory packet that has to be an
 * integer anyway — better to refuse it where the number is entered.
 */
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
    /*
     * Zero is refused rather than stored: a line for no boxes is not an order,
     * it is a line somebody forgot to delete, and it would sit in every
     * outstanding-demand view forever.
     */
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

/* -------------------------------------------------------------------------- */
/* Order transitions                                                           */
/* -------------------------------------------------------------------------- */

/** The shape of an order this module needs to decide anything about it. */
export interface CustomerOrderState {
  readonly status: CustomerOrderStatus;
}

/** The shape of a line this module needs to decide anything about it. */
export interface CustomerOrderLineState {
  readonly status: CustomerOrderLineStatus;
  readonly masterCardRevisionId?: string | undefined;
}

/**
 * Whether an order may be released, given every line it currently holds.
 *
 * Requires at least one line that is not cancelled. An order with no live lines
 * commits the tenant to making nothing, and releasing it would put an empty
 * commitment in front of production planning.
 */
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

/**
 * Whether an order may be cancelled, given every line it currently holds.
 *
 * A handed-off line means a factory already holds a packet for it. Cancelling
 * the order out from under that packet would leave the shop floor building
 * against a commitment the system says no longer exists, so the packet has to be
 * cancelled first and the refusal says which field to look at.
 */
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

/**
 * Whether a line may be added to an order.
 *
 * Only to a draft. Adding to a released order would change what the tenant
 * committed to without any record that the commitment changed; the honest way to
 * add work to a released order is another order.
 */
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

/* -------------------------------------------------------------------------- */
/* Line transitions                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The status a new line starts in, derived from its design decision.
 *
 * `EXISTING` means the exact-match lookup found a released revision, so the line
 * is ready the moment it is created. `NEW` means it is not, and saying so is the
 * whole point: an `AWAITING_DESIGN` line is what puts a design request in front
 * of engineering.
 */
export const initialLineStatus = (
  decision: DesignDecision,
): CustomerOrderLineStatus =>
  decision.source === "EXISTING" ? "DESIGN_READY" : "AWAITING_DESIGN";

/**
 * Whether a line may be marked design-ready by pinning a released revision.
 *
 * Only from `AWAITING_DESIGN`. A `DESIGN_READY` line already has a revision
 * pinned, and re-pinning it would silently change what a packet is about to be
 * cut from; a `HANDED_OFF` line has already been sent, and changing its design
 * after the fact is exactly the failure revision immutability exists to prevent.
 */
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

/**
 * Whether a line may be handed to a factory.
 *
 * Both conditions are checked, not one: the order must be released *and* the
 * line must carry a pinned released revision. A ready line on a draft order is
 * work nobody has committed to; a released order with an unpinned line is a
 * packet with no dieline.
 */
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

/**
 * Whether a line may be cancelled on its own.
 *
 * Same reasoning as order cancellation: once a packet exists, the packet is the
 * thing to cancel.
 */
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
