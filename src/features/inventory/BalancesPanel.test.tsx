import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  configuredEnvironment,
  previewEnvironment,
  renderWithIntl,
  unconfiguredEnvironment,
} from "../../../tests/fixtures/intl-render";

import { BalancesPanel } from "./BalancesPanel";

import { WorkspaceProvider } from "@/components/providers/WorkspaceProvider";
import {
  PREVIEW_WAREHOUSES,
  previewBalancesFor,
} from "@/lib/preview/ledgerPreview";
import { WAREHOUSE_STORAGE_KEY } from "@/lib/workspace/warehouseStore";

const warehouse = PREVIEW_WAREHOUSES[0];

const renderPanel = (environment: Parameters<typeof renderWithIntl>[1]) =>
  renderWithIntl(
    <WorkspaceProvider>
      <BalancesPanel />
    </WorkspaceProvider>,
    environment,
  );

afterEach(() => {
  window.localStorage.clear();
});

/**
 * The gate first, then the data path. These are the two behaviours the panel
 * actually owns; the table and the state mapping are covered on their own.
 */
describe("BalancesPanel gating", () => {
  it("says the backend is unconfigured before asking anything", () => {
    // Not "loading". Nothing was asked, and nothing can be.
    renderPanel({ environment: unconfiguredEnvironment });

    expect(screen.getByTestId("panel-BACKEND_MISSING")).toBeInTheDocument();
  });

  it("says sign-in is required when there is a backend but no identity provider", () => {
    renderPanel({
      environment: { ...configuredEnvironment, identityConfigured: false },
    });

    expect(screen.getByTestId("panel-SIGN_IN_REQUIRED")).toBeInTheDocument();
  });

  it("asks for a warehouse before a warehouse-scoped read", () => {
    renderPanel({ environment: configuredEnvironment });

    expect(screen.getByTestId("panel-WAREHOUSE_MISSING")).toBeInTheDocument();
  });
});

describe("BalancesPanel in preview mode", () => {
  it("still requires a warehouse", () => {
    // Two preview warehouses exist, so nothing is auto-selected; a preview that
    // skipped the selector would not be exercising the real screen.
    renderPanel({ environment: previewEnvironment });

    expect(screen.getByTestId("panel-WAREHOUSE_MISSING")).toBeInTheDocument();
  });

  it("renders synthetic rows for the remembered warehouse", () => {
    window.localStorage.setItem(WAREHOUSE_STORAGE_KEY, warehouse?.id ?? "");
    renderPanel({ environment: previewEnvironment });

    const rows = previewBalancesFor(warehouse?.id ?? "");
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(rows.length + 1);
  });

  it("disables the previous control on the first page", () => {
    window.localStorage.setItem(WAREHOUSE_STORAGE_KEY, warehouse?.id ?? "");
    renderPanel({ environment: previewEnvironment });

    expect(screen.getByRole("button", { name: "หน้าก่อนหน้า" })).toBeDisabled();
  });

  it("offers no control that could write a balance", () => {
    // `INV-0003-11`: no API sets a balance, so no screen may appear to.
    window.localStorage.setItem(WAREHOUSE_STORAGE_KEY, warehouse?.id ?? "");
    renderPanel({ environment: previewEnvironment });

    const buttons = screen
      .getAllByRole("button")
      .map((button) => button.textContent ?? "");
    expect(buttons).toEqual(["หน้าก่อนหน้า", "หน้าถัดไป"]);
  });
});
