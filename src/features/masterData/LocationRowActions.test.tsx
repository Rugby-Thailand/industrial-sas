import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "@tests/fixtures/intl-render";

import { LocationRowActions } from "./LocationRowActions";

const { useQueryMock } = vi.hoisted(() => ({ useQueryMock: vi.fn() }));

vi.mock("convex/react", () => ({ useQuery: useQueryMock }));

describe("LocationRowActions", () => {
  beforeEach(() => {
    useQueryMock.mockReturnValue({
      ok: true,
      value: {
        found: true,
        building: {
          buildingId: "building-1",
          warehouseId: "warehouse-1",
          code: "BLDG-A",
          name: "Main storage",
          widthMm: 30_000,
          depthMm: 20_000,
          defaultFloorHeightMm: 4_000,
          floorCount: 1,
          totalHeightMm: 4_000,
          grossAreaSqMm: 600_000_000,
          reservedAreaSqMm: 20_000_000,
          usableAreaSqMm: 580_000_000,
          status: "ACTIVE",
          version: 1,
        },
        floor: {
          floorId: "floor-1",
          floorNumber: 1,
          widthMm: 30_000,
          depthMm: 20_000,
          heightMm: 4_000,
          grossAreaSqMm: 600_000_000,
          reservedAreaSqMm: 20_000_000,
          usableAreaSqMm: 580_000_000,
          version: 1,
          reservedBlocks: [
            {
              blockId: "reserved-1",
              label: "Office",
              xMm: 20_000,
              yMm: 0,
              widthMm: 5_000,
              depthMm: 4_000,
            },
          ],
          storageZones: [
            {
              zoneId: "zone-1",
              locationId: "location-1",
              code: "BLDG-A-F01-Z01",
              label: "Finished goods A",
              qrValue: "zone-1",
              xMm: 0,
              yMm: 0,
              widthMm: 4_000,
              depthMm: 4_000,
              maxStackHeightMm: 3_000,
              placements: [],
            },
            {
              zoneId: "zone-2",
              locationId: "location-2",
              code: "BLDG-A-F01-Z02",
              label: "Finished goods B",
              qrValue: "zone-2",
              xMm: 5_000,
              yMm: 0,
              widthMm: 4_000,
              depthMm: 4_000,
              maxStackHeightMm: 3_000,
              placements: [],
            },
          ],
        },
        zone: {
          zoneId: "zone-1",
          locationId: "location-1",
          code: "BLDG-A-F01-Z01",
          label: "Finished goods A",
          qrValue: "zone-1",
          xMm: 0,
          yMm: 0,
          widthMm: 4_000,
          depthMm: 4_000,
          maxStackHeightMm: 3_000,
          placements: [],
        },
      },
    });
  });

  it("opens in 3D and lets the operator switch to the 2D plan", () => {
    renderWithIntl(
      <LocationRowActions
        row={{
          locationId: "location-1",
          warehouseId: "warehouse-1",
          code: "BLDG-A-F01-Z01",
          locationType: "FLOOR_BLOCK",
          status: "ACTIVE",
        }}
        busy={false}
        onTypeChange={vi.fn()}
      />,
      { locale: "en", workspace: false },
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "View BLDG-A-F01-Z01 on the map",
      }),
    );

    expect(
      screen.getByRole("img", {
        name: "3D floor view highlighting BLDG-A-F01-Z01",
      }),
    ).toHaveAttribute("data-view-mode", "3d");
    expect(screen.getByRole("button", { name: "3D view" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "2D plan" }));

    expect(
      screen.getByRole("img", {
        name: "Floor map highlighting BLDG-A-F01-Z01",
      }),
    ).toHaveAttribute("data-view-mode", "plan");
    expect(screen.getByRole("button", { name: "2D plan" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
