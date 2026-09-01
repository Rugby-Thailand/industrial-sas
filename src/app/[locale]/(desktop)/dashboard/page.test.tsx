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

vi.mock("@/components/prototype/PrototypeSwitcher", () => ({
  PrototypeSwitcher: ({ current }: { readonly current: string }) => (
    <div data-testid="prototype-switcher">{current}</div>
  ),
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    children,
    href,
  }: {
    readonly children: ReactNode;
    readonly href: string;
  }) => <a href={href}>{children}</a>,
}));

vi.mock("@/features/reporting/DashboardQuickActions", () => ({
  DashboardQuickActions: () => <div data-testid="dashboard-quick-actions" />,
}));

vi.mock("@/features/reporting/OwnerAttentionList", () => ({
  OwnerAttentionList: () => <div data-testid="owner-attention-list" />,
}));

vi.mock("@/features/reporting/OwnerPulse", () => ({
  OwnerPulse: () => <div data-testid="owner-pulse" />,
}));

vi.mock("@/features/reporting/OccupancyMap", () => ({
  OccupancyMap: () => <div data-testid="occupancy-map" />,
}));

vi.mock("@/features/reporting/OwnerOperationsSummary", () => ({
  OwnerOperationsSummary: () => <div data-testid="owner-operations-summary" />,
}));

vi.mock("@/features/reporting/OwnerPressureRadar", () => ({
  OwnerPressureRadar: () => <div data-testid="owner-pressure-radar" />,
}));

import DashboardPage from "./page";

describe("DashboardPage", () => {
  it("composes the owner decision surface without the old hero or setup content", async () => {
    render(
      await DashboardPage({
        params: Promise.resolve({ locale: "en" }),
      }),
    );

    const title = screen.getByText("OwnerDashboard.title");
    const pageHeader = title.closest("header");
    expect(pageHeader).not.toBeNull();
    expect(pageHeader).not.toHaveClass(
      "rounded-2xl",
      "border",
      "bg-surface",
      "shadow-sm",
    );
    expect(screen.getByText("OwnerDashboard.eyebrow")).toBeInTheDocument();
    expect(screen.getByText("OwnerDashboard.liveData")).toBeInTheDocument();
    expect(
      screen.queryByText("OwnerDashboard.description"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("dashboard-scope")).not.toBeInTheDocument();
    expect(screen.getByTestId("dashboard-quick-actions")).toBeInTheDocument();
    expect(screen.getByTestId("owner-pulse")).toBeInTheDocument();
    expect(screen.getByTestId("owner-attention-list")).toBeInTheDocument();
    expect(screen.getByTestId("owner-operations-summary")).toBeInTheDocument();
    expect(screen.getByTestId("owner-pressure-radar")).toBeInTheDocument();
    expect(screen.getByTestId("occupancy-map")).toBeInTheDocument();
    expect(
      screen.queryByTestId("warehouse-control-hero"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Dashboard.entryHeading"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("warehouse-animation")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Dashboard.heroAssetLabel"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Dashboard.systemHeading"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Dashboard.capabilityHeading"),
    ).not.toBeInTheDocument();
    expect(getTranslations).toHaveBeenCalledWith("OwnerDashboard");
    expect(getTranslations).not.toHaveBeenCalledWith("Dashboard");
    expect(getTranslations).not.toHaveBeenCalledWith("Setup");
    expect(setRequestLocale).toHaveBeenCalledWith("en");
  });

  it.each([
    ["a", "dashboard-style-a"],
    ["b", "dashboard-style-b"],
    ["c", "dashboard-style-c"],
  ])(
    "renders style %s from the shareable query parameter",
    async (variant, testId) => {
      render(
        await DashboardPage({
          params: Promise.resolve({ locale: "en" }),
          searchParams: Promise.resolve({ variant }),
        }),
      );

      expect(screen.getByTestId(testId)).toBeInTheDocument();
      expect(screen.getByTestId("prototype-switcher")).toHaveTextContent(
        variant,
      );

      const headingLabels = screen
        .getAllByRole("heading")
        .map((heading) => heading.textContent);
      expect(new Set(headingLabels).size).toBe(headingLabels.length);
    },
  );

  it("falls back to style A for an unknown variant", async () => {
    render(
      await DashboardPage({
        params: Promise.resolve({ locale: "en" }),
        searchParams: Promise.resolve({ variant: "unknown" }),
      }),
    );

    expect(screen.getByTestId("dashboard-style-a")).toBeInTheDocument();
  });
});
