import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "../../../tests/fixtures/intl-render";
import {
  chooseOption,
  openSelect,
  selectTrigger,
} from "../../../tests/fixtures/select-control";

import { SelectControl } from "./SelectControl";

const OPTIONS = [
  { value: "prv_wh_bangpoo", label: "BKK-01 · คลังบางปู" },
  { value: "prv_wh_lamphun", label: "LPN-01 · คลังลำพูน" },
] as const;

function Harness({
  initial = "",
  ...props
}: {
  readonly initial?: string;
} & Partial<Parameters<typeof SelectControl>[0]>) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="warehouse">คลังสินค้า</label>
      <SelectControl
        id="warehouse"
        value={value}
        onValueChange={setValue}
        options={[...OPTIONS]}
        placeholder="เลือกคลังสินค้า"
        emptyLabel="ไม่มีคลังสินค้าให้เลือก"
        {...props}
      />
    </>
  );
}

describe("SelectControl", () => {
  it("is a combobox with the label its form gave it", () => {
    renderWithIntl(<Harness />);
    expect(selectTrigger("คลังสินค้า")).toHaveAttribute("role", "combobox");
  });

  it("says what it wants rather than pre-selecting the first option", () => {
    renderWithIntl(<Harness />);
    expect(selectTrigger("คลังสินค้า")).toHaveTextContent("เลือกคลังสินค้า");
  });

  it("hands its caller the value, not the label", () => {
    const onValueChange = vi.fn();
    renderWithIntl(<Harness onValueChange={onValueChange} />);

    chooseOption("คลังสินค้า", "LPN-01 · คลังลำพูน");

    expect(onValueChange).toHaveBeenCalledWith("prv_wh_lamphun");
  });

  it("carries the submitted value into the DOM for end-to-end selection", () => {
    renderWithIntl(<Harness />);
    const menu = openSelect("คลังสินค้า");

    expect(
      menu.querySelector('[role="option"][data-value="prv_wh_bangpoo"]'),
    ).not.toBeNull();
  });

  it("moves through the options with the arrow keys and commits with Enter", () => {
    const onValueChange = vi.fn();
    renderWithIntl(<Harness onValueChange={onValueChange} />);

    const trigger = selectTrigger("คลังสินค้า");
    fireEvent.keyDown(trigger, { key: "ArrowDown" });

    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    fireEvent.keyDown(options[0]!, { key: "ArrowDown" });
    fireEvent.keyDown(options[1]!, { key: "Enter" });

    expect(onValueChange).toHaveBeenCalledWith("prv_wh_lamphun");
  });

  it("closes on Escape and puts focus back on the trigger", async () => {
    renderWithIntl(<Harness />);

    const trigger = selectTrigger("คลังสินค้า");
    const menu = openSelect("คลังสินค้า");
    fireEvent.keyDown(menu, { key: "Escape" });

    expect(screen.queryByRole("listbox")).toBeNull();

    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("refuses to open while a request is in flight, and says why", () => {
    renderWithIntl(<Harness pending />);

    const trigger = selectTrigger("คลังสินค้า");
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveAttribute("aria-busy", "true");
  });

  it("is closed when it is disabled", () => {
    renderWithIntl(<Harness disabled />);
    expect(selectTrigger("คลังสินค้า")).toBeDisabled();
  });

  it("closes itself when there is nothing to choose, and names the reason", () => {
    renderWithIntl(<Harness options={[]} />);

    const trigger = selectTrigger("คลังสินค้า");
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveTextContent("ไม่มีคลังสินค้าให้เลือก");
  });

  it("marks itself invalid and points at the message describing why", () => {
    renderWithIntl(<Harness invalid describedBy="warehouse-error" />);

    const trigger = selectTrigger("คลังสินค้า");
    expect(trigger).toHaveAttribute("aria-invalid", "true");
    expect(trigger).toHaveAttribute("aria-describedby", "warehouse-error");
  });

  it("carries an option whose value is the empty string", () => {
    const onValueChange = vi.fn();
    renderWithIntl(
      <Harness
        initial="prv_po_2601"
        onValueChange={onValueChange}
        options={[
          { value: "", label: "ไม่ผูกกับใบสั่งซื้อ" },
          { value: "prv_po_2601", label: "PO-2601" },
        ]}
      />,
    );

    chooseOption("คลังสินค้า", "ไม่ผูกกับใบสั่งซื้อ");

    expect(onValueChange).toHaveBeenCalledWith("");
  });
});
