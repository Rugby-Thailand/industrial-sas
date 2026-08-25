import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithIntl } from "../../../tests/fixtures/intl-render";
import type { DashboardTile } from "@/lib/convex/reportingApi";

import { OwnerPulseCards } from "./OwnerPulse";

const tiles: DashboardTile[] = [
  {
    metric: "QC_PENDING",
    count: 4,
    updatedAt: 1_776_000_000_000,
    suspect: false,
  },
  {
    metric: "QC_PARKED",
    count: 2,
    updatedAt: 1_776_000_001_000,
    suspect: false,
  },
  {
    metric: "PUTAWAY_READY",
    count: 7,
    updatedAt: 1_776_000_002_000,
    suspect: false,
  },
  {
    metric: "PUTAWAY_CLAIMED",
    count: 3,
    updatedAt: 1_776_000_003_000,
    suspect: false,
  },
];

describe("OwnerPulseCards", () => {
  it("turns maintained warehouse facts into owner decision signals without invented trends", () => {
    renderWithIntl(
      <OwnerPulseCards
        tiles={tiles}
        occupancy={{
          complete: true,
          cells: [
            {
              locationId: "a",
              code: "A-01",
              locationType: "RACK",
              distinctBuckets: 1,
              band: "BUSY",
            },
            {
              locationId: "b",
              code: "A-02",
              locationType: "RACK",
              distinctBuckets: 2,
              band: "FULL",
            },
            {
              locationId: "c",
              code: "B-01",
              locationType: "RACK",
              distinctBuckets: 0,
              band: "EMPTY",
            },
          ],
        }}
      />,
      { locale: "en" },
    );

    expect(screen.getByTestId("owner-metric-inspections")).toHaveTextContent(
      "4",
    );
    expect(screen.getByTestId("owner-metric-decisions")).toHaveTextContent("2");
    expect(screen.getByTestId("owner-metric-putaway")).toHaveTextContent("10");
    const capacity = screen.getByTestId("owner-metric-capacity");
    expect(screen.getByText("Across 3 mapped locations")).toBeInTheDocument();
    expect(screen.getByText("67%")).toBeInTheDocument();
    expect(within(capacity).queryByText("2")).not.toBeInTheDocument();
    expect(screen.queryByText(/4 work items/)).not.toBeInTheDocument();
    expect(screen.queryByText(/2 work items/)).not.toBeInTheDocument();
    expect(screen.queryByText(/10 work items/)).not.toBeInTheDocument();
    expect(screen.queryByText(/growth|trend/i)).not.toBeInTheDocument();
  });

  it("presents empty capacity as one clear percentage instead of two competing zero values", () => {
    renderWithIntl(
      <OwnerPulseCards
        tiles={[]}
        occupancy={{
          complete: true,
          cells: [
            {
              locationId: "empty",
              code: "A-01",
              locationType: "RACK",
              distinctBuckets: 0,
              band: "EMPTY",
            },
          ],
        }}
      />,
      { locale: "en" },
    );

    const capacity = screen.getByTestId("owner-metric-capacity");
    expect(within(capacity).getByText("0%")).toBeInTheDocument();
    expect(within(capacity).getByText("Clear")).toBeInTheDocument();
    expect(within(capacity).queryByText("0")).not.toBeInTheDocument();
    expect(
      within(capacity).queryByText(/0 constrained locations/),
    ).not.toBeInTheDocument();
    expect(screen.queryAllByText("No activity recorded yet")).toHaveLength(0);
  });

  it("uses plain Thai wording for storage locations nearing capacity", () => {
    renderWithIntl(
      <OwnerPulseCards
        tiles={[]}
        occupancy={{
          complete: true,
          cells: [
            {
              locationId: "empty-th",
              code: "A-01",
              locationType: "RACK",
              distinctBuckets: 0,
              band: "EMPTY",
            },
          ],
        }}
      />,
      { locale: "th" },
    );

    const capacity = screen.getByTestId("owner-metric-capacity");
    expect(capacity).toHaveTextContent("พื้นที่จัดเก็บใกล้เต็ม");
    expect(capacity).toHaveTextContent("ตรวจจากตำแหน่งจัดเก็บ 1 แห่ง");
    expect(capacity).not.toHaveTextContent("แรงกดดันด้านพื้นที่");
    expect(capacity).not.toHaveTextContent("ตำแหน่งที่ตึงตัว");
  });
});
