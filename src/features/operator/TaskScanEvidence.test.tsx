import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { navigationMock } from "../../../tests/fixtures/navigation-mock";

vi.mock("@/i18n/navigation", () => navigationMock);

import {
  previewEnvironment,
  renderWithIntl,
} from "../../../tests/fixtures/intl-render";
import { previewOperatorTasksFor } from "@/lib/preview/operatorWorkPreview";

import { TaskScanEvidence } from "./TaskScanEvidence";

const task = previewOperatorTasksFor("prv_wh_bangpoo")[0]!;

const render = () =>
  renderWithIntl(
    <TaskScanEvidence task={task} connectionStatus="CONNECTED" />,
    { environment: previewEnvironment },
  );

describe("task scan evidence", () => {
  it("uses Enter to resolve but requires a separate confirmation to record", () => {
    render();
    fireEvent.change(screen.getByLabelText("สแกนหรือกรอกรหัสสินค้า"), {
      target: { value: "CTN-A4" },
    });
    fireEvent.keyDown(screen.getByLabelText("สแกนหรือกรอกรหัสสินค้า"), {
      key: "Enter",
    });

    expect(screen.getByTestId("task-scan-resolved")).toHaveTextContent(
      "CTN-A4",
    );
    expect(screen.getByTestId("task-scan-confirm")).toBeEnabled();
    expect(screen.queryByTestId("write-DEMONSTRATED")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("task-scan-confirm"));
    expect(screen.getByTestId("write-DEMONSTRATED")).toHaveTextContent(
      "ไม่ได้บันทึกข้อมูล",
    );
  });

  it("blocks a resolved item that is not the item on the task", () => {
    render();
    fireEvent.change(screen.getByLabelText("สแกนหรือกรอกรหัสสินค้า"), {
      target: { value: "BOLT-M8-30" },
    });
    fireEvent.click(screen.getByTestId("scan-to-item-resolve"));

    expect(screen.getByTestId("task-scan-mismatch")).toHaveTextContent(
      "BOLT-M8-30",
    );
    expect(screen.getByTestId("task-scan-confirm")).toBeDisabled();
  });

  it("requires a reason when the operator declares manual entry", () => {
    render();
    fireEvent.change(screen.getByLabelText("สแกนหรือกรอกรหัสสินค้า"), {
      target: { value: "CTN-A4" },
    });
    fireEvent.click(screen.getByTestId("scan-to-item-resolve"));
    fireEvent.click(screen.getByLabelText("พิมพ์ด้วยตนเอง"));

    expect(screen.getByTestId("task-scan-confirm")).toBeDisabled();
    fireEvent.change(screen.getByTestId("task-scan-manual-reason"), {
      target: { value: "บาร์โค้ดชำรุด" },
    });
    expect(screen.getByTestId("task-scan-confirm")).toBeEnabled();
  });

  it("states camera fallback is unavailable instead of offering a dead control", () => {
    render();
    expect(screen.getByTestId("camera-fallback-status")).toHaveTextContent(
      "ยังไม่เปิดใช้การสแกนด้วยกล้อง",
    );
  });
});
