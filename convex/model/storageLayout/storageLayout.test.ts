import { describe, expect, it } from "vitest";

import { validateAndSummarizeStorageLayout } from "./storageLayout";

const block = (
  id: string,
  xMm: number,
  yMm: number,
  widthMm: number,
  depthMm: number,
) => ({ id, label: id, xMm, yMm, widthMm, depthMm });

describe("validateAndSummarizeStorageLayout", () => {
  it("inherits building dimensions and exactly summarizes mixed floors", () => {
    const result = validateAndSummarizeStorageLayout({
      widthMm: 30_000,
      depthMm: 20_000,
      defaultFloorHeightMm: 4_000,
      floors: [
        {
          floorNumber: 1,
          heightMm: 4_500,
          reservedBlocks: [block("staging", 0, 0, 8_000, 6_000)],
        },
        {
          floorNumber: 2,
          reservedBlocks: [block("core", 12_000, 8_000, 4_000, 6_000)],
        },
        {
          floorNumber: 3,
          widthMm: 20_000,
          depthMm: 12_000,
          reservedBlocks: [block("lift", 0, 0, 4_000, 4_000)],
        },
        {
          floorNumber: 4,
          widthMm: 20_000,
          depthMm: 12_000,
          reservedBlocks: [block("lift", 0, 0, 4_000, 4_000)],
        },
      ],
    });

    expect(result).toEqual({
      ok: true,
      value: {
        totalHeightMm: 16_500,
        grossAreaSqMm: 1_680_000_000,
        reservedAreaSqMm: 104_000_000,
        usableAreaSqMm: 1_576_000_000,
        floors: [
          expect.objectContaining({
            floorNumber: 1,
            widthMm: 30_000,
            depthMm: 20_000,
            heightMm: 4_500,
            usableAreaSqMm: 552_000_000,
          }),
          expect.objectContaining({
            floorNumber: 2,
            usableAreaSqMm: 576_000_000,
          }),
          expect.objectContaining({
            floorNumber: 3,
            widthMm: 20_000,
            depthMm: 12_000,
            usableAreaSqMm: 224_000_000,
          }),
          expect.objectContaining({
            floorNumber: 4,
            usableAreaSqMm: 224_000_000,
          }),
        ],
      },
    });
  });

  it("rejects overlapping reserved blocks", () => {
    const result = validateAndSummarizeStorageLayout({
      widthMm: 10_000,
      depthMm: 10_000,
      defaultFloorHeightMm: 3_000,
      floors: [
        {
          floorNumber: 1,
          reservedBlocks: [
            block("a", 0, 0, 4_000, 4_000),
            block("b", 3_999, 0, 2_000, 2_000),
          ],
        },
      ],
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "RESERVED_BLOCKS_OVERLAP",
        floorNumber: 1,
        blockIds: ["a", "b"],
      },
    });
  });

  it("allows blocks that only touch and rejects a block outside the floor", () => {
    const touching = validateAndSummarizeStorageLayout({
      widthMm: 10_000,
      depthMm: 10_000,
      defaultFloorHeightMm: 3_000,
      floors: [
        {
          floorNumber: 1,
          reservedBlocks: [
            block("a", 0, 0, 4_000, 4_000),
            block("b", 4_000, 0, 6_000, 4_000),
          ],
        },
      ],
    });
    expect(touching.ok).toBe(true);

    const outside = validateAndSummarizeStorageLayout({
      widthMm: 10_000,
      depthMm: 10_000,
      defaultFloorHeightMm: 3_000,
      floors: [
        {
          floorNumber: 1,
          reservedBlocks: [block("dock", 9_000, 0, 2_000, 2_000)],
        },
      ],
    });
    expect(outside).toEqual({
      ok: false,
      error: {
        code: "RESERVED_BLOCK_OUT_OF_BOUNDS",
        floorNumber: 1,
        blockId: "dock",
      },
    });
  });

  it("requires a continuous, unique sequence of 1 to 50 floors", () => {
    const missing = validateAndSummarizeStorageLayout({
      widthMm: 10_000,
      depthMm: 10_000,
      defaultFloorHeightMm: 3_000,
      floors: [
        { floorNumber: 1, reservedBlocks: [] },
        { floorNumber: 3, reservedBlocks: [] },
      ],
    });
    expect(missing).toEqual({
      ok: false,
      error: { code: "FLOOR_SEQUENCE_INVALID", expected: 2, received: 3 },
    });

    const tooMany = validateAndSummarizeStorageLayout({
      widthMm: 10_000,
      depthMm: 10_000,
      defaultFloorHeightMm: 3_000,
      floors: Array.from({ length: 51 }, (_, index) => ({
        floorNumber: index + 1,
        reservedBlocks: [],
      })),
    });
    expect(tooMany).toEqual({
      ok: false,
      error: { code: "FLOOR_COUNT_INVALID", floorCount: 51 },
    });
  });
});
