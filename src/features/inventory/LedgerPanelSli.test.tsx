import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  testEnvironment,
  renderWithIntl,
  unconfiguredEnvironment,
} from "../../../tests/fixtures/intl-render";

import { BalancesPanel } from "./BalancesPanel";

import { ObservabilityProvider } from "@/components/providers/ObservabilityProvider";
import { WorkspaceProvider } from "@/components/providers/WorkspaceProvider";
import type { ObservabilityEvent } from "@/lib/observability/event";
import type { ObservabilityPort } from "@/lib/observability/port";
import { SLI_CODES } from "@/lib/observability/sli";
import { PREVIEW_WAREHOUSES } from "@tests/fixtures/data/ledger";
import { WAREHOUSE_STORAGE_KEY } from "@/lib/workspace/warehouseStore";

const recordingPort = (): ObservabilityPort & {
  readonly events: ObservabilityEvent[];
} => {
  const events: ObservabilityEvent[] = [];
  return { events, record: (event) => void events.push(event) };
};

afterEach(() => {
  window.localStorage.clear();
});

/**
 * The SLI is only worth having if it is actually emitted by the screen, with
 * the dimensions the series depends on and nothing that would carry a tenant's
 * data out of the building.
 */
describe("ledger read SLI, as the panel emits it", () => {
  it("reports a successful server read", () => {
    const port = recordingPort();
    window.localStorage.setItem(
      WAREHOUSE_STORAGE_KEY,
      PREVIEW_WAREHOUSES[0]?.id ?? "",
    );

    renderWithIntl(
      <ObservabilityProvider port={port}>
        <WorkspaceProvider>
          <BalancesPanel />
        </WorkspaceProvider>
      </ObservabilityProvider>,
      { environment: testEnvironment },
    );

    expect(screen.getByRole("table")).toBeInTheDocument();
    const read = port.events.find(
      (event) => event.code === SLI_CODES.ledgerRead,
    );
    expect(read?.dimensions).toMatchObject({
      surface: "balances",
      outcome: "READY",
    });
  });

  it("reports a gate outcome without ever having asked the server", () => {
    const port = recordingPort();

    renderWithIntl(
      <ObservabilityProvider port={port}>
        <WorkspaceProvider>
          <BalancesPanel />
        </WorkspaceProvider>
      </ObservabilityProvider>,
      { environment: unconfiguredEnvironment },
    );

    // `BACKEND_MISSING` is decided before a query; the panel renders it and
    // emits nothing, because there was no read to measure.
    expect(screen.getByTestId("panel-BACKEND_MISSING")).toBeInTheDocument();
    expect(port.events).toEqual([]);
  });

  it("emits nothing that could carry a tenant's data", () => {
    const port = recordingPort();
    window.localStorage.setItem(
      WAREHOUSE_STORAGE_KEY,
      PREVIEW_WAREHOUSES[0]?.id ?? "",
    );

    renderWithIntl(
      <ObservabilityProvider port={port}>
        <WorkspaceProvider>
          <BalancesPanel />
        </WorkspaceProvider>
      </ObservabilityProvider>,
      { environment: testEnvironment },
    );

    const serialized = JSON.stringify(port.events);
    // A bucket key, a SKU, a lot code, a UOM, and a quantity are all on screen
    // and none of them may be in the telemetry.
    expect(serialized).not.toContain("IB1|");
    expect(serialized).not.toContain("prv_item");
    expect(serialized).not.toContain("prv_lot");
    expect(serialized).not.toContain("18450");
  });

  it("reports one event per settled read, not one per render", () => {
    const port = recordingPort();
    window.localStorage.setItem(
      WAREHOUSE_STORAGE_KEY,
      PREVIEW_WAREHOUSES[0]?.id ?? "",
    );

    renderWithIntl(
      <ObservabilityProvider port={port}>
        <WorkspaceProvider>
          <BalancesPanel />
        </WorkspaceProvider>
      </ObservabilityProvider>,
      { environment: testEnvironment },
    );

    /*
     * The workspace provider resolves the stored warehouse through an external
     * store, so this tree renders more than once before it settles. A counter
     * that incremented per render would measure React rather than the ledger.
     */
    expect(
      port.events.filter((event) => event.code === SLI_CODES.ledgerRead),
    ).toHaveLength(1);
  });
});
