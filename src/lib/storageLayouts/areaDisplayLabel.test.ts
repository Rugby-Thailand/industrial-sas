import { describe, expect, it } from "vitest";
import { areaDisplayLabel } from "./areaDisplayLabel";

describe("areaDisplayLabel", () => {
  it("hides a trailing suffix that restates the area's width × depth", () => {
    expect(
      areaDisplayLabel(
        "พื้นที่จัดเตรียมสินค้า · 1 · 2.80 × 8.98 ม.",
        2800,
        8980,
      ),
    ).toBe("พื้นที่จัดเตรียมสินค้า · 1");
    expect(areaDisplayLabel("บันได 2.10 × 1.51 ม.", 2100, 1510)).toBe("บันได");
    expect(areaDisplayLabel("Staging 3 · 2.8 x 9 m", 2800, 9000)).toBe(
      "Staging 3",
    );
  });

  it("allows only the rounding implied by the written precision", () => {
    // 2.80 m is written to the centimetre, so 2 803 mm still rounds to it.
    expect(areaDisplayLabel("Bay · 2.80 × 8.98 m", 2803, 8978)).toBe("Bay");
    expect(areaDisplayLabel("Bay · 2.80 × 8.98 m", 2810, 8980)).toBe(
      "Bay · 2.80 × 8.98 m",
    );
  });

  it("keeps the label when the suffix does not match this area", () => {
    const label = "พื้นที่จัดเตรียมสินค้า · 1 · 2.80 × 8.98 ม.";
    expect(areaDisplayLabel(label, 8980, 2800)).toBe(label);
    expect(areaDisplayLabel(label, 3000, 8980)).toBe(label);
  });

  it("preserves the label when a half-step rounds to a different value", () => {
    expect(areaDisplayLabel("Bay · 2.80 × 8.98 m", 2805, 8980)).toBe(
      "Bay · 2.80 × 8.98 m",
    );
    expect(areaDisplayLabel("Bay · 2.80 × 8.98 m", 2795, 8980)).toBe("Bay");
    expect(areaDisplayLabel("Bay · 2.01 × 8.98 m", 2005, 8980)).toBe("Bay");
    expect(areaDisplayLabel("Bay · 2.8 × 9 m", 2850, 9000)).toBe(
      "Bay · 2.8 × 9 m",
    );
  });

  it("keeps labels whose numbers are not a recognised dimensions suffix", () => {
    for (const label of [
      "Zone 2026 · Row 12",
      "ทางเดินหลัก 2 ม.",
      "พื้นปูนยกสูง 0.65 ม. · ลึก 1.41 ม.",
      "Dock · 2.80 × 8.98 ft",
      "Dock · 2.80 × 8.98",
      "2.80 × 8.98 m",
      "Dock · 2.80 × 8.98 m · north",
    ])
      expect(areaDisplayLabel(label, 2800, 8980)).toBe(label);
  });
});
