import { describe, expect, it } from "vitest";

import { parseBusinessDate, type BusinessDate } from "../time/businessDate";
import {
  allocateReservation,
  calculateAtp,
  checkFulfillmentConservation,
  deriveFulfillmentLineStatus,
  initialFulfillmentQuantities,
  moveFulfillmentQuantity,
  type ReservationCandidate,
} from "./reservationPolicy";

const date = (value: string): BusinessDate => {
  const parsed = parseBusinessDate(value);
  if (!parsed.ok) throw new Error(`invalid fixture date: ${value}`);
  return parsed.value;
};

const candidate = (
  bucketKey: string,
  stockMinorUnits: number,
  alreadyReservedMinorUnits: number,
  expirationDate: string,
): ReservationCandidate => ({
  bucketKey,
  stockMinorUnits,
  alreadyReservedMinorUnits,
  rotation: {
    candidateKey: bucketKey,
    lotCode: bucketKey,
    receivedOn: date("2026-01-01"),
    receiptSequence: bucketKey.charCodeAt(0),
    expirationDate: date(expirationDate),
    bestBeforeDate: null,
    manufactureDate: null,
  },
});

describe("fulfillment reservation policy", () => {
  it("computes ATP net of active reservations without going below zero", () => {
    expect(
      calculateAtp([
        candidate("A", 5_000, 1_000, "2026-09-01"),
        candidate("B", 1_000, 2_000, "2026-10-01"),
      ]),
    ).toEqual({ ok: true, value: 4_000 });
  });

  it("allocates FEFO deterministically and records the backorder", () => {
    const result = allocateReservation({
      requestedMinorUnits: 7_000,
      candidates: [
        candidate("A", 4_000, 0, "2026-11-01"),
        candidate("B", 2_000, 0, "2026-09-01"),
      ],
      rotationPolicy: {
        strategy: "FEFO",
        rotationDateSource: "EXPIRATION",
        missingRotationDate: "EXCLUDE",
        expired: "EXCLUDE",
      },
      asOf: date("2026-08-17"),
      allowPartial: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.allocations.map(({ bucketKey }) => bucketKey)).toEqual([
      "B",
      "A",
    ]);
    expect(result.value.reservedMinorUnits).toBe(6_000);
    expect(result.value.backorderedMinorUnits).toBe(1_000);
    expect(result.value.complete).toBe(false);
  });

  it("keeps all-or-nothing allocation atomic when ATP is insufficient", () => {
    const result = allocateReservation({
      requestedMinorUnits: 8_000,
      candidates: [candidate("A", 4_000, 0, "2026-11-01")],
      rotationPolicy: {
        strategy: "FIFO",
        rotationDateSource: "EXPIRATION",
        missingRotationDate: "EXCLUDE",
        expired: "EXCLUDE",
      },
      asOf: date("2026-08-17"),
      allowPartial: false,
    });
    expect(result).toEqual({
      ok: false,
      error: {
        code: "INSUFFICIENT_ATP",
        requestedMinorUnits: 8_000,
        atpMinorUnits: 4_000,
      },
    });
  });

  it("moves quantities through exclusive stages and preserves conservation", () => {
    const initial = initialFulfillmentQuantities(10_000);
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;
    const reserved = moveFulfillmentQuantity(initial.value, {
      from: "DEMAND",
      to: "RESERVED",
      baseMinorUnits: 7_000,
    });
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) return;
    const backordered = moveFulfillmentQuantity(reserved.value, {
      from: "DEMAND",
      to: "BACKORDERED",
      baseMinorUnits: 3_000,
    });
    expect(backordered.ok).toBe(true);
    if (!backordered.ok) return;
    expect(checkFulfillmentConservation(10_000, backordered.value)).toEqual({
      ok: true,
      value: true,
    });
    expect(deriveFulfillmentLineStatus(10_000, backordered.value)).toEqual({
      ok: true,
      value: "RESERVED",
    });
    expect(
      moveFulfillmentQuantity(backordered.value, {
        from: "RESERVED",
        to: "DELIVERED",
        baseMinorUnits: 1_000,
      }),
    ).toMatchObject({ ok: false, error: { code: "ILLEGAL_STAGE_MOVE" } });

    const issued = {
      ...backordered.value,
      RESERVED: 0,
      ISSUED: backordered.value.RESERVED,
    };
    expect(
      moveFulfillmentQuantity(issued, {
        from: "ISSUED",
        to: "STAGED",
        baseMinorUnits: issued.ISSUED,
      }),
    ).toMatchObject({
      ok: true,
      value: { ISSUED: 0, STAGED: issued.ISSUED },
    });
  });
});
