import { fireEvent, screen } from "@testing-library/react";
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
import { OperationalReportsWorkbench } from "./OperationalReportsWorkbench";

beforeEach(() => writeStoredWarehouse("prv_wh_bangpoo"));
afterEach(() => window.localStorage.clear());

describe("operational reporting workbench", () => {
  it("switches among all four named stock views and keeps exceptions visible", () => {
    renderWithIntl(
      <WorkspaceProvider>
        <OperationalReportsWorkbench />
      </WorkspaceProvider>,
      { locale: "th", environment: previewEnvironment },
    );
    expect(screen.getByTestId("operational-exceptions")).toBeInTheDocument();
    expect(screen.getByTestId("report-stock-balance")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "สต็อกตาม SKU" }));
    expect(screen.getByTestId("report-stock-sku")).toBeInTheDocument();
    expect(screen.getAllByText("1200.000").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("tab", { name: "สต็อกตามล็อต" }));
    expect(screen.getByTestId("report-stock-lot")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Stock เคลื่อนไหว" }));
    expect(screen.getByTestId("report-stock-movement")).toBeInTheDocument();
  });

  it("has no detectable accessibility violations", async () => {
    const { container } = renderWithIntl(
      <WorkspaceProvider>
        <OperationalReportsWorkbench />
      </WorkspaceProvider>,
      { locale: "en", environment: previewEnvironment },
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
