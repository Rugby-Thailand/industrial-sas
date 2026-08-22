import { describe, expect, it } from "vitest";

import {
  deriveTransferStatus,
  dispatchTransferQuantity,
  initialTransferQuantities,
  receiveTransferQuantity,
  resolveTransferDiscrepancyQuantity,
  returnTransferQuantity,
} from "./transferPolicy";

describe("two-leg transfer quantities", () => {
  it("tracks partial receipt without losing in-transit quantity", () => {
    const initial = initialTransferQuantities(10_000);
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;
    const dispatched = dispatchTransferQuantity(initial.value, 10_000);
    expect(dispatched.ok).toBe(true);
    if (!dispatched.ok) return;
    const received = receiveTransferQuantity(dispatched.value, {
      received: 7_000,
      discrepancy: 0,
    });
    expect(received).toMatchObject({
      ok: true,
      value: { DISPATCHED: 10_000, RECEIVED: 7_000 },
    });
    if (!received.ok) return;
    expect(deriveTransferStatus([received.value])).toEqual({
      ok: true,
      value: "PARTIALLY_RECEIVED",
    });
  });

  it("keeps a named discrepancy open instead of silently completing", () => {
    const quantities = {
      REQUESTED: 10_000,
      DISPATCHED: 10_000,
      RECEIVED: 9_000,
      RETURNED: 0,
      DISCREPANCY: 1_000,
      CANCELLED: 0,
    };
    expect(deriveTransferStatus([quantities])).toEqual({
      ok: true,
      value: "DISCREPANCY",
    });
  });

  it("allows the remaining transit quantity to return to source", () => {
    const quantities = {
      REQUESTED: 10_000,
      DISPATCHED: 10_000,
      RECEIVED: 7_000,
      RETURNED: 0,
      DISCREPANCY: 0,
      CANCELLED: 0,
    };
    const returned = returnTransferQuantity(quantities, 3_000);
    expect(returned).toMatchObject({
      ok: true,
      value: { RECEIVED: 7_000, RETURNED: 3_000 },
    });
    if (!returned.ok) return;
    expect(deriveTransferStatus([returned.value])).toEqual({
      ok: true,
      value: "COMPLETE",
    });
  });

  it("refuses dispatch or receipt above the exact remainder", () => {
    const initial = initialTransferQuantities(1_000);
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;
    expect(dispatchTransferQuantity(initial.value, 1_001)).toMatchObject({
      ok: false,
      error: { code: "QUANTITY_EXCEEDS_REMAINDER" },
    });
    const dispatched = dispatchTransferQuantity(initial.value, 1_000);
    expect(dispatched.ok).toBe(true);
    if (!dispatched.ok) return;
    expect(
      receiveTransferQuantity(dispatched.value, {
        received: 1_000,
        discrepancy: 1,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "QUANTITY_EXCEEDS_REMAINDER" },
    });
  });

  it("makes partial dispatch visible before the request is fully in transit", () => {
    expect(
      deriveTransferStatus([
        {
          REQUESTED: 2_000,
          DISPATCHED: 1_000,
          RECEIVED: 0,
          RETURNED: 0,
          DISCREPANCY: 0,
          CANCELLED: 0,
        },
      ]),
    ).toEqual({ ok: true, value: "DISPATCHING" });
  });

  it("closes found discrepancy quantity into received stock", () => {
    const resolved = resolveTransferDiscrepancyQuantity(
      {
        REQUESTED: 10_000,
        DISPATCHED: 10_000,
        RECEIVED: 8_000,
        RETURNED: 0,
        DISCREPANCY: 2_000,
        CANCELLED: 0,
      },
      { amount: 2_000, resolution: "RECEIVED" },
    );
    expect(resolved).toMatchObject({
      ok: true,
      value: { RECEIVED: 10_000, DISCREPANCY: 0 },
    });
    if (!resolved.ok) return;
    expect(deriveTransferStatus([resolved.value])).toEqual({
      ok: true,
      value: "COMPLETE",
    });
  });
});
