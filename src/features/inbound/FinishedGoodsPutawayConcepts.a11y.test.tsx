import { fireEvent, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { expect, it } from "vitest";

import { renderWithIntl } from "@tests/fixtures/intl-render";

import { FinishedGoodsPutawayConcepts } from "./FinishedGoodsPutawayConcepts";

it("keeps all three Thai finished-goods putaway styles accessible", async () => {
  const { container } = renderWithIntl(<FinishedGoodsPutawayConcepts />, {
    locale: "th",
    workspace: false,
  });

  expect(await axe(container)).toHaveNoViolations();

  fireEvent.click(screen.getByRole("tab", { name: /2 · เทียบก่อนเลือก/ }));
  expect(await axe(container)).toHaveNoViolations();

  fireEvent.click(screen.getByRole("tab", { name: /3 · เรดาร์คลัง/ }));
  expect(await axe(container)).toHaveNoViolations();
});
