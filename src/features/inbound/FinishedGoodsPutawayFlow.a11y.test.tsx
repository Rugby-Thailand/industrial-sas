import { fireEvent, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { expect, it } from "vitest";

import { renderWithIntl } from "@tests/fixtures/intl-render";

import { FinishedGoodsPutawayFlow } from "./FinishedGoodsPutawayFlow";

it("keeps every Thai finished-goods decision path accessible", async () => {
  const { container } = renderWithIntl(<FinishedGoodsPutawayFlow />, {
    locale: "th",
    workspace: false,
  });

  expect(await axe(container)).toHaveNoViolations();

  for (const name of [
    /วัดแล้ว · ตำแหน่งย่อย/,
    /วัดแล้ว · ไม่มีที่ปลอดภัย/,
    /ยังไม่วัด · มี package profile/,
    /ยังไม่วัด · ไม่มี profile/,
  ]) {
    fireEvent.click(screen.getByRole("button", { name }));
    expect(await axe(container)).toHaveNoViolations();
  }
});
