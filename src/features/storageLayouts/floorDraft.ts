import type {
  StorageBuildingDetail,
  StorageFloorRow,
  StorageReservedBlockRow,
} from "@/lib/convex/storageLayoutApi";
import { resolveAreaColor } from "@/lib/storageLayouts/areaColors";
import { metres, millimetres } from "@/lib/storageLayouts/storageKit";
import type { EditableBlock } from "./types";

type GeometryContext = Extract<StorageBuildingDetail, { found: true }>;
type Placement = { xMm: number; yMm: number };
type SavedFloor = { floor: StorageFloorRow; detail: GeometryContext };

/** One version-bound command draft; live spot data remains owned by the caller. */
export interface FloorDraft {
  readonly baseline: StorageFloorRow;
  readonly receivedVersion: number;
  readonly geometryContext: GeometryContext;
  readonly width: string;
  readonly depth: string;
  readonly height: string;
  readonly placement: Placement;
  readonly blocks: EditableBlock[];
}

const override = (value: number | undefined) =>
  value === undefined ? "" : String(metres(value));

function savedGeometry(floor: StorageFloorRow, detail: GeometryContext) {
  const previousFloor = detail.floors.find(
    (candidate) => candidate.floorNumber === floor.floorNumber - 1,
  );
  const baseWidthMm = previousFloor?.widthMm ?? detail.building.widthMm;
  const baseDepthMm = previousFloor?.depthMm ?? detail.building.depthMm;
  const initialWidthMm = floor.widthMm ?? detail.building.widthMm;
  const initialDepthMm = floor.depthMm ?? detail.building.depthMm;
  return {
    previousFloor,
    baseWidthMm,
    baseDepthMm,
    initialWidthMm,
    initialDepthMm,
    initialPlacement: {
      xMm:
        floor.offsetXMm ??
        Math.max(0, Math.floor((baseWidthMm - initialWidthMm) / 2)),
      yMm:
        floor.offsetYMm ??
        Math.max(0, Math.floor((baseDepthMm - initialDepthMm) / 2)),
    },
  };
}

export function createFloorDraft({ floor, detail }: SavedFloor): FloorDraft {
  return {
    baseline: floor,
    receivedVersion: floor.version,
    geometryContext: detail,
    width: override(floor.widthMm),
    depth: override(floor.depthMm),
    height: override(floor.heightMm),
    placement: savedGeometry(floor, detail).initialPlacement,
    blocks: floor.reservedBlocks.map(({ blockId, ...block }) => ({
      ...block,
      id: blockId,
    })),
  };
}

// Hidden metadata participates in dirty detection, including normalized colors.
function blockShape(block: EditableBlock | StorageReservedBlockRow) {
  return [
    block.label,
    block.areaKind ?? null,
    block.displayHeightMm ?? null,
    resolveAreaColor(block.color),
    block.xMm,
    block.yMm,
    block.widthMm,
    block.depthMm,
  ];
}

export function floorDraftGeometry(draft: FloorDraft) {
  const geometry = savedGeometry(draft.baseline, draft.geometryContext);
  const building = draft.geometryContext.building;
  const actualWidth =
    draft.width === "" ? building.widthMm : millimetres(draft.width);
  const actualDepth =
    draft.depth === "" ? building.depthMm : millimetres(draft.depth);
  const actualHeight =
    draft.height === ""
      ? building.defaultFloorHeightMm
      : millimetres(draft.height);
  return {
    ...geometry,
    actualWidth,
    actualDepth,
    actualHeight,
    actualPlacement: {
      xMm: Math.max(
        0,
        Math.min(
          draft.placement.xMm,
          Math.max(0, geometry.baseWidthMm - actualWidth),
        ),
      ),
      yMm: Math.max(
        0,
        Math.min(
          draft.placement.yMm,
          Math.max(0, geometry.baseDepthMm - actualDepth),
        ),
      ),
    },
  };
}

export function hasFloorDraftChanges(draft: FloorDraft): boolean {
  const { initialPlacement } = savedGeometry(
    draft.baseline,
    draft.geometryContext,
  );
  return (
    draft.width !== override(draft.baseline.widthMm) ||
    draft.depth !== override(draft.baseline.depthMm) ||
    draft.height !== override(draft.baseline.heightMm) ||
    draft.placement.xMm !== initialPlacement.xMm ||
    draft.placement.yMm !== initialPlacement.yMm ||
    JSON.stringify(draft.blocks.map(blockShape)) !==
      JSON.stringify(draft.baseline.reservedBlocks.map(blockShape))
  );
}

export function floorDraftNeedsRefresh(
  draft: FloorDraft,
  { floor, detail }: SavedFloor,
): boolean {
  return (
    (floor.version > draft.receivedVersion ||
      detail.building.version > draft.geometryContext.building.version) &&
    floor.version >= draft.baseline.version &&
    !hasFloorDraftChanges(draft)
  );
}

export type FloorDraftAction =
  | { type: "dimension"; field: "width" | "depth" | "height"; value: string }
  | { type: "placement"; value: Placement }
  | { type: "blocks"; value: EditableBlock[] }
  | ({ type: "reload" } & SavedFloor)
  | { type: "saved"; submitted: FloorDraft };

export function floorDraftReducer(
  draft: FloorDraft,
  action: FloorDraftAction,
): FloorDraft {
  switch (action.type) {
    case "dimension":
      return { ...draft, [action.field]: action.value };
    case "placement":
      return { ...draft, placement: action.value };
    case "blocks":
      return { ...draft, blocks: action.value };
    case "reload":
      return createFloorDraft(action);
    case "saved": {
      const submitted = action.submitted;
      const floor = submitted.baseline;
      const { actualWidth, actualDepth, actualHeight, actualPlacement } =
        floorDraftGeometry(submitted);
      // Preserve inherited dimensions as absent overrides. The optimistic
      // baseline advances, but receivedVersion waits for authoritative data.
      const baseline: StorageFloorRow = {
        floorId: floor.floorId,
        floorNumber: floor.floorNumber,
        grossAreaSqMm: floor.grossAreaSqMm,
        reservedAreaSqMm: floor.reservedAreaSqMm,
        usableAreaSqMm: floor.usableAreaSqMm,
        version: floor.version + 1,
        storageZones: floor.storageZones,
        reservedBlocks: submitted.blocks.map(({ id, ...block }) => ({
          ...block,
          blockId: id,
        })),
        offsetXMm: actualPlacement.xMm,
        offsetYMm: actualPlacement.yMm,
        ...(submitted.width === "" ? {} : { widthMm: actualWidth }),
        ...(submitted.depth === "" ? {} : { depthMm: actualDepth }),
        ...(submitted.height === "" ? {} : { heightMm: actualHeight }),
      };
      return {
        ...draft,
        baseline,
        geometryContext: {
          ...draft.geometryContext,
          building: {
            ...draft.geometryContext.building,
            version: draft.geometryContext.building.version + 1,
          },
        },
        placement: actualPlacement,
      };
    }
  }
}
