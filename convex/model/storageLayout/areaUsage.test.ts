import { describe, it, expect } from "vitest";
import { storageFootprintUsage } from "./areaUsage";
const rect = (xMm: number, status: string) => ({
  xMm,
  yMm: 0,
  widthMm: 1000,
  depthMm: 1000,
  status,
});
describe("storageFootprintUsage", () => {
  it("counts stacks once and reservations only outside stored footprints", () => {
    expect(
      storageFootprintUsage([
        {
          placements: [
            rect(0, "STORED"),
            rect(0, "STORED"),
            rect(0, "RESERVED"),
            rect(1000, "RESERVED"),
            rect(2000, "RELEASED"),
          ],
        },
      ]),
    ).toEqual({
      storedFootprintAreaSqMm: 1_000_000,
      heldFootprintAreaSqMm: 1_000_000,
    });
  });
  it("keeps identical coordinates on different floors/zones separate and holds both move ends", () => {
    expect(
      storageFootprintUsage([
        { placements: [rect(0, "STORED")] },
        { placements: [rect(0, "RESERVED")] },
      ]),
    ).toEqual({
      storedFootprintAreaSqMm: 1_000_000,
      heldFootprintAreaSqMm: 1_000_000,
    });
  });
  it("updates after a reservation is released", () => {
    expect(
      storageFootprintUsage([{ placements: [rect(0, "RELEASED")] }]),
    ).toEqual({ storedFootprintAreaSqMm: 0, heldFootprintAreaSqMm: 0 });
  });
});
