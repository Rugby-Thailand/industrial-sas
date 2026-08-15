import { describe, expect, it } from "vitest";

import {
  CUSTOMER_ORDER_LINE_STATUSES,
  CUSTOMER_ORDER_STATUSES,
  MAX_ORDER_QUANTITY,
  checkDesignFulfilment,
  checkLineAddition,
  checkLineCancellation,
  checkLineHandoff,
  checkOrderCancellation,
  checkOrderRelease,
  checkOrderedQuantity,
  initialLineStatus,
  type CustomerOrderLineState,
  type CustomerOrderLineStatus,
  type CustomerOrderStatus,
} from "./customerOrder";

const line = (
  status: CustomerOrderLineStatus,
  masterCardRevisionId?: string,
): CustomerOrderLineState =>
  masterCardRevisionId === undefined
    ? { status }
    : { status, masterCardRevisionId };

describe("checkOrderedQuantity", () => {
  it("accepts a whole positive count", () => {
    expect(checkOrderedQuantity(5_000)).toStrictEqual({
      ok: true,
      value: 5_000,
    });
  });

  it.each([
    [0, "NOT_POSITIVE"],
    [-1, "NOT_POSITIVE"],
    [1.5, "NOT_A_WHOLE_NUMBER"],
    [Number.NaN, "NOT_A_NUMBER"],
    [Number.POSITIVE_INFINITY, "NOT_A_NUMBER"],
    [MAX_ORDER_QUANTITY + 1, "TOO_LARGE"],
  ])("refuses %p as %s", (quantity, reason) => {
    expect(checkOrderedQuantity(quantity)).toStrictEqual({
      ok: false,
      error: { code: "FIELD_INVALID", field: "orderedQuantity", reason },
    });
  });
});

describe("initialLineStatus", () => {
  it("marks a matched line ready without anybody asserting that it is", () => {
    expect(
      initialLineStatus({
        source: "EXISTING",
        designKey: "RSC|300x200x150|KA|C0",
        masterCardRevisionId: "rev_1",
      }),
    ).toBe("DESIGN_READY");
  });

  it("puts an unmatched line in front of engineering", () => {
    expect(
      initialLineStatus({ source: "NEW", designKey: "RSC|300x200x150|KA|C0" }),
    ).toBe("AWAITING_DESIGN");
  });
});

describe("checkOrderRelease", () => {
  it("releases a draft that has at least one live line", () => {
    expect(
      checkOrderRelease({ status: "DRAFT" }, [line("AWAITING_DESIGN")]),
    ).toStrictEqual({ ok: true, value: "RELEASED" });
  });

  it("releases even while a line is still awaiting design", () => {
    // Commercial commitment does not wait for engineering; the hand-off does.
    expect(
      checkOrderRelease({ status: "DRAFT" }, [line("AWAITING_DESIGN")]).ok,
    ).toBe(true);
  });

  it("refuses an order with no lines at all", () => {
    expect(checkOrderRelease({ status: "DRAFT" }, [])).toStrictEqual({
      ok: false,
      error: {
        code: "PRECONDITION_FAILED",
        field: "lines",
        reason: "NO_LIVE_LINES",
      },
    });
  });

  it("refuses an order whose every line is cancelled", () => {
    expect(
      checkOrderRelease({ status: "DRAFT" }, [
        line("CANCELLED"),
        line("CANCELLED"),
      ]).ok,
    ).toBe(false);
  });

  it.each(["RELEASED", "CANCELLED"] as const)(
    "refuses to release from %s",
    (status) => {
      expect(
        checkOrderRelease({ status }, [line("DESIGN_READY", "rev_1")]),
      ).toStrictEqual({
        ok: false,
        error: {
          code: "ILLEGAL_TRANSITION",
          field: "status",
          reason: "NOT_DRAFT",
          status,
        },
      });
    },
  );
});

describe("checkOrderCancellation", () => {
  it.each(["DRAFT", "RELEASED"] as const)("cancels from %s", (status) => {
    expect(
      checkOrderCancellation({ status }, [line("DESIGN_READY", "rev_1")]),
    ).toStrictEqual({ ok: true, value: "CANCELLED" });
  });

  it("refuses to cancel an already-cancelled order", () => {
    expect(checkOrderCancellation({ status: "CANCELLED" }, [])).toStrictEqual({
      ok: false,
      error: {
        code: "ILLEGAL_TRANSITION",
        field: "status",
        reason: "ALREADY_CANCELLED",
        status: "CANCELLED",
      },
    });
  });

  it("refuses while a factory holds a packet for one of its lines", () => {
    // Cancelling here would leave the shop floor building against a commitment
    // the system says no longer exists.
    expect(
      checkOrderCancellation({ status: "RELEASED" }, [
        line("DESIGN_READY", "rev_1"),
        line("HANDED_OFF", "rev_1"),
      ]),
    ).toStrictEqual({
      ok: false,
      error: {
        code: "PRECONDITION_FAILED",
        field: "lines",
        reason: "LINE_HANDED_OFF",
      },
    });
  });
});

describe("checkLineAddition", () => {
  it("adds to a draft", () => {
    expect(checkLineAddition({ status: "DRAFT" })).toStrictEqual({
      ok: true,
      value: true,
    });
  });

  it.each(["RELEASED", "CANCELLED"] as const)(
    "refuses to add to a %s order",
    (status) => {
      expect(checkLineAddition({ status })).toStrictEqual({
        ok: false,
        error: {
          code: "ILLEGAL_TRANSITION",
          field: "status",
          reason: "ORDER_NOT_DRAFT",
          status,
        },
      });
    },
  );
});

describe("checkDesignFulfilment", () => {
  it("marks an awaiting line ready once a released revision exists", () => {
    expect(
      checkDesignFulfilment(line("AWAITING_DESIGN"), { status: "RELEASED" }),
    ).toStrictEqual({ ok: true, value: "DESIGN_READY" });
  });

  it.each(["DRAFT", "IN_REVIEW", "REJECTED", "SUPERSEDED"])(
    "refuses to pin a %s revision",
    (status) => {
      expect(
        checkDesignFulfilment(line("AWAITING_DESIGN"), { status }),
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

  it.each(["DESIGN_READY", "HANDED_OFF", "CANCELLED"] as const)(
    "refuses to re-pin a %s line",
    (status) => {
      expect(
        checkDesignFulfilment(line(status, "rev_1"), { status: "RELEASED" }),
      ).toStrictEqual({
        ok: false,
        error: {
          code: "ILLEGAL_TRANSITION",
          field: "status",
          reason: "NOT_AWAITING_DESIGN",
          status,
        },
      });
    },
  );
});

describe("checkLineHandoff", () => {
  const released = { status: "RELEASED" as const };

  it("hands off a ready, pinned line on a released order", () => {
    expect(
      checkLineHandoff(released, line("DESIGN_READY", "rev_1")),
    ).toStrictEqual({ ok: true, value: "HANDED_OFF" });
  });

  it.each(["DRAFT", "CANCELLED"] as const)(
    "refuses while the order is %s",
    (status) => {
      expect(
        checkLineHandoff({ status }, line("DESIGN_READY", "rev_1")),
      ).toStrictEqual({
        ok: false,
        error: {
          code: "ILLEGAL_TRANSITION",
          field: "status",
          reason: "ORDER_NOT_RELEASED",
          status,
        },
      });
    },
  );

  it.each(["AWAITING_DESIGN", "HANDED_OFF", "CANCELLED"] as const)(
    "refuses a %s line",
    (status) => {
      expect(checkLineHandoff(released, line(status, "rev_1"))).toStrictEqual({
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

  it("refuses a ready line with nothing pinned to it", () => {
    // A packet with no dieline is the failure this guard exists for.
    expect(checkLineHandoff(released, line("DESIGN_READY"))).toStrictEqual({
      ok: false,
      error: {
        code: "PRECONDITION_FAILED",
        field: "masterCardRevisionId",
        reason: "NOT_PINNED",
      },
    });
  });
});

describe("checkLineCancellation", () => {
  it.each(["AWAITING_DESIGN", "DESIGN_READY"] as const)(
    "cancels a %s line",
    (status) => {
      expect(checkLineCancellation(line(status))).toStrictEqual({
        ok: true,
        value: "CANCELLED",
      });
    },
  );

  it("refuses a handed-off line: cancel the packet first", () => {
    expect(checkLineCancellation(line("HANDED_OFF", "rev_1"))).toStrictEqual({
      ok: false,
      error: {
        code: "ILLEGAL_TRANSITION",
        field: "status",
        reason: "LINE_HANDED_OFF",
        status: "HANDED_OFF",
      },
    });
  });

  it("refuses an already-cancelled line", () => {
    expect(checkLineCancellation(line("CANCELLED")).ok).toBe(false);
  });
});

describe("status catalogues", () => {
  it("lists every order status exactly once", () => {
    expect(new Set(CUSTOMER_ORDER_STATUSES).size).toBe(
      CUSTOMER_ORDER_STATUSES.length,
    );
  });

  it("lists every line status exactly once", () => {
    expect(new Set(CUSTOMER_ORDER_LINE_STATUSES).size).toBe(
      CUSTOMER_ORDER_LINE_STATUSES.length,
    );
  });

  it("covers every order status in the transition guards", () => {
    // Every status is either releasable or refused by name — none falls through.
    const outcomes = CUSTOMER_ORDER_STATUSES.map(
      (status: CustomerOrderStatus) =>
        checkOrderRelease({ status }, [line("DESIGN_READY", "rev_1")]),
    );

    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
  });
});
