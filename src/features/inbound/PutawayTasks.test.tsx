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
    renderBoard();

    expect(screen.getByTestId("task-claim-prv_task_4002")).toHaveAttribute(
      "title",
      "ผู้ใช้คนอื่นรับงานนี้ไปแล้ว ถ้าคุณคือผู้รับเดิม ให้กดรับงานอีกครั้งหลังเชื่อมต่อใหม่",
    );
  });

  it("renders the claimed state once, statically, in the status column", () => {
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
    renderForm();

    expect(
      screen.getByText("เลือกตำแหน่งที่นำสินค้าไปวางจริง"),
    ).toBeInTheDocument();

    expect(screen.getByText("ตำแหน่งที่จัดเก็บจริง")).toBeInTheDocument();
  });
});
