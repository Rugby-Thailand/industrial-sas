import { fail, ok, type Result } from "../result";

import {
  STORAGE_ZONE_LIMITS,
  storageRectanglesOverlap,
  type StorageRectangle,
} from "./storageZone";

export const STORAGE_AREA_MODES = [
  "SIMPLE",
  "FLOOR_POSITIONS",
  "RACK",
  "PLATFORM",
] as const;

export type StorageAreaMode = (typeof STORAGE_AREA_MODES)[number];

export type StoragePositionKind =
  "DEFAULT" | "FLOOR" | "RACK_SLOT" | "PLATFORM";

export const STORAGE_POSITION_LIMITS = Object.freeze({
  maximumPositionsPerArea: 100,
  maximumRackBays: 50,
  maximumRackLevels: 20,
  maximumRackSlotsPerBay: 10,
});

export interface StorageAreaGeometry extends StorageRectangle {
  readonly maxStackHeightMm: number;
  readonly baseElevationMm?: number;
}

export interface StoragePositionGeometry extends StorageRectangle {
  readonly kind: StoragePositionKind;
  readonly elevationMm?: number;
}

export type StoragePositionError =
  | { readonly code: "POSITION_DIMENSION_INVALID"; readonly field: string }
  | { readonly code: "POSITION_OUT_OF_AREA" }
  | { readonly code: "POSITION_MODE_MISMATCH" }
  | { readonly code: "FLOOR_POSITION_ELEVATION_FORBIDDEN" }
  | { readonly code: "RACK_CONFIGURATION_INVALID"; readonly field: string }
  | { readonly code: "RACK_DOES_NOT_FIT_AREA" };

const positive = (value: number): boolean =>
  Number.isSafeInteger(value) &&
  value > 0 &&
  value <= STORAGE_ZONE_LIMITS.maximumDimensionMm;

const nonNegative = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0;

export function effectiveStorageAreaMode(
  mode: StorageAreaMode | undefined,
): StorageAreaMode {
  return mode ?? "SIMPLE";
}

export function kindForAreaMode(mode: StorageAreaMode): StoragePositionKind {
  switch (mode) {
    case "SIMPLE":
      return "DEFAULT";
    case "FLOOR_POSITIONS":
      return "FLOOR";
    case "RACK":
      return "RACK_SLOT";
    case "PLATFORM":
      return "PLATFORM";
  }
}

export function validateStoragePosition(input: {
  readonly mode: StorageAreaMode;
  readonly area: StorageAreaGeometry;
  readonly position: StoragePositionGeometry;
}): Result<StoragePositionGeometry, StoragePositionError> {
  const { area, position } = input;
  for (const [field, value, valid] of [
    ["xMm", position.xMm, nonNegative(position.xMm)],
    ["yMm", position.yMm, nonNegative(position.yMm)],
    ["widthMm", position.widthMm, positive(position.widthMm)],
    ["depthMm", position.depthMm, positive(position.depthMm)],
  ] as const) {
    if (!valid || !Number.isSafeInteger(value)) {
      return fail({ code: "POSITION_DIMENSION_INVALID", field });
    }
  }

  const allowedKind = kindForAreaMode(input.mode);
  if (
    position.kind !== allowedKind &&
    !(position.kind === "DEFAULT" && input.mode !== "SIMPLE")
  ) {
    return fail({ code: "POSITION_MODE_MISMATCH" });
  }
  if (
    (position.kind === "DEFAULT" || position.kind === "FLOOR") &&
    position.elevationMm !== undefined
  ) {
    return fail({ code: "FLOOR_POSITION_ELEVATION_FORBIDDEN" });
  }
  if (
    position.kind === "PLATFORM" &&
    position.elevationMm !== area.baseElevationMm
  ) {
    return fail({ code: "POSITION_MODE_MISMATCH" });
  }
  if (
    !storageRectanglesOverlap(area, position) ||
    position.xMm < area.xMm ||
    position.yMm < area.yMm ||
    position.xMm + position.widthMm > area.xMm + area.widthMm ||
    position.yMm + position.depthMm > area.yMm + area.depthMm
  ) {
    return fail({ code: "POSITION_OUT_OF_AREA" });
  }
  return ok(Object.freeze({ ...position }));
}

export interface GeneratedRackPosition extends StoragePositionGeometry {
  readonly kind: "RACK_SLOT";
  readonly fixtureCode: string;
  readonly bayIndex: number;
  readonly levelIndex: number;
  readonly slotIndex: number;
  readonly elevationMm: number;
  readonly codeSuffix: string;
}

export function generateRackPositions(input: {
  readonly area: StorageAreaGeometry;
  readonly fixtureCode: string;
  readonly bayCount: number;
  readonly levelCount: number;
  readonly slotsPerBay: number;
  readonly bayWidthMm: number;
  readonly rackDepthMm: number;
  readonly levelHeightMm: number;
}): Result<readonly GeneratedRackPosition[], StoragePositionError> {
  for (const [field, value, maximum] of [
    ["bayCount", input.bayCount, STORAGE_POSITION_LIMITS.maximumRackBays],
    ["levelCount", input.levelCount, STORAGE_POSITION_LIMITS.maximumRackLevels],
    [
      "slotsPerBay",
      input.slotsPerBay,
      STORAGE_POSITION_LIMITS.maximumRackSlotsPerBay,
    ],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
      return fail({ code: "RACK_CONFIGURATION_INVALID", field });
    }
  }
  for (const [field, value] of [
    ["bayWidthMm", input.bayWidthMm],
    ["rackDepthMm", input.rackDepthMm],
    ["levelHeightMm", input.levelHeightMm],
  ] as const) {
    if (!positive(value)) {
      return fail({ code: "RACK_CONFIGURATION_INVALID", field });
    }
  }
  const fixtureCode = input.fixtureCode.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]{0,31}$/.test(fixtureCode)) {
    return fail({ code: "RACK_CONFIGURATION_INVALID", field: "fixtureCode" });
  }
  if (
    input.bayCount * input.bayWidthMm > input.area.widthMm ||
    input.rackDepthMm > input.area.depthMm ||
    input.levelCount * input.levelHeightMm > input.area.maxStackHeightMm
  ) {
    return fail({ code: "RACK_DOES_NOT_FIT_AREA" });
  }

  const slotWidthMm = Math.floor(input.bayWidthMm / input.slotsPerBay);
  if (slotWidthMm < 1) {
    return fail({ code: "RACK_CONFIGURATION_INVALID", field: "slotsPerBay" });
  }
  const positions: GeneratedRackPosition[] = [];
  for (let bayIndex = 1; bayIndex <= input.bayCount; bayIndex += 1) {
    for (let levelIndex = 1; levelIndex <= input.levelCount; levelIndex += 1) {
      for (let slotIndex = 1; slotIndex <= input.slotsPerBay; slotIndex += 1) {
        const xMm =
          input.area.xMm +
          (bayIndex - 1) * input.bayWidthMm +
          (slotIndex - 1) * slotWidthMm;
        positions.push(
          Object.freeze({
            kind: "RACK_SLOT" as const,
            fixtureCode,
            bayIndex,
            levelIndex,
            slotIndex,
            xMm,
            yMm: input.area.yMm,
            widthMm:
              slotIndex === input.slotsPerBay
                ? input.bayWidthMm - slotWidthMm * (slotIndex - 1)
                : slotWidthMm,
            depthMm: input.rackDepthMm,
            elevationMm: (levelIndex - 1) * input.levelHeightMm,
            codeSuffix: `${fixtureCode}-B${String(bayIndex).padStart(2, "0")}-L${String(levelIndex).padStart(2, "0")}-S${String(slotIndex).padStart(2, "0")}`,
          }),
        );
      }
    }
  }
  return ok(Object.freeze(positions));
}

export function storagePositionQrValue(locationId: string): string {
  return `ISAS:LOCATION:1:${locationId}`;
}
