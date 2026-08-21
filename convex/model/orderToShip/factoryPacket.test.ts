import { describe, expect, it } from "vitest";

import {
  FACTORY_PACKET_STATUSES,
  checkPacketAcknowledgement,
  checkPacketCancellation,
  checkPacketIssue,
  type PinnableRevision,
} from "./factoryPacket";

const revision = (
  overrides: Partial<PinnableRevision> = {},
): PinnableRevision => ({
  revisionId: "rev_1",
  status: "RELEASED",
  ...overrides,
});

const READY_LINE = Object.freeze({
  status: "DESIGN_READY",
  masterCardRevisionId: "rev_1",
  orderedQuantity: 5_000,
});

describe("checkPacketIssue", () => {
  it("issues a packet that pins the exact released revision", () => {
    expect(
      checkPacketIssue({
        line: READY_LINE,
        order: { status: "RELEASED" },
        revision: revision(),
      }),
    ).toStrictEqual({
      ok: true,
      value: {
        status: "ISSUED",
        pin: {
          masterCardRevisionId: "rev_1",
        },
      },
    });
  });

  it("freezes the released revision relationship", () => {
    const issued = checkPacketIssue({
      line: READY_LINE,
      order: { status: "RELEASED" },
      revision: revision(),
    });

    expect(issued.ok && Object.isFrozen(issued.value.pin)).toBe(true);
  });

  it("validates the line quantity without copying it into the packet result", () => {
    const issued = checkPacketIssue({
      line: { ...READY_LINE, orderedQuantity: 750 },
      order: { status: "RELEASED" },
      revision: revision(),
    });

    expect(issued.ok).toBe(true);
    expect(issued.ok && issued.value).not.toHaveProperty("quantity");
  });

  it.each(["DRAFT", "IN_REVIEW", "REJECTED", "SUPERSEDED"])(
    "refuses a %s revision before it checks anything else",
    (status) => {
      // The most expensive mistake in this flow is a factory cutting to a spec
      // nobody approved, so this guard runs first.
      expect(
        checkPacketIssue({
          line: { ...READY_LINE, status: "DRAFT" },
          order: { status: "DRAFT" },
          revision: revision({ status }),
        }),
      ).toStrictEqual({
        ok: false,
        error: {
          code: "PRECONDITION_FAILED",
          field: "masterCardRevisionId",
          reason: "REVISION_NOT_RELEASED",
        },
      });
    },
  );

  it.each(["DRAFT", "CANCELLED"])("refuses while the order is %s", (status) => {
    expect(
      checkPacketIssue({
        line: READY_LINE,
        order: { status },
        revision: revision(),
      }),
    ).toStrictEqual({
      ok: false,
      error: {
        code: "ILLEGAL_TRANSITION",
        field: "status",
        reason: "ORDER_NOT_RELEASED",
        status,
      },
    });
  });

  it.each(["DRAFT", "AWAITING_DESIGN", "HANDED_OFF", "CANCELLED"])(
    "refuses a %s line",
    (status) => {
      expect(
        checkPacketIssue({
          line: { ...READY_LINE, status },
          order: { status: "RELEASED" },
          revision: revision(),
        }),
      ).toStrictEqual({
        ok: false,
        error: {
          code: "ILLEGAL_TRANSITION",
          field: "status",
          reason: "LINE_NOT_DESIGN_READY",
          status,
        },
      });
    },
  );

  it("refuses when the line pins a different revision than the one loaded", () => {
    // The race this catches would put yesterday's dieline on today's packet.
    expect(
      checkPacketIssue({
        line: { ...READY_LINE, masterCardRevisionId: "rev_9" },
        order: { status: "RELEASED" },
        revision: revision(),
      }),
    ).toStrictEqual({
      ok: false,
      error: {
        code: "PRECONDITION_FAILED",
        field: "masterCardRevisionId",
        reason: "REVISION_MISMATCH",
      },
    });
  });

  it("refuses a line that pins nothing", () => {
    expect(
      checkPacketIssue({
        line: { status: "DESIGN_READY", orderedQuantity: 10 },
        order: { status: "RELEASED" },
        revision: revision(),
      }).ok,
    ).toBe(false);
  });

  it.each([0, -5, 1.5])(
    "refuses an ordered quantity of %p",
    (orderedQuantity) => {
      expect(
        checkPacketIssue({
          line: { ...READY_LINE, orderedQuantity },
          order: { status: "RELEASED" },
          revision: revision(),
        }),
      ).toStrictEqual({
        ok: false,
        error: {
          code: "PRECONDITION_FAILED",
          field: "orderedQuantity",
          reason: "NOT_POSITIVE",
        },
      });
    },
  );
});

describe("checkPacketAcknowledgement", () => {
  it("acknowledges an issued packet", () => {
    expect(checkPacketAcknowledgement({ status: "ISSUED" })).toStrictEqual({
      ok: true,
      value: "ACKNOWLEDGED",
    });
  });

  it("refuses a second acknowledgement rather than absorbing it", () => {
    // Genuine retries are answered by the idempotency record at the boundary.
    expect(
      checkPacketAcknowledgement({ status: "ACKNOWLEDGED" }),
    ).toStrictEqual({
      ok: false,
      error: {
        code: "ILLEGAL_TRANSITION",
        field: "status",
        reason: "ALREADY_ACKNOWLEDGED",
        status: "ACKNOWLEDGED",
      },
    });
  });

  it("refuses a cancelled packet", () => {
    expect(checkPacketAcknowledgement({ status: "CANCELLED" })).toStrictEqual({
      ok: false,
      error: {
        code: "ILLEGAL_TRANSITION",
        field: "status",
        reason: "NOT_ISSUED",
        status: "CANCELLED",
      },
    });
  });
});

describe("checkPacketCancellation", () => {
  it("withdraws a packet the factory has not picked up", () => {
    expect(checkPacketCancellation({ status: "ISSUED" })).toStrictEqual({
      ok: true,
      value: "CANCELLED",
    });
  });

  it("refuses once the factory has acknowledged it", () => {
    // Material may already be cut; a quiet cancel would describe a floor state
    // that is not true.
    expect(checkPacketCancellation({ status: "ACKNOWLEDGED" })).toStrictEqual({
      ok: false,
      error: {
        code: "ILLEGAL_TRANSITION",
        field: "status",
        reason: "ALREADY_ACKNOWLEDGED",
        status: "ACKNOWLEDGED",
      },
    });
  });

  it("refuses an already-cancelled packet", () => {
    expect(checkPacketCancellation({ status: "CANCELLED" }).ok).toBe(false);
  });

  it("answers every status without falling through", () => {
    const outcomes = FACTORY_PACKET_STATUSES.map((status) =>
      checkPacketCancellation({ status }),
    );

    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
  });
});
