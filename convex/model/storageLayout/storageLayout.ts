import { fail, ok, type Result } from "../result";

export const STORAGE_LAYOUT_LIMITS = Object.freeze({
  minimumFloors: 1,
  maximumFloors: 50,
  maximumReservedBlocksPerFloor: 20,
  maximumDimensionMm: 1_000_000,
});

export interface StorageReservedBlockInput {
  readonly id: string;
  readonly label: string;
  readonly xMm: number;
  readonly yMm: number;
  readonly widthMm: number;
  readonly depthMm: number;
}

export interface StorageFloorInput {
  readonly floorNumber: number;
  readonly widthMm?: number;
  readonly depthMm?: number;
  readonly heightMm?: number;
  readonly reservedBlocks: readonly StorageReservedBlockInput[];
}

export interface StorageLayoutInput {
  readonly widthMm: number;
  readonly depthMm: number;
  readonly defaultFloorHeightMm: number;
  readonly floors: readonly StorageFloorInput[];
}

export interface StorageFloorSummary {
  readonly floorNumber: number;
  readonly widthMm: number;
  readonly depthMm: number;
  readonly heightMm: number;
  readonly grossAreaSqMm: number;
  readonly reservedAreaSqMm: number;
  readonly usableAreaSqMm: number;
}

export interface StorageLayoutSummary {
  readonly totalHeightMm: number;
  readonly grossAreaSqMm: number;
  readonly reservedAreaSqMm: number;
  readonly usableAreaSqMm: number;
  readonly floors: readonly StorageFloorSummary[];
}

export type StorageLayoutError =
  | { readonly code: "FLOOR_COUNT_INVALID"; readonly floorCount: number }
  | {
      readonly code: "FLOOR_SEQUENCE_INVALID";
      readonly expected: number;
      readonly received: number;
    }
  | {
      readonly code: "DIMENSION_INVALID";
      readonly field: string;
      readonly floorNumber?: number;
    }
  | {
      readonly code: "RESERVED_BLOCK_COUNT_INVALID";
      readonly floorNumber: number;
      readonly blockCount: number;
    }
  | {
      readonly code: "RESERVED_BLOCK_INVALID";
      readonly floorNumber: number;
      readonly blockId: string;
    }
  | {
      readonly code: "RESERVED_BLOCK_OUT_OF_BOUNDS";
      readonly floorNumber: number;
      readonly blockId: string;
    }
  | {
      readonly code: "RESERVED_BLOCKS_OVERLAP";
      readonly floorNumber: number;
      readonly blockIds: readonly [string, string];
    };

function validDimension(value: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= STORAGE_LAYOUT_LIMITS.maximumDimensionMm
  );
}

function rectanglesOverlap(
  left: StorageReservedBlockInput,
  right: StorageReservedBlockInput,
): boolean {
  return !(
    left.xMm + left.widthMm <= right.xMm ||
    right.xMm + right.widthMm <= left.xMm ||
    left.yMm + left.depthMm <= right.yMm ||
    right.yMm + right.depthMm <= left.yMm
  );
}

export function validateAndSummarizeStorageLayout(
  input: StorageLayoutInput,
): Result<StorageLayoutSummary, StorageLayoutError> {
  if (
    input.floors.length < STORAGE_LAYOUT_LIMITS.minimumFloors ||
    input.floors.length > STORAGE_LAYOUT_LIMITS.maximumFloors
  ) {
    return fail({
      code: "FLOOR_COUNT_INVALID",
      floorCount: input.floors.length,
    });
  }

  for (const [field, value] of [
    ["widthMm", input.widthMm],
    ["depthMm", input.depthMm],
    ["defaultFloorHeightMm", input.defaultFloorHeightMm],
  ] as const) {
    if (!validDimension(value))
      return fail({ code: "DIMENSION_INVALID", field });
  }

  const floors: StorageFloorSummary[] = [];
  let totalHeightMm = 0;
  let grossAreaSqMm = 0;
  let reservedAreaSqMm = 0;

  for (let index = 0; index < input.floors.length; index += 1) {
    const floor = input.floors[index]!;
    const expected = index + 1;
    if (floor.floorNumber !== expected) {
      return fail({
        code: "FLOOR_SEQUENCE_INVALID",
        expected,
        received: floor.floorNumber,
      });
    }

    const widthMm = floor.widthMm ?? input.widthMm;
    const depthMm = floor.depthMm ?? input.depthMm;
    const heightMm = floor.heightMm ?? input.defaultFloorHeightMm;
    for (const [field, value] of [
      ["widthMm", widthMm],
      ["depthMm", depthMm],
      ["heightMm", heightMm],
    ] as const) {
      if (!validDimension(value)) {
        return fail({
          code: "DIMENSION_INVALID",
          field,
          floorNumber: expected,
        });
      }
    }

    if (
      floor.reservedBlocks.length >
      STORAGE_LAYOUT_LIMITS.maximumReservedBlocksPerFloor
    ) {
      return fail({
        code: "RESERVED_BLOCK_COUNT_INVALID",
        floorNumber: expected,
        blockCount: floor.reservedBlocks.length,
      });
    }

    const ids = new Set<string>();
    let floorReservedArea = 0;
    for (const current of floor.reservedBlocks) {
      if (
        current.id.trim().length === 0 ||
        ids.has(current.id) ||
        !Number.isSafeInteger(current.xMm) ||
        !Number.isSafeInteger(current.yMm) ||
        current.xMm < 0 ||
        current.yMm < 0 ||
        !validDimension(current.widthMm) ||
        !validDimension(current.depthMm)
      ) {
        return fail({
          code: "RESERVED_BLOCK_INVALID",
          floorNumber: expected,
          blockId: current.id,
        });
      }
      ids.add(current.id);
      if (
        current.xMm + current.widthMm > widthMm ||
        current.yMm + current.depthMm > depthMm
      ) {
        return fail({
          code: "RESERVED_BLOCK_OUT_OF_BOUNDS",
          floorNumber: expected,
          blockId: current.id,
        });
      }
      floorReservedArea += current.widthMm * current.depthMm;
    }

    for (let left = 0; left < floor.reservedBlocks.length; left += 1) {
      for (
        let right = left + 1;
        right < floor.reservedBlocks.length;
        right += 1
      ) {
        const leftBlock = floor.reservedBlocks[left]!;
        const rightBlock = floor.reservedBlocks[right]!;
        if (rectanglesOverlap(leftBlock, rightBlock)) {
          return fail({
            code: "RESERVED_BLOCKS_OVERLAP",
            floorNumber: expected,
            blockIds: [leftBlock.id, rightBlock.id],
          });
        }
      }
    }

    const floorGrossArea = widthMm * depthMm;
    floors.push(
      Object.freeze({
        floorNumber: expected,
        widthMm,
        depthMm,
        heightMm,
        grossAreaSqMm: floorGrossArea,
        reservedAreaSqMm: floorReservedArea,
        usableAreaSqMm: floorGrossArea - floorReservedArea,
      }),
    );
    totalHeightMm += heightMm;
    grossAreaSqMm += floorGrossArea;
    reservedAreaSqMm += floorReservedArea;
  }

  return ok(
    Object.freeze({
      totalHeightMm,
      grossAreaSqMm,
      reservedAreaSqMm,
      usableAreaSqMm: grossAreaSqMm - reservedAreaSqMm,
      floors: Object.freeze(floors),
    }),
  );
}
