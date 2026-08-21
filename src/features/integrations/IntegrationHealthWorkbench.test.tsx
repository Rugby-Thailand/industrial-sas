import { screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";

import { navigationMock } from "../../../tests/fixtures/navigation-mock";

vi.mock("@/i18n/navigation", () => navigationMock);

import { WorkspaceProvider } from "@/components/providers/WorkspaceProvider";

import {
  previewEnvironment,
  renderWithIntl,
} from "../../../tests/fixtures/intl-render";
import { IntegrationHealthWorkbench } from "./IntegrationHealthWorkbench";

const renderWorkbench = (locale: "en" | "th" = "en") =>
  renderWithIntl(
    <WorkspaceProvider>
      <IntegrationHealthWorkbench />
    </WorkspaceProvider>,
    { locale, environment: previewEnvironment },
  );

describe("integration health workbench", () => {
  it("makes healthy, delayed, blocked, disabled, and fallback states explicit", () => {
    renderWorkbench();
    expect(
      screen.getByTestId("integration-health-register"),
    ).toBeInTheDocument();
    expect(screen.getByText("ERP_PRIMARY")).toBeInTheDocument();
    expect(screen.getAllByText("Available").length).toBeGreaterThan(0);
    expect(screen.getByText("Degraded")).toBeInTheDocument();
    expect(screen.getAllByText("Disabled").length).toBeGreaterThan(0);
    expect(
      screen.getByText("First-party work remains authoritative"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("integration-register-form")).toBeInTheDocument();
    expect(screen.getByTestId("integration-status-form")).toBeInTheDocument();
  });

  it("has no detectable accessibility violations with Thai labels", async () => {
    const { container } = renderWorkbench("th");
    expect(await axe(container)).toHaveNoViolations();
  });
});
