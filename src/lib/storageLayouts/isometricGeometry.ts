export interface IsometricPoint3d {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface IsometricPoint2d {
  readonly x: number;
  readonly y: number;
}

export interface IsometricFloor {
  readonly floorNumber: number;
  readonly widthMm: number;
  readonly depthMm: number;
  readonly heightMm: number;
  /** Placement relative to the building (floor 1) or previous floor. */
  readonly offsetXMm?: number;
  readonly offsetYMm?: number;
}

export interface IsometricSlab {
  readonly floorNumber: number;
  readonly elevationMm: number;
  readonly top: readonly IsometricPoint2d[];
  readonly left: readonly IsometricPoint2d[];
  readonly right: readonly IsometricPoint2d[];
}

export function projectIsometricPoint(
  point: IsometricPoint3d,
): IsometricPoint2d {
  return { x: point.x - point.y, y: (point.x + point.y) / 2 - point.z };
}

/** Converts a screen-space drag on a constant-Z plane back to model units. */
export function unprojectIsometricDelta(
  delta: IsometricPoint2d,
  scale: number,
): { readonly x: number; readonly y: number } {
  return {
    x: (delta.y + delta.x / 2) / scale,
    y: (delta.y - delta.x / 2) / scale,
  };
}

function polygon(
  points: readonly IsometricPoint3d[],
  scale: number,
  floorOffset: number,
): readonly IsometricPoint2d[] {
  return points.map((point) => {
    const projected = projectIsometricPoint({
      x: point.x * scale,
      y: point.y * scale,
      z: point.z * scale,
    });
    return { x: projected.x, y: projected.y - floorOffset };
  });
}

export function buildIsometricBuilding(
  floors: readonly IsometricFloor[],
  options: {
    readonly scale?: number;
    readonly gap?: number;
    readonly envelopeWidthMm?: number;
    readonly envelopeDepthMm?: number;
  } = {},
): {
  readonly slabs: readonly IsometricSlab[];
  readonly viewBox: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
} {
  const scale = options.scale ?? 0.01;
  const gap = options.gap ?? 10;
  const envelopeWidthMm = Math.max(
    options.envelopeWidthMm ?? 0,
    ...floors.map((floor) => floor.widthMm),
  );
  const envelopeDepthMm = Math.max(
    options.envelopeDepthMm ?? 0,
    ...floors.map((floor) => floor.depthMm),
  );
  let elevationMm = 0;
  let parentX = 0;
  let parentY = 0;
  let parentWidthMm = envelopeWidthMm;
  let parentDepthMm = envelopeDepthMm;
  const slabs = floors.map((floor, index) => {
    const z0 = elevationMm;
    const z1 = elevationMm + floor.heightMm;
    const x0 =
      parentX +
      (floor.offsetXMm ?? Math.max(0, (parentWidthMm - floor.widthMm) / 2));
    const y0 =
      parentY +
      (floor.offsetYMm ?? Math.max(0, (parentDepthMm - floor.depthMm) / 2));
    const x1 = x0 + floor.widthMm;
    const y1 = y0 + floor.depthMm;
    const offset = index * gap;
    const top = polygon(
      [
        { x: x0, y: y0, z: z1 },
        { x: x1, y: y0, z: z1 },
        { x: x1, y: y1, z: z1 },
        { x: x0, y: y1, z: z1 },
      ],
      scale,
      offset,
    );
    const left = polygon(
      [
        { x: x0, y: y1, z: z1 },
        { x: x1, y: y1, z: z1 },
        { x: x1, y: y1, z: z0 },
        { x: x0, y: y1, z: z0 },
      ],
      scale,
      offset,
    );
    const right = polygon(
      [
        { x: x1, y: y0, z: z1 },
        { x: x1, y: y1, z: z1 },
        { x: x1, y: y1, z: z0 },
        { x: x1, y: y0, z: z0 },
      ],
      scale,
      offset,
    );
    const slab = {
      floorNumber: floor.floorNumber,
      elevationMm,
      top,
      left,
      right,
    };
    elevationMm = z1;
    parentX = x0;
    parentY = y0;
    parentWidthMm = floor.widthMm;
    parentDepthMm = floor.depthMm;
    return slab;
  });
  const points = slabs.flatMap((slab) => [
    ...slab.top,
    ...slab.left,
    ...slab.right,
  ]);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minimumX = Math.min(...xs, 0);
  const maximumX = Math.max(...xs, 1);
  const minimumY = Math.min(...ys, 0);
  const maximumY = Math.max(...ys, 1);
  const padding = 24;

  return {
    slabs,
    viewBox: {
      x: minimumX - padding,
      y: minimumY - padding,
      width: maximumX - minimumX + padding * 2,
      height: maximumY - minimumY + padding * 2,
    },
  };
}

export function pointsAttribute(points: readonly IsometricPoint2d[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}
