import { describe, expect, it } from "vitest";
import { identifiesPallet } from "./palletIdentity";

const pallet = { _id: "pallet-a", code: "P-001" };

describe("pickup pallet identification", () => {
  it("accepts the QR payload for both methods", () => {
    expect(identifiesPallet("ISAS:PALLET:1:pallet-a", "SCAN", pallet)).toBe(
      true,
    );
    expect(identifiesPallet(" ISAS:PALLET:1:pallet-a ", "MANUAL", pallet)).toBe(
      true,
    );
    expect(identifiesPallet("isas:pallet:1:pallet-a", "SCAN", pallet)).toBe(
      false,
    );
  });
  it("matches a typed plain code ignoring case and surrounding space", () => {
    expect(identifiesPallet(" p-001 ", "MANUAL", pallet)).toBe(true);
    expect(identifiesPallet("P-002", "MANUAL", pallet)).toBe(false);
  });
  it("rejects a camera read of the plain code", () => {
    expect(identifiesPallet("P-001", "SCAN", pallet)).toBe(false);
  });
});
