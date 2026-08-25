import { fail, ok, type Result } from "../result";

export type FactoryPacketStatus = "ISSUED" | "ACKNOWLEDGED" | "CANCELLED";

export const FACTORY_PACKET_STATUSES: readonly FactoryPacketStatus[] =
  Object.freeze(["ISSUED", "ACKNOWLEDGED", "CANCELLED"] as const);

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

export interface FactoryPacketPin {
  readonly masterCardRevisionId: string;
}

export interface FactoryPacketState {
  readonly status: FactoryPacketStatus;
}

export interface PinnableRevision {
  readonly revisionId: string;
  readonly status: string;
}

export interface PacketIssue {
  readonly status: FactoryPacketStatus;
  readonly pin: FactoryPacketPin;
}

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
      pin: Object.freeze({
        masterCardRevisionId: input.revision.revisionId,
      }),
    }),
  );
}

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
