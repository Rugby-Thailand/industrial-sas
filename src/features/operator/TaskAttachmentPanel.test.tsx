import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { navigationMock } from "../../../tests/fixtures/navigation-mock";

vi.mock("@/i18n/navigation", () => navigationMock);

import {
  previewEnvironment,
  renderWithIntl,
} from "../../../tests/fixtures/intl-render";
import { previewOperatorTasksFor } from "@/lib/preview/operatorWorkPreview";
import { writeStoredWarehouse } from "@/lib/workspace/warehouseStore";

import { TaskAttachmentPanel } from "./TaskAttachmentPanel";

const task = previewOperatorTasksFor("prv_wh_bangpoo")[0]!;

beforeEach(() => writeStoredWarehouse("prv_wh_bangpoo"));
afterEach(() => window.localStorage.clear());

describe("private task attachment panel", () => {
  it("shows metadata without pretending preview bytes are downloadable", () => {
    renderWithIntl(
      <TaskAttachmentPanel task={task} connectionStatus="PREVIEW" />,
      { environment: previewEnvironment },
    );
    expect(screen.getByTestId("task-attachment-preview")).toHaveTextContent(
      "ไม่มีไฟล์จริง",
    );
    expect(screen.getByTestId("task-attachment-list")).toHaveTextContent(
      "ฉลากชำรุด.jpg",
    );
    expect(screen.getByRole("button", { name: "ขอดาวน์โหลด" })).toBeDisabled();
    expect(screen.queryByText(/^task_private_/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^0{64}$/)).not.toBeInTheDocument();
  });
});
