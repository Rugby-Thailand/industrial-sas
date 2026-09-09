import {
  projectIsometricPoint,
  unprojectIsometricDelta,
} from "@/lib/storageLayouts/isometricGeometry";

export interface PalletDimensions {
  readonly widthMm: number;
  readonly depthMm: number;
  readonly heightMm: number;
}

export interface PalletPlacement {
  readonly xMm: number;
  readonly yMm: number;
  readonly rotation: 0 | 90;
  readonly zMm?: number;
}

export interface OccupiedPallet extends PalletDimensions {
  readonly id: string;
  readonly label: string;
  readonly xMm: number;
  readonly yMm: number;
  readonly status: "RESERVED" | "STORED";
  readonly zMm?: number;
}

export interface PalletSupport extends PalletDimensions {
  readonly xMm: number;
  readonly yMm: number;
  readonly zMm: number;
}

/** Preview surfaces include rejected supports so invalid attempts remain visible. */
export interface PlacementSurface extends PalletSupport {
  readonly supportPalletId?: string | undefined;
  readonly supportPositionId?: string | undefined;
  readonly baseSupportPositionId?: string | undefined;
  readonly supportCode?: string | undefined;
  readonly blockedReason?: string | undefined;
}

export function resolvePalletSupport(
  placement: PalletPlacement,
  dimensions: PalletDimensions,
  base: PlacementSurface,
  surfaces: readonly PlacementSurface[],
): PlacementSurface {
  const footprint = palletFootprint(dimensions, placement.rotation);
  const overlaps = (other: PlacementSurface) =>
    placement.xMm < other.xMm + other.widthMm &&
    placement.xMm + footprint.widthMm > other.xMm &&
    placement.yMm < other.yMm + other.depthMm &&
    placement.yMm + footprint.depthMm > other.yMm;
  return (
    surfaces
      .filter(
        (s) =>
          s.supportPalletId &&
          s.baseSupportPositionId === base.supportPositionId &&
          s.zMm >= base.zMm &&
          overlaps(s),
      )
      .sort(
        (a, b) =>
          b.zMm - a.zMm ||
          (a.supportPalletId ?? "").localeCompare(b.supportPalletId ?? ""),
      )[0] ?? base
  );
}

export interface UnavailablePalletArea {
  readonly id?: string;
  readonly xMm: number;
  readonly yMm: number;
  readonly widthMm: number;
  readonly depthMm: number;
}

export function validDimensions(dimensions: PalletDimensions): boolean {
  return [dimensions.widthMm, dimensions.depthMm, dimensions.heightMm].every(
    (value) => Number.isFinite(value) && value > 0 && value <= 100_000_000,
  );
}

export function palletFootprint(
  dimensions: PalletDimensions,
  rotation: 0 | 90,
): PalletDimensions {
  return rotation === 90
    ? {
        ...dimensions,
        widthMm: dimensions.depthMm,
        depthMm: dimensions.widthMm,
      }
    : dimensions;
}

export function constrainPalletPlacement(
  requested: PalletPlacement,
  dimensions: PalletDimensions,
  area: PalletDimensions,
  support?: PalletSupport,
): PalletPlacement {
  const footprint = palletFootprint(dimensions, requested.rotation);
  const snapAndClamp = (value: number, maximum: number) =>
    Math.max(
      0,
      Math.min(
        Math.round((Number.isFinite(value) ? value : 0) / 100) * 100,
        Math.max(0, maximum),
      ),
    );
  return {
    ...requested,
    ...(support ? { zMm: support.zMm } : {}),
    xMm:
      (support?.xMm ?? 0) +
      snapAndClamp(
        requested.xMm - (support?.xMm ?? 0),
        (support?.widthMm ?? area.widthMm) - footprint.widthMm,
      ),
    yMm:
      (support?.yMm ?? 0) +
      snapAndClamp(
        requested.yMm - (support?.yMm ?? 0),
        (support?.depthMm ?? area.depthMm) - footprint.depthMm,
      ),
  };
}

export function palletPlacementIssue(
  dimensions: PalletDimensions,
  area: PalletDimensions,
  placement: PalletPlacement,
  occupied: readonly OccupiedPallet[],
  support?: PalletSupport,
  unavailable: readonly UnavailablePalletArea[] = [],
): "dimensions" | "boundary" | "support" | "height" | "overlap" | undefined {
  if (!validDimensions(dimensions) || !validDimensions(area))
    return "dimensions";
  const footprint = palletFootprint(dimensions, placement.rotation);
  if (
    !Number.isFinite(placement.xMm) ||
    !Number.isFinite(placement.yMm) ||
    placement.xMm < 0 ||
    placement.yMm < 0 ||
    placement.xMm + footprint.widthMm > area.widthMm ||
    placement.yMm + footprint.depthMm > area.depthMm
  )
    return "boundary";
  if (
    support &&
    (placement.xMm < support.xMm ||
      placement.yMm < support.yMm ||
      placement.xMm + footprint.widthMm > support.xMm + support.widthMm ||
      placement.yMm + footprint.depthMm > support.yMm + support.depthMm)
  )
    return "support";
  const elevation = placement.zMm ?? support?.zMm ?? 0;
  if (
    !Number.isFinite(elevation) ||
    elevation < 0 ||
    dimensions.heightMm + elevation > area.heightMm ||
    (support !== undefined && dimensions.heightMm > support.heightMm)
  )
    return "height";
  if (
    occupied.some(
      (other) =>
        placement.xMm < other.xMm + other.widthMm &&
        placement.xMm + footprint.widthMm > other.xMm &&
        placement.yMm < other.yMm + other.depthMm &&
        placement.yMm + footprint.depthMm > other.yMm &&
        elevation < (other.zMm ?? 0) + other.heightMm &&
        elevation + dimensions.heightMm > (other.zMm ?? 0),
    )
  )
    return "overlap";
  if (
    unavailable.some(
      (other) =>
        placement.xMm < other.xMm + other.widthMm &&
        placement.xMm + footprint.widthMm > other.xMm &&
        placement.yMm < other.yMm + other.depthMm &&
        placement.yMm + footprint.depthMm > other.yMm,
    )
  )
    return "overlap";
  return undefined;
}

export function rotatePalletPoint(x: number, y: number, quarterTurns: number) {
  switch (((quarterTurns % 4) + 4) % 4) {
    case 1:
      return { x: -y, y: x };
    case 2:
      return { x: -x, y: -y };
    case 3:
      return { x: y, y: -x };
    default:
      return { x, y };
  }
}

export function projectPalletPoint(
  x: number,
  y: number,
  z: number,
  quarterTurns: number,
  planView: boolean,
) {
  const rotated = rotatePalletPoint(x, y, quarterTurns);
  return planView ? rotated : projectIsometricPoint({ ...rotated, z });
}

export function unprojectPalletDelta(
  x: number,
  y: number,
  quarterTurns: number,
  planView: boolean,
) {
  const flat = planView ? { x, y } : unprojectIsometricDelta({ x, y }, 1);
  return rotatePalletPoint(flat.x, flat.y, -quarterTurns);
}
