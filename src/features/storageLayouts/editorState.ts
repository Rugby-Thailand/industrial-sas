import type {
  StorageFloorInput,
  StorageLayoutInput,
  StorageReservedBlockInput,
} from "../../../convex/model/storageLayout/storageLayout";

export interface StorageLayoutEditorState {
  readonly layout: StorageLayoutInput;
  readonly selectedFloorNumber: number;
  readonly dirtyFloorNumbers: readonly number[];
}

export type StorageLayoutEditorAction =
  | { readonly type: "selectFloor"; readonly floorNumber: number }
  | {
      readonly type: "setBuildingDimension";
      readonly field: "widthMm" | "depthMm" | "defaultFloorHeightMm";
      readonly value: number;
    }
  | { readonly type: "setFloorCount"; readonly floorCount: number }
  | {
      readonly type: "setFloorDimension";
      readonly floorNumber: number;
      readonly field: "widthMm" | "depthMm" | "heightMm";
      readonly value: number | undefined;
    }
  | {
      readonly type: "addReservedBlock";
      readonly floorNumber: number;
      readonly block: StorageReservedBlockInput;
    }
  | {
      readonly type: "updateReservedBlock";
      readonly floorNumber: number;
      readonly blockId: string;
      readonly changes: Partial<Omit<StorageReservedBlockInput, "id">>;
    }
  | {
      readonly type: "removeReservedBlock";
      readonly floorNumber: number;
      readonly blockId: string;
    }
  | { readonly type: "markSaved"; readonly floorNumber?: number };

export function createStorageLayoutEditorState(
  layout: StorageLayoutInput,
): StorageLayoutEditorState {
  return {
    layout,
    selectedFloorNumber: layout.floors[0]?.floorNumber ?? 1,
    dirtyFloorNumbers: [],
  };
}

function markDirty(
  state: StorageLayoutEditorState,
  floorNumber: number,
): readonly number[] {
  return state.dirtyFloorNumbers.includes(floorNumber)
    ? state.dirtyFloorNumbers
    : [...state.dirtyFloorNumbers, floorNumber].sort(
        (left, right) => left - right,
      );
}

function updateFloor(
  state: StorageLayoutEditorState,
  floorNumber: number,
  update: (floor: StorageFloorInput) => StorageFloorInput,
): StorageLayoutEditorState {
  return {
    ...state,
    selectedFloorNumber: floorNumber,
    dirtyFloorNumbers: markDirty(state, floorNumber),
    layout: {
      ...state.layout,
      floors: state.layout.floors.map((floor) =>
        floor.floorNumber === floorNumber ? update(floor) : floor,
      ),
    },
  };
}

export function storageLayoutEditorReducer(
  state: StorageLayoutEditorState,
  action: StorageLayoutEditorAction,
): StorageLayoutEditorState {
  switch (action.type) {
    case "selectFloor":
      return { ...state, selectedFloorNumber: action.floorNumber };
    case "setBuildingDimension":
      return {
        ...state,
        layout: { ...state.layout, [action.field]: action.value },
        dirtyFloorNumbers: state.layout.floors.map(
          (floor) => floor.floorNumber,
        ),
      };
    case "setFloorCount": {
      const floorCount = Math.max(
        1,
        Math.min(50, Math.trunc(action.floorCount)),
      );
      const floors = Array.from({ length: floorCount }, (_, index) => {
        return (
          state.layout.floors[index] ?? {
            floorNumber: index + 1,
            reservedBlocks: [],
          }
        );
      });
      return {
        ...state,
        selectedFloorNumber: Math.min(state.selectedFloorNumber, floorCount),
        dirtyFloorNumbers: state.dirtyFloorNumbers.filter(
          (floorNumber) => floorNumber <= floorCount,
        ),
        layout: { ...state.layout, floors },
      };
    }
    case "setFloorDimension":
      return updateFloor(state, action.floorNumber, (floor) => ({
        ...floor,
        [action.field]: action.value,
      }));
    case "addReservedBlock":
      return updateFloor(state, action.floorNumber, (floor) => ({
        ...floor,
        reservedBlocks: [...floor.reservedBlocks, action.block],
      }));
    case "updateReservedBlock":
      return updateFloor(state, action.floorNumber, (floor) => ({
        ...floor,
        reservedBlocks: floor.reservedBlocks.map((block) =>
          block.id === action.blockId ? { ...block, ...action.changes } : block,
        ),
      }));
    case "removeReservedBlock":
      return updateFloor(state, action.floorNumber, (floor) => ({
        ...floor,
        reservedBlocks: floor.reservedBlocks.filter(
          (block) => block.id !== action.blockId,
        ),
      }));
    case "markSaved":
      return {
        ...state,
        dirtyFloorNumbers:
          action.floorNumber === undefined
            ? []
            : state.dirtyFloorNumbers.filter(
                (floorNumber) => floorNumber !== action.floorNumber,
              ),
      };
  }
}
