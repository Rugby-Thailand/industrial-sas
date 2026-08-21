import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  previewEnvironment,
  renderWithIntl,
} from "../../../tests/fixtures/intl-render";
import { previewOperatorTasksFor } from "@/lib/preview/operatorWorkPreview";

import { OperatorTaskHeader } from "./OperatorTaskHeader";

const task = previewOperatorTasksFor("prv_wh_bangpoo")[0]!;

describe("operator task header", () => {
  it("keeps document, owner, SLA, progress, and connection state visible", () => {
    renderWithIntl(
      <OperatorTaskHeader
        task={{ ...task, dueAt: Date.UTC(2026, 0, 5, 3, 30) }}
        connectionStatus="DISCONNECTED"
      />,
      { environment: previewEnvironment },
    );

    const header = screen.getByTestId("operator-task-header");
    expect(header).toHaveTextContent("WT-2601-001");
    expect(header).toHaveTextContent("งานที่หัวหน้างานมอบหมาย");
    expect(header).toHaveTextContent("คุณกำลังถืองาน");
    expect(header).toHaveTextContent("4 รายการ");
    expect(header).toHaveTextContent("การเชื่อมต่อหลุด");
    expect(header).toHaveTextContent("5 ม.ค. 2569");
  });

  it("warns before the claimed task's irreversible completion", () => {
    renderWithIntl(
      <OperatorTaskHeader task={task} connectionStatus="CONNECTED" />,
      { environment: previewEnvironment },
    );

    expect(screen.getByTestId("task-irreversible-warning")).toHaveTextContent(
      "ตรวจสอบก่อนปิดงาน",
    );
    expect(screen.getByText("เชื่อมต่อเซิร์ฟเวอร์แล้ว")).toBeInTheDocument();
  });

  it("does not show a completion warning for an unclaimed task", () => {
    renderWithIntl(
      <OperatorTaskHeader
        task={previewOperatorTasksFor("prv_wh_bangpoo")[2]!}
        connectionStatus="PREVIEW"
      />,
      { environment: previewEnvironment },
    );

    expect(screen.getByText("ยังไม่มีผู้รับงาน")).toBeInTheDocument();
    expect(
      screen.queryByTestId("task-irreversible-warning"),
    ).not.toBeInTheDocument();
  });
});
