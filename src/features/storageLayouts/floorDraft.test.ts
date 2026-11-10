import { describe, expect, it } from "vitest";
import type {
  StorageBuildingDetail,
  StorageFloorRow,
} from "@/lib/convex/storageLayoutApi";
import {
  createFloorDraft,
  floorDraftGeometry,
  floorDraftNeedsRefresh,
  floorDraftReducer,
  hasFloorDraftChanges,
} from "./floorDraft";

const floor: StorageFloorRow = {
  floorId: "floor-2",
  floorNumber: 2,
  widthMm: 12_000,
  depthMm: 8_000,
  version: 3,
  grossAreaSqMm: 96_000_000,
  reservedAreaSqMm: 1_000_000,
  usableAreaSqMm: 95_000_000,
  storageZones: [],
  reservedBlocks: [
    {
      blockId: "stairs",
      label: "Stairs",
      areaKind: "STAIRS",
      displayHeightMm: 2_500,
      color: "#145CA1",
      xMm: 0,
      yMm: 0,
      widthMm: 1_000,
      depthMm: 1_000,
    },
  ],
};
const detail: Extract<StorageBuildingDetail, { found: true }> = {
  found: true,
  building: {
    buildingId: "building",
    warehouseId: "warehouse",
    code: "A",
    name: "Building A",
    widthMm: 20_000,
    depthMm: 16_000,
    defaultFloorHeightMm: 4_000,
    floorCount: 2,
    totalHeightMm: 8_000,
    grossAreaSqMm: 320_000_000,
    reservedAreaSqMm: 0,
    usableAreaSqMm: 320_000_000,
    status: "DRAFT",
    version: 5,
  },
  floors: [
    {
      ...floor,
      floorId: "floor-1",
      floorNumber: 1,
      widthMm: 18_000,
      depthMm: 14_000,
    },
    floor,
  ],
};
const saved = { floor, detail };
const newer = {
  floor: { ...floor, version: 4, widthMm: 10_000 },
  detail: {
    ...detail,
    building: { ...detail.building, version: 6, widthMm: 24_000 },
  },
};

describe("floor command draft", () => {
  it("adopts authoritative geometry and metadata together only while clean", () => {
    const draft = createFloorDraft(saved);
    expect(hasFloorDraftChanges(draft)).toBe(false);
    expect(floorDraftNeedsRefresh(draft, newer)).toBe(true);
    const refreshed = floorDraftReducer(draft, { type: "reload", ...newer });
    expect(refreshed.width).toBe("10");
    expect(refreshed.geometryContext.building.widthMm).toBe(24_000);
    expect(refreshed.baseline.version).toBe(4);
    expect(hasFloorDraftChanges(refreshed)).toBe(false);
    expect(floorDraftNeedsRefresh(refreshed, newer)).toBe(false);
  });

  it.each(["width", "depth", "height"] as const)(
    "keeps the original version and geometry context for an unsent %s override",
    (field) => {
      const draft = floorDraftReducer(createFloorDraft(saved), {
        type: "dimension",
        field,
        value: "9.995",
      });
      expect(hasFloorDraftChanges(draft)).toBe(true);
      expect(floorDraftNeedsRefresh(draft, newer)).toBe(false);
      expect(draft.baseline.version).toBe(3);
      expect(draft.geometryContext).toBe(detail);
      expect(draft[field]).toBe("9.995");
    },
  );

  it.each(["areaKind", "displayHeightMm", "color"] as const)(
    "protects hidden %s metadata as part of the dirty command",
    (field) => {
      const original = createFloorDraft(saved);
      const blocks = original.blocks.map((block) => {
        const next = { ...block };
        delete next[field];
        return next;
      });
      const dirty = floorDraftReducer(original, {
        type: "blocks",
        value: blocks,
      });
      expect(hasFloorDraftChanges(dirty)).toBe(true);
      expect(floorDraftNeedsRefresh(dirty, newer)).toBe(false);
    },
  );

  it("clamps placement against the loaded previous floor and saves that exact placement", () => {
    let draft = floorDraftReducer(createFloorDraft(saved), {
      type: "placement",
      value: { xMm: 8_000, yMm: -50 },
    });
    draft = floorDraftReducer(draft, {
      type: "dimension",
      field: "width",
      value: "16.125",
    });
    expect(floorDraftNeedsRefresh(draft, newer)).toBe(false);
    expect(floorDraftGeometry(draft).actualPlacement).toEqual({
      xMm: 1_875,
      yMm: 0,
    });
    const completed = floorDraftReducer(draft, {
      type: "saved",
      submitted: draft,
    });
    expect(completed.baseline.offsetXMm).toBe(1_875);
    expect(completed.baseline.offsetYMm).toBe(0);
    expect(hasFloorDraftChanges(completed)).toBe(false);
  });

  it("keeps inherited dimensions absent and every block attribute through successful reconciliation", () => {
    const inheritedFloor = { ...floor };
    delete inheritedFloor.widthMm;
    delete inheritedFloor.depthMm;
    const initial = createFloorDraft({ floor: inheritedFloor, detail });
    const submitted = floorDraftReducer(initial, {
      type: "blocks",
      value: initial.blocks.map((block) => ({ ...block, color: "#12866A" })),
    });
    const completed = floorDraftReducer(submitted, {
      type: "saved",
      submitted,
    });
    expect(completed.baseline).not.toHaveProperty("widthMm");
    expect(completed.baseline).not.toHaveProperty("depthMm");
    expect(completed.baseline).not.toHaveProperty("heightMm");
    expect(completed.baseline.reservedBlocks).toEqual([
      { ...floor.reservedBlocks[0], color: "#12866A" },
    ]);
    expect(completed.geometryContext.building.version).toBe(6);
    expect(hasFloorDraftChanges(completed)).toBe(false);
  });

  it("waits for an authoritative floor to catch up to optimistic success before refreshing", () => {
    const submitted = floorDraftReducer(createFloorDraft(saved), {
      type: "dimension",
      field: "width",
      value: "10",
    });
    const completed = floorDraftReducer(submitted, {
      type: "saved",
      submitted,
    });
    expect(hasFloorDraftChanges(completed)).toBe(false);
    expect(
      floorDraftNeedsRefresh(completed, { floor, detail: newer.detail }),
    ).toBe(false);
    // The matching floor version still replaces the optimistic snapshot: server
    // totals and metadata can differ even when the version is no longer higher.
    const authoritative = {
      ...newer,
      floor: { ...completed.baseline, usableAreaSqMm: 78_000_000 },
    };
    expect(floorDraftNeedsRefresh(completed, authoritative)).toBe(true);
    const refreshed = floorDraftReducer(completed, {
      type: "reload",
      ...authoritative,
    });
    expect(refreshed.baseline.usableAreaSqMm).toBe(78_000_000);
    expect(floorDraftNeedsRefresh(refreshed, authoritative)).toBe(false);
  });
});
