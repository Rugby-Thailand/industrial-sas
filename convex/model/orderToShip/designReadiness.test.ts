import { describe, expect, it } from "vitest";

import {
  DESIGN_REQUIREMENT_KEYS,
  assessDesignReadiness,
  requireDesignReady,
  summarizeDesignChange,
} from "./designReadiness";

const complete = {
  styleCode: "RSC",
  internalLengthMm: 300,
  internalWidthMm: 200,
  internalHeightMm: 150,
  boardGrade: "KA125/C/KA125",
  printColourCount: 2,
  printColours: ["BLACK", "RED"],
  bundleQuantity: 20,
  route: [{ sequence: 1, workCenterCode: "PRN", operationCode: "PRINT" }],
  materials: [
    {
      itemCode: "PAPER",
      description: "Board",
      quantityPerUnit: 1,
      uom: "SHEET",
    },
  ],
  qualityRequirements: [
    { code: "BCT", description: "Compression", target: ">= 4.5kN" },
  ],
} as const;

const confirmed = Object.fromEntries(
  DESIGN_REQUIREMENT_KEYS.map((key) => [key, true]),
) as Record<(typeof DESIGN_REQUIREMENT_KEYS)[number], boolean>;

describe("design requirement readiness", () => {
  it("requires both human confirmations and structured production facts", () => {
    expect(assessDesignReadiness(complete, confirmed)).toStrictEqual({
      status: "READY",
      missing: [],
    });
    expect(
      assessDesignReadiness(
        { ...complete, materials: [] },
        { ...confirmed, PACKING: false },
      ),
    ).toMatchObject({
      status: "INCOMPLETE",
      missing: ["PACKING", "MATERIALS"],
    });
  });

  it("blocks an explicitly incomplete request while allowing legacy rows to migrate", () => {
    expect(requireDesignReady("INCOMPLETE")).toMatchObject({
      ok: false,
      error: { reason: "REQUIREMENTS_INCOMPLETE" },
    });
    expect(requireDesignReady("READY")).toStrictEqual({
      ok: true,
      value: true,
    });
    expect(requireDesignReady(undefined)).toStrictEqual({
      ok: true,
      value: true,
    });
  });
});

describe("revision change summary", () => {
  it("names changed fields and blocks production-affecting changes", () => {
    expect(
      summarizeDesignChange(complete, {
        ...complete,
        internalWidthMm: 210,
        packingInstructions: "Shrink wrap",
      }),
    ).toStrictEqual({
      severity: "BLOCKING",
      changedFields: ["internalWidthMm", "packingInstructions"],
      categories: ["DIMENSIONS", "PACKING"],
    });
  });

  it("classifies presentation-only changes for review", () => {
    expect(
      summarizeDesignChange(complete, {
        ...complete,
        productNameTh: "กล่องใหม่",
      }),
    ).toMatchObject({ severity: "REVIEW_REQUIRED" });
  });
});
