import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { floorMapDemo } from "@/components/storageLayouts/storageFloorDemoData";
import { useFloorSelection } from "./useFloorSelection";

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

beforeEach(() => window.history.replaceState({}, "", "/"));
const zones = floorMapDemo(false, false).zones;
it("shares one selection and excludes removed locations and different floor scopes", () => {
  const view = renderHook(
    ({ scope, locations }) => useFloorSelection(scope, locations),
    { initialProps: { scope: "warehouse:floor1", locations: zones } },
  );
  act(() => view.result.current.setSelectedZoneId(zones[0]!.zoneId));
  expect(view.result.current.selectedZoneId).toBe(zones[0]!.zoneId);
  view.rerender({ scope: "warehouse:floor2", locations: zones });
  expect(view.result.current.selectedZoneId).toBeUndefined();
  act(() => view.result.current.setSelectedZoneId(zones[1]!.zoneId));
  view.rerender({ scope: "warehouse:floor2", locations: [] });
  expect(view.result.current.selectedZoneId).toBeUndefined();
  view.rerender({ scope: "warehouse:floor2", locations: zones });
  expect(view.result.current.selectedZoneId).toBeUndefined();
});
it("follows valid edit links and hash changes without selecting unknown zones", () => {
  window.history.replaceState({}, "", `/?editZone=${zones[0]!.zoneId}`);
  const view = renderHook(() => useFloorSelection("floor1", zones));
  expect(view.result.current.selectedZoneId).toBe(zones[0]!.zoneId);
  act(() => {
    window.history.replaceState({}, "", `/#storage-zone-${zones[1]!.zoneId}`);
    window.dispatchEvent(new Event("storage-workspace-state"));
  });
  expect(view.result.current.selectedZoneId).toBe(zones[1]!.zoneId);
  act(() => view.result.current.setSelectedZoneId(undefined));
  expect(view.result.current.selectedZoneId).toBeUndefined();
});
