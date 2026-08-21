import { describe, expect, it } from "vitest";

import {
  decideProductionQuality,
  deriveProductionStatus,
  initialProductionQuantities,
  issueMaterialQuantity,
  receiveProductionOutput,
  reportProductionOutput,
} from "./productionExecution";

describe("production execution quantities", () => {
  it("accounts for good, scrap, rework, receipt, and quality without drift", () => {
    const initial = initialProductionQuantities(10_000);
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;
    const reported = reportProductionOutput(initial.value, {
      good: 8_000,
      scrap: 1_000,
      rework: 1_000,
    });
    expect(reported.ok).toBe(true);
    if (!reported.ok) return;
    const received = receiveProductionOutput(reported.value, 8_000);
    expect(received.ok).toBe(true);
    if (!received.ok) return;
    expect(deriveProductionStatus(received.value)).toEqual({
      ok: true,
      value: "QC_PENDING",
    });
    const decided = decideProductionQuality(received.value, "RELEASE", 8_000);
    expect(decided.ok).toBe(true);
    if (!decided.ok) return;
    expect(deriveProductionStatus(decided.value)).toEqual({
      ok: true,
      value: "COMPLETE",
    });
  });

  it("refuses output receipt above reported good quantity", () => {
    const initial = initialProductionQuantities(1_000);
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;
    expect(receiveProductionOutput(initial.value, 1)).toMatchObject({
      ok: false,
      error: { code: "QUANTITY_EXCEEDS_REMAINDER", field: "received" },
    });
  });

  it("caps material issue at the pinned requirement", () => {
    expect(issueMaterialQuantity(5_000, 2_000, 3_000)).toEqual({
      ok: true,
      value: 5_000,
    });
    expect(issueMaterialQuantity(5_000, 2_000, 3_001)).toMatchObject({
      ok: false,
      error: { code: "QUANTITY_EXCEEDS_REMAINDER", field: "material" },
    });
  });

  it("requires the complete run to be accounted before closure", () => {
    const quantities = {
      target: 10_000,
      good: 8_000,
      scrap: 0,
      rework: 0,
      received: 8_000,
      qcReleased: 8_000,
      qcRejected: 0,
    };
    expect(deriveProductionStatus(quantities)).toEqual({
      ok: false,
      error: { code: "OUTPUT_NOT_FULLY_DECIDED" },
    });
  });
});
