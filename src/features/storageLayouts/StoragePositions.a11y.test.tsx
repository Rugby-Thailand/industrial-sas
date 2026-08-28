import { axe } from "jest-axe";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";

vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
  useQuery: () => undefined,
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children }: { readonly children: ReactNode }) => children,
  useRouter: () => ({ push: vi.fn() }),
}));

import { renderWithIntl } from "@tests/fixtures/intl-render";

import type { StorageZoneRow } from "@/lib/convex/storageLayoutApi";

import { StorageZonesPanel } from "./StorageLayoutScreens";

it("keeps the Thai area, exact-position, and operator controls accessible", async () => {
  const zone: StorageZoneRow = {
    zoneId: "zone-bulk",
    locationId: "location-default",
    code: "DEMO-F01-Z02",
    label: "BULK-A พื้นที่กองขนาดใหญ่",
    qrValue: "ISAS:LOCATION:1:location-default",
    mode: "FLOOR_POSITIONS",
    xMm: 0,
    yMm: 0,
    widthMm: 8_000,
    depthMm: 6_000,
    maxStackHeightMm: 4_000,
    positions: [
      {
        positionId: "position-p12",
        locationId: "location-p12",
        code: "DEMO-F01-Z02-P-12",
        label: "P-12",
        qrValue: "ISAS:LOCATION:1:location-p12",
        kind: "FLOOR",
        isDefault: false,
        xMm: 1_000,
        yMm: 1_000,
        widthMm: 2_000,
        depthMm: 2_000,
        breadcrumb: "Floor 1 › BULK-A › P-12",
        placements: [],
      },
    ],
    placements: [],
  };
  const { container } = renderWithIntl(
    <StorageZonesPanel
      warehouseId="warehouse-a"
      buildingId="building-a"
      floorNumber={1}
      floorWidthMm={20_000}
      floorDepthMm={12_000}
      floorHeightMm={4_000}
      zones={[zone]}
    />,
    { locale: "th", workspace: false },
  );

  expect(await axe(container)).toHaveNoViolations();
});
