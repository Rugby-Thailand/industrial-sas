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
import { OwnerPressureRadarView } from "./OwnerPressureRadar";
import { OwnerPulseCards } from "./OwnerPulse";
import { QuickActionMenu } from "./DashboardQuickActions";

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
        <OwnerPressureRadarView
          tiles={previewDashboardTiles()}
          occupancy={{
            cells: previewOccupancyFor(BANG_PU),
            complete: true,
          }}
        />
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
    const { container } = renderWithIntl(
      <FailedAdvance code="ARTIFACT_LIMIT_REACHED" />,
      { environment: testEnvironment },
    );

    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });
});
