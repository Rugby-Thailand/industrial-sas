import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithIntl } from "../../../tests/fixtures/intl-render";
import type { DashboardTile } from "@/lib/convex/reportingApi";

import { OwnerPressureBarView } from "./OwnerPressureBar";

const tiles: DashboardTile[] = [
  { metric: "RECEIPTS_OPENED", count: 2, suspect: false },
  { metric: "RECEIPT_LINES_POSTED", count: 4, suspect: false },
  { metric: "QC_PENDING", count: 3, suspect: false },
  { metric: "QC_PARKED", count: 1, suspect: false },
  { metric: "PUTAWAY_READY", count: 6, suspect: false },
  { metric: "PUTAWAY_CLAIMED", count: 2, suspect: false },
];

describe("OwnerPressureBarView", () => {
  it("shows exact queue and constrained-location counts", () => {
    renderWithIntl(
      <OwnerPressureBarView
        tiles={tiles}
        occupancy={{
          complete: true,
          cells: [
            {
              locationId: "loc-1",
              code: "A-01",
              locationType: "BIN",
              distinctBuckets: 4,
              band: "FULL",
            },
            {
              locationId: "loc-2",
              code: "A-02",
              locationType: "BIN",
              distinctBuckets: 1,
              band: "LIGHT",
            },
          ],
        }}
      />,
      { locale: "en" },
    );

    expect(screen.getByTestId("owner-pressure-bar")).toBeInTheDocument();
    expect(screen.getByTestId("pressure-inspections")).toHaveTextContent("3");
    expect(screen.getByTestId("pressure-decisions")).toHaveTextContent("1");
    expect(screen.getByTestId("pressure-putawayReady")).toHaveTextContent("6");
    expect(screen.getByTestId("pressure-putawayActive")).toHaveTextContent("2");
    expect(screen.getByTestId("pressure-capacity")).toHaveTextContent("1");
    expect(
      screen.getByText("Largest bottleneck: Ready (6)"),
    ).toBeInTheDocument();
  });

  it("announces the clear state when every pressure point is zero", () => {
    const clearTiles = tiles.map((tile) => ({ ...tile, count: 0 }));
    renderWithIntl(
      <OwnerPressureBarView
        tiles={clearTiles}
        occupancy={{ complete: true, cells: [] }}
      />,
      { locale: "en" },
    );

    expect(
      screen.getByText("No current bottlenecks in the tracked steps"),
    ).toBeInTheDocument();
  });
});
