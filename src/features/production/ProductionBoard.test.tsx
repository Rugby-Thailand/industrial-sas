import { screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { WorkspaceProvider } from "@/components/providers/WorkspaceProvider";
import { writeStoredWarehouse } from "@/lib/workspace/warehouseStore";

import {
  previewEnvironment,
  renderWithIntl,
} from "../../../tests/fixtures/intl-render";
import { ProductionBoard } from "./ProductionBoard";

beforeEach(() => writeStoredWarehouse("prv_wh_bangpoo"));
afterEach(() => window.localStorage.clear());

describe("ProductionBoard", () => {
  it("shows the complete pinned-order to QC flow", () => {
    renderWithIntl(
      <WorkspaceProvider>
        <ProductionBoard />
      </WorkspaceProvider>,
      { locale: "en", environment: previewEnvironment },
    );
    expect(screen.getAllByText("MO-26018").length).toBeGreaterThan(0);
    expect(screen.getByText("New-revision impact queue")).toBeInTheDocument();
    expect(screen.getAllByText("Receive into QC hold").length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText("Release or reject")).toBeInTheDocument();
  });

  it("has no detectable accessibility violations in Thai", async () => {
    const { container } = renderWithIntl(
      <WorkspaceProvider>
        <ProductionBoard />
      </WorkspaceProvider>,
      { locale: "th", environment: previewEnvironment },
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
