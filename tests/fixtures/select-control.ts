import { fireEvent, screen, within } from "@testing-library/react";

export const selectTrigger = (label: string): HTMLElement =>
  screen.getByLabelText(label);

export const openMenu = (): HTMLElement => screen.getByRole("listbox");

export function openSelect(label: string): HTMLElement {
  fireEvent.keyDown(selectTrigger(label), { key: "Enter" });
  return openMenu();
}

export function selectOptionLabels(label: string): readonly string[] {
  const options = within(openSelect(label)).getAllByRole("option");
  return options.map((option) => option.textContent ?? "");
}

export function chooseOption(label: string, optionText: string): void {
  const option = within(openSelect(label)).getByRole("option", {
    name: optionText,
  });
  fireEvent.keyDown(option, { key: "Enter" });
}

export const selectedLabel = (label: string): string =>
  selectTrigger(label).textContent ?? "";
