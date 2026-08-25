import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithIntl } from "../../../tests/fixtures/intl-render";

import { StatusBadge } from "./StatusBadge";

const badge = (label: string): HTMLElement => {
  const element = screen.getByText(label).parentElement;
  if (element === null) throw new Error("badge has no root element");
  return element;
};

const THAI_LABEL = "ปิดทั้งที่ยังไม่ครบ";

describe("StatusBadge", () => {
  it("keeps glyph, label, and detail on one line", () => {
    renderWithIntl(
      <StatusBadge tone="warning" label={THAI_LABEL}>
        <span>320</span>
      </StatusBadge>,
    );

    const pill = badge(THAI_LABEL);
    expect(pill).toHaveClass("whitespace-nowrap");

    expect(pill).toHaveClass("inline-flex");
    expect(pill.firstElementChild).toHaveClass("shrink-0");
  });

  it("states the status in words beside the glyph", () => {
    renderWithIntl(<StatusBadge tone="success" label="พร้อมใช้" />);

    const pill = badge("พร้อมใช้");
    expect(pill).toHaveTextContent("พร้อมใช้");
    expect(pill.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });

  it("carries an explanation as the pill's own tooltip", () => {
    renderWithIntl(
      <StatusBadge tone="pending" label="รอตรวจ" title="รอการตรวจสอบคุณภาพ" />,
    );
    expect(badge("รอตรวจ")).toHaveAttribute("title", "รอการตรวจสอบคุณภาพ");
  });
});
