import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { navigationMock } from "../../../tests/fixtures/navigation-mock";

vi.mock("@/i18n/navigation", () => navigationMock);

import {
  testEnvironment,
  renderWithIntl,
} from "../../../tests/fixtures/intl-render";
import { writeStoredWarehouse } from "@/lib/workspace/warehouseStore";

import { ConfirmPutawayForm, PutawayTasksPanel } from "./PutawayTasks";

/**
 * Two audit findings meet on this screen.
 *
 * The row control on a claimed task read "Already claimed" — a state, on an
 * enabled button, next to a status column already saying the same thing. A
 * control's label has to name what pressing it does; the state belongs in the
 * status cell, as the static glyph-and-word badge every other state uses.
 *
 * The claim itself stays available, because re-claiming your own task after a
 * reconnect is the documented recovery (`INV-0007-11`) and the server refuses
 * somebody else's. What changed is the wording, not the permission.
 */
const BANG_PU = "prv_wh_bangpoo";

const renderBoard = (locale: "th" | "en" = "th") => {
  writeStoredWarehouse(BANG_PU);
  return renderWithIntl(<PutawayTasksPanel />, {
    locale,
    environment: testEnvironment,
  });
};

describe("the putaway board's claim control", () => {
  it("labels a claimed task's control with the action, not with the state", () => {
    renderBoard();

    const claimed = screen.getByTestId("task-claim-prv_task_4002");
    expect(claimed).toHaveTextContent("รับงานนี้อีกครั้ง");
    expect(claimed.textContent).not.toContain("งานนี้มีผู้รับแล้ว");
  });

  it("says who is holding the task before the control is pressed", () => {
    // The explanation was the button's only justification for reading as a
    // state; it survives as the control's own description.
    renderBoard();

    expect(screen.getByTestId("task-claim-prv_task_4002")).toHaveAttribute(
      "title",
      "ผู้ใช้คนอื่นรับงานนี้ไปแล้ว ถ้าคุณคือผู้รับเดิม ให้กดรับงานอีกครั้งหลังเชื่อมต่อใหม่",
    );
  });

  it("renders the claimed state once, statically, in the status column", () => {
    /*
     * A row's state is a badge — a glyph and a word, not a control (`INV-0010-07`).
     * Asserting it is not a button is the half that regressed: an operator
     * cannot tell "this is what the task is" from "this is what you may do" when
     * both are rendered as pressable outlines.
     */
    renderBoard();

    const state = screen.getByText("มีผู้รับงานแล้ว");
    expect(state.closest("button")).toBeNull();
    expect(screen.getAllByText("มีผู้รับงานแล้ว")).toHaveLength(1);
  });

  it("still offers an unclaimed task a plain claim", () => {
    renderBoard();

    expect(screen.getByTestId("task-claim-prv_task_4001")).toHaveTextContent(
      "รับงานนี้",
    );
  });

  it("says the same thing in English", () => {
    renderBoard("en");

    expect(screen.getByTestId("task-claim-prv_task_4002")).toHaveTextContent(
      "Claim again",
    );
    expect(screen.getByTestId("task-claim-prv_task_4001")).toHaveTextContent(
      "Claim",
    );
    expect(screen.queryByText("Already claimed")).not.toBeInTheDocument();
  });

  it("shows each task's quantity in the item's own base unit", () => {
    /*
     * A board holds kilograms of coil, eaches of carton, and litres of resin in
     * one column. `180.000` alone is three different measures; the unit comes
     * from the item document, joined by the server.
     */
    renderBoard();

    const table = screen.getByTestId("table-putaway-tasks");
    expect(within(table).getByText("180.000 KG")).toBeInTheDocument();
    expect(within(table).getByText("24.000 EA")).toBeInTheDocument();
    expect(within(table).getByText("60.000 L")).toBeInTheDocument();
  });
});

describe("the putaway confirmation form", () => {
  const renderForm = () => {
    writeStoredWarehouse(BANG_PU);
    return renderWithIntl(
      <ConfirmPutawayForm
        putawayTaskId="prv_task_4001"
        locations={[{ value: "prv_loc_A01-02-1", label: "A01-02-1" }]}
      />,
      { environment: testEnvironment },
    );
  };

  it("asks the location select for a choice rather than repeating its label", () => {
    // An empty select reading the same words as the label above it states the
    // field twice and the outstanding decision not at all.
    renderForm();

    expect(
      screen.getByText("เลือกตำแหน่งที่นำสินค้าไปวางจริง"),
    ).toBeInTheDocument();
    // The label is still there, once, attached to the control.
    expect(screen.getByText("ตำแหน่งที่จัดเก็บจริง")).toBeInTheDocument();
  });
});
