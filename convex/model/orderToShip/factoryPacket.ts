/**
 * The factory packet: the one document that crosses from the office to the shop
 * floor, and the pin that makes it mean one exact thing.
 *
 * Status: **implemented.** Pure; no clock, no database, no Convex import
 * (plan §6.2).
 *
 * ### Why the packet carries a copy, not a reference
 *
 * A packet pins one released revision *by id* and also carries that revision's
 * specification *by value*. The id is the audit answer to "which revision was
 * this cut from"; the copy is the operational answer to "what does this packet
 * say", and it keeps saying the same thing no matter what happens to the master
 * card afterwards. A released revision is immutable, so the two can never
 * disagree — the snapshot is belt and braces, and it is also what lets a
 * production reader see a specification without being granted read access to
 * engineering's revision table at all.
 *
 * ### Why an unreleased revision can never be pinned
 *
 * The single most expensive mistake in this flow is a factory cutting to a spec
 * nobody approved. `checkPacketIssue` refuses any revision that is not
 * `RELEASED`, and refuses it before it looks at anything else.
 *
 * ### Why quantity is derived rather than typed
 *
 * The packet is for the line, whole. A separately entered quantity is a number
 * that can differ from the line it claims to satisfy, and the difference would
 * only be noticed when the customer counted the delivery. Partial and split
 * production runs are a factory-order concern (`WF-02`, Phase 5B), not a packet
 * concern, and are deliberately absent here rather than half-built.
 */
import { fail, ok, type Result } from "../result";
import type { DesignSpecification } from "./designSpecification";

/* -------------------------------------------------------------------------- */
/* Statuses                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * `ISSUED` — handed to the factory, not yet picked up.
 * `ACKNOWLEDGED` — the factory has confirmed receipt; work may begin.
 * `CANCELLED` — terminal; withdrawn before the factory picked it up.
 */
export type FactoryPacketStatus = "ISSUED" | "ACKNOWLEDGED" | "CANCELLED";

export const FACTORY_PACKET_STATUSES: readonly FactoryPacketStatus[] =
  Object.freeze(["ISSUED", "ACKNOWLEDGED", "CANCELLED"] as const);

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

export type FactoryPacketError =
  | {
      readonly code: "ILLEGAL_TRANSITION";
      readonly field: string;
      readonly reason: string;
      readonly status: string;
    }
  | {
      readonly code: "PRECONDITION_FAILED";
      readonly field: string;
      readonly reason: string;
    };

/* -------------------------------------------------------------------------- */
/* The pin                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Everything a packet freezes about the design it was issued against.
 *
 * `revisionNumber` is stored alongside the id because it is the number a person
 * says out loud — "run it off rev 4" — and resolving an opaque id to a number
 * every time a packet is printed would be a read the shop floor is not entitled
 * to make.
 */
export interface FactoryPacketPin {
  readonly masterCardRevisionId: string;
  readonly revisionNumber: number;
  readonly specification: DesignSpecification;
}

/** What this module needs to know about a packet. */
export interface FactoryPacketState {
  readonly status: FactoryPacketStatus;
}

/** What this module needs to know about the revision being pinned. */
export interface PinnableRevision {
  readonly revisionId: string;
  readonly revisionNumber: number;
  readonly status: string;
  readonly specification: DesignSpecification;
}

/* -------------------------------------------------------------------------- */
/* Issue                                                                       */
/* -------------------------------------------------------------------------- */

/** What a successful issue decision produces. */
export interface PacketIssue {
  readonly status: FactoryPacketStatus;
  readonly quantity: number;
  readonly pin: FactoryPacketPin;
}

/**
 * Whether a packet may be issued, and exactly what it would pin.
 *
 * The line's pinned revision and the revision handed in must be the same
 * document. They are separate parameters because the caller loads them
 * separately, and a mismatch means the line moved between the two reads — which
 * is precisely the race that would put yesterday's dieline on today's packet.
 */
export function checkPacketIssue(input: {
  readonly line: {
    readonly status: string;
    readonly masterCardRevisionId?: string | undefined;
    readonly orderedQuantity: number;
  };
  readonly order: { readonly status: string };
  readonly revision: PinnableRevision;
}): Result<PacketIssue, FactoryPacketError> {
  if (input.revision.status !== "RELEASED") {
    return fail({
      code: "PRECONDITION_FAILED",
      field: "masterCardRevisionId",
      reason: "REVISION_NOT_RELEASED",
    });
  }
  if (input.order.status !== "RELEASED") {
    return fail({
      code: "ILLEGAL_TRANSITION",
      field: "status",
      reason: "ORDER_NOT_RELEASED",
      status: input.order.status,
    });
  }
  if (input.line.status !== "DESIGN_READY") {
    return fail({
      code: "ILLEGAL_TRANSITION",
      field: "status",
      reason: "LINE_NOT_DESIGN_READY",
      status: input.line.status,
    });
  }
  if (input.line.masterCardRevisionId !== input.revision.revisionId) {
    return fail({
      code: "PRECONDITION_FAILED",
      field: "masterCardRevisionId",
      reason: "REVISION_MISMATCH",
    });
  }
  if (
    !Number.isInteger(input.line.orderedQuantity) ||
    input.line.orderedQuantity <= 0
  ) {
    return fail({
      code: "PRECONDITION_FAILED",
      field: "orderedQuantity",
      reason: "NOT_POSITIVE",
    });
  }

  return ok(
    Object.freeze({
      status: "ISSUED" as const,
      quantity: input.line.orderedQuantity,
      pin: Object.freeze({
        masterCardRevisionId: input.revision.revisionId,
        revisionNumber: input.revision.revisionNumber,
        specification: input.revision.specification,
      }),
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* Acknowledge and cancel                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Whether the factory may acknowledge this packet.
 *
 * A second acknowledgement is refused rather than absorbed. Genuine retries — a
 * dropped response, a double-tapped button — are already answered by the
 * idempotency record at the boundary, which replays the first result; what
 * reaches this module is a *different* request claiming to acknowledge a packet
 * that is already claimed, and reporting that plainly is more useful than
 * pretending it worked.
 */
export function checkPacketAcknowledgement(
  packet: FactoryPacketState,
): Result<FactoryPacketStatus, FactoryPacketError> {
  if (packet.status === "ACKNOWLEDGED") {
    return fail({
      code: "ILLEGAL_TRANSITION",
      field: "status",
      reason: "ALREADY_ACKNOWLEDGED",
      status: packet.status,
    });
  }
  if (packet.status !== "ISSUED") {
    return fail({
      code: "ILLEGAL_TRANSITION",
      field: "status",
      reason: "NOT_ISSUED",
      status: packet.status,
    });
  }
  return ok("ACKNOWLEDGED");
}

/**
 * Whether a packet may be withdrawn.
 *
 * Only before the factory picks it up. Once acknowledged, material may already
 * be cut, and a system that quietly cancelled it would be describing a floor
 * state that is not true. Withdrawing acknowledged work needs a factory-order
 * conversation (`WF-02`, Phase 5B) rather than a status flip here.
 */
export function checkPacketCancellation(
  packet: FactoryPacketState,
): Result<FactoryPacketStatus, FactoryPacketError> {
  if (packet.status === "CANCELLED") {
    return fail({
      code: "ILLEGAL_TRANSITION",
      field: "status",
      reason: "ALREADY_CANCELLED",
      status: packet.status,
    });
  }
  if (packet.status === "ACKNOWLEDGED") {
    return fail({
      code: "ILLEGAL_TRANSITION",
      field: "status",
      reason: "ALREADY_ACKNOWLEDGED",
      status: packet.status,
    });
  }
  return ok("CANCELLED");
}
