import { rectanglesOverlap } from "@/lib/storageLayouts/storagePlacementGeometry";
import { storageRectangleContains } from "../../../convex/model/storageLayout/storageZone";

export interface PlacementRectangle {
  readonly xMm: number;
  readonly yMm: number;
  readonly widthMm: number;
  readonly depthMm: number;
}

export interface NamedArea extends PlacementRectangle {
  readonly label: string;
  /** Unavailable areas may lie wholly inside a spot; spots may not touch. */
  readonly kind: "unavailable" | "spot";
}

/**
 * The first free top-left position for a footprint, or null when none exists.
 * Candidates are the floor origin plus every right/bottom edge of an existing
 * area, so narrow gaps next to aisles are found exactly instead of on a coarse
 * grid. Never returns an overlapping fallback.
 */
export function findFreePlacement(
  floorWidthMm: number,
  floorDepthMm: number,
  widthMm: number,
  depthMm: number,
  areas: readonly PlacementRectangle[],
): { readonly xMm: number; readonly yMm: number } | null {
  if (widthMm <= 0 || depthMm <= 0) return null;
  const xs = [
    ...new Set([0, ...areas.map((area) => area.xMm + area.widthMm)]),
  ].sort((a, b) => a - b);
  const ys = [
    ...new Set([0, ...areas.map((area) => area.yMm + area.depthMm)]),
  ].sort((a, b) => a - b);
  for (const yMm of ys) {
    if (yMm + depthMm > floorDepthMm) continue;
    for (const xMm of xs) {
      if (xMm + widthMm > floorWidthMm) continue;
      const candidate = { xMm, yMm, widthMm, depthMm };
      if (!areas.some((area) => rectanglesOverlap(candidate, area)))
        return { xMm, yMm };
    }
  }
  return null;
}

export type PlacementProblem =
  | { readonly kind: "incomplete" }
  | { readonly kind: "outside" }
  | { readonly kind: "tooHigh" }
  | { readonly kind: "overlaps"; readonly names: readonly string[] };

/** Why a draft spot cannot be saved, naming the areas it collides with. */
export function placementProblem(input: {
  readonly draft: PlacementRectangle | null;
  readonly heightMm: number | null;
  readonly floorWidthMm: number;
  readonly floorDepthMm: number;
  readonly floorHeightMm: number;
  readonly areas: readonly NamedArea[];
}): PlacementProblem | null {
  const { draft, heightMm } = input;
  if (
    draft === null ||
    heightMm === null ||
    draft.widthMm <= 0 ||
    draft.depthMm <= 0 ||
    heightMm <= 0
  )
    return { kind: "incomplete" };
  if (
    draft.xMm < 0 ||
    draft.yMm < 0 ||
    draft.xMm + draft.widthMm > input.floorWidthMm ||
    draft.yMm + draft.depthMm > input.floorDepthMm
  )
    return { kind: "outside" };
  if (heightMm > input.floorHeightMm) return { kind: "tooHigh" };
  const names = input.areas
    .filter(
      (area) =>
        rectanglesOverlap(draft, area) &&
        !(area.kind === "unavailable" && storageRectangleContains(draft, area)),
    )
    .map((area) => area.label);
  return names.length ? { kind: "overlaps", names } : null;
}
