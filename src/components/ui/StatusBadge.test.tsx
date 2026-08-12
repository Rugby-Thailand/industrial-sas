import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithIntl } from "../../../tests/fixtures/intl-render";

import { StatusBadge } from "./StatusBadge";

/**
 * The badge, checked as a shape as well as as a state.
 *
 * The visual audit found the pill wrapping into two and three lines inside
 * narrow table cells, which reads as several badges rather than one — worst in
 * Thai, where there are no spaces and the browser breaks by its own guess at a
 * word boundary. jsdom computes no layout, so the assertion is on the class that
 * produces the behaviour, in the same spirit as
 * `HandheldShell.a11y.test.tsx`'s `min-h-touch` check.
 */

/** The pill itself: the outer element the component renders. */
const badge = (label: string): HTMLElement => {
  const element = screen.getByText(label).parentElement;
  if (element === null) throw new Error("badge has no root element");
  return element;
};

// Long enough to force a break in a narrow cell, and Thai, which is where the
// browser's word splitting produced the tallest pills.
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
    // One flex line, and the glyph does not give up its width to the label.
    expect(pill).toHaveClass("inline-flex");
    expect(pill.firstElementChild).toHaveClass("shrink-0");
  });

  it("states the status in words beside the glyph", () => {
    // `INV-0010-07`: never colour alone. The glyph is the second non-colour
    // signal and is hidden from assistive technology, which reads the label.
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
