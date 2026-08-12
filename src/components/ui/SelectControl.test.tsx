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

/**
 * The shared Select, exercised as a control rather than as markup.
 *
 * This component replaced four native `<select>` elements, and a native select
 * came with a contract nobody had to write down: it was reachable by Tab, it
 * opened on Enter, arrows moved through it, Escape closed it, focus came back,
 * and it submitted a value. Every one of those is now this project's
 * responsibility, so every one of them is asserted here.
 *
 * The tests drive the keyboard on purpose. A HID scanner is a keyboard, and a
 * screen an operator can only finish with a mouse is a screen they cannot finish
 * (`INV-0010-08`).
 */

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
    // The trigger is a `<button>`, which is labelable — so `<label for>` reaches
    // it exactly as it reached the native control it replaced.
    renderWithIntl(<Harness />);
    expect(selectTrigger("คลังสินค้า")).toHaveAttribute("role", "combobox");
  });

  it("says what it wants rather than pre-selecting the first option", () => {
    /*
     * A select that defaulted to its first entry would record a receipt against
     * a dock nobody chose. Nothing is selected, and the placeholder says so.
     */
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
    // `data-value` is why the E2E suite can still name a warehouse ID rather
    // than a Thai string that a copy edit would break.
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
    /*
     * The half of the contract a portalled menu is most likely to lose. Focus
     * left behind in a torn-down subtree lands on `<body>`, and a keyboard user
     * has to tab from the top of the document to get back to where they were.
     */
    renderWithIntl(<Harness />);

    const trigger = selectTrigger("คลังสินค้า");
    const menu = openSelect("คลังสินค้า");
    fireEvent.keyDown(menu, { key: "Escape" });

    expect(screen.queryByRole("listbox")).toBeNull();
    // Radix restores focus after the layer unmounts, so the assertion waits for
    // it rather than racing the teardown.
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("refuses to open while a request is in flight, and says why", () => {
    // `pending` is not `disabled`: the control is unusable for a reason, and
    // `aria-busy` is how that reason reaches a screen reader rather than only
    // somebody who can see it greyed out.
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
    /*
     * An empty menu and a menu that failed to load look identical once opened.
     * So an empty option set does not open at all, and the trigger carries the
     * sentence instead of a placeholder inviting a choice that cannot be made.
     */
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
    /*
     * Radix reserves `""` for "nothing is selected" and throws if an item claims
     * it, but "no order" is a real domain choice whose submitted value is the
     * empty string. It survives the round trip rather than being renamed, so the
     * server keeps receiving what it always did.
     */
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
