import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  renderWithIntl,
  unconfiguredEnvironment,
} from "../../../tests/fixtures/intl-render";

import { LedgerPanelStatus } from "./LedgerPanelStatus";

const render = (state: Parameters<typeof LedgerPanelStatus>[0]["state"]) =>
  renderWithIntl(<LedgerPanelStatus state={state} />, {
    environment: unconfiguredEnvironment,
  });

describe("LedgerPanelStatus", () => {
  it("names each state in the DOM so tests do not assert on prose", () => {
    render({ kind: "BACKEND_MISSING" });
    expect(screen.getByTestId("panel-BACKEND_MISSING")).toBeInTheDocument();
  });

  it("explains a missing backend rather than showing a spinner", () => {
    render({ kind: "BACKEND_MISSING" });

    expect(screen.getByText("ยังไม่ได้ตั้งค่าแบ็กเอนด์")).toBeInTheDocument();
    expect(screen.getByText(/NEXT_PUBLIC_CONVEX_URL/)).toBeInTheDocument();
  });

  it("shows the request ID with a denial, because that is what support needs", () => {
    render({ kind: "DENIED", requestId: "req_0191f2c1" });

    expect(screen.getByText(/req_0191f2c1/)).toBeInTheDocument();
  });

  it("interrupts for a denial and stays polite for a wait", () => {
    const denied = render({ kind: "DENIED", requestId: "req_1" });
    expect(denied.getByRole("alert")).toBeInTheDocument();
    denied.unmount();

    const loading = render({ kind: "LOADING" });
    expect(loading.queryByRole("alert")).toBeNull();
    expect(loading.getByRole("status")).toBeInTheDocument();
  });

  it("prints a ledger error code verbatim and in English", () => {
    render({
      kind: "LEDGER_ERROR",
      code: "BUCKET_OUT_OF_WAREHOUSE_SCOPE",
      requestId: "req_2",
    });

    expect(
      screen.getByText("BUCKET_OUT_OF_WAREHOUSE_SCOPE"),
    ).toBeInTheDocument();
  });

  it("never speculates about which permission was missing", () => {
    const { container } = render({ kind: "DENIED", requestId: "req_3" });

    expect(container.textContent).not.toMatch(/inventory\.[a-z]+\.[a-z]+/);
  });
});
