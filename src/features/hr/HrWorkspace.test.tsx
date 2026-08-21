import { screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { navigationMock } from "../../../tests/fixtures/navigation-mock";

vi.mock("@/i18n/navigation", () => navigationMock);

import { WorkspaceProvider } from "@/components/providers/WorkspaceProvider";
import { writeStoredWarehouse } from "@/lib/workspace/warehouseStore";

import {
  previewEnvironment,
  renderWithIntl,
} from "../../../tests/fixtures/intl-render";
import { HrWorkspace } from "./HrWorkspace";

beforeEach(() => writeStoredWarehouse("prv_wh_bangpoo"));
afterEach(() => window.localStorage.clear());

describe("HR workspace", () => {
  it("shows the employee flow, self-service actions, and privacy-safe team inbox", () => {
    renderWithIntl(
      <WorkspaceProvider>
        <HrWorkspace />
      </WorkspaceProvider>,
      { locale: "th", environment: previewEnvironment },
    );
    expect(
      screen.getByRole("heading", { name: "ขั้นตอนพนักงาน → หัวหน้างาน" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("hr-clock-form")).toBeInTheDocument();
    expect(screen.getByTestId("hr-correction-form")).toBeInTheDocument();
    expect(screen.getByTestId("hr-leave-form")).toBeInTheDocument();
    expect(screen.getByTestId("hr-team-inbox")).toHaveTextContent("EMP-002");
    expect(screen.getByTestId("hr-team-inbox")).not.toHaveTextContent(
      "Family appointment",
    );
  });

  it("has no detectable accessibility violations", async () => {
    const { container } = renderWithIntl(
      <WorkspaceProvider>
        <HrWorkspace />
      </WorkspaceProvider>,
      { locale: "en", environment: previewEnvironment },
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
