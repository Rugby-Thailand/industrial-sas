import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { navigationMock } from "../../../tests/fixtures/navigation-mock";

vi.mock("@/i18n/navigation", () => navigationMock);

import {
  testEnvironment,
  renderWithIntl,
} from "../../../tests/fixtures/intl-render";
import { writeStoredWarehouse } from "@/lib/workspace/warehouseStore";

import { ImportWorkbench } from "./ImportWorkbench";

/**
 * The first import step said "Check the file" three times — as the section
 * heading, as the form's legend, and on the button — which is the P2 finding.
 * Each of the three answers a different question, and the button's is the one
 * that mattered: this step is a *query*, so the label has to say that pressing
 * it writes nothing.
 */
const BANG_PU = "prv_wh_bangpoo";

const render = (locale: "th" | "en" = "th") => {
  writeStoredWarehouse(BANG_PU);
  return renderWithIntl(<ImportWorkbench />, {
    locale,
    environment: testEnvironment,
  });
};

describe("the import workbench's first step", () => {
  it("names the step, the input, and the action differently", () => {
    render();

    const heading = screen.getByRole("heading", {
      name: "ตรวจสอบผลการอ่านไฟล์",
    });
    const form = screen.getByTestId("form-import-preview");
    const submit = screen.getByRole("button", {
      name: "อ่านไฟล์โดยยังไม่บันทึก",
    });

    expect(heading).toBeInTheDocument();
    expect(form.textContent).toContain("ไฟล์ที่จะตรวจสอบ");
    expect(submit).toBeInTheDocument();

    // The one that regressed: the control must not carry the step's name.
    expect(
      screen.queryByRole("button", { name: "ตรวจสอบผลการอ่านไฟล์" }),
    ).not.toBeInTheDocument();
  });

  it("says on the form that this step writes nothing", () => {
    // The page header already carries the two-step summary; repeating it inside
    // the form said nothing new. What the form says instead is the property that
    // makes the step safe to press.
    render();

    const form = screen.getByTestId("form-import-preview");
    expect(form.textContent).toContain("ขั้นตอนนี้เป็นการอ่านไฟล์เท่านั้น");
  });

  it("keeps the three labels distinct in English too", () => {
    render("en");

    expect(
      screen.getByRole("heading", { name: "Check the file" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("form-import-preview").textContent).toContain(
      "The file to check",
    );
    expect(
      screen.getByRole("button", { name: "Parse without writing" }),
    ).toBeInTheDocument();
  });
});
