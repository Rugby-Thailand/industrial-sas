import { axe } from "jest-axe";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { navigationMock } from "../../../tests/fixtures/navigation-mock";

vi.mock("@/i18n/navigation", () => navigationMock);

import {
  previewEnvironment,
  renderWithIntl,
} from "../../../tests/fixtures/intl-render";
import { OperatorTaskTable } from "@/components/operator/OperatorTaskTable";
import { OperatorTaskHeader } from "@/components/operator/OperatorTaskHeader";
import { QuantityEntryField } from "@/components/operator/QuantityEntryField";
import { DeviceTable } from "@/components/platform/DeviceTable";
import {
  PREVIEW_OPERATOR_USER_ID,
  previewDevicesFor,
  previewOperatorTasksFor,
} from "@/lib/preview/operatorWorkPreview";

import { OperatorWorkBoard } from "./OperatorWorkBoard";
import { SupervisorStepUpPanel } from "./SupervisorStepUpPanel";
import { TaskEvidenceTimeline } from "./TaskEvidenceTimeline";
import { TaskAttachmentPanel } from "./TaskAttachmentPanel";
import { TaskExceptionSheet } from "./TaskExceptionSheet";
import { TaskQuantityEvidence } from "./TaskQuantityEvidence";
import { TaskScanEvidence } from "./TaskScanEvidence";
import { DeviceRegistryPanel } from "../platform/DeviceRegistryPanel";

/**
 * Accessibility tier — the Phase 1 shared operator surfaces (`ADR-0010`, WCAG
 * 2.2 AA), rendered in Thai because Thai is what changes the line height,
 * the wrapping, and the length of every label here.
 *
 * The quantity field is the one worth a note. It is the control an operator
 * uses most and the one most likely to lose its label to a redesign: the number
 * and its unit are two controls that mean one thing, so both are labelled and
 * the parsed preview is wired to the input through `aria-describedby` rather
 * than floating beside it as decoration.
 */
const WAREHOUSE = "prv_wh_bangpoo";

const clean = async (ui: React.ReactElement) => {
  const { container } = renderWithIntl(ui, {
    environment: previewEnvironment,
  });
  expect(await axe(container)).toHaveNoViolations();
};

function QuantityHarness() {
  const [value, setValue] = useState("๑๒");
  const [uom, setUom] = useState("PCS");
  return (
    <QuantityEntryField
      value={value}
      onValueChange={setValue}
      uom={uom}
      onUomChange={setUom}
      uomOptions={[
        { value: "PCS", label: "ชิ้น" },
        { value: "CASE", label: "ลัง" },
      ]}
      labels={{
        quantityLabel: "จำนวน",
        uomLabel: "หน่วยที่นับ",
        uomPlaceholder: "เลือกหน่วย",
        previewLabel: "ระบบจะอ่านเป็น",
        errors: {},
        genericError: "ระบบอ่านจำนวนนี้ไม่ได้",
      }}
      testId="quantity"
    />
  );
}

describe("shared operator accessibility", () => {
  it("the work board table has no violations", async () => {
    await clean(
      <OperatorTaskTable
        rows={previewOperatorTasksFor(WAREHOUSE)}
        currentUserId={PREVIEW_OPERATOR_USER_ID}
      />,
    );
  });

  it("the work board, including its blocked-action notice, has no violations", async () => {
    await clean(<OperatorWorkBoard />);
  });

  it("the shared quantity entry has no violations", async () => {
    await clean(<QuantityHarness />);
  });

  it("the shared task scan surface has no violations", async () => {
    await clean(
      <TaskScanEvidence
        task={previewOperatorTasksFor(WAREHOUSE)[0]!}
        connectionStatus="CONNECTED"
      />,
    );
  });

  it("the task context header has no violations", async () => {
    await clean(
      <OperatorTaskHeader
        task={previewOperatorTasksFor(WAREHOUSE)[0]!}
        connectionStatus="DISCONNECTED"
      />,
    );
  });

  it("the task evidence timeline has no violations", async () => {
    window.localStorage.setItem("industrial-sas.warehouse", WAREHOUSE);
    await clean(
      <TaskEvidenceTimeline task={previewOperatorTasksFor(WAREHOUSE)[0]!} />,
    );
    window.localStorage.clear();
  });

  it("the task exception report and resolution sheet has no violations", async () => {
    window.localStorage.setItem("industrial-sas.warehouse", WAREHOUSE);
    await clean(
      <TaskExceptionSheet
        task={previewOperatorTasksFor(WAREHOUSE)[0]!}
        connectionStatus="PREVIEW"
      />,
    );
    window.localStorage.clear();
  });

  it("the same-device supervisor step-up panel has no violations", async () => {
    await clean(
      <SupervisorStepUpPanel
        task={previewOperatorTasksFor(WAREHOUSE)[0]!}
        connectionStatus="PREVIEW"
      />,
    );
  });

  it("the quantity and approval recovery flow has no violations", async () => {
    await clean(
      <TaskQuantityEvidence
        task={previewOperatorTasksFor(WAREHOUSE)[0]!}
        connectionStatus="PREVIEW"
      />,
    );
  });

  it("the private task attachment metadata surface has no violations", async () => {
    window.localStorage.setItem("industrial-sas.warehouse", WAREHOUSE);
    await clean(
      <TaskAttachmentPanel
        task={previewOperatorTasksFor(WAREHOUSE)[0]!}
        connectionStatus="PREVIEW"
      />,
    );
    window.localStorage.clear();
  });

  it("the device registry table has no violations", async () => {
    await clean(<DeviceTable rows={previewDevicesFor(WAREHOUSE)} />);
  });

  it("the device registration and binding surface has no violations", async () => {
    await clean(<DeviceRegistryPanel />);
  });
});
