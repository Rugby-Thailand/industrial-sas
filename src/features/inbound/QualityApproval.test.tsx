import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { navigationMock } from "../../../tests/fixtures/navigation-mock";

vi.mock("@/i18n/navigation", () => navigationMock);

import {
  testEnvironment,
  renderWithIntl,
} from "../../../tests/fixtures/intl-render";
import { writeStoredWarehouse } from "@/lib/workspace/warehouseStore";

import { ApproveDispositionControl } from "./QualityApproval";

const BANG_PU = "prv_wh_bangpoo";

const render = (locale: "th" | "en" = "th") => {
  writeStoredWarehouse(BANG_PU);
  return renderWithIntl(<ApproveDispositionControl />, {
    locale,
    environment: testEnvironment,
  });
};

describe("the disposition approval control", () => {
  it("states the second-person rule exactly once", () => {
    render();

    expect(
      screen.getAllByText(
        "ต้องเป็นผู้ใช้คนละคนกับผู้บันทึกผล และต้องยืนยันตัวตนซ้ำ",
      ),
    ).toHaveLength(1);
  });

  it("keeps the rule visible above the control", () => {
    render();

    const notice = screen.getByTestId("quality-approval-rule");
    expect(notice).toHaveTextContent("ต้องมีผู้ใช้คนที่สองเป็นผู้อนุมัติ");
    expect(notice).toHaveTextContent(/ต้องเป็นผู้ใช้คนละคนกับผู้บันทึกผล/);
  });

  it("says the action once, on the control that performs it", () => {
    render();

    const action = screen.getAllByText("อนุมัติผลนี้");
    expect(action).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "อนุมัติผลนี้" }),
    ).toBeInTheDocument();

    expect(screen.getByText("เลือกผลที่จะอนุมัติ")).toBeInTheDocument();
  });

  it("does not repeat itself in English either", () => {
    render("en");

    expect(
      screen.getAllByText(
        "Needs a different person from the one who recorded it, and a re-verified session.",
      ),
    ).toHaveLength(1);
    expect(screen.getAllByText("Approve this disposition")).toHaveLength(1);
  });
});
