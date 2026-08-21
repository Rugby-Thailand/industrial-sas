import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { navigationMock } from "../../../tests/fixtures/navigation-mock";

vi.mock("@/i18n/navigation", () => navigationMock);

import {
  previewEnvironment,
  renderWithIntl,
} from "../../../tests/fixtures/intl-render";
import { previewOperatorTasksFor } from "@/lib/preview/operatorWorkPreview";

import { SupervisorStepUpPanel } from "./SupervisorStepUpPanel";

const tasks = previewOperatorTasksFor("prv_wh_bangpoo");

describe("supervisor step-up panel", () => {
  it("explains same-device, fresh-identity approval before offering it", () => {
    renderWithIntl(
      <SupervisorStepUpPanel task={tasks[0]!} connectionStatus="PREVIEW" />,
      { environment: previewEnvironment },
    );

    expect(screen.getByTestId("step-up-device-binding")).toHaveTextContent(
      "ต้องลงทะเบียนอุปกรณ์จริงเครื่องนี้ก่อน",
    );
    expect(screen.getByTestId("form-step-up-approval")).toHaveTextContent(
      "พนักงานอนุมัติงานของตนเองไม่ได้",
    );
    expect(screen.getByLabelText("การตัดสิน")).toBeInTheDocument();
    expect(
      screen.getByLabelText("เหตุผลที่ยืนยันว่าถูกต้อง"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^install_/)).not.toBeInTheDocument();
  });

  it("blocks approval while disconnected", () => {
    renderWithIntl(
      <SupervisorStepUpPanel
        task={tasks[0]!}
        connectionStatus="DISCONNECTED"
      />,
      { environment: previewEnvironment },
    );
    expect(screen.getByTestId("step-up-offline")).toBeInTheDocument();
    expect(
      screen.queryByTestId("form-step-up-approval"),
    ).not.toBeInTheDocument();
  });

  it("requires a live task holder", () => {
    renderWithIntl(
      <SupervisorStepUpPanel task={tasks[2]!} connectionStatus="CONNECTED" />,
      { environment: previewEnvironment },
    );
    expect(screen.getByTestId("step-up-task-not-held")).toBeInTheDocument();
  });
});
