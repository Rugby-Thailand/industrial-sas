import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { trackAppHistory } from "@/lib/browser/appHistory";
import { FilterDateField } from "./FilterDateField";

let stop: () => void;
beforeEach(() => {
  history.replaceState(
    { appNavigationIndex: 0 },
    "",
    "/en/dashboard?source=home#origin",
  );
  stop = trackAppHistory();
  history.pushState({}, "", "/en/hr/time?q=worker#range");
});
afterEach(() => stop());

function Field() {
  const [value, setValue] = useState("2024-02-28");
  return (
    <FilterDateField
      id="from"
      label="From"
      value={value}
      onChange={setValue}
      min="2024-02-01"
      max="2024-03-31"
    />
  );
}

it("selects a leap day by keyboard and consumes the calendar before returning to the actual origin", async () => {
  renderWithIntl(<Field />, { locale: "en" });
  const user = userEvent.setup();
  const opener = screen.getByRole("button", { name: "Choose date for From" });
  await user.click(opener);
  const dialog = screen.getByRole("dialog");
  const selected = within(dialog).getByRole("button", { name: /February 28/ });
  selected.focus();
  await user.keyboard("{ArrowRight}");
  await waitFor(() =>
    expect(
      within(dialog).getByRole("button", { name: /February 29/ }),
    ).toHaveFocus(),
  );
  await user.keyboard("{Enter}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() =>
    expect(screen.getByRole("textbox")).toHaveValue("2024-02-29"),
  );
  expect(window.location.search + window.location.hash).toBe("?q=worker#range");
  expect(opener).toHaveFocus();
  act(() => history.back());
  await waitFor(() => expect(window.location.pathname).toBe("/en/dashboard"));
});

it("restores a typed draft after native Back and reopens the localized calendar on Forward", async () => {
  renderWithIntl(<Field />, { locale: "th" });
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: "2024-03-0" } });
  const opener = screen.getByRole("button", { name: "เลือกวันที่สำหรับFrom" });
  await userEvent.click(opener);
  expect(screen.getByRole("button", { name: "เดือนก่อนหน้า" })).toBeVisible();
  act(() => history.back());
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(input).toHaveValue("2024-03-0");
  act(() => history.forward());
  await screen.findByRole("dialog");
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(input).toHaveValue("2024-03-0");
  act(() => history.back());
  await waitFor(() => expect(window.location.pathname).toBe("/en/dashboard"));
});
