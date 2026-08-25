import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "../../../tests/fixtures/intl-render";

import {
  QuantityEntryField,
  type QuantityEntryLabels,
} from "./QuantityEntryField";

const labels: QuantityEntryLabels = {
  quantityLabel: "จำนวน",
  uomLabel: "หน่วยที่นับ",
  uomPlaceholder: "เลือกหน่วย",
  previewLabel: "ระบบจะอ่านเป็น",
  errors: {
    MALFORMED_GROUPING: "ตัวคั่นหลักพันไม่ถูกต้อง",
    MIXED_NUMERAL_SYSTEMS: "ใช้เลขไทยหรือเลขอารบิกอย่างใดอย่างหนึ่ง",
    PRECISION_EXCEEDED: "ทศนิยมได้ไม่เกินสามตำแหน่ง",
  },
  genericError: "จำนวนไม่ถูกต้อง",
};

function Harness({ initial = "" }: { readonly initial?: string }) {
  const [value, setValue] = useState(initial);
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
      labels={labels}
      testId="quantity"
    />
  );
}

const feedback = () => screen.getByTestId("quantity-feedback");

describe("QuantityEntryField", () => {
  it("offers a numeric keypad rather than a full keyboard", () => {
    renderWithIntl(<Harness />);
    expect(screen.getByTestId("quantity")).toHaveAttribute(
      "inputMode",
      "decimal",
    );
  });

  it("shows nothing before anything is typed", () => {
    renderWithIntl(<Harness />);
    expect(feedback()).toHaveTextContent("");
  });

  it("previews what the server will read, in the entry unit", async () => {
    renderWithIntl(<Harness />);
    await userEvent.type(screen.getByTestId("quantity"), "1,200");
    expect(feedback()).toHaveTextContent("ระบบจะอ่านเป็น 1200 PCS");
  });

  it("reads Thai digits", async () => {
    renderWithIntl(<Harness />);
    await userEvent.type(screen.getByTestId("quantity"), "๑๒.๕");
    expect(feedback()).toHaveTextContent("ระบบจะอ่านเป็น 12.5 PCS");
  });

  it("names the refusal instead of silently dropping the input", async () => {
    renderWithIntl(<Harness />);
    await userEvent.type(screen.getByTestId("quantity"), "1,20");
    expect(feedback()).toHaveTextContent("ตัวคั่นหลักพันไม่ถูกต้อง");
    expect(screen.getByTestId("quantity")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("refuses a mix of Thai and Arabic numerals", async () => {
    renderWithIntl(<Harness />);
    await userEvent.type(screen.getByTestId("quantity"), "1๒");
    expect(feedback()).toHaveTextContent(
      "ใช้เลขไทยหรือเลขอารบิกอย่างใดอย่างหนึ่ง",
    );
  });

  it("refuses a fourth decimal rather than rounding it away", async () => {
    renderWithIntl(<Harness />);
    await userEvent.type(screen.getByTestId("quantity"), "1.0001");
    expect(feedback()).toHaveTextContent("ทศนิยมได้ไม่เกินสามตำแหน่ง");
  });

  it("never submits its form when a wedge scanner presses Enter", async () => {
    const onSubmit = vi.fn((event: { preventDefault: () => void }) =>
      event.preventDefault(),
    );
    renderWithIntl(
      <form onSubmit={onSubmit}>
        <Harness />
      </form>,
    );
    await userEvent.type(screen.getByTestId("quantity"), "12{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();

    expect(screen.getByTestId("quantity")).toHaveValue("12");
  });

  it("keeps the entry unit beside the number, labelled", () => {
    renderWithIntl(<Harness />);
    expect(screen.getByText("หน่วยที่นับ")).toBeInTheDocument();
    expect(screen.getByText("จำนวน")).toBeInTheDocument();
  });
});
