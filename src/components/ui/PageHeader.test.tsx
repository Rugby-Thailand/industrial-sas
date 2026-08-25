import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithIntl } from "../../../tests/fixtures/intl-render";

import { PageHeader } from "./PageHeader";

describe("PageHeader", () => {
  it("keeps the title as the single h1 and hides the description by default", () => {
    renderWithIntl(<PageHeader title="งานคลัง" description="คำอธิบายหน้า" />);

    expect(
      screen.getByRole("heading", { level: 1, name: "งานคลัง" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("คำอธิบายหน้า")).not.toBeInTheDocument();
  });

  it("reveals and hides the description through the labelled toggle", () => {
    renderWithIntl(<PageHeader title="งานคลัง" description="คำอธิบายหน้า" />);

    const toggle = screen.getByRole("button", { name: "เกี่ยวกับหน้านี้" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const description = screen.getByText("คำอธิบายหน้า");
    expect(description).toHaveAttribute(
      "id",
      toggle.getAttribute("aria-controls"),
    );

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("คำอธิบายหน้า")).not.toBeInTheDocument();
  });

  it("renders no toggle when there is no description", () => {
    renderWithIntl(<PageHeader title="งานคลัง" />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
