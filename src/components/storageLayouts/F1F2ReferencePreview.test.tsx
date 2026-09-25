import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  F1F2ReferencePreview,
  matchesF1F2Reference,
} from "./F1F2ReferencePreview";

const buildingId = "n575kryc3hp4e788hyc7pab4hh8f1vgv";

describe("approved F1/F2 schematic", () => {
  it("shows only after the exact building and revision are approved", () => {
    expect(matchesF1F2Reference(buildingId, 1, "f1-f2-2026-09-25")).toBe(true);
    expect(matchesF1F2Reference(buildingId, 2, "f1-f2-2026-09-25")).toBe(true);
    expect(matchesF1F2Reference(buildingId, 2, undefined)).toBe(false);
    expect(matchesF1F2Reference("other", 2, "f1-f2-2026-09-25")).toBe(false);
    expect(matchesF1F2Reference(buildingId, 3, "f1-f2-2026-09-25")).toBe(false);
  });

  it("switches the second floor between matching 2D and 3D assets", () => {
    render(<F1F2ReferencePreview floorNumber={2} />);
    expect(screen.getByTitle("ผัง 2D อาคาร F1 + F2 ชั้น 2")).toHaveAttribute(
      "src",
      "/f1-f2-reference/f2-2d.html",
    );
    fireEvent.click(screen.getByRole("button", { name: "3D" }));
    expect(screen.getByTitle("ผัง 3D อาคาร F1 + F2 ชั้น 2")).toHaveAttribute(
      "src",
      "/f1-f2-reference/f2-3d.html",
    );
  });
});
