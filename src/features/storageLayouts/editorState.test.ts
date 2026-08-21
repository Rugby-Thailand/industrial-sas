import { describe, expect, it } from "vitest";

import {
  createStorageLayoutEditorState,
  storageLayoutEditorReducer,
} from "./editorState";

describe("storageLayoutEditorReducer", () => {
  it("grows and shrinks sequential floors while preserving existing edits", () => {
    const initial = createStorageLayoutEditorState({
      widthMm: 30_000,
      depthMm: 20_000,
      defaultFloorHeightMm: 4_000,
      floors: [{ floorNumber: 1, reservedBlocks: [] }],
    });
    const grown = storageLayoutEditorReducer(initial, {
      type: "setFloorCount",
      floorCount: 3,
    });
    const edited = storageLayoutEditorReducer(grown, {
      type: "setFloorDimension",
      floorNumber: 2,
      field: "widthMm",
      value: 18_000,
    });
    const shrunk = storageLayoutEditorReducer(edited, {
      type: "setFloorCount",
      floorCount: 2,
    });

    expect(shrunk.layout.floors).toEqual([
      { floorNumber: 1, reservedBlocks: [] },
      { floorNumber: 2, widthMm: 18_000, reservedBlocks: [] },
    ]);
    expect(shrunk.selectedFloorNumber).toBe(2);
    expect(shrunk.dirtyFloorNumbers).toEqual([2]);
  });

  it("adds, moves, resizes, and removes a reserved block immutably", () => {
    const initial = createStorageLayoutEditorState({
      widthMm: 10_000,
      depthMm: 8_000,
      defaultFloorHeightMm: 3_000,
      floors: [{ floorNumber: 1, reservedBlocks: [] }],
    });
    const added = storageLayoutEditorReducer(initial, {
      type: "addReservedBlock",
      floorNumber: 1,
      block: {
        id: "dock",
        label: "Dock",
        xMm: 0,
        yMm: 0,
        widthMm: 2_000,
        depthMm: 2_000,
      },
    });
    const moved = storageLayoutEditorReducer(added, {
      type: "updateReservedBlock",
      floorNumber: 1,
      blockId: "dock",
      changes: { xMm: 3_000, widthMm: 2_500 },
    });
    const removed = storageLayoutEditorReducer(moved, {
      type: "removeReservedBlock",
      floorNumber: 1,
      blockId: "dock",
    });

    expect(initial.layout.floors[0]!.reservedBlocks).toEqual([]);
    expect(moved.layout.floors[0]!.reservedBlocks[0]).toEqual(
      expect.objectContaining({ xMm: 3_000, widthMm: 2_500 }),
    );
    expect(removed.layout.floors[0]!.reservedBlocks).toEqual([]);
  });
});
