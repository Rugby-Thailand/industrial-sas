import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { navigationMock } from "../../../tests/fixtures/navigation-mock";

vi.mock("@/i18n/navigation", () => navigationMock);

import {
  previewEnvironment,
  renderWithIntl,
} from "../../../tests/fixtures/intl-render";
import { previewOperatorTasksFor } from "@/lib/preview/operatorWorkPreview";

import { TaskQuantityEvidence } from "./TaskQuantityEvidence";

const tasks = previewOperatorTasksFor("prv_wh_bangpoo");

describe("task quantity evidence", () => {
  it("previews Thai digits and requires a deliberate record press", () => {
    renderWithIntl(
      <TaskQuantityEvidence task={tasks[0]!} connectionStatus="CONNECTED" />,
      { environment: previewEnvironment },
    );

    expect(screen.getByText(/จำนวนที่คาดไว้ 120 EA/)).toBeInTheDocument();
    const input = screen.getByTestId("task-quantity-input");
    const confirm = screen.getByTestId("task-quantity-confirm");
    expect(confirm).toBeDisabled();

    fireEvent.change(input, { target: { value: "๑๒" } });
    expect(
      screen.getByTestId("task-quantity-input-feedback"),
    ).toHaveTextContent("ระบบจะอ่านเป็น 12 EA");
    expect(confirm).toBeEnabled();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.queryByTestId("write-DEMONSTRATED")).not.toBeInTheDocument();
    fireEvent.click(confirm);
    expect(screen.getByTestId("write-DEMONSTRATED")).toBeInTheDocument();
  });

  it("blocks quantity and approval writes when disconnected", () => {
    renderWithIntl(
      <TaskQuantityEvidence task={tasks[0]!} connectionStatus="DISCONNECTED" />,
      { environment: previewEnvironment },
    );
    expect(screen.getByTestId("task-quantity-offline")).toBeInTheDocument();
    expect(screen.getByTestId("task-quantity-input")).toBeDisabled();
    expect(screen.getByTestId("task-quantity-confirm")).toBeDisabled();
    expect(screen.getByTestId("step-up-offline")).toBeInTheDocument();
  });

  it("refuses to imply conversion when the task has no item", () => {
    renderWithIntl(
      <TaskQuantityEvidence task={tasks[2]!} connectionStatus="PREVIEW" />,
      { environment: previewEnvironment },
    );
    expect(screen.getByTestId("task-quantity-no-item")).toHaveTextContent(
      "งานนี้ยังไม่มีสินค้าที่ต้องนับ",
    );
    expect(
      screen.queryByTestId("task-quantity-evidence"),
    ).not.toBeInTheDocument();
  });
});
