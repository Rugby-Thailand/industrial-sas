/** Exact placements use integer millimetres, relative to a location origin. */
export interface Rectangle {
  xMm: number;
  yMm: number;
  widthMm: number;
  depthMm: number;
}
export interface Box extends Rectangle {
  zMm: number;
  heightMm: number;
}
export interface Surface extends Box {}
export interface MeasuredSize {
  lengthMm: number;
  widthMm: number;
  heightMm: number;
}
export type Rotation = 0 | 90;
export const MAX_DIMENSION_MM = 100_000;
export function validDimension(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= MAX_DIMENSION_MM
  );
}
export function measured(input: {
  lengthMm?: number;
  widthMm?: number;
  heightMm?: number;
}): input is MeasuredSize {
  return (
    validDimension(input.lengthMm) &&
    validDimension(input.widthMm) &&
    validDimension(input.heightMm)
  );
}
export function overlaps(a: Rectangle, b: Rectangle) {
  return (
    a.xMm < b.xMm + b.widthMm &&
    a.xMm + a.widthMm > b.xMm &&
    a.yMm < b.yMm + b.depthMm &&
    a.yMm + a.depthMm > b.yMm
  );
}
export function boxesOverlap(a: Box, b: Box) {
  return (
    overlaps(a, b) && a.zMm < b.zMm + b.heightMm && a.zMm + a.heightMm > b.zMm
  );
}
/** X follows measured width; Y follows measured length, matching the shared 3D control. */
export function dimensions(size: MeasuredSize, rotation: Rotation) {
  return {
    widthMm: rotation === 0 ? size.widthMm : size.lengthMm,
    depthMm: rotation === 0 ? size.lengthMm : size.widthMm,
    heightMm: size.heightMm,
  };
}
export function placementError(
  box: Box,
  surface: Surface,
  occupied: readonly Box[],
  unavailable: readonly Rectangle[],
): string | null {
  if (
    ![box.xMm, box.yMm, box.zMm].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    ) ||
    ![box.widthMm, box.depthMm, box.heightMm].every(validDimension)
  )
    return "POSITION_INVALID";
  if (box.zMm !== surface.zMm) return "SUPPORT_REQUIRED";
  if (
    box.xMm < surface.xMm ||
    box.yMm < surface.yMm ||
    box.xMm + box.widthMm > surface.xMm + surface.widthMm ||
    box.yMm + box.depthMm > surface.yMm + surface.depthMm
  )
    return "OUTSIDE_LOCATION";
  if (box.heightMm > surface.heightMm) return "HEIGHT_EXCEEDED";
  if (unavailable.some((other) => overlaps(box, other)))
    return "UNAVAILABLE_AREA";
  if (occupied.some((other) => boxesOverlap(box, other)))
    return "SPACE_OCCUPIED";
  return null;
}
/**
 * Exact bottom-left sweep. A feasible placement can be slid to the surface edge
 * or an obstacle edge, so only obstacle top edges are candidate rows. At each
 * row, merge the forbidden X intervals in one sorted pass rather than testing
 * every X/Y pair against every obstacle. Worst-case work is quadratic, not cubic.
 */
export function firstFit(
  size: MeasuredSize,
  surface: Surface,
  occupied: readonly Box[],
  unavailable: readonly Rectangle[],
) {
  if (!measured(size) || size.heightMm > surface.heightMm) return null;
  const obstacles: readonly Rectangle[] = [
    ...occupied.filter(
      (b) =>
        b.zMm < surface.zMm + size.heightMm && b.zMm + b.heightMm > surface.zMm,
    ),
    ...unavailable,
  ]
    .filter((obstacle) => overlaps(surface, obstacle))
    .sort((a, b) => a.xMm - b.xMm || a.yMm - b.yMm);
  const ys = [
    ...new Set([surface.yMm, ...obstacles.map((b) => b.yMm + b.depthMm)]),
  ]
    .filter((y) => y >= surface.yMm && y < surface.yMm + surface.depthMm)
    .sort((a, b) => a - b);

  const leftmost = (yMm: number, rotation: Rotation) => {
    const footprint = dimensions(size, rotation);
    const maxX = surface.xMm + surface.widthMm - footprint.widthMm;
    if (
      maxX < surface.xMm ||
      yMm + footprint.depthMm > surface.yMm + surface.depthMm
    )
      return null;
    let xMm = surface.xMm;
    for (const obstacle of obstacles) {
      if (
        obstacle.yMm >= yMm + footprint.depthMm ||
        obstacle.yMm + obstacle.depthMm <= yMm
      )
        continue;
      // Remaining obstacles start even farther right: the current gap fits.
      if (obstacle.xMm >= xMm + footprint.widthMm) break;
      if (obstacle.xMm + obstacle.widthMm > xMm)
        xMm = obstacle.xMm + obstacle.widthMm;
      if (xMm > maxX) return null;
    }
    const box = { xMm, yMm, zMm: surface.zMm, ...footprint, rotation };
    return placementError(box, surface, occupied, unavailable) === null
      ? box
      : null;
  };
  for (const yMm of ys) {
    const defaultFit = leftmost(yMm, 0);
    const rotatedFit = leftmost(yMm, 90);
    if (defaultFit && rotatedFit)
      return defaultFit.xMm <= rotatedFit.xMm ? defaultFit : rotatedFit;
    if (defaultFit || rotatedFit) return defaultFit ?? rotatedFit;
  }
  return null;
}
