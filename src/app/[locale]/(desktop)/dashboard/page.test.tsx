import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const { getTranslations, setRequestLocale } = vi.hoisted(() => ({
  getTranslations: vi.fn(
    async (namespace: string) => (key: string) => `${namespace}.${key}`,
  ),
  setRequestLocale: vi.fn(),
}));

vi.mock("next-intl/server", () => ({ getTranslations, setRequestLocale }));

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    children,
    href,
  }: {
    readonly children: ReactNode;
    readonly href: string;
  }) => <a href={href}>{children}</a>,
}));

vi.mock("@/features/reporting/DashboardScope", () => ({
  DashboardScope: () => <div data-testid="dashboard-scope" />,
}));

vi.mock("@/features/reporting/OccupancyMap", () => ({
  OccupancyMap: () => <div data-testid="occupancy-map" />,
}));

vi.mock("@/features/reporting/OperationsTiles", () => ({
  OperationsTiles: () => <div data-testid="operations-tiles" />,
}));

vi.mock("@/features/reporting/WarehouseForkliftAnimation", () => ({
  WarehouseForkliftAnimation: () => <div data-testid="warehouse-animation" />,
}));

import DashboardPage from "./page";

describe("DashboardPage", () => {
  it("contains operational work without setup or release-status sections", async () => {
    render(
      await DashboardPage({
        params: Promise.resolve({ locale: "en" }),
      }),
    );

    expect(screen.getByText("Dashboard.title")).toBeInTheDocument();
    expect(screen.getByTestId("operations-tiles")).toBeInTheDocument();
    expect(screen.getByTestId("occupancy-map")).toBeInTheDocument();
    expect(screen.getByText("Dashboard.entryHeading")).toBeInTheDocument();
    expect(
      screen.queryByText("Dashboard.systemHeading"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Dashboard.capabilityHeading"),
    ).not.toBeInTheDocument();
    expect(getTranslations).toHaveBeenCalledWith("Dashboard");
    expect(getTranslations).not.toHaveBeenCalledWith("Setup");
    expect(setRequestLocale).toHaveBeenCalledWith("en");
  });
});
