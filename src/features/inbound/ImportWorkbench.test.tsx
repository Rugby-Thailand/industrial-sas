import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { navigationMock } from "../../../tests/fixtures/navigation-mock";

vi.mock("@/i18n/navigation", () => navigationMock);

import {
  testEnvironment,
  renderWithIntl,
} from "../../../tests/fixtures/intl-render";
import { writeStoredWarehouse } from "@/lib/workspace/warehouseStore";

import { ImportWorkbench } from "./ImportWorkbench";

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

  it("says behind the form's help toggle that this step writes nothing", () => {
    render();

    const form = screen.getByTestId("form-import-preview");
    expect(form.textContent).not.toContain("ขั้นตอนนี้เป็นการอ่านไฟล์เท่านั้น");

    const help = within(form).getByRole("button", {
      name: "เกี่ยวกับฟอร์มนี้",
    });
    expect(help).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(help);
    expect(help).toHaveAttribute("aria-expanded", "true");
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
