import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithIntl } from "../../../tests/fixtures/intl-render";
import type { DashboardTile } from "@/lib/convex/reportingApi";

import { OwnerOperationsSummaryView } from "./OwnerOperationsSummary";

const tiles: DashboardTile[] = [
  { metric: "RECEIPTS_OPENED", count: 120, updatedAt: 10, suspect: false },
  { metric: "RECEIPT_LINES_POSTED", count: 450, updatedAt: 20, suspect: false },
  { metric: "QC_PENDING", count: 4, updatedAt: 30, suspect: false },
  { metric: "QC_PARKED", count: 2, updatedAt: 40, suspect: false },
  { metric: "PUTAWAY_READY", count: 8, updatedAt: 50, suspect: false },
  { metric: "PUTAWAY_CLAIMED", count: 6, updatedAt: 60, suspect: false },
];

describe("OwnerOperationsSummaryView", () => {
  it("shows recorded volume without repeating business-pulse queues", () => {
    renderWithIntl(<OwnerOperationsSummaryView tiles={tiles} />, {
      locale: "en",
    });

    expect(screen.getByTestId("owner-volume-receipts")).toHaveTextContent(
      "120",
    );
    expect(screen.getByTestId("owner-volume-lines")).toHaveTextContent("450");
    expect(
      screen.queryByTestId("owner-queue-QC_PENDING"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("owner-queue-PUTAWAY_READY"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Queue composition")).not.toBeInTheDocument();
    expect(
      screen.queryByText("14 active putaway tasks"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Inspections waiting")).not.toBeInTheDocument();
    expect(screen.queryByText("Putaway tasks ready")).not.toBeInTheDocument();
  });
});
