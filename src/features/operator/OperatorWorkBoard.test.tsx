import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { navigationMock } from "../../../tests/fixtures/navigation-mock";

vi.mock("@/i18n/navigation", () => navigationMock);

import {
  previewEnvironment,
  renderWithIntl,
} from "../../../tests/fixtures/intl-render";
import { OperatorTaskTable } from "@/components/operator/OperatorTaskTable";
import {
  PREVIEW_OPERATOR_USER_ID,
  previewOperatorTasksFor,
} from "@/lib/preview/operatorWorkPreview";

import { OperatorWorkBoard } from "./OperatorWorkBoard";

/**
 * What the shared work board must say, and what it must never imply.
 *
 * Each of these is a presentation claim with an operational consequence: a
 * lapsed hold that read as "in progress" would leave a task nobody is doing; a
 * takeover that hid the evidence count would make an operator redo forty scans;
 * and a claim button offered while the link is down would produce a refusal
 * where a disabled control with a reason belongs.
 */
const WAREHOUSE = "prv_wh_bangpoo";

const rows = previewOperatorTasksFor(WAREHOUSE);

describe("the work board table", () => {
  const render = () =>
    renderWithIntl(
      <OperatorTaskTable
        rows={rows}
        currentUserId={PREVIEW_OPERATOR_USER_ID}
      />,
      { environment: previewEnvironment },
    );

  it("distinguishes a task you hold from one somebody else holds", () => {
    render();
    expect(screen.getByText(/คุณถืออยู่ เหลือ 4 นาที/)).toBeInTheDocument();
    expect(screen.getByText(/มีคนถืออยู่ เหลือ 2 นาที/)).toBeInTheDocument();
  });

  it("says a lapsed hold is free to take, in words rather than by colour", () => {
    render();
    expect(
      screen.getByText("การถือครองหมดอายุ — รับต่อได้"),
    ).toBeInTheDocument();
  });

  it("shows how much work is already recorded, including none", () => {
    render();
    // The lapsed task carries twelve entries; losing them is the failure the
    // lease exists to prevent, so the count is on the row before anybody takes it.
    expect(screen.getByText("12 รายการ")).toBeInTheDocument();
    expect(screen.getByText("ยังไม่มี")).toBeInTheDocument();
  });

  it("names every status in Thai rather than by its code", () => {
    render();
    expect(screen.queryByText("AVAILABLE")).not.toBeInTheDocument();
    expect(screen.getByText("อยู่ในคิว")).toBeInTheDocument();
  });

  it("labels the control by what pressing it does, per lease state", () => {
    renderWithIntl(
      <OperatorTaskTable
        rows={rows}
        currentUserId={PREVIEW_OPERATOR_USER_ID}
        renderAction={(row) => (
          <button type="button" disabled>
            {row.lease.kind === "EXPIRED" ? "รับงานต่อ" : "รับงานนี้"}
          </button>
        )}
      />,
      { environment: previewEnvironment },
    );
    expect(screen.getAllByRole("button", { name: "รับงานต่อ" })).toHaveLength(
      1,
    );
    expect(screen.getAllByRole("button", { name: "รับงานนี้" })).toHaveLength(
      3,
    );
  });
});

describe("the work board", () => {
  const render = () =>
    renderWithIntl(<OperatorWorkBoard />, {
      environment: previewEnvironment,
    });

  it("opens on My work rather than on the site queue", () => {
    render();
    expect(screen.getByTestId("work-scope-MINE")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("work-scope-SITE")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("says why work cannot be started when there is no server to answer", () => {
    render();
    /*
     * Preview data is not a server (`isServerHealthy` refuses to call it
     * healthy), so a command that must reach one is blocked — and the notice
     * says which command and why, rather than showing a spinner or a control
     * that would fail on the first tap.
     */
    const notice = screen.getByTestId("work-offline-notice");
    expect(notice).toHaveTextContent("ยังเริ่มงานตอนนี้ไม่ได้");
    expect(notice).toHaveTextContent(/พนักงานคนอื่นอาจกำลังรับงานเดียวกัน/);
  });

  it("says a warehouse has to be chosen before any work can be read", () => {
    /*
     * A board with no site is not an empty board: every task belongs to a
     * warehouse, and rendering "no tasks" for "no site chosen" is the state
     * confusion plan §4 invariant 20 exists to prevent.
     */
    render();
    expect(screen.getByTestId("panel-WAREHOUSE_MISSING")).toBeInTheDocument();
    expect(
      screen.queryByTestId("table-operator-tasks"),
    ).not.toBeInTheDocument();
  });
});
