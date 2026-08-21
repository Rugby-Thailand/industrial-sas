import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { navigationMock } from "../../../tests/fixtures/navigation-mock";

vi.mock("@/i18n/navigation", () => navigationMock);

import {
  previewEnvironment,
  renderWithIntl,
} from "../../../tests/fixtures/intl-render";
import { WorkspaceProvider } from "@/components/providers/WorkspaceProvider";
import { previewOperatorTasksFor } from "@/lib/preview/operatorWorkPreview";
import { writeStoredWarehouse } from "@/lib/workspace/warehouseStore";

import { TaskExceptionSheet } from "./TaskExceptionSheet";

const WAREHOUSE = "prv_wh_bangpoo";
const task = previewOperatorTasksFor(WAREHOUSE)[0]!;

beforeEach(() => writeStoredWarehouse(WAREHOUSE));
afterEach(() => window.localStorage.clear());

const render = (connectionStatus: "PREVIEW" | "DISCONNECTED" = "PREVIEW") =>
  renderWithIntl(
    <WorkspaceProvider>
      <TaskExceptionSheet task={task} connectionStatus={connectionStatus} />
    </WorkspaceProvider>,
    { environment: previewEnvironment },
  );

describe("task exception sheet", () => {
  it("shows report fields and preserves open and resolved exception decisions", () => {
    render();
    expect(
      screen.getByTestId("form-task-exception-report"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("เกิดอะไรขึ้น")).toBeInTheDocument();
    expect(screen.getByLabelText("หลักฐานที่พบ")).toBeInTheDocument();

    const list = screen.getByTestId("task-exception-list");
    expect(list).toHaveTextContent("ฉลากสินค้าฉีก");
    expect(list).toHaveTextContent("รอการตัดสิน");
    expect(list).toHaveTextContent("จำนวนบนฉลากไม่ตรง");
    expect(list).toHaveTextContent("แก้ไขแล้ว");
    expect(list).toHaveTextContent("ดำเนินงานต่อ");
  });

  it("offers maker-checker resolution only for an open exception", () => {
    render();
    const resolutionForms = screen.getAllByTestId(
      /^form-task-exception-resolve-/,
    );
    expect(resolutionForms).toHaveLength(1);
    expect(resolutionForms[0]).toHaveTextContent(
      "ผู้รายงานอนุมัติข้อยกเว้นของตนเองไม่ได้",
    );
  });

  it("keeps history readable but blocks changes while disconnected", () => {
    render("DISCONNECTED");
    expect(screen.getByTestId("task-exception-offline")).toBeInTheDocument();
    expect(
      screen.queryByTestId("form-task-exception-report"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("task-exception-list")).toBeInTheDocument();
    expect(
      screen.queryByTestId(/^form-task-exception-resolve-/),
    ).not.toBeInTheDocument();
  });
});
