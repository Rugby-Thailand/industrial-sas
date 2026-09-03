import { screen, within } from "@testing-library/react";
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
import { writeStoredWarehouse } from "@/lib/workspace/warehouseStore";

import { JobList } from "./ExportWorkbench";
import { OccupancyGrid } from "./OccupancyMap";
import { TileList } from "./OperationsTiles";

const BANG_PU = "prv_wh_bangpoo";

describe("the operations tiles", () => {
  const render = () =>
    renderWithIntl(<TileList tiles={previewDashboardTiles()} label="สรุป" />, {
      environment: testEnvironment,
    });

  it("labels every counter in the reader's language, never by its code", () => {
    render();

    expect(screen.getByTestId("tile-RECEIPTS_OPENED")).not.toHaveTextContent(
      "RECEIPTS_OPENED",
    );
    expect(screen.getByText("ใบรับสินค้าที่เปิดแล้ว")).toBeInTheDocument();
  });

  it("says when a counter last moved, so a zero is readable", () => {
    render();
    expect(screen.getAllByText(/ข้อมูล ณ/).length).toBeGreaterThan(0);
  });

  it("marks a suspect counter in words, not only by colour", () => {
    render();

    const suspect = screen.getByTestId("tile-suspect-QC_PARKED");
    expect(suspect).toBeInTheDocument();
    expect(suspect.textContent ?? "").not.toBe("");
  });

  it("gives the suspect counter a callout, not a multi-line pill", () => {
    render();

    const suspect = screen.getByTestId("tile-suspect-QC_PARKED");
    expect(suspect).toHaveClass("rounded-lg", "border-l-4", "border-warning");
    expect(suspect.className).not.toContain("rounded-full");

    expect(
      within(suspect).getByText("เคยมีการปรับลดตัวเลขนี้"),
    ).toBeInTheDocument();
    expect(
      within(suspect).getByText(/ตัวเลขนี้อาจต่ำกว่าความจริง/),
    ).toBeInTheDocument();
  });

  it("renders every declared metric as its own tile", () => {
    render();
    expect(screen.getAllByRole("term")).toHaveLength(
      previewDashboardTiles().length,
    );
  });

  it("separates actionable backlog from cumulative volume", () => {
    render();

    const backlogHeading = screen.getByRole("heading", {
      name: "งานค้างที่ต้องทำ",
    });
    const volumeHeading = screen.getByRole("heading", {
      name: "ปริมาณงานที่บันทึกแล้ว",
    });
    const backlogGroup = backlogHeading.closest("section");
    const volumeGroup = volumeHeading.closest("section");

    expect(backlogGroup).not.toBeNull();
    expect(volumeGroup).not.toBeNull();
    expect(
      within(backlogGroup as HTMLElement).getByTestId("tile-QC_PENDING"),
    ).toBeInTheDocument();
    expect(
      within(volumeGroup as HTMLElement).getByTestId("tile-RECEIPTS_OPENED"),
    ).toBeInTheDocument();
    expect(
      within(backlogGroup as HTMLElement).queryByTestId("tile-RECEIPTS_OPENED"),
    ).not.toBeInTheDocument();
  });
});

describe("the occupancy map", () => {
  const render = (complete = true) =>
    renderWithIntl(
      <OccupancyGrid
        cells={previewOccupancyFor(BANG_PU)}
        complete={complete}
      />,
      { environment: testEnvironment },
    );

  it("is a table, so it is navigable and announced by row", () => {
    render();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("prints the band as a word in every cell", () => {
    render();

    const dock = screen.getByTestId("occupancy-DOCK-IN-1");
    expect(dock).toHaveTextContent("DOCK-IN-1");
    expect(dock).toHaveTextContent("ใช้พื้นที่มาก");
    expect(dock).toHaveTextContent("4");
  });

  it("counts each band in the legend", () => {
    render();
    expect(screen.getByTestId("legend-FULL")).toHaveTextContent("เต็ม");
    expect(screen.queryByTestId("occupancy-pressure")).not.toBeInTheDocument();
  });

  it("shows the percentage of mapped locations that contain stock", () => {
    render();

    const progress = screen.getByRole("progressbar", {
      name: /ใช้ตำแหน่งที่แสดง 80%/,
    });
    expect(progress).toHaveAttribute("aria-valuenow", "80");
    expect(screen.getByTestId("occupancy-utilization")).toHaveTextContent(
      "มีสินค้า 4 จาก 5 ตำแหน่ง",
    );
  });

  it("says so when the map is not the whole site", () => {
    render(false);
    expect(screen.getByTestId("occupancy-partial")).toBeInTheDocument();
  });

  it("stays quiet when the map is complete", () => {
    render();
    expect(screen.queryByTestId("occupancy-partial")).not.toBeInTheDocument();
  });
});

describe("the export register", () => {
  const render = () => {
    writeStoredWarehouse("prv_wh_bangpoo");
    return renderWithIntl(<JobList jobs={PREVIEW_REPORT_JOBS} />, {
      environment: testEnvironment,
    });
  };

  it("shows a stopped export as stopped, with the reason", () => {
    render();

    const failure = screen.getByTestId("report-job-failure-prv_rpt_7003");
    expect(failure).toHaveTextContent("ARTIFACT_LIMIT_REACHED");
    expect(failure.textContent ?? "").toContain("ไม่ครบถ้วน");
  });

  it("offers no download for a job that stopped", () => {
    render();
    expect(
      screen.queryByTestId("report-download-prv_rpt_7003"),
    ).not.toBeInTheDocument();
  });

  it("offers a download only once the job is complete", () => {
    render();
    expect(
      screen.getByTestId("report-download-prv_rpt_7001"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("report-advance-prv_rpt_7002"),
    ).toBeInTheDocument();
  });

  it("groups large row counts in both supported locales", () => {
    const thai = render();
    expect(thai.getByText("9,512 แถวทั้งหมด")).toBeInTheDocument();
    thai.unmount();

    renderWithIntl(<JobList jobs={PREVIEW_REPORT_JOBS} />, {
      environment: testEnvironment,
      locale: "en",
    });
    expect(screen.getByText("9,512 rows total")).toBeInTheDocument();
  });
});
