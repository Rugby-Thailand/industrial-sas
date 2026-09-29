import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { storageLayoutRefs } from "@/lib/convex/storageLayoutApi";
import { useStorageBuilding } from "./useStorageBuilding";

const mock = vi.hoisted(() => ({
  query: vi.fn(),
  layout: undefined as unknown,
  inventory: undefined as unknown,
}));
vi.mock("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
    mock.query(getFunctionName(ref), args);
    if (args === "skip") return undefined;
    return getFunctionName(ref).endsWith("getStorageBuildingLayout")
      ? mock.layout
      : mock.inventory;
  },
}));
beforeEach(() => {
  mock.query.mockClear();
  mock.layout = undefined;
  mock.inventory = undefined;
});
const layout = {
  ok: true,
  requestId: "layout",
  value: { found: true, building: { buildingId: "b" }, floors: [] },
};
const inventory = {
  ok: true,
  requestId: "inventory",
  value: { found: true, zones: [] },
};

describe("useStorageBuilding", () => {
  it("waits for live inventory, composes results and responds to permission loss", () => {
    mock.layout = layout;
    const { result, rerender } = renderHook(() => useStorageBuilding("w", "b"));
    expect(result.current).toBeUndefined();
    mock.inventory = inventory;
    rerender();
    expect(result.current).toEqual(layout);
    mock.inventory = {
      ok: false,
      requestId: "denied",
      denial: { code: "AUTHORIZATION_DENIED" },
    };
    rerender();
    expect(result.current?.ok).toBe(false);
    expect(mock.query).toHaveBeenCalledWith(
      getFunctionName(storageLayoutRefs.layout),
      { warehouseId: "w", buildingId: "b" },
    );
    expect(mock.query).toHaveBeenCalledWith(
      getFunctionName(storageLayoutRefs.inventory),
      { warehouseId: "w", buildingId: "b" },
    );
    expect(mock.query).not.toHaveBeenCalledWith(
      getFunctionName(storageLayoutRefs.get),
      expect.anything(),
    );
  });
  it("skips both subscriptions while the details dialog is closed", () => {
    mock.layout = layout;
    mock.inventory = inventory;
    const { result } = renderHook(() => useStorageBuilding("w", "b", false));
    expect(result.current).toBeUndefined();
    expect(mock.query.mock.calls.map((call) => call[1])).toEqual([
      "skip",
      "skip",
    ]);
  });
  it("does not carry inventory into a different building while it loads", () => {
    mock.layout = layout;
    mock.inventory = inventory;
    const { result, rerender } = renderHook(
      ({ id }) => useStorageBuilding("w", id),
      { initialProps: { id: "b" } },
    );
    expect(result.current?.ok).toBe(true);
    mock.layout = undefined;
    mock.inventory = undefined;
    rerender({ id: "next" });
    expect(result.current).toBeUndefined();
  });
});
