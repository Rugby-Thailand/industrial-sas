import { fail, ok, type Result } from "../result";

export const STORAGE_ZONE_LIMITS = Object.freeze({
  maximumZonesPerFloor: 500,
  maximumPlacementsPerZone: 50,
  maximumDimensionMm: 1_000_000,
});

export interface StorageRectangle {
  readonly xMm: number;
  readonly yMm: number;
  readonly widthMm: number;
  readonly depthMm: number;
}

export interface StorageZoneCandidate extends StorageRectangle {
  readonly maxStackHeightMm: number;
}

export interface StackPlacement {
  readonly levelIndex: number;
  readonly heightMm: number;
}

export type StorageZoneError =
  | { readonly code: "ZONE_DIMENSION_INVALID"; readonly field: string }
  | { readonly code: "ZONE_OUT_OF_BOUNDS" }
  | { readonly code: "ZONE_OVERLAPS_RESERVED_SPACE" }
  | { readonly code: "ZONE_OVERLAPS_STORAGE_ZONE" }
  | { readonly code: "HANDLING_UNIT_DOES_NOT_FIT" }
  | { readonly code: "STACK_SEQUENCE_INVALID" };

function positiveDimension(value: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= STORAGE_ZONE_LIMITS.maximumDimensionMm
  );
}

function nonNegativeCoordinate(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function storageRectanglesOverlap(
  left: StorageRectangle,
  right: StorageRectangle,
): boolean {
  return !(
    left.xMm + left.widthMm <= right.xMm ||
    right.xMm + right.widthMm <= left.xMm ||
    left.yMm + left.depthMm <= right.yMm ||
    right.yMm + right.depthMm <= left.yMm
  );
}

export function validateStorageZone(input: {
  readonly floorWidthMm: number;
  readonly floorDepthMm: number;
  readonly floorHeightMm: number;
  readonly candidate: StorageZoneCandidate;
  readonly reserved: readonly StorageRectangle[];
  readonly zones: readonly StorageRectangle[];
}): Result<StorageZoneCandidate, StorageZoneError> {
  const { candidate } = input;
  for (const [field, value, valid] of [
    ["xMm", candidate.xMm, nonNegativeCoordinate(candidate.xMm)],
    ["yMm", candidate.yMm, nonNegativeCoordinate(candidate.yMm)],
    ["widthMm", candidate.widthMm, positiveDimension(candidate.widthMm)],
    ["depthMm", candidate.depthMm, positiveDimension(candidate.depthMm)],
    [
      "maxStackHeightMm",
      candidate.maxStackHeightMm,
      positiveDimension(candidate.maxStackHeightMm),
    ],
  ] as const) {
    if (!valid || !Number.isSafeInteger(value)) {
      return fail({ code: "ZONE_DIMENSION_INVALID", field });
    }
  }
  if (
    candidate.xMm + candidate.widthMm > input.floorWidthMm ||
    candidate.yMm + candidate.depthMm > input.floorDepthMm ||
    candidate.maxStackHeightMm > input.floorHeightMm
  ) {
    return fail({ code: "ZONE_OUT_OF_BOUNDS" });
  }
  if (
    input.reserved.some((area) => storageRectanglesOverlap(candidate, area))
  ) {
    return fail({ code: "ZONE_OVERLAPS_RESERVED_SPACE" });
  }
  if (input.zones.some((zone) => storageRectanglesOverlap(candidate, zone))) {
    return fail({ code: "ZONE_OVERLAPS_STORAGE_ZONE" });
  }
  return ok(Object.freeze({ ...candidate }));
}

export function planStackPlacement(input: {
  readonly zone: Pick<
    StorageZoneCandidate,
    "widthMm" | "depthMm" | "maxStackHeightMm"
  >;
  readonly placements: readonly StackPlacement[];
  readonly handlingUnit: {
    readonly widthMm: number;
    readonly depthMm: number;
    readonly heightMm: number;
  };
}): Result<
  {
    readonly levelIndex: number;
    readonly orientation: "DEFAULT" | "ROTATED";
    readonly occupiedHeightMm: number;
    readonly resultingHeightMm: number;
    readonly capacityWarning: boolean;
  },
  StorageZoneError
> {
  for (const [field, value] of Object.entries(input.handlingUnit)) {
    if (!positiveDimension(value)) {
      return fail({ code: "ZONE_DIMENSION_INVALID", field });
    }
  }
  const direct =
    input.handlingUnit.widthMm <= input.zone.widthMm &&
    input.handlingUnit.depthMm <= input.zone.depthMm;
  const rotated =
    input.handlingUnit.depthMm <= input.zone.widthMm &&
    input.handlingUnit.widthMm <= input.zone.depthMm;
  if (!direct && !rotated) return fail({ code: "HANDLING_UNIT_DOES_NOT_FIT" });

  const ordered = [...input.placements].sort(
    (left, right) => left.levelIndex - right.levelIndex,
  );
  if (
    ordered.some(
      (placement, index) =>
        placement.levelIndex !== index + 1 ||
        !positiveDimension(placement.heightMm),
    )
  ) {
    return fail({ code: "STACK_SEQUENCE_INVALID" });
  }
  const occupiedHeightMm = ordered.reduce(
    (total, placement) => total + placement.heightMm,
    0,
  );
  const resultingHeightMm = occupiedHeightMm + input.handlingUnit.heightMm;
  return ok(
    Object.freeze({
      levelIndex: ordered.length + 1,
      orientation: direct ? "DEFAULT" : "ROTATED",
      occupiedHeightMm,
      resultingHeightMm,
      capacityWarning: resultingHeightMm > input.zone.maxStackHeightMm,
    }),
  );
}

export function makeStorageZoneCode(
  buildingCode: string,
  floorNumber: number,
  ordinal: number,
): string {
  return `${buildingCode}-F${String(floorNumber).padStart(2, "0")}-Z${String(ordinal).padStart(2, "0")}`;
}

export function makeStorageZoneQrValue(locationId: string): string {
  return `ISAS:LOCATION:1:${locationId}`;
}
