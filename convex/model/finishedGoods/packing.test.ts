import { describe, expect, it } from "vitest";
import {
  MAX_FG_PACKAGES,
  quantityToMinor,
  splitEqually,
  splitPackages,
  validatePacking,
} from "./packing";
const row = {
  quantity: 500,
  lengthMm: 1200,
  widthMm: 1000,
  heightMm: 1400,
  dimensionsChecked: true,
};
describe("packing quantities and measurements", () => {
  it("splits by capacity with a remainder and equally without losing whole pieces", () => {
    expect(splitPackages(1001, 500, "PCS")).toEqual([500, 500, 1]);
    expect(splitEqually(1001, 2, "ชิ้น")).toEqual([501, 500]);
    expect(splitEqually(1, 3, "kg")).toEqual([0.334, 0.333, 0.333]);
    expect(splitPackages(0.3, 0.1, "kg")).toEqual([0.1, 0.1, 0.1]);
    expect(
      validatePacking(
        0.3,
        [
          { ...row, quantity: 0.1 },
          { ...row, quantity: 0.2 },
        ],
        "kg",
      ),
    ).toBeNull();
  });
  it("rejects fractional pieces, excessive precision, impossible splits and unsafe quantities", () => {
    for (const value of [0, -1, NaN, Infinity, 1e9 + 1, 0.0001])
      expect(quantityToMinor(value, "kg")).toBeNull();
    for (const unit of ["PCS", "EA", "pieces", "ชิ้น"])
      expect(quantityToMinor(0.5, unit)).toBeNull();
    expect(quantityToMinor(1.001, "kg")).toBe(1001);
    expect(quantityToMinor(1e9, "kg")).toBe(1e12);
    expect(splitPackages(51, 1, "PCS")).toEqual([]);
    expect(splitEqually(2, 3, "PCS")).toEqual([]);
    expect(splitEqually(10, 1.5, "PCS")).toEqual([]);
    expect(splitEqually(10, 0, "PCS")).toEqual([]);
    expect(splitPackages(10, 0, "PCS")).toEqual([]);
  });
  it("conserves integer quantities over varied odd and decimal splits", () => {
    for (let total = 1; total <= 500; total++)
      for (const unit of ["PCS", "kg"]) {
        const amount = unit === "kg" ? total / 1000 : total;
        for (const count of [1, 2, 3, 7, 50]) {
          const result = splitEqually(amount, count, unit);
          if (total < count) expect(result).toEqual([]);
          else
            expect(
              result.reduce((sum, n) => sum + quantityToMinor(n, unit)!, 0),
            ).toBe(quantityToMinor(amount, unit));
        }
      }
  });
  it("requires full allocation, bounded package count, valid size and acknowledged measurements", () => {
    expect(validatePacking(1000, [row, row], "PCS")).toBeNull();
    expect(validatePacking(999, [row, row], "PCS")).toBe("QUANTITY_MISMATCH");
    expect(validatePacking(1001, [row, row], "PCS")).toBe("QUANTITY_MISMATCH");
    expect(validatePacking(500, [], "PCS")).toBe("PACKAGE_COUNT_INVALID");
    expect(
      validatePacking(
        25500,
        Array.from({ length: MAX_FG_PACKAGES + 1 }, () => row),
        "PCS",
      ),
    ).toBe("PACKAGE_COUNT_INVALID");
    for (const lengthMm of [0, -1, 1.1, 100001, NaN, Infinity])
      expect(validatePacking(500, [{ ...row, lengthMm }], "PCS")).toBe(
        "DIMENSIONS_INVALID",
      );
    for (const weightKg of [0, -1, 1000001, NaN, Infinity])
      expect(validatePacking(500, [{ ...row, weightKg }], "PCS")).toBe(
        "WEIGHT_INVALID",
      );
    expect(
      validatePacking(500, [{ ...row, dimensionsChecked: false }], "PCS"),
    ).toBe("DIMENSIONS_UNCHECKED");
    expect(validatePacking(0, [row], "PCS")).toBe("QUANTITY_INVALID");
    expect(validatePacking(500, [{ ...row, quantity: 0.1 }], "PCS")).toBe(
      "QUANTITY_INVALID",
    );
  });
});
