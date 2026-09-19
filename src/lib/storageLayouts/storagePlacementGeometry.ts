import type { StorageStackPlacementRow } from "@/lib/convex/storageLayoutApi";
import { occupiedFootprintAreaSqMm } from "../../../convex/model/storageLayout/occupancy";

/** Distinct physical units, while boxes intentionally retain both relocation holds. */
export function uniqueStoragePallets(
  placements: readonly StorageStackPlacementRow[],
) {
  return [...new Map(placements.map((p) => [p.handlingUnitId, p])).values()];
}

export function occupiedStorageFootprintAreaSqMm(
  placements: readonly StorageStackPlacementRow[],
) {
  return occupiedFootprintAreaSqMm(storagePlacementBoxes(placements));
}

export interface StoragePlacementBox {
  readonly placement: StorageStackPlacementRow;
  readonly xMm: number;
  readonly yMm: number;
  readonly zMm: number;
  readonly widthMm: number;
  readonly depthMm: number;
  readonly heightMm: number;
}

export function hasExactStorageCoordinates(
  placement: StorageStackPlacementRow,
) {
  return (
    Number.isFinite(placement.xMm) &&
    Number.isFinite(placement.yMm) &&
    Number.isFinite(placement.zMm ?? 0)
  );
}

/** Canonical placements have explicit local coordinates; only legacy rows stack. */
export function storagePlacementBoxes(
  placements: readonly StorageStackPlacementRow[],
  origin: { readonly xMm: number; readonly yMm: number } = { xMm: 0, yMm: 0 },
): StoragePlacementBox[] {
  let legacyElevation = 0;
  return [...placements]
    .sort((a, b) => a.levelIndex - b.levelIndex)
    .flatMap((placement) => {
      if (
        ![placement.widthMm, placement.depthMm, placement.heightMm].every(
          (n) => Number.isFinite(n) && n > 0,
        )
      )
        return [];
      const exact = hasExactStorageCoordinates(placement);
      const xMm = exact ? placement.xMm! : 0;
      const yMm = exact ? placement.yMm! : 0;
      const zMm = exact ? (placement.zMm ?? 0) : legacyElevation;
      if (!exact) legacyElevation += placement.heightMm;
      if (xMm < 0 || yMm < 0 || zMm < 0) return [];
      return [
        {
          placement,
          xMm: origin.xMm + xMm,
          yMm: origin.yMm + yMm,
          zMm,
          widthMm:
            !exact && placement.orientation === "ROTATED"
              ? placement.depthMm
              : placement.widthMm,
          depthMm:
            !exact && placement.orientation === "ROTATED"
              ? placement.widthMm
              : placement.depthMm,
          heightMm: placement.heightMm,
        },
      ];
    });
}

export function maximumOccupiedHeight(
  placements: readonly StorageStackPlacementRow[],
) {
  return Math.max(
    0,
    ...storagePlacementBoxes(placements).map((box) => box.zMm + box.heightMm),
  );
}

export function storagePlacementCorners(
  box: Omit<StoragePlacementBox, "placement">,
) {
  return [0, box.heightMm].flatMap((height) => [
    { x: box.xMm, y: box.yMm, z: box.zMm + height },
    { x: box.xMm + box.widthMm, y: box.yMm, z: box.zMm + height },
    { x: box.xMm + box.widthMm, y: box.yMm + box.depthMm, z: box.zMm + height },
    { x: box.xMm, y: box.yMm + box.depthMm, z: box.zMm + height },
  ]);
}

export const rectanglesOverlap = (
  left: {
    readonly xMm: number;
    readonly yMm: number;
    readonly widthMm: number;
    readonly depthMm: number;
  },
  right: {
    readonly xMm: number;
    readonly yMm: number;
    readonly widthMm: number;
    readonly depthMm: number;
  },
) =>
  left.xMm < right.xMm + right.widthMm &&
  left.xMm + left.widthMm > right.xMm &&
  left.yMm < right.yMm + right.depthMm &&
  left.yMm + left.depthMm > right.yMm;
