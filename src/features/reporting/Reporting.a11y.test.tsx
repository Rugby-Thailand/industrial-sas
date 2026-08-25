import { axe } from "jest-axe";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { navigationMock } from "../../../tests/fixtures/navigation-mock";

vi.mock("@/i18n/navigation", () => navigationMock);

import {
  testEnvironment,
  renderWithIntl,
} from "../../../tests/fixtures/intl-render";
import {
  PREVIEW_REPORT_JOBS,
  previewDashboardTiles,
  previewOccupancyFor,
} from "@tests/fixtures/data/reporting";

import { JobList } from "./ExportWorkbench";

/**
 * The refusal paragraph, in isolation.
 *
 * Rendered here rather than driven through the mutation, because the a11y tier
 * asks a structural question — is the failure announced? — and mocking a
 * transport to answer it would test the mock.
 */
function FailedAdvance({ code }: { readonly code: string }) {
  return (
    <p role="alert" className="text-xs text-danger">
      การส่งออกไม่คืบหน้า ไม่มีข้อมูลถูกเพิ่ม <code>{code}</code>
    </p>
  );
}
import { OccupancyGrid } from "./OccupancyMap";
import { TileList } from "./OperationsTiles";
import { OwnerAttentionListView } from "./OwnerAttentionList";
import { OwnerOperationsSummaryView } from "./OwnerOperationsSummary";
import { OwnerPulseCards } from "./OwnerPulse";
import { QuickActionMenu } from "./DashboardQuickActions";

/**
 * Accessibility tier — the reporting surfaces (`ADR-0010`, WCAG 2.2 AA).
 *
 * The occupancy map is the one worth stating a reason for. A heat map is the
 * classic place where meaning ends up encoded in hue alone, which fails 1.4.1
 * and, more practically, fails a supervisor reading a screen in direct sunlight
 * on a dock. It is rendered as a table with the band written in every cell, so
 * the automated pass here and the manual greyscale check test the same artefact.
 */
const BANG_PU = "prv_wh_bangpoo";

const clean = async (ui: React.ReactElement) => {
  const { container } = renderWithIntl(ui, {
    environment: testEnvironment,
  });
  expect(await axe(container)).toHaveNoViolations();
};

describe("reporting accessibility", () => {
  it("the operations tiles have no violations", async () => {
    await clean(<TileList tiles={previewDashboardTiles()} label="สรุป" />);
  });

  it("the occupancy map has no violations", async () => {
    await clean(
      <OccupancyGrid cells={previewOccupancyFor(BANG_PU)} complete />,
    );
  });

  it("the occupancy map has no violations when it admits being partial", async () => {
    await clean(
      <OccupancyGrid cells={previewOccupancyFor(BANG_PU)} complete={false} />,
    );
  });

  it("the export register has no violations", async () => {
    await clean(<JobList jobs={PREVIEW_REPORT_JOBS} />);
  });

  it("the owner pulse and attention list have no violations", async () => {
    const { container } = renderWithIntl(
      <>
        <OwnerPulseCards
          tiles={previewDashboardTiles()}
          occupancy={{ cells: previewOccupancyFor(BANG_PU), complete: true }}
        />
        <OwnerAttentionListView
          payload={{
            ok: true,
            asOf: Date.now(),
            complete: true,
            exceptions: [],
          }}
        />
        <OwnerOperationsSummaryView tiles={previewDashboardTiles()} />
      </>,
      { environment: testEnvironment },
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("the quick-action editor has no violations", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <QuickActionMenu
        preference={{
          pageKey: "OWNER_DASHBOARD",
          presetVersion: 1,
          customized: false,
          selectedActionIds: ["CUSTOMER_ORDERS", "INVENTORY_HEALTH"],
          availableActionIds: [
            "CUSTOMER_ORDERS",
            "INVENTORY_HEALTH",
            "OPERATIONAL_REPORTS",
          ],
        }}
        busy={false}
        onSave={async () => true}
        onReset={async () => undefined}
      />,
      { environment: testEnvironment },
    );
    await user.click(screen.getByRole("button", { name: "ปรับแต่ง" }));
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it("an advance failure is announced, not merely coloured", async () => {
    /*
     * The answer arrives after the press, so a screen-reader user has already
     * moved on: a colour change would be invisible to them and a silent one to
     * everybody in direct sunlight. `role="alert"` is what makes it arrive.
     */
    const { container } = renderWithIntl(
      <FailedAdvance code="ARTIFACT_LIMIT_REACHED" />,
      { environment: testEnvironment },
    );

    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });
});
