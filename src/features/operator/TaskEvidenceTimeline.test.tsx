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

import { TaskEvidenceTimeline } from "./TaskEvidenceTimeline";

const WAREHOUSE = "prv_wh_bangpoo";
const task = previewOperatorTasksFor(WAREHOUSE)[0]!;

beforeEach(() => writeStoredWarehouse(WAREHOUSE));
afterEach(() => window.localStorage.clear());

describe("task evidence timeline", () => {
  it("renders retained scans and quantities in sequence", () => {
    renderWithIntl(
      <WorkspaceProvider>
        <TaskEvidenceTimeline task={task} />
      </WorkspaceProvider>,
      { environment: previewEnvironment },
    );

    const list = screen.getByTestId("task-evidence-list");
    expect(list).toHaveTextContent("#1");
    expect(list).toHaveTextContent("สแกนสินค้า");
    expect(list).toHaveTextContent("CTN-A4");
    expect(list).toHaveTextContent("#2");
    expect(list).toHaveTextContent("จำนวน");
    expect(list).toHaveTextContent("24000 EA");
  });

  it("has a specifically named evidence pager", () => {
    renderWithIntl(
      <WorkspaceProvider>
        <TaskEvidenceTimeline task={task} />
      </WorkspaceProvider>,
      { environment: previewEnvironment },
    );
    expect(
      screen.getByRole("navigation", { name: "หน้ารายการหลักฐานของงาน" }),
    ).toBeInTheDocument();
  });
});
