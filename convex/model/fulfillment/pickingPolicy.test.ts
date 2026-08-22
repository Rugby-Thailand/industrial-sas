import { describe, expect, it } from "vitest";

import {
  checkPickScan,
  checkPickedTask,
  makePickLine,
  recordPickException,
  recordPickedQuantity,
  submitPickedTask,
} from "./pickingPolicy";

describe("picking policy", () => {
  it("accounts picked, short, and damaged quantities exactly", () => {
    const initial = makePickLine(10_000);
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;
    const picked = recordPickedQuantity(initial.value, 7_000);
    expect(picked.ok).toBe(true);
    if (!picked.ok) return;
    const short = recordPickException(picked.value, {
      kind: "SHORT",
      baseMinorUnits: 2_000,
      reason: "No stock at location",
    });
    expect(short.ok).toBe(true);
    if (!short.ok) return;
    const damaged = recordPickException(short.value, {
      kind: "DAMAGED",
      baseMinorUnits: 1_000,
      reason: "Crushed carton",
    });
    expect(damaged.ok).toBe(true);
    if (!damaged.ok) return;
    expect(submitPickedTask("IN_PROGRESS", [damaged.value])).toEqual({
      ok: true,
      value: "PICKED",
    });
  });

  it("refuses wrong location/item/lot and over-pick", () => {
    expect(
      checkPickScan(
        { itemId: "item-a", locationId: "loc-a", lotId: "lot-a" },
        { itemId: "item-a", locationId: "loc-b", lotId: "lot-a" },
      ),
    ).toEqual({
      ok: false,
      error: { code: "SCAN_MISMATCH", field: "locationId" },
    });
    const line = makePickLine(1_000);
    expect(line.ok).toBe(true);
    if (!line.ok) return;
    expect(recordPickedQuantity(line.value, 1_001)).toMatchObject({
      ok: false,
      error: { code: "PICK_QUANTITY_EXCEEDED" },
    });
  });

  it("enforces independent checking", () => {
    expect(
      checkPickedTask({
        status: "PICKED",
        pickerUserId: "user-a",
        checkerUserId: "user-a",
      }),
    ).toEqual({ ok: false, error: { code: "CHECKER_IS_PICKER" } });
    expect(
      checkPickedTask({
        status: "PICKED",
        pickerUserId: "user-a",
        checkerUserId: "user-b",
      }),
    ).toEqual({ ok: true, value: "CHECKED" });
  });
});
