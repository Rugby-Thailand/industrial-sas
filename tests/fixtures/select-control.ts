/**
 * Operating the shared Radix Select from a component test.
 *
 * Before the migration a test read a choose-one control by reaching into the
 * DOM — `select.querySelectorAll("option")` — because a native `<select>` keeps
 * its options in the document whether or not anybody opened it. A Radix menu
 * does not: the list is portalled and only exists while it is open, which is
 * also why it can be styled at all.
 *
 * So the helpers below drive the control the way an operator does, and they do
 * it **with the keyboard**. That is not incidental. Every one of these flows has
 * to be completable by a keyboard or a HID scanner acting as one
 * (`INV-0010-08`), so a test that could only click would be testing the half of
 * the contract that was never in doubt. Pointer operation is covered end to end
 * by the Playwright suite, in a browser with real hit testing.
 *
 * `Enter` opens, `ArrowDown`/`ArrowUp` move, `Enter` commits, `Escape` closes
 * and returns focus to the trigger — the WAI-ARIA listbox pattern Radix
 * implements, unchanged.
 */
import { fireEvent, screen, within } from "@testing-library/react";

/** The trigger for a select, by the visible label its `<label for>` names. */
export const selectTrigger = (label: string): HTMLElement =>
  screen.getByLabelText(label);

/** The open menu. Radix portals it, so it is found on `document.body`. */
export const openMenu = (): HTMLElement => screen.getByRole("listbox");

/**
 * Open a select and return its menu.
 *
 * `keyDown` rather than a click: a click in jsdom carries no real pointer, and
 * the keyboard path is the one the accessibility contract actually promises.
 */
export function openSelect(label: string): HTMLElement {
  fireEvent.keyDown(selectTrigger(label), { key: "Enter" });
  return openMenu();
}

/** The visible text of every row in a select, in order. */
export function selectOptionLabels(label: string): readonly string[] {
  const options = within(openSelect(label)).getAllByRole("option");
  return options.map((option) => option.textContent ?? "");
}

/**
 * Choose a row by its visible text.
 *
 * The row is committed with `Enter` after being focused, which is what a
 * keyboard user does and what Radix listens for.
 */
export function chooseOption(label: string, optionText: string): void {
  const option = within(openSelect(label)).getByRole("option", {
    name: optionText,
  });
  fireEvent.keyDown(option, { key: "Enter" });
}

/**
 * What the trigger currently shows.
 *
 * The Radix trigger renders the *label* of the selected row, not its value —
 * which is the right thing to assert on anyway. An assertion on a document ID
 * proves the wiring; an assertion on the SKU proves the operator can read it.
 */
export const selectedLabel = (label: string): string =>
  selectTrigger(label).textContent ?? "";
